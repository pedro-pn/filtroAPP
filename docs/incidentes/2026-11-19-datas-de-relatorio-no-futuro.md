# Relatórios com data de execução no futuro (correção de dados)

- **Início / detecção / fim:** lançados entre 2026-06-08 e 2026-07-16; detectados em 2026-11-18 pelo ensaio de restauração (último RDO "2062-06-29"); corrigidos em 2026-11-19 14:3x UTC.
- **Quem detectou e como:** sanidade do `deploy/restore-drill.sh` e consulta `reportDate > now() + 30 dias`.
- **Impacto:** 7 relatórios com `reportDate` errada distorciam filtros e gráficos por período (Acompanhamento, Efetivo, estatísticas). Nenhum dado perdido.

| Projeto | Relatório | Gravado | Corrigido para |
|---|---|---|---|
| 5724 | RDO nº 151 | 2062-06-25 | 2026-06-25 |
| 5724 | RDO nº 153 | 2062-06-29 | 2026-06-29 |
| 5000 | RDO (sem número, lançado em 16/07) | 2062-02-20 | 2026-02-20 |
| 5797 | RDO nº 16 (assinado) | 2027-02-08 | 2026-06-08 |
| 5797 | RLQ nº 3, RCPU nº 10 e nº 11 (derivados do RDO nº 16) | 2027-02-08 | 2026-06-08 |

- **Como foi corrigido:** SQL direto em uma transação, alterando só `Report.reportDate` (sem `updatedAt`, sem status), com trava de valor antigo, contagem exata de 7 linhas e conferência de que `ReportEmailJob`, `NotificationEvent` e `IntegrationEvent` não ganharam registros (375 / 264 / 4240 antes e depois). As triggers de `Report` só reagem a mudança de status (notificações, eventos de integração) ou de `updatedAt` (fila de e-mail de liberação dos derivados), por isso nada foi enviado nem pedida nova assinatura. Datas corretas inferidas dos relatórios vizinhos na sequência e da data de criação. Backup dos valores anteriores: `/root/backups/filtrovali/manual-fixes/2026-11-19-report-dates-before.csv` no servidor.
- **Ficou como estava (por decisão):** o PDF já assinado do RDO nº 16 do 5797 continua mostrando 08/02/2027; não foi reemitido nem reenviado para assinatura.
- **Causa raiz:** erro de digitação no campo de data (ano 2026 → 2062; 2027 no lugar de 2026), aceito porque a API e a tela não limitam a data do relatório a um intervalo plausível.
- **O que muda para não repetir:** validar `reportDate` na criação/edição (ex.: não mais que alguns dias no futuro) — proposta em aberto.
