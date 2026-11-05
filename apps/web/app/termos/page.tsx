import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description: `Condições de uso de ${site.name}.`,
  alternates: { canonical: "/termos" },
};

/** Modelo base: revise com o cliente/jurídico e troque os campos entre colchetes em lib/site.ts. */
export default function TermsPage() {
  return (
    <LegalPage title="Termos de Uso" updatedAt={site.legalUpdatedAt}>
      <p>
        Estes termos regulam o uso de {site.name}, oferecido por {site.company} ({site.document}). Ao criar uma conta ou
        usar o serviço, você concorda com eles.
      </p>

      <h2>1. Conta</h2>
      <p>
        Você é responsável pelas informações cadastradas e pelo sigilo do seu acesso. Avise-nos em caso de uso não
        autorizado da sua conta.
      </p>

      <h2>2. Uso permitido</h2>
      <ul>
        <li>
          Não use o serviço para atividades ilegais, envio de conteúdo malicioso ou que viole direitos de terceiros.
        </li>
        <li>Não tente acessar dados de outros usuários, burlar limites ou prejudicar o funcionamento do serviço.</li>
        <li>Você mantém os direitos sobre o conteúdo que envia e nos autoriza a armazená-lo para prestar o serviço.</li>
      </ul>

      <h2>3. Pagamentos</h2>
      <p>
        Planos pagos, quando existirem, são cobrados pelo provedor de pagamento nas condições exibidas na contratação.
        Cancelamentos e reembolsos seguem a oferta contratada e o Código de Defesa do Consumidor.
      </p>

      <h2>4. Disponibilidade</h2>
      <p>
        Trabalhamos para manter o serviço disponível e seguro, mas podem ocorrer interrupções para manutenção ou por
        fatores fora do nosso controle.
      </p>

      <h2>5. Encerramento</h2>
      <p>Você pode excluir sua conta a qualquer momento no painel. Podemos suspender contas que violem estes termos.</p>

      <h2>6. Privacidade</h2>
      <p>
        O tratamento de dados pessoais segue a{" "}
        <Link href="/privacidade" className="underline">
          Política de Privacidade
        </Link>
        .
      </p>

      <h2>7. Foro e contato</h2>
      <p>Fica eleito o foro do domicílio do consumidor. Dúvidas: {site.contactEmail}.</p>
    </LegalPage>
  );
}
