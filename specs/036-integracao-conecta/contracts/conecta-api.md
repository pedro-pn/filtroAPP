# Contrato proposto v1 — FiltroAPP ↔ Conecta

Estado: proposta para homologação bilateral. Rotas novas abaixo ainda não implementadas. Prefixos do lado Conecta são sugestões, podendo ser adaptados mantendo a semântica. JSON UTF-8, HTTPS, IDs como strings, datas civis YYYY-MM-DD, instantes RFC3339 UTC; vigência civil em America/Sao_Paulo. Empresa identifica o escopo em todas as operações.

## Divisão de responsabilidades

Conecta: origem dos fatos de RH, outbox transacional, eventos estáveis, histórico e feed/snapshot recuperável. FiltroAPP: autenticação técnica, inbox, deduplicação, vínculo com dados existentes, catálogo canônico, aplicação, pendências e projeção operacional. Sincronizar salário-base por função. Não sincronizar salário individual, folha, diagnósticos médicos, assinatura biométrica, permissões ou contas de usuário.

## API a implementar no FiltroAPP

Autenticação Authorization: Bearer <token técnico>, usando infraestrutura já existente. Escopos novos propostos: rh.conecta.eventos.write, rh.conecta.status.read, rh.conecta.conciliacao.read e rh.conecta.salarios.write (adicional obrigatório para evento salarial); resolução de mapeamento/replay somente por operação administrativa específica e auditada. Credencial vinculada às empresas autorizadas, sem acesso implícito ao restante do APP ou a salários. Incluir operações no catálogo, limites, quota e simulação atuais.

| Método/rota sob /api/integracoes/v1 | Semântica |
|---|---|
| POST /rh/conecta/eventos | Um envelope por requisição; persistir inbox e devolver 202 com receiptId/eventId/statusUrl. Reenvio idêntico retorna mesmo receiptId sem efeitos adicionais. |
| GET /rh/conecta/eventos/:eventId | Estado RECEIVED, PROCESSING, APPLIED, PENDING, RETRY, FAILED ou SUPERSEDED; código sanitizado e referências autorizadas. eventId consultado no escopo da empresa da credencial/query companyId. |
| GET /rh/conecta/conciliacao/cargos?companyId=...&cursor=...&limit=... | Catálogo local autorizado com id, name, normalizedKey, isActive, isOperational e mapeamento externo existente. Não retorna salário. |
| GET /rh/conecta/sincronizacao?companyId=... | Última recepção/aplicação/reconciliação, atraso e contadores sem dados pessoais. |

Idempotency-Key obrigatório, igual ao eventId. Unicidade origem/empresa/eventId. Mesmo ID com payload diferente: 409 IDEMPOTENCY_CONFLICT. 400 para JSON inválido, 422 para schema inválido, 401/403 para autenticação/escopo/empresa, 429 com Retry-After, 5xx para falha transitória. Adaptar corpo dos erros ao padrão existente de requestId. Conflitos de domínio descobertos após recepção viram PENDING com código de motivo; não perder o evento. Limite inicial proposto 256 KiB/envelope, sem binários/base64; arrays maiores devem ser paginados ou representados por agregados separados. Exceder tamanho: 413.

## Envelope

```json
{
  "schemaVersion": "1.0",
  "eventId": "evt-01",
  "companyId": "empresa-01",
  "eventType": "employment.upserted",
  "aggregateType": "employment",
  "aggregateId": "vinculo-123",
  "revision": 7,
  "occurredAt": "2026-10-29T13:00:00Z",
  "data": {
    "personId": "pessoa-45",
    "employmentId": "vinculo-123",
    "name": "Pessoa de Exemplo",
    "cpf": null,
    "registrationNumber": "0045",
    "email": null,
    "isOperational": true,
    "admissionDate": "2026-03-02",
    "terminationDate": null,
    "status": "ACTIVE",
    "currentJobRoleId": "cargo-07"
  }
}
```

revision: inteiro positivo monotônico por empresa/tipo/ID do agregado. occurredAt é momento da alteração na origem, não vigência. eventId imutável no retry; nova revisão/correção recebe novo eventId. Envelopes representam estado completo do agregado identificado, sem omissão ambígua: null limpa campo anulável; campo obrigatório ausente é inválido. Tipos e enums descritos abaixo são parte do acordo proposto. Não usar um contador global para substituir revisão por agregado.

