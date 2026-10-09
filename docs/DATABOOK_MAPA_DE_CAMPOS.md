# Data Book — Mapa de campos (Passo 1)

Status (09/10/2026): campos e decisões aprovados (seção 6); referência do exemplo completo aprovada;
mapper, job, rotas, telas e cadastro de FDS implementados — ver `backend/databook/README.md` (Integração no app).
Gerador de referência: `backend/databook/` (extraído de `databook_filtrovali.zip`).
Regressão verificada em 09/10/2026: `exemplo/missao_5815.json` gera 124 páginas com texto idêntico à
referência em todas as páginas, e o JSON valida contra `schema.json`.

## 1. Stack e infraestrutura

| Item | Situação no app |
|---|---|
| Backend | Node 22 (ESM) + Express 5, `backend/src` |
| Banco | PostgreSQL 16 via Prisma 7 (`backend/prisma/schema.prisma`) |
| Jobs | Container `worker` (`node src/worker.js`) com `JobRun`/`JobLock` no banco; `backend/src/jobs/background-jobs.js` |
| Arquivos | Disco local, `env.uploadDir` (volume Docker). Relatórios em `<uploadDir>/Missão <code> - <nome>/<TIPO>/`. Fotos referenciadas por `storagePath`/URL em `specialConditions` e `ReportAttachment` |
| PDFs atuais | Modelo DOCX (`Modelos/definitivos/Modelo - <TIPO>.docx`) → placeholders → LibreOffice → PDF (`report-pdf-from-docx.js`) |
| Python | **Não existe** na imagem (`node:22-bookworm-slim` + LibreOffice). O Debian bookworm traz `python3-reportlab` 3.6, abaixo do mínimo (>=4), então as libs precisam vir de um venv com pip |
| Frontend | React + Vite + TS (`frontend/src`) |
| Abas Projetos/Arquivados | Módulo RDO, tela do gestor `/rdo/gestor?tab=projetos` e `?tab=arquivados` (`pages/gestor/GestorPage.tsx`). Arquivado = `Project.isActive = false`. Não confundir com o "Arquivados" do Acompanhamento (`acompanhamentoArchivedAt`) |

## 2. Tipos de relatório e como se ligam ao projeto

Tabela única `Report` (`reportType`, `sequenceNumber` por projeto+tipo, `reportDate`, `projectId`).
O RDO tem N `ReportService` (`serviceType`, `extraData` JSON, `finalized`, `startTime`, `endTime`, `equipmentId`).
Cada serviço **finalizado** do RDO gera um relatório derivado (`derivedReportTypesForService`, `routes/resources/reports.js:3770`):

| `serviceType` (RDO) | Relatório derivado | Gerador | Fotos (rótulos de upload) |
|---|---|---|---|
| `limpeza` | **RLQ** – Limpeza Química | `lib/report-rlq.js` | "Imagens — corpo de prova", "Imagens — tubulação" |
| `pressao` | **RTP** – Teste de Pressão | `lib/report-rtp.js` | "Fotos do manômetro", "Fotos do sistema" |
| `flushing`, `filtragem` | **RCPU** – Contagem de Partículas e Umidade | `lib/report-rcp.js` | "Foto do laudo do contador", "Fotos da desidratação" |
| `mecanica` | **RLM** – Limpeza Mecânica | `lib/report-rlm.js` | "Imagens da limpeza" |
| `inibicao` + tipoRelatorio RLI | **RLI** – Limpeza/Inibição | `lib/report-rli.js` | "Fotos das plaquetas" |
| `inibicao` + tipoRelatorio RLF | **RLF** – Flushing (inibição) | `lib/report-rlf.js` | "Fotos do filtro" |

Também existem `RDO_MAINTENANCE` e `RDO_PRODUCTION` (módulos de Manutenção/Produção, outro fluxo). **Proposta: fora do Data Book.**

O relatório derivado guarda uma cópia do serviço em `specialConditions.serviceData` e snapshots resolvidos
(`resolvedUnits`, `resolvedManometers`, `resolvedCounter`, `__leaderSnapshot`).

**Vínculo explícito serviço ↔ relatório:** `specialConditions.serviceLinkKey` / `serviceId` /
`serviceData.__serviceLinkKey` / `__sourceServiceId` / `__ongoingKey` (`existingDerivedReportLinkKeys`,
`reports.js:4606`). O mapper usa esse vínculo primeiro e só cai para data+tags e depois só data quando ele faltar.

