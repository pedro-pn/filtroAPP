# Análise de Conformidade LGPD — NewRDO

> **Referência legal:** Lei nº 13.709/2018 (LGPD) — vigência plena desde agosto/2021.
> **Data da análise:** 2026-05-21
> **Branch analisado:** `integration/internal-report-signatures`

---

## 1. Contexto e Escopo

O NewRDO é um SaaS B2B de gestão de relatórios diários de obras (RDO) com módulos de assinatura eletrônica de relatórios (interna e via ZapSign), EPI, romaneio e pesquisa de satisfação. O sistema processa dados pessoais de:

- **Colaboradores internos** (técnicos, coordenadores, gestores) — usuários com conta
- **Colaboradores de campo** (Collaborator) — podem não ter conta no sistema
- **Signatários externos** (clientes) — acessam via link público por e-mail, sem conta
- **Motoristas** — dados registrados em romaneios
- **Destinatários de notificação** — e-mails de romaneio

---

## 2. Inventário de Dados Pessoais (Mapeamento)

### 2.1 Dados identificadores diretos

| Entidade (model) | Campo | Dado | Categoria LGPD |
|---|---|---|---|
| `User` | `name`, `email`, `username`, `passwordHash` | Identificação e autenticação | Pessoal comum |
| `Collaborator` | `name`, `email` | Identificação | Pessoal comum |
| `Collaborator` | `cpf` | CPF do trabalhador | Pessoal comum (identificador único nacional) |
| `Collaborator` | `registrationNumber`, `admissionDate` | Dados laborais | Pessoal comum |
| `Collaborator` | `signatureImage` | Imagem da assinatura manuscrita | **Possivelmente sensível** (biométrico) |
| `Project` | `clientName`, `clientEmailPrimary`, `clientEmailCc`, `clientSigners` | Dados do cliente/signatário externo | Pessoal comum |
| `Romaneio` | `driverName`, `vehiclePlate` | Dados do motorista | Pessoal comum |
| `RomaneioNotificationRecipient` | `name`, `email` | Destinatários de e-mail | Pessoal comum |
| `SatisfactionSurvey` | `emailTo` | E-mail do cliente pesquisado | Pessoal comum |

### 2.2 Dados de rastreio e metadados comportamentais

| Entidade (model) | Campo | Coleta | Armazenamento |
|---|---|---|---|
| `ReportSignature` | `ipAddress`, `userAgent` | No ato da assinatura | Banco de dados, PDF de evidência |
| `EpiSignatureRequest` | `ipAddress`, `userAgent` | No ato da assinatura | Banco de dados, PDF de evidência |
| `EpiSignatureRequestAuditLog` | `ipAddress`, `userAgent` | A cada ação de auditoria | Banco de dados |
| `ClientReportReview` | `ipAddress`, `userAgent` | Na revisão do cliente | Banco de dados |
| `SatisfactionSurvey` | `submittedIp`, `submittedUserAgent` | No envio da pesquisa | Banco de dados |
| `ReportAuditLog` | `ipAddress`, `userAgent` | Em ações de auditoria do relatório | Banco de dados |

### 2.3 Dados de assinatura (pessoais comuns)

| Entidade (model) | Campo | Natureza |
|---|---|---|
| `Collaborator` | `signatureImage` | Rubrica/assinatura digitalizada (base64) |
| `ReportSignature` | `signatureImageDataUrl` | Assinatura coletada no ato (canvas) |
| `EpiRecord` | `signatureImageDataUrl`, `signatureSignerName` | Assinatura na entrega de EPI |
| `EpiSignatureRequest` | `signatureImageDataUrl`, `signatureSignerName` | Assinatura via link público |

> **Posição adotada (2026-05-22):** A assinatura manuscrita digitalizada é tratada como **dado pessoal comum**, não biométrico. O art. 5°, II da LGPD lista "dado biométrico" como sensível, mas o entendimento de mercado (ZapSign, ClickSign, DocuSign) é que uma imagem de assinatura não captura característica biológica única — é um desenho, não uma leitura biométrica. Base legal: execução de contrato (Art. 7°, V). O aviso geral de privacidade cobre a coleta sem necessidade de consentimento específico separado.

---

## 3. Achados — Problemas de Conformidade

### 🔴 BLOCKER — Crítico (risco jurídico imediato)

---

#### B-1: Ausência de aviso de coleta de dados para signatários externos

**Localização:** `frontend/src/pages/PublicSignaturePage.tsx`, `frontend/src/api/publicSignatures.ts`

**Problema:** Signatários externos (clientes que recebem link por e-mail) acessam a página pública de assinatura e submetem nome, imagem de assinatura, IP e User-Agent **sem qualquer aviso** de que esses dados serão coletados, por quanto tempo serão mantidos, qual a finalidade e quem é o controlador dos dados.

**Base legal afetada:** Art. 18 (direitos do titular), Art. 9° (transparência) — o titular tem o direito de ser informado antes do tratamento.

**Impacto real:** A assinatura eletrônica captura:
- Nome declarado (armazenado em `ReportSignature.declaredSignerName` e `signerName`)
- IP público (`ipAddress` gravado no banco e no PDF de evidência — `internal-report-signatures.js:831`)
- User-Agent (`userAgent` gravado no banco e no PDF — linha 833)
- Imagem da assinatura manuscrita (`signatureImageDataUrl` armazenado no banco)

