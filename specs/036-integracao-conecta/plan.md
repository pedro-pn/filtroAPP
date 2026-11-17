# Plano de implementação — integração Conecta

Branch: feat/036-integracao-conecta. Data: 29/10/2026.
Entrada: [spec.md](spec.md). Estado: planejamento; contrato proposto para alinhar com Conecta.

## Resultado

Sincronizar automaticamente pessoas operacionais, vínculos, cargos, mudanças datadas, salário-base por função e conformidade. Conecta publica eventos e permite recuperação incremental; FiltroAPP recebe, valida, persiste e projeta nos cadastros canônicos. Contrato em [contracts/conecta-api.md](contracts/conecta-api.md); instrução externa em [prompt-desenvolvedor-conecta.md](prompt-desenvolvedor-conecta.md).

## Contexto técnico

Node.js/ES modules + Express, Zod, Prisma/PostgreSQL; React/TypeScript para pendências e consulta. Reusar versões do projeto e worker existente, sem novo broker obrigatório. Testes node:test em backend/test. A recepção deve ser curta e apenas persistir inbox; aplicação é assíncrona. Volume e SLO final dependem de homologação; objetivo inicial: evento regular aplicado em até 5 minutos com serviços saudáveis; perda recuperada pela próxima reconciliação de 15 minutos.

## Constituição — antes e após desenho

Aprovado no desenho: sem servidor, Docker ou deploy; Prisma migrations e backfill idempotente com dry-run; Zod na API e formulários; testes de regras e regressões obrigatórios; nenhuma nova tecnologia estrutural. Telas novas reutilizarão kit/tokens, pt-BR, mobile e URL para navegação, campanha temporária de 10 dias na implementação. Sem exceções à constituição. Evidência visual será produzida na implementação, não foi validada neste planejamento.

## Sequência e arquivos afetados

1. **Contrato e diagnóstico.** Homologar empresa, identidade/vínculo, classificação operacional, revisões, datas e recuperação com Conecta. Criar diagnóstico dry-run de pessoas/cargos e conflitos históricos. Capturar amostra sanitizada; testar ponta a ponta em ambiente isolado antes de ativar escritas.
2. **Persistência.** Migrations para vínculos externos, empregos, mapeamentos, ocorrências, conformidade, inbox e cursores conforme data-model.md. Backfill não impõe unicidade em CPF/matrícula existentes e não funde registros automaticamente.
3. **API externa.** Criar backend/src/routes/integrations/v1/rh-conecta.js e schemas compartilhados. Montar em index.js sob /rh/conecta; registrar operações/escopos no catálogo, autorização, documentação e playground existentes. Manter GET /cargos atual; criar catálogo de conciliação específico se os campos atuais forem insuficientes. Reusar Bearer, limites, auditoria, quota e erro padrão. Integrar LIVE/simulação: simulação valida e calcula diagnóstico sem persistir inbox, cursores, jobs, domínio ou efeitos posteriores.
4. **Recepção e worker.** Serviços em backend/src/lib/conecta/ para identidade, mapeamento, recepção, projeção, conformidade e reconciliação. Worker com lease/retry durável, serialização por agregado, limites e classificação de erros. Agendamentos propostos: reconciliação incremental 15 min, completa diária, projeção de vigências a cada minuto e ao iniciar. Checkpoint após inbox durável; recuperar dependências ausentes e replay sem perda.
5. **Cadastros e vigência.** Reusar regras em collaborators/job-role-history.js e job-role-service.js via serviço compartilhado; extrair saveRoleHistory da rota se necessário. Não chamar rotas de sessão nem substituir cargo ignorando histórico. Suportar correção retroativa, cancelamento e recontratação; preservação de snapshots e recálculo explícito dos consumidores de histórico. clearCollaboratorDerivedCaches após commit. Conflito/alteração de cargo e desligamento sinalizam missões e incrementam revisões; não removem alocações silenciosamente. Proteger campos governados nas rotas e importadores, mantendo exceção auditada.
6. **Conformidade e workflow.** Substituir placeholder SOLIDES/AWAITING_INTEGRATION por origem CONECTA e situação real versionada. Atualizar contrato frontend/src/api/projectWorkflow.ts e projeções D-30/D-15/documentação. Definir correspondência de requisitos por tipo de documento e projeto. Reavaliar prontidão, reabrir somente confirmações atingidas, invalidar autorização quando aplicável; falta de dado não libera pessoa automaticamente. Preservar decisão humana e exceção com motivo. Reutilizar alertas existentes para vencimentos sem duplicação.
7. **Operação e conciliação.** Painel de saúde, cursor/última sincronização, itens pendentes, candidatos de cargo e replay auditado. Resolução inicial excepcional produz mapeamento persistente; fluxo regular é automático. Inspecionar telas análogas de Integrações/Operações e gestão de cargos antes de editar UI. Modal/Button/SearchBar/Toast e estados field-invalid; cards no mobile, shell largo no desktop, sem drag and drop; filtros em URL sem dados pessoais; novidade por 10 dias.
8. **Validação e ativação.** Executar cenários de quickstart.md, testes focados e regressões de consumidores. Documentar migração, diagnóstico, recuperação e rollback pelo operador. Ativar por empresa e grupos de campos após reconciliação inicial; preservar fallback manual dos não vinculados.

