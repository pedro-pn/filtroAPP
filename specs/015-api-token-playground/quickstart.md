# Quickstart de validação: API Playground e Qualidade v1

Este roteiro é para a fase de implementação/homologação. Nenhum comando de servidor, migração ou deploy foi executado durante o planejamento.

## 1. Pré-condições operacionais

- HTTPS obrigatório no endereço público.
- Chave `API_TOKEN_HASH_KEY_V1` criada em cofre de segredos, com acesso apenas ao backend; nunca versionada ou exibida em log.
- Cadeia de proxy confiável configurada antes de habilitar restrição por IP.
- CORS da árvore `/api/integracoes/v1` fechado por padrão.
- Migração Prisma revisada e aplicada pelo operador no ambiente correto.
- Conta de teste `ADMIN`, conta `INTERNAL` e projetos/registros de Qualidade de homologação.

## 2. Gates automatizados

Após a implementação, o operador executa no ambiente de desenvolvimento/homologação:

```bash
npm run architecture:check
npm --prefix backend test
npm --prefix frontend test
npm --prefix frontend run build
```

O conjunto precisa provar:

- entropia/formato do token, HMAC e comparação constante;
- segredo ausente em todas as serializações, eventos e logs;
- `requireAuth` + `requireHubAdmin` em todas as rotas administrativas;
- middleware de integração não aceita sessão humana e rotas admin não aceitam token `fva_`;
- matriz positiva/negativa dos cinco escopos de Qualidade;
- restrição de projeto e IP, início, expiração, revogação e sobreposição de rotação;
- idempotência de criação/rotação/revogação, inclusive resposta de revelação perdida;
- cotas concorrentes por minuto/dia/linhas e página máxima;
- cursor adulterado, cursor com filtros diferentes e empate de `updatedAt`;
- projeções sem `seq`, `year`, IDs completos de usuários, `storagePath`, `publicToken` ou campo Prisma novo não contratado;
- acessibilidade e responsividade em 360 px, 768 px e desktop.

## 3. Validar acesso administrativo

1. Entrar como `ADMIN` e abrir `/admin/tokens`.
2. Confirmar navegação entre **Contas** e **Tokens de API**.
3. Entrar como `INTERNAL` e confirmar bloqueio da rota no cliente.
4. Com a sessão `INTERNAL`, chamar `GET /api/admin/api-scopes` e confirmar `403` do servidor.
5. Sem sessão ou com token de integração, confirmar `401` nas rotas administrativas.

## 4. Emitir uma credencial mínima de Qualidade

No painel:

- Nome: `Extrator Qualidade - homologação`.
- Finalidade: `Carga dos registros de Qualidade no repositório do colaborador`.
- Responsável/destinatário de homologação (contato não é solicitado na UI).
- Início: agora.
- Validade: 24 horas para o teste; confirmar que 30 dias é o preset inicial em nova criação.
- Escopos: `qualidade.registros.read` e `qualidade.naturezas.read`.
- Projetos: selecionar dois projetos de teste.
- IP: informar o CIDR do consumidor de homologação ou deixar vazio neste primeiro teste.
- Limites: 60 req/min, 10.000 req/dia, 500.000 linhas/dia e 100 itens/página.

Ao gerar:

1. conferir `Cache-Control: no-store` e `Pragma: no-cache`;
2. copiar o segredo uma única vez para um cofre temporário;
3. fechar o modal e comprovar que detalhe/listagem exibem apenas prefixo e últimos quatro;
4. recarregar a página e confirmar que o segredo não é recuperado;
5. pesquisar storage e query string do navegador e confirmar que o token não foi persistido.

## 5. Testar no playground

1. Selecionar `quality.records.list`.
2. Informar `limit=10` e um `projectCode` permitido (ou `projectId` para compatibilidade).
3. Conferir que método/caminho não são editáveis e não existe campo de URL externa, header livre ou corpo.
4. Executar e verificar status, duração, requestId, itens e cursor.
5. Conferir que a requisição visível mostra `Bearer ••••<last4>`.
6. Copiar o exemplo e confirmar que ele contém `$FILTRO_API_TOKEN`, não o segredo.
7. Tentar `includeDeleted=true` e confirmar `403` por ausência de `qualidade.excluidos.read`.
8. Tentar download de evidência e confirmar `403` por ausência dos escopos de evidência.