## Agregados e dados

- **job_role.upserted**, aggregateType=job_role: id, name, isActive, isOperational; cbo opcional/null. ID estável mesmo se nome mudar. Inativação não apaga histórico. FiltroAPP reutiliza mapeamento; sem ele, normalização exata única e compatível associa automaticamente. Abreviação/pontuação/similaridade sugerem resolução, sem criação de possível duplicata. Preservar níveis e especialidade.
- **employment.upserted**, aggregateType=employment: dados do exemplo. CPF opcional ajuda conciliação, nunca aparece em logs gerais. status ACTIVE/TERMINATED/CANCELLED; terminationDate é último dia elegível inclusive e obrigatório para TERMINATED. Para desligamento futuro, já informar TERMINATED com data futura: FiltroAPP calcula elegibilidade pela data, não só pelo status recebido. Correção para ACTIVE com terminationDate=null cancela desligamento. personId estável na recontratação; employmentId novo, preservando anterior. currentJobRoleId é conferência do estado da origem; vigência precisa de role_change separado. Dados não operacionais de pessoas nunca vinculadas podem ser ignorados auditavelmente; vínculos já importados devem continuar recebendo saída do escopo operacional, desligamentos e correções.
- **role_change.upserted**, aggregateType=role_change: id (ocorrência), personId, employmentId, jobRoleId, effectiveDate, status ACTIVE/CANCELLED, supersedesId opcional/null. A revisão desta ocorrência corrige data/cargo ou cancela explicitamente; não inferir remoção por ausência. Enviar cargo inicial na admissão e histórico disponível. Uma atribuição final por pessoa/data: mudanças intermediárias no mesmo dia devem ser consolidadas explicitamente, com ocorrências substituídas canceladas ou referenciadas. Colisão não resolvida fica pendente no FiltroAPP, sem last-write-wins entre ocorrências distintas.
- **compliance.upserted**, aggregateType=compliance: id, personId, employmentId opcional/null para documento aplicável à pessoa, category DOCUMENT/EXAM/TRAINING/CERTIFICATE, typeCode, title, status VALID/EXPIRED/REVOKED/PENDING/UNKNOWN, issuedOn opcional/null, expiresOn opcional/null, hasNoExpiry boolean, evidence opcional/null. Se hasNoExpiry=false e validade desconhecida, expiresOn=null significa desconhecido, nunca validade ilimitada. Evidência: id, version, contentType, fileName, authenticatedDownloadPath ou URL e expiresAt quando temporária. Tipos/versionamento devem ser estáveis. Download autorizado servidor a servidor; não URL pública permanente nem segredo no payload. FiltroAPP calcula validade na data da mobilização e não depende apenas do status atual.

Dependências podem chegar fora de ordem: FiltroAPP mantém PENDING e tenta recuperar cargo/pessoa/vínculo via feed ou consulta individual. Não criar pessoa incompleta com cargo inventado. Revisão menor é SUPERSEDED somente se houver estado completo mais recente do mesmo agregado; não comparar a revisão de employment com role_change.

## API a disponibilizar no Conecta

Autenticação servidor a servidor configurável, escopos mínimos somente leitura para empresas permitidas. Segredos ficam no ambiente, nunca no frontend.

1. `GET /integrations/filtroapp/v1/changes?companyId=...&cursor=...&limit=...`: feed durável de todos os envelopes, inclusive correções, cancelamentos, desligados e saída de classificação operacional. Corpo `{items, nextCursor, hasMore, generatedAt}`. Cursor opaco representa posição estável; páginas podem repetir, mas não pular mudanças. Conecta define/documenta retenção; proposta mínima 90 dias. Cursor expirado: 410 CURSOR_EXPIRED, exigindo snapshot consistente.
2. `POST /integrations/filtroapp/v1/snapshots` com companyId: iniciar leitura consistente e retornar snapshotId e watermarkCursor do feed. Não é mutação de RH. `GET /.../snapshots/:id/{job-roles|job-role-salaries|employments|role-changes|compliance}?cursor=...&limit=...` retorna `{items,nextCursor,hasMore,snapshotId,watermarkCursor}`; itens são os mesmos envelopes completos versionados. Documentar expiração do snapshot; nunca misturar páginas de estados diferentes. Após todas as páginas persistidas, consumir mudanças depois do watermark, sem lacuna. Incluir desligados e histórico requerido, não apenas funcionários ativos.
3. `GET /.../{job-roles|job-role-salaries|employments|role-changes|compliance}/:id?companyId=...`: recuperar estado atual versionado para dependências e diagnóstico.
4. `GET /.../evidence/:id?version=...&companyId=...`: download autorizado ou link curto renovável, preservando versão; 403/404/410 explícitos. FiltroAPP valida destino permitido para URLs externas e não registra links assinados em logs.

