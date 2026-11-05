import Link from "next/link";
import { Reveal } from "@/components/motion/reveal";

const stack = [
  ["Next.js", "Front-end e páginas"],
  ["Hono", "API leve e tipada"],
  ["Neon + Drizzle", "Banco Postgres"],
  ["Clerk", "Login e permissões"],
  ["Cloudflare R2", "Arquivos sem custo de saída"],
  ["Ably", "Tempo real (opcional)"],
  ["Stripe", "Pagamentos (opcional)"],
] as const;

export default function HomePage() {
  return (
    <section className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Seu próximo projeto começa aqui</h1>
        <p className="max-w-2xl text-neutral-600 dark:text-neutral-400">
          Esqueleto com login, banco, arquivos, tempo real e pagamentos já ligados. Troque este texto pela proposta do
          seu produto.
        </p>
        <Link
          href="/dashboard"
          className="inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-neutral-900"
        >
          Abrir o painel
        </Link>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stack.map(([name, role], index) => (
          <Reveal
            as="li"
            key={name}
            delay={index * 80}
            className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
          >
            <p className="font-medium">{name}</p>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">{role}</p>
          </Reveal>
        ))}
      </ul>
    </section>
  );
}
