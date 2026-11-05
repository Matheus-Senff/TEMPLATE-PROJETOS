import Link from "next/link";

export default function NotFound() {
  return (
    <section className="space-y-3">
      <h1 className="text-2xl font-bold">Página não encontrada</h1>
      <Link href="/" className="text-sm underline">
        Voltar para o início
      </Link>
    </section>
  );
}
