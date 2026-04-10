# Filtrovali

Base inicial para levar o protótipo `filtrovali_app_v4.html` para produção.

## Estrutura

- `filtrovali_app_v4.html`: protótipo atual
- `backend/`: API REST com `Express + Prisma + PostgreSQL`

## Backend

### Stack

- Node.js
- Express
- Prisma
- PostgreSQL

### Recursos já modelados

- colaboradores
- projetos
- sequenciais de relatório por projeto
- equipamentos
- unidades
- manômetros
- contadores de partícula

### Como subir

#### 1. Subir PostgreSQL com Docker

```bash
docker compose up -d
```

#### 2. Configurar ambiente

1. Copie `backend/.env.example` para `backend/.env`
2. Ajuste `DATABASE_URL`

#### 3. Instalar dependências

```bash
cd backend
npm install
```

#### 4. Gerar client do Prisma

```bash
npm run prisma:generate
```

#### 5. Rodar migration

```bash
npm run prisma:migrate
```

#### 6. Popular dados iniciais

```bash
npm run prisma:seed
```

#### 7. Subir a API

```bash
npm run dev
```

## Próximos passos

1. Integrar o HTML com a API REST
2. Substituir `localStorage` por chamadas HTTP
3. Adicionar autenticação
4. Modelar relatórios e serviços executados
5. Implementar upload de assinatura, anexos e imagens
