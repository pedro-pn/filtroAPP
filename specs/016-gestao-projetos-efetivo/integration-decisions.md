# Decisões de integração — Gestão de Projetos

Decisões validadas em 11/09/2026 para orientar os próximos incrementos da Gestão de Projetos.

## Princípios confirmados

- O `Project` continua sendo o registro mestre operacional no FiltroAPP.
- O Nectar será a fonte oficial dos fatos comerciais e também receberá informações operacionais do FiltroAPP.
- Integrações externas não movimentam o card automaticamente. Elas atualizam fatos, evidências, alertas e a prontidão das frentes afetadas.
- Reservas e inconsistências vindas de Equipamentos ou Estoque geram avisos. Exceções podem ser tratadas manualmente, com responsável e justificativa, sem bloqueio técnico absoluto.
- Os checklists operacionais continuam representando confirmações humanas. Informações comerciais recebidas de outra plataforma aparecem como sinais de consulta.

## Integrações externas validadas

| Sistema | Decisão | Direção | Escopo confirmado |
|---|---|---|---|
| Nectar CRM | Integração obrigatória | Bidirecional | Receber projetos, fatos e documentos comerciais; devolver informações operacionais do projeto |
| Nectar CRM | Webhook e sincronização periódica | Nectar ↔ FiltroAPP | Webhook para baixa latência e sincronização para carga inicial, recuperação e reconciliação |
| Omie | Somente consulta | Omie → FiltroAPP | Compras, contas a pagar, notas, faturamento e recebíveis; o FiltroAPP não cria solicitação ou pedido de compra |
| Plataforma de conformidade de pessoas | Integração obrigatória, fornecedor ainda não definido | Plataforma → FiltroAPP | Exames, treinamentos e certificados por colaborador, incluindo validade e evidência consultável |
| E-mail | Canal inicial de alertas | FiltroAPP → usuários | Alertas automáticos dos marcos e pendências do projeto |
| WhatsApp | Radar futuro | A definir | Avaliar notificações e eventual apoio ao grupo do projeto depois da estabilização do e-mail |
| Sistemas/aceites do cliente | Centralizados pelo CRM | CRM ↔ cliente e CRM → FiltroAPP | Situação e evidência de aprovação do cliente entram no FiltroAPP pelo Nectar |

## Integrações internas validadas

| Módulo | Decisão |
|---|---|
| Equipamentos, Manutenção e Calibração | Consultar disponibilidade, localização, conflitos, manutenção e certificados; permitir reserva automática ou manual; conflitos geram aviso e aceitam exceção justificada |
| Estoque | Consultar saldo e permitir reserva de material; indisponibilidade ou divergência gera aviso e aceita ajuste manual; não criar solicitação de compra |
| Romaneio | Continuar controlando a movimentação física; Saída usa a autorização vigente e Entrada permanece disponível conforme a política atual |
| Efetivo/Missões | Continuar como fonte de equipe, funções, ciclos, mobilização e desmobilização, projetada no Kanban único |
| Administrativo/RH | Manter no workflow a confirmação documental das pessoas, usando a plataforma externa como evidência de apoio |
| Logística, hospedagem e QSMS | Permanecer dentro do workflow por enquanto, sem criação de módulos próprios |
| RDOs, Relatórios, Assinaturas, Acompanhamento e Qualidade | Permanecer como fontes internas dos dados operacionais, documentos, avanço, desvios e lições aprendidas |
| Financeiro | Consumir dados de medição do workflow e valores realizados do Omie, mantendo medido, aprovado, faturado e recebido como estados diferentes |

## Regras do conector Nectar

1. Usar webhook para eventos novos e sincronização periódica para carga inicial, recuperação de falhas e reconciliação.
2. Processar eventos de forma idempotente e impedir que uma versão antiga substitua dados mais recentes.
3. Identificar o vínculo pelo identificador Nectar e manter referências complementares de projeto, proposta, revisão, cliente e CNPJ.
4. Campos governados pelo Nectar ficam somente para leitura no FiltroAPP e oferecem ligação para o registro de origem.
5. Manter operação manual enquanto o projeto ainda não estiver vinculado. Exceções posteriores exigem permissão, justificativa, autoria e validade.
6. Separar a data esperada comercial da mobilização planejada pelo time operacional.
7. Mostrar falha ou atraso de sincronização como estado próprio; dado desatualizado não libera um gate automaticamente.
8. Retornar ao Nectar, no contrato inicial a detalhar, ao menos a etapa do projeto, datas operacionais principais, situação dos gates, riscos ou pendências críticas, avanço e encerramento.
9. Receber do Nectar os aceites do cliente, incluindo versão, data, responsável e evidência, sem inferir aceite somente pela existência de um arquivo.

## Regras para pessoas, equipamentos e materiais

1. A plataforma externa de conformidade fornece, por colaborador, tipo do documento, situação, emissão, validade, evidência e instante da sincronização.
2. O FiltroAPP exibe esses dados no planejamento da equipe, mas o responsável continua confirmando o checklist aplicável ao cliente e à mobilização.
3. Conflitos de equipamento, manutenção, calibração, saldo ou reserva produzem avisos visíveis e auditáveis.
4. O responsável pode registrar exceção manual com motivo. A integração não cria um bloqueio técnico impossível de superar.
5. Uma mudança na fonte reabre somente as confirmações afetadas e preserva o histórico anterior.
6. Reserva de estoque faz parte do planejamento; solicitação e emissão de compra permanecem fora do FiltroAPP.

## Alertas

- Canal inicial: e-mail.
- Marcos: D-90, D-30, D-15, D-7, D-1, vencimentos e pendências críticas.
- Reagendamento recalcula os marcos sem duplicar mensagens.
- Primeira automação implementada: Líder e Planejador vinculados ao projeto, com deduplicação por endereço e histórico por marco/data. Destinatários por área e escalonamentos adicionais permanecem como evolução.
- WhatsApp permanece registrado como evolução futura, sem dependência para a primeira automação.

## Estado das reservas internas

- Equipamentos selecionados e insumos confirmados nas etapas anteriores à mobilização constituem reservas internas do planejamento.
- Conflitos de intervalo e falta de saldo aparecem como avisos e aceitam justificativa manual auditável.
- A saída do workflow das etapas de planejamento libera a reserva lógica; Romaneios e Estoque continuam responsáveis pela movimentação física.
- Nenhuma chamada ao Omie participa do cálculo atual.
