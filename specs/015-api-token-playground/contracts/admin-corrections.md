# Correções administrativas — 2026-09-08

## C1 — Validação

- Parâmetros de todas as operações e IDs administrativos validados com Zod antes de Prisma. Cursores administrativos aceitam somente base64url de `{createdAt: ISO, id: string}` com limites e tipos estritos; inválidos retornam 400 sem consulta.
- Redução, rotação e revogação usam RHF/Zod, justificativa de 10–500 caracteres, confirmação explícita e erro acessível junto ao campo. Datas são exibidas no fuso local e convertidas para UTC somente no payload.
- Erros administrativos usam envelope seguro `{error, message, code, requestId, fields?}`; manter `error` para compatibilidade com o cliente existente. Nunca devolver stack, conteúdo de entrada, segredo ou caminho interno.

## I1 — Política e ciclo de vida

- Redução permite retirar escopos com seus dependentes, restringir projetos/IPs, diminuir os quatro limites e antecipar/definir expiração. Nunca permite zerar escopos/projetos selecionados ou remover a última restrição de IP para tornar o token irrestrito. Backend continua autoridade para impedir ampliação.
- Rotação abre configuração de substituta com política atual como base, seleção das 33 permissões disponíveis, projetos/IPs/limites/validade editáveis, justificativa e sobreposição de 0/15/30/60 minutos. Segredo só é emitido após revisão e confirmação; não expiração precisa de confirmação digitada nova, não preenchida automaticamente.
- Ações preservam versão otimista, idempotência e revelação única. Erro não fecha o editor; sucesso atualiza credencial, lista, uso e eventos. Estados terminais não podem ser reativados.

## C2/I2 — Navegação, paginação e auditoria

- Lista e eventos usam `nextCursor/hasMore`, oferecem próxima/anterior e estado vazio/erro distinto. Troca de filtros reinicia a paginação correspondente.
- URL preserva `credential` para teste, `detail` para detalhe, `cursor` para lista e `eventCursor` para histórico; IDs não são segredos. Nunca persistir token, payload ou resposta.
- Buscar credencial por ID permite restaurar seleção fora da primeira página; ID ausente/inacessível deve mostrar erro, nunca selecionar outro token silenciosamente. Filtros da lista não trocam a identidade testada.
- Eventos apresentam tipo em pt-BR, data, ator, justificativa e resumo redigido do backend; erro ao carregar não se apresenta como histórico vazio.

## I3 — Console

- Cada tentativa limpa o sucesso anterior e apresenta resultado correspondente: status, código/mensagem segura, duração e requestId quando recebido. Falha de rede não inventa status HTTP/requestId.
- Alterações de operação/permissão/credencial/filtros invalidam respostas em trânsito. Resposta de erro não entra em storage nem cache persistente.
- cURL continua com variáveis de ambiente; falha de cópia recebe aviso/fallback. Erro de download não pode ser apresentado como verificação concluída.

## I4 — Catálogo

- Registros, naturezas, metadados de evidências, excluídos e download descrevem campos reais (incluindo disponibilidade e tombstones), sem placeholder genérico. Não altera a projeção pública nem habilita dados adicionais.

## Aceite e operação

Regressões inicialmente falhas devem cobrir cada lacuna. Validar formulários, 26+ tokens/eventos, refresh em credencial fora da primeira página, IDs ausentes, redução/ampliação negada, rotação configurada, sucesso seguido de 400/403/404/409/429/5xx, catálogo e responsividade. Testes/preview somente locais e com fixtures. T088 e publicação permanecem a cargo do operador; sem migração nova.
