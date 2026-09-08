# Quickstart Validation: Relatórios de Manutenção e Produção

## Pré-requisitos locais

- Banco local descartável compatível com a migration Prisma.
- `Modelos/definitivos/Manutenção/Modelo Manutenção.docx` presente.
- Contas de teste: emissor, supervisor com colaborador/assinatura e ADMIN.
- Equipamentos ativos associados aos perfis UFI, UFP pneu e ULQ diesel.

## Validação automatizada

```bash
cd backend
npx prisma validate
npx prisma generate
npm test
```

```bash
cd frontend
npm test
npm run lint
npm run build
```

```bash
npm run architecture:check
```

## Cenário 1 — Permissões

1. Conta somente Obra não vê “Manutenção e produção” e abre o RDO normal diretamente.
2. Conta somente Manutenção vê as abas Manutenção, Programação e Histórico de manutenção, com criação de 5002 e avulsa.
3. Conta somente Produção vê apenas Produção, com criação de 5004.
4. Conta Manutenção + Produção vê exatamente as quatro abas do módulo.
5. Revisor sem a permissão da área não vê a aba; ao receber a permissão, vê a área e as ações de revisão compatíveis com seu papel.
6. `POST` e acesso de aba sem permissão retornam `403`; CLIENT permanece sem emissão.

## Cenário 2 — RDO 5002

1. Preencher jornada diurna/noturna, intervalo, colaboradores e HE.
2. Adicionar duas manutenções, serviços, fotos e mais de cinco terceiros no total.
3. Submeter: PENDING e ausente do histórico.
4. Aprovar como supervisor: conjunto APPROVED, um PDF por manutenção, serviços numerados, assinatura global e nenhum PDF geral.
5. Repetir aprovação e confirmar ausência de duplicata.

## Cenário 3 — Manutenção avulsa

1. Informar data e um equipamento; responsável é a conta atual.
2. Submeter, devolver, corrigir e aprovar.
3. Trocar supervisor e confirmar snapshot antigo no PDF.
4. Consultar histórico aprovado sem rótulo de origem.

## Cenário 4 — Supervisor ausente

1. Remover supervisor, criar/submeter com sucesso e confirmar bloqueio apenas na aprovação.
2. Configurar supervisor válido e aprovar o mesmo registro.

## Cenário 5 — Produção 5004

1. Criar itens para os quatro materiais.
2. Confirmar erros para zero kg e Outros sem complemento.
3. Aprovar como gestor e confirmar ausência de versões, assinatura, ZapSign, PDF/DOCX e derivados.

## Cenário 6 — Estatísticas Sede

1. Misturar aprovados, pendentes e devolvidos dentro/fora do período.
2. Conferir 5002 (relatórios, manutenções, horas, HE, colaboradores, perfis, equipamentos) e 5004 (relatórios, horas, HE, colaboradores, kg, materiais).
3. Confirmar que os cards financeiros não mudaram.

## Cenário 7 — Módulo e histórico consolidado

1. Criar manutenções aprovadas por RDO e avulsa em equipamentos distintos.
2. Abrir “Histórico de manutenção” e conferir ordem, data, TAG, equipamento, categoria/perfil, responsável e serviços.
3. Alternar os cabeçalhos ordenáveis entre crescente e decrescente e confirmar que `sort` e `direction` permanecem na URL e valem para todas as páginas.
4. Buscar por TAG, nome e categoria, paginar e atualizar a página preservando `tab`, `q`, `page`, `sort` e `direction`.
5. Abrir os PDFs disponíveis e confirmar que item sem documento não apresenta link quebrado.

## Cenário 8 — Mobile e novidade

1. Em 360 px, percorrer abas, formulários, históricos em cards, configuração e Sede sem scroll horizontal.
2. Confirmar erros junto aos campos e ações acessíveis.
3. Confirmar tutorial permanente somente na primeira entrada por usuário/navegador e selo/campanha temporária nunca depois de 2026-09-14.
4. Em desktop, confirmar que o módulo usa a largura operacional, enquanto os formulários mantêm leitura confortável.
5. Conferir o asterisco vermelho em todos os campos obrigatórios fixos e condicionais de manutenção, produção, turno noturno, terceiros e material “Outros”.

## Cenário 9 — Programação preventiva

1. No painel Manutenção de Equipamentos, configurar intervalos diferentes para duas categorias e remover o intervalo de uma terceira.
2. Criar manutenções aprovadas, pendentes e devolvidas para o mesmo equipamento e confirmar que somente a aprovada mais recente define a última manutenção.
3. Abrir “Programação”, conferir agrupamento por categoria, última/próxima data e filtros por busca, categoria e situação preservados na URL.
4. Confirmar os estados Vencida, Vence hoje, Em dia, Sem histórico e Não configurado; somente Vencida deve receber o destaque vermelho.
5. Em desktop e 360 px, rolar a página e confirmar que os menus não se sobrepõem; a tabela deve virar cartões sem scroll horizontal.