## 6. Consumir a API externamente

Defina o segredo no ambiente seguro do cliente. O comando abaixo é apenas um modelo e deliberadamente não contém um token real:

```bash
curl --fail-with-body \
  --header "Authorization: Bearer $FILTRO_API_TOKEN" \
  --header "Accept: application/json" \
  "https://app.exemplo/api/integracoes/v1/qualidade/registros?limit=100&updatedSince=2026-01-01T00%3A00%3A00Z"
```

Para carga completa:

1. congelar os filtros usados;
2. iniciar sem `cursor`;
3. processar `items` de forma idempotente por `id`;
4. repetir com `page.nextCursor` enquanto `page.hasMore=true`;
5. nunca reutilizar o cursor com filtros diferentes;
6. guardar `page.snapshotAt` da primeira página como teto confirmado para a próxima sincronização e o maior par `(updatedAt, id)` como checkpoint local;
7. usar uma pequena janela de sobreposição e upsert por `id` para tolerar atraso/concorrência.

O cliente deve tratar:

- `401 INVALID_TOKEN`: substituir/rotacionar a credencial sem tentar descobrir a causa;
- `403`: solicitar apenas o escopo/projeto necessário;
- `429 RATE_LIMITED`: respeitar `Retry-After` e aplicar backoff com jitter;
- `400`: corrigir filtro/cursor, sem repetir cegamente;
- `5xx`: repetir com backoff e registrar `requestId` para suporte.

## 7. Validar evidências e excluídos

Rotacione a credencial acrescentando, um conjunto por vez:

1. `qualidade.evidencias.metadata.read`: o array `evidences` passa a conter somente id, tipo, rótulo, nome, MIME, posição, data e disponibilidade.
2. `qualidade.evidencias.download`: o endpoint de arquivo funciona apenas para evidência ligada a registro/projeto permitido; URL e caminho continuam ausentes.
3. `qualidade.excluidos.read`: `includeDeleted=true` passa a devolver `deletedAt` e tombstones contratados.

Em cada passo, confirmar que a credencial anterior não ganhou escopo e que a nova foi revelada uma única vez.

## 8. Validar ciclo de vida

- Criar uma credencial agendada e confirmar `401` antes de `startsAt` e sucesso depois.
- Criar uma credencial de duração curta e confirmar bloqueio na primeira chamada após `expiresAt`.
- Revogar com justificativa e confirmar bloqueio imediato.
- Rotacionar com revogação imediata; confirmar nova ativa e antiga bloqueada.
- Rotacionar com sobreposição curta; confirmar ambas apenas até `revokePreviousAt`, depois somente a substituta.
- Repetir uma emissão com o mesmo `Idempotency-Key`; confirmar que nenhum segundo segredo é criado e que o primeiro não é reexibido.
- Reduzir um escopo e um projeto; confirmar efeito na chamada seguinte.
- Tentar adicionar escopo por `PATCH`; confirmar `409`/erro orientando rotação.
- Selecionar “sem expiração”; confirmar alerta, texto digitado obrigatório e alerta permanente na lista.

## 9. Validar cotas e auditoria

- Ultrapassar `maxPageSize` e receber `400`, sem executar consulta maior.
- Ultrapassar requisições/minuto e receber `429` com `Retry-After`.
- Ultrapassar linhas/dia e confirmar recusa antes de devolver mais dados.
- Reiniciar uma instância em homologação e comprovar que a cota autoritativa persiste.
- Executar duas chamadas concorrentes no limite e comprovar que o contador não permite excedente.
- Abrir eventos/uso e conferir criação, revelação, teste, rotação e revogação.
- Pesquisar logs por prefixo conhecido e confirmar ausência do segredo, verificador, `Authorization`, corpo e resposta integral.

## 10. Critérios de liberação

A funcionalidade só pode ser habilitada em produção quando:

- checklist de requisitos e gates automatizados estiverem verdes;
- OpenAPI estiver validado e exemplos corresponderem às respostas reais;
- catálogo disponibilizar somente os 33 escopos implementados de Qualidade e dos contratos `contracts/operational-read.md` e `contracts/operational-expanded-read.md`, sem conceder os 49 candidatos futuros;
- teste de campo ausente provar a allowlist da projeção;
- retenção e acesso aos logs forem aprovados;
- runbook de vazamento incluir revogação, rotação e busca por requestId;
- data de lançamento e expiração do tutorial de 10 dias estiverem registradas;
- monitoramento alertar sobre `401`, `403`, `429`, latência e aproximação das cotas sem capturar dados sensíveis.

