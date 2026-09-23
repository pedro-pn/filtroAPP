# Quickstart: validação local

Execute na worktree `filtroAPP-gestao-projetos`. Estes comandos não iniciam servidor, container ou deploy.

```bash
npm run modules:generate
cd backend && npx prisma validate && npm run prisma:generate
node --test test/efetivo-project-workflow.test.js test/efetivo-permissao.test.js test/api-data-catalog.test.js
cd ../frontend && npm test -- --runInBand
npm run lint
npm run build
```

Verificação manual posterior em ambiente de teste:

1. Entrar como Comercial e editar apenas a frente comercial.
2. Confirmar que fatos CRM aparecem bloqueados e com procedência.
3. Confirmar os oito fatos e conferir o semáforo verde no detalhe e no card.
4. Reabrir um fato e conferir o retorno para vermelho sem mudança de etapa.
5. Entrar como Líder, completar o gate e usar a ação no rodapé em 390 px e 1440 px.

