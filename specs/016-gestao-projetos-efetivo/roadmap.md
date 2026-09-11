# Planejamento completo — Gestão de Projetos Filtrovali

Origem: estudo discutido em 08/09/2026 e implementação iniciada em 09/09/2026. O card representa o projeto; o Líder de Projetos responde do aceite ao encerramento.

## Fluxo alvo

Handover comercial → Análise inicial → Aguardando planejamento → Planejamento da mobilização → Preparação → Pronto para mobilizar → Mobilização → Em execução → Desmobilização → Pós-job / fechamento técnico → Documentação / medição → Encerrado.

Liberação comercial/contratual e documentação antecipada são frentes paralelas dentro do projeto. D-90/D-30/D-15/D-7/D-1 são marcos configuráveis, não colunas.

A futura integração com o Nectar será a fonte dos fatos comerciais, enquanto o FiltroAPP continuará responsável pelas confirmações e decisões operacionais. A matriz detalhada de propriedade, contingência manual e impacto por entrega está em [crm-integration-dependencies.md](crm-integration-dependencies.md); as decisões validadas para todas as integrações estão em [integration-decisions.md](integration-decisions.md).

## Estado de implementação em 11/09/2026

- Entrega 016 concluída: registro mestre, quatro etapas iniciais, líder, aceite, checklists, itens críticos, pendências, auditoria e avanço explícito.
- Entrega 017 concluída: liberação comercial manual preparada para CRM e papel Comercial restrito à sua frente.
- Entrega 018 concluída: documentação antecipada, planejamento D-30 por área, papéis operacionais e marcos derivados D-90/D-30/D-15/D-7/D-1.
- Entrega 019 concluída: Preparação D-15 por área, gate consolidado em nove frentes, autorização versionada, suspensão por alteração e alertas D-7/D-1.
- Entrega 020 concluída: gate aplicado às mobilizações oficiais do Efetivo, romaneios de saída e retiradas do Estoque; projetos sem gestão iniciada permanecem no modo legado até classificação explícita.
- Entrega 021 concluída: seleção do Romaneio filtrada pelo tipo; Saída mostra gerenciados autorizados e legados ativos, enquanto Entrada mantém todas as obras acessíveis disponíveis.
- Entrega 022 concluída: etapa Em Execução preserva a autorização; dashboard reúne avanço, prazo, RDOs, metas de relatórios técnicos e desvios integrados com Qualidade.
- Entrega 023 concluída: Evolução apresenta um único Kanban do projeto; Mobilização integra o fluxo e sincroniza a etapa da missão oficial, enquanto Missões mantém equipe, ciclos e datas.
- Entrega 024 concluída: Desmobilização integra o Kanban único com conclusão de campo, conferências, retorno de equipe e ativos, avarias, datas efetivas e projeção da missão em Medição final sem alterar seus ciclos.
- Entrega 025 concluída: Pós-job / fechamento técnico integra o Kanban com nove controles, registro estruturado, histórico por cliente ou serviço e lições aprendidas sincronizadas com Qualidade. O detalhe ganhou categorias recolhíveis e o arraste só abre bloqueios depois da soltura.
- Entrega 026 concluída: Documentação / medição integra o Kanban com 14 controles, evidências dos RDOs e relatórios, quantitativos, extras, datas e valores de execução, medição e aprovação. Contrato e faturamento permanecem separados e usam as fontes atuais de orçamento/Omie, preparados para a futura origem comercial no CRM.
- Entrega 029 concluída: Comercial e Handover passam a exibir sinais de consulta do CRM sem criar pendências; documentação antecipada passa a controlar tipos e itens nomeados com solicitação, confirmação, datas e histórico; checklists operacionais salvam automaticamente.
- Entrega 030 concluída: Análise inicial mantém apenas responsabilidades e dúvidas comerciais como checklists; mobilização e início estimados são datas de consulta do CRM; contato inicial registra resposta, nome e data; pendências preservam sua área de origem sem expor esse campo para edição.
- Entrega 027 concluída: Encerramento finaliza o Kanban único com dez confirmações finais, gate consolidado de 24 controles, aprovação estruturada da medição, pós-job e pendências zeradas. O encerramento registra autor/data, sincroniza a missão oficial, mantém a obra em modo de consulta e exige justificativa auditável para reabrir.
- Entrega 028 concluída: catálogo versionado de documentos no diálogo do projeto, aceite por versão, requisitos explícitos por etapa, vínculo com Assinaturas, projeção dos RDOs/relatórios e adaptador interno preparado para documentos do futuro CRM. Propostas podem ser vinculadas como evidência sem confirmar fatos comerciais automaticamente.
- Decisões de integração validadas: Nectar bidirecional por webhook e sincronização periódica; Omie somente consulta; conformidade de colaboradores fornecida por plataforma externa; reservas de equipamentos e estoque com avisos e exceções manuais; alertas inicialmente por e-mail; aprovações do cliente recebidas pelo Nectar; logística, hospedagem e QSMS mantidos no workflow.
- O fluxo funcional planejado de Handover a Encerrado e o catálogo documental estão concluídos. Os próximos incrementos passam a ser o conector Nectar, a consulta externa de conformidade, as reservas assistidas de equipamentos/estoque e as automações de alertas por e-mail.

## Entrega 1 — Fundamentos e entrada em planejamento

