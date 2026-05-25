# Procedimento LGPD - titulares e incidentes

Versão: 1.0
Data: 2026-05-22
Canal: privacidade@filtrovali.com.br

## 1. Solicitações de titulares

### 1.1 Recebimento

Solicitações podem chegar pelo canal de privacidade publicado na política, por contato comercial ou por usuário autenticado no app. Toda solicitação deve ser registrada como demanda interna com:

- nome e contato do solicitante;
- vínculo declarado com cliente, projeto, relatório, EPI ou pesquisa;
- tipo de solicitação: acesso, correção, exclusão/anonimização, oposição, portabilidade ou outra;
- data/hora de recebimento;
- responsável interno pelo atendimento.

Quando a solicitação for feita pelo app, o registro em `DataSubjectRequest` será usado como evidência inicial.

### 1.2 Verificação de identidade

Antes de enviar dados pessoais ou executar alteração, validar se o solicitante é o titular ou representante autorizado. Usar, conforme o caso:

- e-mail já cadastrado no sistema;
- vínculo com CNPJ/cliente/projeto;
- confirmação por canal corporativo conhecido;
- procuração ou autorização formal, quando solicitado por terceiro.

Não enviar cópia de dados pessoais a e-mails não verificados.

### 1.3 Triagem

Classificar a solicitação em até 5 dias úteis:

- atendimento direto pelo suporte/gestão;
- necessidade de consulta jurídica;
- necessidade de consulta ao cliente controlador/operador envolvido;
- pedido incompatível com obrigação legal, defesa de direitos ou retenção contratual.

### 1.4 Prazo e resposta

Responder ao titular em até 15 dias corridos, salvo orientação jurídica diversa. A resposta deve informar:

- dados/localizações avaliadas;
- ação tomada ou motivo da negativa;
- prazo de conclusão, se houver execução técnica pendente;
- canal para complemento ou recurso.

### 1.5 Execução técnica

Executar somente ações aprovadas na triagem. Para exclusão/anonimização, preservar evidências legais em PDFs, logs mínimos e documentos assinados quando houver obrigação legal, execução de contrato ou defesa de direitos.

Registrar evidência da ação executada: data, responsável, comando/rotina usada, escopo e resultado.

## 2. Incidentes de segurança com dados pessoais

### 2.1 Detecção e contenção

Ao suspeitar de acesso indevido, vazamento, perda, alteração indevida ou indisponibilidade relevante:

- registrar data/hora da descoberta;
- preservar logs e evidências;
- conter o vetor conhecido sem destruir evidências;
- suspender credenciais/tokens comprometidos;
- comunicar o responsável pelo canal de privacidade.

### 2.2 Avaliação

Em até 48 horas, avaliar:

- quais titulares e clientes podem ter sido afetados;
- quais categorias de dados foram envolvidas;
- volume aproximado de registros;
- origem provável;
- medidas já aplicadas;
- risco de dano relevante aos titulares.

### 2.3 Comunicação

Se houver risco ou dano relevante, preparar comunicação para ANPD e titulares, com apoio jurídico, contendo:

- natureza dos dados afetados;
- titulares envolvidos;
- medidas técnicas e administrativas usadas para proteção;
- riscos relacionados;
- medidas adotadas e planejadas para mitigação;
- canal de contato.

### 2.4 Encerramento

Após contenção e comunicação, registrar relatório interno com causa raiz, linha do tempo, evidências, decisões, responsáveis e ações preventivas.

## 3. Evidências

Manter evidências em repositório documental controlado da empresa. Não armazenar documentos sensíveis de incidentes no código-fonte.
