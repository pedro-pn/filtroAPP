# Resultado da conferência do lote 20261116-A

**Homologação parcial: os cenários conferidos passaram, mas a carga inicial e o aceite automático continuam bloqueados por dados de RH e provas ainda pendentes na origem.** Foram aprovadas 28 verificações no staging e 31 testes automatizados. Duas correções do FiltroAPP foram publicadas apenas no staging: inclusão da Engenharia nas equipes, conforme decisão do responsável, e cálculo de conformidade quando a emissão é desconhecida.

Encaminhamento único: [resposta ao desenvolvedor do CONECTA](RESPOSTA_FILTROAPP_CONECTA_LOTE_20261116_A.md). Evidência estruturada: [conferência do lote](evidence/conecta-rh-lote-20261116-A.json).

## Entradas e ambiente

Foram lidos `evidencias-lote-20261116-A.zip`, `RESPOSTA_CONECTA_RH_HOMOLOGACAO_LOTE_20261116.md` e `RESPOSTA_CONECTA_RH_HOMOLOGACAO_ATUALIZACAO_20261116.md`. O ZIP foi extraído em pasta privada para inspeção dos 79 registros de envio, 66 recibos distintos, manifesto e envelopes. Os hashes dos arquivos recebidos constam da evidência estruturada.

A credencial entregue separadamente foi instalada exclusivamente em `backend/.env.staging`, junto de `CONECTA_RH_API_URL=https://gpfiltrovali.netlify.app/api/integracoes/filtroapp/v1`. API e worker foram recriados para carregar a configuração. Nenhum segredo foi incluído nos relatórios ou no Git.

Ambiente: `/root/apps/filtroAPP-staging`, empresa `ca682be5-ab0c-43a8-8a26-d3f7eb1d7526`. Base do checkout: `cc265f0a524c468df174aa87f12481436c0c79e4`, acrescida dos patches locais publicados nesta conferência. Não foram feitos commit, push nem alterações de código/configuração de produção. A consulta das alocações em produção foi somente de leitura.

Foi feito backup do banco antes da conferência. Backups, patches publicados, logs de build, credencial privada e evidências originais ficaram na VPS em `/root/backups/filtrovali-staging/conecta-rh-lote-20261116-A/`.

## Cenários conferidos no FiltroAPP

| Caso | Resultado |
| --- | --- |
| Rastreabilidade do lote | Os 66 recibos correspondem aos eventos/revisões do manifesto. Os envelopes disponíveis dos envios aceitos conferem com o hash persistido pelo receptor. Revisões ultrapassadas estão identificadas sem regressão cadastral. |
| Pessoas/cargos do lote | Onze pessoas e cinco cargos conciliados sem duplicação dos fixtures. |
| P01, P02 e P11 | Pré-admissão sem data preserva a referência inicial e o caráter provisório; P01 conserva revisão 4, sem regressão para a revisão 3 atrasada. |
| P03 | Estado final correto: ativo, admissão 14/11 e histórico em 14/11. O evento de cargo que deveria estar retido já chegou na carga completa; ver limite da prova abaixo. |
| P04 | Admissão 25/10 e vigência expressa do Cargo B em 11/11 preservadas. |
| P05 | Pré-admissão prevista para 26/11, sem marca provisória e sem ativação automática. |
| P06 | Cancelado, inativo, sem data de desligamento inventada. A pendência anterior de cargo futuro não aparece mais no estado final. |
| P08 | Desligado, inativo, admissão em 18/08 e desligamento final em 13/11. O estado final correto não comprova que a revisão intermediária incorreta deixou de ser emitida pela versão nova do CONECTA. |
| P07 | Um único colaborador, vínculo atual ativo desde 16/11; a correção do vínculo antigo para desligamento em 07/11 não substituiu o atual. |
| P09 | Substituição no mesmo dia sem duas atribuições incompatíveis; Cargo A mantido no estado final e histórico preservado. |
| CS1 | Salário fictício 1.500,00 na véspera e 1.650,00 a partir de 01/12. |
| CS2 | Correção/substituição resulta no salário fictício 2.150,00. |
| CS3 | Reajuste futuro cancelado; permanece o salário fictício 3.000,00. |
| Cargo A/B sem salário | Não foram criados perfil salarial nem valor zero pela ausência de evento salarial. |
| P10 | Sete itens únicos: válido até o vencimento inclusive, vencido na consulta seguinte, revogado, sem vencimento, pendente, desconhecido e validade corrigida. Conferidos por serviço, API e tela após a correção. |
| Escrita salarial sem escopo | `403 INSUFFICIENT_SCOPE`, com `requestId`, sem recibo persistido. A credencial auxiliar foi revogada após o teste. Não é necessário criar outra só para repetir este bloqueio. |
| `Prefer: validate-only` | `200` simulado, sem cargo nem recibo persistentes. |
| Mobilização de P01/P05 | Nas telas desktop e mobile, cancelar não gravou; confirmar incluiu na equipe. As duas pessoas permaneceram `PRE_ADMISSION`. A API recusou inclusão sem confirmação explícita. |

