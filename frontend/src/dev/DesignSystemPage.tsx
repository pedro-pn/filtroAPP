import { useState } from 'react';

import { BrandLogo } from '../components/brand/BrandLogo';
import { AppIcon } from '../components/icons/AppIcon';
import { Modal, type ModalSize } from '../components/ui/Modal';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Input,
  Select,
  Skeleton,
  Spinner,
  StatusPill,
  Textarea,
  type ButtonVariant,
  type ControlSize,
  type SemanticTone
} from '../components/ui/ds';
import { DS_ICONS } from '../components/ui/ds/icons';
import { ThemeToggle } from '../theme/ThemeToggle';

const buttonVariants: ButtonVariant[] = [
  'primary',
  'secondary',
  'ghost',
  'danger',
  'link'
];
const controlSizes: ControlSize[] = ['sm', 'md', 'lg'];
const tones: SemanticTone[] = [
  'neutral',
  'brand',
  'success',
  'warning',
  'danger',
  'info'
];
const statuses = [
  'aprovado',
  'pendente',
  'rejeitado',
  'revisão',
  'assinado',
  'expirado',
  'em andamento',
  'cancelado'
];

function Section({
  id,
  title,
  description,
  children
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="ds-demo-section" aria-labelledby={`${id}-title`}>
      <div className="ds-demo-section__heading">
        <h2 id={`${id}-title`}>{title}</h2>
        <p>{description}</p>
      </div>
      {children}
    </section>
  );
}

