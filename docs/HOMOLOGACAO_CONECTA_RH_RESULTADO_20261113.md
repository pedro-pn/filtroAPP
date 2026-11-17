# Resultado da homologação de RH no staging em 13/11/2026

**Homologação parcial: o receptor do FiltroAPP foi validado com dados fictícios. O aceite integrado depende dos envios e da API real do CONECTA.** Foram aprovadas 33 verificações no staging e 12 testes automatizados do módulo. Foi identificada uma falha de navegação no calendário, descrita abaixo.

Roteiro: [HOMOLOGACAO_CONECTA_RH.md](HOMOLOGACAO_CONECTA_RH.md). Próxima rodada: [prompt para o desenvolvedor do CONECTA](PROMPT_CONECTA_RH_HOMOLOGACAO_20261113.md).

## Ambiente publicado

| Item | Evidência |
| --- | --- |
| Checkout na VPS | `/root/apps/filtroAPP-staging` |
| Branch e commit | `feat/conecta-rh-integration`, `cc265f0a524c468df174aa87f12481436c0c79e4` |
| URL | `https://filtrostaging.filtrovali.com.br` |
| Migration | `20261113100000_conecta_rh`, aplicada em 13/11/2026 às 15:45:30, horário de São Paulo |
| Serviços | Frontend/Nginx, API e worker reconstruídos a partir desse checkout; os quatro containers do staging, incluindo PostgreSQL, terminaram saudáveis |
| Versão da API e worker | Hash de `src/lib/conecta-rh/service.js` igual ao arquivo do checkout nos dois containers |
| Saúde | `/health` respondeu `200 {"ok":true}` pela URL HTTPS; cabeçalho `X-Environment: staging` confirmado |
| Job `conecta-rh` | Execuções concluídas na inicialização, cinco minutos depois e após reiniciar o worker |
| Alterações na aplicação | Nenhuma alteração de código funcional; publicação e configuração restritas ao staging |

O checkout estava atualizado, mas os containers anteriores ainda não continham o receptor de RH. Antes da publicação foi gerado backup do banco. O backup e os logs de build/migration ficaram em `/root/backups/filtrovali-staging/conecta-rh-20261113/`, na VPS.

## Configuração e cadastros de teste

Como o UUID real ainda não foi fornecido, `CONECTA_RH_COMPANY_ID` recebeu **`83ecb3a8-6c92-4ab9-9e18-9cb1a36a0b13`**, exclusivo desta rodada fictícia. Esse UUID precisa ser substituído pelo da empresa real antes dos envios do CONECTA. `CONECTA_RH_API_URL` e `CONECTA_RH_READ_TOKEN` continuam sem configuração; o worker somente concilia os eventos recebidos.

Foi emitida pelo gerenciamento da API a credencial **Conecta — RH homologação**, em modo `LIVE`, acesso `ALL`, com `rh.conecta.eventos.write` e `rh.conecta.salarios.write`. Identificador: `cmwfbydff00011gmymh05ygop`. Validade: **20/11/2026 às 15:48:36, horário de São Paulo**.

O segredo foi preservado em arquivo `600`, acessível a root na VPS:

```text
/root/backups/filtrovali-staging/conecta-rh-20261113/conecta-homologation/FILTROAPP_RH_TOKEN
```

Entregar esse segredo ao desenvolvedor por canal seguro. Ele não está neste relatório, nas evidências públicas ou no Git. As três credenciais auxiliares, usadas para restrição salarial, simulação e regressão de alocações, foram revogadas.

Os dados mantidos para conferência usam o prefixo **TESTE RH 20261113184836**: três pessoas, dois cargos e um projeto fictício. O vínculo inicial foi desligado e recontratado durante os testes; o estado final da mesma pessoa é uma nova pré-admissão com referência provisória. A outra pessoa inicialmente com admissão futura terminou ativa, com admissão oficial de 08/11/2026. A terceira terminou cancelada. Duas alocações foram confirmadas na missão de teste.

