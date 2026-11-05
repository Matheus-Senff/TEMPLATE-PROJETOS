import type { Metadata } from "next";
import { ContactForm } from "@/components/contact-form";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Contato",
  description: `Fale com ${site.name}.`,
  alternates: { canonical: "/contato" },
};

export default function ContactPage() {
  return (
    <section className="max-w-xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Contato</h1>
        <p className="text-neutral-600 dark:text-neutral-400">Envie sua mensagem e responderemos por e-mail.</p>
      </div>
      <ContactForm />
    </section>
  );
}
