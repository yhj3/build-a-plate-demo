// Run with `node --test` (Node 18+). Covers the spec's acceptance cases and the scenario goals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summarize, coachNotes, evaluateScenario, metrics, OPS } from '../rules.js';

const foods = JSON.parse(readFileSync(new URL('../foods.json', import.meta.url)));
const scenarios = JSON.parse(readFileSync(new URL('../scenarios.json', import.meta.url)));
const byId = Object.fromEntries(foods.map((f) => [f.id, f]));
const plate = (...ids) => ids.map((id) => byId[id]);
const byScenario = Object.fromEntries(scenarios.map((s) => [s.id, s]));

test('foods.json has the eight spec foods with sane nutrition', () => {
  assert.deepEqual(foods.map((f) => f.id), ['apple', 'broccoli', 'carrot', 'chicken', 'egg', 'rice', 'cheese', 'donut']);
  for (const f of foods) {
    assert.ok(f.kcal > 0 && f.kcal < 600, `${f.id} kcal`);
    assert.ok(['vegetable', 'fruit', 'protein', 'grain', 'dairy', 'treat'].includes(f.group), `${f.id} group`);
  }
});

test('empty plate summarizes to zeros and asks for food', () => {
  const s = summarize([]);
  assert.equal(s.kcal, 0);
  assert.deepEqual(s.pct, { protein: 0, carbs: 0, fat: 0 });
  assert.deepEqual(coachNotes(s), ['Add some food first.']);
});

test('macro percentages are relative to macro calories and sum to 100', () => {
  const s = summarize(plate('chicken', 'rice', 'cheese'));
  assert.equal(s.kcal, 165 + 215 + 115);
  const total = s.pct.protein + s.pct.carbs + s.pct.fat;
  assert.ok(Math.abs(total - 100) < 1e-9);
});

test('all eight foods: 1023 kcal and the over-900 rule fires', () => {
  const s = summarize(foods);
  assert.equal(s.kcal, 1023);
  const notes = coachNotes(s);
  assert.equal(notes[0], 'Good produce coverage.');
  assert.match(notes[1], /over 900 kcal/);
});

test('donut + cheese: fat is over 40%, but the first two rules in spec order win', () => {
  const s = summarize(plate('donut', 'cheese'));
  assert.ok(s.pct.fat > 40);
  const notes = coachNotes(s);
  assert.equal(notes.length, 2);
  assert.match(notes[0], /^No vegetables yet/);
  assert.match(notes[1], /^Protein is on the low side/);
});

test('broccoli x2, carrot, apple, chicken, rice reads as balanced', () => {
  const s = summarize(plate('broccoli', 'broccoli', 'carrot', 'apple', 'chicken', 'rice'));
  assert.equal(s.kcal, 635);
  assert.deepEqual(coachNotes(s), ['Good produce coverage.', 'Looks balanced for a single meal.']);
});

test('every scenario goal uses a known metric and operator', () => {
  const known = metrics(summarize([]));
  for (const sc of scenarios) {
    for (const g of sc.goals) {
      assert.ok(g.metric in known, `${sc.id}: metric ${g.metric}`);
      assert.ok(g.op in OPS, `${sc.id}: op ${g.op}`);
      assert.equal(typeof g.value, 'number', `${sc.id}: value`);
      assert.equal(typeof g.label, 'string', `${sc.id}: label`);
    }
  }
});

test('free build has no goals', () => {
  assert.deepEqual(evaluateScenario(summarize(plate('apple')), byScenario.free), []);
});

test('diabetes lunch: chicken, egg, broccoli x2, carrot meets every goal', () => {
  const s = summarize(plate('chicken', 'egg', 'broccoli', 'broccoli', 'carrot'));
  const results = evaluateScenario(s, byScenario.diabetes);
  assert.equal(results.length, 4);
  assert.ok(results.every((r) => r.met), JSON.stringify(results));
});

test('diabetes lunch: adding a donut fails the treat goal and reports the current value', () => {
  const s = summarize(plate('chicken', 'broccoli', 'broccoli', 'donut'));
  const results = evaluateScenario(s, byScenario.diabetes);
  const treat = results.find((r) => r.label === 'No treats');
  assert.equal(treat.met, false);
  assert.equal(treat.actual, '1');
  const carbs = results.find((r) => r.label.startsWith('Carbs'));
  assert.match(carbs.actual, /^\d+%$/);
});

test('recovery meal: chicken, egg, broccoli, rice is high-protein and under 800 kcal', () => {
  const s = summarize(plate('chicken', 'egg', 'broccoli', 'rice'));
  const results = evaluateScenario(s, byScenario.recovery);
  assert.ok(results.every((r) => r.met), JSON.stringify(results));
});

test('MyPlate balance: half produce plus grain, protein and dairy', () => {
  const s = summarize(plate('broccoli', 'carrot', 'apple', 'rice', 'chicken', 'cheese'));
  const results = evaluateScenario(s, byScenario.myplate);
  assert.ok(results.every((r) => r.met), JSON.stringify(results));
  const sNoDairy = summarize(plate('broccoli', 'carrot', 'apple', 'rice', 'chicken'));
  assert.equal(evaluateScenario(sNoDairy, byScenario.myplate).find((r) => r.label === 'A dairy serving').met, false);
});
