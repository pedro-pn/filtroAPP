# Adequar anotações para relatório (OpenAI)

Botão **"Adequar para relatório"** nos campos **Atividades do dia** e **Observações** (dos serviços) do RDO. Envia a
anotação ao backend, que chama a OpenAI (Responses API) com as instruções do GPT personalizado e devolve o texto adequado.
O usuário revisa e edita o texto ao lado do original e só o aplica no campo se clicar em **Aplicar ao campo**. Nada é
salvo automaticamente: o RDO continua sendo salvo pelo fluxo normal.

- **Quem usa:** gestor e coordenador do RDO (`rdo:manager`, `rdo:coordinator`). Colaborador, cliente e os relatórios de
  manutenção/produção não têm o botão.
- **Onde aparece:** criação do RDO (`NewReportPage`), revisão/edição (`ReportDetailPage`) e Observações dos serviços
  (`ServiceFields`, inclusive o serviço de inibição).
- **Sem `OPENAI_API_KEY` no servidor**, o botão não aparece.

## Configuração

| Variável | Padrão | Uso |
|---|---|---|
| `OPENAI_API_KEY` | vazio | Chave da API da OpenAI (platform.openai.com, separada do ChatGPT). **Só no `.env` do servidor; nunca no frontend nem no Git.** |
| `OPENAI_MODEL` | `gpt-6-luna` | Modelo. Luna é o mais econômico (US$ 0,10 / 0,50 por 1M tokens). Trocar = mudar a variável e reiniciar. |
| `OPENAI_REASONING_EFFORT` | `low` | `none`, `minimal`, `low`, `medium`, `high`. `low` funciona em todos os modelos atuais. |
| `OPENAI_TIMEOUT_MS` | `30000` | Tempo máximo por chamada (o SDK tenta mais 1 vez em falha de rede). |

Depois de configurar, valide a chave e o modelo (sem custo, não gera texto):

```bash
cd backend && npm run openai:check
```

No servidor, as variáveis vão no `.env` do backend e valem no próximo `docker compose up -d` do serviço `backend`.

## Instruções do GPT personalizado

Ficam em `backend/src/lib/anotacoes/instrucoes/`:

- `instrucoes-relatorio.md`: as instruções originais (fonte principal das regras).
- `exemplos-relatorio.md`: anotações e versões aprovadas, enviadas como referência de estilo.

Para atualizar, edite os arquivos e faça o deploy. O backend relê o arquivo quando ele muda, sem alteração de código. O
conteúdo nunca vai para o navegador. A chamada monta o parâmetro `instructions` nesta ordem: instruções originais,
exemplos e um bloco curto de **regras do sistema** (`REGRAS_DO_SISTEMA` em `instrucoes.js`). Esse bloco trata a
anotação como conteúdo, ignora ordens contidas nela, pede resposta sem comentários e proíbe inventar fatos ou alterar
números, tags e nomes. Ele não muda o estilo das instruções.

### Conflitos e ambiguidades encontrados nas instruções (decidir antes de ajustar)

Os arquivos foram usados **sem alteração**. Pontos em que as instruções e os exemplos divergem:

1. **Negrito e título** (resolvido em 2026-10-13: negrito e título com data removidos dos exemplos). O exemplo 1 começa com `**Relatório de atividades – 06/10/2026**`, e os dois exemplos usam
   títulos em `**negrito**`. O exemplo das instruções não tem título nem negrito. O campo do RDO é texto simples, então
   no PDF/DOCX os `**` aparecem literalmente. Se o padrão for sem negrito, convém ajustar os exemplos.
2. **Data.** O exemplo das instruções remove a data da anotação; o exemplo 1 a mantém no título. Como o RDO já tem data,
   o recomendável é removê-la.
