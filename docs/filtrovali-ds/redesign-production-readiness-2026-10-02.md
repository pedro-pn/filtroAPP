# Avaliação para produção — redesign, 02/10/2026

## Resultado

**Não há pendência visual conhecida aberta após esta rodada.** UX-E1/E2 foram
concluídos; o gráfico de evolução e o carregamento receberam os ajustes pedidos.
O conjunto está pronto para homologação final. A publicação ainda depende da CI
do commit integrado, da conferência em aparelho físico/SMTP real e do deploy
coordenado com migrations. Esta avaliação não representa uma publicação realizada.

## Verificações realizadas

| Verificação | Resultado / evidência |
| --- | --- |
| Conciliação com main remota | `git fetch origin`; nenhum commit exclusivo de `origin/main`, até `a9d9f6ee`. |
| Arquitetura | `npm run architecture:check` aprovado, sem ampliar budgets. |
| Frontend | 645/645 testes; mais 20 testes focados após o ajuste de camadas; lint, tipagem E2E e build aprovados. |
| Backend | 1.834 aprovados, zero falhas e oito integrações opcionais não habilitadas, em banco novo terminado em `_test`, eliminado ao final. |
| Migrations | Todas aplicadas em banco descartável antes dos testes backend. |
| Dependências | `npm audit --audit-level=high`: frontend zero ocorrências; backend duas moderadas (`fast-uri`, `morgan`), nenhuma alta/crítica. O limiar usado pela CI passou. As moderadas continuam para triagem. |
| Acabamentos em navegador | 14/14 em Chromium e WebKit: três tamanhos, dois temas; largura das barras, foco/tooltip, preenchimento rápido, progresso real, movimento reduzido e uploads. |
| Cabeçalho estreito | 2/2 testes adicionais: nomes longos em 320 px, sem overflow local. |
| Telas afetadas | Cinco telas/estados × 12 combinações = 60 recortes; 12/12 testes, incluindo contraste de texto sobre fundos planos. |
| Gravação de documentos | Selecionar, remover, arrastar, validar 20 MB e versão obrigatória, salvar arquivo inicial/nova versão; SQL e recarga confirmaram nome, identificação e tamanho dos dois arquivos, nos dois motores. |
| Acesso local | Login em 5173 e 5174, em Chromium e WebKit; caches distintos por processo, sem exceções ou HTTP com falha. O reinício informado pelo usuário resolveu o acesso; o erro original não foi recuperado. |
| Build compilado | Login e planejamento real abriram em Chromium/WebKit com a API isolada. Corrigido o encaminhamento indevido dos bundles/fontes/imagens com hash para a API no `vite preview`. |
| CI remota da branch | Não há execução registrada para `feat/frontend-redesign-2` nesta conferência. Os checks locais não substituem os jobs remotos, incluindo Docker. |

A primeira rodada backend usou `SEND_CLIENT_EMAILS=false`, configuração do runner
visual, e contrariou um teste que exige o envio habilitado para verificar a falta
de SMTP. A repetição com a configuração padrão da CI, sem credenciais SMTP e em
outro banco descartável, passou. Não foi necessário alterar código backend e
nenhum e-mail externo foi enviado. Os oito testes opcionais não habilitados
cobrem permissões fiscais, previsões comerciais, apelido do card, exclusão de
simulações, webhook comercial, concorrência de alocação, exclusão de projeto e
sistemas do projeto; não são apresentados como executados nesta rodada.

As evidências são locais e ignoradas pelo Git:

- `output/playwright/redesign-polish-final/`, `redesign-long-names/` e `redesign-readiness-pages/`;
- `output/validation/readiness-frontend-tests.log`, `readiness-focused-tests.log`, `readiness-backend-tests-ci.log`;
- `output/validation/readiness-migrations-ci.log`, `readiness-build.log`, `readiness-servers-smoke.json`;
- `output/validation/readiness-frontend-audit.json` e `readiness-backend-audit.json`.

## Passos para publicar

1. Integrar o commit revisado e aprovar a CI de arquitetura, frontend, backend e
   imagens Docker. A branch já contém a main verificada nesta rodada.
2. Homologar em aparelho físico os gestos/mobile e a assinatura com canvas/câmera;
   confirmar entrega dos e-mails em homologação. O SMTP local só capturou mensagens.
   Leitor de tela também não foi exercitado; não há declaração de certificação WCAG.
3. Fazer backup e publicar frontend e backend juntos. O delta para a main inclui
   a migration `20260928120000_project_acompanhamento_card_name`, que adiciona
   `Project.acompanhamentoCardName`, e ajustes de API de projetos/calendário/cliente.
   Não publicar apenas os arquivos frontend contra o backend antigo.
4. Seguir [o procedimento de produção](../../deploy/PRODUCTION.md) e conferir
   login, abertura dos módulos, planejamento, documento anexado e assinatura
   no ambiente publicado.

O [roadmap](../REDESIGN_ROADMAP.md) e a
[auditoria por página](redesign-final-audit-2026-10-02.md) estão atualizados.
