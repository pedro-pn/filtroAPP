# Planejamento de Migração — Frontend atual → React + Vite

> Atualizado em: 2026-04-27  
> Branch sugerido: `feature/react-frontend`  
> Objetivo: migrar o frontend atual baseado em `filtrovali_app_v4.html` para uma aplicação React moderna, mantendo o backend Express/Prisma e preservando paridade funcional antes do cutover.

---

## 0. Checklist de status da migração React

Esta seção deve ser mantida atualizada a cada ciclo de implementação para facilitar retomada de contexto.

### Concluído

- [x] Criado frontend em `frontend/` com React, Vite e TypeScript.
- [x] Configurado React Router com rotas públicas e protegidas por role.
- [x] Configurado React Query para dados remotos.
- [x] Configurado Axios central em `frontend/src/api/client.ts`.
- [x] Adicionado suporte a `VITE_API_BASE_URL` e `VITE_ASSETS_BASE_URL`.
- [x] Criado `AuthContext` com login, logout, sessão persistida e bootstrap de usuário.
- [x] Criadas APIs/hooks para auth, conta, projetos, usuários, colaboradores, equipamentos, unidades, manômetros, contadores, relatórios, uploads e rascunhos.
- [x] Migrada tela de login.
- [x] Migrada recuperação de senha.
- [x] Migrada redefinição de senha.
- [x] Migrada página de conta.
- [x] Criado shell visual base com `Shell`, `TopBar` e estilos principais.
- [x] Criada Home do colaborador.
- [x] Criadas telas `Meus relatórios` e `Meus relatórios arquivados`.
- [x] Implementado fluxo inicial de criação de RDO em React.
- [x] Implementado store transitório do RDO com Zustand.
- [x] Implementado salvamento, atualização, listagem, retomada e remoção de rascunhos.
- [x] Implementado envio básico de RDO pelo React.
- [x] Implementado painel do gestor com abas de relatórios e CRUDs administrativos.
- [x] Implementados CRUDs de projetos, colaboradores, usuários, equipamentos, unidades, manômetros e contadores.
- [x] Implementado painel do coordenador com aprovados e arquivados.
- [x] Implementado painel do cliente com relatórios visíveis.
- [x] Implementado download PDF para coordenador e cliente.
- [x] Implementado download PDF e DOCX para gestor.
- [x] Implementado download em lote em ZIP para gestor e cliente.
- [x] Implementadas ações de aprovar/devolver relatórios para gestor.
- [x] Implementadas ações de solicitar assinatura e reprovar relatório para cliente.
- [x] Implementada solicitação de assinatura em lote para cliente.
- [x] Criado modal `ReasonDialog` para motivos de devolução/reprovação.
- [x] Removidos `window.prompt` dos fluxos React já migrados.
- [x] Criada tela de detalhe de relatório com ações por perfil.
- [x] Criado editor inicial de RDO no detalhe para gestor.
- [x] Implementado upload básico de fotos gerais e fotos por serviço no RDO React.
- [x] Normalizado payload de serviços do RDO React para manter compatibilidade com backend e relatórios derivados.
- [x] Corrigidos textos com mojibake em `frontend/src`.
- [x] Build do frontend validado com `npm run build`.

### Parcial / em andamento

- [ ] Aproximar visualmente os cards, toggles e agrupamentos ao HTML original (MyReportsPage agrupado por projeto ✓).
- [x] Melhorar tela de detalhe para exibir dados por tipo de relatório, sem depender de JSON técnico.
- [x] Completar paridade do formulário de RDO com o HTML original (etapas por tipo de serviço implementadas).
- [x] Completar campos específicos por tipo de serviço do RDO (LIMPEZA, PRESSAO, FLUSHING, FILTRAGEM, MECANICA, INIBICAO).
- [x] Refinar uploads por tipo de serviço: cada tipo tem seus grupos de fotos específicos no ServiceFields.
- [x] Implementar continuidade de serviços em andamento por projeto (banner + importação de serviços).
- [x] Implementar pré-preenchimento dos colaboradores do último relatório do mesmo projeto com paridade total.
- [x] Revisar comportamento de arquivados por projeto em todas as roles (relatórios agrupados por projeto: colaborador, gestor, coordenador).
- [ ] Revisar responsividade fina em celular.
- [ ] Padronizar mensagens de erro/sucesso em todas as telas (Toast implementado; NewReportPage e ClientPage migradas; restante pendente).

### Pendente

- [ ] Migrar completamente os tipos derivados/específicos de relatório além do RDO, se forem editáveis no frontend.
- [x] Implementar visualização formatada completa para RDO, RTP, RLQ, RCPU, RLM, RLF e RLI.
- [x] Implementar seleção em lote e downloads em lote, se o HTML original exigir.
- [x] Implementar solicitação de assinatura em lote do cliente, se mantida no React.
- [ ] Implementar todos os detalhes de aprovação/reprovação do cliente com paridade do HTML original.
- [ ] Implementar componentes reutilizáveis finais de Toast, Modal, botões, cards e campos.
- [ ] Revisar acessibilidade básica dos formulários e modais.
- [x] Criar checklist de testes manuais por role.
- [x] Ajustar `nginx`/deploy para servir o build React.
- [x] Planejar cutover mantendo fallback para o HTML antigo.
- [ ] Remover dependência operacional do `filtrovali_app_v4.html` somente após validação completa.

### Observações técnicas atuais

- O `code-review-graph` está atualizado para a branch `app_v2_react`, mas ferramentas pesadas como `detect_changes` e `get_minimal_context` ainda podem dar timeout.
- Consultas leves do grafo, como `query_graph`, `semantic_search_nodes`, `list_graph_stats` e `list_communities`, estão utilizáveis.
- Durante desenvolvimento local, usar `frontend/.env.local` com `VITE_API_BASE_URL=http://localhost:4000/api` e `VITE_ASSETS_BASE_URL=http://localhost:4000`.
- O HTML antigo continua sendo a referência funcional até o cutover.

---

## 1. Objetivo

Migrar o frontend atual do app para `React + Vite + TypeScript`, reduzindo:

- acoplamento em um único arquivo HTML/JS
- re-render imperativo por `innerHTML`
- estado global solto
- risco de regressão por duplicação de lógica
- dificuldade de manutenção e evolução em equipe

Sem alterar a arquitetura central do backend:

- `Express`
- `Prisma`
- `PostgreSQL`
- geração DOCX/PDF
- autenticação atual

O backend permanece como API principal. A migração é do frontend.

---

## 2. Estado atual real do sistema

O planejamento antigo estava incompleto. O sistema hoje já possui mais fluxos do que apenas colaborador e gestor.

### Roles ativas no sistema

Conforme [backend/prisma/schema.prisma](C:/Users/relat/Área%20de%20Trabalho/NewRDO/backend/prisma/schema.prisma):

- `COLLABORATOR`
- `MANAGER`
- `COORDINATOR`
- `CLIENT`

### Fluxos já existentes no frontend atual

