# Research: Efetivo Operacional — Planejamento Completo

## 1. Fronteira entre projeto e missão operacional

**Decision**: manter `Project` como identidade canônica do contrato e criar uma programação operacional 1:1 própria (`EfetivoMissionPlan`).

**Rationale**: `Project` já concentra código, nome, cliente e local. Seus campos `mobilizationDate`, `startDate`, `laborCollaboratorIds` e previsões de HH pertencem ao Acompanhamento/realizado e não têm intervalo, integridade relacional ou auditoria suficientes para o planejamento por pessoa. A programação própria evita duplicar o contrato sem mudar o significado de dados existentes.

**Alternatives considered**:

- Acrescentar todas as colunas diretamente a `Project`: mistura ciclo comercial/execução com planejamento do Efetivo e amplia um modelo já central.
- Reutilizar `laborCollaboratorIds`: JSON sem datas, função ocupada, autoria ou proteção contra conflitos.
- Reutilizar `ProjectPlannedNormalHours`: representa HH vendidas agregadas, não vagas em pessoas.

## 2. Vínculo estável entre colaborador e função

**Decision**: tornar `Collaborator.jobRoleId` obrigatório e a única fonte do cargo atual. `Collaborator.role` deixa de receber escritas, todos os consumidores passam a ler `JobRole.name` pela relação e a coluna textual é removida depois do backfill auditado. Contextos históricos mantêm snapshots próprios, sem reutilizar o cargo atual.

**Rationale**: elegibilidade, demanda, alocação e integrações exigem uma chave relacional única. Manter duas representações editáveis recria divergência a cada alteração. A branch ainda não foi para produção quanto ao Efetivo, portanto não há motivo para carregar compatibilidade interna do novo módulo. Os colaboradores já existentes no APP, porém, são dados produtivos: antes de impor `NOT NULL`, um comando idempotente com modo `--dry-run` lista correspondências e cargos provisórios. Nomes legados não vazios são materializados uma única vez e vinculados automaticamente; somente nomes vazios ou ambiguidades reais bloqueiam a implantação.

**Alternatives considered**:

- Continuar apenas com texto: frágil a renome, duplicidade e acentos.
- Manter `role` indefinidamente como fallback: preserva duas fontes de verdade e torna impossível garantir centralização real.
- Tornar `jobRoleId` obrigatório sem auditoria: arrisca associar cargos errados em cadastros já produtivos.

## 3. Datas civis e sobreposição

**Decision**: representar entradas e saídas de negócio como `YYYY-MM-DD`, persistir como data civil e tratar intervalos como inclusivos.

**Rationale**: o projeto já usa `@db.Date` e helpers UTC no Efetivo. A regra uniforme de sobreposição é `a.start <= b.end && b.start <= a.end`, já aplicada nas ausências.

**Alternatives considered**:

- Instantes com horário/local: não há alocação parcial por hora nesta expansão e isso introduziria erros de fuso.
- Fim exclusivo: diverge da linguagem de mobilização/retorno e das ausências existentes.

## 4. Capacidade e utilização planejada

**Decision**: calcular a capacidade em conjuntos únicos `collaboratorId|date` na janela inclusiva; dia útil é segunda a sexta menos feriados globais. O denominador é a capacidade útil do vínculo ativo menos ausências; o numerador são dias úteis comprometidos em missões confirmadas. Denominador zero retorna indisponível (`null`).

**Rationale**: conjuntos evitam dupla contagem e tornam a fórmula reproduzível. Separar ausência do denominador e missão no numerador mantém o indicador planejado independente das HH realizadas.

**Alternatives considered**:

- Usar horas vendidas: mistura dimensão financeira/contratual com pessoas disponíveis.
- Contar dias corridos: contraria a referência funcional e distorce finais de semana.
- Tratar ausência como utilização: inflaria ocupação sem trabalho planejado.

## 5. Precedência de situação e conflitos

