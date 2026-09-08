# Quickstart / Validação — Módulo de Registros de Qualidade

Guia de validação ponta a ponta. Não contém código de implementação — apenas passos para provar que
a feature funciona. Detalhes de dados em [data-model.md](./data-model.md) e de API em
[contracts/qualidade-api.md](./contracts/qualidade-api.md).

## Pré-requisitos

- Migration Prisma da feature aplicada (enums + `QualityRecord`/`QualityNature`/`QualityRecordSeq`).
- Usuário de teste com papel **QUALIDADE_MANAGER**; um segundo com **QUALIDADE_VIEWER**.
- Pelo menos 2 projetos ativos cadastrados no app.

> **Rode no servidor** (não executar pelo agente — Princípio I da constituição):
> ```bash
> # backend/
> npx prisma migrate deploy      # aplica a migration da feature
> npm test -- qualidade          # roda os testes de lógica de negócio do módulo
> ```
> A migration deve ser criada em dev com `npx prisma migrate dev --name qualidade` e versionada.

## Cenário 1 — Numeração automática por tipo/ano (US1)

1. Login como manager → Hub → **Qualidade** → aba **Registros** → **Registrar**.
2. Preencher um **Desvio** (Data do Registro em 2026, projeto, natureza, descrição, impacto,
   disposição = Monitorar, status = Aberto) e salvar.
3. **Esperado**: registro aparece com `number = D-001/26`.
4. Criar outro Desvio (2026) → `D-002/26`. Criar Desvio com Data do Registro em 2027 → `D-001/27`.
5. Criar uma **Melhoria** → número inicia com `M-`.

## Cenário 2 — Validações (US1)

1. Tentar salvar com Natureza/Descrição/Impacto vazios → **bloqueado** com mensagem pt-BR.
2. Selecionar Disposição = **Tratar** e deixar **Ação definida** vazia → **bloqueado**.

## Cenário 3 — Editar / Excluir (US2)

1. Editar um registro: mudar Impacto Baixo→Alto e Status → salvar → tabela reflete; `number` igual.
2. Confirmar que o campo **Tipo** está desabilitado na edição (imutável na v1).
3. Excluir um registro via **Excluir** + confirmação → some da tabela.
4. Login como **viewer** → não vê Registrar/Editar/Excluir; POST/PUT/DELETE diretos retornam 403.

## Cenário 4 — Naturezas (US4)

1. Aba **Naturezas** → cadastrar "Atraso de mobilização" → aparece na lista suspensa do formulário.
2. Tentar cadastrar "atraso de mobilização" (case diferente) → **bloqueado** por duplicidade.
3. Tentar excluir uma Natureza já usada por um registro → **bloqueado**; desativá-la funciona e ela
   some do formulário de novos registros (mas continua nos registros antigos).

## Cenário 5 — Desvios no card do projeto (US3)

1. Vincular 2 Desvios ao **Projeto X** e 1 Melhoria ao mesmo projeto.
2. Acompanhamento → abrir o card do **Projeto X** → seção **Desvios** lista **apenas os 2 Desvios**
   (Nº, Natureza, Impacto, Status) com link para o módulo; a Melhoria não aparece.
3. Um Desvio vinculado a **Interno/SGQ** não aparece em nenhum card.
4. Projeto sem Desvios → seção mostra "Nenhum desvio registrado".

## Cenário 6 — Recorrência automática (US5)

1. Criar 2 registros de Natureza "Stand By" com Data do Evento dentro de 12 meses → cada um mostra
   **Ocorrências 12m = 2**, **Recorrente = não**.
2. Criar o 3º "Stand By" dentro da janela → os que estão na janela mostram **Ocorrências = 3**,
   **Recorrente = SIM**.
3. Criar um "Stand By" com Data do Evento fora da janela de 12 meses → não conta para os demais.

## Cenário 7 — Exportar para xlsx (US6)

1. Aba **Registros** com alguns registros → clicar em **Exportar**.
2. **Esperado**: baixa `registros-qualidade-AAAA-MM-DD.xlsx`; abre no Excel/LibreOffice com uma
   linha por registro e cabeçalho na ordem da referência FR-3-4-11-01 (incl. Ocorrências 12m e
   Recorrente?).
3. Aplicar um filtro (ex.: Tipo = Desvio) e exportar → planilha contém só os registros filtrados.
4. Tabela vazia → exporta planilha só com o cabeçalho, sem erro.

## Verificação de constituição (checklist rápido)

- [ ] Abas e tabela sem scroll horizontal no celular; tabela vira cards.
- [ ] Modal com rodapé fixo e corpo rolável; selects estilizados (não crus do navegador).
- [ ] Onboarding de primeiro acesso do módulo aparece; aviso de novidade (10 dias) na seção Desvios.
- [ ] Aba ativa preservada em `?tab=` ao recarregar.
- [ ] `npm test -- qualidade` verde (numeração, concorrência, recorrência, natureza em uso, papéis).