Um serviço "Em andamento" (`finalized = false`) continua no RDO seguinte com a mesma `__ongoingKey`. Isso
explica o mesmo serviço aparecer em dois dias, e o relatório derivado só nasce no dia em que ele é finalizado.

Catálogo canônico dos campos de serviço (aliases incluídos): `lib/api-credentials/rdo-resource-definition.js`.

## 3. RDO e RLQ → `schema.json` atual

Legenda: ✅ existe direto · 🔁 existe com transformação · ✏️ não existe (editorial / tela de revisão) · ⚠️ incompatibilidade.

### 3.1 `projeto`

| Campo do schema | Origem no app | Notas |
|---|---|---|
| `missao` | 🔁 `"Missão " + Project.code + " – " + Project.name` | Mesmo padrão do `missiontitle` dos DOCX (trocando "-" por "–", como no exemplo) |
| `cliente` | ✅ `Project.clientName` | |
| `cnpj` | 🔁 `formatCnpj(Project.clientCnpj)` | |
| `contrato` | ✅ `Project.contractCode` | |
| `local` | ✅ `Project.location` | O RDO pode ter `specialConditions.workLocation` diferente: usar o do projeto |
| `servico` | ✏️ | Sem campo no projeto. Rascunho: nomes de `ProjectPlannedService` ou dos serviços dos RDOs + equipamento ("Limpeza Química de APVs Verticais"). Editável |
| `doc` | ✏️ novo | Sequência `DB-<code>-<seq>` (tabela nova) |
| `rev` | ✏️ novo | Começa em 0 e incrementa a cada nova geração |
| `emissao` | 🔁 data da geração | |
| `empresa` | ✏️ constante | Não há razão social no banco: virá de configuração (env/constante) |
| `periodo` | 🔁 intervalo escolhido no diálogo | |
| `subtitulo_capa` | default | |

### 3.2 Nível do Data Book

| Campo | Origem | Notas |
|---|---|---|
| `escopo_total` | 🔁 `ProjectPlannedService.systems[].quantity` | ⚠️ ver 5.1: o app mede **m de tubulação, L de óleo e un de sistemas**; o schema exige inteiro |
| `unidade_escopo` | 🔁 unidade dominante do escopo previsto ("m", "L", "un") ou ✏️ ("APVs") | Editável |
| `ocorrencias_sms` | ✏️ | Não existe no app. Padrão 0, editável |
| `dados_tecnicos` | 🔁 agregado dos RLQs: Equipamento, Sistema, Material, Método, Tipo de inspeção, ULQ (`resolvedUnits`) + jornada e efetivo mais frequentes dos RDOs | Valores distintos unidos por ", " |
| `equipe` | 🔁 `ReportCollaborator` (+ noturno `noturnoDetails.colaboradores`) dos RDOs do intervalo: nome + `roleNameSnapshot` | `observacao`: "Líder" para `__leaderSnapshot`/`Project.operator`; mudança de função detectada por snapshots diferentes ("X a partir de dd/mm") |
| `etapas_produto` | 🔁 união de `etapas` dos RLQs + `getProductForStep(etapa, material)` (`report-rlq.js`) | O produto **não é gravado**: vem de uma tabela fixa no código, que muda para inox (ácido nítrico/fluorídrico) |
| `criterios_aceitacao` | 🔁 texto fixo do `Modelo - RLQ.docx` | Idêntico ao exemplo. Copiar como constante |
| `revisoes` | ✏️ novo | Histórico da tabela nova de gerações |
| `textos.*` | ✏️ | Rascunho automático + edição na revisão (Passo 3) |
| `fds` | ✏️ ver 5.4 | Não há vínculo produto→FDS |
| `aprovacoes` | 🔁 `User.name` + `User.collaborator.jobRole.name` | Escolhidos na revisão |

### 3.3 `dias[]` (RDO)