**Decision**: na leitura de uma data, a precedência é indisponível → alocado → livre. Qualquer sobreposição entre ausência e missão confirmada ou entre duas missões confirmadas bloqueia a escrita e identifica os registros conflitantes.

**Rationale**: uma pessoa não pode compor mais de um total. O bloqueio ocorre no serviço dentro da mesma transação da alteração; restrições únicas cobrem apenas duplicidades simples, não intervalos.

**Alternatives considered**:

- Aceitar conflito e apenas alertar: produz capacidade oficial inconsistente.
- Resolver silenciosamente pela última gravação: perde intenção e auditoria.

## 6. Permanência contínua em obra

**Decision**: ordenar e unir intervalos confirmados sobrepostos ou adjacentes por pessoa. A sequência só quebra quando existe ao menos um dia civil inteiro sem alocação ou uma `FOLGA` explícita; retorno seguido por nova mobilização no dia seguinte permanece contínuo. Contar dias corridos inclusivos e comparar ao limite configurado da função, com fallback 90/60/30 pelas categorias confirmadas.

**Rationale**: a regra empresarial fala em permanência contínua, não dias úteis. Unir intervalos evita reset artificial entre missões consecutivas.

**Alternatives considered**:

- Somar dias no ano: deixa de ser permanência contínua.
- Codificar limites somente por nome: o fallback ajuda a migração, mas a configuração explícita por função é a fonte futura.

## 7. Alertas de férias

**Decision**: derivar períodos aquisitivos anuais da admissão e verificar férias registradas na janela concessiva subsequente; alertar vencimento quando a janela encerra e programação quando faltar até 120 dias. O alerta é operacional, não substitui folha ou análise jurídica.