Todos impressos no PDF de evidência final sem o titular ter sido informado.

---

#### B-2: Ausência de aviso de coleta de dados na pesquisa de satisfação

**Localização:** `backend/src/routes/resources/surveys.js`, `SatisfactionSurvey` model

**Problema:** O cliente recebe link de pesquisa de satisfação por e-mail e ao responder, IP e User-Agent são coletados (`submittedIp`, `submittedUserAgent`) sem aviso. As respostas (opiniões sobre o serviço) são armazenadas indefinidamente.

**Base legal afetada:** Art. 9° e Art. 7° — base legal para tratamento não está evidenciada nem comunicada ao titular.

---

#### B-3: Reclassificado — assinatura manuscrita digitalizada como dado pessoal comum

**Localização:** `Collaborator.signatureImage`, `EpiSignatureRequest.signatureImageDataUrl`, `ReportSignature.signatureImageDataUrl`

**Decisão da Fase 0:** A imagem de assinatura manuscrita digitalizada será tratada como dado pessoal comum, não como dado biométrico sensível. Portanto, não será exigido consentimento específico separado. A base legal adotada é execução de contrato (Art. 7°, V), com aviso de privacidade destacado antes da assinatura.

**Impacto na implementação:** O componente de captura foi renomeado para `SignatureDialog.tsx` e não registra consentimento. O sistema registra apenas ciência do aviso (`privacyNoticeAcceptedAt` e `privacyNoticeVersion`).

---

### 🟡 SHOULD FIX — Importante (risco médio, deve ser corrigido antes da escala)

---

#### S-1: Ausência de política de retenção de dados

**Problema:** Não há nenhum mecanismo automático de expiração ou exclusão de dados pessoais no código. Dados coletados ficam indefinidamente no banco:
- Logs de auditoria com IP/UserAgent (`ReportAuditLog`, `EpiSignatureRequestAuditLog`) não têm TTL
- `UserSession` tem `expiresAt` mas sessões expiradas não são removidas automaticamente
- `PasswordResetToken` idem
- PDFs de evidência com dados biométricos ficam no filesystem sem prazo

**Art. 15 LGPD:** O tratamento deve ser encerrado quando a finalidade for alcançada ou o período de tratamento encerrar.

---

#### S-2: Sem mecanismo de exercício de direitos do titular

**Art. 18 LGPD** prevê: acesso, correção, anonimização, portabilidade, eliminação, revogação de consentimento e oposição. O sistema não tem:
- Endpoint de exportação de dados pessoais do titular
- Endpoint de solicitação de exclusão de conta
- Fluxo para cliente externo solicitar seus dados ou exclusão

Única ação disponível é o ADMIN excluir ou desativar usuários manualmente.

---

#### S-3: Dados pessoais de terceiros coletados sem base legal documentada

**Localização:** `Project.clientEmailPrimary`, `Project.clientEmailCc`, `Project.clientSigners` (JSON com nome e e-mail)

**Problema:** E-mails e nomes dos representantes do cliente são cadastrados pelo operador interno da empresa sem que os titulares (os representantes do cliente) sejam informados. A base legal presumida é o legítimo interesse (Art. 7°, IX) ou execução do contrato (Art. 7°, V), mas não está documentada.

---

#### S-4: Dados de motoristas sem base legal comunicada

**Localização:** `Romaneio.driverName`, `Romaneio.vehiclePlate`

**Problema:** Nome do motorista e placa do veículo são dados pessoais. Motoristas não são usuários do sistema e não são informados sobre o tratamento de seus dados. Base legal (execução do contrato logístico) existe, mas não está documentada e o titular não é informado.

---

#### S-5: Ausência de DPA (Data Processing Agreement) com operadores externos

**Operadores identificados:**
- Serviço de e-mail (mailer configurado via ENV — `mailer.js`) — processa e-mails dos titulares
- **ZapSign** — processa documentos com dados pessoais e assinaturas (integração via `zapsign.js`)
- Serviço de armazenamento de arquivos (filesystem local ou remoto)

**Art. 37 LGPD:** O controlador deve manter registro das operações de tratamento. O operador deve oferecer garantias suficientes de conformidade.

---

#### S-6: IP e User-Agent coletados sem aviso no contexto de auditoria interna

**Localização:** `ClientReportReview`, `ReportAuditLog` — coletados de usuários autenticados internos

**Problema:** Mesmo usuários internos (colaboradores, gestores) têm IP e User-Agent registrados em logs de auditoria. Os termos de uso/contrato de trabalho deveriam mencionar esse monitoramento. Não há evidência no sistema de que isso é comunicado.

---

### 🔵 NICE TO HAVE — Boas práticas (conformidade plena)

#### N-1: Sem registro de atividades de tratamento (ROPA)
Empresas com tratamento de dados em larga escala devem manter Registro de Operações de Tratamento (Art. 37). O documento não existe.

#### N-2: Sem DPO (Encarregado de Dados) identificado no sistema
Art. 41 exige indicação do encarregado quando aplicável. Nenhum campo ou tela indica contato do DPO/Encarregado.

