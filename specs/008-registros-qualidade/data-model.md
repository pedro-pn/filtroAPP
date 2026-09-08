# Data Model — Módulo de Registros de Qualidade

## Enums (novos)

```prisma
enum QualityRecordType {
  DESVIO                // letra D
  LICAO_APRENDIDA       // letra L
  INCIDENTE             // letra I
  RECLAMACAO_CLIENTE    // letra R
  MELHORIA              // letra M
}

enum QualityImpact { ALTO  MEDIO  BAIXO }

enum QualityDisposition { TRATAR  MONITORAR  ARQUIVAR_DIVULGAR }

enum QualityStatus {
  ABERTO
  EM_TRIAGEM
  EM_OBSERVACAO
  EM_ACAO
  FECHADO
  DIVULGADO
}
```

Mapa Tipo → letra (usado na numeração): DESVIO→D, LICAO_APRENDIDA→L, INCIDENTE→I,
RECLAMACAO_CLIENTE→R, MELHORIA→M.

## Extensões de enums existentes

- `AppModule`: adicionar `QUALIDADE`.
- `ModuleRoleCode`: adicionar `QUALIDADE_MANAGER`, `QUALIDADE_VIEWER`.

## Entidade: QualityNature (Natureza / categoria)

| Campo | Tipo | Regras |
|-------|------|--------|
| id | String cuid | PK |
| name | String | obrigatório; **único case-insensitive** (índice único em `lower(name)`) |
| isActive | Boolean | default `true`; inativa não aparece em novos registros |
| createdAt / updatedAt | DateTime | padrão |
| records | QualityRecord[] | relação inversa |

Regras:
- Exclusão **bloqueada** se existir `QualityRecord` referenciando (FR-015). Orientar desativar.
- Renomear afeta todos os registros por referência (não copia texto).

## Entidade: QualityRecord (Registro)

| Campo | Tipo | Regras |
|-------|------|--------|
| id | String cuid | PK |
| number | String | Nº Registro gerado `L-NNN/AA`; **único**; imutável |
| type | QualityRecordType | obrigatório; define a letra do `number` |
| seq | Int | sequencial dentro de (type, year); base do `number` |
| year | Int | ano (4 díg.) da Data do Registro; base do reinício anual |
| registeredAt | DateTime (date) | obrigatório; default hoje na UI |
| origin | String | texto livre; obrigatório |
| projectId | String? | FK → Project; `null` = Interno/SGQ |
| eventDate | DateTime (date) | obrigatório; base da recorrência |
| natureId | String | FK → QualityNature; obrigatório |
| description | String (text) | obrigatório |
| impact | QualityImpact | obrigatório |
| linkedRnc | String? | texto livre ("—" quando não houver) |
| disposition | QualityDisposition | obrigatório |
| definedAction | String? | obrigatório **se** disposition = TRATAR |
| actionOwner | String? | texto livre |
| actionDeadline | DateTime? (date) | data-limite da ação |
| evidence | String? | legado/compatibilidade: primeira URL de evidência externa |
| evidences | QualityEvidence[] | lista de links/anexos vinculados ao registro |
| resultVerification | String? | texto livre |
| status | QualityStatus | obrigatório |
| createdBy / updatedBy | String? | FK → User (auditoria, opcional) |
| createdAt / updatedAt | DateTime | padrão |

Índices sugeridos: `@@unique([number])`, `@@index([projectId, type])` (query da seção Desvios),
`@@index([natureId, eventDate])` (recorrência), `@@unique([type, year, seq])`.

### Campos derivados (NÃO persistidos)

- **occurrences12m**: `count( QualityRecord r2 where r2.natureId = r.natureId and r2.eventDate in [r.eventDate - 12 meses, r.eventDate] )`.
- **recurrent**: `occurrences12m >= 3` → "SIM", senão "não".

Calculados no serviço/leitura (ver `lib/qualidade/recurrence.js`).

## Entidade: QualityEvidence (Evidência)

| Campo | Tipo | Regras |
|-------|------|--------|
| recordId | String | FK → QualityRecord; cascade no hard delete |
| kind | QualityEvidenceKind | `LINK` ou `ATTACHMENT` |
| label | String? | rótulo opcional |
| url | String? | obrigatório quando `kind = LINK`; http/https |
| fileName | String? | nome original quando `kind = ATTACHMENT` |
| mimeType | String? | `application/pdf` ou imagem suportada |
| storagePath | String? | caminho gerenciado sob `Qualidade/Evidencias` |
| publicToken | String? | token público aleatório do anexo |
| position | Int | ordem de exibição/exportação |

## Entidade: QualityRecordSeq (controle de numeração)

| Campo | Tipo | Regras |
|-------|------|--------|
| type | QualityRecordType | parte da PK |
| year | Int | parte da PK |
| lastSeq | Int | último sequencial emitido; default 0 |

Chave: `@@id([type, year])`. Incremento atômico dentro da transação de criação do registro.

## Relações

- `Project 1 — 0..N QualityRecord` (via `projectId`, `onDelete: SetNull` para não perder o registro
  se o projeto for removido — o histórico de qualidade é preservado).
- `QualityNature 1 — 0..N QualityRecord` (via `natureId`, `onDelete: Restrict`).

## Transições de Status

Fluxo típico (não bloqueante na v1 — qualquer transição permitida pelo gestor, mas documentado):
`Aberto → Em triagem → Em observação | Em ação → Fechado | Divulgado`. A v1 não impõe máquina de
estados rígida; validação garante apenas que o valor pertence ao enum.
