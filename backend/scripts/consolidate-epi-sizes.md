# Consolidação manual de EPIs e tamanhos

O script `consolidate-epi-sizes.js` consolida variantes de tamanho em um catálogo com
`hasSizes=true` e `sizes`, atualiza as referências das fichas e importa os 17 tipos da
imagem fornecida em 17/11/2026. As regras ficam em `data/epi-sizes-catalog.json`.
Ele não faz parte das migrations nem roda na inicialização da aplicação.

Sem `--apply`, o banco é aberto em uma transação **somente leitura**. Também é
possível gerar a prévia sem conexão, usando `--input snapshot.json`.

## Regras da correção

- Reconhece tamanhos no final do nome (`Calça - M`, `Botina Miura Nº 41`,
  `Luva nitrílica média`) e preenchidos indevidamente em CA (`GG`, `TAM P`).
  Números de norma/modelo, como `NR10`, e o ano `2026` não viram tamanhos.
- Mantém CAs reais distintos. Traços usados como CA ausente são normalizados para
  vazio apenas nos tipos envolvidos na correção. Um CA real divergente na ficha
  bloqueia a aplicação inteira.
- Mantém um cadastro canônico por tipo/CA e desativa as variantes antigas. Não
  apaga nenhum catálogo ou registro. Migra fichas ativas, arquivadas e de devolução,
  conservando IDs, quantidades, datas e vínculos de devolução/assinatura.
- Atualiza nome, CA, tamanho e referência de catálogo nas fichas já cadastradas,
  inclusive assinadas. **Não modifica assinaturas visuais, datas de assinatura,
  arquivos PDF nem hashes de documentos emitidos.** A ficha atual passa a mostrar
  o cadastro normalizado; o PDF original continua representando o conteúdo da
  emissão original. O backup registra os valores antes/depois da normalização.
- Usa o vínculo de catálogo que a ficha já possui quando o nome histórico é
  diferente do cadastro atual; essas diferenças aparecem nos avisos da prévia.
  Conflitos explícitos de tamanho ou de condição usado/novo bloqueiam a correção.
- Não inventa tamanhos de entregas antigas sem informação. Esses registros
  continuam com `size=null`, embora o catálogo exija tamanho nas novas entregas.
- Usa a união dos tamanhos da imagem com os comprovados no histórico: por exemplo,
  preserva `XG` da jaqueta impermeável, mesmo não aparecendo nessa linha da imagem.
  `TAMANHO ESPECIAL` e `ESPECIAL` são cadastrados como `Especial`.
- Mantém usados separados dos novos e conserva gênero, material, modelo e coleção
  no nome. `Jaqueta` não é automaticamente `Jaqueta impermeável`; `Moletom` ou
  `Moletom unissex` não é automaticamente a coleção `Inverno 2026`. A grafia
  `FEMINA` da imagem é aceita como alias de `FEMININA`.

## Prévia em um backend já configurado

No diretório `backend`, usando a `DATABASE_URL` do banco desejado:

```sh
node scripts/consolidate-epi-sizes.js --dry-run --report /caminho/novo-plano-epi.json
```

Revise `catalogInserts`, `catalogUpdates`, `recordUpdates`, `groups`, `warnings` e
`blockers` no relatório. `before` e `after` mostram exatamente os campos que serão
alterados. A saída informa um `hash` do plano. O relatório deve ter um nome novo.

Para aplicar **somente depois dessa revisão**, substitua `HASH_DA_PREVIA` pelo hash
exibido e escolha um arquivo de backup novo em um diretório privado e persistente:

```sh
node scripts/consolidate-epi-sizes.js --apply \
  --expect-plan HASH_DA_PREVIA \
  --backup /caminho/persistente/novo-backup-epi.json
```

A aplicação bloqueia brevemente as tabelas de catálogo/fichas, relê os dados e exige
o mesmo hash da prévia. Grava e sincroniza o backup com permissão `0600`, executa as
alterações e verifica que não mudou outros dados das fichas. Confere também que uma
segunda execução produziria zero alterações. Qualquer erro desfaz toda a transação.
Se o plano mudar, gere uma nova prévia em vez de reaproveitar o hash antigo.

O backup pode existir mesmo se a transação tiver sido desfeita; a mensagem
`Correção confirmada` e a nova prévia confirmam a conclusão. Para reverter, revise
os valores `before`/`after` do backup contra o estado atual antes de restaurar
apenas os campos envolvidos; não substitua o banco inteiro sobre trabalho posterior.

## Aplicação no servidor com Docker

Com os dois arquivos desta PR disponíveis no checkout do servidor, copie-os para
o backend em execução. Isso disponibiliza o utilitário sem fazer deploy da aplicação:

```sh
docker cp backend/scripts/consolidate-epi-sizes.js \
  filtrovali-backend:/workspace/backend/scripts/consolidate-epi-sizes.js
docker cp backend/scripts/data/epi-sizes-catalog.json \
  filtrovali-backend:/workspace/backend/scripts/data/epi-sizes-catalog.json

# Diretório privado no volume persistente já montado pelo backend.
docker exec filtrovali-backend mkdir -p /data/relatorios/.epi-maintenance
docker exec filtrovali-backend chmod 700 /data/relatorios/.epi-maintenance

docker exec filtrovali-backend node scripts/consolidate-epi-sizes.js --dry-run \
  --report /data/relatorios/.epi-maintenance/plano-epi-01.json
docker cp filtrovali-backend:/data/relatorios/.epi-maintenance/plano-epi-01.json ./plano-epi-01.json
```

Revise o JSON copiado e o hash exibido. O próximo comando efetivamente modifica o
banco; ele **não foi executado** durante a preparação do script:

```sh
docker exec filtrovali-backend node scripts/consolidate-epi-sizes.js --apply \
  --expect-plan HASH_DA_PREVIA \
  --backup /data/relatorios/.epi-maintenance/backup-epi-01.json

docker cp filtrovali-backend:/data/relatorios/.epi-maintenance/backup-epi-01.json ./backup-epi-01.json
docker exec filtrovali-backend node scripts/consolidate-epi-sizes.js --dry-run
```

Na última prévia, `catalogToCreate`, `catalogToUpdate` e `recordsToUpdate` devem ser
zero. Recarregue a página EPI para buscar o catálogo atualizado.

## Consulta realizada em 17/11/2026

A consulta de produção foi somente leitura: 78 itens no catálogo, 185 registros de
EPI e 29 solicitações de assinatura. Foram encontrados oito cadastros com tamanho
no nome e 12 com tamanho no CA. A simulação inicial prevê 12 novos itens, 15
cadastros canônicos ajustados, 12 variantes desativadas e 35 fichas corrigidas
(27 assinadas); dez fichas dos tipos envolvidos não têm tamanho identificável.
Esses números são uma fotografia da consulta; a prévia recalcula o estado atual.

Os testes usam PostgreSQL descartável via PGlite e verificam conflitos, separação
por CA/condição/modelo, os 17 itens da imagem, preservação dos documentos assinados,
fichas arquivadas/devoluções e idempotência:

```sh
cd backend
node --test test/epi-size-consolidation.test.js
```