- Login
- Recuperação de senha
- Redefinição de senha
- Home do colaborador
- Criação/edição de RDO
- Continuação de serviços em andamento
- Meus relatórios
- Meus relatórios arquivados
- Painel do gestor
- Painel do coordenador
- Painel do cliente
- Detalhe de relatório
- Conta / alteração de e-mail e senha
- CRUD de:
  - projetos
  - usuários
  - colaboradores
  - equipamentos/unidades
  - manômetros
  - contadores
- Projetos arquivados com relatórios agrupados dentro do card

### Backend atual

O backend ainda serve o HTML antigo em:

- `/`
- `/reset-password`

Isso está em [backend/src/app.js](C:/Users/relat/Área%20de%20Trabalho/NewRDO/backend/src/app.js).

### Infra atual

Produção hoje usa:

- `postgres`
- `backend`
- `nginx`

conforme [docker-compose.prod.yml](C:/Users/relat/Área%20de%20Trabalho/NewRDO/docker-compose.prod.yml).

Ainda não existe serviço `frontend`.

---

## 3. Estratégia de migração

### Estratégia escolhida

**Build paralelo com corte final.**

Isso significa:

1. o `filtrovali_app_v4.html` continua funcionando durante a migração
2. o novo frontend React nasce em `frontend/`
3. o backend continua o mesmo
4. o cutover só acontece quando houver paridade funcional validada

### O que não fazer

- não substituir o HTML atual diretamente no início
- não começar pela tela de serviços antes de estruturar auth, rotas e leitura de dados
- não alterar backend e frontend ao mesmo tempo sem necessidade
- não tentar “reescrever tudo” sem um mapa funcional por role

---

## 4. Stack alvo

### Base

- `React 19`
- `Vite`
- `TypeScript`
- `react-router-dom`
- `@tanstack/react-query`
- `react-hook-form`
- `zod`
- `axios`
- `zustand`

### Responsabilidade de cada peça

- `React Router`: rotas e guards
- `React Query`: cache e sincronização com API
- `axios`: cliente HTTP central
- `react-hook-form`: formulários
- `zod`: validação de payloads/forms
- `zustand`: estado transitório do RDO em construção e rascunho local, se necessário

### Decisão de arquitetura

- dados remotos ficam em `React Query`
- autenticação fica em `AuthContext`
- estado transitório do relatório fica em `zustand`
- componentes visuais ficam desacoplados da API

---

## 5. Escopo funcional obrigatório da migração

Para considerar a migração pronta, o React precisa cobrir:

### Público

- Login
- Recuperação de senha
- Redefinição de senha

### Colaborador

- Home
- Novo relatório
- Cabeçalho
- Serviços
- Finalização
- Continuação de relatórios/serviços
- Meus relatórios
- Meus relatórios arquivados
- Conta

### Gestor

- Pendentes
- Aprovados
- Arquivados
- Projetos
- Equipe
- Usuários
- Equipamentos
- Manômetros
- Contadores
- Detalhe do relatório
- Conta

### Coordenador

- Aprovados
- Arquivados
- Detalhe do relatório
- download apenas em PDF
- conta

### Cliente

- Painel do cliente
- visualização de relatórios liberados
- revisão/aprovação do cliente
- conta

---

## 6. Estrutura alvo

```text
NewRDO/
├── backend/
├── deploy/
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/
│       │   ├── client.ts
│       │   ├── auth.ts
│       │   ├── users.ts
│       │   ├── projects.ts
│       │   ├── collaborators.ts
│       │   ├── units.ts
│       │   ├── manometers.ts
│       │   ├── counters.ts
│       │   ├── reports.ts
│       │   └── uploads.ts
│       ├── auth/
│       │   ├── AuthContext.tsx
│       │   ├── PrivateRoute.tsx
│       │   └── RoleRoute.tsx
│       ├── store/
│       │   └── rdoStore.ts
│       ├── hooks/
│       │   ├── useAuth.ts
│       │   ├── useProjects.ts
│       │   ├── useReports.ts
│       │   ├── useCollaborators.ts
│       │   ├── useUnits.ts
│       │   ├── useManometers.ts
│       │   └── useCounters.ts
│       ├── layout/
│       │   ├── Shell.tsx
│       │   ├── TopBar.tsx
│       │   └── BottomBar.tsx
│       ├── components/
│       │   ├── ui/
│       │   ├── forms/
│       │   ├── reports/
│       │   ├── gestor/
│       │   └── client/
│       ├── pages/
│       │   ├── LoginPage.tsx
│       │   ├── ForgotPasswordPage.tsx
│       │   ├── ResetPasswordPage.tsx
│       │   ├── collaborator/
│       │   ├── gestor/
│       │   ├── coordinator/
│       │   ├── client/
│       │   └── account/
│       └── styles/
│           ├── variables.css
│           └── base.css
└── filtrovali_app_v4.html
```

---

## 7. Decisão de deploy do frontend

O frontend novo deve ser servido como build estático.

### Caminho recomendado

- `Vite build`
- arquivos em `dist/`
- `nginx` servindo o `dist`
- `nginx` mantendo proxy `/api` para o backend

### Decisão prática

Na migração, o ideal é:

1. criar `frontend/`
2. configurar build do React
3. ajustar `nginx` para servir SPA
4. manter o HTML antigo até o corte final

### Não recomendado

- continuar servindo o React pelo backend Express como arquivo estático principal

O backend deve ficar focado em API.

---

## 8. Ordem de execução recomendada

Essa ordem é mais segura que o plano antigo.

### Fase 0 — Congelamento funcional

Antes de codar:

- mapear todas as telas atuais
- mapear todas as roles
- mapear todos os CRUDs
- mapear ações por role
- mapear telas de apoio:
  - conta
  - recuperação de senha
  - reset
  - cliente
  - coordenador
  - arquivados

**Saída esperada:** checklist de paridade atualizado.

### Fase 1 — Infra do frontend

- criar `frontend/` com Vite + React + TS
- configurar eslint/prettier
- configurar `axios`
- configurar `React Query`
- configurar `React Router`
- configurar `AuthContext`
- configurar guards por role
- migrar variáveis CSS principais

**Saída esperada:** app React sobe, autenticação básica e rotas protegidas funcionam.

### Fase 2 — Fluxos públicos

- Login
- Recuperar senha
- Resetar senha

**Saída esperada:** usuário entra e sai do sistema pelo React.

### Fase 3 — Shell e conta

- Shell base
- TopBar
- BottomBar
- Toast
- Modal
- página de conta

**Saída esperada:** estrutura comum pronta para todas as roles.

### Fase 4 — Fluxos de leitura

Migrar primeiro o que consome dados, mas não altera tanto:

- home do colaborador
- meus relatórios
- meus arquivados
- detalhe do relatório
- painel do coordenador
- painel do cliente

**Saída esperada:** leitura de relatórios por role em React.

### Fase 5 — Fluxo do RDO

- cabeçalho
- serviços
- finalização
- rascunho/continuação
- validações

Essa é a fase mais crítica.

