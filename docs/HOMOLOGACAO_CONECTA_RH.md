# Homologação da integração de RH — Conecta → FiltroAPP

Este roteiro valida o envio pelo Conecta, o recebimento pelo FiltroAPP e o resultado nas telas. Deve ser executado em ambiente de homologação, com o desenvolvedor do Conecta acompanhando os envios e o responsável pelo FiltroAPP conferindo o comportamento do app.

A implementação está na branch `feat/conecta-rh-integration`. A existência do código na branch não significa que ele já esteja publicado ou que o envio automático esteja ativado.

Contrato, decisões e operação: [Integração de RH do Conecta](INTEGRACAO_CONECTA_RH.md).

## 1. Preparar o ambiente do FiltroAPP

Publicar a versão da branch `feat/conecta-rh-integration`, aplicar a migration `20261113100000_conecta_rh` e atualizar frontend, API e worker para a mesma versão.

Usar inicialmente cadastros fictícios identificados como teste.

**Resultado esperado:** frontend, API, banco e worker estão preparados para receber e processar os eventos de RH.

## 2. Obter os dados de conexão do Conecta

O desenvolvedor do Conecta deve fornecer:

| Informação | Onde será usada no FiltroAPP |
| --- | --- |
| UUID da empresa, o `companyId` | `CONECTA_RH_COMPANY_ID` |
| URL completa da API de leitura, terminando em `/api/integracoes/filtroapp/v1` | `CONECTA_RH_API_URL` |
| Token de leitura emitido pelo Conecta | `CONECTA_RH_READ_TOKEN` |

O token de leitura precisa de `rh.leitura` e, para testar salários, também de `rh.salarios.leitura`.

Nesta primeira rodada, configurar somente o `companyId`. A leitura automática será habilitada na etapa 10. Os tokens reais devem ser configurados no backend, sem serem incluídos neste arquivo ou no Git.

## 3. Criar o token que o Conecta usará para enviar RH

No gerenciamento de tokens do FiltroAPP, criar uma credencial chamada, por exemplo, **Conecta — RH homologação**, com:

- Acesso a todos os projetos (`ALL`).
- Modo de escrita `LIVE`, no ambiente de homologação.
- Permissão `rh.conecta.eventos.write`.
- Permissão `rh.conecta.salarios.write`, para testar salários.

O desenvolvedor do Conecta deve configurar esse token em `FILTROAPP_RH_TOKEN` e apontar o envio para o servidor de homologação do FiltroAPP.

Inicialmente, manter o envio automático desligado e fazer os envios manualmente pelo Conecta ou por uma ferramenta de API, como Postman ou cURL. A operação de RH ainda não aparece no Playground do FiltroAPP.

Uma credencial `SIMULATE` executa com rollback e não serve para conferir a persistência dos cadastros. Caso se opte por ampliar as permissões de uma credencial existente, o FiltroAPP exige rotação; a edição comum da credencial permite apenas reduzir privilégios.

## 4. Confirmar o formato dos eventos com o desenvolvedor

Antes do primeiro envio, alinhar estas regras:

- `Idempotency-Key` deve ser igual ao `eventId`.
- Cada alteração recebe um novo `eventId` e uma revisão maior.
- A atualização mantém os identificadores da pessoa e do vínculo.
- Pré-admissão sem data pode enviar `admissionDate=null`.
- Se a vigência do cargo também for desconhecida, pode enviar `effectiveDate=null`.

Esse último ponto exige adequação no Conecta, pois o OpenAPI original exigia a vigência preenchida.

## 5. Enviar um cargo e uma pré-admissão sem data

Primeiro, enviar um cargo operacional. Depois, enviar um colaborador fictício vinculado a esse cargo, com status `PRE_ADMISSION` e admissão `null`.

O endereço receptor no FiltroAPP é:

```text
POST /api/integracoes/v1/rh/conecta/eventos
```

Enviar `Authorization: Bearer <token>`, `Content-Type: application/json` e `Idempotency-Key` igual ao `eventId`.

**Resultado esperado:** resposta `202`, com `receiptId` e `statusUrl`. O Conecta deve consultar esse `statusUrl`, usando o mesmo token, até obter `APPLIED`. Como o `statusUrl` é um caminho relativo, a consulta deve usar a mesma origem do FiltroAPP que recebeu o evento.

O `202` confirma o recebimento; o `APPLIED` confirma a aplicação. `PENDING` requer conferir o `reasonCode`, pois pode indicar dependência ou conciliação cadastral pendente.

