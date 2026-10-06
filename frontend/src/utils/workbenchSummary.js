const sum = (arr, fn) => (arr || []).reduce((s, x) => s + (fn(x) || 0), 0);

// The Workbench's global Income / Must / Want / Save / leftover figures. Mirrored server-side by
// summarizeWorkbenchData in backend/src/routes/ai-advisor.js (the AI Advisor's view of saved
// snapshots) — keep the two in step.
//
// Classification is optional, so an expense can be neither Must nor Want. It still costs money:
// it's reported as `totalUnclassified` and taken off the leftover, which used to ignore it and so
// overstated what was left (#357).
export function computeGlobalSummary(state) {
  const monthly = state.monthlyExpenses || [];
  const annual = state.annualExpenses || [];
  const isClassified = (e) => e.classification === 'must' || e.classification === 'want';

  const totalIncome = sum(state.income, (e) => e.value);

  const monthlyMust = sum(monthly.filter((e) => e.classification === 'must'), (e) => e.value);
  const monthlyWant = sum(monthly.filter((e) => e.classification === 'want'), (e) => e.value);
  const monthlyUnclassified = sum(monthly.filter((e) => !isClassified(e)), (e) => e.value);

  const annualMustAvg = sum(annual.filter((e) => e.classification === 'must'), (e) => e.value / 12);
  const annualWantAvg = sum(annual.filter((e) => e.classification === 'want'), (e) => e.value / 12);
  const annualUnclassifiedAvg = sum(annual.filter((e) => !isClassified(e)), (e) => e.value / 12);

  const distMust = sum(state.distributions, (e) => e.must_amount || 0);
  const distWant = sum(state.distributions, (e) => e.want_amount || 0);
  const distSave = sum(state.distributions, (e) => e.save_amount || 0);

  const totalMust = monthlyMust + annualMustAvg + distMust;
  const totalWant = monthlyWant + annualWantAvg + distWant;
  const totalSave = distSave;
  const totalUnclassified = monthlyUnclassified + annualUnclassifiedAvg;
  const leftover = totalIncome - totalMust - totalWant - totalSave - totalUnclassified;

  return { totalIncome, totalMust, totalWant, totalSave, totalUnclassified, leftover };
}