**Saída esperada:** colaborador consegue criar e enviar relatório completo no React.

### Fase 6 — Admin

- projetos
- equipe
- usuários
- equipamentos/unidades
- manômetros
- contadores

**Saída esperada:** gestor consegue operar o painel administrativo no React.

### Fase 7 — Arquivados e detalhes finais

- projetos arquivados com relatórios dentro
- fluxo de arquivar/desarquivar
- comportamento por role em arquivados

### Fase 8 — Cutover

- build do frontend
- ajuste do nginx
- troca da rota principal
- remover dependência do HTML antigo

---

## 9. Mapa de rotas alvo

### Públicas

- `/` → login
- `/forgot-password`
- `/reset-password`

### Colaborador

- `/home`
- `/rdo/cabecalho`
- `/rdo/servicos`
- `/rdo/final`
- `/meus-relatorios`
- `/meus-relatorios/arquivados`
- `/conta`

### Gestor

- `/gestor`
- `/gestor/relatorio/:id`
- `/gestor/projetos`
- `/gestor/equipe`
- `/gestor/usuarios`
- `/gestor/equipamentos`
- `/gestor/manometros`
- `/gestor/contadores`
- `/conta`

### Coordenador

- `/coordenador`
- `/coordenador/relatorio/:id`
- `/conta`

### Cliente

- `/cliente`
- `/cliente/relatorio/:id`
- `/conta`

---

## 10. Estado global alvo

### AuthContext

Responsável por:

- usuário atual
- token
- login
- logout
- hidratação da sessão

### React Query

Responsável por:

- projetos
- colaboradores
- unidades
- manômetros
- contadores
- usuários
- relatórios
- refresh/invalidação

### Zustand

Responsável apenas por:

- relatório em construção
- serviços adicionados
- campos do cabeçalho
- campos da etapa final
- eventual rascunho local

---

## 11. RDO — diretriz de implementação

A tela de serviços continua sendo a parte mais delicada do sistema.

### Tipos de serviço atuais

- Limpeza Química
- Teste de Pressão
- Flushing
- Filtragem
- Limpeza Mecânica
- Inibição

### Requisitos de migração

- manter pré-preenchimento por continuidade
- manter colaboradores do cabeçalho disponíveis nos serviços
- manter upload com resize/base64 se backend ainda depender disso
- manter validação inline
- manter persistência de rascunho
- manter lógica de serviços em andamento por projeto

### Regra

Não migrar o RDO “por tentativa”.  
Cada tipo de serviço precisa ser comparado com o comportamento atual antes de seguir para o próximo.

---

## 12. Backlog reestruturado

## Épico A — Infraestrutura

- criar `frontend/`
- instalar dependências
- configurar Vite
- configurar proxy local `/api`
- configurar React Query
- configurar AuthContext
- configurar rotas e guards
- configurar lint/format

## Épico B — Base visual

- portar tokens CSS
- Shell
- TopBar
- BottomBar
- Toast
- Modal
- componentes básicos de formulário

## Épico C — Auth e utilitários

- Login
- Recuperar senha
- Resetar senha
- Conta

## Épico D — Leitura de relatórios

- Home colaborador
- Meus relatórios
- Arquivados do colaborador
- Detalhe do relatório
- Painel coordenador
- Painel cliente

## Épico E — RDO

- store do RDO
- Cabeçalho
- Serviços
- Finalização
- Continuação de serviços
- Rascunhos

## Épico F — Gestor/Admin

- Pendentes
- Aprovados
- Arquivados
- Projetos
- Equipe
- Usuários
- Equipamentos
- Manômetros
- Contadores

## Épico G — Cutover

- build de produção
- nginx servindo SPA
- validação final
- remoção progressiva do HTML antigo

---

## 13. Checklist de paridade obrigatória

- Login por todas as roles funciona
- Recuperação e reset de senha funcionam
- Conta funciona
- Home do colaborador funciona
- Criação de relatório completa funciona
- Continuação de serviço em andamento funciona
- Uploads funcionam
- Validação inline funciona
- Meus relatórios e arquivados funcionam
- Painel do gestor funciona
- Painel do coordenador funciona
- Painel do cliente funciona
- CRUD de projetos funciona
- CRUD de equipe funciona
- CRUD de usuários funciona
- CRUD de equipamentos funciona
- CRUD de manômetros funciona
- CRUD de contadores funciona
- Projetos arquivados mostram detalhes e relatórios
- PDF e ações por role respeitam as restrições atuais

---

## 14. Riscos reais da migração

### Alto risco

- Tela de serviços
- Continuação de relatórios/serviços
- Estados locais e rascunhos
- Diferenças por role

### Médio risco

- painel do gestor
- projetos arquivados
- uploads
- detalhe do relatório

### Baixo risco

- login
- reset de senha
- conta
- listagens simples

---

## 15. Primeiro ciclo de execução recomendado

Para começar a produção da migração, eu iniciaria com este pacote:

1. criar `frontend/`
2. configurar Vite + TS + Router + Query + axios
3. criar `AuthContext`
4. criar rotas públicas
5. criar login, forgot e reset
6. criar Shell e página de conta

Esse é o melhor primeiro marco porque:

- valida a base técnica
- valida autenticação real com backend
- não entra ainda na parte mais arriscada
- abre caminho para migrar as roles depois

---

## 16. Critério de sucesso

A migração só deve ser considerada pronta quando:

- o React cobrir todas as roles ativas
- houver paridade funcional validada
- o `nginx` servir o React em produção
- o HTML legado deixar de ser dependência operacional

Até lá, o `filtrovali_app_v4.html` continua sendo referência funcional.

---

## 17. Auditoria de paridade visual/comportamental HTML x React

> Registrado em: 2026-04-27  
> Referências comparadas: `filtrovali_app_v4.html`, `frontend/src/pages/*`, `frontend/src/components/reports/ReportSummaryCard.tsx`, `frontend/src/styles/base.css`.

### Conclusão

As discrepâncias atuais não devem ser deixadas integralmente para o final. O React já cobre muitos fluxos, mas algumas telas divergem da estrutura do HTML em pontos de navegação, agrupamento e localização de ações. A próxima etapa recomendada é corrigir paridade visual/comportamental por tela antes de adicionar novos recursos.

### Prioridade P0 — corrigir antes de nova feature

- [x] Painel do gestor: mover o resumo para baixo das abas e exibir apenas nas abas de relatórios.
  - O resumo atual aparece acima da navegação e ocupa área demais.
  - Deve aparecer abaixo das abas somente em `Pendentes`, `Aprovados` e `Arquivados`.
  - Também deve ser visualmente mais compacto que os cards atuais.

- [x] Base visual global: reduzir escala tipográfica e botões para aproximar do HTML.
  - A fonte e os botões do React estão maiores que o legado.
  - Aplicar ajuste em tokens/classes globais antes de revisar card por card, para evitar retrabalho.

