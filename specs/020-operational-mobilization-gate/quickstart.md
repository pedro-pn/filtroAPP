# Quickstart: validação da entrega 020

1. Em projeto sem gestão iniciada, criar saída de estoque, romaneio de saída e mobilizar missão oficial; as operações continuam disponíveis.
2. Iniciar a gestão desse projeto e repetir sem autorização; todas as saídas retornam conflito e nenhum dado é alterado.
3. Concluir D-15, autorizar e repetir; as operações são aceitas.
4. Alterar um checklist, suspendendo a autorização, e confirmar novo bloqueio.
5. Com gate bloqueado, registrar entrada de romaneio e devolução de estoque; ambas são aceitas.
6. Em cenário hipotético, mover missão para Mobilização; a simulação continua disponível.
7. Reordenar missão já na mesma etapa; a posição muda sem revalidar o gate.
8. Conferir mensagem pt-BR em desktop e 390 px.

## Commands

```bash
cd backend
DATABASE_URL=postgresql://test:test@localhost:5432/test node --test test/project-operational-mobilization-gate.test.js test/efetivo-mission-kanban.test.js test/estoque-movements-saida.test.js test/romaneio-stock-integration.test.js
npm test

cd ../frontend
npm test
npm run lint
npm run build

cd ..
npm run architecture:check
```
