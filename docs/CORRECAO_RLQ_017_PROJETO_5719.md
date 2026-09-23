# Correção pontual: RLQ 017 do projeto 5719

O PDF original do RLQ 017 (Ilha Solteira, UG 01, peças existentes do mancal guia) informa **01/04/2026**. O cadastro do upload antigo estava com **17/04/2026**, causando conflito ao importar os serviços históricos. A correção já feita no banco local não acompanha o deploy do código.

O script `backend/scripts/fix-rlq17-project-5719-date.js` corrige exclusivamente `Report.reportDate`; o Prisma também atualiza `updatedAt`. Não altera os PDFs, nomes de arquivos, status, versões, assinaturas, medições históricas ou outros relatórios. Resolve os IDs pelo código do projeto, tipo e número do relatório, sem usar IDs do banco local.

## Executar em produção

Após publicar as alterações, reconstruir a imagem do backend e concluir o deploy habitual, execute na raiz do repositório no servidor. O Dockerfile já inclui `backend/scripts` na imagem. O script **não roda automaticamente** no startup nem nas migrações.

Mantenha o backup habitual do banco e do volume de relatórios antes da manutenção. Faça a execução em um intervalo sem edições/assinaturas deste relatório.

Primeiro, somente conferir (sem alteração no banco e sem criar arquivos):

```bash
docker compose -f docker-compose.prod.yml exec -T backend node scripts/fix-rlq17-project-5719-date.js --dry-run
```

Se o resultado for `READY`, confirme que o projeto é 5719, o relatório é RLQ 017 e a mudança indicada é de 17/04 para 01/04/2026. Depois aplique:

```bash
docker compose -f docker-compose.prod.yml exec -T backend node scripts/fix-rlq17-project-5719-date.js --apply
```

O resultado esperado é `COMMITTED` seguido de `VERIFIED`. Rodar de novo retorna `ALREADY_CORRECT`, sem nova gravação. Sem argumentos, o script também apenas simula.

## Proteções e auditoria

- Exige projeto não excluído, RLQ manual de serviço, status `SIGNED`, uma versão ativa com PDF original/assinado, assinatura concluída e ausência de serviços próprios/derivação de RDO.
- Confere o PDF original byte a byte pelo SHA-256 do documento já analisado: `65784daf6b14b947ffe08d8c9f896945b15613ac9b195cd8dcbacea27911191f`. Não aceita outro documento somente porque possui o mesmo número. Caso seja diferente em produção, pare e solicite uma nova conferência; não remova essa proteção.
- Verifica arquivos locais dentro de `REPORTS_DIR`, hashes registrados nas versões e a integridade dos dados protegidos antes/depois. Não faz download ou regeneração de PDFs.
- Usa transação serializável e comparação da data/`updatedAt` para não sobrescrever mudanças concorrentes. Datas diferentes das duas conhecidas impedem a correção.
- Antes de alterar, salva `before.json` em uma pasta exclusiva dentro de `/data/relatorios/maintenance-corrections/` no ambiente de produção padrão. A pasta fica no volume persistente. Depois salva `result.json` com a conferência pós-commit. Esses arquivos contêm IDs, datas e hashes, não tokens nem imagens/dados pessoais das assinaturas.
- Opcionalmente, use `--backup-dir=/caminho/absoluto` para outro diretório persistente e gravável dentro do contêiner. O registro é específico desta correção e **não substitui um backup completo** do banco/volume.

Se falhar antes do commit, a correção não é confirmada. Se exibir `COMMITTED` e depois falhar na conferência final, a data **já foi corrigida**: preserve `before.json`, execute `--dry-run` e confira o diagnóstico. Não faça uma reversão manual às cegas. A existência de `before.json` isoladamente não comprova nem sucesso nem falha; ele é escrito antes da transação.

Depois de `VERIFIED` ou `ALREADY_CORRECT`, recarregue o app e gere novamente a prévia do CSV na aba **Serviços históricos**. A correção da data não importa o CSV automaticamente. Os nomes antigos dos arquivos podem continuar contendo `2026-04-17`; são preservados intencionalmente para não quebrar os documentos assinados.

## Testes

```bash
cd backend
node --test test/fix-rlq17-project-5719-date.test.js
```

Os testes usam arquivos sintéticos e um cliente transacional simulado, sem acessar o banco de produção. Cobrem simulação, aplicação, repetição, identidade incorreta, concorrência, integridade, rollback e falhas de auditoria. O modo `--dry-run` permite a conferência do banco/arquivos reais sem alterá-los.
