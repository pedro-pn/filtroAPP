# Quickstart: validação do Kanban único

1. Validar e gerar o cliente Prisma no backend.
2. Executar os testes de workflow, sincronização da missão, gate e Romaneio.
3. Executar os testes do Kanban e da campanha temporária no frontend.
4. Executar as suítes completas de backend e frontend.
5. Executar lint, build e verificação arquitetural.
6. Atualizar o grafo e revisar alterações e fluxos afetados.

## Cenários manuais essenciais

- Evolução abre diretamente um único Kanban.
- Projeto legado aparece na coluna correspondente à missão, pode avançar pelo detalhe do card e não recebe autorização presumida.
- Projeto pronto e autorizado avança para Mobilização e Execução.
- Programação ausente ou incompleta bloqueia a entrada operacional com mensagem clara.
- O atalho do projeto abre Missões para editar equipe, ciclos e datas.
- O card mostra líder, datas e participantes, permite expandir a equipe e abre o modal de equipe e ciclos.
- Arrastar no desktop, manter pressionado no toque e usar o seletor móvel produzem a mesma mudança de etapa.
- Uma mudança bloqueada mantém o card na origem e informa os motivos do bloqueio.
- Pressionar ou começar a arrastar não abre o detalhe; soltá-lo em outra coluna abre o diálogo.
- `Programar equipe` abre o formulário sobre o Kanban e mantém o usuário em Evolução.
