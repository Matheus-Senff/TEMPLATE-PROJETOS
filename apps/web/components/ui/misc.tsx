import { cn } from "@/lib/utils";

const badgeTones = {
  neutral: "bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200",
  success: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  danger: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
} as const;

export const Badge = ({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof badgeTones }) => (
  <span
    className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", badgeTones[tone], className)}
    {...props}
  />
);

export const Skeleton = ({ className }: { className?: string }) => (
  <div aria-hidden="true" className={cn("animate-pulse rounded bg-neutral-200 dark:bg-neutral-800", className)} />
);

/** Empty state with a next step. Never leave a list blank. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center dark:border-neutral-700">
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