export function DesignSystemPage() {
  const [modalSize, setModalSize] = useState<ModalSize | null>(null);
  const [alertVisible, setAlertVisible] = useState(true);

  return (
    <div className="fv-ds ds-demo-page">
      <header className="ds-demo-header">
        <BrandLogo variant="adaptive" className="ds-demo-logo" />
        <div className="ds-demo-header__copy">
          <span className="ds-demo-eyebrow">Ambiente interno</span>
          <h1>Componentes primitivos</h1>
          <p>Filtrovali DS · Fase 2 · sem migração de telas</p>
        </div>
        <ThemeToggle data-testid="theme-toggle" />
      </header>

      <main className="ds-demo-main">
        <Section
          id="buttons"
          title="Button e IconButton"
          description="Variantes, tamanhos, ícones e estados interativos."
        >
          <div className="ds-demo-grid">
            <Card title="Variantes" padding="sm" elevation="none">
              <div className="ds-demo-cluster">
                {buttonVariants.map((variant) => (
                  <Button
                    key={variant}
                    variant={variant}
                    iconLeft={
                      <AppIcon
                        icon={
                          variant === 'danger' ? DS_ICONS.trash : DS_ICONS.save
                        }
                        size="sm"
                      />
                    }
                  >
                    {variant}
                  </Button>
                ))}
              </div>
            </Card>

            <Card title="Tamanhos" padding="sm" elevation="none">
              <div className="ds-demo-cluster ds-demo-cluster--end">
                {controlSizes.map((size) => (
                  <Button key={size} size={size} variant="primary">
                    Tamanho {size}
                  </Button>
                ))}
              </div>
            </Card>

            <Card title="Estados" padding="sm" elevation="none">
              <div className="ds-demo-cluster">
                <Button variant="primary">Default</Button>
                <Button variant="primary" className="ds-demo-state--hover">
                  Hover
                </Button>
                <Button variant="primary" className="ds-demo-state--active">
                  Active
                </Button>
                <Button variant="primary" className="ds-demo-state--focus">
                  Focus-visible
                </Button>
                <Button variant="primary" disabled>
                  Disabled
                </Button>
                <Button variant="primary" loading>
                  Loading
                </Button>
              </div>
            </Card>

            <Card title="Somente ícone" padding="sm" elevation="none">
              <div className="ds-demo-cluster">
                <IconButton icon={DS_ICONS.plus} label="Adicionar" />
                <IconButton
                  icon={DS_ICONS.settings}
                  label="Configurações"
                  variant="secondary"
                />
                <IconButton
                  icon={DS_ICONS.trash}
                  label="Excluir"
                  variant="danger"
                />
                <IconButton icon={DS_ICONS.save} label="Salvando" loading />
              </div>
            </Card>
          </div>
        </Section>

        <Section
          id="fields"
          title="Field, Input, Select e Textarea"
          description="Controles nativos com associação de label, ajuda e erro."
        >
          <div className="ds-demo-form-grid">
            <Field
              id="ds-demo-mission-name"
              label="Nome da missão"
              helperText="Use um nome identificável."
              required
            >
              <Input id="ds-demo-mission-name-control" name="missionName" placeholder="Ex.: Inspeção anual" />
            </Field>
            <Field
              label="Campo em foco"
              helperText="Estado de foco demonstrativo."
            >
              <Input
                containerClassName="ds-demo-state--control-focus"
                defaultValue="Conteúdo editável"
              />
            </Field>
            <Field
              label="E-mail"
              errorText="Informe um e-mail válido."
              required
            >
              <Input type="email" defaultValue="email-invalido" />
            </Field>
            <Field label="Responsável" helperText="Com ícone de contexto.">
              <Input
                prefix={<AppIcon icon={DS_ICONS.settings} size="sm" />}
                placeholder="Buscar responsável"
                autoComplete="name"
              />
            </Field>
            <Field label="Campo desabilitado" disabled>
              <Input defaultValue="Sem edição" />
            </Field>
            <Field label="Situação" required>
              <Select
                name="status"
                placeholder="Selecione…"
                defaultValue=""
                options={[
                  { value: 'open', label: 'Em andamento' },
                  { value: 'done', label: 'Concluído' }
                ]}
              />
            </Field>
            <Field label="Select desabilitado" disabled>
              <Select
                defaultValue="done"
                options={[{ value: 'done', label: 'Concluído' }]}
              />
            </Field>
            <Field
              label="Select com erro"
              errorText="Selecione uma opção."
              required
            >
              <Select placeholder="Selecione…" defaultValue="" />
            </Field>
            <Field
              label="Observações"
              helperText="Textarea segue a mesma linguagem visual."
              additionalContent="0/500"
            >
              <Textarea name="notes" maxLength={500} />
            </Field>
          </div>
        </Section>

        <Section
          id="badges"
          title="Badge e StatusPill"
          description="Tones semânticos e resolução centralizada de status."
        >
          <div className="ds-demo-stack">
            <div className="ds-demo-cluster">
              {tones.map((tone) => (
                <Badge key={tone} tone={tone} dot>
                  {tone}
                </Badge>
              ))}
              <Badge
                tone="brand"
                onRemove={() => undefined}
                removeLabel="Remover filtro obra"
              >
                Filtro removível
              </Badge>
            </div>
            <div className="ds-demo-cluster">
              {statuses.map((status) => (
                <StatusPill key={status} status={status} />
              ))}
            </div>
          </div>
        </Section>

        <Section
          id="alerts"
          title="Alert"
          description="Feedback contextual distinto de erros de campo."
        >
          <div className="ds-demo-stack">
            <Alert tone="success" title="Alterações salvas">
              Os dados foram registrados com sucesso.
            </Alert>
            <Alert tone="warning" title="Atenção necessária">
              Existem informações pendentes antes de continuar.
            </Alert>
            <Alert
              tone="danger"
              title="Não foi possível salvar"
              action={{ label: 'Tentar novamente', onClick: () => undefined }}
            >
              Revise a conexão e repita a operação.
            </Alert>
            {alertVisible ? (
              <Alert
                tone="info"
                title="Informação"
                onDismiss={() => setAlertVisible(false)}
              >
                Este alerta demonstra a ação de dispensar.
              </Alert>
            ) : (
              <Button variant="secondary" onClick={() => setAlertVisible(true)}>
                Restaurar alerta
              </Button>
            )}
          </div>
        </Section>

        <Section
          id="cards"
          title="Card"
          description="Um único componente com composição, padding, elevação e realce."
        >
          <div className="ds-demo-grid">
            <Card
              title="Card padrão"
              actions={
                <IconButton
                  icon={DS_ICONS.settings}
                  label="Configurar card"
                  size="sm"
                />
              }
              footer={<Badge tone="neutral">Atualizado agora</Badge>}
            >
              Conteúdo agrupado em uma superfície sem acoplamento ao domínio.
            </Card>
            <Card
              title="Card flat"
              variant="flat"
              padding="sm"
              elevation="none"
            >
              Adequado para agrupamentos internos sem empilhar sombras.
            </Card>
            <Card
              title="Card interativo"
              padding="lg"
              elevation="md"
              onClick={() => undefined}
              aria-label="Abrir exemplo de card interativo"
            >
              Renderizado como botão real e com foco visível.
            </Card>
            <Card
              title="Card de destaque"
              variant="accent"
              accentTone="warning"
              selected
            >
              Realce sem criar uma variante específica de módulo.
            </Card>
          </div>
        </Section>

        <Section
          id="feedback"
          title="Spinner, EmptyState e Skeleton"
          description="Estados de carregamento e ausência reutilizáveis."
        >
          <div className="ds-demo-grid">
            <Card title="Spinners" padding="sm" elevation="none">
              <div className="ds-demo-cluster">
                {controlSizes.map((size) => (
                  <Spinner
                    key={size}
                    size={size}
                    label={`Carregando ${size}`}
                  />
                ))}
              </div>
            </Card>
            <Card title="EmptyState" padding="sm" elevation="none">
              <EmptyState
                title="Nenhum item cadastrado"
                description="Crie o primeiro item para iniciar esta lista."
                variant="create"
                action={{ label: 'Criar item', onClick: () => undefined }}
              />
            </Card>
            <Card title="Skeleton de card" padding="sm" elevation="none">
              <Skeleton variant="card" />
            </Card>
            <Card title="Skeleton de lista" padding="sm" elevation="none">
              <Skeleton variant="text" lines={5} />
            </Card>
            <Card title="Skeleton de tabela" padding="sm" elevation="none">
              <Skeleton variant="table-rows" lines={4} />
            </Card>
          </div>
        </Section>

        <Section
          id="modal"
          title="Modal"
          description="Tamanhos, conteúdo rolável, footer e fullscreen em mobile."
        >
          <div className="ds-demo-cluster">
            {(['sm', 'md', 'lg'] as ModalSize[]).map((size) => (
              <Button
                key={size}
                variant="secondary"
                onClick={() => setModalSize(size)}
              >
                Abrir modal {size}
              </Button>
            ))}
          </div>
        </Section>
      </main>

      <Modal
        appearance="design-system"
        open={modalSize !== null}
        onClose={() => setModalSize(null)}
        title={`Modal ${modalSize ?? 'md'}`}
        size={modalSize ?? 'md'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalSize(null)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={() => setModalSize(null)}>
              Confirmar
            </Button>
          </>
        }
      >
        <div className="ds-demo-modal-content">
          <Field label="Nome" required>
            <Input autoComplete="name" />
          </Field>
          {Array.from({ length: 10 }, (_, index) => (
            <p key={index}>
              Bloco {index + 1}: conteúdo longo para validar o scroll interno
              sem exceder a viewport e mantendo header e footer disponíveis.
            </p>
          ))}
        </div>
      </Modal>
    </div>
  );
}