## Salário por função — implementação adicional

- Acrescentar job_role_salary.upserted, schema Zod e escopo rh.conecta.salarios.write à recepção. Leitura de payload/status com valores exige cargos.salarios.read além do acesso à integração; status sem esse escopo deve trazer somente metadados sanitizados. Conecta fornece histórico, feed, snapshot e correções salariais.
- Criar RhJobRoleSalary e vínculos de projeção por migrations. Resolver cargo pelo mapeamento já conciliado; usar Decimal, BRL, base mensal e data civil. Revisões e cancelamentos são auditados e idempotentes.
- Criar serviço compartilhado para projetar salarioBase no CostProfile/CostParameterSet existente, com transação e serialização por perfil também em relação à edição manual. Recompor na união das datas de vigência salarial e de parâmetros locais; em cada data, preservar encargos/benefícios e escolher salário externo aplicável. Não deixar conjuntos futuros locais restaurarem salário antigo. Não escrever salário recebido como se vigente desde a admissão.
- Preservar GET /api/integracoes/v1/cargos/:id/salario?referenceDate=... e escopo cargos.salarios.read. Verificar todos os consumidores de custo/hora e sua resolução temporal antes de implementar; invalidar caches e reprocessar projeções derivadas dos períodos afetados sem reescrever documentos/snapshots emitidos. Explicitar impacto de correção retroativa no histórico consultado.
- Proteger salarioBase integrado nas edições/importações de parâmetros, permitindo apenas exceção auditada; demais parâmetros continuam locais. Sem perfil configurado, manter pendência em vez de fabricar modelo de custo. Empresas/tabelas incompatíveis com perfil único por cargo ficam pendentes para evolução de modelo.
- Acrescentar testes de reajuste futuro, correção/cancelamento, evento repetido/fora de ordem, concorrência com edição de benefícios, vigências intermediárias, ausência/zero, escopo salarial e preservação da resposta externa atual.

## Riscos e limites

- CPF e matrícula não têm unicidade global; vínculo inicial ambíguo exige resolução.
- Linha do tempo hoje aceita uma mudança por dia e rejeita futuro nas telas manuais; integração deve manter staging e contrato de consolidação diária.
- Desligamento e recontratação exigem revisar consumidores de isActive e admissionDate/terminationDate para consultas históricas.
- Mudança de classificação para não operacional deve retirar elegibilidade futura sem excluir pessoa nem deixar de receber correções e desligamento.
- Ponto Mais continua fonte das jornadas; não criar segundo cadastro nem sobrescrever aliases/vínculos externos dele.
- Um cargo pode ser novo ou apenas uma abreviação: similaridade não autoriza fusão nem criação quando houver possível duplicata.

## Entregáveis da implementação

Migrations/backfill, schemas e operações documentadas, worker e conector configurável, regras de governança, painel de pendências, testes, atualização do workflow e guia de operação. Nenhum endpoint proposto neste plano está disponível por este trabalho documental.
