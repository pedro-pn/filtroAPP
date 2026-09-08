# Implementation Plan: Relatórios de Manutenção e Produção

**Branch**: `feat/maintenance-production-reports` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/014-maintenance-production-reports/spec.md`

## Summary

Adicionar um módulo próprio “Manutenção e produção” com quatro abas controladas pelas permissões existentes: manutenção (criação e histórico de RDOs 5002/manutenções avulsas), produção (criação e histórico de RDOs 5004), programação preventiva por equipamento e histórico consolidado de manutenções aprovadas, com busca e PDF. Revisores também precisam da permissão da área, enquanto o papel de aprovação permanece separado. O RDO de obra volta a ser a única opção do fluxo tradicional. A solução preserva o domínio, formulários, aprovação, documentos, histórico por equipamento e indicadores já implementados, acrescentando consultas globais paginadas e uma composição de navegação responsiva sem sobreposição.

## Technical Context

**Language/Version**: Node.js ES modules; TypeScript 5.8 no frontend; JavaScript no backend

**Primary Dependencies**: Express 5.2, React 19.2, Vite 6.3, Prisma 7.9, Zod 4.4, React Hook Form 7.81, TanStack Query 5.101, driver.js 1.8, AdmZip, xmldom e pipeline DOCX→PDF existente

**Storage**: PostgreSQL via Prisma; arquivos gerenciados sob o diretório de uploads configurado no backend

**Testing**: `node --test` em `backend/test/*.test.js` e `frontend/test/*.test.mjs`; build TypeScript/Vite; ESLint

**Target Platform**: Aplicação web responsiva, backend Linux, uso prioritário em celulares de campo

**Project Type**: Aplicação web com frontend e backend separados no mesmo repositório

**Performance Goals**: Listagens, histórico e indicadores percebidos em até 3 segundos no volume-alvo; aprovação idempotente sem duplicar PDFs

**Constraints**: pt-BR, mobile-first, Zod nas duas pontas, migration Prisma, sem operação de servidor/deploy, sem documentos para produção e sem documento geral para RDO 5002

**Scale/Scope**: Até 50 mil manutenções, 100 mil itens de limpeza química, 10 perfis iniciais, 10 fotos por manutenção e terceiros ilimitados; histórico global paginado com 20 itens e programação paginada com 50 equipamentos por página

## Constitution Check

*GATE inicial e pós-design: PASS.*

- Nenhum comando de servidor, Docker, deploy ou manutenção de ambiente será executado. A entrega conterá apenas código, migration e instruções de validação local.
- Todas as novas superfícies serão pt-BR e mobile-first. Grades usarão largura encolhível, ações empilharão em telefone, detalhes tabulares terão cartões mobile e não haverá rolagem horizontal de página.
- Payloads serão validados por Zod no backend; os formulários novos usarão React Hook Form com resolver Zod.
- Toda alteração de banco estará em uma migration Prisma versionada. O backfill de permissão de obra será idempotente dentro da migration.
- Regras de permissão, jornada, transição, aprovação, supervisor, estatísticas e documento terão testes em `backend/test`.
- A interface reutilizará componentes de `frontend/src/components/ui/`, tokens globais e estados `.field-group.field-invalid`, `aria-invalid` e `.field-error`.
- Não há reordenação nos formulários operacionais. O editor inicial de perfis usará controles explícitos subir/descer, sem implementar uma interação de arraste parcial.
- O novo módulo terá tutorial permanente de primeira entrada. A campanha temporária será centralizada, por usuário/navegador, com data registrada em código em 2026-09-04 e expiração global em 2026-09-14.
- Aba/filtros/página do módulo, etapa do formulário, seção da configuração, equipamento e período da Sede serão refletidos na URL quando representarem navegação compartilhável.
- Não se aplica exceção de identidade portada.

**Required visual evidence when frontend changes are present:**

| Surface | Existing reference audited | Shared component/classes | Field/dropdown states covered | Reorder drag/drop pattern | Navigation persistence | Novelty/tutorial plan | Mobile/desktop overflow evidence |
|---------|----------------------------|--------------------------|-------------------------------|---------------------------|------------------------|------------------------|----------------------------------|
| Módulo, abas, programação e formulários operacionais | Shell largo e abas dos módulos atuais, `MaintenanceProductionPage.tsx` e formulário operacional existente | Registro central, `Button`, `SearchBar`, `Skeleton`, `ConfirmDialog`, toast, `field-group` | vazio, foco, disabled, inválido e erro abaixo do campo | N/A | `?tab=`, `?q=`, `?page=`, `?categoria=`, `?prazo=` e `?etapa=` | Tutorial permanente de primeira entrada e novidade até 2026-09-14 | Uma coluna a 360 px; tabelas viram cards; ações e abas contidas em grade 2×2 |
| Configuração e histórico | `frontend/src/pages/equipamentos/EquipamentosPage.tsx`, `EquipmentCard.tsx`, `TechnicalDataModal.tsx` | shell `.equip-page`, `Modal`, `Button`, `ConfirmDialog`, `SearchBar`, `Skeleton` | combobox do supervisor e editor de perfil com estados completos | Controles explícitos de ordem; nenhum drag parcial | `?section=maintenance&profile=...` e equipamento/aba na URL | Mesma campanha | Tabela desktop convertida em cards mobile; nomes e arquivos truncam/quebram |
| Indicadores Sede | `frontend/src/components/projects/SedeCostsBoard.tsx` | filtros e cards `acp-*`, `Skeleton`, tokens globais | período usa controles globais | N/A | filtros de período em query params | Mesma campanha | Grade shrink-safe e números longos contidos |
| Contas administrativas | `frontend/src/pages/admin/AdminAccountsPage.tsx` | `Modal`, `Button`, checkboxes e `field-group` existentes | três permissões independentes e disabled para CLIENT | N/A | N/A | Menção no tutorial somente para administradores | Checkboxes empilham e não alargam modal |

O componente fonte do RDO atual tem dívida de tamanho, mas seu cálculo e seleção de colaboradores são estáveis. O plano não adicionará ramificações profundas nele: manterá o formulário de obra e delegará manutenção/produção a um componente separado selecionado por um wrapper pequeno.

## Project Structure

### Documentation (this feature)

```text
specs/014-maintenance-production-reports/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/api.md
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── prisma/
│   ├── schema.prisma
│   └── migrations/<timestamp>_maintenance_production_reports/migration.sql
├── src/
│   ├── lib/
│   │   ├── report-emission-permissions.js
│   │   ├── operational-reports.js
│   │   ├── maintenance-attachments.js
│   │   ├── maintenance-docx.js
│   │   └── acompanhamento/sede-operational-metrics.js
│   └── routes/
│       ├── index.js
│       └── resources/{operational-reports,equipamentos,users,reports,acompanhamento-comercial}.js
└── test/{report-emission-permissions,operational-reports,maintenance-docx,sede-operational-metrics}.test.js

frontend/
├── src/
│   ├── api/{operationalReports,equipamentos,acompanhamentoComercial}.ts
│   ├── auth/reportPermissions.ts
│   ├── components/reports/{OperationalReportsNovelty,MaintenanceHistoryTable}.tsx
│   ├── components/projects/SedeOperationalCards.tsx
│   ├── pages/collaborator/{NewReportPage,OperationalReportFormPage}.tsx
│   ├── pages/MaintenanceProductionPage.tsx
│   ├── pages/equipamentos/EquipamentosPage.tsx
│   ├── schemas/operationalReport.ts
│   ├── styles/operational-reports.css
│   └── types/auth.ts
└── test/report-permissions.test.mjs
```

**Structure Decision**: Criar um módulo frontend próprio registrado no Hub e manter Equipamentos como dono da configuração, inclusive o intervalo preventivo por categoria, e do histórico individual. A rota backend operacional continua isolada do pipeline documental legado e ganha endpoints de histórico consolidado e programação derivada. `Report` permanece a fonte de jornada, status e sequência dos RDOs 5002/5004; `MaintenanceRecord` aprovado é a fonte da última manutenção. Como a funcionalidade ainda não chegou à produção, o seletor provisório pode ser removido sem janela de compatibilidade visual; links de rascunho continuam abrindo diretamente o editor pelo tipo já persistido.

## Complexity Tracking

Sem violações da constituição. As novas entidades são necessárias para evitar colocar checklist, documentos, terceiros e quantidades em JSON sem integridade relacional; a reutilização de `Report` limita a duplicação aos dados estritamente específicos.