#### N-3: Logs de timing expõem metadados de operação
`console.log('[TIMING] ...')` em `reports.js` linhas 3288, 3708, 3903, 4150 — não expõem dados pessoais diretamente, mas em ambientes com log centralizado poderiam ser cruzados. Monitorar para não expandir.

---

## 4. Conciliação: Documentos Legais vs. Obrigação de Exclusão (Art. 16 LGPD)

Existe uma tensão aparente entre a LGPD (que exige encerramento do tratamento após a finalidade — art. 15) e a necessidade de manter relatórios assinados como garantia jurídica. A própria lei resolve isso.

### 4.1 A exceção do art. 16, I

> *"Os dados pessoais serão eliminados após o término de seu tratamento, facultada a conservação para: **I — cumprimento de obrigação legal ou regulatória pelo controlador**."*

Complementado pelo art. 7°, VI, que permite o tratamento para:

> *"exercício regular de direitos em processo judicial, administrativo ou arbitral."*

**Conclusão:** se há obrigação legal de guardar o documento, a LGPD não obriga a apagar. O PDF de evidência de assinatura se enquadra diretamente nessa exceção.

---

### 4.2 Duas camadas de dado — regras diferentes

A distinção central é entre o **instrumento jurídico** e os **dados operacionais do sistema**:

#### Camada 1 — Documento legal (permanece pelo prazo legal)

O PDF de evidência com nome, assinatura, IP e User-Agent **é o próprio instrumento jurídico**. Também os campos no banco que compõem essa evidência (`ReportSignature.signerName`, `.ipAddress`, `.signatureImageDataUrl`, `.signerEmail`) são parte da prova de validade da assinatura e devem ser mantidos.

| Tipo de documento | Prazo mínimo de retenção | Base legal |
|---|---|---|
| Relatório com assinatura de prestação de serviço | 5 anos | Código Civil, art. 206, §5°, I (prescrição de ação) |
| Documento trabalhista — EPI assinado | 20 anos | NR-1/Portarias MTE; entendimento consolidado TST |
| Relatório técnico de obra (RDO/RTP) | 10 anos (conforme contrato) | Lei de Licitações nº 14.133/2021, normas ABNT |
| Pesquisa de satisfação (respostas) | 2 anos após resposta | Legítimo interesse para gestão de qualidade |

> **Ação:** esses prazos devem ser declarados na Política de Privacidade. Os PDFs e os campos de evidência no banco não precisam ser alterados.

#### Camada 2 — Dados operacionais (esses expiram)

Dados que **não integram o documento legal** e existem apenas para operação do sistema:

| Dado (model / campo) | Situação atual | Retenção proposta | Ação |
|---|---|---|---|
| `UserSession` — tokens de sessão | Indefinida | Apagar quando `expiresAt < now()` | Job periódico |
| `PasswordResetToken` — tokens de reset | Indefinida | Apagar quando `expiresAt < now()` | Job periódico |
| `ReportAuditLog` — `ipAddress`, `userAgent` | Indefinida | Anonimizar IP após 2 anos (manter a ação registrada) | Job periódico |
| `EpiSignatureRequestAuditLog` — `ipAddress`, `userAgent` | Indefinida | Anonimizar IP após 2 anos | Job periódico |
| `SatisfactionSurvey` — `submittedIp`, `submittedUserAgent` | Indefinida | Anonimizar após resposta + 1 ano | Job periódico |
| `ReportDraft` — rascunhos abandonados | Indefinida | Revisar após 6 meses sem edição; exclusão somente por rotina operacional explícita | Dry-run/execução manual controlada |

> **Importante:** "anonimizar IP" significa substituir o valor por `null` ou `"[anonimizado]"` no banco — não exclui o registro de auditoria, apenas remove o dado identificador. O log de *que* ação aconteceu permanece.

---

### 4.3 Resumo visual — o que expira vs. o que permanece

```
PDF de evidência assinado
├── Nome do signatário          → PERMANECE (prazo legal do documento)
├── Imagem da assinatura        → PERMANECE (prazo legal do documento)
├── IP e User-Agent impressos   → PERMANECE (faz parte da evidência)
└── Hash do documento           → PERMANECE (integridade do arquivo)

Banco de dados — ReportSignature
├── signerName, signerEmail     → PERMANECE (evidência)
├── ipAddress, userAgent        → PERMANECE (evidência da assinatura)
└── signatureImageDataUrl       → PERMANECE (evidência)

Banco de dados — dados operacionais
├── UserSession.tokenHash       → EXPIRA (token de sessão)
├── PasswordResetToken          → EXPIRA (token temporário)
├── ReportAuditLog.ipAddress    → ANONIMIZA após 2 anos
└── SatisfactionSurvey.submittedIp → ANONIMIZA após 2 ano
```

---

## 5. Checklist de Implementação

Legenda: `[ ]` pendente, `[x]` concluído. Manter este checklist no repositório e marcar somente após implementação, revisão e validação mínima em ambiente de homologação.

### Fase 0 — Preparação jurídica e operacional — ~1–2 dias

#### 0.1 Definições obrigatórias antes de codar

- [x] Definir o controlador dos dados que aparecerá nos avisos e na política de privacidade.
  > **Decisão (2026-05-22):** Filtrovali Serviços de Filtragem de Óleos Industriais e Limpeza de Tubulações Ltda. A Filtrovali é o controlador do SaaS; empresas-clientes são operadoras dos dados de seus próprios colaboradores.
