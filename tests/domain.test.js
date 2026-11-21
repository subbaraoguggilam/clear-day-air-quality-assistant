import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAqi, bestWindow, buildHourlyChart, cigaretteEquivalent, detectTrend } from '../src/domain/aqi.js';
import { buildConstraints, fallbackAdvice, getAlertBanner, getDiyFilterGuide } from '../src/domain/rules.js';
import { estimateImpact } from '../src/domain/impact.js';
import { validateAdvice } from '../src/services/llm.js';
import { parseRequest } from '../src/api/validate.js';
import { evaluateRiskModel, computeShapValues, generateShapAdvice, BASELINE_RISK } from '../src/domain/shap.js';

const base = { children: false, elderly: false, asthma: false, pregnancy: false, commute: 'two_wheeler', cooking: 'lpg', distanceKm: 10 };

test('classifies AQI band edges with color fields', () => {
  assert.equal(classifyAqi(50).key, 'good');
  assert.equal(classifyAqi(50).color, '#22C55E');
  assert.equal(classifyAqi(51).key, 'moderate');
  assert.equal(classifyAqi(301).key, 'hazardous');
  assert.throws(() => classifyAqi(-1), RangeError);
});

test('cigarette equivalent rounds correctly', () => {
  assert.equal(cigaretteEquivalent(22), 1);
  assert.equal(cigaretteEquivalent(44), 2);
  assert.equal(cigaretteEquivalent(0), 0);
});

test('buildHourlyChart returns 24 data points starting from now', () => {
  const times = Array.from({ length: 48 }, (_, i) => `2026-11-18T${String(i % 24).padStart(2, '0')}:00`);
  const pm25  = times.map(() => 50);
  const chart = buildHourlyChart(times, pm25, '2026-11-18T08:00');
  assert.equal(chart.length, 24);
  assert.equal(chart[0].hour, 8);
});

test('finds the cleanest two hour window', () => {
  const times = Array.from({ length: 24 }, (_, i) => `2026-11-18T${String(i).padStart(2, '0')}:00`);
  const pm = times.map((_, i) => (i === 13 || i === 14 ? 30 : 120));
  assert.deepEqual(bestWindow(times, pm, '2026-11-18T08:00'), { startHour: 13, endHour: 15, pm25: 30 });
});

test('hazardous air forces stay indoors and no outdoor exercise', () => {
  const ids = buildConstraints(320, base).map((c) => c.id);
  assert.ok(ids.includes('stay_in') && ids.includes('no_outdoor_exercise'));
  assert.equal(buildConstraints(40, base).length, 0);
});

test('sensitive households get a mask rule at AQI 120', () => {
  assert.ok(buildConstraints(120, { ...base, children: true }).some((c) => c.id === 'mask'));
  assert.ok(!buildConstraints(120, base).some((c) => c.id === 'mask'));
});

test('computes CO2 saved by swapping a 10 km scooter commute to metro', () => {
  assert.equal(estimateImpact(base, 100, null).co2.savedKgDay, 0.3);
  assert.equal(estimateImpact({ ...base, commute: 'wfh' }, 100, null).co2, null);
});

test('safety validator rejects exertion advice at unhealthy AQI only', () => {
  const raw = (action) => ({
    summary: 'Plan', routine: [{ time: '7am', action, why: 'Fresh air' }],
    indoor_hacks: [{ tip: 'Close windows', impact: 'Less dust' }], alternatives: [{ swap: 'Metro', benefit: 'Lower CO₂' }],
  });
  assert.throws(() => validateAdvice(raw('Go for a jog in the park'), 180));
  assert.doesNotThrow(() => validateAdvice(raw('Go for a jog in the park'), 40));
});

test('rule based fallback always passes the safety validator', () => {
  const impact = estimateImpact(base, 200, null);
  const constraints = buildConstraints(320, base);
  assert.doesNotThrow(() => validateAdvice(fallbackAdvice({ aqi: 320, constraints, bestWindow: null, impact }), 320));
});

