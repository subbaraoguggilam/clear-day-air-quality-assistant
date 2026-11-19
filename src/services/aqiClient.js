// Open Meteo geocoding and air quality (no API key). Responses cached for ten minutes.
import { bestWindow, buildHourlyChart } from '../domain/aqi.js';
import { AppError } from '../api/validate.js';

const TTL = 10 * 60 * 1000;
const cache = new Map();
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Upstream ${res.status}`);
  return res.json();
}

export async function geocode(city) {
  const d = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
  const r = d.results?.[0];
  if (!r) throw new AppError(404, 'City not found. Check the spelling or share your location instead.');
  return { lat: r.latitude, lon: r.longitude, label: `${r.name}, ${r.admin1 ?? r.country}` };
}

export async function fetchAir({ lat, lon }) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const d = await getJson(
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    '&current=us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone&hourly=pm2_5&forecast_days=2&timezone=auto');
  const c = d.current;
  if (!c || !Number.isFinite(c.us_aqi)) throw new Error('No air data');
  const value = {
    aqi: Math.round(c.us_aqi),
    pm25: r1(c.pm2_5), pm10: r1(c.pm10), no2: r1(c.nitrogen_dioxide), o3: r1(c.ozone),
    bestWindow: bestWindow(d.hourly.time, d.hourly.pm2_5, c.time),
    hourlyChart: buildHourlyChart(d.hourly.time, d.hourly.pm2_5, c.time),
    updated: c.time,
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}
