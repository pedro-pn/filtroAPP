# Quickstart: Webhook de projetos

## 1. Configurar a credencial

Em cada ambiente, gere e distribua o segredo por canal seguro:

```bash
openssl rand -hex 32
```

Configure o valor resultante como `PROJECT_INTAKE_WEBHOOK_TOKEN`. Enquanto a variável
estiver vazia, o endpoint responde 503 e não cria projetos.

## 2. Enviar um projeto

```bash
curl -X POST 'https://SEU_DOMINIO/api/webhooks/projects' \
  -H 'Authorization: Bearer SEU_TOKEN' \
  -H 'Content-Type: application/json' \
  --data '{
    "code": "005719",
    "name": "Ilha Solteira",
    "clientName": "Cliente Exemplo S.A.",
    "clientCnpj": "12.345.678/0001-90",
    "proposalCode": "3088",
    "revision": 2,
    "location": "Ilha Solteira - SP"
  }'
```

O projeto exibe a proposta como `3088 Rev. 2`. O primeiro envio retorna HTTP 201 com
`status: "created"`. Repetir exatamente os mesmos sete valores retorna HTTP 200 com
`status: "already_exists"`. O mesmo número com algum dado diferente retorna HTTP 409 e
não altera o projeto.

Quando a origem não possuir número de revisão, envie `"revision": -1`. O projeto exibirá
somente a proposta, como `3088`, e a seleção automática procurará a revisão comercial `0`.
O resultado de `commercialRevision` informará `revision: 0`.

`contractCode` não é aceito pelo webhook e resulta em HTTP 400 por ser um campo
desconhecido. A integração deve enviar exclusivamente `proposalCode`.

`commercialRevision.status` informa o resultado da revisão comercial:

- `selected`: revisão encontrada e selecionada automaticamente;
- `already_selected`: a revisão pedida já era a vigente;
- `existing_selection_preserved`: havia outra escolha vigente e ela foi preservada;
- `not_found`: a revisão ainda não existe na base comercial; o projeto foi criado e o
  envio idêntico pode ser repetido depois da importação.

## 3. Revisar no app

Um gestor abre a aba **Projetos**, localiza o contador e a seção **Projetos aguardando
revisão**, confere os seis dados e usa **Revisar cadastro**. Salvar dados válidos confirma
a revisão e libera o projeto para os fluxos normais; excluir remove o cadastro pendente.

## 4. Verificação local segura

Execute as suítes automatizadas e a análise estática sem iniciar servidor ou Docker:

```bash
cd backend && npm test
cd ../frontend && npm test
npm run lint
npm run build
```

Comandos de implantação, migração ou reinício do ambiente devem ser executados pelo
operador responsável conforme a documentação do ambiente. Esta funcionalidade não cria
migração de banco.
