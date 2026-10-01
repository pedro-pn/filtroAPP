import { Link } from 'react-router';

import { BrandLogo } from '../components/brand/BrandLogo';
import { Card } from '../components/ui/ds';
import { PRIVACY_CONTACT, PRIVACY_POLICY_EFFECTIVE_DATE, PRIVACY_POLICY_VERSION } from '../constants/privacy';
import './PrivacyPublicPage.ds.css';

const sections = [
  {
    title: 'Dados tratados',
    items: [
      'Dados de conta: nome, usuário, e-mail, perfil, vínculo com cliente, status e registros de sessão.',
      'Dados de projetos e relatórios: cliente, CNPJ, responsáveis, datas, serviços executados, anexos, comentários, aprovações e reprovações.',
      'Dados de assinatura eletrônica: nome declarado, imagem da assinatura, documento assinado, data/hora, endereço IP, navegador/dispositivo e códigos de validação.',
      'Dados de pesquisa de satisfação: e-mail de envio, respostas, comentários, projeto relacionado, IP, navegador/dispositivo e datas de envio/resposta.',
      'Dados de romaneio e notificações: informações de romaneios, destinatários de notificação e registros necessários à operação do módulo.',
      'Logs de segurança e auditoria: usuário, ação, data/hora, IP, User-Agent e identificadores técnicos necessários para rastreabilidade.'
    ]
  },
  {
    title: 'Finalidades',
    items: [
      'Operar o sistema FiltroAPP e liberar acesso aos módulos contratados.',
      'Gerar, revisar, aprovar, assinar, validar e armazenar relatórios de serviço.',
      'Registrar evidências de assinatura eletrônica e auditoria para defesa de direitos.',
      'Enviar comunicações transacionais, links de assinatura, pesquisas e notificações operacionais.',
      'Controlar entregas de EPI, romaneios, estatísticas e histórico de projetos.',
      'Manter segurança, prevenção a fraudes, rastreabilidade e melhoria do serviço.'
    ]
  },
  {
    title: 'Bases legais',
    items: [
      'Execução de contrato: operação do sistema, relatórios, aprovações, assinaturas e comunicações necessárias.',
      'Cumprimento de obrigação legal ou regulatória: documentos trabalhistas, registros exigidos e guarda legal quando aplicável.',
      'Legítimo interesse: segurança, auditoria, prevenção a fraudes, melhoria de serviço e pesquisas de satisfação, respeitados os direitos do titular.',
      'Exercício regular de direitos: preservação de documentos, evidências e logs necessários para defesa em processos administrativos, judiciais ou arbitrais.'
    ]
  },
  {
    title: 'Retenção',
    items: [
      'Relatórios assinados e evidências de assinatura de RDO podem ser mantidos por 5 anos para comprovação e defesa de direitos.',
      'Registros de EPI podem ser mantidos por até 20 anos quando necessários para obrigações trabalhistas e previdenciárias.',
      'Pesquisas de satisfação são mantidas por 2 anos; IP e dados de dispositivo podem ser anonimizados após 1 ano da resposta.',
      'Contas, permissões e logs operacionais são mantidos enquanto houver relação contratual ou necessidade de auditoria, segurança ou obrigação legal.',
      'Pedidos de exclusão serão analisados caso a caso, respeitando hipóteses legais de retenção previstas na LGPD.'
    ]
  },
  {
    title: 'Compartilhamento e operadores',
    items: [
      'Os dados podem ser tratados por provedores de hospedagem, banco de dados, e-mail transacional, armazenamento de arquivos e ferramentas de assinatura/validação quando integradas.',
      'O compartilhamento ocorre apenas quando necessário para operar o sistema, cumprir obrigações legais, proteger direitos ou atender solicitações legítimas.',
      'Empresas-clientes acessam dados vinculados aos seus próprios projetos, representantes e documentos, conforme permissões configuradas no sistema.'
    ]
  },
  {
    title: 'Direitos do titular',
    items: [
      'Você pode solicitar confirmação de tratamento, acesso, correção, anonimização, bloqueio, eliminação, portabilidade, informação sobre compartilhamento e oposição quando aplicável.',
      'Solicitações podem ser registradas em /privacidade/direitos ou enviadas ao canal de privacidade informado nesta política, com dados suficientes para identificação segura do titular.',
      'A eliminação pode ser recusada ou limitada quando houver obrigação legal, necessidade de retenção documental ou exercício regular de direitos.'
    ]
  }
];

export function PrivacyPage() {
  return (
    <main className="fv-ds privacy-public-shell" data-fv-ds>
      <header className="privacy-public-header"><BrandLogo className="privacy-public-logo" /></header>
      <Card className="privacy-public-hero" padding="lg">
        <Link className="privacy-public-back" to="/login">Voltar ao login</Link>
        <div className="section-title">Política de privacidade</div>
        <h1>FiltroAPP</h1>
        <p>
          Esta política descreve como a Filtrovali Serviços de Filtragem de Óleos Industriais e
          Limpeza de Tubulações Ltda. trata dados pessoais no uso do sistema FiltroAPP.
        </p>
        <div className="privacy-public-meta">
          <span>Versão: {PRIVACY_POLICY_VERSION}</span>
          <span>Vigência: {PRIVACY_POLICY_EFFECTIVE_DATE}</span>
          <span>Canal: <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a></span>
          <span><Link to="/privacidade/direitos">Exercer direitos LGPD</Link></span>
        </div>
      </Card>

      <div className="privacy-public-content">
        {sections.map(section => (
          <Card className="privacy-public-section" key={section.title} padding="lg" title={<h2>{section.title}</h2>}>
            <ul>
              {section.items.map(item => <li key={item}>{item}</li>)}
            </ul>
          </Card>
        ))}

        <Card className="privacy-public-section" padding="lg" title={<h2>Assinatura eletrônica e evidências legais</h2>}>
          <p>
            A imagem da assinatura manuscrita digitalizada é tratada como dado pessoal comum e usada para
            comprovar a manifestação de vontade no documento assinado. O sistema também registra IP,
            User-Agent, data/hora e identificadores técnicos para validação, auditoria e defesa de direitos.
          </p>
        </Card>

        <Card className="privacy-public-section" padding="lg" title={<h2>Contato</h2>}>
          <p>
            Para dúvidas ou exercício de direitos previstos na LGPD, entre em contato pelo e-mail{' '}
            <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a> ou registre uma solicitação em{' '}
            <Link to="/privacidade/direitos">/privacidade/direitos</Link>.
          </p>
        </Card>
      </div>
    </main>
  );
}