## 11. Rollback seguro

Em incidente, o operador deve poder desabilitar a montagem da árvore externa ou revogar todas as credenciais ativas por procedimento auditado, mantendo as tabelas e eventos para investigação. Rollback de código não deve reativar token revogado nem remover a migração já aplicada. Nunca imprimir/exportar os verificadores durante o diagnóstico.

## 12. Homologação própria do incremento operacional (2026-09-08)

1. No catálogo unificado, pesquisar relatórios e marcar `rdo.relatorios.read`; pesquisar colaboradores, equipamentos e manutenção e marcar somente os dados necessários. Confirmar que dados pessoais completos e futuros arquivos continuam desabilitados.
2. Emitir nova credencial de teste com projetos selecionados. Confirmar que tokens anteriores de Qualidade não ganharam escopos e recebem `403` nas novas operações.
3. Consultar as 15 coleções listadas no contrato operacional. `Report`/`MaintenanceRecord` publicam o estado atual `APPROVED`; relatórios excluídos, pendentes ou de projetos não autorizados não aparecem. Conferir minimização dos campos, incluindo ausência de CPF, e-mail, custo, JSON livre, assinaturas e arquivos.
4. Conferir que colaboradores em `SELECTED` são somente participantes de relatórios aprovados nos projetos permitidos. Cadastros globais (cargos, segmentos, DDS, perfis, equipamentos e estoque) não devem aceitar `projectCode` nem `projectId`. Manutenções avulsas não aparecem em `SELECTED`.
5. Percorrer páginas com empates de `updatedAt`, testar alteração de filtros/projetos/cursor, limitar paginação à cota do token e comprovar `429` quando a página excede toda a cota diária.
6. No console, escolher uma nova operação, confirmar que somente parâmetros compatíveis aparecem e que trocar operação limpa filtros anteriores. Validar cota, evento `TESTED`, uso externo e request ID sem guardar respostas/segredos como evidência.
7. Avaliar latência no volume real antes da publicação. Validar reconciliação completa periódica para exclusões e mudanças de visibilidade, pois as coleções novas não geram tombstones. Não interpretar `snapshotAt` como snapshot transacional de múltiplas páginas.

Sem nova migração neste incremento; a configuração de tokens do primeiro marco precisa já existir no ambiente correto. Nenhuma ação de servidor deste roteiro é executada pelo agente.

## 13. Homologação da expansão de relatórios, estoque e manutenção

Roteiro para o operador após publicar o código, usando dados de homologação e segredos de teste. Não executado em banco real pelo agente.

1. Abrir Novo token como admin. Confirmar 33 permissões concedíveis e 49 candidatos bloqueados. Selecionar download de relatório e verificar base + metadados automaticamente selecionados. Selecionar custos e verificar itens + movimentos. Remover a base deve remover dependentes. Um token anterior deve manter as permissões originais.
2. Validar as 13 consultas do contrato `operational-expanded-read.md` com projetos distintos. Conferir exclusão de relatórios/versões não publicados, registros excluídos, projetos excluídos, anexos órfãos e vínculos não autorizados; manutenções/movimentos avulsos somente em ALL. Documentos técnicos de estoque são globais.
3. Percorrer páginas com timestamps empatados e com múltiplos colaboradores por relatório. Usar `createdSince` nos registros sem `updatedAt`; conferir que `updatedSince` é rejeitado nesses casos. Equipe exige reconciliação completa. Trocar filtro, operação ou recorte com o mesmo cursor deve falhar.
4. Conferir que movimentos não retornam custos. Custos devem retornar valores decimais como string e manter a indicação de exclusão do custo de projeto. Assinaturas não retornam identidade, imagens, hashes ou tokens; auditoria não retorna ator, texto livre, IP ou user-agent.
5. Baixar arquivos de cada grupo com base + metadados + download; retirar qualquer dependência deve negar. ID inacessível/arquivo ausente retornam 404 indistinguível. Testar documento legado FISPQ e RDO na pasta do projeto; arquivos legados fora da pasta autorizada devem permanecer negados. Arquivo acima de 50 MiB retorna 413. Conferir attachment, no-store, nosniff e medição de bytes/requisições.
6. No console, conferir filtros de relatório/manutenção/item, criação versus atualização e aviso de equipe. Download aparece como verificação de disponibilidade em JSON, sem transferência do arquivo. Validar restrição de IP na rede do consumidor, expiração, revogação e 429, além de latência no volume real.

