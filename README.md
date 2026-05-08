# Filtrovali — Sistema de Relatórios

Aplicação web para gestão de projetos de campo e relatórios técnicos da Filtrovali. Contempla criação, aprovação e assinatura digital de relatórios, com portal de acesso para clientes, geração de PDFs e envio de notificações por e-mail.

## Índice

- [Visão Geral](#visão-geral)
- [Stack](#stack)
- [Estrutura do Repositório](#estrutura-do-repositório)
- [Perfis de Acesso](#perfis-de-acesso)
- [Funcionalidades](#funcionalidades)
- [Tipos de Relatório](#tipos-de-relatório)
- [Configuração do Ambiente](#configuração-do-ambiente)
  - [Desenvolvimento local (Node direto)](#desenvolvimento-local-node-direto)
  - [Desenvolvimento local (Docker)](#desenvolvimento-local-docker)
- [Deploy em Produção](#deploy-em-produção)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Banco de Dados](#banco-de-dados)
- [Geração de PDF](#geração-de-pdf)
- [Integração ZapSign](#integração-zapsign)
- [Scripts Utilitários](#scripts-utilitários)

---

## Visão Geral

O sistema centraliza o ciclo completo dos relatórios técnicos de campo:

1. Colaborador cria o relatório no campo.
2. Gestor revisa e aprova.
3. Cliente acessa o portal, visualiza e pode reprovar para revisão.
4. Relatório aprovado segue para assinatura digital via ZapSign.
5. Relatório assinado fica disponível para download em PDF.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + TypeScript + Vite 6 |
| Estado / Fetching | TanStack Query v5 + Zustand |
| Formulários | React Hook Form + Zod |
| Roteamento | React Router v7 |
| Backend | Node.js 22 + Express 4 |
| ORM | Prisma 6 |
| Banco | PostgreSQL 16 |
| E-mail | Nodemailer (SMTP / Microsoft Exchange / Office 365) |
| PDF | LibreOffice headless (Linux) |
| Assinatura digital | ZapSign |
| Proxy / SSL | Nginx + Let's Encrypt |
| Containers | Docker + Docker Compose |

---

## Estrutura do Repositório

```
.
├── backend/
│   ├── prisma/               # Schema, migrations e seed
│   ├── scripts/              # Utilitários de manutenção
│   ├── src/
│   │   ├── config/           # Variáveis de ambiente
│   │   ├── lib/              # Lógica de negócio (email, PDF, ZapSign, etc.)
│   │   ├── middleware/       # Auth, requireManager, requireCoordinator
│   │   └── routes/resources/ # Rotas REST (projects, reports, auth, users…)
│   ├── .env.example
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── api/              # Clientes HTTP por recurso
│   │   ├── auth/             # AuthContext, PrivateRoute, RoleRoute
│   │   ├── components/       # Componentes compartilhados
│   │   ├── hooks/            # React Query hooks
│   │   ├── pages/            # Páginas por perfil (gestor, coordenador, cliente…)
│   │   ├── store/            # Zustand stores
│   │   └── utils/
│   └── .env.example
├── deploy/
│   ├── nginx/                # Dockerfile do Nginx + default.conf
│   ├── PRODUCTION.md         # Guia detalhado de produção
│   ├── backup-prod.sh
│   └── restore-prod.sh
├── Modelos/                  # Templates DOCX para geração de relatórios
├── docker-compose.yml        # Apenas PostgreSQL (dev Node direto)
├── docker-compose.local.yml  # PostgreSQL + backend em container (dev)
└── docker-compose.prod.yml   # Produção: PostgreSQL + backend + Nginx
```

---

## Perfis de Acesso

| Perfil | Descrição |
|---|---|
| **MANAGER** (Gestor) | Acesso total: gerencia projetos, colaboradores, usuários, aprova e solicita assinatura de relatórios |
| **COORDINATOR** (Coordenador) | Visão gerencial similar ao gestor, com restrições específicas em edição |
| **COLLABORATOR** (Colaborador) | Cria e edita relatórios de campo; visibilidade limitada aos projetos vinculados |
| **CLIENT** (Cliente) | Visualiza e avalia (aprova/reprova) os relatórios dos seus projetos via portal dedicado |

Cada perfil acessa uma rota raiz diferente: `/gestor`, `/coordenador`, `/cliente` ou `/home`.

---

## Funcionalidades

### Projetos
- Cadastro com dados do cliente (nome, CNPJ, e-mails principal e CC, signatários)
- Arquivamento e desarquivamento
- Controle de visibilidade (visível a colaboradores / somente gestor)
- Provisionamento automático de conta de cliente ao associar e-mail

### Relatórios
- Criação assistida com rascunho automático
- Múltiplos tipos (ver seção abaixo)
- Fluxo de status: `PENDING → APPROVED → SIGNED`
- Retorno para revisão (`RETURNED`)
- Download individual ou em lote (ZIP) em PDF
- Anexos de fotos e arquivos
- Numeração sequencial por tipo e projeto

### Assinatura Digital (ZapSign)
- Solicitação de assinatura para relatórios aprovados
- Processamento em lote
- Webhook para atualização automática de status ao assinar

### Portal do Cliente
- Acesso sem VPN via usuário CNPJ
- Visualização de relatórios dos projetos vinculados
- Aprovação ou reprovação com justificativa
- Notificação por e-mail ao gestor quando reprovado

### E-mails Automáticos
- Boas-vindas ao criar conta de cliente
- Novo projeto vinculado
- Relatório aprovado disponível para avaliação
- Relatório reprovado pelo cliente (notifica gestor)
- Relatório revisado e disponível para nova avaliação
- Recuperação de senha

### Usuários e Colaboradores
- Gerenciamento de usuários e colaboradores pelo gestor
- Reenvio de credenciais de acesso ao cliente
- Alteração de senha via token de recuperação

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
- Domínio: `relatorios.filtrovali.com.br`

---

## Variáveis de Ambiente

### Backend (`backend/.env`)

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | Sim | Connection string PostgreSQL |
| `APP_URL` | Sim | URL base pública (usado em links de e-mail) |
| `ALLOWED_ORIGIN` | Sim | Origem(s) CORS permitida(s), separadas por vírgula |
| `SMTP_HOST` | Sim | Servidor SMTP (ex: `smtp.office365.com`) |
| `SMTP_PORT` | Sim | Porta SMTP (padrão: `587`) |
| `SMTP_SECURE` | Não | `true` para SSL direto (porta 465) |
| `SMTP_USER` | Sim | Usuário SMTP |
| `SMTP_PASS` | Sim | Senha ou App Password |
| `SMTP_FROM` | Sim | Remetente (ex: `Filtrovali <no-reply@…>`) |
| `ASSETS_DIR` | Não | Diretório de assets estáticos |
| `REPORTS_DIR` | Não | Diretório de relatórios gerados |
| `LIBREOFFICE_BINARY` | Não | Caminho do LibreOffice (padrão: `soffice`) |
| `ZAPSIGN_API_TOKEN` | Não | Token da API ZapSign |
| `ZAPSIGN_WEBHOOK_SECRET` | Não | Secret para validação do webhook ZapSign |
| `ZAPSIGN_ORGANIZATION_ID` | Não | ID da organização ZapSign |
| `SMTP_TEST_DEST` | Não | E-mail destino do script `test-email.js` |

### Frontend (`frontend/.env`)

| Variável | Padrão | Descrição |
|---|---|---|
| `VITE_API_BASE_URL` | `/api` | Base URL da API (prefixo das chamadas HTTP) |
| `VITE_ASSETS_BASE_URL` | _(vazio)_ | Base URL para assets estáticos do backend |

---

## Banco de Dados

O schema Prisma (`backend/prisma/schema.prisma`) define os modelos principais:

| Modelo | Descrição |
|---|---|
| `Project` | Projeto de campo com dados do cliente e configurações |
| `Report` | Relatório técnico com status e dados operacionais |
| `ReportDraft` | Rascunho de relatório |
| `ReportAttachment` | Anexos de relatórios |
| `Collaborator` | Técnico de campo |
| `User` | Usuário do sistema (todos os perfis) |
| `UserSession` | Sessões JWT ativas |
| `PasswordResetToken` | Tokens de recuperação de senha |
| `ClientReportReview` | Registro de aprovação/reprovação pelo cliente |
| `Equipment` / `Unit` / `Manometer` / `ParticleCounter` | Equipamentos utilizados nos relatórios |

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

## Integração ZapSign

Relatórios com status `APPROVED` podem ter assinatura digital solicitada via ZapSign.

- A solicitação pode ser individual (`POST /api/reports/:id/request-signature`) ou em lote (`POST /api/reports/batch-request-signature`).
- O ZapSign notifica o backend via webhook (`POST /api/webhooks`) quando o documento é assinado, atualizando o status para `SIGNED`.
- A identidade do signatário é validada: somente e-mails configurados em `clientSigners` do projeto podem assinar.
- O secret do webhook é configurado via `ZAPSIGN_WEBHOOK_SECRET`.

---

## Scripts Utilitários

```bash
# Testar configuração SMTP
cd backend && node scripts/test-email.js

# Importar dados mestres (equipamentos, unidades, etc.)
npm run import:master-data

# Migrar assinaturas para formato data URL
npm run migrate:signatures
```
