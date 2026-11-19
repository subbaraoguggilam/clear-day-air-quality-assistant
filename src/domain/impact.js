// Impact math lives in code, never in the LLM. All factors are stated estimates.
export const G_PER_KM = { two_wheeler: 45, car: 170, bus: 70, metro: 30, walk_cycle: 0, wfh: 0 };
const MASK_FACTOR = 0.5;
const round = (n) => Math.round(n * 100) / 100;

export const ASSUMPTIONS = [
  'Emission factors per km: scooter 45 g, car 170 g, bus 70 g, metro 30 g CO₂. These are typical estimates, not measurements of your vehicle.',
  'Commute is counted as a round trip, five days a week.',
  'Exposure is PM2.5 multiplied by hours outdoors: 1.5 hours a day, or 0.5 if you work from home.',
  'A fitted mask is assumed to cut inhaled PM2.5 by 50 percent in daily use.',
  'Moving outdoor time to the cleanest window uses the forecast PM2.5 for that window.',
  'Cigarette equivalent: 22 µg/m³ daily mean PM2.5 ≈ 1 cigarette per day (Berkeley Air research).',
];

export function estimateImpact(profile, pm25, window) {
  const from = G_PER_KM[profile.commute];
  let co2 = null;
  if (from > G_PER_KM.metro && profile.distanceKm > 0) {
    const kg = (2 * profile.distanceKm * (from - G_PER_KM.metro)) / 1000;
    co2 = { from: profile.commute, to: 'metro', savedKgDay: round(kg), savedKgWeek: round(kg * 5) };
  }
  const hours = profile.commute === 'wfh' ? 0.5 : 1.5;
  const base = pm25 * hours;
  const mitigated = (window ? window.pm25 : pm25) * hours * MASK_FACTOR;
  const cutPct = base > 0 ? Math.min(100, Math.max(0, Math.round((1 - mitigated / base) * 100))) : 0;
  // Cigarette equivalent for today's PM2.5 level
  const cigarettesPerDay = Math.round((pm25 / 22) * 10) / 10;
  // Health score: 100 = Good AQI, scales inversely. Clamped 0-100.
  const healthScore = Math.max(0, Math.round(100 - pm25 * 0.5));
  return { co2, exposure: { cutPct }, cigarettesPerDay, healthScore, assumptions: ASSUMPTIONS };
}
