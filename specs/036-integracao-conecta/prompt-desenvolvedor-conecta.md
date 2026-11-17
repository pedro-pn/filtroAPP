# Prompt para o desenvolvedor do Conecta

Precisamos implementar o lado Conecta de uma integração automática de RH com o FiltroAPP. Leia primeiro o código e a arquitetura existentes do Conecta e implemente usando seus padrões. O contrato anexo `contracts/conecta-api.md` é uma proposta a homologar, não uma API já disponível no FiltroAPP. Informe incompatibilidades antes de alterar nomes ou semântica compartilhados.

## Objetivo e responsabilidade

Conecta será a origem dos dados de RH; FiltroAPP manterá o cadastro operacional canônico e suas decisões de mobilização. Sua entrega no Conecta deve incluir produção durável de eventos, envio automático, API de recuperação incremental/carga inicial, evidências autorizadas, testes e documentação. FiltroAPP implementará recepção, vínculo dos IDs, conciliação de cargos, aplicação no cadastro e integração ao workflow. Não acessar diretamente o banco do FiltroAPP.

Sincronizar:

1. Novos colaboradores operacionais, com ID estável da pessoa e do vínculo, empresa, nome, matrícula, CPF quando disponível para conciliação, e-mail opcional e data de admissão.
2. Desligamentos com data efetiva, correções/cancelamentos e recontratações. Preservar ID da pessoa e criar vínculo distinto na recontratação. Não excluir o histórico nem deixar de publicar mudanças de quem saiu do quadro operacional.
3. Cargos com ID estável, nome completo, situação e classificação operacional. Informar CBO se já existir. Preservar níveis e especialidades. Uma alteração de grafia não deve gerar novo ID sem necessidade.
4. Histórico de mudanças de cargo, incluindo cargo inicial e dia real de vigência; suportar revisão retroativa, cancelamento, substituição e agendamento futuro.
5. Documentos de conformidade, exames, treinamentos e certificados por pessoa/vínculo, com tipo, situação, emissão, validade, revogação, versão e evidência consultável. Não transmitir diagnósticos clínicos, folha, dados de assinatura ou permissões.

6. Salário-base mensal por função/cargo, em BRL, com histórico, data de vigência, reajustes futuros, correções e cancelamentos. Conecta será a fonte desse valor no FiltroAPP. Enviar tabela da função, sem derivar o valor do salário individual de um colaborador e sem incluir encargos/benefícios no salário-base.

Para salários, publicar também `job_role_salary.upserted`, com ID estável da ocorrência, cargo externo, `amount` decimal em string (ex.: "4086.57"), `currency=BRL`, `basis=MONTHLY`, `effectiveDate` e `status=ACTIVE/CANCELLED`, usando revision/eventId do envelope. Nova vigência é outra ocorrência; correção/cancelamento incrementa revisão da mesma ocorrência. Incluir o agregado em feed, snapshots e consulta individual. Se houver várias tabelas por empresa/jornada para a mesma função, explicitar as dimensões para homologação; não escolher média ou último salário recebido. Informar caso o Conecta não tenha tabela salarial por função.

A recepção salarial exigirá o escopo adicional `rh.conecta.salarios.write`; a API de recuperação do Conecta também deve separar autorização salarial. Não expor valores em logs ou catálogo geral. FiltroAPP fará a conciliação de cargos e a projeção no perfil de custos preservando os encargos/benefícios locais e o histórico. Mudança de cargo usará o salário da função vigente na data, respeitando separadamente a vigência do reajuste.

## Contrato e automação

- Usar os envelopes versionados do contrato: schemaVersion, eventId, companyId, eventType, aggregateType, aggregateId, revision, occurredAt e data. ID externo deve ser estável. Revisão é monotônica por agregado, evento representa seu estado completo, e data efetiva é independente da data de envio.
- Publicar job_role.upserted, employment.upserted, role_change.upserted, job_role_salary.upserted e compliance.upserted. Reenvio preserva eventId e corpo; correção cria evento novo e revisão maior do mesmo agregado. Não comparar revisões entre tipos diferentes.
- Implementar outbox persistente na mesma transação da alteração de RH e worker após commit. Não depender de chamada HTTP síncrona para salvar o cadastro. Mudanças por tela, importação, rotina ou outra API precisam entrar no mesmo mecanismo.
- Enviar para o endpoint proposto do FiltroAPP `POST /api/integracoes/v1/rh/conecta/eventos`, com Bearer técnico e Idempotency-Key=eventId. URL/token vêm da configuração de backend.
- Tratar 202 como recepção durável, guardar receiptId e acompanhar o status de aplicação. Repetir transporte em timeout, 429 e 5xx com backoff/jitter e Retry-After; exibir falhas de autenticação e payload para correção. Não gerar novo eventId só porque a tentativa falhou.
- Disponibilizar feed incremental paginado, snapshot consistente com watermark e consultas individuais, conforme contrato. Incluir ativos, desligados, histórico, cancelamentos e revogações. Paginação estável, cursor opaco e erro explícito para cursor expirado. Documentar retenção do feed e expiração do snapshot.
- Feed e webhook devem compartilhar IDs/revisões. Alterações feitas durante carga inicial precisam ser recuperáveis a partir do watermark. Nunca inferir exclusão por ausência; emitir tombstone/cancelamento explícito.
- Expor download autorizado/versionado de evidências ou link curto renovável. Nenhum binário/base64 no webhook e nenhuma URL pública permanente com documento pessoal.

## Cargos e identidade

O FiltroAPP já possui pessoas e cargos. Envie catálogo para uma conciliação inicial, sem presumir que seus IDs coincidem. FiltroAPP comparará nomes ignorando acentos, caixa e espaços; abreviações e pequenas diferenças serão conciliadas em um mapeamento persistente. Similaridade não autoriza fusão automática. “Operador I” e “Operador II” permanecem distintos. Não usar apenas nome da pessoa como identidade e não usar somente CPF para distinguir vínculos empregatícios.

O FiltroAPP mantém uma atribuição de cargo por pessoa/data. Se houver mudanças intermediárias no mesmo dia, entregue explicitamente a atribuição final e o cancelamento/substituição das ocorrências anteriores. Não substituir histórico com o cargo atual sem a data real. Se o Conecta não tiver histórico, declarar essa limitação e a primeira data efetivamente conhecida; não inventar datas.

## Qualidade e entrega

Implementar testes de duplicação, perda/reenvio, ordem invertida, reinício do worker, correção retroativa, futuro, desligamento/recontratação, alteração da classificação operacional, mudança de nome de cargo, conflitos no mesmo dia, reajuste salarial futuro/retroativo, cancelamento salarial, isolamento de acesso a salário, revogação de evidência e snapshot concorrente com novas alterações. Isolar empresas e restringir acesso técnico. Não registrar CPF, tokens ou links assinados em logs gerais.

Entregar:

- Código, migrations necessárias e testes do lado Conecta.
- OpenAPI/JSON Schema dos endpoints e eventos, exemplos sintéticos e instruções de configuração.
- Matriz dos campos realmente disponíveis, identificação de empresa/pessoa/vínculo, origem da classificação operacional e cobertura histórica.
- Retenção, paginação, limites, rotação de token, métricas de entrega/aplicação, recuperação e replay.
- Lista explícita das adequações necessárias ao contrato proposto para homologarmos antes da ativação.

Critério final: após a conciliação inicial, admissões, desligamentos, mudanças de cargo, salários por função e conformidade seguem automaticamente para o FiltroAPP; falhas transitórias são recuperadas e duplicações não criam novos registros. Conflitos de dados ficam visíveis para resolução única e não provocam associação incorreta.
