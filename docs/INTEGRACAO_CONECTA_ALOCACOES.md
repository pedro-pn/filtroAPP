# Alocação conferida — FiltroAPP → Conecta

## Consulta

`GET /api/integracoes/v1/efetivo/conferencia/alocacoes`

Autenticação: `Authorization: Bearer <token técnico>`. No hub, um administrador
deve criar uma credencial exclusiva do Conecta com o escopo
`efetivo.conferencia.read` e acesso `ALL` (todos os projetos). Dias na sede e
afastamentos não pertencem a projetos e exigem autorização para o calendário
completo. Não é necessário liberar salários ou outras operações.

O endpoint integra o catálogo, playground, auditoria e cotas existentes.
Disponível após publicar o backend atualizado; não exige migration adicional
além das migrations da própria conferência semanal já existente.

```bash
curl --fail-with-body --get \
  "$FILTRO_API_BASE_URL/api/integracoes/v1/efetivo/conferencia/alocacoes" \
  -H "Authorization: Bearer $FILTRO_API_TOKEN" \
  --data-urlencode 'from=2026-10-01' \
  --data-urlencode 'to=2026-10-31' \
  --data-urlencode 'limit=100'
```

`FILTRO_API_BASE_URL` é a origem informada pela equipe do FiltroAPP, sem `/api`.
Segredos devem permanecer exclusivamente no backend do Conecta.

| Parâmetro | Obrigatório | Semântica |
| --- | --- | --- |
| `from` | Sim | Primeiro dia, `AAAA-MM-DD`, inclusivo. |
| `to` | Sim | Último dia, inclusivo; até 93 dias por consulta. |
| `collaboratorId` | Não | ID interno do colaborador no FiltroAPP. |
| `limit` | Não | 1–500, respeitando o teto da credencial; padrão até 100. |
| `cursor` | Não | `page.nextCursor` da página anterior, codificado na URL. |

Não aceita `updatedSince`, `snapshotAt`, seleção de campos ou filtros arbitrários.
Ordenação: data crescente, depois ID do colaborador. O limite conta dias, não
projetos; todos os projetos do mesmo dia ficam no mesmo item.

## Resposta sintética

```json
{
  "items": [
    {
      "id": "dia-exemplo",
      "date": "2026-10-01",
      "kind": "TRAVEL",
      "collaborator": {
        "id": "colaborador-exemplo",
        "code": "0042",
        "name": "Pessoa de Exemplo",
        "registrationNumber": "000123"
      },
      "projects": [
        {
          "id": "projeto-exemplo",
          "code": "05747",
          "name": "Projeto de exemplo",
          "clientName": "Cliente de exemplo",
          "clientCnpj": "12345678000195"
        }
      ],
      "confirmedAt": "2026-10-05T12:00:00.000Z",
      "weekStart": "2026-09-28",
      "weekVersion": 3,
      "updatedAt": "2026-10-05T12:00:00.000Z"
    }
  ],
  "page": {
    "limit": 100,
    "hasMore": false,
    "nextCursor": null,
    "snapshotAt": "2026-11-05T12:00:00.000Z"
  },
  "generatedAt": "2026-11-05T12:00:00.000Z",
  "schemaVersion": "1.0",
  "requestId": "requisicao-exemplo"
}
```

| `kind` | Exibição | Projetos |
| --- | --- | --- |
| `PROJECT` | Número do projeto e cliente | Um ou mais; exibir todos. |
| `TRAVEL` | Viagem + projeto de destino | Exatamente um. |
| `SEDE` | Sede | Lista vazia. |
| `FOLGA` | Folga | Lista vazia. |
| `FERIAS` | Férias | Lista vazia. |
| `AFASTAMENTO` | Afastamento | Lista vazia; sem motivo clínico. |
| `TREINAMENTO` | Treinamento | Lista vazia. |

`projects[].code` é o número do projeto e deve ser tratado como texto.
`clientCnpj` retorna 14 dígitos sem máscara, preservando zeros; `null` indica
ausência ou tamanho inválido no cadastro, sem completar ou truncar números.
Não há validação de dígito verificador nesta exportação. Sede não possui projeto
ou CNPJ de cliente neste modelo; o endpoint não inventa CNPJ da empresa.

Somente dias persistidos de linhas conferidas (`confirmedAt != null`) são
publicados. A semana pode estar aberta; fechamento semanal não é requisito.
Colaboradores hoje inativos e projetos arquivados continuam no histórico.
Se algum projeto de um dia estiver excluído ou indisponível para o canal API,
o dia inteiro é omitido para não publicar uma alocação parcial.

Ausência de um dia significa **sem conferência publicada**; não significa sede,
folga ou falta. Não contém sugestões, rascunhos, observações livres, CPF,
salários ou identidade de quem conferiu. Nome, matrícula, código e dados do
cliente refletem o cadastro atual; não são snapshots históricos do cadastro.

## Importação e correções

1. Importar um período completo, preferencialmente um mês por vez, em área
   temporária. Repetir as requisições mantendo `from`, `to` e `collaboratorId`,
   passando `page.nextCursor` até `hasMore=false`.
2. Conciliar pessoas por vínculo explícito entre `collaborator.id` e o cadastro
   do Conecta. Matrícula pode ajudar se for única e compatível. Não presumir que
   `code` seja a matrícula nem associar automaticamente apenas por nome.
3. Depois de concluir todas as páginas, substituir atomicamente apenas os dados
   dessa integração no período e colaborador consultados. Chave lógica:
   `(collaborator.id, date)`. Remover entradas antigas ausentes da nova consulta,
   inclusive quando a resposta completa for vazia. Preservar dados próprios do RH.
4. Não aplicar páginas parciais. Se ocorrer `409 ALLOCATION_REVIEW_CHANGED`,
   descartar a área temporária e reiniciar o período sem cursor. O cursor é
   assinado, vinculado à credencial/filtros e verifica revisões das semanas e
   alterações dos cadastros referenciados, dentro de leituras Repeatable Read.
5. Reconsultar periodicamente períodos já importados: desconfirmações, edições,
   exclusões e correções retroativas não geram tombstones neste endpoint.
   `updatedAt` do dia não detecta desconfirmação; não implementar incremental
   usando esse campo. Disponibilizar reimportação manual de qualquer mês.

Em timeout, 429 e 5xx, repetir com backoff e respeitar `Retry-After`. Em 400,
corrigir parâmetros/cursor; em 401/403, corrigir credencial/permissões. Registrar
`requestId`, período, quantidade e resultado sem token ou payload pessoal em logs.
Se a credencial for rotacionada durante a importação, reiniciar sem cursor.

Contrato formal: [OpenAPI](../specs/015-api-token-playground/contracts/openapi.yaml).
Esta exportação é independente da proposta de recepção de eventos de RH
documentada em `specs/036-integracao-conecta/`.
