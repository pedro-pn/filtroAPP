# Auditoria de dependências do frontend

`npm run audit:ci` consulta o `npm audit --audit-level=high --json`, preserva seu
relatório original e bloqueia alertas high/critical. Erros de rede, relatórios
inválidos ou inconsistentes também reprovam a execução.

Há uma exceção temporária para
[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf), restrita ao
`picomatch` **4.0.7** e à cadeia de ferramentas que herda esse mesmo alerta. Em
17/11/2026, a versão mais recente publicada é 4.0.7 e o advisory não lista versão
corrigida. A exceção reconhece o risco; não declara a biblioteca corrigida.

Neste projeto o pacote é usado por Vite/tinyglobby e pelo ferramental de lint. Os
globs vêm da configuração e dos arquivos do repositório, não das entradas dos
usuários do aplicativo. A exceção só se aplica quando **todos os caminhos afetados**
estão marcados como exclusivamente de desenvolvimento no lockfile. O pacote não
compõe as dependências do aplicativo em produção.

A exceção vence automaticamente em **01/12/2026, 00:00 UTC**. Versões diferentes,
um caminho em produção, outro advisory ou uma severidade critical continuam
bloqueando o CI. O relatório completo, incluindo os avisos temporariamente
aceitos, continua sendo publicado no artefato `frontend-audit`.

Quando houver correção upstream, atualize a dependência e remova
`PICOMATCH_EXCEPTION` e seu tratamento em `scripts/audit-dependencies.mjs`. Não
prorrogue o prazo automaticamente. Os testes da política estão em
`test/dependency-audit.test.mjs`.
