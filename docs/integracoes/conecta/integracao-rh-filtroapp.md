# Integração de RH Conecta → FiltroAPP — lado Conecta

Resposta do Conecta ao contrato proposto em `specs/conecta-api.md` (v1, proposta para homologação).
Este documento é para a equipe do FiltroAPP: o que o Conecta publica, de onde vem cada campo, como
ler, e **o que precisa ser ajustado no contrato antes da ativação**.

Estado em 11/11/2026: o lado Conecta está implementado. O envio automático está **desligado** até o
FiltroAPP publicar `POST /api/integracoes/v1/rh/conecta/eventos` e homologarmos.

## 1. Adequações ao contrato

São as diferenças entre o que o contrato supõe e o que o Conecta tem. Precisamos da concordância de
vocês (ou de uma contraproposta) antes de ligar o envio.

1. **Pessoa e vínculo.** O Conecta tem uma ficha por pessoa; a recontratação reativa a mesma
   ficha, e as saídas ficam num histórico. O `employmentId` é um ID estável gerado pela integração
   para cada período admissão → desligamento. Recontratação gera `employmentId` novo com o mesmo
   `personId`; um desligamento lançado por engano e apagado reabre o **mesmo** vínculo
   (`ACTIVE`, `terminationDate=null`).
2. **Histórico de cargo a partir da data conhecida.** Antes da ativação só se sabe o cargo atual.
   A carga inicial manda, por vínculo, uma ocorrência com o cargo atual e a data a partir da qual ele
   é conhecido: a admissão, quando a trilha de auditoria (que começa em 07/10/2026) cobre o vínculo
   inteiro sem troca de cargo; senão, a data da ativação. Nada anterior é inventado.
3. **Troca de cargo futura não é suportada na v1.** A vigência é de hoje ou passada. Uma troca no
   mesmo dia de outra cancela a anterior e a referencia em `supersedesId`.
4. **Salário-base sem histórico anterior.** O piso do cargo é o salário-base da função. A carga
   manda uma ocorrência por cargo com piso, vigente na data da ativação. Daí em diante: reajustes
   futuros, correções (mesmo `id`, revisão maior) e cancelamentos. Há **uma tabela só** — sem
   dimensão de jornada ou contrato. O teto da faixa não é enviado. Cargo sem piso não tem
   ocorrência (ausência não é zero).
5. **Uma empresa.** `companyId` é fixo. As rotas exigem `companyId` e recusam outro valor com 403.
6. **ASO e toxicológico sem resultado e sem evidência.** Só situação, emissão e validade. O arquivo
   do ASO tem dado clínico; a rota de evidência responde 404 para esses itens, sempre.
7. **Isenções de NR fora da v1.** Uma NR de que a pessoa é isenta não vira item.
8. **`email`** é o corporativo; sem ele, o pessoal; sem nenhum, `null`.
9. **Status de conformidade calculado pela validade**, recalculado uma vez por dia para o que vence
   sem gravação. O FiltroAPP deve continuar calculando pela data da mobilização, como o contrato
   prevê — o status do envelope pode estar até um dia atrasado.
10. **Prefixo das rotas:** `/api/integracoes/filtroapp/v1/...` em vez de
    `/integrations/filtroapp/v1/...`.
11. **`isOperational`** do vínculo vem do departamento (o setor Operacional); o do cargo é uma
    marcação do RH no cadastro do cargo.
12. **Quem é publicado.** Todos os cargos e pisos. Vínculos: só de quem está, ou esteve depois da
    ativação, no setor Operacional — e, uma vez publicado, sempre republicado (saída do setor,
    desligamento, correções). Conformidade: só de pessoas com vínculo publicado.
13. **Retenção:** feed de 90 dias (o último evento de cada agregado é mantido), snapshot de 24 horas,
    link de evidência de 5 minutos.
14. **Evidência** devolve JSON com um link assinado, e não o arquivo nem um redirect:
    `{id, version, url, expiresAt}`.