| Campo | Origem | Notas |
|---|---|---|
| `data` | 🔁 `Report.reportDate` (UTC → dd/mm/aaaa) | |
| `dia_semana` | 🔁 calculado | |
| `rdo` | ✅ `sequenceNumber` (RDO) | Dias com 2 RDOs: ⚠️ o schema aceita só um. Proposta: o de menor nº em `rdo` e os demais no campo novo `rdos_extras` |
| `resumo` | ✏️/🔁 | Não existe. Rascunho: títulos dos serviços + tags, ou "Mobilização…" a partir da 1ª frase de `dailyDescription` |
| `jornada` | 🔁 `arrivalTime – departureTime` | Turno noturno (`noturnoDetails`): proposta de campo opcional `jornada_noturna` |
| `horas_extras` | 🔁 `daytimeOvertimeMinutes` → HH:MM | Vazio se `overtimeAccepted === false` |
| `comentario` | ✅ `overtimeReason` | |
| `efetivo` | ✅ `daytimeCount` | |
| `stand_by` | ✅ `standbyDetails.total` / `.motivo` | |
| `dds` | 🔁 `specialConditions.dds.diurno` {`enabled`,`inicio`,`termino`,`temas[].name`} | DDS noturno: proposta de campo opcional `dds_noturno` |
| `atividades` | 🔁 `dailyDescription` (texto livre) | Quebrar por linha; prefixo `HH:MM` vira `hora`. Correção só ortográfica |
| `servicos[]` | ver 3.4 | |
| `fotos` | 🔁 `specialConditions.generalUploads` do RDO, depois as fotos dos derivados | Copiar de `uploadDir` para tmp |

Não usados pelo layout atual: intervalo de almoço (`lunchBreak`), turno de cada colaborador, quadro "Progresso"
do DOCX (o Data Book recalcula a partir de `concluidas`).

### 3.4 `dias[].servicos[]` (serviço do RDO + RLQ ligado)

| Campo | Origem | Notas |
|---|---|---|
| `titulo` | 🔁 `rdoServiceName(serviceType)` | "Limpeza química", "Teste de pressão"… |
| `equipamento` | 🔁 `Equipment.name` ou `extraData['Equipamento(s)']` | |
| `sistema` | ✅ `ReportService.system` / `extraData.Sistema` | |
| `material` | 🔁 `material` (+ `materialOther`) | |
| `metodo` | 🔁 `metodos[]` unidos | |
| `inicio` / `fim` | ✅ `startTime` / `endTime` | |
| `tags` | ✅ `drawingsTags` ("Desenhos / TAGs") | Nunca corrigir |
| `inspecao` | 🔁 `tipoInspecao[]` unidos | |
| `status` | 🔁 `finalized` → "Finalizado" / "Em andamento" | |
| `quantidade` | 🔁 `quantidadeSistemas` (limpeza de sistema) **ou** soma dos comprimentos de `tubes` (m) | ⚠️ 5.1 |
| `concluidas` | 🔁 igual a `quantidade` se finalizado, senão 0, conforme `realizedFromExtraData` (mesma regra do quadro de progresso) | ⚠️ 5.1 |
| `etapas` | ✅ `etapas[]` | |
| `obs` | ✅ `notes` ("Observações") | Correção só ortográfica |
| `rlq` | 🔁 `sequenceNumber` do RLQ ligado | |
| `laudo` | 🔁 `aprovadoCliente`: Sim → APROVADO, Não → REPROVADO | |
| `laudo_observacao` | ✏️ | "Não emitido" quando ainda em andamento |

## 4. RCPU, RTP e demais tipos: campos e sugestão

Importante: **o app não registra** vários dos exemplos do prompt. Não há ponto de coleta, limite aceito, tempo
de patamar, leituras por patamar nem queda de pressão admitida. Avisos como "medição acima do limite" só são
possíveis se um limite for informado (5.2).

### 4.1 RCPU (serviços `flushing` e `filtragem`)

