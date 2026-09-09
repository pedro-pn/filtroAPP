# Contrato: projetos disponíveis no romaneio

## `GET /api/romaneio/projects?type=OUTBOUND|INBOUND`

- `OUTBOUND`: retorna projetos gerenciados autorizados e projetos sem workflow com `isActive=true`.
- `INBOUND`: retorna todos os projetos acessíveis, independentemente de `isActive`, workflow, autorização ou entradas anteriores.
- Em ambos os casos, `deletedAt` e `managerOnly` continuam respeitando o usuário autenticado.
- A resposta mantém o formato público atual de projeto e não inclui o workflow usado no cálculo.

## Gravação

- `POST/PUT` de Saída recalcula a autorização e rejeita legado concluído com HTTP 409.
- `POST/PUT` de Saída não cria projeto pendente a partir de código desconhecido.
- `POST/PUT` de Entrada permanece sem gate de mobilização.
