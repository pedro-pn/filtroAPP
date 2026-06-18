# Plano — Dados Técnicos configuráveis por categoria (Módulo Equipamentos)

> Foco: arquitetura + produto. Aproveita o módulo Equipamentos já existente
> (`EquipmentCategory` + `CompanyEquipment` + `EquipmentAttachment`) e o **pipeline
> DOCX→PDF que o app já tem** (`report-rlm.js`/`epi-docx.js` + `report-pdf-from-docx.js`
> via LibreOffice headless). Última atualização: 2026-06-18.

---

## 1. Visão geral da solução proposta

Substituir o PDF de "documentação técnica" anexado manualmente por uma **aba "Dados
Técnicos"** dentro de cada equipamento, com **formulário dinâmico dirigido pela
categoria**. O gestor configura, por categoria, *quais campos técnicos existem* (rótulo,
tipo, unidade, se é repetível, se é opcional). Todo equipamento da categoria herda esse
formulário; quem opera apenas preenche/edita os valores. No download, o app **mescla os
valores num template DOCX da categoria e converte para PDF** usando a infraestrutura que já
existe — nenhum campo é hard-coded por tipo de equipamento.

Princípios:

- **Configuração, não código.** Campos vivem em dados (JSON na categoria), não em `if`s por
  categoria. Adicionar "Bomba pneumática" ou um campo novo é tarefa de gestor, não de deploy.
- **Reuso máximo.** Estende-se o `fieldSchema`/`attributes` dinâmicos já usados e o gerador
  DOCX→PDF já validado em produção; evita-se introduzir engine de template nova.
- **Separação de responsabilidades.** Os dados técnicos ficam num *namespace próprio*
  (`technicalSchema`/`technicalData`), isolado dos campos que o RDO/Romaneio consomem via
  `systemKey` — assim a camada de compatibilidade do RDO não é afetada.

---

## 2. Modelo de dados recomendado

Recomendação: **JSON-first**, seguindo o padrão já adotado no módulo (schema na categoria,
valores no equipamento). É mais simples, casa com o código atual e o uso é
predominantemente "preencher e imprimir", não consulta analítica.

**Estender `EquipmentCategory`:**
- `technicalSchema` (JSON) — definição dos campos técnicos da categoria (ver §3).
- `technicalTemplateId` (FK → `EquipmentAttachment`) — DOCX modelo da categoria (opcional;
  fallback para um modelo genérico).
- `technicalDocEnabled` (bool) — liga a aba para a categoria (substitui o antigo
  `supportsTechnicalDoc`).

**Estender `CompanyEquipment`:**
- `technicalData` (JSON) — valores por `key` do schema (ver formato em §4).
- `technicalFieldOverrides` (JSON, opcional) — inclusão/exclusão de campos opcionais por
  equipamento (ver §6 do requisito — campo existe na categoria mas não em todo equipamento).
- `technicalRevision` / `technicalUpdatedAt` — controle de revisão do datasheet.

**`EquipmentAttachment`** (reusar, novos `kind`):
- `TECHNICAL_TEMPLATE` — DOCX modelo, vinculado à categoria.
- `TECHNICAL_DOC_GENERATED` — último PDF gerado (cache, regenerável a qualquer momento).

**Catálogo de unidades** — `backend/src/lib/equipment-units.js` (config estática, não tabela):
mapa `grandeza → { units[], default }`. Editável por código/seed; vira tabela só se o gestor
precisar gerenciar unidades pela UI no futuro.

> Alternativa normalizada (caso surja necessidade de relatórios/filtros por valor técnico):
> tabelas `EquipmentTechnicalField` (definição) + `EquipmentTechnicalValue`
> (`equipmentId`, `fieldKey`, `rawValue`, `numberValue`, `unit`, `valueJson`, `index`). É a
> que o JSON anexo sugere; mantê-la como plano B documentado, não como ponto de partida.

---

## 3. Como configurar campos técnicos por categoria

Construtor de campos na aba **Configurações → categoria** (estende o `CategoryFormModal`
atual). Cada item de `technicalSchema` é um objeto:

```
{ key, label, type, group?, unit:{dimension, default}?, options?[],
  required, optionalPerEquipment, repeatable, itemSchema?[], order, showInDoc }
```

**Vocabulário de tipos unificado** (estende os atuais text/number/date/select/textarea):

