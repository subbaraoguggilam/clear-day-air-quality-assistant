/**
 * Domain Logic: Deterministic Carbon Savings, Inhalation Exposure Reductions,
 * Health Index Scoring, and Documented Algorithmic Assumptions.
 * Numbers and factors are strictly calculated in code — never delegated to the LLM.
 */

import { cigaretteEquivalent } from './aqi.js';

/**
 * Standardized emission factors in grams of CO2 per passenger-kilometer (g CO2/km).
 * Derived from published transit carbon benchmarks.
 * @type {Record<string, number>}
 */
export const G_PER_KM = Object.freeze({
  two_wheeler: 45,
  car: 170,
  bus: 70,
  metro: 30,
  walk_cycle: 0,
  wfh: 0,
});

/**
 * Filtration efficacy factor: A fitted N95/FFP2 respirator reduces inhaled particulate matter by ~50% in daily use.
 */
const MASK_PENETRATION_FACTOR = 0.5;

/**
 * Rounds a number to two decimal places.
 * @param {number} value
 * @returns {number}
 */
const roundToTwoDecimals = (value) => Math.round(value * 100) / 100;

/**
 * Baseline assumptions documenting all algorithmic impact estimates.
 * @type {string[]}
 */
export const ASSUMPTIONS = Object.freeze([
  'Emission factors per km: scooter 45 g, car 170 g, bus 70 g, metro 30 g CO₂. Typical transport estimates.',
  'Commute is counted as a round trip, five business days a week.',
  'Outdoor exposure is PM2.5 multiplied by active hours outdoors: 1.5 hours/day (0.5 hours if working from home).',
  'A fitted mask is assumed to cut inhaled PM2.5 by 50 percent in daily practical use.',
  'Moving outdoor time to the cleanest window uses the forecast PM2.5 for that window.',
  'Cigarette equivalent: 22 µg/m³ daily mean PM2.5 ≈ 1 cigarette per day (Berkeley Air research).',
]);

/**
 * Computes deterministic carbon savings, exposure reductions, and health metrics.
 * @param {{ commute: string, distanceKm: number }} profile - Household profile
 * @param {number} pm25 - Current ambient PM2.5 concentration in µg/m³
 * @param {{ pm25: number, startHour: number, endHour: number } | null} bestWindow - Optimal outdoor window
 * @returns {{
 *   co2: { from: string, to: string, savedKgDay: number, savedKgWeek: number } | null,
 *   exposure: { cutPct: number },
 *   cigarettesPerDay: number,
 *   healthScore: number,
 *   assumptions: readonly string[]
 * }}
 */
export function estimateImpact(profile, pm25, bestWindow) {
  const currentCommuteEmission = G_PER_KM[profile.commute] ?? 0;
  const metroEmission = G_PER_KM.metro;
  let co2Savings = null;

  if (currentCommuteEmission > metroEmission && profile.distanceKm > 0) {
    const dailyKgSaved = (2 * profile.distanceKm * (currentCommuteEmission - metroEmission)) / 1000;
    co2Savings = {
      from: profile.commute,
      to: 'metro',
      savedKgDay: roundToTwoDecimals(dailyKgSaved),
      savedKgWeek: roundToTwoDecimals(dailyKgSaved * 5),
    };
  }

  const dailyOutdoorHours = profile.commute === 'wfh' ? 0.5 : 1.5;
  const baselineInhaledExposure = pm25 * dailyOutdoorHours;
  const targetWindowPm25 = bestWindow ? bestWindow.pm25 : pm25;
  const mitigatedInhaledExposure = targetWindowPm25 * dailyOutdoorHours * MASK_PENETRATION_FACTOR;

  const exposureCutPercentage =
    baselineInhaledExposure > 0
      ? Math.min(100, Math.max(0, Math.round((1 - mitigatedInhaledExposure / baselineInhaledExposure) * 100)))
      : 0;

  // Cigarette equivalent calculated via verified Berkeley Air ratio
  const cigarettesPerDay = cigaretteEquivalent(pm25);

  // Health score: 100 is pristine air, scaling inversely with PM2.5, clamped between 0 and 100
  const healthScore = Math.max(0, Math.min(100, Math.round(100 - pm25 * 0.5)));

  return {
    co2: co2Savings,
    exposure: { cutPct: exposureCutPercentage },
    cigarettesPerDay,
    healthScore,
    assumptions: ASSUMPTIONS,
  };
}