3. **Nomes de pessoas.** As instruções mandam omitir o número de colaboradores e **não** omitir nomes em ações ("O Sr.
   Fulano liberou…"). O exemplo 2 omite a lista "Colaboradores mobilizados: Wolney, Messias e Fabrício". Vale deixar
   explícito nas instruções que a lista da equipe é omitida, mas pessoas que agem ou decidem são mantidas.
4. **Títulos de grupo criados.** O exemplo 1 cria títulos que não estão na anotação ("Mobilização de equipamentos –
   Embarcação"). Isso é coerente com "agrupar", mas convém confirmar que títulos de agrupamento são permitidos.

## Proteções

- **Custo e abuso:** limite de 4.000 caracteres por anotação; 10 adequações por minuto e 100 por dia por usuário; a mesma
  anotação do mesmo usuário reaproveita o resultado por 10 min (inclusive clique duplo); só por ação explícita, nunca
  enquanto digita; sem histórico de conversa.
- **Dados:** `store: false`, para que a OpenAI não guarde a resposta para consulta posterior (o padrão é guardar por 30
  dias). O usuário vai como `safety_identifier`, em hash. Os logs registram só métricas (`evento`, `modelo`, tokens,
  tempo), nunca o texto.
- **Aderência:** depois da resposta, o backend compara com o original e avisa na tela, antes de aplicar, se o texto
  adequado tiver números, horários, datas ou códigos que **não estão na anotação**, ou se sumiu uma pessoa citada com
  Sr./Sra. (`aderencia.js`).
- **Erros padronizados:** timeout (504), limite da OpenAI, chave inválida ou falha de conexão (503), resposta incompleta
  ou vazia (502). A mensagem ao usuário não traz detalhes internos.

## Custos e erros

Cada adequação registra no log do backend uma linha JSON `{"evento":"anotacao_adequada","modelo":…,"tokensEntrada":…,
"tokensSaida":…,"ms":…}`, e cada falha registra `{"evento":"anotacao_falhou","codigo":…}`. Para acompanhar no servidor:

```bash
docker compose logs backend | grep anotacao_
```

Estimativa com `gpt-6-luna`: instruções e exemplos (~1,5 mil tokens) mais a anotação, e uma saída de ~300 tokens dão
**menos de US$ 0,001 por adequação**. O painel da OpenAI (Usage) mostra o consumo real da chave.

## Testes

| O quê | Como | Custo |
|---|---|---|
| Backend: endpoint, validação, permissões, limites, falhas da OpenAI, logs, injeção, aderência aos exemplos | `cd backend && npm test` (`test/anotacoes.test.js`, OpenAI simulada) | nenhum |
| Frontend: visibilidade por papel/config, limites | `cd frontend && npm test` (`test/adequar-anotacao.test.mjs`) | nenhum |
| Fluxo na tela (carregando, editar, aplicar, descartar, erro, aviso, celular) | `npm run dev` no frontend e abrir `/test/browser/adequar-anotacao.html` (`?modo=erro`, `?modo=aviso`) | nenhum (API simulada) |
| Saída real contra os exemplos aprovados | `cd backend && npm run openai:avaliar -- --confirmar` | ~3 chamadas (centavos) |

O teste real compara cada saída com a versão aprovada pela semelhança de vocabulário, que é uma referência e não uma
nota (redações diferentes podem estar corretas), e mostra os avisos de aderência e de formato.

### Resultado da avaliação real (2026-10-13, `gpt-6-luna`, esforço `low`)

| Exemplo | Semelhança com o aprovado | Avisos de aderência | Formato | Tokens (entrada/saída) | Tempo |
|---|---|---|---|---|---|
| Instruções (Thyssen, sistema 52300) | 91% | nenhum | ok | 1.334 / 120 | 3,8 s |
| Exemplo 1 (06/10, sistema 25600) | 86% | nenhum | ok | 1.297 / 137 | 3,0 s |
| Exemplo 2 (catalisadores 33–35) | 91% | nenhum | ok | 1.383 / 124 | 2,0 s |

Custo por adequação ≈ US$ 0,0002. Observações:

- **A semelhança está superestimada:** os três exemplos estão dentro das próprias instruções enviadas ao modelo, então
  ele "já viu a resposta". Para medir de verdade, é preciso avaliar com anotações novas, que não estejam nos arquivos.
- **O conflito do negrito se confirmou:** no exemplo das instruções, cuja versão aprovada não tem negrito, o modelo
  colocou `**...**` nos títulos, imitando os outros exemplos. No PDF do RDO isso aparece como `**` literal.
- No exemplo 1 o modelo manteve o título com a data ("Relatório de atividades – 06/10/2026"), copiando o exemplo.
- No exemplo das instruções saiu "pH 7" em vez de "pH 07"; os valores continuam iguais.

### Reavaliação após remover o negrito dos exemplos (2026-10-13)

O negrito (`**`) foi removido do `exemplos-relatorio.md`, e os três resultados saíram sem `**`. Semelhança: 88%, 84% e
81%; nenhum aviso de aderência; formato ok. Efeito restante: o modelo passou a pôr o título "Relatório de atividades –
<data>" também onde a versão aprovada não tem título, imitando o exemplo 1, o único com essa linha. Recomendação:
remover essa linha do exemplo 1 (a data já está no RDO, e o exemplo das instruções a omite).

## Arquivos

- Backend:
  - `src/lib/anotacoes/` (`adequar.js`, `instrucoes.js`, `aderencia.js`, `instrucoes/*.md`)
  - `src/routes/resources/anotacoes.js` (rota `POST /api/rdo/anotacoes/adequar` e `GET /api/rdo/anotacoes/config`)
  - `src/routes/index.js`, `src/config/env.js`, `.env.example`
  - `scripts/check-openai-model.js`, `scripts/avaliar-adequacao.js`, `test/anotacoes.test.js`, `test/env.test.js`
  - `package.json` (dependência `openai` e scripts `openai:check`/`openai:avaliar`)
- Frontend:
  - `src/components/anotacoes/AdequarAnotacaoButton.tsx` (+ `.css`), `src/hooks/useAdequacaoAnotacao.ts`, `src/api/anotacoes.ts`
  - Integração em `src/pages/collaborator/NewReportPage.tsx`, `src/pages/ReportDetailPage.tsx` e `src/components/reports/ServiceFields.tsx`
  - `test/adequar-anotacao.test.mjs`, `test/browser/adequar-anotacao.{html,tsx}`

Banco de dados: **sem alteração.**
