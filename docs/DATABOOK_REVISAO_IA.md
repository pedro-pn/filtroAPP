# Data Book — revisão ortográfica automática com IA (pesquisa)

Status: **pesquisa, nada implementado.** Hoje a revisão usa Hunspell pt-BR (`backend/src/lib/databook/ortografia.js`):
lista palavras suspeitas e o usuário escolhe a correção na tela de revisão. Este documento propõe como uma IA (Claude,
API da Anthropic) pode sugerir as correções automaticamente, mantendo as regras do Data Book: **corrigir só ortografia
dos textos livres (atividades, OBS, comentários) e nunca alterar tags, horários, números, medições ou nomes.**

## 1. Arquitetura proposta

```
prepararRevisao()
  ├─ textosLivres(dados)                  ← já existe (ortografia.js)
  ├─ mascarar(texto)                      ← NOVO: tags, números, horários, unidades e palavras com maiúscula → ⟦1⟧, ⟦2⟧…
  ├─ Claude (saída estruturada JSON)      ← NOVO: devolve o texto corrigido por item
  ├─ validarCorrecao(original, corrigido) ← NOVO: guarda determinística (seção 4); reprovou → descarta
  ├─ desmascarar → correções sugeridas
  └─ Hunspell como fallback (IA desligada, falhou, recusou ou passou do tempo)
```

- A IA **sugere**; a tela de revisão mostra as correções já marcadas, e o usuário pode desmarcar qualquer uma. Nada
  vai para o PDF sem passar pela tela, o mesmo contrato de hoje (`edicoes.correcoes` → `aplicarCorrecoes`).
- A chamada fica no backend (a chave nunca vai ao navegador), atrás de uma flag `DATABOOK_IA_ENABLED`.
- O mascaramento resolve dois problemas de uma vez:
  - **Garantia:** a IA nem vê o que não pode mudar. Tags (`12-YD-0642`), horários (`06:20`), números e medições
    (`315 bar`, `ISO 16/14/11`) e nomes próprios ou siglas (qualquer palavra com maiúscula) viram marcadores `⟦n⟧`, que
    precisam voltar intactos.
  - **Privacidade:** nomes de colaboradores e do pessoal do cliente não saem do servidor (LGPD, seção 5).

## 2. Modelo e custo

| Item | Valor |
|---|---|
| Modelo | **Claude Opus 5** (`claude-opus-5`), US$ 5 / 1M tokens de entrada e US$ 25 / 1M de saída |
| Esforço | `output_config.effort: "low"`: tarefa simples e repetitiva; menos tokens e menos latência |
| Volume típico | Data Book de 23 dias ≈ 100 trechos ≈ 6–8 mil tokens de entrada + ~1 mil de instruções; saída ≈ 3–5 mil tokens |
| Custo estimado | ≈ **US$ 0,10–0,20 por Data Book** (geração) e o mesmo por nova preparação da revisão |

Há modelos mais baratos na mesma API (Claude Sonnet 5, US$ 2 / US$ 10; Claude Haiku 4.5, US$ 1 / US$ 5). A troca é
uma configuração (`DATABOOK_IA_MODEL`) e fica a critério de vocês; vale medir a qualidade num lote real antes de trocar.
Os preços são da tabela pública da Anthropic em 2026 e devem ser conferidos em
https://platform.claude.com/docs/en/about-claude/pricing antes da decisão.

**Lote (Batch API, 50% mais barato):** processa de forma assíncrona, em até 24 h. Não serve para a tela de revisão, que é
interativa, mas serve para uma variante noturna: revisar os RDOs aprovados no dia e deixar as sugestões prontas. Com o
volume de um Data Book, a economia absoluta é de centavos; só compensa se a revisão passar a rodar em todo RDO.

**Cache de prompt:** as instruções e o glossário (~1 mil tokens) ficam abaixo do tamanho mínimo cacheável; não compensa.

## 3. Saída estruturada (SDK Node `@anthropic-ai/sdk`)

O backend já usa `zod`. Com `client.messages.parse()` + `zodOutputFormat`, a resposta chega validada contra o esquema:

```js
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

const Resposta = z.object({
  itens: z.array(z.object({
    id: z.string(),
    corrigido: z.string(),          // texto mascarado, com os ⟦n⟧ preservados
    trocas: z.array(z.object({ de: z.string(), para: z.string() }))
  }))
});

const client = new Anthropic();     // lê ANTHROPIC_API_KEY do ambiente (validar em config/env.js)

export async function sugerirCorrecoesIA(itens /* [{ id, texto mascarado }] */) {
  const response = await client.messages.parse({
    model: env.databookIaModel,     // padrão 'claude-opus-5'
    max_tokens: 16000,
    output_config: { effort: 'low', format: zodOutputFormat(Resposta) },
    system: INSTRUCOES,             // abaixo
    messages: [{ role: 'user', content: JSON.stringify({ itens }) }]
  });
  if (response.stop_reason !== 'end_turn' || !response.parsed_output) return null; // fallback Hunspell
  return response.parsed_output.itens;
}
```

