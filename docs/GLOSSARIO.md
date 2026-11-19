# Glossário do domínio

Termos do negócio usados no filtroAPP, com onde cada um vive no código. Quando o
nome no código difere do termo falado, os dois aparecem. Itens marcados com
**(confirmar)** foram deduzidos do código e precisam de validação de quem opera o
processo. Ao criar um termo novo ou mudar o significado de um existente, atualize
este arquivo no mesmo PR (pilar 13.7/13.8).

## Relatórios

| Termo | Significado | Onde vive |
|---|---|---|
| **RDO** | Relatório Diário de Obra: registro diário do trabalho de campo de um projeto (equipe, serviços executados, medições, fotos, ocorrências, assinaturas). É a base de quase todos os indicadores. | `ReportType.RDO` (`backend/prisma/schema.prisma`), `backend/src/routes/resources/reports.js`, `frontend/src/pages/collaborator/NewReportPage.tsx` |
| **RDO de manutenção / de produção** | Variantes do RDO para serviços de manutenção de equipamentos e de produção. | `ReportType.RDO_MAINTENANCE`, `ReportType.RDO_PRODUCTION` |
| **RLQ** | Relatório de Limpeza Química. Traz as etapas e os produtos químicos usados; alimenta o Data Book (FDS dos produtos). | `ReportType.RLQ`, `frontend/src/pages/efetivo/components/QualityDocumentModels.tsx` |
| **RTP** | Relatório de Teste de Pressão. | `ReportType.RTP`, idem |
| **RCPU** | Relatório de Contagem de Partículas e Umidade (análise do óleo). | `ReportType.RCPU`, idem |
| **RLM** | Relatório de limpeza mecânica. | `ReportType.RLM` |
| **RLF / RLI** | Relatórios exclusivos do **serviço de inibição** (ver *Inibição*): RLF registra a etapa de lavagem com água (flushing da inibição) e RLI a circulação de inibidor de corrosão. Não confundir com os serviços de flushing primário e secundário. | `ReportType.RLF`, `ReportType.RLI` |
| **Relatório liberado** | Relatório revisado e liberado para o cliente ver/baixar. | e-mails em `backend/src/lib/email-templates.js` |
| **Revisar relatórios** | Permissão extra (`REVIEW_REPORTS`) que deixa o coordenador editar e aprovar RDOs. | `RdoExtraPermission` |
| **Data Book** | Dossiê final do projeto em PDF: relatórios, certificados, FDS e revisões, gerado pelo gerador Python. | `backend/databook/`, `backend/src/routes/resources/databook.js`, `docs/DATABOOK_*.md` |
| **FDS** | Ficha de Dados de Segurança de um produto químico; vinculada a itens do Estoque e citada no RLQ/Data Book. | `docs/DATABOOK_MAPA_DE_CAMPOS.md` |
| **Adequar para relatório** | Botão que reescreve as anotações do RDO em linguagem de relatório usando a OpenAI. | `backend/src/lib/anotacoes/adequar.js`, `docs/ADEQUAR_ANOTACOES.md` |

## Projeto, proposta e acompanhamento

| Termo | Significado | Onde vive |
|---|---|---|
| **Projeto** | Contrato/serviço com o cliente, identificado por número (ex.: 5719). Agrupa relatórios, equipe, custos e documentos. | `model Project` |
| **managerOnly** | Projeto visível só para gestores/admin; a extensão Prisma esconde de quem não tem acesso em todas as consultas. | `Project.managerOnly`, `backend/src/lib/projects/access-scope.js` |
| **Proposta / Proposta adicional (aditivo)** | Proposta comercial que originou o projeto e os acréscimos de escopo contratados depois (aditivos). Vêm do ComercialAPP. | `docs/comercialapp-bridge.md`, `shared/modules/additional-proposal-metrics.js` |
| **Acompanhamento** | Módulo de gestão do projeto: avanço físico, custos, horas previstas x realizadas, cronograma, faturamento. | `backend/src/lib/acompanhamento/`, `frontend/src/pages/acompanhamento/` |
| **Medição** | Quantidade executada de um serviço (metros, litros ou unidades) registrada nos relatórios; base do avanço e do faturamento. | `shared/modules/mechanical-measurement.js`, `model ProjectWorkflowMeasurement` |
| **Conciliação (por medição)** | Tela do Acompanhamento que vincula quantitativos importados às medições dos relatórios. | `docs/conciliacao-por-medicao.md`, `ReportMeasurementLink` |
| **Sistemas / Inibição** | **Inibição**: serviço específico de um cliente, feito nos sistemas dele, em duas etapas — lavagem com água (flushing) e circulação de inibidor de corrosão — registradas nos relatórios RLF e RLI. **Sistemas**: os sistemas do cliente atendidos no serviço. | `backend/scripts/import-inhibition-systems-csv.js`, `report-pdf.js` (`Flushing/Inibição`) |
| **Flushing** | Serviços de flushing primário e secundário: circulação de óleo em alta vazão para limpar tubulações de um sistema. Diferente da lavagem com água que faz parte do serviço de *Inibição* (RLF). | `report-pdf.js`, serviços históricos |
| **Serviços históricos** | Serviços executados antes do sistema, lançados para compor o histórico do cliente. | `docs/SERVICOS_HISTORICOS.md` |
| **Meta semanal** | Meta de avanço da semana por projeto, mostrada no topo do Acompanhamento e do Efetivo. | `shared/modules/mission-weekly-progress.js` |

