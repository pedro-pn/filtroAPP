import { PRIVACY_CONTACT } from '../../constants/privacy';

type PrivacyNoticeVariant = 'signatureRdo' | 'signatureEpi' | 'survey' | 'clientAccount' | 'collaboratorSignature';

interface PrivacyNoticeProps {
  variant: PrivacyNoticeVariant;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

const noticeCopy: Record<PrivacyNoticeVariant, { title: string; details: string[]; checkbox: string }> = {
  signatureRdo: {
    title: 'Aviso de privacidade da assinatura do RDO',
    details: [
      'Ao assinar este relatório, serão coletados e armazenados como evidência jurídica da assinatura: seu nome declarado, imagem da sua assinatura manuscrita, endereço IP e informações do seu navegador/dispositivo.',
      'Finalidade: comprovar a autenticidade e validade jurídica da assinatura deste documento.',
      'Base legal: execução de contrato (Lei 13.709/2018, Art. 7°, V). Retenção: esses dados integram o documento assinado e serão mantidos por 5 anos, conforme o Código Civil (art. 206, §5°, I).'
    ],
    checkbox: 'Li e estou ciente do tratamento dos meus dados para assinatura eletrônica.'
  },
  signatureEpi: {
    title: 'Aviso de privacidade da assinatura de EPI',
    details: [
      'Ao assinar o recebimento deste EPI, serão coletados e armazenados como evidência do registro trabalhista: seu nome declarado, imagem da sua assinatura manuscrita, endereço IP e informações do seu navegador/dispositivo.',
      'Finalidade: registro obrigatório de entrega de equipamento de proteção individual.',
      'Base legal: execução de contrato de trabalho (Lei 13.709/2018, Art. 7°, V). Retenção: 20 anos, conforme NR-1 e entendimento consolidado do TST.'
    ],
    checkbox: 'Li e estou ciente do tratamento dos meus dados para assinatura de EPI.'
  },
  survey: {
    title: 'Aviso de privacidade da pesquisa',
    details: [
      'Ao responder esta pesquisa, serão coletados seu e-mail utilizado para envio, suas respostas e comentários, endereço IP e informações do seu navegador/dispositivo.',
      'Finalidade: gestão de qualidade e melhoria do serviço prestado.',
      'Base legal: legítimo interesse do controlador (Lei 13.709/2018, Art. 7°, IX). Retenção: respostas mantidas por 2 anos; IP e dados do dispositivo anonimizados após 1 ano.'
    ],
    checkbox: 'Li e estou ciente do tratamento dos meus dados para responder esta pesquisa.'
  },
  clientAccount: {
    title: 'Termo de privacidade da conta do cliente',
    details: [
      'Ao utilizar o portal do cliente, serão tratados dados da sua conta, identificação do cliente vinculado, projetos liberados, relatórios visualizados, comentários, aprovações, reprovações, assinaturas digitais, endereço IP e informações do seu navegador/dispositivo.',
      'Finalidades: liberar acesso aos relatórios contratados, registrar aprovações e reprovações, manter evidências de assinatura eletrônica, operar comunicações transacionais e cumprir obrigações legais e contratuais.',
      'Bases legais: execução de contrato (Lei 13.709/2018, Art. 7°, V), cumprimento de obrigação legal/regulatória quando aplicável (Art. 7°, II) e legítimo interesse para segurança, auditoria e melhoria do serviço (Art. 7°, IX).',
      'Retenção: registros de conta e auditoria são mantidos enquanto houver relação contratual ou obrigação legal; documentos assinados e respectivas evidências podem ser mantidos por 5 anos para defesa de direitos.'
    ],
    checkbox: 'Li e aceito o termo de privacidade para continuar usando o portal do cliente.'
  },
  collaboratorSignature: {
    title: 'Aviso de privacidade da assinatura-base do colaborador',
    details: [
      'Ao cadastrar esta imagem de assinatura, ela será armazenada como assinatura-base do colaborador para composição de relatórios e documentos internos do serviço.',
      'Finalidade: identificar o colaborador responsável em documentos operacionais e manter evidência compatível com a execução do trabalho contratado.',
      'Base legal: execução de contrato de trabalho ou prestação de serviço (Lei 13.709/2018, Art. 7°, V). Retenção: enquanto a assinatura-base for necessária para os documentos operacionais; evidências já incorporadas em documentos assinados são preservadas pelos prazos legais aplicáveis.'
    ],
    checkbox: 'Li e estou ciente do tratamento da assinatura-base deste colaborador.'
  }
};

export function PrivacyNotice({ variant, checked, onCheckedChange, disabled = false }: PrivacyNoticeProps) {
  const copy = noticeCopy[variant];

  return (
    <section className="privacy-notice" aria-labelledby={`privacy-notice-${variant}`}>
      <div className="privacy-notice-title" id={`privacy-notice-${variant}`}>{copy.title}</div>
      {copy.details.map(detail => <p key={detail}>{detail}</p>)}
      <p>
        Controlador: Filtrovali Serviços de Filtragem de Óleos Industriais e Limpeza de Tubulações Ltda.
        {' '}Canal de privacidade: <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a>.
        {' '}Política completa: <a href="/privacidade" target="_blank" rel="noopener noreferrer">/privacidade</a>.
      </p>
      <label className="privacy-notice-check">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={event => onCheckedChange(event.target.checked)}
        />
        <span>{copy.checkbox}</span>
      </label>
    </section>
  );
}
