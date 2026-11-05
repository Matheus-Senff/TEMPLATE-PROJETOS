/** Motion tokens: use the same durations and easings everywhere (CSS, Motion, GSAP). */
export const duration = { fast: 0.15, base: 0.3, slow: 0.6, reveal: 0.8 } as const;
export const easing = {
  out: "cubic-bezier(0.22, 1, 0.36, 1)",
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  gsapOut: "power3.out",
  gsapInOut: "power2.inOut",
} as const;
export const breakpoints = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Low-end device heuristic: use it to serve a poster/simpler scene instead of heavy 3D. */
export function isLowEndDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return (navigator.hardwareConcurrency ?? 8) <= 4 || memory <= 4;
}
