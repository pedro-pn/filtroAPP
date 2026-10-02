# Avaliação para produção — redesign, 02/10/2026

## Resultado

**Não há pendência visual conhecida aberta após esta rodada.** UX-E1/E2 foram
concluídos; o gráfico de evolução e o carregamento receberam os ajustes pedidos.
O conjunto está pronto para integração e publicação pelo procedimento habitual.
O usuário confirmou que assinatura e envio de e-mails já funcionam no ambiente
atual. As últimas correções deste lote alteraram somente o frontend e a
documentação. Os limites da validação local em aparelho físico e SMTP externo
foram registrados como evidência de cobertura; não constituem novas exigências
para liberar o redesign. A CI existente acompanha a integração. Esta avaliação
não representa uma publicação realizada.

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
| Assinatura e e-mails no ambiente atual | Funcionamento confirmado pelo usuário. Nenhuma alteração na lógica backend de assinatura ou envio de e-mails foi feita no último lote de correções. |

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

1. Integrar o commit revisado seguindo a CI existente em `.github/workflows/ci.yml`.
   Ela executa arquitetura, testes, lint, build e construção das imagens Docker
   em PRs para main e pushes na main; também permite execução manual. Não exige
   configuração de um serviço novo para este redesign.
2. Seguir [o procedimento de produção](../../deploy/PRODUCTION.md), com backup
   e as migrations pendentes, se houver. A branch completa contém mudanças
   anteriores de API e a migration `20260928120000_project_acompanhamento_card_name`;
   a rotina de deploy deve considerar esse conjunto. Uma migration já aplicada
   não precisa ser reaplicada manualmente.
3. Conferir login e abertura das telas migradas no ambiente publicado.

### Limites dos testes locais

Celular/tablet foram emulados; não foi usado aparelho físico, leitor de tela ou
câmera/canvas físico. O SMTP local capturou mensagens sem entrega externa.
Esses limites permanecem descritos para não atribuir aos testes uma cobertura
que não tiveram. O funcionamento existente de assinatura e e-mails, confirmado
pelo usuário, permite seguir a publicação normal; uma conferência visual em
aparelho físico é opcional nesta avaliação. Não há declaração de certificação WCAG.

O [roadmap](../REDESIGN_ROADMAP.md) e a
[auditoria por página](redesign-final-audit-2026-10-02.md) estão atualizados.
