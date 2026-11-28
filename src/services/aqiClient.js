/**
 * Open-Meteo Air Quality and Geocoding Service Client.
 * Queries free meteorological endpoints with timeouts, geo-bucketed in-memory caching,
 * and robust input normalization.
 */

import { bestWindow, buildHourlyChart } from '../domain/aqi.js';
import { AppError } from '../api/validate.js';

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache
const REQUEST_TIMEOUT_MS = 8000;
const MAX_CACHE_ENTRIES = 500;

/**
 * In-memory geo-bucketed response cache.
 * @type {Map<string, { cachedAt: number, value: any }>}
 */
const airDataCache = new Map();

/**
 * Rounds a number to a single decimal place.
 * @param {number | null | undefined} value
 * @returns {number | null}
 */
const roundToOneDecimal = (value) => (value == null ? null : Math.round(value * 10) / 10);

/**
 * Performs a timed JSON fetch with upstream HTTP error handling.
 * @param {string} url
 * @returns {Promise<any>}
 */
async function fetchJsonWithTimeout(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Upstream air service error: HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Geocodes a city name into geographical coordinates and a standardized label.
 * @param {string} city - Target city name
 * @returns {Promise<{ lat: number, lon: number, label: string }>}
 */
export async function geocode(city) {
  const trimmedCity = city.trim();
  const queryCity = async (name) => {
    const encoded = encodeURIComponent(name);
    const endpoint = `https://geocoding-api.open-meteo.com/v1/search?name=${encoded}&count=1&language=en&format=json`;
    const responseData = await fetchJsonWithTimeout(endpoint);
    return responseData.results?.[0] ?? null;
  };

  let matchedResult = await queryCity(trimmedCity);
  if (!matchedResult && trimmedCity.includes(',')) {
    const shortName = trimmedCity.split(',')[0].trim();
    if (shortName.length >= 2) {
      matchedResult = await queryCity(shortName);
    }
  }

  if (!matchedResult) {
    throw new AppError(404, 'City not found. Check the spelling or share your location instead.');
  }

  const regionLabel = matchedResult.admin1 ?? matchedResult.country ?? '';
  return {
    lat: matchedResult.latitude,
    lon: matchedResult.longitude,
    label: regionLabel ? `${matchedResult.name}, ${regionLabel}` : matchedResult.name,
  };
}

/**
 * Fetches current air quality metrics and hourly forecast for given coordinates.
 * Results are cached in memory for 10 minutes keyed by rounded coordinates.
 * @param {{ lat: number, lon: number }} coordinates
 * @returns {Promise<{
 *   aqi: number,
 *   pm25: number | null,
 *   pm10: number | null,
 *   no2: number | null,
 *   o3: number | null,
 *   bestWindow: { startHour: number, endHour: number, pm25: number } | null,
 *   hourlyChart: Array<{ label: string, hour: number, pm25: number | null }>,
 *   updated: string
 * }>}
 */
export async function fetchAir({ lat, lon }) {
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cachedEntry = airDataCache.get(cacheKey);

  if (cachedEntry && Date.now() - cachedEntry.cachedAt < CACHE_TTL_MS) {
    return cachedEntry.value;
  }

  const endpoint =
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}` +
    '&current=us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone&hourly=pm2_5&forecast_days=2&timezone=auto';

  const apiData = await fetchJsonWithTimeout(endpoint);
  const currentReading = apiData.current;

  if (!currentReading || !Number.isFinite(currentReading.us_aqi)) {
    throw new Error('No valid air quality telemetry returned from upstream.');
  }

  const hourlyTime = apiData.hourly?.time ?? [];
  const hourlyPm25 = apiData.hourly?.pm2_5 ?? [];
  const formattedAirData = {
    aqi: Math.round(currentReading.us_aqi),
    pm25: roundToOneDecimal(currentReading.pm2_5),
    pm10: roundToOneDecimal(currentReading.pm10),
    no2: roundToOneDecimal(currentReading.nitrogen_dioxide),
    o3: roundToOneDecimal(currentReading.ozone),
    bestWindow: bestWindow(hourlyTime, hourlyPm25, currentReading.time),
    hourlyChart: buildHourlyChart(hourlyTime, hourlyPm25, currentReading.time),
    updated: currentReading.time,
  };

  if (airDataCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = airDataCache.keys().next().value;
    if (oldestKey !== undefined) airDataCache.delete(oldestKey);
  }
  airDataCache.set(cacheKey, { cachedAt: Date.now(), value: formattedAirData });
  return formattedAirData;
}
