# Dependências da futura integração com CRM

## Decisão de arquitetura

O `Project` continua sendo o registro mestre operacional no FiltroAPP. O Nectar será a fonte oficial dos fatos comerciais que originam e alteram o projeto. A Gestão de Projetos não deve duplicar esses fatos como checkboxes independentes quando a integração estiver ativa.

O CRM informa fatos como “proposta criada”, “proposta aceita” e “pedido de compra recebido”. O FiltroAPP registra ações internas como “proposta revisada pelo Líder”, coordena as frentes operacionais e calcula os gates a partir dos fatos recebidos e das confirmações internas.

Até a integração entrar em operação, os fatos comerciais poderão ser preenchidos pelo Comercial no FiltroAPP. Cada informação precisa guardar `source` (`MANUAL` ou `CRM`), referência externa, data da fonte e data da última sincronização para permitir a migração sem perder histórico.

As decisões consolidadas para CRM, Omie, conformidade de colaboradores, equipamentos, estoque e alertas estão em [integration-decisions.md](integration-decisions.md).

## Decisões validadas em 11/09/2026

- O CRM será o Nectar.
- A integração será bidirecional: o Nectar fornece fatos comerciais e recebe informações operacionais do projeto.
- Serão usados webhook e sincronização periódica. O webhook atende eventos novos; a sincronização atende carga inicial, recuperação e reconciliação.
- Aprovações do cliente serão recebidas pelo Nectar.
- Omie permanece somente como fonte de consulta e não receberá solicitações ou pedidos de compra do FiltroAPP.
- Alertas usarão e-mail inicialmente; WhatsApp permanece no radar.

## Base existente que pode ser reaproveitada

- O webhook de entrada de projetos já recebe número e nome do projeto, cliente, CNPJ, proposta, revisão e local, cria o projeto de forma idempotente e exige conferência manual.
- A entrada atual já tenta selecionar a revisão correspondente da proposta comercial importada.
- `CommercialProposal` guarda número, revisão, identificador Nectar, data, cliente, contato, local, vendedor, valor, prazo, antecedência de mobilização e quantitativos preliminares.
- O identificador Nectar hoje é apenas um dado importado do Access. Não existe sincronização direta e contínua com um CRM para os estados comerciais descritos abaixo.
- Faturamento, recebíveis e compras realizados já possuem integração com o Omie e não devem ser transferidos para o CRM.

## Matriz de dependências

| Parte do fluxo | Dependência do CRM | Fonte ou ação no CRM | Responsabilidade mantida no FiltroAPP |
|---|---|---|---|
| Criação do projeto | Direta | Negócio ganho/projeto criado, código, cliente, CNPJ, local e proposta vigente | Conferência do cadastro, identidade operacional e início explícito da gestão |
| Proposta comercial anexada | Direta | Documento, versão, data, autor e situação da proposta comercial | Exibir a versão vigente e manter referência auditável |
| Proposta técnica anexada | Direta | Documento, versão, data, autor e situação da proposta técnica | Exibir a versão vigente e manter referência auditável |
| Desenhos, especificações e anexos usados na proposta | Direta quando armazenados no CRM | Metadados, versão e endereço do documento | Consultar pelo projeto; evitar cópia de arquivo sem necessidade operacional |
| Contato responsável do cliente | Direta | Contato, função, telefone e e-mail | Usar no handover e registrar contatos operacionais posteriores |
| Valor, prazo vendido e data esperada pelo cliente | Direta | Condições vigentes da oportunidade/proposta | Mostrar como referência comercial e apontar divergência com o planejamento operacional |
| Premissas, exclusões e responsabilidades contratuais | Direta se estruturadas no CRM; indireta se estiverem apenas no documento | Conteúdo comercial ou versão do documento que o contém | Líder confirma leitura, entendimento e impactos operacionais |
| Líder de Projetos definido | Sem dependência | — | Gestor do Efetivo designa; troca de líder invalida o aceite anterior |
| Grupo de comunicação e participantes internos | Sem dependência | — | Comercial e áreas internas registram a preparação do handover |
| Líder confirmou o recebimento | Sem dependência | — | Somente o Líder designado registra o aceite |
| Propostas técnica e comercial revisadas | Indireta | CRM fornece documentos e alerta nova revisão | Líder confirma a revisão da versão específica; nova versão reabre a confirmação |
| Escopo, quantitativos, premissas e exclusões compreendidos | Indireta | CRM pode preencher dados estruturados e quantitativos preliminares | Líder valida e registra o entendimento operacional |
| Perguntas de itens críticos | Indireta | Proposta pode sugerir equipamento, material, filtros, contratação ou requisitos especiais | Líder responde obrigatoriamente e encaminha as pendências |
| Proposta aceita/assinada | Direta | Estado, data, versão aceita e evidência | Compor o gate comercial e mostrar a procedência |
| Pedido de compra recebido | Direta | Número, data, valor, arquivo ou endereço e situação | Compor o gate comercial; Comercial trata divergências |
| Contrato assinado | Direta | Número, versão, partes, data e evidência | Compor o gate comercial e registrar exceções autorizadas |
| Cadastro/condições comerciais atendidas | Direta se o CRM controlar o processo | Situação e pendências do cadastro do cliente | Comercial resolve pendências e o FiltroAPP consolida o resultado |
| Condição de medição definida | Direta | Regra, periodicidade, evidências e aprovadores exigidos | Orientar execução, documentação e preparação da medição |
| Condição de faturamento definida | Direta | Condição, marcos e prazo de pagamento | Orientar o fechamento; notas e recebimentos continuam vindo do Omie |
| “Autorizado a executar, medir e faturar?” | Derivada | Depende dos fatos comerciais aplicáveis e vigentes | FiltroAPP calcula a resposta; exceção manual exige responsável, justificativa e validade |
| Requisitos documentais, exames e treinamentos do cliente | Indireta | CRM pode fornecer anexos/requisitos recebidos na negociação | Administrativo/RH identifica pessoas, providencia e confirma liberações |
| Marcos e reagendamentos | Indireta | CRM informa data prometida e alterações comerciais | FiltroAPP mantém mobilização planejada separada e recalcula D-90/D-30/D-15/D-7/D-1 |
| Quantidade preliminar de equipe e equipamentos | Indireta | Proposta pode fornecer estimativas | Operações e Ativos confirmam disponibilidade, nomes e reservas |
| Planejamento, preparação e mobilização | Sem dependência, exceto gate comercial | — | Equipe, equipamentos, materiais, QSMS, hospedagem, logística e cliente |
| Aditivos e propostas adicionais durante a execução | Direta | Nova proposta, versão, valor, escopo e aceite | Líder avalia impacto; Acompanhamento incorpora o valor aprovado |
| RDOs, relatórios, desvios e avanço | Sem dependência | — | Relatórios, Acompanhamento e Qualidade |
| Medição aprovada pelo cliente | Direta | Nectar registra negociação, aceite, versão, data e evidência | FiltroAPP controla quantitativos, evidências e envio e consolida a aprovação recebida |
| Faturado e recebido | Sem dependência do CRM | — | Omie continua sendo a fonte oficial |

