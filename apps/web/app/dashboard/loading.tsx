export default function DashboardLoading() {
  return (
    <section className="space-y-6" aria-busy="true" aria-label="Carregando">
      <div className="h-8 w-48 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-36 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
        ))}
      </div>
    </section>
  );
}
