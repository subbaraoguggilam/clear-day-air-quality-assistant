// US AQI bands. Pure functions: no I/O, fully unit tested.
// Each band: [maxAqi, key, label, badgeColor, badgeText]
const BANDS = [
  [50,       'good',           'Good',                           '#22C55E', '#000'],
  [100,      'moderate',       'Moderate',                       '#EAB308', '#000'],
  [150,      'sensitive',      'Unhealthy for sensitive groups',  '#F97316', '#000'],
  [200,      'unhealthy',      'Unhealthy',                      '#EF4444', '#fff'],
  [300,      'very_unhealthy', 'Very Unhealthy',                 '#A855F7', '#fff'],
  [Infinity, 'hazardous',      'Hazardous',                      '#7F1D1D', '#fff'],
];

export function classifyAqi(value) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('AQI must be a non negative number');
  const level = BANDS.findIndex(([max]) => value <= max);
  const [, key, label, color, textColor] = BANDS[level];
  return { key, label, level, color, textColor };
}

// Lowest two-hour average PM2.5 in the next 24 hours, between 06:00 and 20:00 local time.
export function bestWindow(times, pm25, nowIso, { from = 6, to = 20 } = {}) {
  const s = Math.max(times.findIndex((t) => t >= nowIso), 0);
  let best = null;
  for (let i = s; i < Math.min(times.length - 1, s + 24); i++) {
    const h = Number(times[i].slice(11, 13));
    if (h < from || h + 2 > to || pm25[i] == null || pm25[i + 1] == null) continue;
    const avg = (pm25[i] + pm25[i + 1]) / 2;
    if (!best || avg < best.pm25) best = { startHour: h, endHour: h + 2, pm25: Math.round(avg * 10) / 10 };
  }
  return best;
}

// Build hourly chart data for the next 24 hours.
export function buildHourlyChart(times, pm25, nowIso) {
  const s = Math.max(times.findIndex((t) => t >= nowIso), 0);
  return times.slice(s, s + 24).map((t, i) => ({
    hour: Number(t.slice(11, 13)),
    label: `${String(Number(t.slice(11, 13))).padStart(2, '0')}:00`,
    pm25: pm25[s + i] ?? null,
  }));
}

// Cigarette equivalent: 22 µg/m³ ≈ 1 cigarette/day (Berkeley Air).
export function cigaretteEquivalent(pm25) {
  return Math.round((pm25 / 22) * 10) / 10;
}