| type        | uso                                  | armazena                    |
|-------------|--------------------------------------|-----------------------------|
| `text`      | texto curto                          | string                      |
| `textarea`  | observação longa                     | string                      |
| `number`    | número puro                          | number                      |
| `measure`   | número + unidade (grandeza)          | `{ value, unit }`           |
| `select`    | seleção única (com `options`)        | string                      |
| `multiselect`| seleção múltipla                    | string[]                    |
| `boolean`   | sim/não                              | bool                        |
| `date`      | data                                 | ISO date                    |
| `group`     | conjunto repetível (componentes)     | array de objetos (§6)       |

Recursos do construtor:
- **Agrupar** campos por seção (`group`: "Elétrico", "Mecânico", "Dimensional") para a UI e
  para o DOCX.
- Marcar `optionalPerEquipment` (o campo aparece para a categoria mas pode ser
  desligado/omisso por equipamento) e `showInDoc` (entra ou não no datasheet gerado).
- `key` imutável após criado (slug); `label` editável — mesmo princípio do `systemKey` da
  categoria, para não quebrar valores já preenchidos nem o template.
- Reordenação por arrastar (já existe esse padrão no `CategoryManager`).

---

## 4. Preenchimento dos dados técnicos no equipamento

Nova aba **"Dados Técnicos"** no detalhe do equipamento (ao lado de Calibração/Anexos):

1. O form é **renderizado a partir do `technicalSchema` da categoria** — sem nada hard-coded.
2. Cada widget corresponde ao `type` (campo `measure` mostra input + *dropdown de unidade*
   filtrado pela grandeza; `group` mostra lista repetível com botão "adicionar/remover").
3. Salvar grava em `CompanyEquipment.technicalData`, no formato:

```
{
  "pressao_maxima": { "value": 9.6, "unit": "bar" },
  "tipo_de_fluido": "Óleo combustível",
  "possui_dreno": true,
  "motores": [ { "potencia": {"value":2,"unit":"CV"}, "tensao": {"value":380,"unit":"V"} } ]
}
```

4. Campos vazios são permitidos (`allow_empty`) e **não aparecem no documento gerado** —
   resolve naturalmente o caso "campo existe na categoria mas não neste equipamento".
5. Botões **"Gerar documento"** e **"Baixar PDF"** ficam nessa aba (ver §7).

UX: agrupar por seção, mostrar a unidade ao lado do valor, validação leve (número onde é
número), e indicador de "datasheet desatualizado" se `technicalData` mudou após o último PDF.

---

## 5. Estratégia para unidades de medida

Catálogo central por **grandeza** (`dimension`), não por categoria — o gestor escolhe a
grandeza ao criar o campo `measure`, e o sistema oferece as unidades adequadas. Semente
inicial (derivada dos `unit_hint` do JSON):

| grandeza      | unidades sugeridas                | default |
|---------------|-----------------------------------|---------|
| pressão       | bar, kgf/cm², psi, kPa, MPa       | bar     |
| vazão         | L/min, m³/h, L/h, GPM             | L/min   |
| potência      | kW, CV, hp, W                     | kW      |
| tensão        | V, kV, VCA, VCC                   | V       |
| corrente      | A, mA                             | A       |
| temperatura   | °C, °F, K                         | °C      |
| dimensão      | mm, cm, m, pol                    | mm      |
| peso          | kg, g, t                          | kg      |
| rotação       | rpm                               | rpm     |
| volume        | L, m³, mL                         | L       |
| viscosidade   | cSt, cP                           | cSt     |
| tempo         | s, min, h                         | min     |
| frequência    | Hz                                | Hz      |

Regras:
- Armazenar **valor e unidade separados** (`{value, unit}`) — permite exibir, converter no
  futuro e imprimir de forma consistente.
- Unidade default por grandeza, sobreponível no campo e no preenchimento.
- Permitir um valor "texto livre" de fallback no `measure` (ex.: "10 a 30") para casos em que
  o dado bruto não é um número único — guardar como `rawText` quando não parsear.

---

## 6. Campos repetíveis / componentes

Tipo `group` com `repeatable: true` cobre conjuntos repetidos (motores, bombas, filtros,
resistências, manômetros). A definição traz um `itemSchema` (lista de campos como qualquer
outro) e o valor é um **array de objetos**:

- Categoria define o componente uma vez (ex.: grupo "Motores" com campos potência, tensão,
  corrente, rpm).
- Equipamento adiciona N instâncias; cada instância é um objeto no array.
- No JSON anexo, os 9 campos marcados `allow_multiple` (potência/tensão/corrente/rpm de
  motores e bombas) migram para **um grupo repetível** em vez de campos soltos — melhoria de
  normalização recomendada ao importar.