Implementar agora o recorte verificável em spec.md/tasks.md: gestão oficial vinculada ao Project, quatro etapas iniciais, líder/aceite, checklist do handover e análise, perguntas críticas e pendências com área, responsável, criticidade, prazo e status. O Kanban de Evolução é refinado progressivamente; Missões preserva a configuração operacional de equipe, ciclos e datas. D-30 calculado na tela; notificações automáticas ficam na entrega 2.

A gestão inicia explicitamente: nenhum projeto histórico recebe aceite ou liberação presumidos. Troca de líder invalida aceite. A gestão não é alterada pela aplicação de cenários do Efetivo.

## Entrega 2 — Preparação e autorizações

1. Expandir responsabilidades: Comercial inicia e responde pela liberação; líder coordena; Operações, Ativos, Administrativo/RH, QSMS e Financeiro respondem por suas frentes. Autorizações por área e substituições registradas.
2. Documentos do projeto: propostas técnica/comercial, contrato, PO, desenhos/especificações, certificados e evidências, com tipo, versão, responsável e aceite; integrar armazenamento e assinaturas existentes.
3. Liberação comercial: exibir condições de execução, medição e faturamento, proposta, pedido e contrato como sinais de consulta sincronizados pelo CRM. Esses sinais não criam pendências nem bloqueiam o fluxo no FiltroAPP.
4. Documentação antecipada: decidir a necessidade por tipo e acompanhar documentos/cadastros, exames, treinamentos e certificações em itens nomeados, com situação, datas e histórico.
5. Equipe: quantidades e funções antes dos nomes; preliminar → confirmada → liberada. Cadastro/integração/aceite pelo cliente. Preservar regras de conflitos e ciclos existentes.
6. Equipamentos: lista necessária, localização/retorno de outras obras, reserva por intervalo, manutenção, teste, calibração, acessórios e checklist. Integrar Equipamentos/Manutenção/Romaneios; não duplicar cadastros.
7. Materiais: necessidade, quantidade, saldo, cotação, compra, recebimento, separação e mobilização. Integrar Estoque/Omie/Romaneios; antecipar insumos longos e filtros >10.
8. Logística: veículo, frete, hospedagem, dias/pessoas, saída e retorno. Pré-job: agenda, apresentação de escopo/riscos/cronograma e responsável de campo.
9. Gate Pronto para mobilizar: consolidar Equipe, Documentação, Equipamentos, Materiais, QSMS, Hospedagem, Logística e Cliente; mostrar Comercial como sinalização informativa. Emitir autorização conforme as frentes operacionais e permitir exceções registradas quando aplicável.
10. Automações: D-90 revisa longo prazo; D-30 inicia cobranças de planejamento; D-15 confirmações; D-7 lista amarelos/vermelhos; D-1 risco de mobilização. Configurar antecedência por item e referência em mobilização. Recebimento tardio ativa verificações vencidas imediatamente. Reagendamento recalcula marcos sem duplicar alertas/tarefas; revalidar liberações afetadas por mudanças de equipe, escopo e prazo. Reaproveitar jobs rastreados; definir canal e destinatários antes de ativar envios.

## Entrega 3 — Execução e fechamento

1. Dashboard usa Acompanhamento e relatórios existentes: previsto × realizado, dias, término estimado, quantitativos, evidências e RDO recebido/enviado/aprovado. Definir entregas esperadas para denominadores RTP/RLQ/RLR/RCPU, incluindo ausência de emissão e rejeições.
2. Desvios usa Qualidade: prazo, escopo, cliente, equipamento, pessoal, material, segurança, qualidade e comercial; descrição, responsável, prazo, impacto, ação e status. Links diretos no projeto.
3. Desmobilização: conclusão confirmada, quantitativos/extras/pendências, conferência de equipamento/material/ferramenta, retorno equipe/frete, encerramento hospedagem, recebimento por Ativos e avarias. Diferenciar data prevista e efetiva e preservar múltiplos ciclos.
4. Pós-job: feedback de campo/equipe, problemas/soluções/melhorias, planejamento e equipamentos. Lições aprendidas no módulo Qualidade, consultáveis por cliente e serviço.
5. Documentação: todos RDOs/relatórios emitidos, revisados, enviados, aprovados e aceitos; pendências resolvidas. Não confundir aprovação interna com aceite do cliente.
6. Medição: quantitativos finais, extras, evidências, preparação/envio/aprovação e valor aprovado. Exibir contrato, executado, medido, aprovado e pendente; manter faturado/recebido como dimensões distintas, integradas ao Omie.
7. Encerramento: escopo e documentação 100%, medição aprovada, pós-job e feedbacks, equipamentos devolvidos e pendências internas/cliente zeradas. Guardar autoria/data e reabertura justificada.

## Integrações existentes a preservar

Project é mestre; Efetivo mantém equipe/capacidade/ciclos/simulações; Acompanhamento consolida escopo e financeiro; Qualidade mantém desvios/lições; Equipamentos e Manutenção controlam ativos; Estoque e Romaneios registram materiais/saídas/retornos; Relatórios mantém emissão, evidências e assinaturas.

O CRM será a fonte oficial de criação/revisões de propostas, aceite comercial, pedido de compra, contrato e condições de medição/faturamento. O Omie permanece como fonte de compras, notas e recebimentos realizados. O FiltroAPP preserva o vínculo operacional, histórico, confirmações humanas e gates calculados.

## Sequência de adoção

Validar incremento em ambiente isolado; classificar explicitamente projetos atuais; ativar frentes e responsabilidades; somente então integrar bloqueios de operações. Definir testes de concorrência, permissão por área, data antecipada/adiada e simulações antes de cada entrega. Deploy é operação manual conforme constitution.
