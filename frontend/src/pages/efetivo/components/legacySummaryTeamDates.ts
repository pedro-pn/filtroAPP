type MissionDates = {
  mobilizationDate: string | null;
  executionStartDate: string | null;
  executionEndDate: string | null;
  returnDate: string | null;
};

function dateOnly(value: string | null | undefined) {
  return value?.slice(0, 10) || '';
}

export function resolveLegacySummaryTeamDates(
  fullMission: MissionDates | null,
  summary: MissionDates,
  form: { startDate: string; endDate: string; demobilizationDate: string },
  today: string
) {
  const mobilizationDate = dateOnly(fullMission?.mobilizationDate) || dateOnly(summary.mobilizationDate) || form.startDate;
  const originalExecutionStart = dateOnly(fullMission?.executionStartDate) || dateOnly(summary.executionStartDate);
  const executionStartDate = originalExecutionStart >= mobilizationDate ? originalExecutionStart : mobilizationDate;
  const originalExecutionEnd = dateOnly(fullMission?.executionEndDate) || dateOnly(summary.executionEndDate);
  const executionEndDate = originalExecutionEnd >= executionStartDate ? originalExecutionEnd
    : [form.demobilizationDate, form.endDate, today, executionStartDate]
      .find(date => date && date >= executionStartDate) || executionStartDate;
  const originalReturn = dateOnly(fullMission?.returnDate) || dateOnly(summary.returnDate);
  const returnDate = originalReturn >= executionEndDate ? originalReturn : null;

  return {
    mobilizationDate,
    executionStartDate,
    executionEndDate,
    returnDate,
    teamEndDate: returnDate || executionEndDate
  };
}