- [x] Painel do gestor: alinhar ordem e significado das abas com o HTML.
  - HTML: `Pendentes`, `Aprovados`, `Projetos`, `Arquivados`, `Equipe`, `Unidades`, `Manômetros`, `Contadores`.
  - React: inclui `Usuários` como aba separada e usa `Equipamentos` em vez de `Unidades`, o que muda a organização percebida.
  - Decisão necessária: manter `Usuários` separado por necessidade real ou embutir dentro de `Equipe`/admin como no legado.

- [x] Painel do gestor: revisar cards de relatórios para paridade com o HTML.
  - Devem ter separação por projeto.
  - Devem ter toggle/filtro por tipo de relatório quando houver mais de um tipo.
  - Botões `PDF`, `DOCX`, `Devolver` e ações similares estão grandes demais.
  - `Devolver` não deve aparecer na aba `Aprovados`; ações de revisão devem ficar restritas ao contexto correto.

- [x] Painel do gestor: ajustar botões de seleção em lote exatamente como no HTML.
  - HTML: seleção em lote aparece embutida no grupo/lista de relatórios.
  - `Selecionar todos` deve aparecer abaixo de cada tipo/grupo de relatório.
  - `Limpar seleção`, `Baixar PDF` e `Baixar DOCX` devem aparecer ao lado apenas quando houver relatório selecionado.
  - Botões devem ser compactos, seguindo o padrão `mini-btn` do HTML.

- [ ] Painel do gestor: trocar formulários administrativos sempre visíveis por botão de adicionar.
  - Projetos, equipe, unidades/equipamentos, manômetros e contadores não devem abrir com formulário no topo.
  - Deve existir botão contextual como `+ Adicionar projeto`.
  - Ao editar um item, o formulário deve aparecer no local do card editado, não no topo da página.
  - Parcial: projetos, equipe, usuários internos, equipamentos, unidades, manômetros e contadores já usam botão de adicionar; falta mover a edição para dentro do card do item editado.

- [x] Portal do cliente: recriar hierarquia por projeto e tipo de relatório.
  - HTML: cliente usa abas por projeto e subabas por tipo (`RDO`, `RTP`, `RLQ`, etc.), com cards dentro do contexto selecionado.
  - React: lista todos os relatórios em sequência, com resumo global e ações em lote globais.
  - Correção: agrupar por projeto, adicionar filtro/tabs por tipo de relatório e limitar ações em lote ao projeto/tipo atual.

- [x] Portal do cliente: mover checkbox e ações para o padrão do card legado.
  - HTML: checkbox fica no cabeçalho do card (`client-report-main`) e as ações ficam em `client-report-actions`.
  - React: checkbox aparece misturado no rodapé de ações do `ReportSummaryCard`.
  - Correção: permitir slot de seleção no cabeçalho do card ou criar `ClientReportCard` dedicado.

- [ ] Detalhe de relatório: mover ações principais para uma barra inferior/rodapé contextual.
  - HTML: usa `#det-actions` em `bbar`, mantendo ação de aprovar, devolver, PDF, DOCX e edição em local fixo/contextual.
  - React: `ReportDetailActions` aparece como primeiro card no conteúdo, antes dos dados do relatório.
  - Correção: criar `DetailActionBar` no fim da tela ou fixa no rodapé, respeitando role/status.

- [ ] RDO React: igualar nomes, obrigatoriedade e formato dos campos ao HTML.
  - `Intervalo de almoço` não pode ser texto livre; deve seguir o formato/seleção do HTML e payload compatível.
  - Nomes visíveis dos campos devem ser idênticos aos do HTML.
  - Campos obrigatórios devem seguir os mesmos grupos e validações do HTML.
  - Formatos como tempo, pressão, volume, contagens e materiais devem ser revisados contra `filtrovali_app_v4.html`.

- [ ] RDO React: restaurar dinâmicas de preenchimento do HTML.
  - Detecção de hora extra deve seguir a regra do HTML/backend.
  - Pré-preenchimento de colaboradores deve considerar o último relatório do mesmo projeto como no legado.
  - Toggles de standby, turno noturno, contagem de partículas e desidratação devem abrir/fechar campos dependentes.
  - Campos dependentes devem entrar/sair da validação conforme o toggle.

- [x] RDO React: fluxo deve voltar para 3 seções reais.
  - `Cabeçalho`, `Serviços`, `Finalização`.
  - A navegação deve ter progressão, botões de voltar/próximo e barra/rodapé compatível com o HTML.

### Prioridade P1 — corrigir durante a rodada de paridade

- [x] Home do colaborador: aproximar dos cards de ação do HTML.
  - HTML: `Novo relatório`, `Meus relatórios` e `Em andamento` são cards de ação com ícone e subtítulo.
  - React: existe `Arquivados` no bloco principal, mas não há card `Em andamento`; rascunhos ficam mais abaixo.
  - Correção: trocar o terceiro card principal para `Em andamento` e mover `Arquivados` para a navegação/lista.

- [x] Novo RDO: recuperar fluxo em 3 etapas ou simular a separação visual. P0 detalhado acima.
  - HTML: `Cabeçalho`, `Serviços`, `Finalização` com progresso e barra inferior.
  - React: tudo fica em uma página longa.
  - Correção: dividir em etapas/tabs internas ou adicionar progressão visual clara com botões `Voltar`/`Próximo`/`Enviar`.

- [x] Novo RDO: adição de serviço deve abrir escolha por tipo, não inserir sempre limpeza.
  - HTML: modal de tipo de serviço com opções visuais.
  - React: botão `Adicionar serviço` cria limpeza diretamente e exige alterar o select depois.
  - Correção: modal bottom-sheet com os 6 tipos implementado.

- [ ] Cards de relatório: revisar metadados e ordem visual.
  - HTML: cards usam título com número/data, subtítulo com responsável/contexto, status à direita e ações compactas.
  - React: `ReportSummaryCard` é genérico e algumas roles precisam layout específico.
  - Correção: manter componente base, mas criar variantes por contexto (`manager`, `client`, `collaborator`, `coordinator`).

- [ ] Coordenador: validar se deve compartilhar tela/padrão visual do gestor sem CRUDs ou manter painel próprio.
  - React está funcional, mas usa estrutura simplificada que pode divergir do legado em agrupamento e ações.

### Prioridade P2 — acabamento visual e responsivo

- [ ] Reduzir uso de `page-card` para barras/controles que no HTML são toolbars compactas.
- [ ] Revisar botões full-width no mobile: hoje a regra global pode deixar ações simples grandes demais.
- [ ] Padronizar estados vazios, mensagens e toasts por role.
- [ ] Revisar terminologia: `Equipamentos`, `Unidades`, `Usuários`, `Equipe` precisam refletir exatamente a navegação final desejada.
- [x] Revisar acentuação/mojibake restante nos textos renderizados — `\u00XX` substituídos por UTF-8 e `as` → `às` corrigido.
- [ ] Revisar paridade funcional contra o HTML antes de remover ou reorganizar qualquer fluxo: o HTML é grande e contém lógicas imperativas que podem não ter equivalente direto no React atual.

### Ordem recomendada de correção

