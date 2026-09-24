# Integração da main — 23/09/2026

Referência: `origin/main` em `10599cf3`, incorporada à branch
`feat/frontend-redesign-2` pelo merge `85452fd9`. O merge havia substituído módulos
já migrados por páginas legadas. A correção de 24/09 recuperou as versões visuais
e conciliou nelas os recursos funcionais da main. O baseline anterior está no
[roadmap](../REDESIGN_ROADMAP.md) e na integração de 11/09.

## Estado da correção de regressões

| Área já migrada | Corrigido nesta branch | Verificação ainda necessária |
| --- | --- | --- |
| RDO gestor, colaborador, cliente, conta e estatísticas | Shells, listagens, formulário, detalhe e dashboards DS recuperados. Permanecem continuação/exclusão de serviços, permissão de revisão, justificativa de equipe nos rascunhos, TAGs, câmera e redução de imagens, upload histórico unificado e confirmações. | Fluxos completos com API em perfis gestor/coordenador/colaborador/cliente, incluindo rascunho, retorno e PDF. |
| Acompanhamento | Dashboard, cartões e detalhe DS recuperados com filtros de avanço, escopos, qualidade agrupada, equipe planejada, guarda financeira, reconciliação e links de cronograma. | Conferir valores, permissões e retorno da reconciliação com dados reais; testar desktop/mobile e claro/escuro. |
| Assinaturas | Preparação, biblioteca e assinatura pública DS recuperadas; prévia contínua, PDF escaneado e convite renovado incorporados. | Conferir páginas longas, posicionamento de campos, teclado e convite renovado em navegador. |
| Efetivo | Visão geral, colaboradores e diálogos já migrados recuperados; equipe inicial por disponibilidade conciliada com o fluxo novo de projetos. | Revisar visual do novo Kanban de evolução e das etapas adicionadas pela main, após liberação da frente de Efetivo. |
| Componentes compartilhados | Busca persistente, modal, upload e seleção de equipe conciliados; fotografia e compressão preservadas. | Validar foco, remoção condicionada ao salvamento e estados de erro em navegador. |

Os testes de contrato alterados para a estrutura nova verificam os mesmos fluxos
funcionais; as verificações de navegador e API acima seguem como gate de
homologação, sem bloquear a recuperação do código visual.

Validação desta correção: tipagem, build de produção, `architecture:check` e
os 116 arquivos da suíte frontend passaram. O teste de isolamento do catálogo
da API teve a espera do processo filho corrigida após falhar apenas na execução
da suíte completa. Lint terminou sem erros (dois avisos preexistentes). A rota
pública de Assinaturas sem convite carregou o shell DS em Chromium; rotas
autenticadas e um convite real dependem da homologação com credenciais/dados de
teste.

## Trabalho residual nas superfícies cujo novo visual já existia

| ID | Superfície e arquivos principais | Mudança da main a preservar | Trabalho visual e critério de aceite |
| --- | --- | --- | --- |
| R1 | Gestor, criação e detalhe de RDO: `GestorPage`, `NewReportPage`, `ReportDetailPage`, `ServiceFields` | Continuação e exclusão de serviços pendentes também na revisão; permissão `REVIEW_REPORTS` para coordenadores; câmera no formulário; TAGs dos serviços e validação de finalização | **Código DS recuperado e conciliado.** Revisar rascunho, aprovação/devolução, leitura, anexo, foto e relatório assinado em desktop/mobile e claro/escuro com API real. |
| R2 | Conta, cliente, listas do colaborador e `UploadField` | Confirmações compartilhadas, busca cancelável, captura de foto, carga inicial e estados de consulta | **Código DS recuperado.** Conferir filtros, confirmações, foto, compressão, remoção só após salvar, foco e navegação de perfis. |
| R3 | Estatísticas/NPS e `StatsDashboard` | Dashboard detalhado com largura do desktop | **Código DS recuperado.** Conferir largura, painéis e overlays responsivos em 360–1920 px. |
| A0 | Shell/Dashboard/Cards/Detalhe do Acompanhamento: `AcompanhamentoPage`, `AcompanhamentoDashboard`, `ProjectCardsBoard`, `ProjectDetailDashboard` | Novos filtros de avanço por escopo/equipamento, sistemas e unidades, horas comerciais, desvios de projetos mesclados, custos de RDO, simulação por RDO, permissão financeira por gestor e avanço acima de 100% | **Código DS recuperado e conciliado.** Revalidar cálculos, links de reconciliação, permissões, avanço acima de 100%, ações e cache com dados reais. |
| S1 | Preparação e assinatura pública de Assinaturas: `DocumentSetupView`, `PdfPageCanvas`, `AssinaturasPublicSignPage` | Prévia contínua de todas as páginas, suporte a scans/fontes, recarga de convite renovado e preservação do token no fragmento | **Código DS recuperado e prévia contínua integrada.** Conferir posicionamento, escala, teclado, foco, tema e convites expirados/renovados no navegador. |
| F0 | Efetivo: `EfetivoPage`, Visão geral, Colaboradores, programação de equipe e diálogos | A main substituiu a aba Missões pelo fluxo de projetos em Evolução e ampliou planejamento, equipe e permissões | Consolidar a navegação em **oito áreas**, corrigir atalhos/deep links antigos de Missões para o projeto correspondente e adaptar o novo Kanban, seleção por disponibilidade, períodos individuais, simulações por cargo e diálogos ao DS. A migração completa de F2 permanece em standby até a conciliação da frente paralela. |
| X0 | `Modal`, `ConfirmDialog`, busca persistente e upload compartilhado | Confirmação sem `window.confirm`, tratamento de foco, busca que ignora resposta antiga e `PhotoCaptureButton` | **Código conciliado.** Conferir trava de rolagem, retorno de foco, aparência DS e acessibilidade nos consumidores RDO, Acompanhamento, Assinaturas e Efetivo. |

