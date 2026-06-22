# Revisão dos campos de Dados Técnicos por categoria

Os campos foram extraídos de exemplos de datasheets, então há redundância, ruído de
extração e unidades erradas. Abaixo, a proposta de limpeza **para você aprovar**.
Marcadores: ✅ manter · ❌ remover · 🔀 mesclar · 🔁 virar grupo repetível · 🛠 ajustar.

> Depois que você revisar (riscar/editar à vontade), eu reflito tudo no
> `backend/data/schema_categorias_dados_tecnicos.json` + backfill e re-aplico.

---

## Categorias OK (pouca ou nenhuma mudança)

### Analisador de água (8) — manter
Todos pertinentes. Sugestão menor: 🔀 "Diluições" pode entrar como observação dentro de
"Reagentes/Reagentes e diluições".

### Boroscópio (13) — manter
Todos ok (vários opcionais). Opcional: 🔀 "Imagens" (JPG) + "Video" (AVI) → um campo
"Formatos (imagem/vídeo)".

### Contenção para reservatório (3) — manter
✅ Volume de contenção · ✅ Dreno · ✅ Pontos de içamento / Pés.

### Contador de partículas a laser (13) — manter
Todos pertinentes. "Serial" pode sair se você preferir tratá-lo como dado de identificação
(não técnico) — me diga.

### Transformador (9) — manter
Todos ok.

### Bomba pneumática (9) — manter
Todos ok. (Há "Vazão máxima" e "Vazão nominal" — mantenho ambos, são distintos.)

### Unidade móvel de transferência (9) — manter
Todos ok.

---

## Categorias com ajustes pontuais

### Compressor (11)
- ❌ **Peso** — agora é campo-base físico (vai no cabeçalho), remover daqui.
- 🛠 **Skid** e **Bacia de Contenção** — exemplos vazios ("-"); manter o campo, ok.
- ✅ Demais (Pressão Máxima, Motor Elétrico, Painel, Correia, Manômetro, Reservatório,
  Engate Rápido, Xilindró).
- **11 → 10**

### Malão de ferramentas (5)
- 🛠 **Volume total** — o exemplo é dimensão (194×92×62), não volume. Renomear para
  "Dimensões (C×L×A)" ou manter como volume calculado? (sua escolha)
  Deixar volume, pois o usuario colocará o volume total calculado por ele. Mantenha os campos de dimensoes tbm.
- ✅ Demais.

### Unidade de filtragem (13)
- 🔁 Agrupar **Motor / RPM / Tensão / Consumo** em um grupo repetível **"Motor"** -
  (alguns equipamentos têm mais de um). Ou manter plano se for sempre 1 motor — me diga.
  R: Agrupar em um grupo.
- ✅ Demais.

### Unidade de run out (11) — manter
Coerente (uma bomba + motor + estrutura). Sem mudança.

---

## Categorias bagunçadas (precisam de consolidação)

### Unidade de centrífuga (19 → ~14)
Tem o bloco da centrífuga **+** um bloco de motor duplicado.
- 🛠 **Densidade máxima de alimentação/sedimento** — unidade está `<V/VCA>` (errada) → kg/m³.
- 🛠 **Temperatura de alimentação** — unidade `<V/VCA>` (errada) → °C.
- 🔁 Unir em grupo **"Motor"**: Potência [MULTI] · Tensão [MULTI] · Corrente [MULTI] ·
  Resistência · Ligação · Motor assíncrono · Rotação · Proteção.
- 🔀 **Potência do motor** e **Consumo** (do bloco da centrífuga) parecem repetir o
  Potência/Corrente do grupo Motor → remover um dos lados (sugiro manter no grupo Motor).
- ✅ Manter: Velocidade tambor, Velocidade eixo, Capacidade hidráulica, Volume do tambor,
  Volume de óleo lubrificante, Contenção para Resíduo, Contenção do Equipamento.

### Unidade de limpeza química (22 → ~14)
Tem dados de **duas bombas** achatados em muitos campos sobrepostos.
- 🔀 Sobreposições a unir:
  - "Pressão de Trabalho" / "Pressão Máxima da Bomba" / "Pressão de Trabalho da Bomba (Centífuga)"
  - "Vazão Nominal" / "Vazão Nominal da Bomba" / "Vazão Nominal da Bomba (Centrífuga)"
  - "Motor Elétrico" / "Motor Elétrico da Bomba (Centrífuga)"
- 🔁 Proposta: grupo repetível **"Bomba"** { Pressão de trabalho · Vazão nominal ·
  Motor elétrico · Diâmetro rotor · Diâmetro sucção/recalque } → cobre a principal e a centrífuga.