1. Gestor: abas, toolbar de lote, cards de relatório e detalhe.
2. Cliente: agrupamento por projeto/tipo, card dedicado e assinatura em lote contextual.
3. Colaborador: home e fluxo visual do RDO em etapas.
4. Coordenador: alinhar com padrão final de cards/detalhe.
5. Responsividade fina em celular.

### Rodada de implementação 2026-04-28

- [x] Painel do gestor: resumo movido para baixo das abas, compacto e limitado a `Pendentes`, `Aprovados` e `Arquivados`.
- [x] Base visual: fonte, botões, cards, filtros e formulários compactados em `base.css`.
- [x] Cards do gestor: relatórios agrupados por projeto e por tipo, com toolbar de seleção por grupo/tipo.
- [x] Ações do gestor: `Devolver` e `Aprovar` restritos à aba `Pendentes`; aprovados/arquivados mantêm apenas ações de download/seleção.
- [x] Projetos: formulário inicial oculto atrás do botão `Adicionar projeto`.
- [x] Próximo foco: etapas 1-3 da rodada de paridade concluídas; detalhe/RDO em três seções com campos idênticos ao HTML é o próximo foco principal (ServiceFields).

### Rodada de implementação 2026-04-28 — continuação

- [x] Gestor/admin: formulários de criação de equipe, usuários internos, equipamentos, unidades, manômetros e contadores ocultos atrás de botões `Adicionar`.
- [x] Detalhe de relatório: ações de PDF/DOCX/assinatura movidas para baixo do conteúdo, alinhando melhor com o HTML.
- [x] RDO: `Intervalo` deixou de ser texto livre e passou a usar campo de tempo com segundos (`HH:MM:SS`) na criação e edição.
- [x] RDO: campos principais de cabeçalho (`Projeto`, `Data`, `Chegada`, `Saída`, `Intervalo`) marcados como obrigatórios no HTML nativo.
- [ ] Pendente: edição inline real no local do card editado.
- [ ] Pendente: comparar campo a campo com o HTML para nomes/obrigatoriedades restantes e revisar dinâmicas de hora extra/toggles.

### Rodada de implementação 2026-04-28 — correção de regressão

- [x] Home do colaborador: reforçado acesso a `Novo relatório` também na topbar.
- [x] Home do colaborador: bloco principal alinhado ao HTML com `Novo relatório`, `Meus relatórios` e `Em andamento`.
- [x] Home do colaborador: `Arquivados` movido para ação secundária fora dos cards principais.
- [x] Auditoria técnica: `refactor_tool dead_code` em `frontend/src` não encontrou funções órfãs; a cautela principal continua sendo lógica funcional do HTML ainda não reimplementada no React.
- [x] Novo RDO: fluxo reorganizado em 3 etapas (`Cabeçalho`, `Serviços`, `Finalização`) com barra de progresso e ações inferiores.
- [x] Novo RDO: avanço de etapa valida cabeçalho/equipe e existência de serviços antes de prosseguir.

### Rodada de implementação 2026-04-28 — paridade visual geral

- [x] CSS: `.section-title` ganhou barra verde vertical `::before` idêntica ao `.sec` do HTML.
- [x] CSS: `.home-action-primary` recebeu `flex-direction: row` para ícone à esquerda do texto (igual ao `.ha.prim` do HTML).
- [x] CSS: adicionados estilos de toggle visual (`.tog-row`, `.tog`, `.tog-sl`, `.tog input:checked + .tog-sl`).
- [x] CSS: adicionada `.collapse-section` para seções recolhíveis de standby/noturno.
- [x] CSS: adicionada `.fg-r2` — grid 2 colunas para campos lado a lado.
- [x] CSS: adicionada `.stype-modal-ov`, `.stype-modal-sh`, `.stype-grid`, `.stype-btn` para modal de tipo de serviço.
- [x] CSS: adicionadas `.resumo-card`, `.resumo-card-title`, `.resumo-txt` para o card verde de resumo na finalização.
- [x] CSS: adicionada `.danger-button` para o botão de remover rascunhos.
- [x] Home do colaborador: greeting com saudação por hora do dia + nome + data por extenso.
- [x] Home do colaborador: ícones emoji (📋, 📁, ⏳) nos cards de ação.
- [x] Home do colaborador: topbar substituída para mostrar `Conta` + `Sair` (em vez do chip de "Novo relatório").
- [x] Novo RDO — Cabeçalho: separado em 4 cards (`Identificação`, `Horários`, `Equipe diurna`, `Condições especiais`).
- [x] Novo RDO — Cabeçalho: labels idênticos ao HTML (`Data do relatório`, `Chegada`, `Saída`, `Intervalo de almoço`) com asterisco `*` nos obrigatórios.
- [x] Novo RDO — Cabeçalho: valores padrão `07:30` / `17:30` / `01:00:00` aplicados automaticamente na abertura.
- [x] Novo RDO — Cabeçalho: toggles visuais para Standby e Turno noturno com collapse ao ativar.
- [x] Novo RDO — Cabeçalho: collapse do Standby exibe `Tempo total` (time) + `Motivo` (text).
- [x] Novo RDO — Cabeçalho: collapse do Noturno exibe `Início` + `Término` (time) + lista de equipe noturna.
- [x] Novo RDO — Serviços: botão `＋ Adicionar serviço` abre modal bottom-sheet com os 6 tipos (ícone + nome, grade 2×3).
- [x] Novo RDO — Finalização: separado em 4 cards (`Horas extras`, `Atividades do dia`, `Fotos de registro`, `Resumo`).
- [x] Novo RDO — Finalização: card `Resumo` com fundo verde exibe resumo dinâmico (projeto, data, horário, equipe, serviços).
- [x] Novo RDO — Finalização: label `Descrição diária` → `Descrição geral`; seção de horas extras com textarea `Justificativa`.
- [x] Novo RDO — botões da barra inferior: `Cancelar`/`← Voltar` + `Salvar rascunho` + `Próximo →`/`Enviar relatório ✓`.
- [x] GestorPage: botão `+ Criar Relatório` adicionado ao topo da aba Pendentes.
- [x] Encoding: `\u00XX` Unicode escapes substituídos por UTF-8 direto em todos os arquivos React afetados.
- [x] Encoding: `as` → `às` no `ReportSummaryCard` (bug que exibia "07:30 as 17:30").

### Rodada de implementação 2026-04-28 — ServiceFields P0

