import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest, AppError } from '../src/api/validate.js';
import { buildConstraints, forbiddenPattern, getAlertBanner, getDiyFilterGuide, fallbackAdvice } from '../src/domain/rules.js';
import { estimateImpact, ASSUMPTIONS, G_PER_KM } from '../src/domain/impact.js';
import { classifyAqi, bestWindow, buildHourlyChart, cigaretteEquivalent, detectTrend } from '../src/domain/aqi.js';
import { evaluateRiskModel, computeShapValues, generateShapAdvice, BASELINE_RISK } from '../src/domain/shap.js';
import { validateAdvice } from '../src/services/llm.js';

const mockProfile = {
  children: true,
  elderly: false,
  asthma: true,
  pregnancy: false,
  commute: 'two_wheeler',
  cooking: 'lpg',
  distanceKm: 12,
};

// ── Validation Suite ───────────────────────────────────────────
test('parseRequest throws on non-object payload', () => {
  assert.throws(() => parseRequest(null), /required/i);
  assert.throws(() => parseRequest('string'), /required/i);
});

test('parseRequest validates lat/lon ranges strictly', () => {
  assert.throws(() => parseRequest({ lat: 95, lon: 77 }), /Latitude must be a number from -90 to 90/);
  assert.throws(() => parseRequest({ lat: 15, lon: 190 }), /Longitude must be a number from -180 to 180/);
  const ok = parseRequest({ lat: 15.5, lon: 78.4, profile: mockProfile });
  assert.equal(ok.location.lat, 15.5);
  assert.equal(ok.location.lon, 78.4);
});

test('parseRequest enforces commute distance limits (0 to 100 km)', () => {
  assert.throws(() => parseRequest({ city: 'Delhi', profile: { ...mockProfile, distanceKm: -5 } }), /distance/i);
  assert.throws(() => parseRequest({ city: 'Delhi', profile: { ...mockProfile, distanceKm: 150 } }), /distance/i);
});

test('parseRequest validates cooking fuels', () => {
  assert.throws(() => parseRequest({ city: 'Delhi', profile: { ...mockProfile, cooking: 'kerosene' } }), /cooking fuel/i);
  assert.doesNotThrow(() => parseRequest({ city: 'Delhi', profile: { ...mockProfile, cooking: 'wood' } }));
  assert.doesNotThrow(() => parseRequest({ city: 'Delhi', profile: { ...mockProfile, cooking: 'induction' } }));
});

test('parseRequest validates question length in Q&A mode', () => {
  assert.throws(() => parseRequest({ city: 'Delhi', profile: mockProfile, question: '' }, { needQuestion: true }), /question/i);
  const longQ = 'a'.repeat(305);
  assert.throws(() => parseRequest({ city: 'Delhi', profile: mockProfile, question: longQ }, { needQuestion: true }), /question/i);
  const ok = parseRequest({ city: 'Delhi', profile: mockProfile, question: 'Is it safe?' }, { needQuestion: true });
  assert.equal(ok.question, 'Is it safe?');
});

// ── Impact & Emission Factors Suite ───────────────────────────
test('emission factors map adheres to recognized g/km standards', () => {
  assert.equal(G_PER_KM.car, 170);
  assert.equal(G_PER_KM.bus, 70);
  assert.equal(G_PER_KM.two_wheeler, 45);
  assert.equal(G_PER_KM.metro, 30);
  assert.equal(G_PER_KM.walk_cycle, 0);
  assert.equal(G_PER_KM.wfh, 0);
});

test('estimateImpact calculates zero CO2 savings when already using lowest emission mode', () => {
  const wfh = estimateImpact({ ...mockProfile, commute: 'wfh' }, 120, null);
  assert.equal(wfh.co2, null);
  const walk = estimateImpact({ ...mockProfile, commute: 'walk_cycle' }, 120, null);
  assert.equal(walk.co2, null);
  const metro = estimateImpact({ ...mockProfile, commute: 'metro' }, 120, null);
  assert.equal(metro.co2, null);
});

test('estimateImpact documents clear assumptions array', () => {
  assert.ok(Array.isArray(ASSUMPTIONS));
  assert.ok(ASSUMPTIONS.length >= 5);
  assert.ok(ASSUMPTIONS.some((a) => a.includes('Berkeley Air')));
});

// ── Fallback Safety Suite ─────────────────────────────────────
test('fallbackAdvice builds full routine without exertion words regardless of AQI', () => {
  const ctx = {
    aqi: 350,
    constraints: buildConstraints(350, mockProfile),
    bestWindow: { startHour: 14, endHour: 16, pm25: 180 },
    impact: estimateImpact(mockProfile, 250, null),
  };
  const advice = fallbackAdvice(ctx);
  assert.ok(advice.summary.includes('350'));
  assert.ok(advice.routine.length >= 4);
  assert.ok(advice.indoor_hacks.length >= 3);
  assert.ok(advice.alternatives.length >= 1);
  const bad = forbiddenPattern(350);
  assert.equal(bad.test(JSON.stringify(advice)), false);
});
