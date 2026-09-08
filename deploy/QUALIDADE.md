# Modulo Qualidade — migration

Aplicacao manual da migration versionada do modulo de Registros de Qualidade.

## Rode no servidor

```bash
cd /caminho/do/app/backend
npm run prisma:deploy
```

## O que a migration cria

- Enums `QualityRecordType`, `QualityImpact`, `QualityDisposition`, `QualityStatus`.
- Valores `QUALIDADE`, `QUALIDADE_MANAGER` e `QUALIDADE_VIEWER` nos enums de modulo/papel.
- Tabelas `QualityNature`, `QualityRecord` e `QualityRecordSeq`.
- Indice unico case-insensitive `QualityNature_name_lower_key` em `lower("name")`.

## Validacao

Rode no servidor:

```bash
cd /caminho/do/app/backend
npm test -- qualidade
```
