# Evidências de extra escopo — 19/10/2026

Produtor: ComercialAPP `109efb4e9fa0720a33899ec0e55b69bc1d419e7e` (PR 81).
Base do filtroAPP: `48f468ec`. Código final no PR desta alteração.
Bancos PostgreSQL 16 e servidores HTTP descartáveis, em loopback, com credenciais próprias.
Nenhum serviço de staging/produção ou variável de habilitação desses serviços foi alterado.

O registro acima descreve a execução inicial em bancos descartáveis. A homologação posterior
nos serviços implantados, com configuração de staging, filas nativas e databooks reais, está em
[COMERCIALAPP_STAGING_20261019.md](COMERCIALAPP_STAGING_20261019.md).

## Composição persistida

Cenário determinístico em PostgreSQL, exercitado pelo serviço transacional real do filtroAPP:

| Seleção | Receita composta | Custo composto | Horas compostas |
| --- | ---: | ---: | ---: |
| Principal 100 mil + A rev0 20 mil | R$ 120.000 | R$ 72.000 | 1.200 h |
| Substituir A por rev1 25 mil | R$ 125.000 | R$ 75.000 | 1.250 h |
| Selecionar B 5 mil | R$ 130.000 | R$ 78.000 | 1.300 h |
| Repetir eventos e entregas concorrentes | R$ 130.000 | R$ 78.000 | 1.300 h |

Também foram verificados: margem composta de 40%, exclusão independente de custo/horas por
`metricInclusion`, revisão posterior da mãe, mãe ausente, referências legadas resolvidas depois,
CNPJ/mãe/projeto incompatíveis, unicidade por origem, confirmação após seleção manual, conflito de
corpo/evento/revisão, rollback explícito com versão e motivo, eventos atrasados, overrides por
contribuição, resolução explícita do escopo e preservação de serviços manuais.
As combinações principal Access/adicional ComercialAPP e principal ComercialAPP/adicional Access
usam os mesmos agregadores de valor/custo/horas.

## Consulta e push com o produtor real

`commercial-additional-real.integration.test.js` inicia o exportador real do ComercialAPP e o app
HTTP real do filtroAPP, com bancos independentes e todas as migrações. Usa os métodos reais de
aceite manual e `deliverToFiltro`. O teste injeta registros finalizados sintéticos e PDFs válidos;
não substitui as APIs, os cálculos, o receptor ou a composição por mocks.

Resultados:

- Consulta sem o header de contrato retorna 409 no produtor; com contrato 3, importa a revisão
  ainda sem aprovação como `STAGED`, sem selecioná-la.
- Push aprovado: R$ 120/125/130 mil confirmados no agregador persistido. Custos e horas conferidos
  separadamente contra os snapshots calculados pelo produtor, sem usar os valores fixos da tabela acima.
- ACK perdido depois do commit: retentativa usa o mesmo evento, recebe ACK confirmado e não reaplica.
- Evento alterado retorna 409 pelo HTTP real. Seleção sem autenticação retorna 401.
- Principal e dois adicionais possuem seis documentos separados; A rev0/rev1 conservam oito versões.
  Todos os arquivos foram lidos como PDFs e seus SHA-256 conferidos. Atualizar A conserva o escopo
  e os documentos da principal e de B, mesmo com os mesmos títulos de serviço.
- Consulta que termina depois de uma escolha manual retorna `SUPERSEDED`; sua resposta não muda
  a seleção corrente nem aplica arquivos/escopo.
- Remoção pela rota autenticada, com versão e motivo: total R$ 105 mil (principal + B), histórico de
  oito versões preservado. Repetir a entrega antiga não reativa A.

O [registro JSON da execução](evidence/comercialapp-additional-20261019.json) contém o ACK real de
retentativa e as identidades sintéticas usadas nessa execução. A suíte em banco novo passou com
18 testes, sem falhas ou skips, incluindo regressão da consulta comum v1.
Para executar vários arquivos que iniciam workers de consulta no mesmo banco de teste, usar
`--test-concurrency=1`; os próprios casos de concorrência continuam exercitando transações paralelas.

## Verificações locais e CI

- Backend completo: 2.266 testes, 2.251 aprovados, 15 opcionais não configurados, zero falhas.
- Frontend completo: 793 testes aprovados; build TypeScript/Vite e ESLint aprovados.
- Data Book: 23 testes executados, um skip opcional, sem falhas.
- Arquitetura e `git diff --check`: aprovados.
- Auditorias npm: passaram no limiar `high` exigido pelo CI; frontend sem vulnerabilidades.
- Migração completa: 221 migrações aplicadas em PostgreSQL vazio. Teste de compatibilidade preservou
  aliases Access selecionados, inclusão de métricas, escopo e identidades/versões de documentos antigos;
  novas duplicatas/referências de origem incompatíveis foram recusadas pelo banco.
- Navegador via Playwright CLI: seleção, revisão anterior com motivo/versão, retirada explícita,
  consulta, documentos e inclusão de horas, preservando principal e B. Sem overflow a 360/768/1440 px.
  O fixture de UI simula HTTP; não é a evidência de composição operacional acima.
- CI inclui um job PostgreSQL próprio para contribuições; o resultado remoto acompanha o PR.

## Limites e implantação

A homologação cobre o contrato entre ComercialAPP e filtroAPP em ambiente isolado, com dados
sintéticos. Autenticação, rede e permissões da infraestrutura de produção precisam ser verificadas
no par de ambientes de implantação. A decisão/autorização do PrismaCRM não foi homologada aqui;
esse fluxo depende do receptor e credenciais do PrismaCRM.

Capabilities v3 permanece desligada por padrão. A ordem de migração, implantação, habilitação
coordenada e exemplos completos de payload/ACK estão em
[COMERCIALAPP_EXTRA_ESCOPO.md](COMERCIALAPP_EXTRA_ESCOPO.md). O push de staging do ComercialAPP
continuou desligado nessa execução inicial; a ativação isolada posterior está documentada no
registro de staging acima. Não automatizar cancelamento/recusa como remoção financeira.
