import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = fileURLToPath(new URL("../../../.github/workflows", import.meta.url));
const workflow = (name: string) => readFileSync(join(dir, name), "utf8");

describe("GitHub workflows (supply chain and concurrency)", () => {
  it("pins every action to a full commit SHA with the tag in a comment", () => {
    const unpinned = readdirSync(dir)
      .filter((name) => name.endsWith(".yml"))
      .flatMap((name) =>
        [...workflow(name).matchAll(/uses:\s*(\S+)(.*)/g)]
          .filter(([, ref, comment]) => !/@[0-9a-f]{40}$/.test(ref!) || !/#\s*v\d/.test(comment ?? ""))
          .map(([, ref]) => `${name}: ${ref}`),
      );
    expect(unpinned).toEqual([]);
  });

  it("preview E2E: concurrency is per job and per deployment environment (API events never cancel the web run)", () => {
    const yml = workflow("e2e-preview.yml");
    expect(yml).not.toMatch(/^concurrency:/m);
    expect(yml).toMatch(
      /^ {4}concurrency:\n {6}group: .*github\.event\.deployment\.environment.*github\.event\.deployment\.sha/m,
    );
  });

  it("CI only cancels superseded pull request runs, never main", () => {
    expect(workflow("ci.yml")).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  });
});