- [Colaboradores de teste no staging](https://filtrostaging.filtrovali.com.br/efetivo?section=colaboradores&date=2026-11-13&search=TESTE%20RH).
- [Projeto de teste em Evolução](https://filtrostaging.filtrovali.com.br/efetivo?section=evolucao&projeto=cmwfbzv4k0000ammyf011vry7).

## Resultado por etapa do roteiro

| Etapa | Resultado obtido |
| --- | --- |
| 1. Preparar ambiente | Concluída: build, migration, publicação e saúde dos serviços. |
| 2. Dados de conexão | Pendente do CONECTA. Configurado somente o UUID fictício para testar o receptor. |
| 3. Token de envio | Emitido e usado com persistência real; falta configurar no backend emissor do CONECTA. |
| 4. Formato dos eventos | Receptor validado. O emissor ainda precisa confirmar IDs/revisões e aceitar `role_change.effectiveDate=null`. |
| 5. Cargo e pré-admissão | Envios sintéticos via HTTPS responderam `202`; consulta autenticada do recibo respondeu `APPLIED`. Também foi testada a ordem invertida, com `PENDING/JOB_ROLE_PENDING` e recuperação após o cargo. |
| 6. Cadastro e reenvios | Conferidos na API, no banco e nas telas: pessoa única, cargo correto, badge, dia do primeiro recebimento em São Paulo e data provisória. Reenvio e nova revisão sem data preservaram a referência. |
| 7. Mobilização | Concluída nas telas desktop e mobile: cancelar não persistiu a alocação; confirmar incluiu na equipe. Ambas as pessoas permaneceram `PRE_ADMISSION`. A API também recusou alocação sem confirmação explícita. |
| 8. Admissão oficial e ativação | Atualizaram a mesma pessoa, removeram o caráter provisório e ajustaram a vigência derivada. Uma vigência expressa pelo RH permaneceu inalterada. Envios foram sintéticos; falta repetir pela origem. |
| 9. Demais cenários | Desistência sem desligamento inventado, desligamento oficial, recontratação sem duplicação, correção antiga sem substituir o vínculo atual, troca de cargo, salário futuro, correção/cancelamento salarial preservando parâmetro manual e conformidade válida/vencida/revogada: aprovados com dados fictícios. |
| 10. Snapshot e feed | Pendente da API real do CONECTA. Os testes automatizados cobriram recuperação com respostas simuladas, inclusive falha parcial e cursor expirado; isso não valida o servidor do CONECTA. |
| 11. Recusas e recuperação | Receptor aprovado: token inválido `401`, outra empresa `403`, salário sem escopo `403`, evento/revisão com corpo divergente `409`, ativação sem admissão `400 VALIDATION_ERROR`, Idempotency-Key ausente/divergente `400`, dependência pendente recuperada. |
| 12. Automação e aceite | Pendente do CONECTA. A rota de consulta de alocações confirmadas respondeu `200` com credencial própria e lista vazia no período; conteúdo e consumo pela origem ainda precisam ser conferidos. |

Também foram confirmados rollback de credencial `SIMULATE` e `Prefer: validate-only` (`200`, sem recibo/cargo persistentes), tratamento de revisão ultrapassada como `SUPERSEDED` e preservação de dados após reiniciar API e worker.

## Ocorrência no FiltroAPP

**Navegação da missão pelo calendário — severidade baixa, com caminho alternativo.** O calendário ainda publica links `/efetivo?section=missoes&missao=...`, mas `missoes` não integra as seções aceitas pelo frontend. A abertura do link exibe a Visão geral em vez da missão.

Reproduzido com a missão `cmwfbzvbk0001ammydtqjur5f`. O emissor do link está em `backend/src/lib/efetivo/planning/calendar.js`, linhas 68, 128 e 145; as seções válidas estão em `frontend/src/utils/planningNavigation.ts`. A mobilização foi homologada pelo projeto na tela **Evolução → Equipe e ciclos**. A correção desse link pertence ao FiltroAPP e não depende do desenvolvedor do CONECTA. Não foi alterada nesta rodada de homologação.

## Evidências e limites do aceite

[Evidência estruturada](evidence/conecta-rh-staging-20261113.json): 33 verificações aprovadas, metadados de 51 requisições do roteiro, `requestId`, `receiptId`, respostas esperadas/observadas e execuções do job. As interações do navegador também foram conferidas no banco. Os envios foram feitos pelo roteiro de homologação, sem participação do servidor do CONECTA.

Capturas:

- [Pré-admissão e conformidade válida](../output/playwright/conecta-staging-20261113/pre-admissao.png).
- [Conformidade vencida](../output/playwright/conecta-staging-20261113/conformidade-vencida.png).
- [Confirmação da mobilização](../output/playwright/conecta-staging-20261113/confirmacao-pre-admissao.png).
- [Confirmação da admissão futura no celular](../output/playwright/conecta-staging-20261113/confirmacao-data-futura-mobile.png).
- [Ativação, recontratação e revogação](../output/playwright/conecta-staging-20261113/ativacao-recontratacao-revogacao.png).
- [Destino incorreto do link do calendário](../output/playwright/conecta-staging-20261113/link-missao-calendario.png).

Os 12 testes de `backend/test/conecta-rh.integration.test.js` passaram após regenerar o Prisma Client local. Esses testes usam PostgreSQL WASM descartável, incluindo a migration real; são complementares às verificações no PostgreSQL da VPS. O roteiro executável e as evidências originais estão na pasta de backup da VPS, junto dos artefatos privados.

O aceite de ponta a ponta exige fornecer o UUID real, autorizar o IP de saída do CONECTA no staging, configurar os dois sentidos da integração, repetir os cenários com envios da origem, validar snapshot/feed reais e somente então ligar o envio automático. O problema de navegação acima deve ser acompanhado separadamente no FiltroAPP.
