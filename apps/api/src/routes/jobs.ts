import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { getQStashReceiver, upstashConfig } from "../config/upstash.js";
import { jobs, runJob, type JobName } from "../services/jobs.service.js";

const isJobName = (name: string): name is JobName => Object.hasOwn(jobs, name);

/**
 * QStash callback: POST /jobs/<name>. Verified by signature (no Clerk auth).
 * Non-2xx answers make QStash retry the job.
 */
export const jobsRoutes = new Hono().post("/:name", async (c) => {
  const qstashReceiver = upstashConfig.queueEnabled ? await getQStashReceiver() : null;
  if (!qstashReceiver) {
    throw new HTTPException(503, { message: "Queue module is disabled" });
  }
  const signature = c.req.header("upstash-signature");
  const body = await c.req.text();
  const name = c.req.param("name");
  // Verify against the public URL QStash was given (c.req.url may differ behind the platform proxy).
  const url = upstashConfig.apiPublicUrl ? `${upstashConfig.apiPublicUrl.replace(/\/+$/, "")}/jobs/${name}` : c.req.url;
  const valid = signature ? await qstashReceiver.verify({ signature, body, url }).catch(() => false) : false;
  if (!valid) throw new HTTPException(401, { message: "Invalid QStash signature" });

  if (!isJobName(name)) throw new HTTPException(404, { message: `Unknown job ${name}` });

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON body" });
  }
  try {
    await runJob(name, payload);
  } catch (error) {
    if (error instanceof ZodError) throw new HTTPException(400, { message: `Invalid payload for ${name}` });
    throw error;
  }
  return c.json({ ok: true });
});
