# Research: obras disponíveis no romaneio

## Decisões

- A disponibilidade de Saída reutiliza o cálculo completo do gate. Consultar somente etapa ou data de autorização aceitaria versões suspensas.
- A consulta carrega os dados do workflow junto com os candidatos de Saída e filtra em memória, evitando uma consulta por projeto.
- Candidatos de Saída são pré-filtrados no banco para projetos ativos ou com workflow; legado inativo não precisa carregar relações.
- Entrada usa somente visibilidade e exclusão lógica. O número de entradas anteriores não determina encerramento.
- A validação de gravação permanece independente da lista para impedir contorno por requisição direta ou estado antigo do navegador.
- A criação automática de projeto por código foi removida da Saída porque geraria um legado ativo e contornaria a seleção autorizada.
