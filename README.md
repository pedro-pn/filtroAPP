# Filtrovali

Aplicação Filtrovali com frontend React, API Express e PostgreSQL.

## Estrutura

- `frontend/`: SPA React com Vite
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
