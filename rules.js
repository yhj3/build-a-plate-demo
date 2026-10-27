// Pure nutrition logic: no DOM, no three.js. Imported by main.js in the browser
// and by tests/rules.test.js under `node --test`.

export const GROUPS = ['vegetable', 'fruit', 'protein', 'grain', 'dairy', 'treat'];

/** Totals, per-group counts, per-label counts and macro percentages for a list of foods. */
export function summarize(foods) {
  const s = { count: foods.length, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, groups: {}, labels: new Map() };
  for (const g of GROUPS) s.groups[g] = 0;
  for (const f of foods) {
    s.kcal += f.kcal;
    s.protein_g += f.protein_g;
    s.carbs_g += f.carbs_g;
    s.fat_g += f.fat_g;
    s.groups[f.group] = (s.groups[f.group] || 0) + 1;
    s.labels.set(f.label, (s.labels.get(f.label) || 0) + 1);
  }
  // Percent of calories from each macro, relative to the macro-derived total (not to kcal).
  const p = s.protein_g * 4;
  const c = s.carbs_g * 4;
  const f = s.fat_g * 9;
  const sum = p + c + f;
  s.pct = sum
    ? { protein: (p / sum) * 100, carbs: (c / sum) * 100, fat: (f / sum) * 100 }
    : { protein: 0, carbs: 0, fat: 0 };
  return s;
}

const PRAISE = 'Good produce coverage.';

/** Spec §8: ordered rules; returns the first two that fire. */
export function coachNotes(s) {
  if (s.count === 0) return ['Add some food first.'];
  const g = s.groups;
  const rules = [
    [g.vegetable === 0, 'No vegetables yet — aim for at least two servings on the plate.'],
    [g.vegetable >= 2 && g.fruit >= 1, PRAISE],
    [s.pct.protein < 15, 'Protein is on the low side; consider adding a protein source.'],
    [s.pct.fat > 40, 'More than 40% of calories come from fat — try swapping a high-fat item.'],
    [g.treat >= 2, 'Two or more treats: fine occasionally, but not as the base of a meal.'],
    [s.kcal > 900, "This plate is over 900 kcal; that's a lot for a single meal for most people."],
  ];
  const fired = rules.filter(([cond]) => cond).map(([, msg]) => msg);
  // "Good produce coverage" is praise, not a warning, so it does not block "Looks balanced".
  if (fired.every((m) => m === PRAISE)) fired.push('Looks balanced for a single meal.');
  return fired.slice(0, 2);
}

/** Named numbers a scenario goal can test against. */
export function metrics(s) {
  const m = {
    kcal: s.kcal,
    pct_protein: s.pct.protein,
    pct_carbs: s.pct.carbs,
    pct_fat: s.pct.fat,
    produce_share: s.count ? ((s.groups.vegetable + s.groups.fruit) / s.count) * 100 : 0,
  };
  for (const g of GROUPS) m[`count_${g}`] = s.groups[g];
  return m;
}

export const OPS = {
  '<=': (a, b) => a <= b,
  '>=': (a, b) => a >= b,
  '<': (a, b) => a < b,
  '>': (a, b) => a > b,
  '==': (a, b) => a === b,
};

/** Human-readable value for a metric, e.g. "33%" or "403 kcal". */
export function formatMetric(name, value) {
  if (name === 'kcal') return `${Math.round(value)} kcal`;
  if (name.startsWith('pct_') || name === 'produce_share') return `${Math.round(value)}%`;
  return String(value);
}

/** Check every goal of a scenario: [{ label, met, actual }]. A scenario with no goals returns []. */
export function evaluateScenario(s, scenario) {
  const m = metrics(s);
  return (scenario.goals || []).map((goal) => {
    if (!(goal.metric in m)) throw new Error(`Unknown metric "${goal.metric}" in scenario "${scenario.id}"`);
    if (!(goal.op in OPS)) throw new Error(`Unknown operator "${goal.op}" in scenario "${scenario.id}"`);
    return { label: goal.label, met: OPS[goal.op](m[goal.metric], goal.value), actual: formatMetric(goal.metric, m[goal.metric]) };
  });
}
