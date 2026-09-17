# Research: decisões da entrega 019

## Autorização vinculada à versão

**Decision**: persistir data e versão da autorização. A autorização só é vigente se a versão atual for igual à versão autorizada.

**Rationale**: qualquer alteração posterior suspende o estado sem depender de uma lista frágil de campos invalidadores.

## Revalidação explícita

**Decision**: criar a ação `authorize_mobilization` para projetos que já estão na etapa pronta.

**Rationale**: permite corrigir uma pendência e registrar nova decisão formal sem movimentar o card artificialmente.

## Gate calculado

**Decision**: calcular nove frentes a partir dos fatos comerciais, documentação, checklists D-15 e pendências críticas.

**Rationale**: evita armazenar semáforos derivados e mantém a explicação de cada bloqueio.

## Ativação externa

**Decision**: expor o estado de autorização sem aplicá-lo ainda às rotas de Romaneio e missões.

**Rationale**: o roadmap exige classificação dos projetos e política de exceção antes de bloquear operações existentes.
