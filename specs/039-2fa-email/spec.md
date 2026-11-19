# Feature Specification: Verificação em duas etapas por e-mail

**Feature Branch**: `feat/2fa-email-admins`

**Created**: 2026-11-19

**Status**: Implemented (PR em revisão)

**Input**: Auditoria "13 pilares", critério 4.1 (2FA para papéis de risco). Decisões do usuário
em 2026-11-18: obrigatório para administradores e opcional para os demais usuários internos;
código enviado por e-mail (em vez de app autenticador); lembrar o navegador por 30 dias.

## Contexto

O login hoje é só usuário e senha. Uma senha de administrador vazada (reuso, phishing, ataque
distribuído) entrega gestão de contas e credenciais de API. A conta ADMIN é a única que
gerencia contas (`/api/admin/accounts`) e credenciais de API (`/api/admin/api-credentials`),
ambas atrás de `requireHubAdmin` (`accountType === 'ADMIN'`).

**Trade-off aceito**: o segundo fator é a caixa de e-mail. Se ela for comprometida, o 2FA cai
junto; e se o SMTP parar, administradores não entram — por isso há acesso de emergência.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Administrador confirma o login com um código (Priority: P1)

Senha correta de uma conta ADMIN não cria sessão: o sistema envia um código de 6 dígitos ao
e-mail da conta e pede o código numa segunda tela. Só com o código a sessão é criada.

**Acceptance Scenarios**:
1. Senha correta → tela "Verificação em duas etapas" com o e-mail mascarado; nenhuma sessão criada.
2. Código correto → entra; código errado → mensagem genérica; 5 erros → código bloqueado.
3. Código vale 10 min, uma vez só; "Reenviar código" até 3 envios, 30 s entre eles.
4. Senha errada nunca dispara e-mail.
5. ADMIN sem e-mail → mensagem clara pedindo outro admin cadastrar o e-mail; sem sessão.
6. Falha no envio do e-mail → mensagem "não foi possível enviar"; sem sessão.

### User Story 2 - Lembrar este navegador por 30 dias (Priority: P1)

Na tela do código, "Lembrar este navegador por 30 dias" (marcado por padrão) dispensa o código
nos próximos logins daquele navegador e daquela conta.

**Acceptance Scenarios**:
1. Com o navegador lembrado, o login entra sem e-mail até 30 dias depois.
2. O token não vale para outra conta nem depois do prazo.
3. Trocar/redefinir a senha, o admin definir a senha ou desativar a conta, e desligar o 2FA
   removem todos os navegadores lembrados da conta.
4. Em **Minha conta**, o usuário vê e remove navegadores lembrados.

### User Story 3 - Usuário interno ativa o 2FA (Priority: P2)

Contas INTERNAL ativam em **Minha conta** (confirmando com um código) e desativam com a senha
atual. ADMIN não pode desativar. CLIENT não vê a opção.

### User Story 4 - Acesso de emergência (Priority: P1)

Sem SMTP, o operador do servidor libera um login sem código para uma conta
(`scripts/disable-2fa.js --username X`, uso único, 60 min por padrão, registrado) ou desliga o
2FA de todos com `TWO_FACTOR_ENFORCEMENT=off`.

## Requirements *(mandatory)*

- **FR-001**: ADMIN sempre exige o segundo fator (quando `TWO_FACTOR_ENFORCEMENT` não é `off`).
- **FR-002**: INTERNAL exige somente se `twoFactorEnabled`; CLIENT nunca.
- **FR-003**: código, token do desafio e token do navegador lembrado guardados só como hash;
  comparação em tempo constante; tentativa contada de forma atômica antes da comparação.
- **FR-004**: limites — 10 min, 5 tentativas, 3 envios, 30 s entre envios; limites por IP nas
  rotas de verificação e reenvio.
- **FR-005**: cadastro de conta ADMIN sem e-mail é recusado (backend e tela).
- **FR-006**: eventos registrados em `AuthSecurityEvent`: código enviado, verificado, falha,
  2FA ativado/desativado, navegador lembrado, navegadores removidos, emergência e uso dela.
- **FR-007**: retenção — desafios e navegadores vencidos apagados; IP/User-Agent dos eventos
  anonimizados após 2 anos (rotina existente de retenção).
- **FR-008**: homologação sem envio de e-mail fica com o 2FA desligado por padrão.

## Success Criteria

- Nenhum login ADMIN em produção cria sessão sem código, navegador lembrado ou emergência registrada.
- Testes automatizados cobrem regras por papel, ciclo do desafio, limites, navegador lembrado,
  revogação e emergência.
