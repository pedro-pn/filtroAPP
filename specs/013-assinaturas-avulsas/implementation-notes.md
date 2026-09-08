# Notas de implementação / PR — Assinaturas Avulsas

Data da validação: 2026-08-28.

## Decisões e itens N/A

- **T130 — novidade temporária:** N/A. A entrega cria um módulo novo; conforme a constitution, ele recebe onboarding permanente de primeiro acesso, não uma campanha temporária de dez dias para função adicionada a módulo existente.
- **T134 — reordenação drag and drop:** N/A. A ordem dos assinantes é a ordem de criação. O posicionamento das caixas no PDF usa Pointer Events, `touch-action: none` e restaura a geometria original em `pointercancel`; a persistência no backend ocorre apenas ao acionar “Salvar campos”.
- **T138 — identidade portada:** N/A. Não existe aplicativo de origem. Todas as superfícies usam o shell, componentes e tokens do kit do FiltroAPP.

## Exclusão de conta — decisão D16

A exclusão de uma conta remove somente documentos `RASCUNHO`, `AGUARDANDO_ASSINATURAS` ou `CANCELADO`. Seus arquivos são movidos primeiro para uma quarentena com manifesto durável e rollback/reconciliação. Documentos `CONCLUIDO` permanecem como órfãos (`ownerUserId = NULL`), preservando nome histórico, evidências, convite assinado válido e validação pública. A existência de qualquer documento `FINALIZANDO` bloqueia a exclusão antes de tocar no filesystem.

## Segurança e observabilidade

- O segredo do convite existe no fragmento do browser, é removido com `history.replaceState` antes das chamadas e segue para a API somente em `X-Signature-Token`.
- Query strings são removidas do log HTTP e o contexto de erro usa `req.path`; erros 5xx passam pela sanitização do token.
- Logs do domínio aceitam somente campos estruturados em whitelist, sem e-mail, IP, URL, token ou caminho absoluto, e incluem duração/tentativas quando aplicável.
- O cache HTTP público é `no-store`; a query pública usa uma chave opaca de sessão com `gcTime: 0`.

## Data e hora

Listagem, detalhe, estado/expiração por assinante, auditoria, convite público e validação pública usam `formatSignatureDateTime`, fixado em `America/Sao_Paulo`. Essa é uma divergência intencional do padrão legado de algumas telas do frontend, que usa o fuso do navegador.

## Evidência de desempenho (SC-012 / SC-013)

Comando: `cd backend && npm run benchmark:assinaturas`.

Fixture local: PDF de 30 páginas, dez assinantes e dez campos, executado em 2026-08-28.

| Medida | Resultado | Limite |
|---|---:|---:|
| Prévia inicial da página 1 | 193,89 ms | 2.000 ms |
| Prévia em cache da página 1 | 0,62 ms | 250 ms (P95 alvo) |
| Geração do PDF final | 87,81 ms | 5.000 ms |

O script falha com exit code diferente de zero se qualquer limite for ultrapassado. O valor de cache acima é uma medição local pontual; o P95 de produção deve continuar acompanhado pela observabilidade estruturada de `preview.render`.

## Quickstart e etapas de operador

Os cenários determinísticos do quickstart estão cobertos nas suítes `assinaturas-*`: acesso/proprietário, upload e hash, publicação, e-mail/retry, assinatura/idempotência, rotação, finalização/rename, QR/validação, retenção e exclusão de conta com falhas de filesystem.

Permanecem como validação de operador porque exigem ambiente vivo e, conforme o próprio quickstart, não devem ser executados automaticamente por agente:

- aplicar/deployar migrations no banco do ambiente;
- smoke visual desktop/mobile com o bundle atual servido;
- entrega real por SMTP e leitura do e-mail recebido;
- escanear o QR com dispositivo físico;
- confirmar P95 em observabilidade de staging/produção.