- [x] Definir o contato do Encarregado/DPO ou, no mínimo, o canal oficial de privacidade.
  > **Decisão (2026-05-22):** privacidade@filtrovali.com.br (alias redirecionado para pedro.paulo@filtrovali.com.br).
- [x] Validar com jurídico/gestão as bases legais por categoria da Seção 7.
  > **Decisão (2026-05-22):** Bases legais confirmadas conforme Seção 7. Pesquisa de satisfação: legítimo interesse (Art. 7°, IX). Assinatura manuscrita: dado pessoal comum (execução de contrato), não sensível/biométrico — ver item abaixo.
- [x] Definir a versão inicial dos textos legais.
  > **Decisão (2026-05-22):** Três avisos aprovados — ver Seção 0.2 abaixo.
- [x] Confirmar os prazos de retenção da Seção 4 para RDO, EPI, pesquisas, logs e rascunhos.
  > **Decisão (2026-05-22):** Prazos confirmados conforme Seção 4 sem alteração.
- [x] Definir se assinatura manuscrita digitalizada será tratada como dado sensível por política interna conservadora.
  > **Decisão (2026-05-22):** Postura menos conservadora — dado pessoal comum, não biométrico. Alinhado com a prática de mercado (ZapSign, ClickSign, DocuSign). Imagem de assinatura tratada como dado de execução de contrato (Art. 7°, V), sem exigência de consentimento específico separado. O aviso geral de privacidade cobre a coleta.

**Critério de aceite:** textos, bases legais, controlador, canal de contato e prazos aprovados antes das alterações de interface e banco.

---

#### 0.2 Textos aprovados dos avisos de privacidade

##### `signature_rdo_v1` — Aviso de privacidade na assinatura pública de RDO

> Ao assinar este relatório, os seguintes dados serão coletados e armazenados como evidência jurídica da assinatura:
> - Seu nome declarado
> - Imagem da sua assinatura manuscrita
> - Endereço IP e informações do seu navegador/dispositivo
>
> **Finalidade:** comprovar a autenticidade e validade jurídica da assinatura deste documento.
> **Base legal:** execução de contrato (Lei 13.709/2018, Art. 7°, V).
> **Retenção:** esses dados integram o documento assinado e serão mantidos por 5 anos, conforme o Código Civil (art. 206, §5°, I).
> **Controlador:** Filtrovali Serviços de Filtragem de Óleos Industriais e Limpeza de Tubulações Ltda — privacidade@filtrovali.com.br

##### `signature_epi_v1` — Aviso de privacidade na assinatura pública de EPI

> Ao assinar o recebimento deste EPI, os seguintes dados serão coletados e armazenados como evidência do registro trabalhista:
> - Seu nome declarado
> - Imagem da sua assinatura manuscrita
> - Endereço IP e informações do seu navegador/dispositivo
>
> **Finalidade:** registro obrigatório de entrega de equipamento de proteção individual.
> **Base legal:** execução de contrato de trabalho (Lei 13.709/2018, Art. 7°, V).
> **Retenção:** 20 anos, conforme NR-1 e entendimento consolidado do TST.
> **Controlador:** Filtrovali Serviços de Filtragem de Óleos Industriais e Limpeza de Tubulações Ltda — privacidade@filtrovali.com.br

##### `survey_notice_v1` — Aviso de privacidade na pesquisa de satisfação

> Ao responder esta pesquisa, os seguintes dados serão coletados:
> - Seu e-mail (utilizado para envio da pesquisa)
> - Suas respostas e comentários
> - Endereço IP e informações do seu navegador/dispositivo
>
> **Finalidade:** gestão de qualidade e melhoria do serviço prestado.
> **Base legal:** legítimo interesse do controlador (Lei 13.709/2018, Art. 7°, IX).
> **Retenção:** respostas mantidas por 2 anos; IP e dados do dispositivo anonimizados após 1 ano.
> **Controlador:** Filtrovali Serviços de Filtragem de Óleos Industriais e Limpeza de Tubulações Ltda — privacidade@filtrovali.com.br

---

### Fase 1 — Urgente (antes de nova contratação/escala) — ~2–3 semanas

#### 1.1 Aviso de privacidade na assinatura pública de RDO e EPI

**Arquivos prováveis:**
- `frontend/src/pages/PublicSignaturePage.tsx`
- `frontend/src/pages/epi/EpiPublicSignaturePage.tsx`
- `frontend/src/api/publicSignatures.ts`
- `frontend/src/api/epi.ts`

**Checklist:**
- [x] Criar componente reutilizável de aviso (`frontend/src/components/privacy/PrivacyNotice.tsx`).
- [x] Exibir o aviso antes da captura da assinatura no fluxo público de RDO.
- [x] Exibir o aviso antes da captura da assinatura no fluxo público de EPI.
- [x] Informar no aviso: controlador, canal do encarregado, dados coletados, finalidade, base legal, retenção, compartilhamento com operadores e direitos do titular.
- [x] Informar explicitamente que IP, User-Agent, nome declarado e imagem da assinatura podem compor evidência da assinatura.
- [x] Adicionar link para `/privacidade` quando a página de política existir; enquanto isso, exibir o texto completo no próprio aviso.
- [x] Bloquear o botão de assinatura até o titular reconhecer ciência do aviso ou aceitar o termo aplicável.
- [x] Registrar no payload/API a versão do aviso/termo aceito quando houver alteração de schema.

