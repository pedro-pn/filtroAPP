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

backend/prisma/schema.prisma e migrations/; backend/src/lib/databooks/{policy,sources,service,package,presentation,jobs}.js; backend/src/routes/resources/databooks.js; frontend/src/api/databooks.ts; frontend/src/components/projects/ProjectDatabookDialog.tsx; shared/schemas/databooks.js; backend/test/databooks*.test.js; frontend/test/databook*.test.mjs.

## Modelo do documento (correção de 09/10/2026)

O PDF segue a identidade do modelo aprovado `modelo-databook-5815-sintese.pdf`, conferido visualmente a partir do próprio PDF e do HTML original. `presentation.js` concentra paleta, medidas A4, tipografia, logo existente, cabeçalhos/rodapés, quadros, tabelas com continuação e galeria de duas colunas. `package.js` monta as seções e adiciona os anexos integrais; FDSs seguem a síntese, depois relatórios técnicos, RDOs e documentos técnicos. Referências e links recebem as páginas definitivas após a composição. Nenhum overlay altera páginas importadas. Não foi adicionada dependência ou serviço de renderização.

TAGs, quantidades declaradas, método, inspeção e etapas são campos técnicos explicitamente permitidos de `specialConditions.serviceData` e `ReportService.extraData`. Não há inferência de TAGs distintas, cumprimento de escopo ou aceite formal. Snapshots antigos continuam renderizáveis com “A confirmar” para campos ausentes; novas revisões recebem os campos atuais. A comparação de fontes mantém os formatos canônico e anterior, sem alterar hashes ou snapshots persistidos. O manifesto identifica o template e as páginas da síntese/seções. PDFs já concluídos permanecem intactos.

## Complexity Tracking

Sem violações. Não adicionar serviço/fila/dependência externa. Preparação ocorre no browser; snapshot persiste ao solicitar emissão. Não há publicação automática para clientes nem ciclo com encerramento de projeto.
