# Pesquisa

## Documento pronto

**Decision**: compartilhar seletor e regras de cache, manter operações mutáveis na tela.
**Rationale**: getReportBasePdfDownload reconcilia ZapSign, repara hashes e gera documentos; é incompatível com leitura de integração de 15s.
**Alternatives considered**: importar rota ou disparar conversões por pedido causaria acoplamento, rede e espera. Pesquisa de fonte realizada com grafo e revisão das implementações/testes.

## Composição e geração

**Decision**: entregar base/final; sem anexos e sem sobreposição de assinaturas parciais.
**Rationale**: composição atual admite 200 MiB e lê todos os arquivos; requer orçamento próprio para 15s. PDF final mantém assinaturas completas.
**Alternatives considered**: composição síncrona limitada, fila efêmera e download remoto foram descartados nesta entrega. Preparar documentos pelo fluxo existente; nenhuma geração automática nova.

## Metadados

**Decision**: indicador barato de versões persistidas; sem filesystem na listagem e sem CACHE/ZapSign remoto no indicador.
**Rationale**: evitar N leituras de PDF e consultas de fontes de progresso por página. Download verifica tamanho, hash, frescor e existência.

## Contato

**Decision**: escopo PERSONAL próprio, emailCorporativo e userId da conta vinculada.
**Rationale**: minimizar dados pessoais sem liberar escopo PII; validar domínio exato e formato do e-mail. Não publicar e-mail pessoal. Manter recorte antigo de colaboradores.

## Publicação

**Decision**: manter publishedReport apenas APPROVED.
**Rationale**: pedido exige resposta/proposta separada sobre SIGNED, sem implementar a mudança.
