import { loadRequestSource } from '../operations/request-sources.js';
import { readVerifiedCostSource } from './verified-cost-sources.js';

// These three catalogs are global, with no project-owned relations. Keep
// project/report/period reads on their protected Prisma paths. One statement
// reads the same selected columns without three independent round trips and
// the nested parameter-set query. Inactive profiles are intentionally retained.
export function loadCostReferenceSources(database) {
  return loadRequestSource(database, 'labor.cost-reference-rows', () =>
    readVerifiedCostSource(database, 'labor.cost-reference-rows', async () => {
      const [row] = await database.$queryRaw`
        /* labor.cost-reference-rows */
        SELECT
          (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name)), '[]'::jsonb)
            FROM "public"."JobRole" r) AS roles,
          (SELECT COALESCE(jsonb_agg(jsonb_build_object('key', p.key, 'jobRoleId', p."jobRoleId",
            'parameterSets', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'version', s.version, 'effectiveDate', s."effectiveDate", 'createdAt', s."createdAt", 'params', s.params)), '[]'::jsonb)
              FROM "public"."CostParameterSet" s WHERE s."costProfileId" = p.id))), '[]'::jsonb)
            FROM "public"."CostProfile" p) AS profiles,
          (SELECT COALESCE(jsonb_agg(jsonb_build_object('key', s.key, 'numberValue', s."numberValue")), '[]'::jsonb)
            FROM "public"."AcompanhamentoSetting" s
            WHERE s.key IN ('epiAnnualCost', 'examsTrainingAnnualCost', 'offshoreExamsTrainingAnnualCost')) AS settings
      `;
      return { ...row, profiles: row.profiles.map(profile => ({ ...profile,
        parameterSets: profile.parameterSets.map(set => ({ ...set,
          // PostgreSQL DATE and timestamp-without-time-zone JSON values do not
          // contain a zone. Match Prisma's UTC Date values, including millis.
          effectiveDate: new Date(set.effectiveDate + 'T00:00:00.000Z'),
          createdAt: new Date(set.createdAt + 'Z')
        }))
      })) };
    }));
}