| Campo no app | Chave | Sugestão | Motivo |
|---|---|---|---|
| Serviço (Flushing/Filtragem) | `serviceType` | ✅ entra (título) | Identifica o bloco |
| Serviços realizados | derivado (`tipoFlushing` + `houveDesidratacao`) | ✅ | "Flushing primário e desidratação" |
| Equipamento / Sistema | `Equipamento(s)`, `Sistema` | ✅ | Padrão dos blocos |
| Tipo de óleo | `tipoOleo` | ✅ | Dado técnico central |
| Volume de óleo | `volumeOleo` + unidade | ✅ | Base do avanço em L |
| Flushing em tubulação? + diâmetros/comprimentos | `flushingTubulacao`, `tubes[]` | ✅ tabela compacta | Rastreabilidade do escopo |
| Tipo de sistema (sem tubulação) | `tipoSistema` | ✅ | |
| Unidade de flushing/filtragem | `resolvedUnits` | ✅ | Como ULQ no RLQ |
| Unidade de desidratação | `resolvedThermoUnit` | ✅ se houver | |
| Início / término | `startTime`/`endTime` | ✅ | |
| Tempo total | `totalMinutes` | ✅ | |
| Etapas | `etapas[]` | ✅ faixa de etapas | |
| Houve contagem de partículas? | `houveParticulas` | ✅ controla a tabela | |
| NAS inicial / final | `contagemInicialNas`/`FinalNas` | ✅ tabela de medições | Resultado técnico |
| ISO 4406 inicial / final | `contagemInicialIso`/`FinalIso` | ✅ tabela de medições | Resultado técnico |
| Contador (código + série) | `resolvedCounter` | ✅ | Rastreabilidade metrológica |
| Certificado do contador | `resolvedCounter.certificate` → `CalibrationCertificate` | ✅ Anexo C (5.3) | |
| Validade da calibração | `ParticleCounter.calibratedAt/expiresAt` | ✅ só para aviso | "certificado vencido na data" |
| Houve análise de umidade? / ppm inicial e final | `houveUmidade`, `umidadeInicial/Final` | ✅ tabela de medições | |
| Procedimento | texto fixo "IBT 11-23" no modelo | ✅ seção técnica | Norma de referência |
| Aprovado pelo cliente | `aprovadoCliente` | ✅ laudo | |
| Tags / OBS | `drawingsTags`, `notes` | ✅ | |
| Fotos do laudo do contador / da desidratação | uploads | ✅ fotos do dia (origem RCPU) | |
| Colaboradores do serviço | `collaborators` | ❌ | Já estão no RDO do dia |
| Ponto de coleta / limite aceito | **não existe** | ✏️ opcional (5.2) | |

Tabela proposta: **Análise × Inicial × Final × Limite (se informado) × Resultado**, com linhas NAS, ISO 4406 e Umidade (ppm).
Resumo (Seção 2): "Contagem de partículas: N análises, classe final ISO x/y/z (pior caso), N aprovadas".

### 4.2 RTP (serviço `pressao`)

| Campo no app | Chave | Sugestão | Motivo |
|---|---|---|---|
| Equipamento testado (Tubulação/Mangueiras/Outro) | `equipamentoTestado`(+`Outro`) | ✅ | |
| Equipamento / Sistema / Material | idem | ✅ | |
| Diâmetros e comprimentos | `tubes[]` | ✅ tabela compacta | Base do avanço em m |
| Fluido de teste (+ qual óleo) | `fluidoTeste`, `qualOleo` | ✅ | |
| Pressão de trabalho (projeto) | `pressaoTrabalho` + unidade | ✅ | |
| Pressão de teste | `pressaoTeste` + unidade | ✅ | |
| Razão teste/trabalho | calculado | ✅ só em aviso | Critério de 1,2 a 1,5× do modelo |
| UTH | `resolvedUnits` | ✅ | |
| Início / término (duração) | `startTime`/`endTime` | ✅ | Única medida de tempo disponível |
| Etapas | `etapas[]` | ✅ | |
| Manômetros: TAG, escala, nº do certificado, calibração, validade | `resolvedManometers[]` | ✅ tabela | Rastreabilidade metrológica |
| Certificados dos manômetros | `CalibrationCertificate` | ✅ Anexo C (5.3) | |
| Critérios de aceitação | texto fixo do `Modelo - RTP.docx` | ✅ seção técnica | |
| Aprovado pelo cliente | `aprovadoCliente` | ✅ laudo | |
| Tags / OBS / Fotos (manômetro, sistema) | | ✅ | |
| Tempo de patamar, leituras, queda admitida | **não existe** | ✏️ opcional (5.2) | |

Tabela proposta: **Manômetro × Escala × Certificado × Calibração × Validade**. Pressões entram na grade rótulo/valor.
Resumo (Seção 2): "Testes de pressão: N realizados, N aprovados".

### 4.3 RLM, RLF e RLI

| Tipo | Campos disponíveis | Sugestão |
|---|---|---|
| RLM (`mecanica`) | equipamento, sistema, material, início/término, etapas, tags, OBS, aprovado, fotos "Imagens da limpeza" | ✅ bloco genérico (grade + etapas + OBS + fotos), sem seção técnica |
| RLI / RLF (`inibicao`) | embarcação, sistema (+descrição/diagrama), material, linhas, steps, início/término, etapas, OBS, aprovado, fotos | ✅ bloco genérico, sem seção técnica |

