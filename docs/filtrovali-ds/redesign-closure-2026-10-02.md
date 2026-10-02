# Fechamento do redesign — 02/10/2026

## Lotes publicados

| Lote | Resultado | Commit |
| --- | --- | --- |
| Carregamentos e ajustes aprovados anteriormente | Logo original nas duas animações, escolha estável por montagem, controles compactos, movimento reduzido e status acessível; 670 testes frontend, lint, build e abas do cliente passaram | `ec59c187` |
| 1. Arquitetura | Oito ocorrências zeradas sem ampliar budgets; miniatura de anexos e handler do cliente extraídos; seis IDs associados a labels | `3cc1570a` |
| 2. Persistência | Cinco testes reais de formulário + consulta direta ao PostgreSQL passaram | `e53bb442` |
| 3. Revisão transversal | 18/18 testes; 168 recortes de telas autenticadas; Chromium e WebKit, 3 tamanhos, 2 temas; permissões, foco e onboarding | `b6258a6e` |
| 4. Limpeza F6 | 20 arquivos órfãos retirados; 62 regras e 33 seletores de CSS; normalização unificada; 645/645 testes | commit deste lote |
| Conferência final | Após a limpeza | — |

## Banco e arquivos isolados

O runner cria um banco **novo** com prefixo `filtrovali_redesign_validation_`,
aplica todas as migrations, cria contas e sessões de teste, e grava arquivos
em `output/validation/<banco>/`. Só aceita PostgreSQL em loopback. Não usa
registros do banco do app. As credenciais temporárias têm permissão `0600`
e o diretório inteiro está no `.gitignore`.

Mensagens são capturadas por um SMTP local que nunca encaminha e-mails.
O conversor usa LibreOffice local ou a imagem Docker já instalada do backend,
em um container sem rede e com somente a pasta de validação montada.
A conversão produziu PDFs reais de Romaneio. Jobs de fundo e integrações
externas foram desativados no runner.

### Gravações conferidas

| Módulo | Ação pela interface | Conferência posterior |
| --- | --- | --- |
| Gestão de Contas | Criar conta com permissão de leitura; editar nome | Consulta `User` e recarga da tabela |
| Qualidade | Criar Natureza e Desvio vinculado ao projeto | `QualityNature`, `QualityRecord`, projeto/natureza corretos e recarga |
| EPI | Cadastrar catálogo e entregar duas unidades | `EpiCatalogItem`, `EpiRecord`, colaborador e quantidade corretos, recarga |
| Privacidade | Pedido público, evidência de identidade, conclusão com resposta offline | `DataSubjectRequest`, identidade registrada, status `COMPLETED` |
| Romaneio | Emitir saída com item livre; editar motorista | `Romaneio`, `RomaneioItem`, quantidade e placa; PDF real e atualização |

O teste encontrou uma janela na edição do Romaneio em que campos podiam
receber digitação antes de a resposta inicial ser aplicada. O formulário
agora fica inerte durante esse carregamento, com indicador da logo.

### Reproduzir

Na raiz, em um terminal:

```sh
node backend/scripts/validation/redesign-server.mjs
```

Em outro terminal:

```sh
cd frontend
npx playwright test --config=playwright.redesign-closure.config.ts redesign-persistence.spec.ts
npm run typecheck:rdo:e2e
```

A conexão local é lida de `backend/.env.docker.local`, ou pode ser fornecida
por `REDESIGN_DATABASE_BASE_URL`. `REDESIGN_LOCAL_ENV` permite indicar outro
arquivo local. Nenhuma credencial deve ser incluída no repositório.
O runner mantém o banco e os artefatos para inspeção; encerre a API com Ctrl+C.
Esta validação cobre as gravações listadas, sem homologar entrega SMTP externa
ou assinatura em aparelho físico.

## Revisão transversal

Preparar dados e executar (API isolada já em execução):

```sh
node backend/scripts/validation/redesign-audit-fixtures.mjs
cd frontend
npx playwright test --config=playwright.redesign-closure.config.ts redesign-transversal.spec.ts
```

Foram criados relatórios pendentes/aprovados, equipamento, estoque, orçamento e
escopo planejado, além de conta de colaborador e convite de EPI. Contas de
leitura e sem acesso foram verificadas tanto na interface quanto na API real.
O aceite do cliente foi conferido também por consulta ao banco.

Cada rodada grava `audit.json` e capturas em
`output/playwright/redesign-closure/`. O contraste é medido para texto visível
sobre fundos planos; gradientes, imagens e opacidade são excluídos da medição.
Não equivale a certificação WCAG nem a teste de leitor de tela/aparelho físico.

## Limpeza e inventário final

A análise de imports estáticos e dinâmicos parte de `main.tsx` e das três
entradas HTML do DS. Os componentes de Simulações removidos da main, a antiga
listagem de Missões, catálogos substituídos e equivalências substituídas pela
reconciliação já não tinham consumidor em execução. Seus testes de markup
foram aposentados; os testes funcionais de programação, alocação, reconciliação
e compatibilidade de serviços permanecem. `Button`, `SearchBar`, `Skeleton`
e aliases legados ainda utilizados são mantidos.

Preparação e execução da conferência final:

```sh
node backend/scripts/validation/redesign-final-fixtures.mjs
cd frontend
npx playwright test --config=playwright.redesign-closure.config.ts redesign-pages.spec.ts --workers=2
```

O inventário está em `frontend/e2e/redesign-page-inventory.ts`. Cada recorte
grava um JSON incremental e capturas por tela. `REDESIGN_AUDIT_LABELS` permite
repetir um subconjunto por expressão regular, sem alterar o inventário.
