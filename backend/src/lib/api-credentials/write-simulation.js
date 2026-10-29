import { IntegrationApiError } from '../../middleware/api-request-context.js';
import { apiWriteContext } from './write-context.js';
import { projectWritePreview } from './write-previews.js';

class SimulationRollback extends Error {
  constructor(result) { super('API write simulation rollback'); this.result = result; }
}

class SimulationRetry extends Error {
  constructor(cause) { super('Retry entire simulation transaction', { cause }); }
}

function transactionClient(tx) {
  // Serviços existentes podem abrir transações internas. Todas reutilizam o
  // cliente recebido; nenhuma pode confirmar dados fora do rollback externo.
  let client;
  client = new Proxy(tx, {
    get(target, key) {
      if (key === '$transaction') return async operation => {
        try {
          return await (typeof operation === 'function' ? operation(client) : Promise.all(operation));
        } catch (error) {
          // Não repetir queries numa transação PostgreSQL já abortada. Os
          // retries dos serviços precisam reiniciar a transação externa inteira.
          if (['P2034', 'P2002'].includes(error?.code)) throw new SimulationRetry(error);
          throw error;
        }
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  return client;
}

export async function executeApiWrite(database, { operation, simulated, requestId, execute }) {
  if (!simulated) return execute(database);
  if (operation.simulation?.strategy !== 'rollback' || typeof database.$transaction !== 'function') {
    throw new IntegrationApiError(501, 'SIMULATION_NOT_SUPPORTED', 'A operação não suporta simulação.');
  }
  return apiWriteContext.run({ simulated: true }, async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        await database.$transaction(async tx => {
          const client = transactionClient(tx);
          const result = await execute(client);
          const would = await projectWritePreview(client, operation.operationId, result.body);
          throw new SimulationRollback({ ...result, statusCode: 200, outcomeCode: 'SIMULATED',
            body: { simulated: true, operation: operation.operationId, would, warnings: [], requestId } });
        }, { isolationLevel: 'Serializable', timeout: 15_000 });
        // Falhar fechado mesmo com adaptador que indevidamente engula a sentinela.
        throw new Error('A transação de simulação não confirmou o rollback.');
      } catch (error) {
        if (error instanceof SimulationRollback) return error.result;
        const failure = error instanceof SimulationRetry ? error.cause : error;
        if (!['P2034', 'P2002'].includes(failure?.code)) throw failure;
        const maxRetries = operation.operationId === 'acompanhamento.opportunities.post' ? 4 : 2;
        if (attempt < maxRetries) continue;
        if (operation.operationId === 'acompanhamento.opportunities.post') {
          throw new IntegrationApiError(409, 'CONCURRENT_UPDATE', 'Outra atualização está em andamento. Reenvie o mesmo evento.');
        }
        throw failure;
      }
    }
  });
}
