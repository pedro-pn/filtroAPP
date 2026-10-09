# Validation and rollout

## Local checks (sem servidor)

1. No backend, `npm run prisma:generate`, `npx prisma validate` e `node --test test/databooks*.test.js`. Os módulos exigem DATABASE_URL configurada; os novos testes usam stubs/PGlite e não dependem de banco do projeto.
2. No frontend, npm test e npm run build. Nenhum servidor/Docker necessário.
3. Teste de pacote usa PDFs/fotos já copiados de produção quando presentes; banco simulado apenas para regras, não como origem factual do exemplo.

## Manual UI validation

Abrir projeto 5815 em produção após implantação: padrão 16/09/2026 a 07/10/2026. Selecionar uma etapa menor; conferir inclusão das duas pontas e fotos somente dos relatórios selecionados. Confirmar apenas produtos efetivamente usados, escolher FDS e revisão; PQ011 sem FDS impede seleção como utilizado até anexar documento no Estoque. Conferir divergência de PQ007 com fornecedor. Emitir, acompanhar progresso, baixar PDF/ZIP; gerar outra etapa e revisão sem substituir a primeira. Validar acesso viewer somente leitura e mobile 390 px.

## Implantação manual

O operador deve aplicar a migração Prisma pelo procedimento de deploy existente e atualizar API, worker e frontend na mesma versão. A fila é iniciada por startBackgroundJobs tanto no worker dedicado quanto no modo configurado de jobs na API; claims CAS protegem duplicidade. O agente não executa comandos de servidor/deploy. Consultar scripts existentes do repositório para comando exato da implantação.

**Rode no servidor**, na pasta do projeto com o ambiente de produção já configurado conforme `deploy/PRODUCTION.md`:

```bash
./deploy/backup-prod.sh
docker compose -f docker-compose.prod.yml up -d --build backend worker nginx
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate status
docker compose -f docker-compose.prod.yml logs --tail=100 backend worker
```

O entrypoint do backend executa `prisma migrate deploy`; confirmar aplicação de `20261008220000_project_databooks` antes de usar a tela. Worker compartilha o volume de relatórios/uploads e depende da saúde do backend. Não executar seed ou backfill: a migração cria tabela nova sem alterar RDOs, estoques ou documentos existentes. Se retornar ao código anterior, conservar tabela/arquivos das emissões para não apagar o histórico.

Limites desta entrega: até 500 relatórios/fotos por emissão, 100 produtos/documentos e 200 MB de arquivos originais. Em caso de excesso, dividir a etapa. Referências externas ficam no manifesto; arquivos não PDF ficam no ZIP. Produtos são candidatos a partir das transferências não estornadas para o projeto, inclusive fora do período, e precisam de confirmação de uso nesta etapa. As datas e as escolhas ficam congeladas na solicitação; mudanças nas fontes antes/durante geração exigem preparar nova revisão. O histórico mostra falha com motivo e permite repetir indisponibilidade temporária de arquivo; não finaliza pacote parcial.

## Evidência de validação

- Migração executada em PGlite com checks de período/status/FK/duplicidade; schema Prisma validado e client gerado.
- Suíte completa backend: 2.075 testes passaram, 13 cenários opcionais ignorados, nenhuma falha; teste adicional de assinatura parcial passou na suíte da função (16 testes).
- Suíte completa frontend: 695 testes passaram; build TypeScript/Vite e lint dos arquivos novos passaram.
- Pacote real de validação produzido a partir do inventário e arquivos já copiados de produção de 5815: defaults 16/09 a 07/10, 22 RDOs, páginas integrais da FDS e bytes/hashes dos originais conferidos. Artefato de validação não é emissão oficial registrada no banco do APP.
- Browser sem servidor, API simulada apenas para interação: datas editadas conservadas após refetch, período invertido com erro no campo, seleção/legenda/ordem de fotos e produtos/FDS; celular 390 px sem overflow e modal com rodapé acessível. Arraste com prévia/fantasma, Esc restaurando a ordem e drop preservando legendas conferidos; requisição de emissão confirmou o intervalo escolhido, a ordem das fotos e a revisão da FDS.
- Grafo atualizado e consultado para impacto, fluxos e revisão; novos arquivos ainda não rastreados pelo Git podem não aparecer no grafo incremental. Fonte e testes foram conferidos diretamente.
- Sem hooks em `.specify/extensions.yml`.
