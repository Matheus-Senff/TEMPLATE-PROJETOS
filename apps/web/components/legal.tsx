export function LegalPage({
  title,
  updatedAt,
  children,
}: {
  title: string;
  updatedAt: string;
  children: React.ReactNode;
}) {
  return (
    <article className="max-w-3xl space-y-4 leading-relaxed [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="text-sm text-neutral-500">Última atualização: {updatedAt}</p>
      {children}
    </article>
  );
}
