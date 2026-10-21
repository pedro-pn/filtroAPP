import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import YAML from 'yaml';
import { crmPlanningSnapshotSchema } from '../src/lib/projects/crm-planning-schema.js';

// Gera somente a estrutura. Invariantes entre campos/transições estão no validador e no guia.
const schema = z.toJSONSchema(crmPlanningSnapshotSchema, { unrepresentable: 'any' });
schema.properties.opportunity.properties.recordUrl.pattern = '^https?://';
await writeFile(new URL('../../docs/prisma-planning.schema.json', import.meta.url), JSON.stringify(schema, null, 2) + '\n');
const { $schema, ...openapiSchema } = schema;
const target = new URL('../../specs/015-api-token-playground/contracts/openapi.yaml', import.meta.url);
const source = await readFile(target, 'utf8');
const start = source.indexOf('    CrmOpportunityInput:\n');
const end = source.indexOf('    CrmOpportunityResult:\n', start);
if (start < 0 || end < start) throw new Error('Marcadores do contrato ausentes.');
const fragment = YAML.stringify({ CrmOpportunityInput: openapiSchema }, { lineWidth: 120 }).split('\n').map(line => line ? '    ' + line : '').join('\n');
await writeFile(target, source.slice(0, start) + fragment + source.slice(end));