test('request validation whitelists fields', () => {
  const ok = { city: 'Anantapur', profile: { commute: 'bus', cooking: 'lpg', distanceKm: 5 } };
  assert.equal(parseRequest(ok).location.city, 'Anantapur');
  assert.throws(() => parseRequest({ ...ok, profile: { ...ok.profile, commute: 'rocket' } }));
  assert.throws(() => parseRequest({ city: 'x', profile: ok.profile }));
});

test('detectTrend returns rising when late PM2.5 exceeds early by more than 5', () => {
  const chart = Array.from({ length: 6 }, (_, i) => ({ pm25: i < 2 ? 20 : 30, hour: 8 + i }));
  assert.equal(detectTrend(chart), 'rising');
});

test('detectTrend returns falling when late PM2.5 drops by more than 5', () => {
  const chart = Array.from({ length: 6 }, (_, i) => ({ pm25: i < 2 ? 50 : 30, hour: 8 + i }));
  assert.equal(detectTrend(chart), 'falling');
});

test('detectTrend returns stable when difference is small', () => {
  const chart = Array.from({ length: 6 }, (_, i) => ({ pm25: 25, hour: 8 + i }));
  assert.equal(detectTrend(chart), 'stable');
});

test('getAlertBanner returns emergency for AQI > 300', () => {
  assert.equal(getAlertBanner(310, false).level, 'emergency');
  assert.equal(getAlertBanner(310, false).color, '#7F1D1D');
});

test('getAlertBanner returns danger for AQI 201-300', () => {
  assert.equal(getAlertBanner(250, false).level, 'danger');
});

test('getAlertBanner returns caution for sensitive household at AQI 110', () => {
  assert.equal(getAlertBanner(110, true).level, 'caution');
  assert.equal(getAlertBanner(110, false), null);
});

test('getAlertBanner returns null for good air quality', () => {
  assert.equal(getAlertBanner(40, false), null);
  assert.equal(getAlertBanner(40, true), null);
});

test('getDiyFilterGuide has required fields', () => {
  const guide = getDiyFilterGuide();
  assert.ok(guide.title);
  assert.ok(guide.cost);
  assert.ok(Array.isArray(guide.steps) && guide.steps.length > 0);
  assert.ok(Array.isArray(guide.materials) && guide.materials.length > 0);
});

test('estimateImpact healthScore is clamped between 0 and 100', () => {
  assert.ok(estimateImpact(base, 0, null).healthScore <= 100);
  assert.ok(estimateImpact(base, 300, null).healthScore >= 0);
});

test('estimateImpact exposure cutPct is between 0 and 100', () => {
  const { exposure } = estimateImpact(base, 80, { pm25: 20, startHour: 9, endHour: 11 });
  assert.ok(exposure.cutPct >= 0 && exposure.cutPct <= 100);
});

test('evaluateRiskModel produces baseline when no risk factors present', () => {
  const risk = evaluateRiskModel({ aqi: 50, sensitive: false, commuteExposure: false, biomassFuel: false });
  assert.equal(risk, BASELINE_RISK);
});

test('computeShapValues returns non-negative Shapley values for positive risk factors', () => {
  const shap = computeShapValues({ aqi: 180, profile: { ...base, children: true, cooking: 'wood' } });
  assert.equal(shap.baseline, BASELINE_RISK);
  assert.ok(shap.predictedRisk > BASELINE_RISK);
  assert.equal(shap.features.length, 4);
  const sumShap = shap.features.reduce((acc, f) => acc + f.shapValue, 0);
  assert.ok(Math.abs(shap.predictedRisk - (shap.baseline + sumShap)) < 1.0);
});

test('generateShapAdvice adheres to safety validator', () => {
  const ctx = {
    label: 'Delhi',
    air: { aqi: 220, pm25: 140, pm10: 200, no2: 30, o3: 20 },
    band: classifyAqi(220),
    bestWindow: { startHour: 13, endHour: 15, pm25: 80 },
    constraints: buildConstraints(220, base),
    profile: base,
    impact: estimateImpact(base, 140, { startHour: 13, endHour: 15, pm25: 80 }),
  };
  const advice = generateShapAdvice(ctx);
  assert.ok(advice.summary.includes('SHAP'));
  assert.doesNotThrow(() => validateAdvice(advice, 220));
});
