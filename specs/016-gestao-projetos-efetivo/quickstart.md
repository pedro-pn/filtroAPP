# Validação local

## Preparação

Worktree da main dd8429fc; `npm ci` em backend e frontend. Não copiar .env de produção. Migração é aditiva, versionada; geração do cliente não acessa banco.

## Comandos

```bash
cd backend
npx prisma validate
npx prisma generate
node --test test/project-workflow*.test.js
npm test
cd ../frontend
npm test
npm run lint
npm run build
```

## Cenários

Usar projeto fictício ativo e duas contas de teste Efetivo. Gestor inicia sem equipe, líder preenche handover e assume; terceiro não consegue assumir. Responder todas perguntas (inclusive não), gerar pendência positiva, confirmar encaminhamento e avançar. Verificar conflito de versão, não aplicável sem justificativa, volta à análise, troca de líder e persistência de URL. Conferir alertas visuais de datas a 20/180 dias e prazo vencido.

Visual: 390px e 1440px, quadro/modal sem overflow, campos obrigatórios com erro, navegação por teclado e rodapé do modal acessível. Fixtures Playwright podem substituir API local sem dados reais. Testes com fixtures não substituem aplicação da migration em banco isolado nem homologação antes de deploy.

## Operação

Não aplicar migration em bancos compartilhados durante este trabalho. Para produção/staging, o operador deve seguir o pipeline documentado em deploy/ após revisão. Entrega não ativa notificações nem bloqueios comerciais/operacionais.
