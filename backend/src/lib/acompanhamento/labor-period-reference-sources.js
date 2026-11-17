import { Prisma } from '@prisma/client';
import { corporateDateKey, resolveCorporateCalendar } from '../calendar/corporate-calendar.js';
import { loadRequestSource } from '../operations/request-sources.js';
import { readVerifiedCostSource } from './verified-cost-sources.js';

// Only global reference tables. Absences, allocation/period rows and projects
// continue through their existing protected reads. Prefetching this packet does
// not depend on the roster and avoids three separate catalog round trips.
export function loadLaborPeriodReferences(database, { startDate, endDate, includeIgnoredNames = false, includeWorkforceDetails = true }) {
  const start = corporateDateKey(startDate), end = corporateDateKey(endDate);
  // Both request-owned and verified reference caches must distinguish the
  // reduced packet from the complete one required by full point/snapshots.
  const key = ['labor.period-reference-rows', start, end, includeIgnoredNames, includeWorkforceDetails];
  return loadRequestSource(database, key, () => readVerifiedCostSource(database, key, async () => {
    if (end < start) throw new TypeError('O fim do calendário não pode anteceder o início.');
    const calendarColumns = includeWorkforceDetails ? Prisma.sql`,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', h.id, 'holidayDate', h."holidayDate", 'name', h.name)
        ORDER BY h."holidayDate" ASC), '[]'::jsonb)
        FROM "public"."WorkforceHoliday" h WHERE h."deletedAt" IS NULL
          AND h."holidayDate" >= ${new Date(start + 'T00:00:00.000Z')}
          AND h."holidayDate" <= ${new Date(end + 'T00:00:00.000Z')}) AS holidays,
      (SELECT s.revision FROM "public"."WorkforceCalendarState" s WHERE s.id = 'global') AS revision
    ` : Prisma.empty;
    const [row] = await database.$queryRaw`
      /* labor.period-reference-rows */
      SELECT
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('externalEmployeeId', e."externalEmployeeId")
          || CASE WHEN ${includeIgnoredNames} THEN jsonb_build_object('externalName', e."externalName") ELSE '{}'::jsonb END), '[]'::jsonb)
          FROM "public"."PontoExternalEmployee" e WHERE e."ignoredAt" IS NOT NULL) AS ignored
        ${calendarColumns}
    `;
    return { ignoredEmployees: row.ignored, calendar: includeWorkforceDetails ? resolveCorporateCalendar({
      startDate: start, endDate: end, revision: row.revision || 1,
      manualHolidays: row.holidays.map(holiday => ({ ...holiday,
        holidayDate: new Date(holiday.holidayDate + 'T00:00:00.000Z')
      }))
    }) : null };
  }));
}
