// SHAP (Shapley Additive exPlanations) ML Surrogate Layer
// Computes feature contributions using exact Shapley values over an interpretable risk model.
// Evaluates marginal contributions of factors: AQI, Vulnerability, Commute Exposure, and Fuel Type.

import { buildTailoredIndoorHacks, buildTailoredSwaps } from './rules.js';

export const BASELINE_RISK = 25.0; // Baseline population baseline risk score (%)

/**
 * Feature evaluation function: calculates risk score for any subset of active features.
 * Features:
 * - aqi: raw AQI value
 * - sensitive: presence of children, elderly, asthma, or pregnancy (binary)
 * - commuteExposure: high exposure commute (scooter, walking, cycling) vs low exposure (wfh, metro)
 * - biomassFuel: biomass/wood cooking fuel (binary)
 */
export function evaluateRiskModel({ aqi = 50, sensitive = false, commuteExposure = false, biomassFuel = false }) {
  let risk = BASELINE_RISK;
  
  // AQI contribution (sigmoid-like scaling up to +40%)
  const aqiScore = Math.min(50, Math.max(0, (aqi - 50) * 0.16));
  risk += aqiScore;

  // Household sensitivity contribution (+15%)
  if (sensitive) {
    risk += 15.0;
  }

  // Commute exposure contribution (+10%)
  if (commuteExposure) {
    risk += 10.0;
  }

  // Indoor cooking biomass fuel (+10%)
  if (biomassFuel) {
    risk += 10.0;
  }

  return Math.min(100, Math.round(risk * 10) / 10);
}

/**
 * Computes exact Shapley values for the 4 core features using subset permutations.
 * Formula: phi_i = sum_S [ |S|!(|F|-|S|-1)! / |F|! * (v(S U {i}) - v(S)) ]
 * @param {{ aqi: number, profile: any }} params
 * @returns {{ baseline: number, predictedRisk: number, features: Array<{ key: string, name: string, shapValue: number, impactDirection: string }> }}
 */
export function computeShapValues({ aqi, profile }) {
  const sensitive = Boolean(profile.children || profile.elderly || profile.asthma || profile.pregnancy);
  const commuteExposure = ['two_wheeler', 'walk_cycle'].includes(profile.commute);
  const biomassFuel = profile.cooking === 'wood';

  const features = [
    { key: 'air_quality', name: 'Outdoor AQI Severity', val: aqi, active: aqi > 50 },
    { key: 'vulnerability', name: 'Household Health Sensitivity', val: sensitive ? 1 : 0, active: sensitive },
    { key: 'commute_exposure', name: 'High-Exposure Commute', val: commuteExposure ? 1 : 0, active: commuteExposure },
    { key: 'indoor_fuel', name: 'Indoor Cooking Biomass Fuel', val: biomassFuel ? 1 : 0, active: biomassFuel },
  ];

  const n = features.length;
  // Factorial helper
  const fact = [1, 1, 2, 6, 24];

  const shapContributions = features.map((feature, i) => {
    let phi = 0;
    // Iterate over all 2^(n-1) subsets excluding feature i
    const otherIndices = [0, 1, 2, 3].filter((idx) => idx !== i);
    const numSubsets = 1 << otherIndices.length;

    for (let mask = 0; mask < numSubsets; mask++) {
      const subset = [];
      for (let bit = 0; bit < otherIndices.length; bit++) {
        if ((mask & (1 << bit)) !== 0) {
          subset.push(otherIndices[bit]);
        }
      }

      const sSize = subset.length;
      const weight = (fact[sSize] * fact[n - sSize - 1]) / fact[n];

      // Build model input for S
      const inputWithout = { aqi: 50, sensitive: false, commuteExposure: false, biomassFuel: false };
      subset.forEach((idx) => {
        if (idx === 0) inputWithout.aqi = aqi;
        if (idx === 1) inputWithout.sensitive = sensitive;
        if (idx === 2) inputWithout.commuteExposure = commuteExposure;
        if (idx === 3) inputWithout.biomassFuel = biomassFuel;
      });

      // Build model input for S U {i}
      const inputWith = { ...inputWithout };
      if (i === 0) inputWith.aqi = aqi;
      if (i === 1) inputWith.sensitive = sensitive;
      if (i === 2) inputWith.commuteExposure = commuteExposure;
      if (i === 3) inputWith.biomassFuel = biomassFuel;

      const delta = evaluateRiskModel(inputWith) - evaluateRiskModel(inputWithout);
      phi += weight * delta;
    }

    return {
      key: feature.key,
      name: feature.name,
      shapValue: Math.round(phi * 10) / 10,
      impactDirection: phi > 0 ? 'increases_risk' : 'neutral',
    };
  });

  const predictedRisk = evaluateRiskModel({ aqi, sensitive, commuteExposure, biomassFuel });

  return {
    baseline: BASELINE_RISK,
    predictedRisk,
    features: shapContributions.sort((a, b) => Math.abs(b.shapValue) - Math.abs(a.shapValue)),
  };
}

