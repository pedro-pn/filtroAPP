# Feature Specification: Simulação de escritas da API

Created: 2026-10-29. Status: implementada e validada localmente; sem deploy.
Origem: `../omni/docs/integracoes/prompt-filtroapp-simulacao.md`.

## Contrato e aceitação

1. `Prefer: validate-only` simula qualquer escrita de `/api/integracoes/v1`.
   Credenciais `writeMode: SIMULATE` sempre simulam; `LIVE` é o padrão legado.
2. Executar a mesma autorização, recorte, cotas, validação, regras, resolução de
   responsáveis e idempotência da escrita real. Nunca ampliar escopos implicitamente.
3. Executar serviços e transações internas no mesmo cliente transacional, com
   rollback obrigatório inclusive de gatilhos, sequências transacionais, recibos,
   auditoria, eventos e notificações. Não invalidar caches ou executar efeitos
   externos/pós-commit. Sem suporte declarado, recusar com 501 antes de executar.
4. Sucesso: HTTP 200, `Preference-Applied: validate-only`, envelope
   `{ simulated: true, operation, would, warnings: [], requestId }`.
   `would` usa projeções explícitas dos dados calculados no banco; não contém IDs
   temporários. Referências a usuários já existentes são permitidas. A numeração
   provisória de Qualidade é `previewNumber` e nunca é consumida.
5. Erros preservam código/corpo da escrita real e incluem Preference-Applied.
   Leituras e escritas LIVE sem preferência preservam seus contratos.
6. ApiRequestLog registra simulated fora do rollback; cotas e lastUsedAt continuam
   sendo metadados operacionais persistentes. Logs não incluem corpo/e-mail/token.
7. Cobrir as cinco operações atuais e bloquear novas escritas sem declaração,
   executor transacional e caso na matriz genérica de testes.
8. Administração permite criar, listar e alterar writeMode com justificativa,
   controle de versão e auditoria. Aumento de escopos continua por rotação; a
   substituta preserva SIMULATE. Omni pode receber qualidade.registros.create.
9. Playground simula por padrão; escrita real exige seleção explícita e continua
   subordinada ao modo da credencial. Atualizar documentação, OpenAPI e novidade
   temporária de dez dias para administradores, com tutorial dos controles.

## Cenários obrigatórios

- Para cada operação: simular por header e por credencial, comparar contagem e
  conteúdo das tabelas afetadas; executar LIVE e comprovar persistência.
- Qualidade: responsável inexistente 422; simular e gravar com a mesma chave;
  conflito com chave real 409; contador/numeração e feed intactos.
- Validar escopos, projetos, cotas, erros, rollback em falha e caches intactos.
- Contratos e architecture:check detectam rota ou operação sem cobertura.

## UI

Controles usam Select/Button compartilhados e mensagens de erro acessíveis.
Preservar layout responsivo e navegação atual por URL. Campanha de novidade de
2026-10-29 a 2026-11-08 em America/Sao_Paulo, marcada por usuário/navegador.
