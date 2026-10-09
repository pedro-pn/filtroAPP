# Implementation Plan: Databook por etapa

**Branch**: feat/project-databook | **Date**: 2026-10-08 | **Spec**: [spec.md](spec.md)

## Summary

Módulo dedicado de databook com período inclusivo, seleção de evidências, emissão assíncrona e revisões imutáveis. Fontes factuais do exemplo vêm do inventário já coletado em produção. Sem acesso a banco local para inferir fatos do projeto.

## Technical Context

JavaScript ESM Node/Express, Prisma/PostgreSQL; React/TypeScript, Query, RHF/Zod; pdf-lib, sharp e adm-zip já instalados. Armazenamento privado sob uploadDir/Databooks. Uma tarefa por revisão, recuperável com lease/token e heartbeat. PDF oficial de relatórios via exports mínimos no router existente. Limite explícito de pacote para controlar uso de memória; processamento sequencial, fotos otimizadas. Testes node:test backend e frontend, build TypeScript/Vite, validação de migração e pacote com PDFs reais de produção copiados.

## Constitution Check

Todos os gates atendidos antes e depois do desenho. Não executar servidor, Docker, banco de produção ou deploy. Migração versionada, validação estrita Zod/RHF, testes de negócios e autorização. UI pt-BR com kit DS/tokens, modal de rodapé fixo, listas móveis e query param de navegação. Fotos: padrão compartilhado de Pointer Events, ghost, posição, cancelamento e teclado. Novidade Driver.js expira 18/10/2026. Nenhuma exceção de identidade visual.

| Surface | Reference | Components | States/reorder | Navigation/tutorial | Overflow |
|---|---|---|---|---|---|
| Databook | ProjectDocumentForm/UploadField/Modal | DS Field/Input/Button/Alert/Skeleton | erros específicos, handle/ghost/cancel/setas | databook query param; Driver.js por usuário | grids minmax(min(100%,...)); ações wrap |
| Atalhos | GestorPage/ProjectDetailDashboard/ProjectWorkflowModal | botões existentes do contexto | estado de leitura separado de emissão | mesmo diálogo compartilhado | quebra de textos e ações |

## Project Structure

backend/prisma/schema.prisma e migrations/; backend/src/lib/databooks/{policy,sources,service,package,jobs}.js; backend/src/routes/resources/databooks.js; frontend/src/api/databooks.ts; frontend/src/components/projects/ProjectDatabookDialog.tsx; shared/schemas/databooks.js; backend/test/databooks*.test.js; frontend/test/databook*.test.mjs.

## Complexity Tracking

Sem violações. Não adicionar serviço/fila/dependência externa. Preparação ocorre no browser; snapshot persiste ao solicitar emissão. Não há publicação automática para clientes nem ciclo com encerramento de projeto.