Carga inicial: cargos → salários por função → vínculos/pessoas → mudanças → conformidade; eventos fora de ordem continuam recuperáveis. Dados ausentes no snapshot não autorizam exclusão; exigir tombstone explícito. Remoções na origem publicam cancelamento/revogação, mantendo referência histórica. Feed deve conter eventos também durante falhas de webhook e oferecer mesmas revisões/IDs por ambos os caminhos.

## Entrega e recuperação

Outbox na mesma transação do fato de RH; envio em worker após commit. Em 202, guardar receiptId; acompanhar status até terminal. APPLIED/SUPERSEDED são concluídos; PENDING aguarda dependência/resolução, FAILED requer correção ou replay administrativo. Repetir transporte com mesmo envelope em timeout/429/5xx, backoff exponencial com jitter e Retry-After; não repetir indefinidamente 401/403/409/422 sem correção. Falha de transporte não deve impedir salvar RH no Conecta. Feed permite ao FiltroAPP recuperar independentemente do envio.

Revisões/eventos aplicados e suas projeções são atômicos no FiltroAPP. Inbox usa leases para reinício seguro; ordenação por agregado e constraints protegem concorrência. Reconciliação incremental a cada 15 minutos e snapshot diário são parâmetros iniciais propostos. Medir atraso de entrega e aplicação separadamente. Documentar revogação/rotação de credenciais e limites em homologação.

## Salário por função — agregado adicional

**job_role_salary.upserted**, aggregateType=job_role_salary. data completo:

```json
{
  "id": "salary-occurrence-01",
  "jobRoleId": "cargo-07",
  "amount": "4086.57",
  "currency": "BRL",
  "basis": "MONTHLY",
  "effectiveDate": "2026-11-01",
  "status": "ACTIVE",
  "supersedesId": null
}
```

companyId continua obrigatório no envelope. amount é string decimal não negativa com exatamente duas casas; null/ausência não é zero. Sem separador de milhares, arredondamento silencioso ou número binário de ponto flutuante. ID identifica uma ocorrência de vigência, não apenas o cargo; reajuste em nova data recebe outro ID. Correção/cancelamento da ocorrência mantém ID com revision maior e status ACTIVE/CANCELLED. Consolidar conflitos na mesma função/contexto/data explicitamente; FiltroAPP não resolve por ordem de chegada.

Fornecer salário-base mensal de referência da função, sem encargos, adicionais individuais, benefícios, líquido ou custo total. Se houver múltiplas tabelas/jornadas por função, informar as dimensões necessárias para estender e homologar este schema antes de ativar; não enviar valores distintos no mesmo contexto como se equivalentes. Não obter salário da função escolhendo salário de um funcionário. A ausência de tabela por função no Conecta é limitação a declarar.

Incluir histórico salarial e ocorrências futuras/canceladas em feed, snapshots e consulta individual `job-role-salaries`. API do Conecta deve autorizar leitura salarial separadamente. FiltroAPP aplica o valor pela vigência ao cargo canônico mapeado e preserva os demais parâmetros de custo locais. Cargo não mapeado ou perfil incompatível fica PENDING.

No FiltroAPP, recepção salarial exige rh.conecta.eventos.write + rh.conecta.salarios.write. Status/painéis/logs não expõem amount ou payload sem autorização salarial; manter cargos.salarios.read na consulta já existente GET /api/integracoes/v1/cargos/:id/salario?referenceDate=YYYY-MM-DD. A conciliação geral de cargos continua sem valores. Reprocessamento e simulação salariais obedecem às mesmas restrições e não geram escrita posterior em modo simulado.
