# Quickstart — Efetivo Operacional

## Pré-requisitos

- Usuário com `efetivo:viewer` para consulta e `efetivo:manager` para parametrização e férias; `ADMIN` possui bypass.
- Histórico do VR Ponto Mais sincronizado e colaboradores vinculados.
- Cargos cadastrados, com a opção **Função operacional** revisada.

## Validação local automatizada

```bash
npm run architecture:check
(cd backend && npm test)
(cd frontend && npm run lint && npm test && npm run build)
```

## Roteiro manual

1. Abra `/efetivo` e confirme o tutorial no primeiro acesso; use **Ver tutorial** para repeti-lo.
2. Em **Produtividade**, altere `Ano` e `Mês de corte`; recarregue a página e confirme que `ano` e `ateMes` permanecem na URL.
3. Confira os quatro indicadores, a evolução mensal e a informação de última sincronização. O mês corrente deve ficar fora do cálculo.
4. Abra um colaborador na tabela. Confirme que a soma de **HH normais** do detalhe mensal coincide com as **HH acumuladas** da linha e que fechar o modal remove somente `colaborador` da URL.
5. Confira **Pendências**: ponto sem vínculo, colaborador sem dados e cargo não cadastrado devem ficar fora da taxa e levar às telas de correção.
6. Com `efetivo:manager`, edite a referência mensal; com `efetivo:viewer`, confirme que a ação não aparece e que a API recusa mutações.
7. No Gestor, informe uma **Data de desligamento** e confirme o pró-rata no último mês. Em Cargos, desmarque **Função operacional** e confirme que o cargo sai do indicador.
8. Em **Férias e ausências**, cadastre férias, edite e remova o período. O mês deve ser sinalizado na produtividade sem mudar a taxa oficial; uma sobreposição deve ser recusada.
9. Em 390 px, percorra filtros, KPIs, evolução, tabela/cards, pendências, detalhe e férias sem scroll horizontal da página.
10. Confirme que nenhuma tela do módulo permite lançar ou alterar HH manualmente; as horas vêm exclusivamente da sincronização.

## Rode no servidor

Os comandos abaixo são para o operador humano, conforme o procedimento de produção. Não foram executados durante a implementação.

```bash
# rode no servidor — atualizar e reconstruir a aplicação
git pull
POSTGRES_PASSWORD=<senha> docker compose -f docker-compose.prod.yml up -d --build

# rode no servidor — aplicar a migration versionada
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
```

Depois, atribua `efetivo:viewer` ou `efetivo:manager` aos usuários autorizados e execute o roteiro manual em produção.
