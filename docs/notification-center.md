# Central de notificações

O sininho fica à direita do header, nas duas versões do layout. A central tem
contador de não lidas, filtros Todas/Não lidas, paginação, atualização manual e
atualização automática a cada 30 segundos enquanto a aba está ativa. Abrir um
aviso salva a leitura para aquela conta e leva à área correspondente. Abrir o
painel não marca automaticamente todos os avisos como lidos.

## Avisos implementados

| Acontecimento | Destinatários |
| --- | --- |
| Projeto cadastrado ou recebido por integração | Contas que podem consultar o projeto no RDO, Acompanhamento ou Efetivo |
| Cadastro recebido liberado após conferência | Mesmas regras de acesso ao projeto |
| Relatório enviado ou reenviado, pendente de revisão | Gestor/coordenador RDO com acesso ao projeto; manutenção e produção exigem a permissão do respectivo tipo |
| Relatório devolvido para correção | Autor com acesso ao projeto e revisores RDO; nos relatórios operacionais, o autor com a permissão do tipo |
| Proposta extra escopo ou nova revisão recebida do ComercialApp | Contas com acesso ao Acompanhamento e ao projeto já cadastrado, inclusive quando a proposta aguarda seleção |
| Adicional Access selecionado ou revisão substituída | Mesmas regras do Acompanhamento |

As permissões são verificadas no servidor na lista, no contador e nas operações
de leitura. Os projetos restritos, excluídos e os vínculos de clientes ou
colaboradores seguem as regras das respectivas áreas. Revogar acesso também
remove os avisos antigos das próximas consultas. A leitura é persistida por
usuário, independentemente das preferências de envio de e-mail.

Avisos de relatórios acompanham a pendência atual: deixam de aparecer quando
o relatório sai daquele estado. Um reenvio cria um novo aviso não lido e
substitui a rodada anterior, sem duplicar a pendência. Marcar todas como lidas
abrange somente os avisos acessíveis até o instante da consulta, preservando
novos eventos que cheguem durante a operação.

## Implantação e validação

Aplicar `20261021120000_notification_center` antes de iniciar a API atualizada:

```sh
cd backend
npm run prisma:deploy
npm run prisma:generate
```

A migração cria eventos e leituras com índices e chaves estrangeiras. Triggers
registram os acontecimentos na mesma transação dos dados de origem, cobrindo
interface, importação, webhook e worker, sem notificações de transações
desfeitas. Não há envio de e-mails nem backfill de registros históricos.

O teste `backend/test/notification-center-migration.test.js` valida os triggers
com PGlite. A integração com o Prisma exige um PostgreSQL descartável migrado,
com banco chamado `filtroapp_notifications_test`, e ambas as variáveis
`DATABASE_URL` e `TEST_NOTIFICATION_DATABASE_URL` apontando para ele:

```sh
node --test test/notification-center.integration.test.js
```

O workflow `.github/workflows/ci.yml` executa esses testes no job
`Notifications (PostgreSQL)`, com banco isolado e migrações aplicadas antes da
validação. O job é executado nas PRs para `main`.

A fixture `/test/browser/notification-center.html` usa o componente de produção
com respostas simuladas, sem alterar dados reais. Executar
`playwright-cli run-code --filename frontend/test/browser/notification-center.js`
para validar leitura individual/em lote, persistência, erros e novas tentativas,
paginação, troca de conta, foco do teclado e telas de 390 e 320 pixels.

## Outros avisos pertinentes para futuras etapas

| Aviso sugerido | Acesso necessário |
| --- | --- |
| Documento aguardando assinatura, recusado ou com todas as assinaturas concluídas | Documento e participação/permissão na área de assinaturas |
| Prazo próximo ou vencido de documento, checklist ou liberação do cliente | Projeto e área responsável no Efetivo |
| Mobilização, desmobilização, mudança de equipe ou de data da missão | Missão e respectiva área do Efetivo |
| Conflito de alocação, férias ou afastamento que afete uma equipe | Efetivo e acesso aos colaboradores envolvidos |
| Proposta revisada, selecionada, recusada ou com divergência de escopo | Acompanhamento e projeto; dados financeiros seguem suas permissões adicionais |
| Meta semanal atrasada ou desvio de prazo/custo | Acompanhamento e projeto; valores somente com a permissão correspondente |
| Romaneio expedido, recebido ou aguardando devolução | Romaneio e seus registros |
| Estoque abaixo do mínimo, requisição pendente ou material indisponível | Estoque e operação correspondente |
| Calibração vencendo, equipamento indisponível ou manutenção pendente | Equipamentos/manutenção e registro correspondente |
| Não conformidade aberta ou ação corretiva com prazo próximo | Qualidade e registro correspondente |
| Relatório aprovado ou liberado para o cliente | Autor ou cliente vinculado, após a liberação efetiva do relatório |
| Falha de integração ou sincronização que exija intervenção | Administradores ou gestores responsáveis pela integração |