## Acrescentar às ondas ainda pendentes

| ID / fase | Nova superfície ou variação da main | Entrega visual necessária |
| --- | --- | --- |
| F2.5 | Gestão de projetos do Efetivo: handover, prontidão comercial, análise inicial, preparação D-30/D-15, recursos, insumos/logística, QSMS, mobilização, execução, desmobilização, pós-job, medição, documentos e encerramento | Projetar a hierarquia do Kanban único e de cada etapa no DS, com cartões recolhíveis, formulários, documentos, status, alertas, reservas e conflitos; validar permissões e estados de leitura. Respeitar o standby de F2. |
| F2.6 | Novos detalhes do projeto: datas comerciais estimadas/confirmadas, checklist do cliente e plugue, equipe inicial, transporte/veículo por colaborador, itens críticos por e-mail, faturamentos recolhíveis e histórico de cargos | Cobrir as condições, dependências e mensagens em formulários/diálogos mobile; não reintroduzir o estado removido “Pronto para mobilizar”. |
| A3b/A4/A5/A6 | Escopo por sistemas e unidades, serviços duplicados/retráteis, conciliação por medição, jornadas e custo de mão de obra dos RDOs, equipe planejada antes do primeiro RDO, horas comerciais, simulação excluída e filtros/indicadores de avanço | Integrar editores e diálogos ao detalhe DS, separar previsto/realizado e ponto/RDO, respeitar acesso financeiro por gestor e projetos mesclados. Validar progresso acima de 100% e reconciliação sem perda de dados. |
| E1 | Estoque: saldos e movimentações nas duas abas, filtros por tipo, documentos, lotes e devoluções | Harmonizar seleção, filtros, tabelas/cards, resumos e feedback de operação com a fase Estoque já planejada. |
| RM1 | Romaneio: disponibilidade de projetos, manutenção dos itens de saída na edição/retorno e câmera/QR | Rever seletor, avisos de indisponibilidade, scanner e prévia mobile sem impedir a continuidade do fluxo. |
| M3/EQ2 | Fotos tiradas na hora e redução de imagens nos relatórios operacionais e manutenção; perfil sem ID de serviço vazio | Incorporar controles de câmera/upload e estados de erro/permissão aos formulários pendentes de Manutenção/Equipamentos. |
| X1/X2 | Papel de revisão RDO para coordenador, criação de senha por link, proteção financeira por gestor, tutoriais/novidades, buscas canceláveis e confirmação compartilhada | Matriz de acesso por perfil, link direto, refresh e retorno; adaptar textos e tours às rotas/controles atuais. |

## Ordem para retomar a migração

1. **P0 — homologar a recuperação visual já aplicada**: R1–R3, A0, S1 e X0
   com dados reais, perfis e navegador. F0 depende da frente de Efetivo para a
   migração completa do fluxo novo.
2. **P1 — absorver as superfícies novas**: A3b/A4/A5/A6, E1, RM1, M3/EQ2 e
   X1/X2; F2.5/F2.6 entram após liberação da frente paralela.
3. **Gate de cada lote**: testes de comportamento relevantes e contratos do DS,
   build/lint/arquitetura, navegador em 360/390/768/1280 px, claro/escuro,
   teclado/toque, loading/vazio/erro, sem acesso/somente leitura/edição. A suíte
   completa deve voltar a verde antes de declarar encerrado o merge visual.

As mudanças de worker, índices, cache, Prisma, email e PDF do servidor não criam
páginas novas. Elas exigem regressão dos consumidores e dos estados de carregamento,
sem aplicação de migrations ou homologação de produção nesta integração.