## Efetivo (pessoas e alocação)

| Termo | Significado | Onde vive |
|---|---|---|
| **Efetivo** | Módulo de planejamento da força de trabalho: quem está em qual projeto, quando, e o custo disso. | `backend/src/lib/efetivo/`, `frontend/src/pages/efetivo/` |
| **Colaborador** | Funcionário cadastrado (vem do Conecta RH). Pode ou não ter conta de usuário. | `model Collaborator` |
| **Missão** | Período de trabalho de uma equipe em um projeto (planejamento → mobilização → execução → desmobilização). | `model EfetivoMissionPlan`, `EfetivoMissionCycle`, `shared/modules/mission-*.js` |
| **Mobilização / Desmobilização** | Ida da equipe (pessoas e equipamentos) para o local do cliente e o retorno ao fim da missão. | `shared/modules/mission-mobilization.js` |
| **Alocação** | Vínculo de um colaborador a uma missão/projeto num intervalo de datas. A conferência mensal compara alocação e ponto. | `docs/INTEGRACAO_CONECTA_ALOCACOES.md`, Efetivo › Conferência de alocação |
| **Sede** | Colaborador na base da empresa (fora de projeto). Nos dados de alocação aparece como `SEDE`, sem projeto. | `docs/RESPOSTA_FILTROAPP_CONECTA_*.md` |
| **HH (homem-hora)** | Unidade de esforço: horas trabalhadas por pessoa. Base dos custos de mão de obra e da produtividade. | `backend/src/lib/acompanhamento/labor-cost.js`, `docs/HORAS_PREVISTAS_COMERCIAIS.md` |
| **Ausência** | Férias, atestado, folga etc. de um colaborador; bloqueia alocação no período. | `model CollaboratorAbsence` |
| **Classificação da força de trabalho** | Categoria do colaborador (operacional, engenharia, administrativo…) que define em quais módulos ele aparece. | `backend/src/lib/collaborators/workforce-classification.js`, `docs/workforce-classification.md` |

## Logística, qualidade e segurança

| Termo | Significado | Onde vive |
|---|---|---|
| **Romaneio** | Documento de saída/entrada de materiais e equipamentos para um projeto (o que foi enviado e o que voltou), com checklist. | `backend/src/routes/resources/romaneios.js`, `specs/002-*` |
| **Equipamentos** | Cadastro dos equipamentos da empresa (unidades de flushing, limpeza química etc.), com manutenção, dados técnicos e manual. | `backend/src/routes/resources/equipamentos.js` |
| **Certificado de calibração** | Certificado de instrumento (manômetro etc.) anexado a relatórios e ao Data Book. | rota `/certificados-calibracao` |
| **EPI** | Equipamento de Proteção Individual; o módulo registra entregas assinadas por colaborador (guarda de 20 anos). | `backend/src/routes/resources/epis.js`, `LGPD_ROPA.md` |
| **Qualidade** | Registros do sistema de qualidade (formulário FR-3-4-11-01) e documentos de qualidade do projeto. | `specs/008-*`, `backend/src/lib/qualidade/` |
| **Estoque** | Itens de consumo (filtros, produtos químicos) e suas movimentações. | `backend/src/lib/estoque/` |
| **Assinaturas avulsas** | Coleta de assinatura eletrônica de documentos fora do RDO. | `backend/src/lib/assinaturas/` |

## Integrações

| Termo | Significado | Onde vive |
|---|---|---|
| **Conecta RH** | Sistema de RH que publica colaboradores, vínculos, cargos e documentos no filtroAPP (eventos + snapshot). | `backend/src/lib/conecta-rh/`, `docs/INTEGRACAO_CONECTA_RH.md` |
| **ComercialAPP** | App comercial da empresa (propostas); envia projetos/propostas para o filtroAPP. | `docs/comercialapp-bridge.md` |
| **Omie** | ERP financeiro; o worker sincroniza contas a pagar/receber e notas para o custo dos projetos. | `backend/src/lib/omie/` |
| **Pontomais** | Sistema de ponto eletrônico; fonte das horas trabalhadas. | `backend/src/lib/pontomais/` |
| **PrismaCRM / planning** | Contrato `planning-1.0` de planejamento consumido por CRM externo. | `docs/PRISMACRM_OPORTUNIDADES.md` |
| **API de integrações (v1)** | API com token para sistemas externos (`/api/integracoes/v1`), com contrato OpenAPI. | `docs/API_INTEGRACOES.md` |

## Papéis e acesso

| Termo | Significado | Onde vive |
|---|---|---|
| **Tipo de conta** | `ADMIN` (administra tudo), `INTERNAL` (funcionário), `CLIENT` (cliente, escopado por CNPJ/e-mails confiáveis). | `enum AccountType` |
| **Gestor** | `UserRole.MANAGER`: gerencia projetos e equipes, vê `managerOnly`. | `enum UserRole` |
| **Coordenador** | `UserRole.COORDINATOR`: coordena o projeto em campo; vê os RDOs dos projetos não restritos. | idem, `shared/modules/rdo-permissions.js` |
| **Operador / Colaborador** | `UserRole.COLLABORATOR`: preenche RDOs dos projetos em que participa. | idem |
| **Cliente** | `UserRole.CLIENT`: lê relatórios liberados dos próprios projetos. | idem |
| **Papéis por módulo** | Permissões por módulo (RDO, Romaneio, Efetivo, Equipamentos…) atribuídas na conta. | `enum AppModule`, `backend/src/lib/module-roles.js` |
