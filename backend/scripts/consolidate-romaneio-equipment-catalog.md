# Consolidação do catálogo de equipamentos dos romaneios

O script migra referências de `FILE`, `MANUAL`, `UNIT` e `PARTICLE_COUNTER`
para os itens `EQUIPAMENTOS`, vinculados ao cadastro `CompanyEquipment`.
Trata as categorias equivalentes, inclusive as variações legadas de nome,
e exige um código patrimonial único e compatível para cada item em uso.
Espaços, caixa e zeros à esquerda do número são normalizados; prefixos diferentes
não identificam automaticamente o mesmo equipamento.

## Execução

No diretório `backend`, com a configuração do banco desejado:

```sh
node scripts/consolidate-romaneio-equipment-catalog.js --dry-run
node scripts/consolidate-romaneio-equipment-catalog.js --apply --backup /caminho/novo-backup.json
```

Sem `--apply`, nenhuma escrita é feita. Revise as categorias, contagens, bloqueios
e correspondências da prévia. O arquivo de backup deve ser novo, em um diretório
existente, privado e persistente; ele contém dados operacionais e rascunhos.

A aplicação trava as tabelas envolvidas brevemente, relê o banco, valida o plano,
grava e sincroniza o backup em disco com permissão `0600`, migra os vínculos e
remove as opções legadas, tudo em uma transação. O backup contém o estado anterior
e o plano; sua existência isolada não prova que a transação foi confirmada.
Qualquer bloqueio, falha de backup ou divergência nas verificações aborta a aplicação.

## Comportamento

- Migra itens de todos os romaneios, tanto saídas quanto entradas, além dos
  checklists e dos rascunhos salvos no banco. Preserva linhas, quantidades,
  nomes/categorias históricos, respostas, assinaturas e arquivos emitidos.
- Nos rascunhos, atualiza também as chaves dos itens selecionados, quantidades e
  respostas do checklist. Uma colisão com valores diferentes bloqueia a migração.
- Remove as opções nativas das categorias que possuem uma versão sincronizada
  ativa em Equipamentos. Um item em uso sem correspondência segura bloqueia toda
  a aplicação. Itens sem uso da categoria repetida podem ser removidos sem inventar
  um vínculo patrimonial.
- Usa a mesma exclusão lógica do app (`isActive=false`, `hiddenInRomaneioAt`),
  preservando a marca que impede a sincronização do arquivo de reativar a opção.
  Apagar fisicamente essas linhas permitiria que o arquivo as recriasse.
- Não altera o cadastro de Equipamentos, suas categorias ou a configuração
  `syncToRomaneio`. Categorias sem uma versão sincronizada ativa permanecem disponíveis.
- Executar novamente gera zero alterações quando a consolidação já terminou.

Depois da aplicação, invalide o cache de Acompanhamento do processo em execução
(ou reinicie o backend local) e recarregue o dashboard. O filtro existente passa
a reconhecer os equipamentos porque o catálogo vinculado tem origem `EQUIPAMENTOS`.

Para uma eventual reversão, use os IDs e valores anteriores do backup em uma
transação revisada, verificando antes se houve novas edições; não restaure o banco
inteiro sobre trabalho posterior à migração.