Instruções (`INSTRUCOES`), curtas e objetivas:

> Você revisa a ortografia de anotações de campo de uma empresa de limpeza industrial, em português do Brasil. Para cada
> item, devolva o texto com **apenas** erros de ortografia e acentuação corrigidos. Não reescreva, não mude a ordem, a
> pontuação nem o estilo. Os marcadores ⟦n⟧ devem aparecer exatamente como vieram. Termos técnicos do glossário estão
> corretos: boroscopia, flushing, desengraxe, passivante, sequestrante, spool, termovácuo… Se o item não tiver erro,
> devolva-o igual e `trocas` vazio.

Tratar também: `stop_reason: "refusal"` (improvável aqui; cai no Hunspell), erros tipados do SDK
(`Anthropic.RateLimitError`, `Anthropic.APIError`), com o retry padrão do SDK (2 tentativas), e timeout curto (~30 s)
para não travar a tela.

## 4. Como garantir que só a ortografia mudou (validação determinística)

Toda sugestão passa por `validarCorrecao(originalMascarado, corrigido)` antes de chegar à tela. Qualquer falha descarta
**aquele item** e mantém a sugestão do Hunspell:

1. **Marcadores intactos:** os mesmos `⟦n⟧`, na mesma ordem, nenhum criado ou removido.
2. **Mesmo número de palavras e mesma pontuação**, na mesma posição (tokenização igual à do `aplicarCorrecoes`).
3. **Cada palavra alterada é "a mesma palavra":** distância de edição ≤ 2 (ou ≤ 30% do tamanho), ou igual à original
   sem acentos (`acao` → `ação`). Isso barra sinônimos e reescrita.
4. **Só palavras minúsculas e alfabéticas mudam** (`palavraVerificavel` de `ortografia.js`).
5. **Coerência com `trocas`:** o diff entre original e corrigido precisa bater exatamente com a lista `trocas`.
6. As correções aprovadas são aplicadas pelo `aplicarCorrecoes` existente, por palavra inteira e só nos textos livres. Os
   dados técnicos (tags, horários, medições) seguem fora do alcance, como hoje.

Testes: um conjunto fixo de frases reais de RDO, anonimizadas, com as correções esperadas e casos-armadilha (tag com
erro aparente, nome próprio, medida, sinônimo tentador), rodado antes de trocar modelo ou instruções.

## 5. Privacidade e LGPD

- **Dados enviados:** só os textos livres, já mascarados. Nomes (palavras com maiúscula), tags e números não saem do
  servidor. Mesmo assim, texto livre pode citar pessoa ou cliente em minúscula; trate o envio como compartilhamento de
  dado operacional com um suboperador.
- **Termos da API (contas comerciais):** pelas condições comerciais da Anthropic, entradas e saídas da API não são usadas
  para treinar modelos. A retenção padrão é limitada, e há retenção zero (ZDR) mediante acordo. Confirmar as condições
  vigentes da conta em https://privacy.anthropic.com e nos termos comerciais antes de ativar.
- **Registro:** incluir a Anthropic como suboperadora e a transferência internacional no `LGPD_ROPA.md`, com a finalidade
  "revisão ortográfica de relatórios técnicos" e a base legal; atualizar o `LGPD_COMPLIANCE.md`.
- **Controle:** flag por ambiente (`DATABOOK_IA_ENABLED=false` por padrão) e log só de contagens (itens, tokens, tempo),
  nunca do texto.

## 6. Passos para implementar (estimativa: 1–2 dias)

1. `config/env.js`: `ANTHROPIC_API_KEY`, `DATABOOK_IA_ENABLED`, `DATABOOK_IA_MODEL` (+ `.env.example` e `env.test.js`).
2. `lib/databook/ortografia-ia.js`: mascarar/desmascarar, chamada `messages.parse`, `validarCorrecao`; testes com cliente
   falso, sem rede no CI.
3. `prepararRevisao`: IA quando ligada, Hunspell como fallback; o formato `ortografia.palavras` ganha `origem: 'ia'` e
   a sugestão vem pré-selecionada na tela.
4. Medir num Data Book real (custo por preparação e taxa de sugestões aceitas) antes de ligar em produção.