## 6. Conferir o cadastro no FiltroAPP

Em **Efetivo → Colaboradores**, procurar a pessoa de teste e conferir:

- Existe apenas um cadastro.
- Nome e cargo estão corretos.
- Aparece **Pré-admissão · aguardando RH**.
- A admissão corresponde ao primeiro recebimento, considerando o dia em São Paulo.
- A data aparece marcada como **provisória**.

Depois, reenviar exatamente o mesmo evento. O cadastro, a data e o recibo devem permanecer os mesmos. Uma nova revisão ainda sem data também deve preservar a referência inicial.

## 7. Testar a mobilização da pré-admissão

Selecionar essa pessoa para uma equipe.

Primeiro, cancelar o aviso de pré-admissão: a inclusão não deve ser salva. Depois, repetir e confirmar: a inclusão deve ser permitida.

**Resultado esperado:** a pessoa participa da equipe, mas continua identificada como pré-admissão. Mobilizar não a ativa no RH.

Repetir o teste com outra pré-admissão que tenha uma data prevista futura.

## 8. Informar a data oficial e ativar no Conecta

No Conecta, preencher a admissão oficial e ativar a pessoa. Enviar a atualização mantendo o mesmo `personId` e `employmentId`, com revisão maior.

**Resultado esperado no FiltroAPP:**

- O mesmo cadastro é atualizado.
- A data oficial substitui a provisória.
- A indicação de data provisória desaparece.
- O status passa para `ACTIVE`.
- A vigência do cargo que foi derivada por falta de data acompanha a admissão oficial.

Uma vigência de cargo expressamente informada pelo RH permanece a informada; não deve ser confundida com uma vigência derivada.

## 9. Executar os demais cenários de RH

| Teste | Resultado esperado |
| --- | --- |
| Desistência da pré-admissão | Vínculo `CANCELLED`, sem desligamento inventado. |
| Desligamento | Cadastro inativo, com a data informada pelo RH. |
| Recontratação | Mesma pessoa, novo vínculo, sem duplicar o colaborador. |
| Correção de vínculo antigo | Não substitui o vínculo atual da recontratação. |
| Troca de cargo | Cargo e histórico atualizados corretamente. |
| Salário com vigência futura | Considerado somente a partir da vigência. |
| Correção ou cancelamento salarial | Atualiza somente os dados pertencentes à integração. |
| Conformidade com vencimento | Válida até o vencimento e vencida na consulta posterior. |
| Conformidade revogada | Exibida como revogada. |

Para conferir conformidade, selecionar a linha do colaborador e consultar o painel **Conformidade do RH**, alterando a data de referência.

## 10. Habilitar e testar a carga inicial e a recuperação

Agora, configurar `CONECTA_RH_API_URL` e `CONECTA_RH_READ_TOKEN` no backend e reiniciar o worker.

Ele executa uma carga inicial consistente — o snapshot — e depois consulta as alterações posteriores — o feed. A rotina roda na inicialização e a cada cinco minutos.

**Resultado esperado:** os cadastros já recebidos continuam únicos, e os demais dados publicados pelo Conecta são importados.

Com o envio automático do Conecta ainda desligado, alterar um cadastro na origem. A alteração deve chegar ao FiltroAPP pela leitura do feed.

## 11. Testar recusas e recuperação de erros

O desenvolvedor deve executar também estes testes controlados:

| Situação | Resultado esperado |
| --- | --- |
| Token inválido | `401`. |
| Empresa diferente da configurada | `403`. |
| Salário sem permissão salarial | `403`. |
| Mesmo evento com conteúdo diferente | `409`. |
| Ativação sem admissão oficial | Erro de validação. |
| Vínculo recebido antes do cargo | `PENDING`; após receber o cargo, passa para `APPLIED`. |

Registrar `requestId`, `receiptId`, resultado esperado e resultado obtido para facilitar a investigação.

## 12. Ligar o envio automático e aprovar

Após os testes anteriores, o desenvolvedor liga o envio automático do Conecta. Fazer uma nova alteração na origem e conferir:

- O Conecta realizou o envio.
- O FiltroAPP devolveu o recibo.
- A consulta de status chegou a `APPLIED`.
- A alteração apareceu corretamente no app.
- As consultas de alocações usadas pelo Conecta continuam funcionando.

A homologação pode ser aprovada quando esses cenários passarem, sem duplicação de pessoas, alteração indevida das datas provisórias ou pendências sem explicação.