15. **Status `PRE_ADMISSION` no vínculo.** O contrato prevê `ACTIVE`, `TERMINATED` e
    `CANCELLED`; o Conecta acrescenta `PRE_ADMISSION` para quem foi contratado e ainda não começou.
    O vínculo nasce na pré-admissão — com a admissão prevista, ou `admissionDate=null` se ainda não
    houver data —, junto com o cargo e a conformidade, e a ativação leva o **mesmo**
    `employmentId` a `ACTIVE`. Quem está em `PRE_ADMISSION` **pode ser mobilizado**, porque às
    vezes é preciso numa emergência, mas o FiltroAPP deve deixar claro que a pessoa ainda não foi
    ativada no RH (por exemplo, com um aviso e uma confirmação na hora de mobilizar). A data de
    admissão pode estar no futuro ou vir `null`. No Conecta, ninguém é ativado só porque a data
    chegou: a ativação é um ato do RH. Antes de começar há uma só ocorrência de cargo, vigente na admissão: trocar
    o cargo a substitui (`supersedesId`), e mudar a data a republica com o mesmo `id`. Desistência
    antes de começar sai `CANCELLED`, sem `terminationDate`.

## 2. Perguntas abertas

- O `employmentId` derivado (item 1) e o histórico curto (itens 2 e 4) atendem, ou vocês precisam
  de mais?
- O CPF deve ir no `employment` desde a primeira carga, ou só quando a conciliação pedir?
- O endpoint de status (`statusUrl`) devolve `{status, reasonCode?}`? É o que o Conecta lê.

## 3. Matriz de campos

| Agregado | Campo | Origem no Conecta | Observação |
| --- | --- | --- | --- |
| `job_role` | `id` | `cargos.id` | Não muda quando o nome muda |
| | `name`, `cbo` | `cargos.nome`, `cargos.cbo` | `cbo` vazio → `null` |
| | `isActive` | `cargos.ativo` | Cargo apagado sai `isActive=false` |
| | `isOperational` | `cargos.operacional` | Marcação do RH |
| `job_role_salary` | `id` | `cargo_salarios.id` | Uma ocorrência por vigência |
| | `amount` | `cargo_salarios.valor` | Texto, 2 casas, sem milhar |
| | `effectiveDate`, `status`, `supersedesId` | `cargo_salarios` | `currency=BRL`, `basis=MONTHLY` |
| `employment` | `personId` | `colaboradores.id` | Estável na recontratação |
| | `employmentId` | `integracao_vinculos` | Um por período |
| | `name`, `cpf`, `registrationNumber` | `colaboradores` | Cadastro atual |
| | `email` | `email_corporativo` ou `email_pessoal` | |
| | `isOperational` | departamento marcado como operacional | |
| | `admissionDate` | `colaboradores.data_admissao` | Do período; prevista (ou `null`) na pré-admissão |
| | `terminationDate` | `desligamentos.data` | Obrigatório em `TERMINATED` |
| | `status` | situação da ficha | Pré-admissão = `PRE_ADMISSION`; afastado = `ACTIVE`; desistência = `CANCELLED` |
| | `currentJobRoleId` | `colaboradores.cargo_id` | Para o vínculo anterior: o último cargo dele |
| `role_change` | todos | `mudancas_de_cargo` | `effectiveDate` informada na troca |
| `compliance` | `category` | tipo do item | NR → `TRAINING`; ASO e toxicológico → `EXAM`; CNH → `DOCUMENT` |
| | `typeCode`, `title` | sigla e nome do catálogo | NR-35, CBSP, HUET…; `ASO`, `TOXICOLOGICO`, `CNH` |
| | `issuedOn` | última realização | |
| | `expiresOn`, `hasNoExpiry` | validade do item | `expiresOn=null` e `hasNoExpiry=false` = desconhecida |
| | `status` | calculado | `REVOKED` inativo · `EXPIRED` vencido · `VALID` · `PENDING` sem realização · `UNKNOWN` |
| | `evidence` | arquivo da última realização | Só NR e CNH; `version` = ID da realização |

