# Prompt para concluir a homologação de RH no CONECTA

**Versão histórica de 13/11/2026.** Para continuar após a configuração da empresa real e os testes já aprovados, encaminhar o [prompt de homologação completa em lote](PROMPT_CONECTA_RH_HOMOLOGACAO_COMPLETA.md).

O receptor de RH do FiltroAPP já foi publicado e testado no staging em 13/11/2026. Precisamos concluir os testes pelo CONECTA antes de aprovar a integração automática. Trabalhe apenas no backend do CONECTA, seguindo a implementação e os contratos existentes.

## 1. Fornecer os dados de conexão

Entregue ao responsável pelo FiltroAPP:

- UUID real da empresa (`companyId`). O FiltroAPP está usando um UUID fictício e precisa substituí-lo antes dos envios com o UUID real.
- URL completa da API de leitura do CONECTA, terminando em `/api/integracoes/filtroapp/v1`.
- Token de leitura, por canal seguro, com `rh.leitura` e `rh.salarios.leitura` para testar salários.
- IP público de saída do backend/worker do CONECTA, para autorizar o acesso ao staging, que tem restrição por IP.

## 2. Configurar o envio manual para o staging

Destino:

```text
POST https://filtrostaging.filtrovali.com.br/api/integracoes/v1/rh/conecta/eventos
Authorization: Bearer <FILTROAPP_RH_TOKEN>
Content-Type: application/json
Idempotency-Key: <eventId>
```

A credencial **Conecta — RH homologação** já foi emitida no FiltroAPP, em modo `LIVE`, acesso `ALL`, com `rh.conecta.eventos.write` e `rh.conecta.salarios.write`; vence em **20/11/2026 às 15:48, horário de São Paulo**. Solicite o segredo pelo canal seguro combinado e configure-o em `FILTROAPP_RH_TOKEN` no backend. Se a rodada ocorrer após a validade, será necessária nova credencial. Mantenha o envio automático desligado durante os primeiros testes.

## 3. Conferir o contrato do emissor

- Publicar os cinco agregados: `job_role`, `employment`, `role_change`, `job_role_salary` e `compliance`, com `eventType=<aggregateType>.upserted` e envelope `schemaVersion="1.0"`.
- Reenvio mantém `eventId`, `Idempotency-Key` e corpo. Cada alteração cria outro `eventId`, com revisão crescente do mesmo agregado.
- Atualização da admissão conserva `personId` e `employmentId`; recontratação conserva `personId` e cria outro `employmentId`.
- **Adequação necessária:** permitir `PRE_ADMISSION` com `admissionDate=null` e a ocorrência de cargo com `effectiveDate=null` quando a vigência for desconhecida. O OpenAPI originalmente enviado exigia a vigência preenchida. Não inventar uma data nem ativar a pessoa pela passagem do calendário.
- `ACTIVE` e `TERMINATED` exigem admissão oficial. Desistência usa `CANCELLED`, sem inventar desligamento.
- Salário é a tabela mensal do cargo, com `amount` decimal em string, `currency="BRL"`, `basis="MONTHLY"` e vigência própria. Não derivar do salário individual.
- `202` confirma recebimento durável. Guardar `receiptId` e consultar `statusUrl` com o mesmo Bearer, resolvendo o caminho relativo na origem `https://filtrostaging.filtrovali.com.br`, até obter `APPLIED`. Se `PENDING`, registrar `reasonCode`; tratar também `SUPERSEDED` e `FAILED` sem considerar apenas o HTTP como sucesso de aplicação.

## 4. Executar os cenários pela origem

Use pessoas e cargos fictícios, identificados como teste, e acompanhe a conferência das telas com o responsável pelo FiltroAPP:

1. Cargo operacional e pré-admissão sem data; repetir o mesmo evento e depois enviar nova revisão ainda sem data.
2. Pré-admissão com data futura; confirmar que a mobilização no FiltroAPP não ativa a pessoa no RH.
3. Admissão oficial e ativação no mesmo vínculo; conferir substituição da data provisória e da vigência derivada, preservando vigência expressa pelo RH.
4. Desistência, desligamento, recontratação e correção de vínculo antigo sem substituir o atual.
5. Troca de cargo, reajuste salarial futuro, correção e cancelamento salarial.
6. Conformidade válida até o vencimento, vencida na consulta posterior e revogada.
7. Vínculo antes do cargo: aguardar `PENDING`, enviar o cargo e consultar o recibo original até `APPLIED`.
8. Testes controlados de token inválido (`401`), empresa diferente (`403`), salário sem permissão (`403`), mesmo evento com corpo divergente (`409`) e ativação sem admissão (`400 VALIDATION_ERROR`). O responsável pelo FiltroAPP disponibiliza uma credencial sem escopo salarial para essa verificação.

Em cada cenário, entregue `eventId`, `aggregateId`, revisão, `requestId`, `receiptId`, status final, eventual `reasonCode`, resultado esperado e obtido. Não inclua tokens, CPF ou salários reais nos logs compartilhados.

## 5. Validar snapshot e feed reais

Com o envio automático ainda desligado, disponibilize:

```text
POST /api/integracoes/filtroapp/v1/snapshots?companyId=...
GET  /api/integracoes/filtroapp/v1/snapshots/:id/job-roles
GET  /api/integracoes/filtroapp/v1/snapshots/:id/employments
GET  /api/integracoes/filtroapp/v1/snapshots/:id/role-changes
GET  /api/integracoes/filtroapp/v1/snapshots/:id/compliance
GET  /api/integracoes/filtroapp/v1/snapshots/:id/job-role-salaries
GET  /api/integracoes/filtroapp/v1/changes?companyId=...&cursor=...&limit=500
```

O FiltroAPP configurará URL/token de leitura e reiniciará o worker, que executa na inicialização e a cada cinco minutos. Snapshot e feed devem compartilhar os mesmos IDs, eventos e revisões dos envios. O snapshot precisa manter `snapshotId` e `watermarkCursor` consistentes em todas as páginas; o feed retorna `items`, `nextCursor`, `hasMore` e `generatedAt`.

Confirmar importação sem duplicação, alteração feita durante o snapshot recuperável após o watermark, alteração chegando somente pelo feed e recuperação após cursor expirado (`410`). Não avançar o watermark após falha parcial; ausência em snapshot não significa exclusão. Sem escopo salarial, o recurso de snapshot salarial responde `403` e o feed omite salários. Informar retenção, expiração e eventuais limites reais.

## 6. Ativar somente após a rodada conjunta

Após a aprovação dos cenários anteriores, ligar o envio automático e realizar uma nova alteração na origem. Entregar evidências de envio, recibo, `APPLIED` e resultado correto no app. Conferir também o consumidor existente de alocações confirmadas em `/api/integracoes/v1/efetivo/conferencia/alocacoes`, usando sua credencial própria com `efetivo.conferencia.read`, sem substituir essa autorização pelo token de escrita de RH.

Relatar eventuais incompatibilidades antes de alterar o contrato. O aceite integrado depende de sucesso pela origem, recuperação real, ausência de duplicação e pendências explicadas. O receptor do FiltroAPP já passou nos testes sintéticos; isso ainda não homologa o emissor, a API de leitura ou a automação do CONECTA.
