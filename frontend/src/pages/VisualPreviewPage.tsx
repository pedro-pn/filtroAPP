import { Link } from 'react-router';

import { PublicFlowShell } from './PublicFlowShell';

const previews = [
  { title: 'Login', description: 'Entrada da conta', href: '/visualizar/login' },
  { title: 'Animações de carregamento', description: 'Setas girando ou colorindo conforme o progresso', href: '/visualizar/carregamento' },
  { title: 'Pesquisa de satisfação', description: 'Convite e formulário com perguntas fictícias', href: '/pesquisa/exemplo?visualizar=1' },
  { title: 'Preferências de notificações', description: 'Link recebido por e-mail', href: '/notificacoes/exemplo?visualizar=1' },
  { title: 'Confirmação de e-mail', description: 'Troca do endereço da conta', href: '/confirmar-email?visualizar=1' },
  { title: 'Assinatura de RDO', description: 'Convite para assinar um relatório fictício', href: '/assinar/exemplo?visualizar=1' },
  { title: 'Operações', description: 'Painel administrativo com indicadores simulados', href: '/visualizar/operacoes' },
  { title: 'Documentos do Efetivo', description: 'Diálogos de cadastro, versão e aceite', href: '/visualizar/documentos' }
];

export function VisualPreviewPage() {
  return <PublicFlowShell title="Prévia visual" description="Abra cada tela com dados fictícios. Nenhuma ação desta lista grava dados no sistema." wide preview>
    <div className="visual-preview-list">
      {previews.map(item => <Link key={item.href} to={item.href}>
        <span><strong>{item.title}</strong><small>{item.description}</small></span>
        <span aria-hidden="true">↗</span>
      </Link>)}
    </div>
  </PublicFlowShell>;
}