## 4. Exemplos sintéticos

```json
{
  "schemaVersion": "1.0",
  "eventId": "0b8f3c1e-2d4a-4f6b-9a7c-1e2f3a4b5c6d",
  "companyId": "00000000-0000-4000-8000-000000000001",
  "eventType": "employment.upserted",
  "aggregateType": "employment",
  "aggregateId": "7d1e2f3a-4b5c-4d6e-8f9a-0b1c2d3e4f5a",
  "revision": 3,
  "occurredAt": "2026-11-11T14:02:11Z",
  "data": {
    "personId": "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
    "employmentId": "7d1e2f3a-4b5c-4d6e-8f9a-0b1c2d3e4f5a",
    "name": "Pessoa de Exemplo",
    "cpf": null,
    "registrationNumber": "0045",
    "email": null,
    "isOperational": true,
    "admissionDate": "2026-03-02",
    "terminationDate": null,
    "status": "ACTIVE",
    "currentJobRoleId": "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f"
  }
}
```

```json
{
  "eventType": "job_role_salary.upserted",
  "aggregateType": "job_role_salary",
  "revision": 1,
  "data": {
    "id": "9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b",
    "jobRoleId": "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    "amount": "4250.00",
    "currency": "BRL",
    "basis": "MONTHLY",
    "effectiveDate": "2027-01-01",
    "status": "ACTIVE",
    "supersedesId": null
  }
}
```

```json
{
  "eventType": "compliance.upserted",
  "aggregateType": "compliance",
  "revision": 2,
  "data": {
    "id": "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b",
    "personId": "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
    "employmentId": null,
    "category": "TRAINING",
    "typeCode": "NR-35",
    "title": "NR-35 (Trabalho em altura)",
    "status": "VALID",
    "issuedOn": "2026-05-10",
    "expiresOn": "2028-05-10",
    "hasNoExpiry": false,
    "evidence": {
      "id": "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b",
      "version": "6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e",
      "contentType": "application/pdf",
      "fileName": "certificado-nr35.pdf",
      "authenticatedDownloadPath": "/api/integracoes/filtroapp/v1/evidence/3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b?version=6b7c8d9e-0f1a-4b2c-8d3e-4f5a6b7c8d9e",
      "expiresAt": null
    }
  }
}
```

## 5. API de leitura

Todas as rotas: `Authorization: Bearer <token>`, `companyId` obrigatório na query. Erros no formato
`{"error": {"code", "message"}, "requestId"}`, com o `requestId` também no cabeçalho
`X-Request-Id`. O contrato formal está em `docs/integracao-rh-filtroapp-openapi.yaml`.

| Rota | Escopo | Resposta |
| --- | --- | --- |
| `GET /changes?companyId=&cursor=&limit=` | `rh.leitura` | `{items, nextCursor, hasMore, generatedAt}` |
| `POST /snapshots?companyId=` | `rh.leitura` | `201 {snapshotId, watermarkCursor, expiresAt}` |
| `GET /snapshots/:id/{job-roles\|job-role-salaries\|employments\|role-changes\|compliance}` | idem (+ salarial para `job-role-salaries`) | `{items, nextCursor, hasMore, snapshotId, watermarkCursor}` |
| `GET /{recurso}/:id?companyId=` | idem | o envelope atual |
| `GET /evidence/:id?version=&companyId=` | `rh.leitura` | `{id, version, url, expiresAt}` |

- **Feed.** Ordem estável; páginas podem repetir eventos, nunca pulam. Comece sem cursor (ou pelo
  `watermarkCursor` de um snapshot) e guarde sempre o `nextCursor`, mesmo com `items` vazio. Um
  evento só aparece no feed depois de a transação que o gravou ficar definitiva — por isso o feed
  pode estar alguns segundos atrás da gravação. `limit` de 1 a 500 (padrão 100).
