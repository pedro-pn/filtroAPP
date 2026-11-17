# Integração Conecta — pessoas e conformidade

Data: 29/10/2026. Estado: proposta de implementação, sem conector entregue.
Solicitação: acrescentar à conformidade já planejada a sincronização automática de admissões, desligamentos, cargos e mudanças de cargo com a data real da mudança. Conecta é o nome informado pelo solicitante para a plataforma anteriormente referida como Solides.

## Requisitos

1. Conecta será a fonte dos dados de RH dos vínculos operacionais integrados: identidade, matrícula, admissão, desligamento, cargo, histórico datado e salário-base por função. FiltroAPP mantém IDs canônicos, planejamento, permissões, assinaturas, custos e decisões operacionais.
2. Importar inicialmente colaboradores operacionais ativos e desligados relevantes ao histórico, cargos e histórico disponível; sincronizar alterações automaticamente com eventos e reconciliação periódica.
3. Identificar pessoas por empresa + ID externo estável e vínculo empregatício. Não identificar exclusivamente por nome. CPF/matrícula auxiliam o vínculo inicial com cadastros existentes; divergências ficam pendentes, sem duplicação automática.
4. Admissão cria ou vincula um cadastro canônico com cargo resolvido e histórico inicial. Recontratação deve preservar a pessoa e distinguir vínculos; matrícula pode mudar. A ausência em uma página ou exportação não significa desligamento.
5. Desligamento tem data efetiva inclusiva (último dia elegível); impede novas alocações posteriores e sinaliza missões afetadas para replanejamento, preservando RDOs, EPI, Ponto, custos, assinaturas e histórico. Cancelamento/correção explícita é suportado.
6. Cargos são vinculados por ID externo persistente. Comparação inicial usa normalizeJobRoleKey; somente um candidato compatível permite vínculo automático. Abreviações e pequenas diferenças geram sugestões e mapeamento revisável. Não remover níveis I/II/III nem usar agrupamento visual como identidade. Novos cargos claramente distintos podem ser criados; possíveis duplicatas aguardam resolução única, reaproveitada nas próximas sincronizações.
7. Mudanças de cargo preservam effectiveDate e ID externo da ocorrência, inclusive correções retroativas. Não usar receivedAt como vigência. Cargo vigente deriva da linha do tempo; alocações afetadas são sinalizadas e caches invalidados. RDOs emitidos preservam snapshots.
8. Datas futuras ficam agendadas na integração; um job aplica a projeção vigente em America/Sao_Paulo. O serviço atual que rejeita vigência futura não deve ser contornado em rotas manuais.
9. Exames, treinamentos, certificados e documentos trazem tipo, situação, emissão, validade, evidência, versão e sincronização. Distinguir informação ausente, vencida, revogada, indisponível e válida; não fabricar conformidade.
10. Documentação antecipada, D-30, D-15 e prontidão consultam os dados; confirmações humanas e exceções justificadas continuam no workflow. Mudanças relevantes reabrem somente confirmações afetadas e reavaliam autorização conforme versionamento existente.
11. Recepção durável, idempotência, ordenação por agregado, tentativas com backoff, replay, reconciliação e auditoria são obrigatórios. Entrega aceita não equivale a aplicada. Falha em uma pessoa não impede as demais.
12. Token técnico com escopos próprios usa a infraestrutura de API atual. Campos de RH integrados não podem ser sobrescritos silenciosamente por edição manual ou importações; exceções devem ter autoria, motivo e prazo. Ponto Mais mantém jornadas e vínculos próprios.

13. Conecta será a fonte do salário-base mensal por função/cargo canônico, com valor decimal em BRL, vigência e histórico. Reajustes, correções retroativas, cancelamentos e valores futuros entram na mesma sincronização automática. O salário aplicável combina o cargo vigente da pessoa com a tabela salarial vigente da função na data consultada; não importar salário individual como tabela da função.
14. Projetar o salário em CostProfile/CostParameterSet.params.salarioBase, preservando encargos, benefícios e demais parâmetros locais. Manter consulta externa existente por data, trilha da origem e proteção contra edição concorrente. Dados salariais exigem escopo próprio e não aparecem em catálogo geral, logs ou respostas sem autorização.
15. Havendo salários diferentes para a mesma função por empresa, jornada ou tabela, exigir contexto explícito e vínculo de perfil compatível antes de aplicar. Não escolher média, maior valor ou último recebido para resolver conflitos. Valor ausente não significa zero nem autoriza fallback silencioso.

## Aceite

- Reenviar o mesmo evento não duplica pessoa, cargo, histórico ou documento.
- Nome com acento/caixa/espaço diferente reutiliza cargo; nível diferente não é fundido. Mapeamento ambíguo não cria cargo automaticamente.
- Cadastro existente é vinculado sem perder relações; conflito CPF/matrícula não associa pessoa errada.
- Mudança atrasada preserva o dia real e não regride o cargo atual; correção e cancelamento reconstroem a linha do tempo com auditoria.
- Desligamento futuro só altera elegibilidade na data correta; correção e recontratação preservam histórico de vínculos.
- Indisponibilidade e reinício retomam processamento sem perder eventos; reconciliação recupera evento não entregue.
- Conformidade vencida/alterada atualiza prontidão e confirmações afetadas sem mover card nem aprovar automaticamente.
- Reajuste só vale a partir de effectiveDate; correção retroativa preserva trilha e reavalia somente períodos afetados. Reenvio não duplica versão salarial nem altera encargos/benefícios. Salário e cargo com vigências diferentes são resolvidos independentemente por data.
- Simulação e dry-run não alteram domínio nem iniciam processamento posterior.

## Dependências a validar com o Conecta

Contrato proposto em contracts/conecta-api.md: confirmar identificadores, disponibilidade de histórico e evidências, classificação operacional, limites e capacidade de outbox/feed incremental. Esses pontos são dependências de homologação, não funcionalidades presumidas da API Conecta.