**Rationale**: a CLT prevê aquisição após 12 meses e concessão nos 12 meses seguintes; os registros de férias da feature 011 tornam o alerta calculável. Fontes oficiais consultadas: [CLT, arts. 130 e 134](https://www.planalto.gov.br/ccivil_03/decreto-lei/del5452.htm) e [TST — Férias](https://www.tst.jus.br/en/ferias1).

**Alternatives considered**:

- Armazenar um status manual: fica rapidamente desatualizado.
- Declarar conformidade legal integral: fora do escopo e incompatível com as exceções que um sistema de folha conhece.

## 8. Cenários, concorrência e aplicação

**Decision**: usar o mesmo grafo relacional `EfetivoPlan → missões → demandas/alocações/contratações planejadas` para o oficial e para cenários. Cada cenário é uma cópia materializada do oficial e guarda a revisão de base. A aplicação usa uma única transação, faz compare-and-swap da revisão, revalida conflitos, cria o novo oficial, supera o anterior, grava auditoria e marca o cenário como aplicado. Repetir a aplicação de cenário já aplicado devolve o resultado existente.

**Rationale**: impede aplicação parcial e sobrescrita de mudanças feitas depois da comparação. O repositório já usa `updateMany` como claim/CAS, tratamento idempotente de conflitos únicos e auditoria dentro de transação.

**Alternatives considered**:

- Guardar apenas patches em JSON: difícil consultar, comparar, auditar e validar relações com as mesmas regras do oficial.
- Aplicar endpoint por endpoint: cria estado parcial quando uma etapa falha.
- Lock pessimista de longa duração: desnecessário para o volume esperado.

## 9. Auditoria do módulo

**Decision**: criar `EfetivoAuditEvent` genérico, gravado na mesma transação de cada mutação, com tipo/alvo/ação e snapshots antes/depois.

**Rationale**: logs atuais são específicos de RDO ou EPI. Um evento próprio mantém o domínio isolado e permite a atividade recente da Administração.

**Alternatives considered**:

- Reusar `ReportAuditLog`: semântica e relações específicas de relatório.
- Log somente textual: não permite reconstruir o que mudou.

## 10. Contratos e permissão

**Decision**: expor rotas próprias sob `/api/efetivo` para projetos mínimos, colaboradores, planejamento e administração, usando `efetivo:viewer` para leitura e `efetivo:manager` para escrita.

**Rationale**: rotas de projetos/colaboradores existentes exigem papéis de outros módulos. Um gestor exclusivo do Efetivo precisa trabalhar sem receber acesso a custos/RDO; as rotas próprias continuam escrevendo nos cadastros canônicos.

**Alternatives considered**:

- Dar papel do Acompanhamento a todos: viola mínimo privilégio.
- Duplicar projetos/colaboradores: cria divergência cadastral.

## 11. Calendário e navegação frontend

**Decision**: implementar calendário/agenda sem dependência nova, com data helpers locais e estado em query params; desktop oferece grade mensal/semanal e mobile troca para agenda empilhada. A página mantém `?section=` e limpa apenas parâmetros incompatíveis.

**Rationale**: não há biblioteca de calendário no projeto; adicionar uma para oito visões simples aumentaria bundle e identidade visual. `useUrlParamState` e as páginas modulares existentes já resolvem persistência/limpeza de URL.

**Alternatives considered**:

- Biblioteca externa de calendário: peso e personalização desnecessários para o escopo.
- Estado só em memória: quebra refresh e compartilhamento.

## 12. Kanban e drag-and-drop

**Decision**: estender o padrão de `QualityNaturesTab` e `utils/reorderDrag.ts` para movimento entre colunas, com Pointer Events, ghost, placeholder, cancelamento e persistência somente no drop; oferecer menu/select acessível equivalente.

**Rationale**: é o padrão constitucional e já funciona com mouse/toque. `ProjectCardsBoard` serve como referência de card/detalhe, mas não é kanban nem DnD.

**Alternatives considered**:

- API HTML5 Drag apenas: falha em toque e teclado.
- Adicionar biblioteca DnD: dependência nova sem ganho necessário.

## 13. Formulários, busca e responsividade

**Decision**: usar o padrão de `AbsenceFormModal` para formulários e `SearchBar` para busca. Como não há combobox compartilhado, criar um componente de seleção pesquisável no kit antes de usá-lo para projetos/pessoas. Tabelas viram cards em até 640 px e o kanban vira seletor de etapa + lista.

**Rationale**: garante validação Zod nas duas pontas, rodapé fixo, mensagens por campo e ausência de overflow. Criar o combobox uma vez evita controles ad hoc divergentes.

**Alternatives considered**:

- `select` com centenas de pessoas/projetos: ruim para busca e acessibilidade.
- Combobox específico em cada modal: duplica lógica complexa.

## 14. Exceção de cargo restrita ao EPI

**Decision**: mover a sobreposição atual para `EpiCollaboratorProfile.roleOverrideJobRoleId`, temporária e exclusiva do EPI. Ela nunca altera `Collaborator.jobRoleId`, não aparece como cargo atual fora do EPI e pode ser limpa para retornar imediatamente ao cargo canônico. O override pode apontar para cargo inativo (histórico), enquanto novas atribuições canônicas exigem cargo ativo. O cargo efetivo do documento é capturado como snapshot na solicitação/artefato do EPI.

**Rationale**: o gestor precisa emitir documentos referentes ao cargo anterior sem falsificar o cadastro atual do colaborador. Hoje o EPI já possui o conceito de override, mas parte da geração consulta o colaborador ao vivo; restaurar o override antes da assinatura poderia trocar o cargo do documento. O snapshot torna a solicitação imutável e auditável.

**Alternatives considered**:

- Alterar temporariamente `jobRoleId`: propagaria um dado deliberadamente local para todo o APP.
- Usar sempre o cargo atual na emissão: impede reproduzir corretamente entregas feitas no cargo anterior.
- Manter o override textual no cadastro global: funciona, mas deixa uma exceção de um módulo dentro da entidade canônica e perde integridade com o catálogo.
- Consultar o override ao vivo durante toda a assinatura: permite que um documento pendente mude depois de criado.

## 15. Planejado e realizado por projeto

**Decision**: manter datas, etapa e equipe da missão como planejamento; manter `Project`, RDO, Acompanhamento e Ponto como evidências do realizado. A integração é feita por `projectId`, com uma projeção planejado × realizado, sem sincronização bidirecional silenciosa.

**Rationale**: `EfetivoMissionPlan` responde “o que deveria acontecer”; datas operacionais do projeto, relatórios, pessoas efetivamente lançadas e horas do ponto respondem “o que aconteceu”. Sobrescrever um lado pelo outro apagaria divergências que são justamente úteis à gestão.

**Alternatives considered**:

- Copiar datas da missão para `Project` em toda edição: confunde intenção com execução e pode alterar um módulo produtivo sem confirmação.
- Atualizar automaticamente a etapa planejada por RDO/Ponto: transforma evidência incompleta em decisão oficial.
- Duplicar o realizado dentro do Efetivo: cria nova fonte de verdade para dados já existentes.

## 16. Consumo da equipe planejada por RDO e Acompanhamento

**Decision**: disponibilizar um contexto de planejamento por `projectId` e data. O RDO usa a equipe da missão confirmada como sugestão inicial, mas grava em `ReportCollaborator` somente a equipe efetivamente confirmada pelo usuário. O Acompanhamento exibe lado a lado equipe/datas planejadas e realizadas; seu `laborCollaboratorIds` existente não se torna fonte do planejamento novo.

**Rationale**: o prefill elimina recadastro sem transformar planejamento em fato consumado. Preservar o snapshot do RDO mantém a fidelidade histórica e permite apontar pessoas não planejadas ou planejadas sem evidência de atuação.

**Alternatives considered**:

- Copiar automaticamente a equipe para todo RDO: pode registrar presença de quem não trabalhou.
- Manter seleção totalmente independente: desperdiça a integração e multiplica divergências manuais.
- Substituir imediatamente `Project.laborCollaboratorIds`: esse campo já pode conter dados produtivos do Acompanhamento e exige evolução separada.

## 17. Ausências compartilhadas

**Decision**: `CollaboratorAbsence` passa a pertencer ao domínio compartilhado de disponibilidade do colaborador. O Efetivo bloqueia nova alocação/confirmacão sobreposta, mas uma ausência verdadeira pode ser cadastrada mesmo quando já existir missão e torna essa programação pendente/conflitante até replanejamento. RDO alerta e exige justificativa auditável para registrar trabalho efetivo no período; Ponto sinaliza a divergência sem apagar horas; Acompanhamento exibe a indisponibilidade no contexto da equipe.

**Rationale**: férias, folgas e afastamentos são fatos do colaborador, não do Efetivo. O tratamento precisa variar conforme a natureza do módulo: planejamento pode bloquear, enquanto um registro do realizado precisa aceitar correção/exceção de forma explícita.

**Alternatives considered**:

- Bloquear RDO e Ponto: pode impedir o registro fiel do que de fato ocorreu.
- Apenas alertar no planejamento: permite oficializar equipes impossíveis.
- Duplicar ausências por módulo: gera conflitos insolúveis de fonte de verdade.

## 18. Calendário corporativo único

**Decision**: substituir `EfetivoHoliday` por um calendário compartilhado. Um serviço resolve feriados nacionais fixos/móveis já considerados pelo RDO e os feriados manuais globais cadastrados pelo gestor; Efetivo e cálculo de hora extra recebem o mesmo conjunto resolvido para o intervalo. Uma revisão global do calendário/força de trabalho participa das chaves de cache e da obsolescência de cenários.

**Rationale**: hoje o Efetivo consulta tabela própria e o RDO usa uma função hardcoded, permitindo resultados distintos no mesmo dia. A geração nacional determinística preserva o comportamento existente; registros manuais complementam o calendário sem duplicar a regra.

**Alternatives considered**:

- Fazer o RDO consultar somente a tabela: perderia feriados atuais se o cadastro não estivesse completo.
- Manter calendários separados: perpetua a divergência que a integração pretende eliminar.
- Fazer acesso ao banco dentro de cada função de cálculo: espalha I/O e torna as regras puras difíceis de testar; o serviço deve resolver o período antes do cálculo.

## 19. Responsável da missão vinculado ao usuário

**Decision**: persistir `headquartersResponsibleUserId` obrigatório em `EfetivoMissionPlan`, além dos snapshots de nome/cargo e do vínculo opcional com `Collaborator`.

**Rationale**: a conta ativa é a identidade operacional estável para permissões, notificações e filtros; os snapshots preservam o histórico exibido mesmo quando nome, cargo ou vínculo mudarem. Como missões do Efetivo ainda não existem em produção, a FK pode nascer obrigatória sem backfill de legado do módulo.

**Alternatives considered**:

- Guardar apenas nome/cargo: não permite direcionar ações a uma conta.
- Guardar apenas `User`: muda retrospectivamente a apresentação histórica.
- Exigir `Collaborator`: nem toda conta responsável precisa possuir esse vínculo.

## 20. Fronteira de migração antes da primeira produção

**Decision**: remodelar diretamente tabelas, contratos e migrations exclusivos do Efetivo, sem adaptadores de compatibilidade ou backfill de dados do próprio módulo. Para entidades compartilhadas já produtivas, usar migração versionada, diagnóstico `--dry-run`, criação automática de cargos provisórios a partir de nomes legados não vazios, correção explícita de nomes vazios/ambiguidades e gates de integridade antes de remover a representação antiga.

**Rationale**: carregar compatibilidade para dados que nunca existiram em produção aumenta custo sem benefício. A mesma premissa não autoriza descartar dados dos demais módulos já em uso.

**Alternatives considered**:

- Tratar todo o APP como greenfield: risco de perda ou associação incorreta de dados existentes.
- Tratar o Efetivo como legado: cria fases, fallbacks e código temporário desnecessários.

## 21. Inventário de implementação das integrações

Levantamento executado com code-review-graph antes da inspeção textual:

- **Cargo canônico**: `Collaborator.role` e `jobRoleId` convivem; escritores estão nas rotas de colaboradores, planejamento do Efetivo e scripts de importação/normalização. Os leitores atuais alcançam RDO/PDF, Acompanhamento/custos, Ponto, autenticação, EPI e Efetivo. O raio de impacto conjunto de schema, cargo, EPI, RDO, feriados e missão alcança 57 arquivos adicionais em dois saltos e foi classificado como alto.
- **EPI**: `effectiveEpiRole` possui cinco consumidores diretos relevantes — base DOCX, payload público, chave de cache PDF e testes. `EpiSignatureRequest` não possui snapshot; a correção precisa atravessar criação, leitura pública, cache e geração assinada.
- **RDO**: `buildReportCollaboratorRows` alimenta DOCX/PDF e já tem testes unitários. `ReportCollaborator` guarda apenas FKs; criação/edição passa por `routes/resources/reports.js` e por helpers de dados operacionais manuais.
- **Ausências**: a tabela é global, mas todas as regras estão em `lib/efetivo/service.js` e `lib/efetivo/planning/*`; nenhum consumidor atual do RDO/Ponto/Acompanhamento usa a entidade.
- **Feriados**: o Efetivo persiste `EfetivoHoliday`; `isBrazilHoliday` em `lib/overtime.js` possui dois consumidores diretos (`getExpectedMinutes` e `calculateReportOvertime`) e não tem cobertura direta no grafo.
- **Missões**: `mission-planning.js` concentra persistência e equipe, enquanto o RDO/Acompanhamento não possuem contexto oficial por projeto/data. `Project.laborCollaboratorIds` permanece consumidor do motor de rateio e não será substituído.

Este inventário define a ordem segura: schema/serviços puros → snapshots/cargo → calendário/ausências → contexto planejado → comparação. Arquivos de alto acoplamento (`schema.prisma`, `reports.js`, `efetivo-planning.js`) permanecem seriais.