Gates locais automatizados são registrados na Phase 11 de `tasks.md`; não substituem esse aceite operacional. Não há migração nova neste incremento.

## 14. Homologação do Playground genérico

1. Em **Testar API**, escolher a credencial e pesquisar uma das 33 permissões implementadas por nome, módulo ou código. Conferir que as operações correspondem à permissão, incluindo `qualidade.excluidos.read` e os quatro downloads. Candidatos futuros não são testáveis.
2. Consultar listagens de relatórios, colaboradores, equipamentos, estoque e manutenção sem ID individual. Conferir que filtros opcionais e limite variam por operação; limite no painel é de até 20 itens, respeitando também a credencial.
3. Selecionar uma consulta individual ou download. Confirmar a indicação do ID esperado (registro, evidência, anexo ou documento) e erro junto ao campo obrigatório antes de qualquer requisição. Obter o ID na listagem de metadados correspondente.
4. Trocar a permissão, operação e credencial: filtros, IDs e resposta anterior devem ser limpos. Pesquisar outra opção após uma seleção não deve apagar o texto digitado. Token sem a permissão/dependências deve impedir o teste.
5. Para download, conferir `kind: DOWNLOAD_CHECK`, disponibilidade, MIME e tamanho; não deve haver conteúdo binário, URL interna nem caminho de armazenamento. A verificação está limitada a 50 MiB. Validar o download real separadamente pela API externa com o token de teste.
6. Conferir estados inválidos, paginação/snapshot em opções avançadas, auditoria `TESTED` e cotas. Validar a interface em 360, 768 e 1440 px. O painel usa sessão administrativa: não substitui o teste externo do segredo Bearer e das regras de IP.

Evidências locais usam fixtures, sem emissão de token ou acesso a banco real. O aceite operacional T088 permanece com o operador; não há nova migração ou publicação neste incremento.

## 15. Aceite das correções administrativas

1. Com 26+ tokens/eventos de teste, percorrer próxima/anterior, alterar filtros e conferir reinício de página. Eventos mostram tipo em pt-BR, ator, justificativa e resumo; erro de carregamento deve ser distinto de lista vazia.
2. Abrir detalhes de um token fora da primeira página, atualizar e abrir no Playground. A seleção deve continuar no mesmo ID, mesmo com filtros que ocultem o token na lista. ID inexistente/inacessível deve gerar erro sem escolher outra credencial.
3. Reduzir escopos, projetos, redes IP, os quatro limites e expiração. Tentar ampliar cada campo, retirar todas as permissões, todos os projetos selecionados ou a última restrição de IP: erro por campo, sem envio. Confirmar UTC no payload e justificativa de 10–500 caracteres.
4. Rotacionar revisando a política copiada; acrescentar uma permissão apenas à substituta. Validar justificativa, `ROTACIONAR`, sobreposição e confirmação nova de não expiração. Conferir revisão, exibição única e atualização do histórico; conflito não deve fechar o editor.
5. Revogar sem justificativa/texto e conferir os dois erros. Com justificativa e `REVOGAR`, confirmar estado terminal. Usar somente credencial de homologação autorizada.
6. Simular sucesso seguido de 400/403/404/409/429/5xx e falha de rede. Console deve substituir o sucesso por diagnóstico seguro; erros de download não mostram verificação concluída. Parâmetros inválidos devem falhar antes de Prisma. Cursor administrativo malformado deve retornar 400.
7. Conferir os campos reais das cinco permissões de Qualidade e a UI em 360/768/1440 px, incluindo rodapés fixos de modais, foco e mensagens de erro. Verificar que token/resposta não foram gravados em URL, storage ou cache persistente.

O contrato detalhado está em `contracts/admin-corrections.md`. Testes locais usam APIs interceptadas e fixtures. T088 continua responsabilidade do operador; este incremento não requer migração nova.
