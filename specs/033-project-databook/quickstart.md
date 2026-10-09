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

Correção de 09/10/2026: a comparação de fontes normaliza a ordem das chaves dos objetos JSON, preservando a ordem das fotos e os valores de datas. API e worker devem ser atualizados juntos. Emissões antigas que falharam somente pela reorganização de campos em JSONB podem usar **Tentar novamente**, sem refazer a etapa, alterar o snapshot ou executar backfill. Mudanças reais nas evidências continuam exigindo nova revisão. Regressão validada com gravação/leitura JSONB em PGlite, emissão de pacote, repetição com hash do formato anterior e bloqueio de mudanças antes/durante a geração. Os 20 cenários de databook passaram. A suíte geral nesta sessão passou em 284 arquivos; quatro arquivos falharam por restrições do ambiente (`listen EPERM` em testes HTTP e `spawnSync sh EPERM` em teste de script), fora da função alterada.

## Evidência de validação

Correção do modelo em 09/10/2026: a síntese agora segue `modelo-databook-5815-sintese.pdf`, com logo, títulos serifados verdes, capa com foto, quadros/tabelas, fotos em duas colunas, registro das FDSs e conclusão/aceite. A mesma sequência de seções foi preservada; paginação varia conforme dados e legendas. Os 24 testes da função passaram, incluindo galeria de oito fotos em duas páginas, paginação de TAGs/sistemas/legendas extensos, links do sumário/FDS, anexos sem overlays, documentos não PDF no ZIP e compatibilidade dos fingerprints anteriores.

Validação visual com cópias de produção em `output/playwright/databook-5815-producao/validacao-modelo-aprovado/`: `databook-5815-sintese-corrigida.pdf` (14 páginas) e `databook-5815-layout-corrigido.pdf` (165 páginas, incluindo 151 páginas originais). Esse artefato usa 22 RDOs, 7 RLQs com PDF disponível no acervo anterior, 8 fotos e 5 FDSs. Não representa uma emissão oficial nem substitui os 19 RLQs da coleta: os 12 sem PDF nessa cópia não foram inventados ou omitidos silenciosamente. Todos os 42 arquivos originais do ZIP tiveram hashes conferidos; a inspeção geométrica da síntese não encontrou textos fora das margens ou sobre o rodapé. Referência aprovada permaneceu intacta.

Atualizar API e worker para aplicar o novo gerador. Não há nova migração ou alteração de frontend nesta correção. Depois da atualização, usar **Preparar nova revisão** para obter o modelo com os campos técnicos atuais. PDFs concluídos anteriormente conservam seu layout e bytes; snapshots antigos em tarefas pendentes continuam compatíveis e identificam campos técnicos ausentes como “A confirmar”.

- Migração executada em PGlite com checks de período/status/FK/duplicidade; schema Prisma validado e client gerado.
- Validação inicial em 08/10/2026, com ambiente sem restrições: suíte completa backend com 2.075 testes passando, 13 cenários opcionais ignorados e nenhuma falha; teste adicional de assinatura parcial passou na suíte da função (16 testes).
- Suíte completa frontend: 695 testes passaram; build TypeScript/Vite e lint dos arquivos novos passaram.
- Pacote real de validação produzido a partir do inventário e arquivos já copiados de produção de 5815: defaults 16/09 a 07/10, 22 RDOs, páginas integrais da FDS e bytes/hashes dos originais conferidos. Artefato de validação não é emissão oficial registrada no banco do APP.
- Browser sem servidor, API simulada apenas para interação: datas editadas conservadas após refetch, período invertido com erro no campo, seleção/legenda/ordem de fotos e produtos/FDS; celular 390 px sem overflow e modal com rodapé acessível. Arraste com prévia/fantasma, Esc restaurando a ordem e drop preservando legendas conferidos; requisição de emissão confirmou o intervalo escolhido, a ordem das fotos e a revisão da FDS.
- Grafo atualizado e consultado para impacto, fluxos e revisão; novos arquivos ainda não rastreados pelo Git podem não aparecer no grafo incremental. Fonte e testes foram conferidos diretamente.
- Sem hooks em `.specify/extensions.yml`.
