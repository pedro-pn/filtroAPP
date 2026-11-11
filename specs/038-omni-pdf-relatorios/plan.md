# Implementation Plan: Documentos para o Omni

**Branch**: `feat/omni-pdf-relatorios` | **Date**: 2026-11-11 | **Spec**: [spec.md](spec.md)

## Summary

Adicionar download de PDF pronto e metadados opcionais à API existente. Extrair seleção e validação de cache para `lib/reports/`, compartilhar precedência com a tela, abrir arquivos gerenciados com hash e limite antes da leitura. Não compor anexos nem gerar documentos no pedido. Contato corporativo exige escopo pessoal independente.

## Technical Context

**Language/Version**: JavaScript ESM / Node.js do projeto.
**Primary Dependencies**: Express, Zod, Prisma e pipeline existente pdf-lib/DOCX→PDF.
**Storage**: PostgreSQL e roots uploadDir/reportsDir; sem migration.
**Testing**: node:test em backend/test e architecture:check na raiz.
**Target Platform**: Backend Linux.
**Project Type**: API web existente.
**Performance Goals**: Pedido limitado a 15s; sem rede externa/conversão; listagem sem ler PDFs.
**Constraints**: 50 MiB, sem symlinks, recorte de projeto, cotas, aditividade, sem aumentar reports.js.
**Scale/Scope**: Uma operação de download, dois escopos, dois recursos enriquecidos.

## Constitution Check

PASS antes e depois do desenho: sem servidor/deploy; pt-BR nos textos; Zod em params/query; sem schema novo; testes de regra de negócio; backend sem alteração visual, navegação ou tutorial aplicáveis. Fronteira em lib/reports e lib/api-credentials. Workflow em branch feat e spec 038. Nenhuma exceção necessária.

## Project Structure

- `backend/src/lib/reports/pdf-download-source.js`: precedência compartilhada.
- `backend/src/lib/reports/pdf-cache.js`: fingerprint/metadados compartilhados.
- `backend/src/lib/reports/integration-pdf.js`: leitura pronta e validação de integridade.
- `backend/src/lib/api-credentials/`: catálogo, projeção condicional, autorização e download.
- `backend/test/integration-report-pdf.test.js`: regras e negativos.
- `specs/015-api-token-playground/contracts/openapi.yaml`: contrato 1.14.0.

## Decisions and dependencies

US1 estabelece escolha compartilhada e leitura segura. US2 reutiliza seleção para indicador barato, sem prometer validação de arquivo. US3 é independente, usa conta vinculada e apenas e-mail válido @filtrovali.com.br. E-mails da conta são preferidos aos contatos legados do cadastro.

## Complexity Tracking

Sem violações. Limitações autorizadas: documento base/final sem anexos nem sobreposição de assinatura parcial; ZapSign apenas do cache local; sem disparo automático de geração. Ausência retorna 409 e Retry-After, preparação pelo fluxo existente. Listagem cobre referências persistidas de versões, com download como verificação definitiva; não consulta cache de disco.