- **Cursor expirado:** `410 CURSOR_EXPIRED` — faça um snapshot.
- **Snapshot.** Todas as páginas vêm do mesmo estado. Depois da última página de todos os recursos,
  leia o feed a partir do `watermarkCursor`: as mudanças feitas durante a carga estão lá. Snapshot
  vencido: `410 SNAPSHOT_EXPIRED`. Snapshot de outra credencial: 404.
- **Salário.** Sem o escopo `rh.salarios.leitura`, o feed omite os eventos `job_role_salary`, e as
  rotas de salário respondem 403.
- **Evidência.** 404 se não há evidência (ou é ASO/toxicológico); 410 se o item foi revogado ou a
  versão foi substituída. Cada pedido gera um link novo de 5 minutos. Não registre o link em log.
- **Ausência não é exclusão.** Remoções chegam como evento: cargo `isActive=false`, vínculo
  `CANCELLED`, ocorrência `CANCELLED`, conformidade `REVOKED`.

## 6. Envio automático

Quando ligado, a cada 5 minutos o Conecta envia cada evento em
`POST /api/integracoes/v1/rh/conecta/eventos`, um por requisição, com `Idempotency-Key` igual ao
`eventId` e o mesmo corpo em toda tentativa. Cada agregado sai na ordem da revisão; um agregado
esperando nova tentativa não segura os outros.

- **202** (ou 200/201): guardamos `receiptId` e consultamos `statusUrl` até `APPLIED`,
  `SUPERSEDED` ou `FAILED`. `PENDING` é consultado a cada 30 minutos; os demais, a cada minuto.
- **Timeout, 429, 5xx:** nova tentativa em 30 s, 2 min, 10 min, 1 h e daí de hora em hora, com
  ±20% de variação; `Retry-After` manda quando vier (até 6 h).
- **400, 409, 413, 422:** o evento fica recusado, com o `error.code` de vocês, até o admin
  reenviar.
- **401, 403:** a rodada para (a credencial vale para todos) e tenta de novo em uma hora.

O envio nunca impede uma gravação do RH, e o feed tem os mesmos eventos — com os mesmos `eventId` e
revisões — para recuperação independente.

## 7. Configuração e operação

- **Credencial de leitura** (para o FiltroAPP): criada pelo admin em *Integração FiltroAPP*
  (`/admin/integracoes`). O token aparece uma vez; no banco fica só o SHA-256. Marque "salário-base"
  para dar o escopo salarial.
- **Rotação:** crie a credencial nova, troque no FiltroAPP, revogue a antiga. A revogação vale na
  requisição seguinte. Cursores do feed continuam válidos com a credencial nova; snapshots, não
  (são da credencial que os criou).
- **Credencial de envio** (do FiltroAPP para o Conecta): escopos `rh.conecta.eventos.write` e
  `rh.conecta.salarios.write`. O Conecta usa o mesmo token das alocações
  (`APP_FILTROVALI_TOKEN`), então esses escopos precisam ser dados à credencial que o Conecta já
  usa para ler as alocações. Se preferirem uma credencial separada, ela vai em
  `FILTROAPP_RH_TOKEN` e passa a valer no lugar da outra. O envio vai para o mesmo servidor da API
  das alocações (a origem de `API_FILTROVALI`). Os cursores são assinados com `ANALISE_SEGREDO`.
- **Painel:** atraso de entrega e de aplicação medidos à parte, contagens por estado, agregados que
  não foram publicados (republicados a cada 5 minutos), eventos recusados com o código e reenvio
  manual. Não mostra salário, CPF nem corpo.
- **Rotinas:** `integracao-rh-agenda` (5 min) e `integracao-rh-diaria` (03:10): pisos que começaram
  a valer, conformidade vencida, limpeza do feed e dos snapshots.