## 5. Decisões pendentes (preciso da sua confirmação)

1. **Unidade do avanço.** O schema exige `concluidas`/`escopo_total` inteiros, mas o app mede m/L/un, inclusive
   fracionários (ex.: 123,5 m). Proposta: aceitar `number` no schema e formatar inteiros sem casas decimais, o que
   mantém o PDF do exemplo idêntico. Em projeto com unidades mistas, o avanço segue o `progressPct` do Acompanhamento.
2. **Limites de medição.** RCPU sem limite aceito e RTP sem patamar ou queda admitida. Opções: (a) só mostrar o
   que existe; (b) informar na tela de revisão, por Data Book, a classe ISO/NAS alvo e o ppm máximo, o que habilita
   o aviso "acima do limite"; (c) acrescentar os campos ao formulário do RDO (fora do escopo).
   Recomendo **(b)**.
3. **Anexo C – Certificados de calibração** (manômetros e contador), no padrão das FDS, só com os certificados
   usados no intervalo. Recomendo **sim**.
4. **Cadastro de FDS.** Já existe Estoque → `StockItem` tipo `PRODUTO_QUIMICO` com fabricante, CAS e
   `StockItemDocument` (PDF). Proposta: reaproveitá-lo e acrescentar sinônimos (nome químico do RLQ), código, revisão,
   data da FDS e um marcador "é FDS" no documento, em vez de criar uma tabela nova. Os produtos dos RLQs vêm da tabela
   fixa `getProductForStep`.
5. **Avanço físico (2.3).** Quais serviços contam? O quadro de progresso do RDO soma **todos** os serviços previstos
   no contrato (`ProjectPlannedService`). O prompt sugere só o principal. Recomendo seguir o RDO para os números
   baterem com o que o cliente já recebeu.
6. **Execução.** Recomendo Python 3 + venv (reportlab/pypdf/Pillow) **na imagem do backend**: a geração vira um job
   numa tabela nova, processado pelo container `worker` existente, que chama `python -m databook` como subprocesso
   (opções a+c). Motivos: mesmo volume de `uploadDir` (sem copiar fotos pela rede), reaproveita `JobRun`/`JobLock` e
   não cria serviço novo para operar. Custo: imagem ~70 MB maior. A alternativa (b), microserviço FastAPI, exigiria
   mais um container e o envio de fotos/FDS por HTTP.
7. **Onde fica o botão.** RDO › gestor › abas **Projetos** e **Arquivados** (`Project.isActive`), e não o
   Acompanhamento. O coordenador também deve ter o botão?
8. **Campos noturnos e dias com 2 RDOs.** Acrescentar ao schema os opcionais `jornada_noturna`, `dds_noturno` e
   `rdos_extras`? Sem eles, o turno noturno some do Data Book.
9. **RLM/RLF/RLI.** Entram como bloco genérico (4.3) ou ficam fora na primeira versão?

## 6. Decisões aprovadas (09/10/2026)

1. Avanço aceita decimais (m/L/un); inteiros continuam sem casas.
2. Limites de RCPU (ISO/NAS/ppm) informados na tela de revisão → `limites_rcpu`.
3. Anexo C com os certificados de calibração dos manômetros e contadores usados (o app já rastreia instrumento e arquivo).
4. FDS: reaproveitar Estoque (`StockItem` `PRODUTO_QUIMICO` + `StockItemDocument`) com sinônimos e metadados da FDS.
   Os produtos vêm de `getProductForStep`; **confirmação adicional pelos romaneios** do projeto (produtos levados).
5. Avanço físico segue o quadro de progresso do RDO (todos os serviços previstos no contrato).
6. Python 3 + venv na imagem do backend; geração como job no `worker`, chamando `python -m databook`.
7. Botão "Gerar Data Book" no gestor (Projetos e Arquivados) **e no coordenador**.
8. Acrescentados ao schema: `jornada_noturna`, `efetivo_noturno`, `horas_extras_noturno`, `dds_noturno`, `rdos_extras`.
9. Entre RLM/RLF/RLI, **somente RLM** entra no Data Book (bloco genérico, sem seção técnica).
