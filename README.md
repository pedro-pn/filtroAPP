# Filtrovali — Plataforma de Gestão de Campo

Aplicação web modular para a gestão operacional da Filtrovali. Nasceu como sistema de relatórios técnicos de campo e evoluiu para uma plataforma com múltiplos módulos — relatórios e projetos (RDO), acompanhamento financeiro de projetos, romaneio de equipamentos, controle de estoque, cadastro de equipamentos, liberação de EPI, assinaturas avulsas e privacidade (LGPD) — todos acessados a partir de um hub central com controle de acesso por módulo.

## Índice

- [Visão Geral](#visão-geral)
- [Módulos](#módulos)
- [Stack](#stack)
- [Estrutura do Repositório](#estrutura-do-repositório)
- [Hub e Controle de Acesso](#hub-e-controle-de-acesso)
- [Funcionalidades por Módulo](#funcionalidades-por-módulo)
- [Tipos de Relatório](#tipos-de-relatório)
- [Integrações](#integrações)
- [Configuração do Ambiente](#configuração-do-ambiente)
  - [Desenvolvimento local (Node direto)](#desenvolvimento-local-node-direto)
  - [Desenvolvimento local (Docker)](#desenvolvimento-local-docker)
- [Deploy em Produção](#deploy-em-produção)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Banco de Dados](#banco-de-dados)
- [Geração de PDF](#geração-de-pdf)
- [Assinatura Interna](#assinatura-interna)
- [Scripts Utilitários](#scripts-utilitários)
- [Rotas da API](#rotas-da-api)

---

## Visão Geral

A plataforma centraliza o ciclo operacional da Filtrovali em módulos independentes. O fluxo original de relatórios permanece no núcleo:

1. Colaborador cria o relatório no campo.
2. Gestor revisa e aprova.
3. Cliente acessa o portal, visualiza e pode reprovar (com justificativa obrigatória) para revisão.
4. Relatório aprovado segue para assinatura eletrônica pelo sistema interno.
5. Relatório assinado fica disponível para download em PDF.
6. Ao arquivar o projeto, o cliente recebe uma pesquisa de satisfação NPS por e-mail.

Em torno desse núcleo, os demais módulos cobrem custos e previsto x realizado de projetos, logística de equipamentos, estoque, cadastro técnico de equipamentos, entrega de EPI e atendimento a solicitações LGPD.

---

## Módulos

Cada módulo tem sua própria área na aplicação, papéis de acesso e prefixo de rota. Usuários enxergam no hub (`/modulos`) apenas os módulos para os quais possuem papel.

| Módulo | Prefixo API | Descrição |
|---|---|---|
| **Relatórios e Projetos (RDO)** | `/api/rdo` | Relatórios técnicos, aprovações, portal do cliente, projetos e estatísticas |
| **Acompanhamento de Projetos** | `/api/acompanhamento` | Previsto x realizado, custos (mão de obra, EPI, estoque, Omie), cronograma |
| **Romaneio de Equipamentos** | `/api/romaneio` | Romaneios de saída/retorno, catálogo, checklist e notificações |
| **Estoque** | `/api/estoque` | Filtros, produtos químicos, lotes e movimentações |
| **Equipamentos** | `/api/equipamentos` | Cadastro, calibração, documentação técnica e notificações de equipamentos |
| **Liberação de EPI** | `/api/epi` | Fichas de entrega/devolução e assinatura por colaborador |
| **Assinaturas** | `/api/assinaturas` | Envio de PDFs, coleta de assinaturas avulsas, evidências e validação pública |
| **Privacidade (LGPD)** | `/api/privacy` | Solicitações de titulares e protocolos LGPD |
| **Gestão de Contas** | `/api/admin/accounts` | Administração inicial de usuários e acessos do hub |

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + TypeScript + Vite 6 |
| Estado / Fetching | TanStack Query v5 + Zustand |
| Formulários | React Hook Form + Zod |
| Roteamento | React Router v7 |
| Onboarding / tours | Driver.js |
| Backend | Node.js 22 + Express 5 |
| ORM | Prisma 7 (adapter `pg`) |
| Banco | PostgreSQL 16 |
| E-mail | Nodemailer (SMTP / Microsoft Exchange / Office 365) |
| PDF | LibreOffice headless (Linux) |
| Assinatura digital | Sistema interno |
| Integração financeira | Omie (contas a pagar/receber, categorias, projetos) |
| Proxy / SSL | Nginx + Let's Encrypt |
| Containers | Docker + Docker Compose |

---

## Estrutura do Repositório

```
.
├── backend/
│   ├── prisma/               # Schema, migrations e seed
│   ├── scripts/              # Utilitários de manutenção, imports e sync
│   ├── src/
│   │   ├── config/           # Variáveis de ambiente
│   │   ├── lib/              # Lógica de negócio por domínio
│   │   │   ├── acompanhamento/   # Custos, comercial, ponto, dashboards
│   │   │   ├── job-roles/        # Cargos e parâmetros de custo
│   │   │   └── ...               # email, PDF, assinaturas, estoque, romaneio…
│   │   ├── middleware/       # Auth e autorização por módulo/papel
│   │   ├── routes/
│   │   │   ├── index.js          # Montagem dos routers por módulo
│   │   │   └── resources/        # Rotas REST por recurso
│   │   └── app.js / server.js
│   ├── .env.example
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── api/              # Clientes HTTP por recurso
│   │   ├── auth/             # AuthContext, navegação e acesso por módulo
│   │   ├── modules/          # Registry de módulos e roteamento
│   │   ├── components/       # Componentes compartilhados e por módulo
│   │   ├── hooks/            # React Query hooks
│   │   ├── pages/            # Páginas por módulo e perfil (inclui hub)
│   │   ├── store/            # Zustand stores
│   │   └── utils/
│   └── .env.example
├── deploy/
│   ├── nginx/                # Dockerfile do Nginx + default.conf
│   ├── PRODUCTION.md         # Guia detalhado de produção
│   ├── backup-prod.sh
│   └── restore-prod.sh
├── specs/                    # Especificações spec-kit das features
├── Modelos/                  # Templates DOCX para geração de relatórios
├── docker-compose.yml        # Apenas PostgreSQL (dev Node direto)
├── docker-compose.local.yml  # PostgreSQL + backend em container (dev)
└── docker-compose.prod.yml   # Produção: PostgreSQL + backend + Nginx
```

O registry de módulos do frontend é gerado por `scripts/generate-module-registry.mjs` (`registry.generated.ts`) — não edite o arquivo gerado manualmente.

---

## Hub e Controle de Acesso

O acesso é organizado por **módulo** e **papel dentro do módulo** (`ModuleRole`), coexistindo com os papéis legados do módulo de relatórios.

### Papéis por módulo

| Módulo | Papéis |
|---|---|
| RDO | Gestor, Coordenador, Colaborador, Cliente |
| Acompanhamento | Gestor, Visualizador |
| Romaneio | Gestor, Operador |
| Estoque | Gestor, Visualizador |
| Equipamentos | Gestor, Visualizador |
| EPI | Técnico, Colaborador |
| Privacidade | Admin |
| Assinaturas | Usuário |

### Perfis do módulo de Relatórios (RDO)

| Perfil | Descrição |
|---|---|
| **MANAGER** (Gestor) | Acesso total: gerencia projetos, colaboradores, usuários, aprova e solicita assinatura de relatórios |
| **COORDINATOR** (Coordenador) | Visão gerencial similar ao gestor, com restrições específicas em edição |
| **COLLABORATOR** (Colaborador) | Cria e edita relatórios de campo; visibilidade limitada aos projetos vinculados |
| **CLIENT** (Cliente) | Visualiza e avalia (aprova/reprova) os relatórios dos seus projetos via portal dedicado |

### Navegação

- O hub em `/modulos` lista apenas os módulos liberados para a conta.
- No primeiro login com mais de um módulo, o usuário é levado ao hub com um tutorial de boas-vindas.
- A plataforma memoriza o último módulo acessado por usuário e restaura na próxima entrada.
- Contas de cliente entram direto no portal (`/rdo/cliente`).
- Rotas legadas (`/gestor`, `/coordenador`, `/cliente`, `/home`, `/relatorios/...`) continuam válidas e são mapeadas para o módulo RDO.

---

## Funcionalidades por Módulo

### Relatórios e Projetos (RDO)

**Projetos**
- Cadastro com dados do cliente (nome, CNPJ, e-mails principal e CC, signatários)
- Categorização por segmento de cliente (`clientSegment`)
- Arquivamento e desarquivamento
- Controle de visibilidade (visível a colaboradores / somente gestor)
- Provisionamento automático de conta de cliente ao associar e-mail
- Disparo automático de pesquisa de satisfação ao arquivar

**Relatórios**
- Criação assistida com rascunho automático
- Múltiplos tipos (ver seção abaixo)
- Fluxo de status: `PENDING → APPROVED → SIGNED`, com retorno para revisão (`RETURNED`)
- Versionamento e log de auditoria dos relatórios
- Registro de **DDS (Diálogo Diário de Segurança) por turno** no RDO, com temas configuráveis
- Download individual ou em lote (ZIP) em PDF
- Anexos de fotos e arquivos (com conversão HEIC)
- Numeração sequencial por tipo e projeto
- Campos obrigatórios de diâmetro e comprimento por tubulação (RDO)
- Upload manual de RDO com dados operacionais (horas, equipes, colaboradores históricos)

**Portal do Cliente**
- Acesso sem VPN via usuário CNPJ
- Visualização de relatórios dos projetos vinculados
- Aprovação ou reprovação com **justificativa obrigatória**
- Identificação do cliente que reprovou (nome + e-mail) na notificação ao gestor
- Histórico de reprovações exibido por relatório

**Pesquisa de Satisfação (NPS)**
- Enviada automaticamente ao cliente por e-mail ao arquivar um projeto
- Link público com token criptografado, válido por 30 dias (`/survey/:token`)
- Tipos de pergunta: NPS (0–10), SCALE (1–5), SELECT, TEXT
- Perguntas configuráveis pelo gestor; lembretes automáticos com opt-out
- Notificação ao gestor quando respondida; follow-up: `OPEN`, `CONTACTED`, `RESOLVED`, `NOT_APPLICABLE`

**Dashboard NPS**
- Restrito a Gestor e Coordenador
- Filtros por ano, trimestre e mês
- Score NPS com benchmark, distribuição (Promotores / Neutros / Detratores), médias por pergunta e evolução mensal

**Dashboard de Estatísticas de Projetos**
- Restrito a Gestor e Coordenador
- Filtros: período (máx. 2 anos), projeto(s), segmento e status (ativo / arquivado / todos)
- Granularidade: dia, semana, mês, ano
- Métricas: dias executados, horas diurnas/noturnas, horas extras, dias e horas em standby, médias de colaboradores por RDO
- Breakdown por serviço: filtragem (volume de óleo em L), flushing/limpeza/pressão (tubulações por diâmetro em metros)
- Timeline gráfica e exportação CSV (resumo geral, por projeto, por serviço)
- **Relatório de alocação** de colaboradores com envio por e-mail a destinatários configuráveis

### Acompanhamento de Projetos

- Dashboard de **previsto x realizado** por projeto, com cronograma e escopo previsto (sistemas/serviços)
- Cards de projetos com barra de progresso de custo e histórico semanal de avanço
- **Custos de mão de obra (HH)** calculados a partir da importação do ponto, com perfis e parâmetros por cargo, teto de horas extras, rateio mensal, hospedagem e EPI
- **Custos manuais** lançados por projeto no dashboard
- Contabilização de **estoque** e **EPI** consumidos como custo do projeto
- Integração com o **Omie**: contas a pagar/receber e categorias de custo, com toggles por categoria e cálculo de impostos (INSS de NF, ISS/NFSe, motor de IRPJ e CSLL)
- **Importação comercial** de propostas e projetos, com unificação de projetos, grupos de missões (mesclar/desmesclar) e revisões
- Aba **Sede** (centro de custo) com filtros de período e resumo de custos pagos/pendentes
- Aba de **projetos futuros**, separação entre projetos em andamento e arquivados
- Histórico de vigências dos modelos de custo por cargo
- Custos restritos ao papel de Gestor do módulo

### Romaneio de Equipamentos

- Romaneios de saída e retorno de equipamentos, com rascunhos
- Catálogo de itens sincronizável (com origem externa) e categorias
- **Checklist consolidado** no romaneio, com geração de PDF
- Itens extras de entrada/retorno e mapa de checklist
- Notificações por e-mail a destinatários configuráveis
- Geração de romaneio em PDF e DOCX

### Estoque

- Categorias e itens (filtros e produtos químicos), com ativação/desativação
- Controle de **lotes** e **movimentações** (entrada/saída) com motivos
- Estorno de movimentações
- Resumo de estoque
- Integração com o romaneio e com os custos do Acompanhamento

### Equipamentos

- Cadastro de equipamentos e categorias, com catálogo de unidades
- **Calibração** com certificados e notificações de vencimento
- **Documentação técnica** (upload e geração de documento por equipamento)
- Configuração de slots de equipamento no RDO
- Exibição de equipamentos no dashboard do projeto
- Destinatários e configuração de notificações

### Liberação de EPI

- Fichas de entrega e devolução por colaborador, com catálogo de EPIs
- **Assinatura por link público** (token), com geração de PDF assinado
- Solicitações de assinatura e log de auditoria
- Arquivamento de registros e edição de perfil do colaborador

### Privacidade (LGPD)

- Registro e acompanhamento de **solicitações de titulares** (acesso, exclusão, etc.)
- Verificação de identidade e controle de status das solicitações
- Autoatendimento: exportação de dados e pedido de exclusão pela própria conta
- Retenção de dados executada por script/job (dry-run e apply)

### Assinaturas Avulsas

- Envio de PDF com verificação SHA-256, prévia paginada e posicionamento de campos por assinante
- Convites individuais por e-mail ou cópia manual, com renovação, revogação, expiração e retry durável
- Link público recebido no fragmento da URL e enviado à API somente no header `X-Signature-Token`
- Finalização recuperável do PDF, página de evidências, código/QR e validação pública por hash
- Arquivamento, cancelamento e exclusão lógica com retenção de arquivos por 90 dias
- Exclusão de conta com quarentena recuperável dos documentos não concluídos e preservação dos concluídos sem proprietário
- Auditoria append-only e anonimização posterior de IP/User-Agent

### E-mails Automáticos

- Boas-vindas ao criar conta de cliente ou conta interna
- Novo projeto vinculado
- Relatório aprovado, reprovado ou revisado
- Convite e lembrete de pesquisa de satisfação; notificação ao gestor quando respondida
- Notificações de romaneio, calibração de equipamentos e assinatura de EPI
- Relatório de alocação de colaboradores
- Recuperação de senha e troca de e-mail

### Usuários e Contas

- Gerenciamento de usuários, colaboradores e papéis por módulo pelo gestor
- Reenvio de credenciais e alteração de senha via token de recuperação
- Troca de e-mail com token de confirmação
- Segmentos de cliente configuráveis, usados como filtro nas estatísticas

---

## Tipos de Relatório

| Sigla | Nome |
|---|---|
| RDO | Relatório Diário de Obra |
| RTP | Relatório Técnico de Processo |
| RLQ | Relatório de Limpeza Química |
| RCPU | Relatório de Contagem de Partículas — Upstream |
| RLM | Relatório de Limpeza Mecânica |
| RLF | Relatório de Limpeza por Flushing |
| RLI | Relatório de Limpeza Industrial |

---

## Integrações

- **Omie**: sincronização periódica de contas a pagar/receber, categorias e projetos para o módulo de Acompanhamento. Habilitada por `OMIE_SYNC_ENABLED` e credenciais `OMIE_APP_KEY` / `OMIE_APP_SECRET`.
- **Importação comercial**: propostas e projetos importados via endpoint protegido por `COMMERCIAL_IMPORT_TOKEN`.
- **Webhook de projetos**: recebe número, nome, cliente, CNPJ, `proposalCode`, revisão e local em `POST /api/webhooks/projects`, protegido por `PROJECT_INTAKE_WEBHOOK_TOKEN`. A proposta é exibida como `3088 Rev. 2`; quando a origem envia `revision: -1`, fica somente `3088` e a seleção comercial procura a revisão `0`. Quando a revisão principal existe na base comercial e ainda não há escolha vigente, ela é selecionada automaticamente. O projeto entra destacado e aguarda verificação manual do cadastro, mantendo disponível a troca manual da revisão. Como a integração ainda não entrou em produção, `contractCode` não é aceito pelo webhook.
- **Ponto**: importação de espelhos de ponto para cálculo de custo de mão de obra.
- **Monitoramento operacional**: endpoint `/operations/status` e job de alerta configurável (backup/restore, webhooks) para saúde da stack.
- **Error tracking**: captura de erros de cliente (`/operations/client-errors`) e provider configurável no backend/frontend.
- **ZapSign (legado)**: apenas download de PDFs de relatórios já assinados anteriormente pela ZapSign, quando necessário.

---

## Configuração do Ambiente

### Desenvolvimento local (Node direto)

**Pré-requisitos:** Node.js 22+, Docker (para o PostgreSQL).

#### 1. Subir o banco

```bash
docker compose up -d
```

#### 2. Configurar o backend

```bash
cp backend/.env.example backend/.env
# Editar backend/.env com DATABASE_URL, SMTP_* e APP_URL
```

#### 3. Instalar dependências, gerar cliente Prisma e aplicar migrations

```bash
cd backend
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

#### 4. Subir o backend

```bash
npm run dev
# API disponível em http://localhost:4000
```

#### 5. Configurar e subir o frontend

Em outro terminal:

```bash
cp frontend/.env.example frontend/.env
# VITE_API_BASE_URL=/api já está correto para desenvolvimento

cd frontend
npm install
npm run dev
# SPA disponível em http://localhost:5173
```

---

### Desenvolvimento local (Docker)

Sobe o PostgreSQL e o backend containerizado, útil para testar o ambiente próximo ao de produção.

```bash
# Criar backend/.env.docker.local com as variáveis necessárias
docker compose -f docker-compose.local.yml up -d --build

# Aplicar migrations (primeira vez)
docker compose -f docker-compose.local.yml exec backend npx prisma migrate deploy
docker compose -f docker-compose.local.yml exec backend npx prisma db seed
```

O volume `./backend/src` é montado, então alterações no código são refletidas com o watch do Node.

---

## Deploy em Produção

A stack de produção usa `docker-compose.prod.yml`: PostgreSQL + backend + Nginx com SSL.

> Consulte `deploy/PRODUCTION.md` para o guia completo e `Checklist-Producao.txt` para o roteiro pré-go-live.

### Subida inicial

```bash
# No servidor, com backend/.env.production preenchido
POSTGRES_PASSWORD=<senha> docker compose -f docker-compose.prod.yml up -d --build

# Migrations
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy

# Seed (somente em banco vazio)
docker compose -f docker-compose.prod.yml exec backend npx prisma db seed
```

### Atualização de versão

```bash
# 1. Fazer backup do banco antes de qualquer deploy
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U $POSTGRES_USER $POSTGRES_DB > backup-pre-deploy-$(date +%Y%m%d%H%M).sql

# 2. Rebuild e restart
POSTGRES_PASSWORD=<senha> docker compose -f docker-compose.prod.yml up -d --build

# 3. Aplicar novas migrations
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
```

### Arquitetura de produção

```
Internet
   │
   ▼
Nginx :443 (SSL Let's Encrypt)
   │
   ├── /                → SPA React (static files)
   └── /api/*           → Backend Express :4000 (rede interna Docker)
                               │
                               └── PostgreSQL :5432 (rede interna Docker)
```

- Portas `4000` e `5432` **não** são expostas ao host em produção.
- Upload máximo configurado: **30 MB**.
- Domínio principal: `app.filtrovali.com.br`
- Domínio legado: `relatorios.filtrovali.com.br` redireciona para o app; a raiz antiga aponta para o módulo de relatórios.

---

## Variáveis de Ambiente

### Backend (`backend/.env`)

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | Sim | Connection string PostgreSQL |
| `DATABASE_CONNECTION_LIMIT` | Não | Limite de conexões do pool Prisma anexado à `DATABASE_URL` quando `connection_limit` ainda não estiver definido |
| `PRISMA_SLOW_QUERY_MS` | Não | Ativa log de queries Prisma acima do limite informado em ms |
| `SLOW_OPERATION_LOG_MS` | Não | Ativa log de operações internas lentas acima do limite informado em ms |
| `PORT` | Não | Porta do backend (padrão: `4000`) |
| `APP_URL` | Sim | URL base pública (use `https://app.filtrovali.com.br`; usado em links de e-mail) |
| `ALLOWED_ORIGIN` | Sim | Origem(s) CORS permitida(s), separadas por vírgula |
| `TRUST_PROXY` | Sim em produção | Configuração Express `trust proxy`. Na stack Docker com Nginx use `uniquelocal` ou CIDRs explícitos |
| `SURVEY_TOKEN_SECRET` | Sim em produção | Segredo longo e estável para tokens de pesquisa |
| `SURVEY_TOKEN_SECRET_PREVIOUS` | Não | Segredos antigos aceitos durante rotação de tokens de pesquisa |
| `SIGNATURE_TOKEN_SECRET` | Sim em produção | Segredo longo e estável para links de assinatura de RDO, EPI e assinaturas avulsas |
| `SIGNATURE_TOKEN_SECRET_PREVIOUS` | Não | Segredos antigos aceitos durante rotação de tokens de assinatura |
| `ASSINATURAS_MAX_PDF_MB` | Não | Limite do PDF avulso em MB (padrão: `20`) |
| `ASSINATURAS_MAX_PAGES` | Não | Máximo de páginas por PDF avulso (padrão: `50`) |
| `ASSINATURAS_MAX_SIGNERS` | Não | Máximo de assinantes por documento (padrão: `20`) |
| `ASSINATURAS_TOKEN_MAX_DAYS` | Não | Validade máxima do convite em dias (padrão: `90`) |
| `ASSINATURAS_DELETED_RETENTION_DAYS` | Não | Retenção de arquivos excluídos em dias (padrão: `90`) |
| `ASSINATURAS_PREVIEW_SCALE` | Não | Escala inicial da renderização da prévia (padrão: `1.5`) |
| `COMMERCIAL_IMPORT_TOKEN` | Não | Token que protege o endpoint de importação comercial do Acompanhamento |
| `PROJECT_INTAKE_WEBHOOK_TOKEN` | Não | Token Bearer exclusivo do webhook de projetos; vazio mantém o endpoint desabilitado |
| `OMIE_APP_KEY` / `OMIE_APP_SECRET` | Não | Credenciais da API Omie |
| `OMIE_SYNC_ENABLED` | Não | Ativa a sincronização automática com o Omie |
| `OMIE_SYNC_INTERVAL_MINUTES` | Não | Intervalo entre sincronizações Omie |
| `OMIE_SYNC_SINCE_DAYS` | Não | Janela de dias considerada na sincronização Omie |
| `SMTP_HOST` | Sim | Servidor SMTP (ex: `smtp.office365.com`) |
| `SMTP_PORT` | Sim | Porta SMTP (padrão: `587`) |
| `SMTP_SECURE` | Não | `true` para SSL direto (porta 465) |
| `SMTP_USER` | Sim | Usuário SMTP |
| `SMTP_PASS` | Sim | Senha ou App Password |
| `SMTP_FROM` | Sim | Remetente (ex: `Filtrovali <no-reply@…>`) |
| `SEND_CLIENT_EMAILS` | Não | Use `false` em homologação/testes para bloquear todos os envios operacionais |
| `SMTP_TEST_DEST` | Não | E-mail destino do script `test-email.js` |
| `ASSETS_DIR` | Não | Diretório de assets estáticos |
| `REPORTS_DIR` | Não | Diretório de relatórios gerados |
| `LIBREOFFICE_BINARY` | Não | Caminho do LibreOffice (padrão: `soffice`) |
| `OPERATIONS_ALERT_JOB_ENABLED` | Não | Ativa o job de alertas operacionais |
| `OPERATIONS_ALERT_INTERVAL_MS` | Não | Intervalo do job de alertas operacionais |
| `OPERATIONS_ALERT_WEBHOOK_URL` | Não | Webhook de alertas operacionais |
| `OPERATIONS_REQUIRE_BACKUP_STATUS` / `OPERATIONS_BACKUP_STATUS_FILE` / `OPERATIONS_BACKUP_MAX_AGE_HOURS` | Não | Monitoramento de backup |
| `OPERATIONS_REQUIRE_RESTORE_STATUS` / `OPERATIONS_RESTORE_STATUS_FILE` / `OPERATIONS_RESTORE_MAX_AGE_DAYS` | Não | Monitoramento de restore |
| `ERROR_TRACKING_PROVIDER` / `ERROR_TRACKING_WEBHOOK_URL` | Não | Captura e encaminhamento de erros |
| `ZAPSIGN_API_TOKEN` / `ZAPSIGN_ORGANIZATION_ID` | Não | Apenas para download de PDFs legados já assinados pela ZapSign |

### Frontend (`frontend/.env`)

| Variável | Padrão | Descrição |
|---|---|---|
| `VITE_API_BASE_URL` | `/api` | Base URL da API (prefixo das chamadas HTTP) |
| `VITE_ASSETS_BASE_URL` | _(vazio)_ | Base URL para assets estáticos do backend |
| `VITE_ERROR_TRACKING_ENABLED` | `false` | Ativa o envio de erros de cliente |
| `VITE_ERROR_TRACKING_ENDPOINT` | _(vazio)_ | Endpoint para captura de erros de cliente |

---

## Banco de Dados

O schema Prisma (`backend/prisma/schema.prisma`) cobre todos os módulos. Modelos principais por domínio:

**Relatórios e Projetos**
| Modelo | Descrição |
|---|---|
| `Project` / `ProjectAuthorizedUser` / `ProjectReportSeq` | Projeto de campo, acesso autorizado e numeração sequencial |
| `Report` / `ReportVersion` / `ReportDraft` / `ReportAttachment` | Relatório técnico, versões, rascunho e anexos |
| `ReportService` / `ReportCollaborator` / `ReportAuditLog` | Serviços, colaboradores e auditoria do relatório |
| `ReportSignature` / `ReportApprovalPostProcessingJob` | Assinatura interna e pós-processamento da aprovação |
| `ClientReportReview` | Registro de aprovação/reprovação pelo cliente |
| `DdsTheme` | Temas de DDS configuráveis |
| `SatisfactionSurvey` / `SatisfactionSurveyQuestion` | Pesquisa de satisfação NPS e perguntas configuráveis |
| `AllocationReport*` | Relatório de alocação e destinatários |
| `ClientSegment` | Segmentos de cliente configuráveis |

**Acompanhamento**
| Modelo | Descrição |
|---|---|
| `CommercialProposal` / `AccessImport` | Propostas comerciais e importações |
| `AcompanhamentoSetting` / `AcompanhamentoMissionGroup(+Member)` | Configurações e grupos de missões |
| `CostProfile` / `CostParameterSet` / `JobRole` | Perfis e parâmetros de custo por cargo |
| `PontoImport` / `PontoPeriodSummary` / `PontoNameAlias` | Importação e apuração do ponto |
| `ProjectBudget` / `ProjectManualCost` / `ProjectManualProgressHistory` | Orçamento, custos manuais e histórico de avanço |
| `ProjectPlanned*` | Escopo, serviços, sistemas e horas previstas |
| `Omie*` / `IntegrationSyncRun` | Espelho de dados do Omie e execuções de sincronização |

**Romaneio / Estoque / Equipamentos / EPI**
| Modelo | Descrição |
|---|---|
| `Romaneio` / `RomaneioItem` / `RomaneioChecklist` / `RomaneioCatalog*` | Romaneios, itens, checklist e catálogo |
| `StockItem` / `StockCategory` / `StockBatch` / `StockMovement` | Estoque, lotes e movimentações |
| `Equipment` / `EquipmentCategory` / `EquipmentAttachment` / `CalibrationCertificate` | Equipamentos, documentação e calibração |
| `CompanyEquipment` / `RdoEquipmentSlot` / `EquipmentNotification*` | Equipamentos da empresa, slots no RDO e notificações |
| `EpiRecord` / `EpiCatalogItem` / `EpiSignatureRequest(+AuditLog)` | Fichas, catálogo e assinatura de EPI |
| `Unit` / `Manometer` / `ParticleCounter` / `InhibitionSystem` / `InhibitionVessel` | Cadastros de apoio aos relatórios |

**Contas, Privacidade e Infraestrutura**
| Modelo | Descrição |
|---|---|
| `User` / `UserSession` / `ModuleRole` | Usuário, sessões JWT e papéis por módulo |
| `Collaborator` / `PasswordResetToken` / `EmailChangeToken` | Colaborador e tokens de conta |
| `DataSubjectRequest*` / `DataRetentionRun` | Solicitações LGPD e retenção de dados |
| `JobRun` / `JobLock` | Execução e trava de jobs em background |

### Comandos Prisma

```bash
npm run prisma:generate   # Regenera o client após mudanças no schema
npm run prisma:migrate    # Cria e aplica nova migration (dev)
npm run prisma:deploy     # Aplica migrations pendentes (produção)
npm run prisma:seed       # Popula dados iniciais
```

---

## Geração de PDF

Os PDFs são gerados a partir de templates DOCX localizados em `Modelos/`, processados pelo LibreOffice em modo headless.

- **Linux (produção/container):** LibreOffice instalado no `Dockerfile` via `apt-get install libreoffice-writer`.
- **Windows (desenvolvimento):** LibreOffice ou Microsoft Word via COM/PowerShell.
- A variável `LIBREOFFICE_BINARY` aponta para o executável (`soffice` ou caminho absoluto).

---

## Assinatura Interna

Relatórios com status `APPROVED` são assinados pelo sistema interno.

- A solicitação individual usa `POST /api/rdo/reports/:id/request-signature`.
- A identidade do signatário é validada pelos e-mails configurados no projeto.
- Evidências e hash do PDF final ficam registrados para auditoria.
- Relatórios antigos já assinados pela ZapSign continuam disponíveis para download do PDF assinado; tokens ZapSign pendentes são reconciliados em background.
- A liberação de EPI usa um fluxo de assinatura próprio, por link público com token.

O módulo **Assinaturas** é independente do fluxo interno de RDO: recebe PDFs avulsos, cria convites próprios e gera um PDF final com evidências. O proprietário acessa `/assinaturas`; o assinante usa `/assinaturas/assinar#convite=...`; a autenticidade do concluído é consultada em `/validar-documento/:codigo` sem revelar e-mail, IP ou User-Agent.

---

## Scripts Utilitários

```bash
# Testar configuração SMTP
cd backend && node scripts/test-email.js

# Importar dados mestres (equipamentos, unidades, etc.)
npm run import:master-data
npm run import:collaborators-csv
npm run import:inhibition-systems-csv

# Cargos e componentes comerciais
npm run normalize:collaborator-roles
npm run backfill:commercial-components

# Integração Omie
npm run omie:explore
npm run omie:sync

# Romaneio / equipamentos
npm run sync:romaneio-catalog
npm run backfill:equipment
npm run backfill:equipment-notifications
npm run backfill:equipment-technical

# Assinaturas e arquivos de relatório
npm run migrate:signatures
npm run backfill:report-attachments
npm run audit:report-files
npm run repair:report-file-paths

# Retenção de dados (LGPD)
npm run retention:dry-run
npm run retention:apply
```

---

## Rotas da API

Prefixo base: `/api`. As rotas do módulo de relatórios são servidas tanto sob `/api/rdo/*` quanto na raiz (`/api/*`) por compatibilidade.

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/auth/login` · `/auth/logout` | Autenticação |
| `GET/POST` | `/rdo/projects` · `GET/PATCH/DELETE /rdo/projects/:id` | Projetos |
| `GET/POST` | `/rdo/reports` · `GET/PATCH/DELETE /rdo/reports/:id` | Relatórios |
| `POST` | `/rdo/reports/:id/request-signature` | Solicitar assinatura individual |
| `GET/POST` | `/assinaturas/documentos` · `GET/PATCH/DELETE /assinaturas/documentos/:id` | Acervo e ciclo de vida de documentos avulsos |
| `PUT/POST` | `/assinaturas/documentos/:id/assinantes` · `/campos` · `/publicar` | Preparação e publicação para assinatura |
| `GET/POST` | `/assinaturas/publico` · `/publico/assinar` · `/publico/pdf` | Fluxo público via `X-Signature-Token` (sem segredo na URL da API) |
| `GET` | `/assinaturas/validar/:code` | Validação pública do PDF concluído |
| `GET/POST` | `/rdo/dds-themes` | Temas de DDS |
| `GET` | `/rdo/statistics/projects` · `/rdo/statistics/projects/export` · `/rdo/statistics/overview` | Estatísticas de RDOs |
| `GET/POST` | `/rdo/statistics/allocation-report` (+ `/pdf`, `/send`, `/recipients`) | Relatório de alocação |
| `GET/POST` | `/rdo/surveys` · `GET /rdo/surveys/dashboard` | Pesquisas e dashboard NPS |
| `GET/POST` | `/rdo/surveys/public/:token` (+ `/respond`) | Pesquisa pública |
| `GET/PUT` | `/rdo/surveys/questions` · `PATCH /rdo/surveys/:id/follow-up` | Perguntas e follow-up |
| `GET/POST` | `/rdo/project-segments` | Segmentos de cliente |
| `GET/POST` | `/acompanhamento/comercial/import` · `/imports` | Importação comercial |
| `POST` | `/webhooks/projects` | Recebimento autenticado e idempotente de projeto externo para revisão manual |
| `GET` | `/acompanhamento/comercial/dashboard` · `/projetos-cards` · `/sede` · `/pendencias` | Dashboards do Acompanhamento |
| `GET/POST/PATCH/DELETE` | `/acompanhamento/comercial/projetos/:id/...` | Detalhe, avanço, cronograma, escopo, custos manuais e revisões |
| `GET/PUT/POST` | `/acompanhamento/custo/perfis` · `/cargos` · `/config` · `/simular` · `/categorias-omie` | Parâmetros e simulação de custo |
| `POST/GET` | `/acompanhamento/ponto/import` · `/imports` · `/colaboradores` · `/vincular` | Importação do ponto |
| `GET/POST/PUT/DELETE` | `/romaneio` (+ `/drafts`, `/catalog`, `/notifications`, `/:id/pdf`, `/:id/checklist/pdf`) | Romaneios |
| `GET/POST/PUT/PATCH/DELETE` | `/estoque/categorias` · `/itens` · `/movimentacoes` · `/lotes` · `/resumo` | Estoque |
| `GET/POST/PUT/DELETE` | `/equipamentos` (+ `/categories`, `/rdo-slots`, `/notifications`, `/:id/technical-doc`) | Equipamentos |
| `GET/POST/PUT/DELETE` | `/epi/collaborators` · `/catalog` · `/records` · `/public-sign/:token` | Liberação de EPI |
| `GET/POST/PATCH` | `/privacy/requests` (+ `/me/data-export`, `/me/delete-request`) | Solicitações LGPD |
| `GET/POST` | `/operations/status` · `/operations/client-errors` | Monitoramento operacional |
| `GET/POST` | `/admin/accounts` · `/users` · `/rdo/collaborators` | Contas, usuários e colaboradores |
