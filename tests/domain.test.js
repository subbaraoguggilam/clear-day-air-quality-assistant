import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAqi, bestWindow, buildHourlyChart, cigaretteEquivalent } from '../src/domain/aqi.js';
import { buildConstraints, fallbackAdvice } from '../src/domain/rules.js';
import { estimateImpact } from '../src/domain/impact.js';
import { validateAdvice } from '../src/services/llm.js';
import { parseRequest } from '../src/api/validate.js';

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
