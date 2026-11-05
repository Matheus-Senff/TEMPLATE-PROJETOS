import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("feature flags", () => {
  it("without PostHog, FEATURE_FLAGS turns flags on for everyone", async () => {
    vi.stubEnv("FEATURE_FLAGS", "new-checkout, beta");
    const { isFeatureEnabled, enabledFlags } = await import("../src/services/flags.service.js");
    expect(await isFeatureEnabled("new-checkout", "u1")).toBe(true);
    expect(await isFeatureEnabled("other")).toBe(false);
    expect(await enabledFlags("u1")).toEqual({ "new-checkout": true, beta: true });
  });

  it("with PostHog, evaluates per user and falls back to FEATURE_FLAGS when PostHog fails", async () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    vi.stubEnv("FEATURE_FLAGS", "beta");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getPostHog } = await import("../src/config/posthog.js");
    const posthog = (await getPostHog())!;
    const isEnabled = vi
      .spyOn(posthog, "isFeatureEnabled")
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("down"));
    vi.spyOn(posthog, "getAllFlags").mockResolvedValue({ "new-checkout": true, experiment: "variant-b", off: false });
    const { isFeatureEnabled, enabledFlags } = await import("../src/services/flags.service.js");

    expect(await isFeatureEnabled("beta", "u1")).toBe(false); // PostHog wins
    expect(await isFeatureEnabled("beta", "u1")).toBe(true); // PostHog down: env fallback
    expect(isEnabled).toHaveBeenCalledWith("beta", "u1");
    expect(await enabledFlags("u1")).toEqual({ beta: true, "new-checkout": true, experiment: true, off: false });
  });
});