- [x] ServiceFields: implementado bloco de material como select (`Aço carbono`, `Inox`, `Outro`) para limpeza, pressão, flushing, mecânica e inibição.
- [x] ServiceFields: implementado `TubesBlock` com diâmetro, unidade, comprimento, unidade de comprimento e múltiplas linhas em limpeza, pressão e flushing.
- [x] ServiceFields: implementado bloco `Serviço finalizado?` + `Aprovado pelo cliente?` em todos os tipos de serviço.
- [x] ServiceFields: label corrigido para `Etapas realizadas no dia` e adicionada etapa customizada.
- [x] ServiceFields: implementados blocos de partículas e desidratação para flushing e filtragem, incluindo contador, NAS/ISO, laudo, unidade de desidratação, fotos e umidade ppm.
- [x] ServiceFields: implementados campos específicos de inibição (`ID da embarcação`, `Sistema`, `Linhas`, `Steps`, `Tipo de relatório`, fotos do filtro e plaquetas).
- [x] ServiceFields: adicionado bloco `Desenhos / TAGs` + `Observações` no final dos tipos de serviço.
- [x] RDO payload: `finalized`, material de pressão/flushing, tubulações, pressões com unidade, volume com unidade, partículas, desidratação e dados de inibição passam a ser preservados no envio.
- [x] RDO payload: `standbyDetails` e horários do turno noturno incluídos em `specialConditions`.
- [x] RDO visual: card de serviço ganhou header verde, badge `Serviço N` e botão remover compacto vermelho.
- [x] Build React validado com `npm run build`.
- [x] Validação obrigatória do RDO: cabeçalho, condições especiais, campos comuns de serviço e campos específicos por tipo agora bloqueiam avanço/envio com mensagem `Preencha o campo obrigatório: ...`.
- [x] Validação obrigatória do RDO: campo inválido é destacado em vermelho e o fluxo volta/rola até a etapa ou card afetado.
- [x] RDO visual: labels obrigatórios comuns (`Equipamento(s)`, `Sistema`, `Hora de início`, `Hora de término/pausa`, `Material`, `Etapas`) receberam `*`.
- [x] Build React revalidado com `npm run build`.
- [ ] Pendente: comparar uma submissão real contra o HTML antigo para confirmar nomes de chaves esperados em DOCX/PDF derivados.

### Rodada de implementação 2026-04-28 — correções de fidelidade

- [x] RDO: removido pré-preenchimento de `Chegada` e `Saída`; os campos agora abrem vazios como no HTML.
- [x] RDO: removido campo manual `Número de colaboradores`; `daytimeCount` voltou a ser calculado internamente por `collaboratorIds.length`.
- [x] RDO: seleção de colaboradores diurnos alterada de grid de checkboxes para lista de tags com seletor `Adicionar...` + botão `+ Add`, seguindo o HTML.
- [x] RDO: seleção de colaboradores noturnos também alterada para lista de tags com seletor `Adicionar...` + botão `+ Add`.
- [x] Relatórios: criado `GroupedReportList` reutilizável com toggle por projeto e por tipo de relatório.
- [x] Colaborador: `Meus relatórios` e `Arquivados` usam agrupamento recolhível por projeto/tipo.
- [x] Gestor: relatórios pendentes, aprovados e arquivados usam agrupamento recolhível por projeto/tipo mantendo seleção/download em lote.
- [x] Coordenador: aprovados e arquivados usam agrupamento recolhível por projeto/tipo.
- [x] Cliente: portal passou a exibir projetos e tipos como grupos recolhíveis, mantendo seleção, download em lote e assinatura em lote por tipo.
- [x] Build React validado com `npm run build`.

---

## 18. Análise de paridade 2026-04-28 — pendências detalhadas

> Atualizado em: 2026-04-28  
> Auditoria profunda: `filtrovali_app_v4.html` linha a linha vs React src.  
> As seções abaixo mapeiam **exatamente o que falta**, com referências ao HTML e ao arquivo React correspondente.

---

### 18.1 ServiceFields — campos faltando por tipo de serviço

Esta é a área de maior divergência funcional. O HTML define os campos de cada tipo de serviço nas funções `bodyLimpeza`, `bodyPressao`, `bodyFlushing`, `bodyFiltragem`, `bodyMecanica` e `bodyInibicao` (linhas 1066-1147 do HTML). O React tem `ServiceFields.tsx` mas está incompleto.

#### Campos comuns a TODOS os tipos (faltando no React):

| Campo HTML | Descrição | Status React |
|---|---|---|
| `tubesBlock(n,...)` | **Diâmetros e comprimentos** — tabela dinâmica com Diâmetro (nº+unidade pol/mm) e Comprimento (nº+unidade m/cm) + botão `+ Adicionar tubulação`. Obrigatório em Limpeza, Pressão e Flushing. | ❌ Ausente |
| `finalizadoAprovado(n)` | **Serviço finalizado?** — radio Sim/Não. Se Sim → exibe **Aprovado pelo cliente?** (radio Sim/Não). Obrigatório. | ❌ Ausente |
| Material como SELECT | Material da tubulação (select: Aço carbono / Inox / Outro). Se "Outro" → exibe input de texto. Atualmente React usa `input type=text` sem as opções | ⚠️ Incompleto |
| `desenhoObs()` | Linha de **Desenhos / TAGs** (text input) + **Observações** (textarea) no final de cada card. | ❌ Ausente (React tem Observações no card pai, não no ServiceFields) |
| Label "Etapas realizadas **no dia**" | Label correto é "Etapas realizadas no dia" não "Etapas realizadas". Adicionar etapa customizada (input + botão `+ Add`). | ⚠️ Label errado, sem add custom |

#### Limpeza (`bodyLimpeza`):

| Campo HTML | Falta no React? |
|---|---|
| Método de limpeza (checkbox: Circulação pressurizada / Pulverização / Enchimento e imersão) — com `*` obrigatório | ⚠️ Existe mas sem `*` |
| Unidade de Limpeza Química (select, obrigatório `*`) | ⚠️ Existe mas sem `*` |
| Local de limpeza (tag-list: Interna / Externa, obrigatório `*`) | ⚠️ Existe como checkbox, sem `*` |
| Tipo de inspeção (tag-list: Visual / Corpo de prova / Vídeo boroscopia, obrigatório `*`) | ⚠️ Existe como checkbox, sem `*` |
| Diâmetros e comprimentos (tubesBlock) | ❌ Ausente |
| Serviço finalizado? / Aprovado pelo cliente? | ❌ Ausente |
| `uploadField('Imagens — corpo de prova')` + `uploadField('Imagens — tubulação')` | ⚠️ Upload "Fotos do serviço" extra não existe no HTML; renomear conforme HTML |
| Desenhos / TAGs + Observações no final | ❌ Ausente |

#### Pressão (`bodyPressao`):

| Campo HTML | Falta no React? |
|---|---|
| Material da tubulação (select Aço carbono/Inox/Outro) | ⚠️ React EXCLUI material para pressão — HTML inclui |
| Diâmetros e comprimentos (tubesBlock) | ❌ Ausente |
| Serviço finalizado? / Aprovado pelo cliente? | ❌ Ausente |
| UTH (obrigatório `*`) | ⚠️ Existe mas sem `*` |
| Pressão de trabalho: deve ser número + select de unidade (bar/psi/kg/cm²/MPa/kPa) | ⚠️ React usa texto simples |
| Pressão de teste: idem | ⚠️ React usa texto simples |
| Manômetros utilizados (obrigatório `*`) | ⚠️ Existe mas sem `*` |
| `uploadField('Fotos do manômetro')` + `uploadField('Fotos do sistema')` | ✅ Existe |
| Desenhos / TAGs + Observações | ❌ Ausente |

