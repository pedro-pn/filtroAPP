# Research: decisões da entrega 018

## Checklists paralelos

**Decision**: adicionar `section` e `areaRoles` às definições do catálogo. Documentação usa `stage: null`; itens D-30 usam `MOBILIZATION_PLANNING`.

**Rationale**: mantém uma única persistência e permite mostrar documentação em qualquer etapa sem duplicar estado.

## Autorização por item

**Decision**: devolver `canEdit` em cada checklist e validar a seção no serviço antes do upsert.

**Rationale**: uma permissão global não representa combinações aditivas de responsabilidades e não protege chamadas diretas.

## Marcos relativos

**Decision**: derivar os cinco marcos em memória a cada consulta, usando datas civis e comparações em UTC.

**Rationale**: reagenda automaticamente quando a mobilização muda e evita alertas persistidos duplicados.

## Prontidão documental

**Decision**: todos resolvidos significa `OK`; pendências a até 15 dias ou pendência documental crítica vencida significam `CRITICAL`; demais pendências significam `IN_PROGRESS`.

**Rationale**: o semáforo expressa urgência operacional, além de porcentagem preenchida.

## Limite desta entrega

**Decision**: não criar as etapas D-15 e “Pronto para mobilizar” ainda.

**Rationale**: o incremento atual fecha o planejamento D-30 e prepara, sem simular, os gates que dependerão de confirmações e autorizações na entrega seguinte.
