# Teste de carga (critério 11.4)

Objetivo: saber **quantos usuários simultâneos** o filtroAPP aguenta com resposta aceitável e
**o que quebra primeiro**. O script é `backend/scripts/load-test.js` (`npm run load:test` no
`backend/`). Ele não precisa de dependência nova: usa o Node 22+.

## O que o teste faz

Cada usuário virtual entra uma vez e repete o uso típico das telas principais, com uma pausa de
leitura de ~1 s (de 0,5 a 1,5 s) entre as chamadas:

| Peso | Tela | Rota |
|---|---|---|
| 4 | sessão | `GET /api/auth/me` |
| 3 | notificações | `GET /api/notifications` |
| 3 | lista de relatórios | `GET /api/rdo/reports?page=1&pageSize=20` |
| 2 | painel do gestor | `GET /api/rdo/bootstrap/gestor` |
| 2 | cards do Acompanhamento | `GET /api/acompanhamento/comercial/projetos-cards` |
| 2 | fluxo do Efetivo | `GET /api/efetivo/project-workflow?page=1` |
| 1 | estatísticas | `GET /api/rdo/statistics/overview` |
| 0,3 | PDF de um RDO | `GET /api/rdo/reports/:id/pdf` |

**Degraus de carga.** A carga sobe em degraus de 5, 10, 20, 40 e 80 usuários, 60 s cada. O teste
para sozinho quando um degrau passa de 5 s de p95 ou de 5% de erros.

**Critérios do resultado:**
- **Capacidade certificada:** o maior degrau com **p95 ≤ 1,5 s** e **erros ≤ 1%**.
- **Gargalo:** a rota com mais erros, ou com o pior p95, no primeiro degrau que estourou.
- **Respostas 429:** são limitadores funcionando (PDF e rotas caras têm limite por IP). Entram
  numa contagem à parte e não contam como erro.

## Onde rodar

**Em homologação** (`filtrostaging.filtrovali.com.br`), nunca em produção. O script recusa
qualquer host que não tenha "staging" no nome ou não seja a máquina local.

**Por que o resultado vale para produção:** homologação tem os mesmos limites de produção no
backend (1,5 CPU, 2 GB, pool de 8 conexões com o banco). Também tem uma cópia anonimizada dos
dados de produção, com o mesmo volume.

**Cuidados**, porque homologação divide a VPS com produção:
- Rode **fora do horário de uso** (ex.: depois das 20 h ou no fim de semana).
- Rode **a partir do seu computador**, não do servidor: o gerador de carga não pode disputar CPU
  com o sistema medido.
- O IP do seu computador precisa estar em `STAGING_ALLOWED_IPS`.
- Se produção ficar lenta durante o teste, interrompa com `Ctrl+C`: a carga para na hora.

## Passo a passo

1. **Atualize homologação** com a `main` de agora (processo de [deploy/STAGING.md](../deploy/STAGING.md)),
   para medir o código que está em produção. Os dados de homologação são a cópia anonimizada
   de produção (`deploy/sync-staging.sh`).
2. **Crie, em homologação**, uma conta **ADMIN** só para o teste, por exemplo `carga.teste`. Não use a
   conta de uma pessoa. Ela precisa ser ADMIN porque o painel do gestor (`rdo:manager`) só existe
   para contas ADMIN. Como contas ADMIN têm 2FA obrigatório, libere **um** login sem código.
   Rode no servidor:

   ```bash
   cd /root/apps/filtroAPP-staging
   docker compose --env-file backend/.env.staging -f docker-compose.staging.yml \
     exec backend node scripts/disable-2fa.js --username carga.teste --minutes 60
   ```

   O teste entra uma vez só e todos os usuários virtuais usam a mesma sessão. Rode-o dentro
   desses 60 minutos. A liberação fica registrada na trilha de segurança.
3. **No servidor**, em outro terminal, acompanhe CPU e memória dos contêineres durante o teste.
   Rode no servidor:

   ```bash
   while true; do date +%T; docker stats --no-stream --format '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}' | grep -E 'staging|filtrovali-(backend|postgres)'; sleep 5; done | tee ~/carga-$(date +%Y%m%d-%H%M).log
   ```

4. **No seu computador**, na raiz do repositório:

   ```bash
   cd backend
   LOAD_BASE_URL=https://filtrostaging.filtrovali.com.br \
   LOAD_USERNAME=carga.teste LOAD_PASSWORD='senha-da-conta' \
   npm run load:test
   ```

   Antes de medir, o script chama cada rota uma vez. Se a conta não tiver acesso a alguma tela
   (HTTP 401/403), ele para e mostra qual. Dê à conta o papel que falta e rode de novo: por
   exemplo, o painel do gestor exige conta ADMIN.

   São cerca de 5 minutos. No fim, o script mostra a capacidade e o gargalo e grava tudo em
   `output/load-test/resultado.json`.

5. **Pare o monitor** do passo 3 (`Ctrl+C`) e **mande os dois arquivos**:
   `output/load-test/resultado.json` e o `~/carga-AAAAMMDD-HHMM.log` do servidor. Com eles eu
   registro o relatório em `docs/evidence/` e preencho a seção abaixo.
6. **Desative a conta** `carga.teste` em homologação. Se esquecer, o sync das 3 h restaura o banco e ela some.

Para refazer só um trecho, use, por exemplo, `LOAD_STAGES=30,40,50 LOAD_STAGE_SECONDS=90`.

## Resultado

| Data | Commit | Capacidade certificada | Primeiro degrau que estourou | Gargalo | Recurso esgotado |
|---|---|---|---|---|---|
| _pendente_ | | | | | |

Refaça o teste depois de mudanças grandes de desempenho, de máquina ou de limites dos
contêineres. Refaça também quando o número de usuários ativos se aproximar da capacidade
certificada.
