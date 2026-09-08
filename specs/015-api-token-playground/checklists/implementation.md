# Evidências de implementação

**Feature**: `015-api-token-playground`

**Execução automatizada**: 2026-09-04T19:58:43Z
**Ambiente**: workspace local/teste, sem servidor, migração aplicada ou deploy

## Gates automatizados

- [x] Backend: 189 arquivos/suítes aprovados, 0 falhas (`npm --prefix backend test`).
- [x] Frontend: 47 arquivos/suítes aprovados, 0 falhas (`npm --prefix frontend test`).
- [x] Build de produção do frontend aprovado (`npm --prefix frontend run build`).
- [x] Architecture check aprovado (`npm run architecture:check`).
- [x] ESLint terminou com 0 erros; permaneceu 1 aviso preexistente fora desta feature em `useRdoPlanningPrefill.ts`.
- [x] Prisma schema formatado, validado e client gerado; migração não foi aplicada neste workspace.
- [x] OpenAPI parseado sem chaves duplicadas; 14 operações, IDs únicos, `$ref`, handlers e schemas conferidos por teste.
- [x] Catálogo executável conferido contra os 126 modelos de negócio e o contrato Markdown.
- [x] `git diff --check` aprovado.

## Homologação — execução exclusiva do operador autorizado

Os itens abaixo permanecem deliberadamente pendentes. Este workspace não identifica um ambiente de homologação, não possui autorização operacional para aplicar a migração e a tarefa proíbe executar o roteiro fora desse ambiente.

- [X] Aplicar/revisar a migração no banco de homologação e validar rollback.
- [X] Validar `/admin/tokens` com contas `ADMIN` e `INTERNAL` reais.
- [X] Emitir credencial mínima de 24 horas e comprovar revelação única sem registrar o segredo.
- [X] Percorrer carga completa e incremental de Qualidade com dados de homologação.
- [X] Validar restrições reais de projeto, IP/proxy, escopos, expiração, rotação e revogação.
- [X] Exercitar cotas concorrentes e persistência entre instâncias.
- [X] Correlacionar uso/eventos por request ID e confirmar ausência de segredo nos logs autorizados.
- [X] Registrar aceite operacional e decisão de liberação sem anexar headers, corpos ou tokens.

Quando o operador concluir os itens, deve adicionar somente data, ambiente, request IDs não sensíveis e resultado; nenhum segredo, verificador, `Authorization`, caminho privado ou resposta integral.

## Incremento operacional — evidências locais de 2026-09-08

Preservados os registros e as marcações anteriores do usuário. Este incremento não executou migração, deploy, emissão/revogação real de token ou consulta de dados reais.

- [x] Backend: 190 arquivos de testes aprovados, 0 falhas, com ambiente sintético (`DATABASE_URL` fictícia e `NODE_ENV=test`).
- [x] Frontend: 49 arquivos de testes aprovados, 0 falhas; inclui renderização do catálogo unificado e parâmetros por operação.
- [x] Build TypeScript/Vite aprovado; permanece aviso de chunks grandes. ESLint dos arquivos de UI da feature sem erros/avisos, architecture check e `git diff --check` aprovados.
- [x] Contrato OpenAPI: 29 operações, referências válidas e projeções/campos/parâmetros das 15 coleções operacionais conferidos contra descritores e Prisma. Cota diária menor que a página e cursor com 500 projetos cobertos por regressão.
- [x] Navegador com fixtures interceptadas: busca e seleção de relatórios no próprio catálogo, bloqueio de PII de colaboradores, escolha de relatório no console e exibição somente dos parâmetros compatíveis. Capturas locais ignoradas em `output/playwright/api-operational-*.png`.
- [x] Console sem overflow em 360/768/1440 px: largura do documento e scrollWidth do main iguais à viewport. Catálogo conferido visualmente nas mesmas três larguras.

Entrega: 12 novos escopos (17 ao todo), 15 novas coleções (19 operações externas ao todo), seleção unificada e console alimentado pelo servidor. Ainda fora: arquivos adicionais, financeiros, PII completa e os 65 escopos candidatos restantes. Publicação, latência em carga real, testes de rede/proxy e homologação do incremento seguem responsabilidade do operador conforme seção 12 do quickstart.
