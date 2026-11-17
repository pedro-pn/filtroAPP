# Pesquisa e decisões

## Evidência local

- backend/prisma/schema.prisma: Collaborator já possui CPF, matrícula, admissão, desligamento, isActive e jobRoleId obrigatório; CPF/matrícula não são únicos. JobRole tem name e normalizedKey únicos. CollaboratorJobRoleHistory tem unicidade colaborador + data.
- backend/src/lib/collaborators/job-role-service.js: normalizeJobRoleKey remove acentos e normaliza caixa/espaços; markFutureAllocationsForReplanning sinaliza missões e revisões.
- backend/src/lib/collaborators/job-role-history.js: resolução por data e sincronização do cargo atual; validação manual rejeita futuro e datas anteriores à admissão.
- shared/job-role-display.js: famílias removem sufixos romanos para apresentação. Essa função não pode decidir identidade de cargo.
- backend/src/routes/resources/collaborators.js: rotas manuais com sessão/gestor e atualização transacional do histórico. Não são contrato técnico para Conecta.
- backend/src/lib/api-credentials/operational-resources.js: GET /colaboradores e /cargos já publicados; projeção atual de colaborador não inclui todo o cadastro de RH nem histórico.
- backend/src/routes/integrations/v1/index.js e qualidade.js: autenticação Bearer, autorização por operação, limites, medição e erros padronizados reaproveitáveis.
- backend/src/lib/api-credentials/write-context.js: simulação isolada por contexto assíncrono; novas operações devem respeitar o modo sem deixar jobs pendentes.
- backend/src/lib/pontomais/normalize.js: correspondências por matrícula e CPF fazem parte do caminho de normalização; sincronização de RH não deve quebrar esses vínculos.
- backend/test/collaborator-job-role-history.test.js, collaborator-job-role-service.test.js e job-roles.test.js: regressões existentes de vigência, normalização, cargo inativo e replanejamento foram lidas.
- specs/016-gestao-projetos-efetivo/integration-decisions.md: plataforma fornece conformidade, responsável mantém confirmação, mudanças reabrem confirmações afetadas.

## Decisões

1. Eventos Conecta → FiltroAPP com outbox no produtor, inbox no consumidor e feed incremental para recuperação. Alternativa só webhook rejeitada por não recuperar perdas; só polling aumenta latência. Proposta: polling a cada 15 minutos e conferência completa diária, configuráveis após conhecer volume/limites.
2. Mapeamento persistente de cargos e pessoas antes da escrita canônica. Similaridade apenas sugere; associação automática é exata, única e compatível. CBO, se existir, é auxiliar e não chave única.
3. Livro de eventos/versionamento por agregado e tabela de vínculos empregatícios. Somente colunas admissionDate/terminationDate não representam recontratação nem correções sem apagar passado.
4. Separar revisão de transporte de data efetiva de negócio. Revisão maior pode corrigir uma ocorrência antiga; evento antigo não deve ser descartado somente porque effectiveDate é anterior ao cargo vigente.
5. Etapas futuras ficam no staging e são aplicadas por job usando data local. Preservar regra das telas manuais. Conflito de duas mudanças distintas no mesmo dia exige consolidação final explícita do produtor ou pendência; não remover a unicidade atual sem decisão funcional.
6. Integração somente de RH/conformidade; salário-base por função incluído; folha, salário individual, ausências e contas de usuário fora do contrato inicial. Mudança de cargo seleciona a tabela da função vigente na data, sem inventar reajuste.
7. Pendências excepcionais têm resolução única e replay automático. Não há promessa de associação sem intervenção para dados contraditórios; operações regulares são automáticas.

As características externas do Conecta ainda precisam ser confirmadas pelo seu desenvolvedor. Este plano foi baseado no repositório, sem presumir endpoints existentes do fornecedor.

## Ampliação: salário por função

- Fonte verificada: backend/src/lib/api-credentials/job-role-salary.js e backend/test/integration-job-role-salary.test.js já consultam CostProfile/CostParameterSet.params.salarioBase pela data e maior versão da mesma vigência; escopo cargos.salarios.read. Não antecipam reajustes futuros e não usam fallback quando o salário vigente é inválido/ausente.
- Decisão: receber job_role_salary.upserted como agregado independente, conciliado ao mesmo cargo. Registrar histórico externo e projetar no perfil existente sem substituir o JSON inteiro por dados do Conecta. Versões locais e revisões externas são contadores independentes.
- A projeção precisa recompor a linha do tempo na união das datas de alteração salarial e de parâmetros locais: copiar somente o conjunto local aplicável a cada data e substituir salarioBase pelo valor externo aplicável. Isso evita que um conjunto posterior de benefícios ressuscite salário antigo ou que uma correção retroativa apague encargos de outras vigências. Preservar registros anteriores para auditoria; cancelamento gera nova projeção versionada.
- Dependência de homologação: confirmar salário-base mensal em BRL por função e eventuais dimensões empresa/jornada/tabela. O modelo atual tem um perfil por cargo; múltiplos valores incompatíveis para o mesmo cargo exigem pendência ou evolução explícita do modelo, sem sobrescrita entre empresas.
