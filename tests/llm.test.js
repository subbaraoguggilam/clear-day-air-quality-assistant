import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, getAdvice, answerQuestion } from '../src/services/llm.js';
import { classifyAqi } from '../src/domain/aqi.js';
import { buildConstraints } from '../src/domain/rules.js';
import { estimateImpact } from '../src/domain/impact.js';

const sampleProfile = {
  children: true,
  elderly: false,
  asthma: false,
  pregnancy: false,
  commute: 'two_wheeler',
  cooking: 'lpg',
  distanceKm: 8,
};

function createTestContext(aqi = 180) {
  const bestWindow = { startHour: 13, endHour: 15, pm25: 65 };
  return {
    label: 'Delhi, India',
    air: { aqi, pm25: 110, pm10: 175, no2: 32, o3: 24 },
    band: classifyAqi(aqi),
    bestWindow,
    constraints: buildConstraints(aqi, sampleProfile),
    profile: sampleProfile,
    impact: estimateImpact(sampleProfile, 110, bestWindow),
  };
}

const VALID_ADVICE = {
  summary: 'Air quality is unhealthy today. Keep children indoors and wear an N95 mask outdoors.',
  routine: [
    { time: 'Morning', action: 'Keep windows closed and stay inside.', why: 'Morning smog is dense.' },
    { time: '13:00 to 15:00', action: 'Open windows briefly for fresh air.', why: 'This is the cleanest window.' },
  ],
  indoor_hacks: [{ tip: 'Wet mop floors daily.', impact: 'Prevents settled dust from rising.' }],
  alternatives: [{ swap: 'Take the metro instead of a scooter.', benefit: 'Cuts daily carbon emissions.' }],
};

describe('LLM Service, Safety Retries, and SHAP Fallbacks', () => {
  let originalApiKey;

  beforeEach(() => {
    originalApiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-mock-key';
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalApiKey;
    }
  });

  test('buildPrompt injects safety constraints and computed impact', () => {
    const context = { ...createTestContext(180), trend: 'rising' };
    const prompt = buildPrompt(context, 'Build a plan.');
    assert.ok(prompt.includes('location: Delhi, India | AQI: 180'));
    assert.ok(prompt.includes('NO2: 32 | O3: 24 | 6h_trend: rising'));
    assert.ok(prompt.includes('SAFETY_CONSTRAINTS:'));
    assert.ok(prompt.includes('No outdoor exercise'));
    assert.ok(prompt.includes('cleanest window today: 13:00 to 15:00'));
    assert.ok(prompt.includes('cigarettes_per_day'));
    assert.ok(prompt.includes('health_score'));
  });

  test('getAdvice returns Gemini output when response passes schema and safety checks', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_ADVICE) }] } }],
      }),
    });

    const result = await getAdvice(createTestContext(180), { fetchImpl: mockFetch, useCache: false });
    assert.equal(result.source, 'gemini');
    assert.equal(result.advice.summary, VALID_ADVICE.summary);
    assert.ok(result.advice.disclaimer);
  });

  test('getAdvice retries once when first Gemini response violates exertion safety rules', async () => {
    let callCount = 0;
    const unsafeAdvice = {
      ...VALID_ADVICE,
      routine: [{ time: 'Morning', action: 'Go jogging in the park.', why: 'Fresh morning air.' }],
    };

    const mockFetch = async () => {
      callCount += 1;
      const payload = callCount === 1 ? unsafeAdvice : VALID_ADVICE;
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
        }),
      };
    };

    const result = await getAdvice(createTestContext(180), { fetchImpl: mockFetch, useCache: false });
    assert.equal(callCount, 2);
    assert.equal(result.source, 'gemini');
    assert.equal(result.advice.routine[0].action, VALID_ADVICE.routine[0].action);
  });

  test('getAdvice falls back to SHAP explainable model when Gemini fails', async () => {
    delete process.env.GEMINI_API_KEY;
    const result = await getAdvice(createTestContext(210), { useCache: false });
    assert.equal(result.source, 'shap');
    assert.ok(result.shapExplainer);
    assert.equal(result.shapExplainer.features.length, 4);
    assert.ok(result.advice.routine.length > 0);
  });

  test('answerQuestion returns Gemini answer on success and falls back to SHAP on error', async () => {
    const context = createTestContext(180);

    const okFetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'Keep play indoors today.' }) }] } }],
      }),
    });
    const okResult = await answerQuestion(context, 'Can kids play outside?', { fetchImpl: okFetch });
    assert.equal(okResult.source, 'gemini');
    assert.equal(okResult.answer, 'Keep play indoors today.');

    const failFetch = async () => ({ ok: false, status: 503 });
    const fallbackResult = await answerQuestion(context, 'Can kids play outside?', { fetchImpl: failFetch });
    assert.equal(fallbackResult.source, 'shap');
    assert.ok(fallbackResult.answer.includes('SHAP Explainability Model'));
    assert.ok(fallbackResult.answer.includes('13:00 to 15:00'));

    const windowFallback = await answerQuestion(context, 'When should I open windows?', { fetchImpl: failFetch });
    assert.equal(windowFallback.source, 'shap');
    assert.ok(windowFallback.answer.includes('cleanest window'));
  });

  test('answerQuestion retries once when first Gemini answer breaks safety rules', async () => {
    let calls = 0;
    const retryFetch = async () => {
      calls += 1;
      const text =
        calls === 1
          ? JSON.stringify({ answer: 'Go jogging outside this morning.' })
          : JSON.stringify({ answer: 'Avoid outdoor exercise today and keep play indoors.' });
      return {
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
      };
    };
    const res = await answerQuestion(createTestContext(180), 'Can I exercise outside?', { fetchImpl: retryFetch });
    assert.equal(calls, 2);
    assert.equal(res.source, 'gemini');
    assert.equal(res.answer, 'Avoid outdoor exercise today and keep play indoors.');
  });
});
