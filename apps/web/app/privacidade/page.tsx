import type { Metadata } from "next";
import { LegalPage } from "@/components/legal";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description: `Como ${site.name} trata dados pessoais conforme a LGPD.`,
  alternates: { canonical: "/privacidade" },
};

/** Modelo base: revise com o cliente/jurídico e troque os campos entre colchetes em lib/site.ts. */
export default function PrivacyPage() {
  return (
    <LegalPage title="Política de Privacidade" updatedAt={site.legalUpdatedAt}>
      <p>
        Esta política explica como {site.company} ({site.document}), controladora dos dados, coleta, usa e protege dados
        pessoais em {site.name}, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018).
      </p>

      <h2>1. Dados que coletamos</h2>
      <ul>
        <li>Cadastro e login: nome, e-mail e identificadores da conta.</li>
        <li>Uso do serviço: arquivos enviados e registros de atividade (data, ação e endereço IP).</li>
        <li>Pagamentos, quando houver: processados pelo provedor de pagamento; não armazenamos dados de cartão.</li>
        <li>Navegação: cookies essenciais e, somente com seu consentimento, cookies de análise.</li>
      </ul>

      <h2>2. Para que usamos</h2>
      <ul>
        <li>Prestar o serviço contratado e manter sua conta (execução de contrato).</li>
        <li>Segurança, prevenção a fraudes e registros de acesso (legítimo interesse e obrigação legal).</li>
        <li>Comunicações sobre a conta, como confirmações e avisos (execução de contrato).</li>
        <li>Métricas de uso para melhorar o produto, apenas com consentimento.</li>
      </ul>

      <h2>3. Compartilhamento</h2>
      <p>
        Compartilhamos dados apenas com operadores necessários ao funcionamento do serviço (hospedagem, banco de dados,
        autenticação, armazenamento de arquivos, envio de e-mails, pagamentos, monitoramento de erros e análise), sob
        contrato e com medidas de segurança. Alguns operadores podem processar dados fora do Brasil, com as garantias
        previstas na LGPD. Não vendemos dados pessoais.
      </p>

      <h2>4. Cookies</h2>
      <p>
        Cookies essenciais mantêm você conectado e não dependem de consentimento. Cookies de análise só são ativados se
        você aceitar no aviso de cookies, e você pode mudar a escolha a qualquer momento em &quot;Preferências de
        cookies&quot;, no rodapé.
      </p>

      <h2>5. Por quanto tempo guardamos</h2>
      <p>
        Enquanto a conta estiver ativa. Ao excluir a conta, apagamos seus dados e arquivos e cancelamos assinaturas
        ativas, exceto registros que a lei exige manter (por exemplo, registros de acesso por 6 meses, conforme o Marco
        Civil da Internet), que ficam anonimizados.
      </p>
      <ul>
        <li>Endereço IP nos registros de atividade: apagado automaticamente após 180 dias.</li>
        <li>Notificações já lidas: apagadas após 180 dias.</li>
        <li>Envios de arquivo não concluídos: apagados em até 1 dia.</li>
      </ul>

      <h2>6. Seus direitos</h2>
      <p>
        Você pode confirmar o tratamento, acessar, corrigir, portar e excluir seus dados, além de revogar
        consentimentos. No painel, em &quot;Meus dados&quot;, é possível baixar seus dados e excluir a conta. Para
        outros pedidos, escreva para {site.dpoEmail}.
      </p>

      <h2>7. Segurança</h2>
      <p>
        Usamos conexões criptografadas, controle de acesso por usuário, armazenamento privado de arquivos e
        monitoramento de incidentes. Em caso de incidente relevante, comunicaremos os titulares e a ANPD conforme a lei.
      </p>

      <h2>8. Contato</h2>
      <p>
        Encarregado de dados (DPO): {site.dpoEmail}. Esta política pode ser atualizada; a data no topo indica a versão
        vigente.
      </p>
    </LegalPage>
  );
}
