# Uma instância do backend até a medição pedir outra

- **Data:** 2026-11-26
- **Decisão:** produção continua com **uma** instância do backend e o Postgres na mesma VPS. Não há
  réplica, balanceador ou segunda máquina.
- **Medição que apoia (critério 11.5):**
  - **Capacidade:** o teste de carga em homologação, com os mesmos limites de produção, certificou
    ~16 req/s com p95 ≤ 1,5 s. O sistema satura em ~20 req/s, por CPU: o backend Node usa ~1 núcleo
    e o Postgres bate no teto de 1,25 CPU ([TESTE_DE_CARGA.md](../TESTE_DE_CARGA.md)).
  - **Uso real:** o pico de produção nos logs centralizados foi de 0,56 req/s, ~3,5% da capacidade.
- **Quando revisar:** quando o pico real passar de ~8 req/s, metade da capacidade; quando o teste
  de carga for refeito; ou quando um contrato novo prometer muitos usuários simultâneos.
- **Ordem quando precisar crescer:**
  1. otimizar as consultas das rotas que mais pioraram sob carga (fluxo do Efetivo, cards do
     Acompanhamento e notificações);
  2. segunda instância do backend na mesma máquina, atrás do nginx;
  3. máquina maior;
  4. só então separar o banco ou adotar várias máquinas.
- **Riscos aceitos:** a VPS é um ponto único de falha. A volta depende do backup externo (B2) e do
  restore ensaiado todo mês ([RUNBOOK_INCIDENTES.md](../RUNBOOK_INCIDENTES.md)).