#### Flushing (`bodyFlushing`):

| Campo HTML | Falta no React? |
|---|---|
| Material da tubulação (select) | ⚠️ React exclui material para flushing — HTML inclui |
| Diâmetros e comprimentos (tubesBlock) | ❌ Ausente |
| Tipo de óleo (obrigatório `*`) | ⚠️ Existe mas sem `*` |
| Volume de óleo: número + select de unidade (L / mL) | ⚠️ React usa texto simples |
| Tipo de flushing (radio: Primário / Secundário) | ✅ Existe |
| Unidade de Flushing (select, obrigatório `*`) | ⚠️ Existe mas sem `*` |
| `particulasBlock` — "Houve contagem de partículas?" (Sim/Não → subcard com: Contador utilizado, NAS inicial/final, ISO inicial/final, Foto do laudo) | ❌ Ausente |
| `desidratacaoBlock` — "Houve desidratação?" (Sim/Não → subcard com: Equip. desidratação, Análise de umidade Sim/Não → ppm inicial/final) | ❌ Ausente |
| Serviço finalizado? / Aprovado pelo cliente? | ❌ Ausente |
| Desenhos / TAGs + Observações | ❌ Ausente |

#### Filtragem (`bodyFiltragem`):

| Campo HTML | Falta no React? |
|---|---|
| Tipo de óleo (obrigatório `*`) | ⚠️ Existe mas sem `*` |
| Volume de óleo: número + select de unidade (L / mL) | ⚠️ React usa texto simples |
| Unidade de filtragem (select, obrigatório `*`) | ⚠️ Existe mas sem `*` |
| `particulasBlock` | ❌ Ausente |
| `desidratacaoBlock` | ❌ Ausente |
| Serviço finalizado? / Aprovado pelo cliente? | ❌ Ausente |
| Desenhos / TAGs + Observações | ❌ Ausente |

#### Mecânica (`bodyMecanica`):

| Campo HTML | Falta no React? |
|---|---|
| Material do equipamento (select Aço carbono/Inox/Outro) | ❌ Ausente no React (React tem só Etapas + Upload) |
| Serviço finalizado? / Aprovado pelo cliente? | ❌ Ausente |
| Observações (no final) | ❌ Ausente (React tem Observações no card pai) |

#### Inibição (`bodyInibicao`):

| Campo HTML | Falta no React? |
|---|---|
| ID da embarcação (select) | ❌ Ausente |
| Sistema (select fixo: resfriamento / combustível / hidráulico) | ❌ Ausente (React usa campo livre) |
| Material da tubulação (select) | ❌ Ausente |
| Linhas (text input) | ❌ Ausente |
| Steps (textarea) | ❌ Ausente |
| Tipo de relatório (tags: RLI / RLF) | ❌ Ausente |
| `uploadField('Fotos do filtro')` + `uploadField('Fotos das plaquetas')` | ❌ React tem `uploadField('Fotos do serviço')` diferente |
| Serviço finalizado? / Aprovado pelo cliente? | ❌ Ausente |

---

### 18.2 RDO — Card visual do serviço

| Aspecto | HTML | React | Ação |
|---|---|---|---|
| Header do card de serviço | Background verde (`var(--g)`), ícone + nome do tipo, badge "Serviço N", botão Remover (vermelho arredondado) | `admin-card-react` — header neutro sem destaque verde | Adicionar estilo `.svc-card-header` com background verde |
| "Serviço N" | Exibido como badge no header | Exibido como título simples | Mover para badge |
| Botão Remover | `svc-remove` (vermelho, arredondado, texto compacto) no header | `secondary-button` na direita do head | Estilizar como botão vermelho compacto |

---

### 18.3 RDO — Cabeçalho: campos restantes

| Campo HTML | Status React | Ação |
|---|---|---|
| **Número de colaboradores** (input type=number, obrigatório `*`) | ❌ Ausente — React usa apenas checkboxes | Adicionar campo numérico antes dos checkboxes |
| Pré-preenchimento badge | HTML exibe "pré-preenchido" em amarelo nos campos preenchidos do último relatório | ❌ Ausente | Adicionar badge nos campos pré-preenchidos |
| Standby: `standbyDetails.total` + `standbyDetails.motivo` nos `specialConditions` | ⚠️ React coleta em estado local mas não inclui no payload | Incluir em `specialConditions` ao enviar |
| Noturno: `noturnoDetails.inicio` + `noturnoDetails.termino` nos `specialConditions` | ⚠️ Idem | Incluir em `specialConditions` ao enviar |

---

### 18.4 RDO — Finalização

| Campo HTML | Status React | Ação |
|---|---|---|
| "Nenhuma hora extra identificada." aparece enquanto não há hora extra; o textarea de justificativa só aparece se há horas extras detectadas | ⚠️ React mostra o textarea sempre; cálculo de hora extra não implementado | Implementar cálculo: totalMinutos(saída - chegada - intervalo) vs jornada do projeto; mostrar textarea condicionalmente |
| Bottom bar tem 2 botões: `← Voltar` + `Enviar relatório ✓` | ✅ Correto (com Salvar rascunho extra que é melhoria) | OK |
| Resumo card mostra informações formatadas do RDO em tempo real | ✅ Implementado | OK |

---

### 18.5 Painel do Gestor — comportamento das abas

| Aspecto | HTML | React | Ação |
|---|---|---|---|
| **Nav-tabs** são sticky (fora do scroll) e em grid 3 colunas | `.nav-tabs { display:grid; grid-template-columns: repeat(3, minmax(0,1fr)) }` dentro do topbar area | `.filter-tabs` em `page-card` dentro do scroll | Tornar nav sticky: mover tabs para fora do page-scroll ou usar `position:sticky` |
| Stat-grid na aba Pendentes | Aparece ANTES da lista de relatórios | ✅ `renderReportSummary` abaixo das tabs | OK (posição invertida, mas aceitável) |
| Botão `+ Criar Relatório` | Topo direito do conteúdo de Pendentes | ✅ Adicionado | OK |
| **Edição inline** de admin cards | Ao clicar "Editar" num card, o formulário aparece DENTRO do card (`.admin-inline-form`) substituindo ou se expandindo abaixo do card | React mostra o formulário no TOPO da seção, separado | Implementar edição inline: ao clicar Editar, exibir o formulário inline no local do card |
| Arquivados: exibe projetos arquivados com relatórios dentro (grouped by project) | Projetos arquivados expandem para mostrar relatórios | ✅ React agrupa por projeto com badge "Arquivado" | OK |
| `Usuários` como aba separada | HTML não tem aba `Usuários` separada; é renderizado dentro da tab `Equipe` | React tem aba "Equipe" que inclui `renderUsuariosTab()` abaixo — mas estava como sub-seção da Equipe | ✅ Já implementado como subseção | OK |

---

### 18.6 Cards de relatório (ReportSummaryCard)