**Critério de aceite:** nenhum fluxo público permite capturar assinatura sem aviso visível e rastreável antes do envio.

#### 1.2 Aviso de privacidade na pesquisa de satisfação

**Arquivos prováveis:**
- `frontend/src/pages/SurveyPage.tsx`
- `backend/src/routes/resources/surveys.js`
- `backend/src/lib/email-templates.js`
- `backend/src/lib/survey-mail.js`

**Checklist:**
- [x] Adicionar aviso LGPD visível na página `/pesquisa/:token`.
- [x] Informar dados tratados: e-mail de destino, projeto relacionado, respostas, IP, User-Agent, datas de envio/resposta e opt-out de lembretes.
- [x] Informar finalidade: gestão de qualidade, melhoria de serviço e acompanhamento do cliente.
- [x] Informar retenção: respostas por 2 anos e anonimização de IP/User-Agent após resposta + 1 ano, salvo decisão jurídica diferente.
- [x] Adicionar link ou texto resumido de privacidade nos e-mails de convite e lembrete.
- [x] Garantir que o envio da pesquisa só ocorre após o aviso estar visível antes do botão de envio.

**Critério de aceite:** o respondente visualiza finalidade, dados coletados e retenção antes de enviar respostas.

#### 1.3 Ciência para captura de assinatura manuscrita digitalizada

**Arquivos prováveis:**
- `backend/prisma/schema.prisma`
- `frontend/src/components/reports/SignatureDialog.tsx`
- `frontend/src/pages/PublicSignaturePage.tsx`
- `frontend/src/pages/epi/EpiPublicSignaturePage.tsx`
- telas de cadastro/edição de `Collaborator`

**Checklist:**
- [x] Definir juridicamente a base legal aplicável: assinatura manuscrita digitalizada será tratada como dado pessoal comum, com base em execução de contrato, sem consentimento específico separado.
- [x] Adicionar campos de rastreio no schema para ciência do aviso, no mínimo versão e data.
- [x] Para `Collaborator.signatureImage`, manter a assinatura-base quando necessária para PDFs/relatórios e registrar ciência do aviso:
  - [x] `signatureNoticeAcceptedAt`
  - [x] `signatureNoticeVersion`
- [x] Para assinaturas públicas, avaliar campos equivalentes em `ReportSignature` e `EpiSignatureRequest`, por exemplo:
  - [x] `privacyNoticeAcceptedAt`
  - [x] `privacyNoticeVersion`
- [x] Criar migração Prisma.
- [x] Atualizar APIs para gravar versão/data do aviso.
- [x] Atualizar UI para exigir aceite destacado antes de capturar ou enviar assinatura.
- [x] Decisão técnica: não remover a assinatura-base do colaborador neste momento, pois ela ainda é usada na composição de documentos; remover apenas quando o fluxo deixar de depender dela.
- [x] Registrar em log administrativo quando a ciência do aviso for concedida ou atualizada.
- [x] Adicionar testes de backend para gravação dos campos de aceite/ciência.

**Critério de aceite:** cada imagem de assinatura nova possui base legal/ciência documentada por versão e timestamp.

#### 1.4 Aceite de privacidade no primeiro login da conta do cliente

**Decisão:** clientes autenticados, tanto conta principal por CNPJ quanto assinantes secundários por e-mail, não devem receber o aviso de coleta de dados no ato da assinatura dentro do painel. Em vez disso, o aceite do termo de privacidade deve ocorrer no primeiro login da conta do cliente, antes de liberar qualquer área autenticada do app.