/**
 * SHAP surrogate ML advice generator: produces personalized recommendations
 * directly driven and justified by feature attributions when GenAI is unavailable.
 * @param {{ air: { aqi: number, pm25: number }, profile: any, bestWindow: any, constraints: any[], impact: any }} ctx
 * @returns {{ summary: string, routine: any[], indoor_hacks: any[], alternatives: any[], shapExplainer: any }}
 */
export function generateShapAdvice(ctx) {
  const { air, profile, bestWindow, constraints, impact } = ctx;
  const shap = computeShapValues({ aqi: air.aqi, profile });
  const ids = new Set(constraints.map((c) => c.id));
  const hh = (h) => `${String(h).padStart(2, '0')}:00`;
  const w = bestWindow ? `${hh(bestWindow.startHour)} to ${hh(bestWindow.endHour)}` : '12:00 to 14:00';

  // Primary risk driver based on SHAP ranking
  const topFactor = shap.features[0];
  const driverDelta = topFactor.shapValue > 0 ? `+${topFactor.shapValue}% risk` : 'baseline risk';
  const summary = `Predicted smog exposure risk is ${shap.predictedRisk}% (Baseline: ${shap.baseline}%). Key driver: ${topFactor.name} (${driverDelta}). Advice generated by SHAP Explainable ML Model.`;

  const isLowRiskAqi = air.aqi <= 100;
  const morningAction = ids.has('stay_in')
    ? 'Keep windows sealed, remain indoors, and operate an indoor air filter.'
    : isLowRiskAqi
      ? 'Proceed with normal morning activities outdoors and open windows for fresh airflow.'
      : 'Limit morning outdoor time to brief essential movement and keep street-facing windows shut.';

  const windowAction =
    air.aqi > 300
      ? 'Stay indoors; open a window for at most five minutes only if indoor air is stale.'
      : air.aqi > 200
        ? 'Use this window strictly for essential errands with a fitted N95 respirator.'
        : isLowRiskAqi
          ? 'Best window for outdoor activity, low-emission travel, and full home ventilation.'
          : 'Schedule outdoor errands and brief ten-minute home ventilation in this window.';

  const commuteAction =
    profile.commute === 'wfh'
      ? ids.has('mask')
        ? 'Work indoors away from open roadside windows; wear an N95 mask for short outdoor pickups.'
        : 'Keep your home workspace aired out during the midday cleanest window.'
      : ids.has('mask')
        ? 'Wear a fitted N95 or FFP2 respirator and select quieter backstreets away from diesel plumes.'
        : 'Choose lower-traffic routes or closed transit cabins to keep commuter exposure low.';

  const eveningAction = isLowRiskAqi
    ? 'Enjoy light evening routines and avoid areas with open waste or wood burning.'
    : 'Close windows before dusk, operate indoor air filtration, and avoid evening roadside markets.';

  const routine = [
    {
      time: 'Morning',
      action: morningAction,
      why:
        topFactor.shapValue > 0
          ? `Driven by ${topFactor.name} contributing +${topFactor.shapValue}% to your household exposure score.`
          : 'Air quality and household risk factors remain near baseline levels.',
    },
    {
      time: w,
      action: windowAction,
      why: `Forecast cleanest diurnal window with lowest particulate density (${bestWindow ? bestWindow.pm25 : air.pm25 ?? 'N/A'} µg/m³).`,
    },
    {
      time: 'Commute',
      action: commuteAction,
      why: ['two_wheeler', 'walk_cycle'].includes(profile.commute)
        ? `Commute mode is an active risk factor (+${shap.features.find((f) => f.key === 'commute_exposure')?.shapValue || 0}% risk).`
        : 'Minimizes direct vehicular emission inhalation along busy corridors.',
    },
    {
      time: 'Evening',
      action: eveningAction,
      why: isLowRiskAqi
        ? 'Local evening smoke sources can still spike fine particles near streets.'
        : 'Inversion layer traps thermal and particulate exhaust near ground level after dark.',
    },
  ];

  const indoor_hacks = buildTailoredIndoorHacks(profile, air.aqi);
  if (profile.cooking === 'wood') {
    const fuelShap = shap.features.find((f) => f.key === 'indoor_fuel')?.shapValue || 0;
    indoor_hacks[1] = {
      tip: 'Ventilate kitchen directly to the exterior and shift quick meals to induction or electric kettles.',
      impact: `Directly mitigates indoor biomass fuel risk (+${fuelShap}% attributed risk).`,
    };
  }

  const alternatives = buildTailoredSwaps(profile, impact);

  return {
    summary,
    routine,
    indoor_hacks,
    alternatives,
    shapExplainer: shap,
  };
}