| Aspecto | HTML (`.rel-item`) | React (`ReportSummaryCard`) | Ação |
|---|---|---|---|
| Ícone 📋 | `<div class="rel-icon">📋</div>` à esquerda | Sem ícone | Adicionar ícone por tipo de relatório |
| Layout | Flex row: ícone + info (nome do projeto, colaborador · data · serviços) + badge status | Flex: info (tipo+número, projeto) + meta grid (data, horário) | As duas estruturas são funcionalmente equivalentes; manter React mas adicionar ícone |
| Hover | `border-color: var(--g)` ao hover | Sem hover visual | Adicionar `:hover { border-color: var(--g) }` |

---

### 18.7 Validação de campos obrigatórios

| Aspecto | HTML | React | Ação |
|---|---|---|---|
| Marcador visual `*` | `<span class="req">*</span>` em todos obrigatórios (cor vermelha) | Só nos campos de Cabeçalho (adicionado nesta rodada); ServiceFields sem `*` | Adicionar `*` em todos os campos obrigatórios de ServiceFields |
| Validação ao avançar etapa | `validateScope(scope)` percorre todos `[data-required]` e `[data-required-group]`; scroll até o campo com problema + alert | React faz apenas checagem básica (projeto/data/horário) via toast | Expandir validação para incluir campos obrigatórios de serviços |
| Campos condicionais (partículas, desidratação, standby) | Entram/saem da validação conforme toggle ativo | React não tem esses campos ainda | Implementar junto com os campos |

---

### 18.8 Topbars por tela (resumo)

| Tela | HTML | React | Status |
|---|---|---|---|
| Home colaborador | Logo + nome do usuário + `Sair` | `Conta` + `Sair` | ✅ Corrigido (added Conta+Sair) |
| Meus relatórios | `← voltar` + título + subtítulo | `Início` + `Sair` | ✅ OK (variação aceitável) |
| Meus relatórios arquivados | Não existe no HTML (feature nova do React) | `Início` + `Sair` | ✅ OK |
| Cabeçalho/Serviços/Final | `← arrow` + título + subtítulo + badge `N/3` | `← Voltar` (chip) | ✅ Funcionalmente equivalente |
| Gestor | Logo + nome + `Conta` + `Sair` | `Conta` + `Sair` | ✅ OK |
| Detalhe | `← voltar` + título + subtítulo + badge status | `← Voltar` + `Conta` + `Sair` | ✅ OK |
| Cliente | Logo + `Portal do cliente` + `Conta` + `Sair` | `Portal do cliente` + `Conta` + `Sair` | ✅ OK |
| Coordenador | (usa mesma estrutura do gestor) | `Conta` + `Sair` | ✅ OK |
| Conta | `← Voltar` + `Sair` | `Voltar` + `Sair` | ✅ OK |

---

### 18.9 Cliente — card de boas-vindas

| Aspecto | HTML | React | Ação |
|---|---|---|---|
| Card de boas-vindas | Mostra nome do cliente + "Acompanhe os relatórios liberados para seu projeto" + info da conta (usuário, e-mail, projetos vinculados) | Não existe — React vai direto para os filtros | Adicionar card de boas-vindas com nome e descrição |

---

### 18.10 Prioridades recomendadas para próxima rodada

**P0 — ServiceFields (bloqueador de paridade funcional):**
1. Implementar `TubesBlock` (diâmetros e comprimentos) em Limpeza, Pressão e Flushing
2. Implementar `FinalizadoAprovadoBlock` em todos os tipos
3. Corrigir Material para SELECT (Aço carbono/Inox/Outro + campo "Outro" condicional)
4. Implementar `ParticulasBlock` em Flushing e Filtragem
5. Implementar `DesidratacaoBlock` em Flushing e Filtragem
6. Implementar campos específicos de Inibição (ID da embarcação, Sistema select, Linhas, Steps, Tipo de relatório RLI/RLF)
7. Adicionar `DrawingsObsBlock` (Desenhos/TAGs + Observações) em todos os tipos
8. Corrigir label "Etapas realizadas no dia" e adicionar etapa customizada

**P1 — Gestor e formulários:**
1. Edição inline de cards admin (editor aparecer no local do card, não no topo)
2. Header verde nos cards de serviço do RDO
3. Campos de standbyDetails e noturnoDetails incluídos no payload
4. Validação de campos obrigatórios com marcadores `*` e scroll até o campo
5. Cálculo de hora extra e exibição condicional do textarea de justificativa

**P2 — Acabamentos visuais:**
1. Card de boas-vindas no portal do cliente
2. Hover nos cards de relatório (border-color verde)
3. Ícone 📋/📄 nos cards de relatório por tipo
4. Nav-tabs do gestor sticky (fora do scroll)
5. Número de colaboradores (campo numérico no cabeçalho)

**P3 — Polimento final:**
1. Badge "pré-preenchido" nos campos carregados do último relatório
2. Pressão e volume como número + select de unidade
3. Marcadores `*` obrigatórios em ServiceFields

---

### 18.11 Rodada de migração - 2026-04-28

| Ponto reportado | Ajuste aplicado no React | Status |
|---|---|---|
| Botão `+ Criar Relatório` do gestor não abria a criação | Adicionada rota protegida `/relatorios/novo` também para `MANAGER`; tela volta/cancela para `/gestor` quando aberta por gestor | Corrigido |
| Edição de cards aparecia no topo da página | Projetos, colaboradores, usuários, equipamentos, unidades, manômetros e contadores agora renderizam o formulário de edição dentro do próprio card/linha editada, seguindo `.admin-inline-form` do HTML | Corrigido |
| Serviços exibiam equipamento como lista/select | Campo `Equipamento(s)` no relatório passou para texto livre com placeholder `Informar equipamento do cliente...`, como no HTML | Corrigido |
| Tubulações com campos largos demais | `.tube-row-react` ficou mais compacto, com colunas menores e inputs permitindo `min-width:0`, evitando cortar o valor | Corrigido |
| Unidades sem criação no bloco correto | Cada card de categoria de unidade ganhou `+ Nova unidade`; o formulário abre inline no card da categoria, como `openEditor('equipamentos','new','',cat)` no HTML | Corrigido |
| Toggles visuais de relatórios por projeto/tipo | `GroupedReportList` passou a usar badge visual por tipo (`rtype-RDO`, `rtype-RTP`, etc.) e chevrons equivalentes ao HTML | Corrigido |
| Usuários internos inline incompletos | Formulário inline de usuário agora inclui colaborador vinculado e status ativo, além de perfil e senha opcional | Corrigido |

**Validação:** `npm run build` executado em `frontend` com sucesso.

**Próximos cuidados de fidelidade:**
1. Revisar visual em navegador dos cards inline, especialmente a aba `Unidades`, para confirmar espaçamentos reais contra o HTML.
2. Completar marcadores `*` e validação por serviço no mesmo padrão `data-required` do HTML.
3. Conferir payload final dos novos campos de serviço contra o DOCX/PDF gerado.
