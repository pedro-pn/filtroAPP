import { useMemo, useState } from 'react';
import { useLocation } from 'react-router';

import { AppIcon } from '../components/icons/AppIcon';
import { Button, Card, IconButton, Input } from '../components/ui/ds';
import { AppShell } from '../layout/AppShell';
import { NAVIGATION_CHROME_ICONS } from '../layout/navigationIcons';
import { createNavigationModel } from '../layout/navigationModel';
import { PageHeader } from '../layout/PageHeader';
import { moduleRegistry, type HubModuleId } from '../modules/registry';
import type { HubModuleEntry } from '../pages/hubModules';

type PreviewHubConfig = {
  enabled?: boolean;
  path?: string;
};

const registryPreviewModules: HubModuleEntry[] = moduleRegistry
  .filter((module) => module.hub?.enabled)
  .map((module) => {
    const hub = module.hub as PreviewHubConfig;
    const routes = module.routes as Record<string, string>;
    return {
      id: module.id as HubModuleId,
      badge: module.badge,
      title: module.title,
      copy: module.copy,
      path: hub.path || routes.root || Object.values(routes)[0]
    };
  });

function ShellPreview() {
  const location = useLocation();
  const [query, setQuery] = useState('');
  const [announcement, setAnnouncement] = useState(
    'Shell isolado pronto para validação.'
  );
  const filteredModules = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
    if (!normalizedQuery) return registryPreviewModules;
    return registryPreviewModules.filter((module) =>
      `${module.title} ${module.copy}`
        .toLocaleLowerCase('pt-BR')
        .includes(normalizedQuery)
    );
  }, [query]);
  const navigation = useMemo(
    () =>
      createNavigationModel({
        modules: filteredModules,
        pathname: location.pathname
      }),
    [filteredModules, location.pathname]
  );

  return (
    <AppShell
      navigation={navigation}
      title="Visão geral"
      breadcrumb={[{ label: 'Filtrovali' }, { label: 'Visão geral' }]}
      search={
        <Input
          aria-label="Buscar módulos na prévia"
          placeholder="Buscar módulos"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          prefix={<AppIcon icon={NAVIGATION_CHROME_ICONS.search} size="sm" />}
        />
      }
      notifications={
        <IconButton
          icon={NAVIGATION_CHROME_ICONS.notifications}
          label="Notificações"
          onClick={() =>
            setAnnouncement('Nenhuma notificação na prévia técnica.')
          }
        />
      }
      profile={{
        name: 'Ambiente de validação',
        description: 'Sem simulação de permissões',
        initials: 'DS',
        onOpen: () => setAnnouncement('Ação de perfil validada.')
      }}
      utilityActions={
        <Button
          variant="ghost"
          size="sm"
          fullWidth
          iconLeft={<AppIcon icon={NAVIGATION_CHROME_ICONS.help} size="sm" />}
          onClick={() => setAnnouncement('Ação auxiliar validada.')}
        >
          Ajuda
        </Button>
      }
    >
      <div className="fv-ds fv-shell-demo-content">
        <PageHeader
          title="Shell e navegação"
          description="Harness visual isolado. A navegação exibe o catálogo real do registry sem representar ou simular autorização de usuário."
          breadcrumb={[{ label: 'Design System' }, { label: 'Fase 3A' }]}
          actions={
            <Button
              variant="secondary"
              onClick={() => setAnnouncement('Ação contextual validada.')}
            >
              Validar ação
            </Button>
          }
          auxiliary={
            <span className="fv-shell-demo-status" aria-live="polite">
              {announcement}
            </span>
          }
        />

        <section
          className="fv-shell-demo-grid"
          aria-label="Conteúdo de validação"
        >
          {filteredModules.map((module) => (
            <Card
              key={module.id}
              title={module.title}
              padding="sm"
              elevation="sm"
            >
              <p className="fv-shell-demo-module-copy">{module.copy}</p>
              <span className="fv-shell-demo-module-code">{module.badge}</span>
            </Card>
          ))}
        </section>
      </div>
    </AppShell>
  );
}

export function ShellDesignSystemPage() {
  return <ShellPreview />;
}
