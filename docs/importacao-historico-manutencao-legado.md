# Importação do histórico legado de manutenção

O pacote de migração contém um snapshot auditável da planilha antiga e três
comandos separados para extração, obtenção dos anexos e importação.

## Conteúdo levantado

- 102 manutenções, entre 03/03/2025 e 02/09/2026;
- 56 TAGs de equipamentos;
- 66 documentos PDF;
- 182 referências de fotos, correspondentes a 173 arquivos únicos;
- 2 manutenções com serviços de terceiros;
- 45 manutenções com observações.

O snapshot usado na produção fica em
`backend/scripts/data/legacy-maintenance-history.json`. Cada registro recebe um
ID determinístico derivado da planilha, GID e linha de origem. Por isso, repetir
o importador não duplica manutenções.

## 1. Obter os arquivos do Google Drive

Os PDFs e fotos da planilha são privados. Gere um token OAuth 2.0 de uma conta
que tenha acesso aos arquivos, com escopo de leitura do Google Drive, e execute:

Uma forma rápida é usar o [OAuth 2.0 Playground do Google](https://developers.google.com/oauthplayground), autorizar o escopo
`https://www.googleapis.com/auth/drive.readonly`, trocar o código pelo token e
copiar apenas o `Access token`. O token é temporário e não deve ser salvo no
repositório.

```bash
cd backend
export GOOGLE_DRIVE_ACCESS_TOKEN='TOKEN_TEMPORARIO'
npm run download:legacy-maintenance-assets -- \
  --output-dir /tmp/filtrovali-maintenance-assets
unset GOOGLE_DRIVE_ACCESS_TOKEN
```

O comando baixa cada ID somente uma vez, preserva os metadados em
`assets-index.json`, valida os PDFs e pode ser retomado. Para baixar somente os
66 PDFs, acrescente `--documents-only`. Nesse caso, remova `--require-photos`
dos comandos de simulação e aplicação; as fotos ausentes serão apenas listadas
como avisos e os PDFs continuarão sendo importados.

Se for mais conveniente baixar em uma estação com acesso ao Google e depois
enviar um único diretório ao servidor:

```bash
rsync -av --progress \
  /tmp/filtrovali-maintenance-assets/ \
  USUARIO@SERVIDOR:/tmp/filtrovali-maintenance-assets/
```

Em instalações containerizadas, disponibilize esse diretório ao processo do
backend por volume ou copie-o para um diretório temporário interno antes do
passo seguinte. Não copie os PDFs manualmente para `REPORTS_DIR`: o importador
usa o armazenamento gerenciado do app e cria cada vínculo no equipamento certo.

## 2. Simular contra o banco de produção

Depois de publicar as migrations e o código novo, execute no mesmo ambiente do
backend, sem `--apply`:

```bash
cd backend
npm run import:legacy-maintenance -- \
  --assets-dir /tmp/filtrovali-maintenance-assets \
  --summary-out /tmp/resumo-importacao-manutencao.json \
  --require-photos
```

O comando usa `DATABASE_URL` e `REPORTS_DIR` já configurados no ambiente. A
simulação não altera banco ou arquivos. Aplique somente quando o resumo mostrar
`pronto=sim` e os seguintes totais:

- `registros=102`;
- `equipamentos=102/102`;
- `PDFs=66/66`;
- `fotos=182/182`, quando `--require-photos` for usado.

Se uma TAG antiga não corresponder automaticamente ao código atual, informe uma
exceção sem editar o snapshot:

```bash
npm run import:legacy-maintenance -- \
  --assets-dir /tmp/filtrovali-maintenance-assets \
  --equipment-alias 'TAG ANTIGA=TAG ATUAL' \
  --summary-out /tmp/resumo-importacao-manutencao.json
```

O argumento `--equipment-alias` pode ser repetido.

## 3. Aplicar

Faça o backup habitual do banco e do volume de relatórios. Repita exatamente a
simulação aprovada, acrescentando `--apply`:

```bash
npm run import:legacy-maintenance -- \
  --assets-dir /tmp/filtrovali-maintenance-assets \
  --summary-out /tmp/resumo-importacao-manutencao-aplicada.json \
  --require-photos \
  --apply
```

Os registros entram como aprovados e avulsos, sem distinção visual de origem.
Os serviços mantêm o texto histórico e são associados aos itens atuais quando
os nomes coincidem. Os arquivos são gravados pelo mecanismo existente em
`Equipamentos/Manutenções/<TAG>` e cada PDF aparece no histórico do equipamento.

Como a planilha não possui o nome do supervisor histórico, o snapshot salvo no
registro será `Não informado (controle legado)`. Caso exista um nome único que
deva ser atribuído a todas as linhas, use `--supervisor-name 'NOME'` tanto na
simulação quanto na aplicação.

## Atualizar o snapshot antes da publicação

Se a planilha receber novas linhas antes da migração, exporte-a novamente como
XLSX e execute:

```bash
cd backend
npm run extract:legacy-maintenance -- --input /caminho/controle.xlsx
node --test test/legacy-maintenance-import.test.js
```

Revise os totais alterados no teste e no JSON antes de publicar.
