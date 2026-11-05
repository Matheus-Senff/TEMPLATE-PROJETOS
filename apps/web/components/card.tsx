import { buttonVariants } from "./ui/button";

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function Status({ text, tone = "muted" }: { text: string | null; tone?: "muted" | "error" | "ok" }) {
  if (!text) return null;
  const color = { muted: "text-neutral-500", error: "text-red-600", ok: "text-green-600" }[tone];
  return <p className={`text-sm break-all ${color}`}>{text}</p>;
}

export const buttonClass = buttonVariants({ size: "sm" });