## Retorno do FiltroAPP ao Nectar

O contrato de saída será detalhado na especificação do conector. O conjunto inicial deve contemplar etapa atual do projeto, datas operacionais principais, situação dos gates, riscos ou pendências críticas, avanço e encerramento. A sincronização de retorno não transfere ao Nectar a propriedade sobre equipe, reservas, RDOs, relatórios, desvios ou decisões operacionais.

## Regras necessárias para não acoplar o módulo ao CRM

1. Separar `commercialExpectedStartDate` da `plannedMobilizationDate`. Atualização do CRM não deve sobrescrever silenciosamente a programação operacional.
2. Todo fato comercial precisa informar fonte, identificador externo, versão, momento da ocorrência e momento da sincronização.
3. Eventos da integração precisam ser idempotentes e aceitar reenvio. Eventos antigos não podem substituir uma versão comercial mais nova.
4. Campos cuja fonte ativa é o CRM ficam somente para leitura no FiltroAPP, com ligação “Abrir no CRM”. Correções são feitas na origem.
5. O modo manual permanece disponível enquanto não houver vínculo com CRM. Depois do vínculo, qualquer exceção manual precisa de permissão comercial, justificativa e validade.
6. Uma nova revisão de proposta, alteração de escopo, valor ou data deve revalidar somente os gates afetados e registrar o motivo no histórico.
7. Falha de sincronização deve aparecer como estado próprio. Dados desatualizados não podem gerar uma nova liberação comercial automática.
8. Documentos externos devem ser referenciados por metadados e versão. Cópia para o armazenamento do FiltroAPP ocorre apenas quando retenção, assinatura ou uso offline exigir.
9. O webhook e a sincronização periódica usam a mesma regra de ordenação e idempotência.
10. O retorno operacional ao Nectar precisa registrar versão e instante da origem para evitar atualização circular.

## Impacto na sequência de implementação

- **Entrega 2 — Liberação comercial e documentos**: criar primeiro um modelo neutro de fatos comerciais com procedência manual/CRM. A tela manual será o modo inicial; o adaptador do CRM preencherá a mesma estrutura no futuro.
- **Entrega 3 — D-30**: consumir estimativas comerciais como sugestão, sem confirmar equipe, equipamento ou material automaticamente.
- **Entrega 4 — D-15**: não depende do CRM, salvo por alterações comerciais que obriguem revalidação.
- **Entrega 5 — Pronto para mobilizar**: a frente Comercial dependerá da vigência e da sincronização dos fatos do CRM; as demais frentes continuam internas.
- **Entrega 6 — Alertas**: reagendamentos vindos do CRM recalculam os marcos, mas não movem o card automaticamente.
- **Entrega 7 — Execução**: aditivos e revisões comerciais entram pelo CRM; avanço, RDO e desvios permanecem internos.
- **Entrega 9 — Medição e encerramento**: condições comerciais e aditivos podem vir do CRM; faturamento e recebimento continuam no Omie.
