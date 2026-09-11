# Outlook / Exchange Online com OAuth2 de aplicação

O backend envia e-mails por SMTP na porta 587, mas autentica com a identidade de uma
aplicação do Microsoft Entra. Não é usada a senha da caixa, App Password, login
interativo ou confirmação MFA durante os envios.

## Pré-requisitos

- Uma conta Microsoft 365 corporativa ou escolar com Exchange Online.
- Uma caixa de correio remetente, por exemplo `no-reply@suaempresa.com.br`.
- Um administrador do Microsoft Entra para registrar a aplicação.
- Um administrador do Exchange Online, membro de `Organization Management`, para
  conceder o acesso SMTP à caixa.

Este procedimento usa o RBAC para Aplicações do Exchange Online, método atual para
restringir a aplicação somente às caixas autorizadas. Não conceda a permissão global
`SMTP.SendAsApp` na tela **API permissions** do Entra quando usar este procedimento:
a função será concedida de forma limitada diretamente no Exchange.

## 1. Registrar a aplicação

1. Acesse o [Centro de administração do Microsoft Entra](https://entra.microsoft.com/).
2. Entre no diretório correto e abra **Identity > Applications > App registrations**.
3. Clique em **New registration**.
4. Use um nome como `FiltroAPP - Envio de e-mails`.
5. Selecione **Accounts in this organizational directory only**.
6. Não configure Redirect URI e conclua em **Register**.
7. Na página **Overview**, copie:
   - **Directory (tenant) ID** para `MICROSOFT_TENANT_ID`;
   - **Application (client) ID** para `MICROSOFT_CLIENT_ID`.

## 2. Criar a credencial da aplicação

1. Na aplicação, abra **Certificates & secrets > Client secrets**.
2. Clique em **New client secret**, dê um nome e defina a validade.
3. Copie imediatamente o campo **Value** para `MICROSOFT_CLIENT_SECRET`.

O valor aparece apenas uma vez. Não use o campo **Secret ID**, não coloque o segredo
no Git e programe sua rotação antes do vencimento. Depois da rotação, basta atualizar
a variável no servidor e reiniciar o backend.

## 3. Copiar o Object ID correto

1. No Entra, abra **Identity > Applications > Enterprise applications**.
2. Localize `FiltroAPP - Envio de e-mails` e abra **Overview**.
3. Copie o **Object ID** dessa *Enterprise application*.

Esse identificador não é o Object ID exibido em **App registrations**. O comando do
Exchange exige o Object ID da entidade de serviço (*Enterprise application*).

## 4. Autorizar somente a caixa remetente no Exchange

Abra o PowerShell com uma conta que pertença ao grupo de funções
`Organization Management` do Exchange e substitua os valores entre `<...>`:

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline -UserPrincipalName <ADMIN_EXCHANGE>

Get-ConnectionInformation |
  Format-List State,UserPrincipalName,Organization,IsEopSession,TokenStatus

Get-Command New-ManagementScope -ErrorAction SilentlyContinue
```

O último comando precisa retornar `New-ManagementScope`. Caso não retorne, confirme
no Centro de Administração do Exchange que a conta conectada pertence a
**Organization Management**, execute `Disconnect-ExchangeOnline -Confirm:$false` e
conecte novamente.

Registre a entidade de serviço no Exchange e guarde o `ObjectId` retornado pelo
próprio Exchange:

```powershell
$AppId = "<MICROSOFT_CLIENT_ID>"
$EnterpriseObjectId = "<ENTERPRISE_APPLICATION_OBJECT_ID>"

New-ServicePrincipal `
  -AppId $AppId `
  -ObjectId $EnterpriseObjectId `
  -DisplayName "FiltroAPP SMTP"

$exchangeServicePrincipal = Get-ServicePrincipal |
  Where-Object { $_.AppId -eq $AppId }

$exchangeServicePrincipal |
  Format-List DisplayName,AppId,ObjectId,Identity
```

Se `New-ServicePrincipal` informar que a entidade já existe, não a crie novamente:
execute apenas o bloco de `Get-ServicePrincipal`. O valor usado nas próximas etapas
é `$exchangeServicePrincipal.ObjectId`, e não o Application/Client ID copiado do
Entra.

Crie um grupo de segurança habilitado para e-mail e adicione diretamente a caixa
remetente. Se já existir um grupo exclusivo para essa finalidade, use-o:

```powershell
New-DistributionGroup -Name "FiltroAPP SMTP Mailboxes" -Type Security
Add-DistributionGroupMember `
  -Identity "FiltroAPP SMTP Mailboxes" `
  -Member <EMAIL_REMETENTE>

$smtpGroup = Get-DistributionGroup -Identity "FiltroAPP SMTP Mailboxes"
New-ManagementScope `
  -Name "FiltroAPP SMTP Scope" `
  -RecipientRestrictionFilter "MemberOfGroup -eq '$($smtpGroup.DistinguishedName)'"

New-ManagementRoleAssignment `
  -Name "FiltroAPP SMTP Send" `
  -Role "Application SMTP.SendAsApp" `
  -App $exchangeServicePrincipal.ObjectId `
  -CustomResourceScope "FiltroAPP SMTP Scope"
```

Habilite o protocolo SMTP autenticado somente na caixa remetente e valide o escopo:

```powershell
Set-CASMailbox `
  -Identity <EMAIL_REMETENTE> `
  -SmtpClientAuthenticationDisabled $false

Test-ServicePrincipalAuthorization `
  -Identity $exchangeServicePrincipal.ObjectId `
  -Resource <EMAIL_REMETENTE> |
  Format-Table
```

O teste deve listar `Application SMTP.SendAsApp` com `InScope` igual a `True`. A
Microsoft informa que alterações de autorização podem levar de 30 minutos a 2 horas
para refletir nos acessos reais, embora o comando de teste ignore esse cache.

Se o tenant usa **Security Defaults**, confirme a política com o administrador antes
de continuar: a Microsoft informa que esse recurso desabilita SMTP AUTH. Não desative
uma proteção do tenant sem uma política de Acesso Condicional equivalente e aprovação
do responsável de segurança.

## 5. Configurar o backend

No arquivo de ambiente usado pelo backend (`backend/.env.production`,
`backend/.env.staging` ou `backend/.env`), configure:

```dotenv
SMTP_HOST="smtp.office365.com"
SMTP_PORT=587
SMTP_SECURE=false
SMTP_AUTH_MODE="oauth2"
SMTP_USER="no-reply@suaempresa.com.br"
SMTP_FROM="Filtrovali <no-reply@suaempresa.com.br>"

MICROSOFT_TENANT_ID="00000000-0000-0000-0000-000000000000"
MICROSOFT_CLIENT_ID="00000000-0000-0000-0000-000000000000"
MICROSOFT_CLIENT_SECRET="valor-do-segredo"

SMTP_TEST_DEST="seu-email@suaempresa.com.br"
```

`SMTP_USER` deve ser a caixa incluída no escopo do Exchange. Mantenha o endereço de
`SMTP_FROM` igual ao de `SMTP_USER`, a menos que o administrador tenha concedido uma
permissão de envio adicional.

Reinicie o backend para carregar as variáveis novas. Na instalação Docker de produção:

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate backend
```

## 6. Testar

Dentro do diretório `backend`, execute:

```bash
node scripts/test-email.js
```

O script primeiro valida a autenticação SMTP/XOAUTH2 e depois envia uma mensagem para
`SMTP_TEST_DEST`. Erros `invalid_client`/`AADSTS` indicam tenant, client ID ou segredo;
erros SMTP `535` normalmente indicam autorização RBAC, propagação, caixa fora do grupo
ou SMTP autenticado desabilitado.

## Referências oficiais

- [OAuth para SMTP com credenciais da aplicação](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth)
- [Onboarding SMTP com RBAC para Aplicações](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/smtp-app-rbac-onboarding)
- [RBAC para Aplicações no Exchange Online](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac)
- [Habilitar SMTP autenticado para uma caixa](https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission)