- Limites opcionais (`minItems`/`maxItems`) e rótulo do item ("Motor #1") para a UI e o DOCX.

---

## 7. Geração do DOCX/PDF

**Reusar o pipeline existente** — não introduzir docxtemplater:

- Templating já usado em `report-rlm.js`/`epi-docx.js`: abre o `.docx` com `AdmZip`, edita
  `word/document.xml` com `@xmldom`, substitui tokens `{{campo}}` e **clona linhas de tabela
  (`w:tr`) para listas repetíveis**.
- Conversão por `convertDocxToPdf()` em `report-pdf-from-docx.js` (LibreOffice headless, fila
  serial — já resolve concorrência).

Mapeamento campo → template:
- O token é o `key` do campo: `{{pressao_maxima}}`. Para `measure`, um helper formata
  `value + unit` ("9,6 bar"); booleano vira "Sim/Não"; data em pt-BR (helpers já existem).
- Grupos repetíveis usam o padrão de **clonar `w:tr`**: a linha-modelo contém
  `{{motores.potencia}}`/`{{motores.tensao}}` e é replicada por instância.
- Um **`technicalDocBuilder.js`** novo: recebe `equipment` + `category.technicalSchema`,
  monta o dicionário de tokens (achatando measures/groups), aplica no template da categoria,
  gera DOCX e chama a conversão para PDF.
- **Estratégia de template (DECIDIDO): genérico primeiro.** Começar com um **modelo genérico
  único** que itera os campos preenchidos (tabela rótulo→valor agrupada por seção) — toda
  categoria gera datasheet desde o dia 1. Templates dedicados por categoria
  (`EquipmentAttachment(kind=TECHNICAL_TEMPLATE)`) entram depois, na Etapa F, sem mudar o
  modelo de dados.
- PDF gerado servido pela rota pública por token já existente
  (`/api/equipamentos-anexos/:token`); cache opcional como `TECHNICAL_DOC_GENERATED`,
  invalidado quando `technicalData` muda.

---

## 8. Como usar o JSON anexo como configuração inicial

`schema_categorias_dados_tecnicos.json` (18 categorias, 32 PDFs) vira **seed do
`technicalSchema`** via script de backfill (no padrão dos `backfill-*` já existentes):

1. Para cada `categoria`, criar/atualizar a `EquipmentCategory` (`codigo_categoria` →
   `systemKey`) e gravar `technicalSchema` a partir de `campos_tecnicos`.
2. **Normalizar tipos** do JSON para o vocabulário unificado:
   - `short_text`→`text`, `long_text`→`textarea`, `integer_or_text`→`number`,
     `measurement_text`→`measure` (inferir `dimension` a partir do `unit_hint`).
3. **Mapear `unit_hint`→grandeza** (ex.: `"bar / kgf/cm² / psi"`→pressão; `"L/min ou m³/h"`→
   vazão; `"CV / kW / hp / W"`→potência; `"V / VCA"`→tensão; `"A ou kW"`→corrente;
   `"°C"`→temperatura; `"rpm"`→rotação; `"L"/"L / m³"`→volume; `"cSt"`→viscosidade;
   `"cm/m"`→dimensão; `"kg"`→peso; `"tempo"`→tempo).
4. **Consolidar repetíveis**: os `allow_multiple:true` (motores/bombas) viram grupo
   repetível em vez de campos soltos.
5. Tratar `present_in`/`notes "não aparece em todos…"` como `optionalPerEquipment: true`.
6. Importar os valores de exemplo (`example_values`/`meta`) **apenas em ambiente de teste**,
   não como dado de produção.
7. Reaproveitar `campos_base_equipamento` (peso, dimensões, patrimônio, revisão) — já cobertos
   pelos campos do equipamento; não duplicar no `technicalSchema`.

O script é **idempotente** (pula categoria/campo já existente por `key`) e roda como
`npm run backfill:equipment-technical`.

---

## 9. Pontos de atenção, riscos e decisões importantes

- **Imutabilidade de `key`.** Renomear rótulo é livre; mudar `key` quebra `technicalData` e
  tokens do template. Bloquear edição de `key` na UI.
- **Convivência com o PDF legado (DECIDIDO).** Manter o `TECHNICAL_DOC` antigo como
  histórico; o datasheet gerado passa a ser a fonte oficial, com aviso na UI. Nada é apagado.
- **Não tocar no RDO/Romaneio.** Dados técnicos são namespace à parte; a compatibilidade por
  `systemKey` (units/manometers/counters) não deve depender de `technicalSchema`.