**Arquivos prováveis:**
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/*_add_client_privacy_policy_acceptance/migration.sql`
- `backend/src/lib/privacy-consent.js`
- `backend/src/lib/auth.js`
- `backend/src/middleware/auth.js`
- `backend/src/routes/resources/auth.js`
- `frontend/src/auth/PrivateRoute.tsx`
- `frontend/src/auth/RoleRoute.tsx`
- `frontend/src/pages/client/ClientPrivacyConsentPage.tsx`
- `frontend/src/components/privacy/PrivacyNotice.tsx`
- `frontend/src/api/auth.ts`
- `frontend/src/types/auth.ts`

**Checklist:**
- [x] Definir versão do termo de privacidade da conta do cliente (`client_account_privacy_v1`).
- [x] Adicionar campos em `User` para versão/data do aceite.
- [x] Criar endpoint autenticado para registrar o aceite.
- [x] Expor no usuário autenticado se o aceite da versão atual está pendente.
- [x] Bloquear rotas autenticadas de cliente enquanto a versão atual não estiver aceita.
- [x] Exibir tela obrigatória no primeiro login do cliente antes de liberar o painel.
- [x] Permitir logout sem aceite.
- [x] Remover exigência de aviso LGPD no modal de assinatura autenticado do cliente.

**Critério de aceite:** conta de cliente sem aceite da versão vigente só consegue ver a tela do termo ou sair; após aceitar, o app libera o painel normalmente.

---

### Fase 2 — Importante (próximo sprint) — ~1–2 semanas

#### 2.1 Política de privacidade acessível no sistema

> **Atualização (2026-05-22):** o aceite obrigatório para contas de cliente foi antecipado para a Fase 1.4. Esta fase permanece responsável pela página pública completa `/privacidade` e pela manutenção/versionamento formal da política.

**Arquivos prováveis:**
- `frontend/src/App.tsx`
- nova página `frontend/src/pages/PrivacyPage.tsx`
- páginas públicas de assinatura, pesquisa e login

**Checklist:**
- [x] Criar rota pública `/privacidade`.
- [x] Incluir política com inventário de dados, finalidades, bases legais, retenção, direitos do titular, contato do encarregado e operadores externos.
- [x] Incluir seção específica sobre assinatura eletrônica e evidências legais.
- [x] Incluir seção específica sobre pesquisa de satisfação.
- [x] Incluir seção específica sobre romaneio, motoristas e destinatários de notificação.
- [x] Incluir seção específica sobre logs de auditoria, IP e User-Agent.
- [x] Adicionar link visível para `/privacidade` no login, assinatura pública de RDO, assinatura pública de EPI e pesquisa.
- [x] Versionar a política com data de vigência.

**Critério de aceite:** titulares conseguem acessar a política sem login a partir de todas as páginas públicas que coletam dados.

#### 2.2 Canal de exercício de direitos do titular

**Arquivos prováveis:**
- nova página `frontend/src/pages/PrivacyRightsPage.tsx`
- nova rota backend, por exemplo `backend/src/routes/resources/privacy.js`
- `backend/prisma/schema.prisma`
- área administrativa para triagem, se aplicável

**Checklist:**
- [x] Criar rota pública `/privacidade/direitos` ou publicar e-mail/canal dedicado na política.
- [x] Criar formulário para solicitação de confirmação, acesso, correção, anonimização, eliminação, portabilidade, informação e revogação de consentimento.
- [x] Criar model `DataSubjectRequest` se a triagem for feita no sistema.
- [x] Registrar protocolo, tipo da solicitação, identificação do titular, status, responsável, prazo e histórico de atendimento.
- [x] Criar endpoint autenticado `GET /api/privacy/me/data-export` para exportação de dados do usuário interno.
- [x] Criar endpoint autenticado `POST /api/privacy/me/delete-request` para solicitação de exclusão/análise manual.
- [x] Criar procedimento manual para titulares externos que não possuem conta.
- [x] Garantir que pedidos de eliminação respeitem a exceção de retenção de documentos legais da Seção 4.
- [x] Adicionar testes de permissão e escopo para exportação de dados.

**Critério de aceite:** existe um canal documentado e auditável para receber, rastrear e responder pedidos do Art. 18.

#### 2.3 Política de retenção de dados e limpeza automática

**Arquivos prováveis:**
- `backend/src/server.js`
- novo `backend/src/lib/data-retention.js`
- `backend/prisma/schema.prisma`
- testes de backend

**Regra geral:** dados que integram documentos legais assinados **não são deletados** — são retidos pelo prazo legal (ver Seção 4). Apenas dados operacionais são limpos ou anonimizados.

**Checklist:**
- [x] Criar job periódico de retenção, seguindo o padrão de `startSurveyReminderJob()` e `startLegacyZapSignReconciliationJob()`.
- [x] Registrar o job em `backend/src/server.js`.
- [x] Deletar `UserSession` com `expiresAt < now()`.
- [x] Deletar `PasswordResetToken` com `expiresAt < now()`.
- [x] Anonimizar `ReportAuditLog.ipAddress` e `ReportAuditLog.userAgent` após 2 anos.
- [x] Anonimizar `EpiSignatureRequestAuditLog.ipAddress` e `EpiSignatureRequestAuditLog.userAgent` após 2 anos.
- [x] Anonimizar `SatisfactionSurvey.submittedIp` e `SatisfactionSurvey.submittedUserAgent` após resposta + 1 ano.
- [x] Não deletar `ReportDraft` no job automático; apenas contabilizar rascunhos antigos no dry-run.
- [x] Manter exclusão de `ReportDraft` atrás de execução operacional explícita (`npm run retention:apply -- --delete-abandoned-drafts`), com backup e janela controlada.
- [x] Não alterar `ReportSignature`, `EpiSignatureRequest`, `EpiRecord` nem PDFs de evidência no job automático.
- [x] Criar logs operacionais sem expor dados pessoais.
- [x] Criar testes unitários/integrados para cada regra de retenção.
- [x] Documentar como executar o job manualmente em homologação/produção.

**Execução manual:** em homologação/produção, executar `npm run retention:dry-run` para contagens e `npm run retention:apply` para aplicar anonimização/limpeza não destrutiva. Para excluir rascunhos antigos, usar somente execução operacional explícita com backup: `npm run retention:apply -- --delete-abandoned-drafts`.

**Critério de aceite:** dados operacionais expiráveis são removidos ou anonimizados automaticamente sem afetar evidências legais.

#### 2.4 Bases legais documentadas para terceiros e auditoria interna

**Checklist:**
- [x] Documentar na política a base legal para representantes de clientes em `Project.clientEmailPrimary`, `Project.clientEmailCc` e `Project.clientSigners`.
- [x] Documentar na política a base legal para motoristas em `Romaneio.driverName` e `Romaneio.vehiclePlate`.
- [x] Documentar nos termos internos ou política de colaboradores o uso de IP/User-Agent em logs de auditoria.
- [x] Atualizar e-mails transacionais para apontarem o canal de privacidade quando envolverem titulares externos.
- [x] Revisar textos contratuais/comerciais para prever tratamento de dados de representantes, motoristas e destinatários.

**Critério de aceite:** dados de terceiros e auditoria interna possuem finalidade, base legal e canal de informação documentados.

---

### Fase 3 — Conformidade plena (roadmap) — ~2–4 semanas

#### 3.1 Registro de Atividades de Tratamento (ROPA)

**Checklist:**
- [x] Criar documento interno de ROPA com categoria de dado, finalidade, base legal, retenção, operador, sistema, responsável interno e medidas de segurança.
- [x] Usar o inventário da Seção 2 como ponto de partida.
- [x] Incluir fluxos de RDO, EPI, romaneio, pesquisa de satisfação, usuários internos e notificações.
- [x] Definir rotina de revisão trimestral ou semestral.

**Critério de aceite:** existe ROPA versionado e revisável para as principais operações de tratamento.

#### 3.2 DPA com operadores externos

**Checklist:**
- [x] Identificar provedor real de e-mail usado em produção: Microsoft Exchange/Microsoft365.
- [ ] Registrar evidência do DPA Microsoft no repositório documental da empresa.
- [x] ZapSign: não aplicável para novas assinaturas; revisar/remover menções legadas se não houver uso operacional.
- [ ] Documentar Microsoft como operador externo no ROPA.
- [ ] Registrar evidências contratuais fora do código-fonte.

**Critério de aceite:** operadores externos críticos possuem documentação contratual ou evidência formal de conformidade.

#### 3.3 Indicação do Encarregado de Dados (DPO)

**Checklist:**
- [x] Definir internamente o encarregado ou canal responsável por privacidade.
- [x] Publicar nome/canal de contato na política de privacidade.
- [x] Garantir que avisos públicos apontem para o mesmo canal.
- [x] Definir procedimento de resposta a titulares e incidentes em `LGPD_PROCEDIMENTO_TITULARES_INCIDENTES.md`.

**Critério de aceite:** titulares têm canal claro de comunicação com o controlador.

#### 3.4 Anonimização de dados históricos existentes

**Checklist:**
- [ ] Fazer backup antes de qualquer anonimização histórica.
- [x] Criar modo de levantamento de volume de registros antigos via `npm run retention:dry-run` no backend.
- [x] Criar script idempotente para anonimizar registros acima dos prazos definidos via `npm run retention:apply` no backend.
- [ ] Executar primeiro em homologação e comparar contagens antes/depois.
- [ ] Executar em produção em janela controlada.
- [ ] Registrar evidência da execução e da regra aplicada.
- [ ] Manter PDFs de evidência existentes salvo decisão jurídica expressa em contrário.

**Critério de aceite:** histórico operacional antigo é anonimizado sem perda de rastreabilidade essencial.

#### 3.5 Verificação final de implementação

**Checklist:**
- [x] Rodar testes automatizados de backend.
- [x] Rodar build do frontend.
- [x] Validar job de retenção com dados de teste.
- [x] Revisar se nenhum aviso ou política promete exclusão de documentos que devem permanecer por obrigação legal ou exercício regular de direitos.
- [x] Atualizar este documento marcando os itens concluídos.

---

## 6. Testes Manuais Pendentes

Esta seção concentra os testes manuais que dependem de ambiente, perfis de usuário, tokens públicos ou validação visual em navegador.

### 6.1 Assinatura pública de RDO

- [X] Validar manualmente assinatura pública de RDO em desktop.
- [X] Validar manualmente assinatura pública de RDO em mobile.

**Como testar:**
1. Gerar ou obter um link público válido de assinatura de RDO.
2. Abrir o link em navegador desktop.
3. Confirmar que o aviso de privacidade aparece antes da captura/envio da assinatura.
4. Confirmar que o botão de assinatura fica bloqueado enquanto o checkbox de ciência não estiver marcado.
5. Marcar o checkbox, assinar e enviar.
6. Confirmar que a assinatura é concluída e que a evidência registra a versão do aviso.
7. Repetir o mesmo fluxo em viewport mobile ou navegador de celular.

### 6.2 Assinatura pública de EPI

- [X] Validar manualmente assinatura pública de EPI em desktop.
- [X] Validar manualmente assinatura pública de EPI em mobile.

**Como testar:**
1. Gerar ou obter um link público válido de assinatura de EPI.
2. Abrir o link em navegador desktop.
3. Confirmar que o aviso de privacidade aparece antes da captura/envio da assinatura.
4. Confirmar que o botão de confirmação fica bloqueado enquanto o checkbox de ciência não estiver marcado.
5. Marcar o checkbox, assinar e enviar.
6. Confirmar que a assinatura é concluída e que a evidência registra a versão do aviso.
7. Repetir o mesmo fluxo em viewport mobile ou navegador de celular.

### 6.3 Pesquisa de satisfação

- [x] Testar pesquisa válida.
- [x] Testar pesquisa expirada.
- [x] Testar pesquisa já respondida.
- [x] Testar opt-out de lembrete.

**Como testar:**
1. Abrir um link válido de pesquisa em `/pesquisa/:token`.
2. Confirmar que o aviso de privacidade aparece antes do envio das respostas.
3. Confirmar que o envio fica bloqueado enquanto o checkbox de ciência não estiver marcado.
4. Marcar o checkbox, responder e enviar a pesquisa.
5. Reabrir o mesmo link e confirmar que o estado de "já respondida" é exibido sem permitir novo envio.
6. Abrir ou gerar um token expirado e confirmar que o estado de expiração é exibido sem formulário ativo.
7. Acionar o opt-out pelo link de lembrete e confirmar que lembretes futuros ficam bloqueados para aquela pesquisa.

### 6.4 Primeiro login de conta de cliente

- [x] Validar manualmente primeiro login de conta principal do cliente.
- [x] Validar manualmente primeiro login de assinante secundário.

**Como testar:**
1. Usar uma conta principal de cliente sem `privacyPolicyVersion` vigente.
2. Fazer login e confirmar que o app redireciona para a tela obrigatória de termo de privacidade.
3. Confirmar que o painel do cliente e demais rotas autenticadas ficam bloqueados antes do aceite.
4. Confirmar que logout funciona sem aceitar o termo.
5. Fazer login novamente, marcar o aceite e continuar.
6. Confirmar que o painel do cliente é liberado e que logins seguintes não exibem o termo novamente para a mesma versão.
7. Repetir o fluxo com uma conta de assinante secundário.

### 6.5 Páginas públicas de privacidade

- [x] Validar acesso público a `/privacidade`.
- [x] Validar acesso público a `/privacidade/direitos`.

**Como testar:**
1. Abrir `/privacidade` sem estar autenticado.
2. Confirmar que a página carrega sem redirecionar para login.
3. Verificar se o controlador, canal de privacidade, bases legais, dados tratados, retenção e direitos do titular estão descritos.
4. Abrir `/privacidade/direitos` sem estar autenticado.
5. Confirmar que a página carrega sem redirecionar para login.
6. Enviar uma solicitação de teste e confirmar que o protocolo é gerado.
7. Entrar com conta administrativa, abrir o Hub, acessar o módulo `Privacidade` e confirmar que a solicitação aparece com protocolo, titular, e-mail, tipo, status e detalhes.
8. Confirmar que os gestores/admins com e-mail cadastrado recebem a notificação da nova solicitação.
9. Responder a solicitação pelo módulo `Privacidade` e confirmar que a resposta chega no e-mail cadastrado na abertura do chamado.
10. Marcar a solicitação como resolvida e como não resolvida, confirmando que o status muda na lista.

---

## 7. Priorização — Quadro Resumo

| # | Item | Risco | Esforço | Fase |
|---|---|---|---|---|
| B-1 | Aviso na assinatura pública | 🔴 Alto | Pequeno | 1 |
| B-2 | Aviso na pesquisa de satisfação | 🔴 Alto | Pequeno | 1 |
| B-3 | Consentimento para assinatura biométrica | 🔴 Alto | Médio | 1 |
| S-1 | Política de retenção + limpeza automática | 🟡 Médio | Médio | 2 |
| S-2 | Canal de direitos do titular | 🟡 Médio | Médio | 2 |
| S-3 | Base legal documentada para dados de clientes | 🟡 Médio | Pequeno (doc) | 2 |
| S-4 | Base legal para dados de motoristas | 🟡 Médio | Pequeno (doc) | 2 |
| S-5 | DPA com ZapSign e mailer | 🟡 Médio | Pequeno (jurídico) | 3 |
| S-6 | Comunicação sobre auditoria a usuários internos | 🟡 Baixo | Pequeno | 2 |
| N-1 | ROPA | 🔵 Baixo | Médio (doc) | 3 |
| N-2 | Indicação do DPO | 🔵 Baixo | Pequeno | 3 |

---

## 8. Bases Legais Sugeridas por Categoria

| Dado | Base legal LGPD | Artigo |
|---|---|---|
| Dados de usuários internos (colaboradores com conta) | Execução de contrato de trabalho | Art. 7°, V |
| Dados de clientes (email, nome para assinatura de relatório) | Execução de contrato | Art. 7°, V |
| IP/UserAgent na assinatura eletrônica | Legítimo interesse (validade jurídica) + Proteção do crédito | Art. 7°, IX |
| Assinatura manuscrita digitalizada | Execução de contrato | Art. 7°, V — tratada como dado pessoal comum (não biométrico), conforme decisão de 2026-05-22 |
| CPF do colaborador | Execução de contrato de trabalho | Art. 7°, V + Art. 11, II, a |
| Dados do motorista no romaneio | Execução de contrato logístico | Art. 7°, V |
| Pesquisa de satisfação | Legítimo interesse | Art. 7°, IX |
| Logs de auditoria (IP/UA de ações internas) | Legítimo interesse (segurança) | Art. 7°, IX |

---

## 9. Referências

- Lei nº 13.709/2018 — LGPD: https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm
- ANPD — Guia Orientativo para Definições dos Agentes de Tratamento: https://www.gov.br/anpd/
- ANPD — Guia de Boas Práticas para Implementação da LGPD
- Resolução CD/ANPD nº 2/2022 — Regulamento de dosimetria e aplicação de sanções administrativas
