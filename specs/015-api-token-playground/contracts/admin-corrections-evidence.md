# Evidências locais — correções administrativas (2026-09-08)

## Regressões e verificações

- Backend: 192 arquivos de teste aprovados com `NODE_ENV=test` e URL PostgreSQL fictícia em porta sem banco. O arquivo novo contém seis casos, cobrindo IDs/parâmetros/cursores antes de Prisma, paginação, campos de Qualidade, CIDRs e envelope seguro de erros (400/429/500).
- Frontend: 51 arquivos aprovados. Os quatro novos casos cobrem redução de política, confirmação/rotação, identidade explícita e descarte de parâmetros secretos da navegação, diagnósticos 400/403/404/409/429/500/503, falha de rede e redação. O teste de download passou a fornecer o status 200 real do contrato; respostas de erro não podem ser consideradas DOWNLOAD_CHECK bem-sucedido.
- TypeScript/Vite, ESLint dos componentes/cliente/página/tutorial envolvidos, `architecture:check` e `git diff --check` aprovados. Mantido aviso preexistente do Vite sobre chunks maiores que 500 kB.
- Code-review-graph consultado antes da exploração e na revisão final (changes, affected flows, review context, tests_for). O grafo não indexa a maior parte dos arquivos novos da feature e não associa testes ao cliente compartilhado; leitura direta e suites completas complementaram a revisão. A alteração no cliente compartilhado é aditiva: dois campos opcionais de diagnóstico, sem alterar autenticação ou interceptação.

## Navegador com APIs interceptadas

Vite local já existente em `localhost:5174`. Todas as chamadas `/api/**` foram interceptadas; nenhuma emissão, redução, rotação ou revogação atingiu dados reais.

1. Lista de 26 tokens: próxima página mostra o 26º; botão anterior disponível. Histórico de 26 eventos: segunda página mostra o último, com tipo traduzido, ator e resumo.
2. Redução: justificativa vazia exibiu erro acessível. Limite 101 contra teto atual 100 foi bloqueado com orientação de rotação. Redução válida retirou permissão dependente, projeto e rede, e alterou tamanho de página para 50; a rotação posterior recebeu a política reduzida.
3. Rotação: razão e confirmação vazias impediram revisão; preenchimento com ROTACIONAR e sobreposição de 15 minutos liberou revisão. Seleção adicional de Estoque apareceu somente na substituta. Revisão confirmou um projeto, uma rede e os quatro limites. A resposta fictícia abriu revelação única e desabilitou segunda rotação da anterior.
4. Revogação: erros junto à justificativa e ao texto REVOGAR; confirmação válida fechou o diálogo e desabilitou ações terminais.
5. Console: uma resposta 200 foi substituída por 429/RATE_LIMITED com requestId. O sucesso anterior não permaneceu. F5 preservou credencial/operação/permissão e limpou o resultado; segredo fictício ausente de localStorage/sessionStorage.
6. Credencial fora da primeira página foi restaurada por ID com a primeira página da lista carregada. Detalhe e cursor de eventos também foram restaurados. ID inexistente mostrou erro e execução desabilitada, sem selecionar outro token. Sem `credential`, a opção permaneceu Selecione.
7. Larguras 360/768/1440: largura de página igual à viewport. Modais com corpo rolável e ações visíveis; redução com 336 px úteis sem overflow em 360, rotação com 720 px úteis sem overflow em 768. Ajustados alinhamento e cor de checkboxes de projetos/redes.

Capturas e fixture descartável em `frontend/output/playwright/`, ignoradas pelo Git. A sessão de navegador foi encerrada. Os avisos de chaves duplicadas encontrados durante o teste foram corrigidos com chaves distintas para ações e atividade; o reload final não apresentou esses avisos. Erros HTTP 404/429 simulados são esperados.

## Limites do aceite

Não foi executada homologação com banco/segredo/rede reais, publicação ou migração. T088 permanece aberta para o operador. Permanecem 33 escopos concedíveis e 35 operações de teste; os 49 candidatos futuros não foram habilitados. Não há migração nova neste incremento.