- **Dependência de LibreOffice.** A geração herda a fila serial e o tempo de conversão já
  conhecidos; sob carga, gerar sob demanda + cache evita reprocessar.
- **Migração de tipos solta→grupo** (motores) muda a forma do dado; fazer no backfill antes de
  qualquer preenchimento manual.
- **Qualidade do JSON de origem.** Valores brutos inconsistentes (ex.: "9,6 bar", "10 a 30 ºC");
  por isso `measure` precisa do fallback `rawText`. Não confiar em parse perfeito.
- **JSON vs normalizado.** Assumir JSON-first conscientemente; se aparecer requisito de busca
  por valor técnico, promover para as tabelas do plano B (§2).
- **Performance da UI.** Categorias com muitos campos/grupos: render por seção e lazy nas
  tabelas repetíveis.

---

## 10. Plano de implementação por etapas

**Etapa A — Modelo & schema técnico ✅ (feita, falta deploy)** — commit `747500de`
- [x] Migração `20260618120000_equipment_technical_data`: `technicalSchema`,
  `technicalTemplateId`, `technicalDocEnabled` em `EquipmentCategory`; `technicalData`,
  `technicalFieldOverrides`, `technicalRevision`, `technicalUpdatedAt` em `CompanyEquipment`;
  enum `EquipmentAttachmentKind` += `TECHNICAL_TEMPLATE`/`TECHNICAL_DOC_GENERATED`.
- [x] `equipment-units.js` (13 grandezas/unidades + mapa `unit_hint`→grandeza) +
  `normalizeTechnicalSchema()` (vocabulário completo, grupos repetíveis).
- [x] Rota `equipamentos`: CRUD aceita os campos novos; revisão incrementa ao editar
  datasheet; `GET /units-catalog`. Testes em `equipment-technical-schema.test.js` (434/434).
- [ ] Deploy no servidor: `prisma migrate deploy` + `generate` (ver rodapé).

**Etapa B — Configuração por categoria (gestor) ✅ (feita)**
- [x] Toggle "Dados Técnicos (datasheet preenchível)" (`technicalDocEnabled`) no
  `CategoryFormModal`, ao lado do PDF anexo legado.
- [x] `TechnicalSchemaBuilder.tsx` — construtor por campo: rótulo, tipo (vocabulário
  completo), grandeza (measure), opções (select/multiselect), seção, flags
  obrig./opcional-por-equip./no-doc, e sub-builder de subcampos para grupos repetíveis.
- [x] Keys preservadas em edição (imutáveis); validação pesada no backend
  (`normalizeTechnicalSchema`). `tsc -b` + ESLint limpos.

**Etapa C — Preenchimento (equipamento) ✅ (feita)**
- [x] `TechnicalDataModal.tsx` — form dinâmico a partir do `technicalSchema`: widgets por
  tipo (texto/área/número/medida com unidade/seleção/multi/booleano/data), grupos repetíveis
  (add/remover instâncias), seções por `group`, toggle "Aplicável" para `optionalPerEquipment`.
- [x] Botão "Dados técnicos" no `EquipmentCard` (quando `technicalDocEnabled`) + ● quando já
  preenchido; persiste `technicalData`/`technicalFieldOverrides` via `updateEquipment`.
- [x] `GET /units-catalog` consumido por `useUnitsCatalog`; tipos no `api/equipamentos.ts`.
- [x] `tsc -b` + ESLint limpos. **Depende de B ou E** para popular `technicalSchema`/
  `technicalDocEnabled` (senão o botão não aparece e o modal mostra "nenhum campo").

**Etapa D — Geração DOCX→PDF**
- `technicalDocBuilder.js` (dicionário de tokens, formatação de measure/boolean/data,
  clone de linhas para grupos) + template genérico padrão.
- Botões "Gerar"/"Baixar"; servir via rota por token; cache `TECHNICAL_DOC_GENERATED`.

**Etapa E — Seed a partir do JSON**
- `backfill:equipment-technical` (normalização de tipos, mapa unit_hint→grandeza,
  consolidação de repetíveis, `optionalPerEquipment`). Dry-run primeiro.

**Etapa F — Templates por categoria & polimento**
- Upload de DOCX modelo por categoria; UX (seções, indicador de datasheet desatualizado),
  decisão sobre o PDF legado, testes (backend + `tsc`/ESLint) e validação end-to-end.

> Deploy de cada etapa com migração depende de rodar no servidor
> (`prisma migrate deploy` + `generate` + backfill) — apresentar como comandos, não executar.
```