As duas alocações foram deixadas na missão fictícia `cmwjmg0zh00018ap351rnqndr`, projeto [ZZZ HOMOLOG RH LOTE 20261116-A Mobilização](https://filtrostaging.filtrovali.com.br/efetivo?section=evolucao&projeto=cmwjmg0wz00008ap37mf2b5lo).

Também foram reproduzidos no PostgreSQL do staging, em transações com rollback: autoalocação sem confirmação, ajuste de vigência derivada, preservação de parâmetros manuais, ambiguidade/resolução de um cadastro fictício e inclusão da Engenharia. Esses testes comprovam o serviço com fixtures controlados; não são apresentados como novos envios do CONECTA nem como alteração dos cadastros reais.

## Correções do FiltroAPP publicadas

### Engenharia

O responsável confirmou que a Engenharia deve participar ativamente das equipes. O receptor passa a definir a atividade local pelo estado do vínculo (`ACTIVE`/`PRE_ADMISSION`), sem usar o setor operacional como motivo para inativação.

Os cargos referenciados pelos vínculos/ocorrências publicados passam a ser elegíveis no Efetivo; um catálogo de cargos sem esses vínculos não é liberado indiscriminadamente. Revisões posteriores do catálogo não retiram essa elegibilidade. A classificação `isOperational=false` permanece intacta nos agregados de origem, e cargos inativos não são reativados por essa regra.

Na base publicada consultada ainda havia **zero vínculos com `isOperational=false`**. A compatibilidade foi comprovada com teste automatizado e reprodução isolada no staging; falta o CONECTA publicar os vínculos reais da Engenharia para conferir sua importação.

### Conformidade com emissão desconhecida

O contrato permite `issuedOn=null`. O FiltroAPP estava transformando itens válidos/vencidos em pendentes por essa ausência, mesmo com validade conhecida ou isenção de vencimento. O cálculo foi corrigido para usar a validade informada, preservar revogação/pendência/estado desconhecido e respeitar emissão futura quando preenchida.

O painel agora mostra NR-06 válido em 16/11 e vencido em 17/11; NR-12 vencido; NR-26 revogado; o item sem vencimento válido; ASO pendente; CNH com validade desconhecida; e NR-33 com vencimento corrigido para 26/12.

Validação automatizada: 19 testes de integração/conformidade de RH e 12 de conflitos, equipes e autoalocação, todos aprovados. Os hashes dos módulos executados no container coincidem com os arquivos locais registrados na evidência. API, worker, Nginx e PostgreSQL terminaram saudáveis; o **job de sincronização RH está em falha**, pelo bloqueio de dados descrito a seguir.

## Bloqueio da carga inicial

A credencial funciona nos cinco recursos da API publicada: 141 cargos, 116 vínculos, 119 ocorrências de cargo, 581 conformidades e 127 salários, com paginação. O snapshot da origem é acessível, mas contém:

```text
employmentId: 9cff896e-e637-42d1-ad26-9c18ae621ec8
revision: 1
status: TERMINATED
admissionDate: null
```

O contrato receptor exige admissão oficial para `TERMINATED`. O worker para nesse evento e **não grava o watermark/cursor como se a carga estivesse concluída**. Foi repetida a tentativa real: não houve duplicação de pessoas nem mudança da referência provisória de P01. A configuração de leitura ficou instalada para a recuperação após a correção da origem.

A ocorrência de cargo `bc01719c-08cb-455e-a1e2-785277b74ac3` permanece em `DEPENDENCY_PENDING` porque seu vínculo foi recusado. A correção deve vir do RH/CONECTA, com admissão oficial e nova revisão/evento, sem fabricar uma data no FiltroAPP.

Não foi possível concluir o snapshot, provar alteração recebida exclusivamente pelo feed, nem aprovar retomada automática real após essa carga. O teste de falha parcial passou; a sincronização completa permanece bloqueada.

## Conciliação cadastral pendente

```text
personId pendente: 4a510bb5-7928-4f0c-84e7-504babb8bdef
employmentId: 101170b1-22aa-4827-9493-80648756c209
registro local encontrado: cmwjkq7nu04wn1gpnm6oedxty
outra pessoa de origem já vinculada: 249d11af-5969-4589-9b17-08b92148c51f
```

Na consulta atual foi encontrado **um candidato pela matrícula 103, com CPF e nome diferentes**, não múltiplos candidatos locais como descrito na resposta recebida. O serviço também classifica identificadores contraditórios como `PERSON_MAPPING_AMBIGUOUS`, corretamente impedindo a associação automática.

Nenhum CPF foi exposto nem alterado, e nenhuma pessoa real foi fundida. O RH precisa confirmar se a matrícula foi reutilizada legitimamente ou se um identificador está incorreto. Confirmada a identidade, pode-se corrigir o cadastro ou definir o vínculo explícito sem unir pessoas distintas. A ocorrência `bf8052c8-c80e-46bf-85bd-ab58288aab78` aguarda esse vínculo.

## Alocações e acesso por IP

A requisição `dfede4bd-3c2d-445f-ae68-475b641dd25f` do relatório de alocações foi localizada **em produção**, não no staging. Ela respondeu `200`, com 35 itens. A credencial tem acesso `ALL`, escopo `efetivo.conferencia.read` e nenhuma restrição de IP. Existem três pessoas com conferência confirmada em produção; o volume não decorre de recorte de projetos da credencial. O staging possui zero linhas confirmadas, coerente com a sanitização da base. Não foram criadas confirmações reais para aumentar artificialmente o volume.

Na configuração efetiva inspecionada, o staging já autoriza `0.0.0.0/0`; a allowlist existe, mas atualmente permite todos os IPv4. O FiltroAPP de produção não tem bloqueio global de IP nas configurações de Nginx/Caddy inspecionadas; credenciais podem ter restrições próprias. A regra de rede encontrada no Caddy pertence ao aplicativo Despesas, não ao FiltroAPP. Nenhuma regra de rede foi alterada nesta conferência.

Portanto, IP dinâmico do Netlify não está bloqueado pela allowlist IPv4 atual do staging. Ainda cabe ao CONECTA configurar/publicar seu emissor e demonstrar o disparo agendado e a rotina agendada das alocações. O envio de todo o acervo pelo mesmo código do emissor, disparado manualmente, não comprova a execução automática da agenda.

## Limites e próxima entrega

- O evento P03 `49b5eb5b-ae46-47d0-b6a2-5a66bc1c82d4`, declarado retido, já foi recebido em 16/11 às 15:10:42, horário de São Paulo. A conferência atual prova o estado final; não prova que a vigência derivada foi observada antes da revisão expressa. A regra foi reproduzida isoladamente com rollback.
- As correções D1/D1b/D4/D5 declaradas pelo CONECTA têm evidência SQL fornecida pelo desenvolvedor; não foi auditado/publicado o código desse outro sistema pelo FiltroAPP. A nova versão deve comprovar o comportamento do emissor real.
- Permanecem sem prova completa os downloads com arquivo/expiração/substituição e a rotação de credencial no meio do feed, conforme o próprio relatório de origem.
- Engenharia, feed exclusivo e automações precisam de eventos/provas adicionais na origem, em uma única rodada consolidada após resolver os dados impeditivos.

O [encaminhamento consolidado](RESPOSTA_FILTROAPP_CONECTA_LOTE_20261116_A.md) reúne os itens para o desenvolvedor sem reiniciar o lote inteiro.

## Capturas

- [Confirmação de pré-admissão sem data](../output/playwright/conecta-lote-20261116-A/pre-admissao-confirmacao.png).
- [Confirmação da admissão futura no celular](../output/playwright/conecta-lote-20261116-A/pre-futura-mobile.png).
- [Conformidade no vencimento](../output/playwright/conecta-lote-20261116-A/conformidade-vencimento.png).
- [Conformidade na consulta posterior](../output/playwright/conecta-lote-20261116-A/conformidade-dia-seguinte.png).