- ✅ Manter (gerais): Painel Elétrico, Compressor Eletrônico, Mangueira, Manômetro, Válvula,
  Skid, Reservatório, Engate Rápido, Bacia de Contenção, Aquecedor (resistência), Consumo.

### Unidade de teste hidrostático (28 → ~15)
Várias passagens de extração sobre os mesmos dados.
- 🔀 Unir duplicados:
  - "Pressão máxima da bomba" (vazio) → remover, fica "Pressão máxima de saída".
  - "Vazão nominal da bomba" (vazio) + "Vazão" + "Vazão nominal bomba hidropneumática" → 1 campo.
  - "Motor Elétrico" / "Especificações do motor" / "potência" → 1 campo "Motor elétrico".
  - "Bacia de Contenção" / "Volume da Contenção" → 1.
  - "Reservatório" / "Volume do Tanque" → 1.
  - "Volume" (ex.: 13 l/min…) está descrevendo vazão → remover/mesclar.
- ✅ Manter: Pressão máx. entrada, Pressão máx. saída, Filtro, Mangueira, Engate rápido,
  Manômetro, Válvula, Bomba, Painel, Tensão de entrada, Rotação, Acessórios,
  Pressão máxima de operação.

### Unidade de flushing primário (41 → ~16)
A pior — duas extrações + componentes numerados.
- ❌ Remover ruído de contagem (não são specs): "1 Motor elétrico", "2 Motor elétrico",
  "3 Bombas", "2 Manômetro", "Bandejas", "Botoeira de emergência" (manter se quiser).
- 🔁 Grupo **"Bomba"** { Vazão nominal · Pressão de trabalho · Motor · RPM · Tensão/Consumo }
  → cobre "Bomba Principal", "Bomba Trocador de Calor" e os motores [MULTI].
- 🔀 Unir segunda extração que repete: "Vazão máxima/mínima", "Motor Elétrico Principal",
  "Motor do trocador", "Vazão da bomba do trocador", "Consumo" → entram no grupo Bomba.
- ✅ Manter (gerais): Filtro, Pressão Máx. Filtro, Abertura Bypass, Modelo Elemento Filtrante,
  Capacidade Contenção, Consumo Operacional, Volume Reservatório, Painel elétrico,
  Trocador de Calor, Medidor de vazão, Resistência, Válvulas, Manômetro, Skid,
  Alarme de sequência de fase.

### Unidade de termovácuo (23 → ~12)
Dois blocos descrevendo as **mesmas 3 bombas** (Bomba 1/2/3 ↔ (Bomba de Vácuo)/(Engrenagem)).
- 🔁 Grupo **"Bomba"** { Pressão de trabalho · Vazão nominal · Motor elétrico } repetível (até 3)
  → substitui TODOS os "Pressão/Vazão/Motor Bomba 1/2/3" **e** os "(Bomba de Vácuo)/(Engrenagem)".
- ✅ Manter (gerais): Filtros, Painel elétrico, Reservatório de óleo, Reservatório de resíduos,
  Minimess, Mangueira, Manômetro, Aquecedor (Resistência), Skid, Bombas (descrição geral).

### Reservatório de aço carbono (10) e Reservatório de inox (10)
Iguais, quase tudo vazio; o 1º campo está com nome estranho.
- 🛠 Renomear "Reservatorio de metal com pintura para óleo" → **Volume** (measure, L/m³) +
  um campo **Material/Revestimento** (texto).
- ✅ Manter estruturais: Escada, Conexão de sucção, Conexão de retorno, Boca de acesso (limpeza),
  Respiro, Visor de nível, Régua de nível, Pontos de içamento, Pés.
- As duas categorias devem ter **o mesmo conjunto** (inox = aço carbono, só muda material).

---

## Resumo de impacto

| Categoria | Antes | Depois (prop.) |
|---|---:|---:|
| Flushing primário | 41 | ~16 |
| Teste hidrostático | 28 | ~15 |
| Termovácuo | 23 | ~12 |
| Limpeza química | 22 | ~14 |
| Centrífuga | 19 | ~14 |
| Compressor | 11 | 10 |
| (demais) | — | ~iguais |

**Decisões que preciso de você:**
1. Componentes repetidos (bombas, motores) → vira **grupo repetível** (recomendo) ou
   campos planos prefixados ("Bomba 1 - …")? Agrupa em um grupo.
2. "Serial" e "Volume total/Dimensões" — manter como estão? Manter serial. Deixar volume total, pois o usuario calcula e preenche lá. Manter os demais campos de dimensões
3. Pode riscar/editar este arquivo livremente; o que sobrar eu transformo no novo schema.
