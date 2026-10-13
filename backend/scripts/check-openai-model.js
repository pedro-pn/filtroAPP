// Confere se a chave da OpenAI funciona e se OPENAI_MODEL está disponível para a conta.
// Não gera texto (consulta de modelo, sem custo). Uso: npm run openai:check
import OpenAI from 'openai';

import env from '../src/config/env.js';

if (!env.openaiApiKey) {
  console.error('OPENAI_API_KEY não configurada.');
  process.exit(1);
}

try {
  const client = new OpenAI({ apiKey: env.openaiApiKey, timeout: env.openaiTimeoutMs });
  const modelo = await client.models.retrieve(env.openaiModel);
  console.log(`OK: modelo "${modelo.id}" disponível (dono: ${modelo.owned_by}).`);
} catch (error) {
  console.error(`Falha ao validar o modelo "${env.openaiModel}": ${error.status || ''} ${error.message}`);
  process.exit(1);
}
