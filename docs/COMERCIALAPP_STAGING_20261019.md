# Homologação no staging — 19/10/2026

Executada entre [filtroAPP :8080](http://76.13.171.70:8080/) e [ComercialAPP :8087](http://76.13.171.70:8087/), com autenticação de serviço, nginx, bancos e workers dos serviços implantados. filtroAPP `733fa8ea`, ComercialAPP `3180fbb2` (inclui PR 81). Esta execução complementa o teste anterior em bancos descartáveis; não usa mocks de transporte, receptor ou composição.

Foram inseridos apenas registros sintéticos identificados por `QA-EXTRA-20261019204026`. O usuário técnico temporário foi criado para autenticar as verificações. Os parâmetros de custo existentes do ComercialAPP foram consultados sem alteração; o aceite usou `recordManualSelection`. Os PDFs comerciais são arquivos sintéticos válidos, com revisão e geração próprias. Os databooks foram produzidos pelo gerador Python implantado.

## Composição observada na API de acompanhamento

Principal **753498482**, Access, revisão 0, R$ 100.000, custo R$ 60.000 e 1.000 horas. Adicionais do ComercialAPP: A **753498483** (revisões 0 e 1) e B **753498484** (revisão 0).

| Contribuições selecionadas | Receita | Custo previsto | Horas previstas |
| --- | ---: | ---: | ---: |
| Principal + A rev0 | R$ 120.000 | R$ 60.626,27 | 1.008,8 h |
| Principal + A rev1 | R$ 125.000 | R$ 61.252,54 | 1.017,6 h |
| Principal + A rev1 + B rev0 | R$ 130.000 | R$ 61.878,81 | 1.026,4 h |
| Repetição, sincronização e restauração após retirada explícita | R$ 130.000 | R$ 61.878,81 | 1.026,4 h |

Custos e horas foram confrontados com os snapshots calculados pelo produtor, independentemente dos preços. Não representam uma estimativa comercial real. O orçamento principal e o número da proposta do projeto permaneceram preservados.

## Verificações operacionais

- Capabilities autenticada: contrato 3, `additionalProposals: true`, `budgetMode: CONTRIBUTIONS`; sem Bearer: 401.
- Exportação do adicional sem header de contrato: 409. Com `X-Comercial-Contract: 3`: consulta de revisão ainda não aprovada, `approvedAt: null`, armazenada como `STAGED`, sem contribuição selecionada.
- A0: entrega real por `deliverToFiltro`; induzida perda de ACK após o commit. Retentativa com o mesmo evento recebeu confirmação persistida, `duplicate: true`, sem reaplicar.
- A1 e B0: aprovação manual do produtor seguida de entrega pelo seu worker periódico implantado. Ambas terminaram com `filtroStatus: SUCESSO`. O worker nativo do filtroAPP consultou as revisões e baixou seus documentos.
- Evento confirmado repetido: ACK original. Mesmo evento alterado e revisão incompatível com novo evento: 409. Evento novo atrasado de A0: `STAGED`, conservando A1.
- Revisão anterior sem comando explícito: 409. Duas alterações efetivas com a mesma versão: uma 200 e outra 409. Seleção final restaurada para A1.
- Edição de A para 27 m: `MANUAL_OVERRIDE` somente em A. Nova consulta preservou 27 m e os IDs dos serviços da principal e de B. Resolução explícita `COMMERCIAL` restaurou 25 m.
- Retirada explícita de A, com versão e motivo: R$ 105.000. Evento atrasado não reativou a contribuição. O histórico dos oito arquivos e a edição do databook já emitido continuaram disponíveis. Restauração manual: R$ 130.000.
- CNPJ e proposta mãe incompatíveis: 422, com rollback.
- Seis documentos por identidade de proposta/tipo e oito versões, incluindo A0/A1. Bytes PDF e SHA-256 dos arquivos persistidos conferidos; download autenticado da revisão correta: 200.

O [JSON da execução](evidence/comercialapp-staging-20261019.json) contém totais, identidades, payload/ACK de retentativa, conflitos, hashes e referências dos databooks; não contém credenciais.

## Escopo e databook independentes

No projeto QA, os mesmos tipo, equipamento e sistema aparecem nas três contribuições. Quatro serviços de RDO estavam inicialmente pendentes, sem associação por título. O vínculo explícito foi gravado pela API de gestor; duas atribuições concorrentes produziram 200/409 e a versão formal dos relatórios aprovados foi preservada.

Após a conferência: principal 100/100 m; A 25/25 m; B 5/5 m. A contém 5 m anteriores ao período e 20 m em 19/10/2026. Os relatórios técnicos acompanham o serviço do RDO de origem.

O período 19/10/2026 gerou três documentos distintos:

| Escopo | Documento | Páginas |
| --- | --- | ---: |
| Só A, proposta 753498483 rev1 | `DB-QA-EXTRA-20261019204026-01` | 8 |
| Só principal, proposta 753498482 rev0 | `DB-QA-EXTRA-20261019204026-02` | 8 |
| Projeto completo | `DB-QA-EXTRA-20261019204026-03` | 9 |

A prévia e os PDFs foram gerados pelas APIs e worker implantados. O texto extraído do PDF de A contém apenas seu serviço/TAG e número da proposta, sem serviços/TAGs da mãe ou B e sem a descrição geral do RDO misto. O PDF da principal exclui A e B. Hashes e revisões estão no JSON. A retirada temporária da contribuição preservou a entrada e o arquivo da emissão histórica.

## Correções encontradas e implantação aplicada

1. O staging usa HTTP com IP/porta; o consumidor exigia HTTPS remoto. Foi acrescentada uma exceção optativa que exige **simultaneamente** `APP_ENV=staging` e `COMERCIALAPP_ALLOW_STAGING_HTTP=true`. Produção continua exigindo HTTPS; redirects, credenciais na URL e origens com caminho/query/fragmento seguem recusados. Testes de configuração/conexão e CI cobrem a restrição.
2. A consulta da mãe no ComercialAPP gravava o escopo com origem `COMERCIAL_APP`, enquanto o orçamento selecionado permanecia Access. O recorte agora reconhece o mesmo número como principal, conservando a procedência persistida. A versão do databook considera essas metas. Teste cobre as duas origens e alteração da versão ao editar as metas.

No filtroAPP staging: `COMERCIALAPP_API_URL=http://76.13.171.70:8087/`, `APP_ENV=staging`, opção HTTP explícita e contrato 3. O backend foi reconstruído e atualizado; as migrações já estavam aplicadas. A modificação preexistente em `deploy/nginx/staging.conf` foi preservada.

No ComercialAPP staging, o token também precisou ser configurado para ativar o exportador. O Compose base mantém o push desligado. A configuração de homologação utiliza `docker-compose.filtroapp-homolog.yml`, exclusivamente para o serviço `api` de staging, com `STAGING_FILTROAPP_API_URL`, `STAGING_FILTROAPP_API_TOKEN` e `STAGING_FILTROAPP_ADDITIONAL_CONTRACT=3`. Antes de ativar, foram verificadas **zero entregas elegíveis de terceiros**. Para recriar o par com essa configuração:

```sh
# filtroAPP staging, diretório /root/apps/filtroAPP-staging
# Preservar backend/.env.staging e seus segredos locais.
docker compose --env-file backend/.env.staging -f docker-compose.staging.yml up -d --no-deps backend

# ComercialAPP staging, executar como usuário comercial no seu checkout
# Preservar .env.staging e o override local de homologação.
docker compose --env-file .env.staging -f docker-compose.staging.yml \
  -f docker-compose.filtroapp-homolog.yml up -d --no-deps api
```

Backups das configurações anteriores e registros privados da execução ficaram na VPS em `/root/backups/filtrovali-staging/commercial-integration-20261019`, com acesso restrito. Nenhum comando de implantação foi dirigido aos serviços de produção.

## Conferência manual e limites

Abra o [projeto QA no acompanhamento](http://76.13.171.70:8080/acompanhamento?section=projetos&project=cmvfpxvoc00002gryxw5x3ec3) usando sua conta de gestor. Em **Consultar escopo**, selecione principal/A/B e confira o avanço independente. No módulo de relatórios/projetos, escolha o mesmo projeto, período 19/10/2026 e uma proposta no diálogo de Data Book; os três documentos emitidos estão no histórico.

Esta homologação usa principal Access com adicionais ComercialAPP. A combinação inversa, mãe revisada, referências legadas não resolvidas, métricas individuais e respostas HTTP antigas concorrentes também têm testes de PostgreSQL/integração isolada no PR; não se afirma uma nova execução desses cenários no staging aqui. Autorização/decisão do PrismaCRM e infraestrutura de produção permanecem fora desta execução. O aceite manual real do ComercialAPP comprovou o contrato produtor → filtroAPP sem acionar o PrismaCRM.
