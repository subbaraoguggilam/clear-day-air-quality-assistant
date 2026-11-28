/**
 * Domain Logic: Air Quality Index (AQI) Classification, Trend Detection,
 * Forecast Scanning, and Health Equivalence Metrics.
 * Pure mathematical functions without external side-effects or network I/O.
 */

/**
 * Standard US EPA AQI Band Thresholds, Semantic Keys, and Color Palette.
 * Format: [UpperAQI, CategoryKey, DisplayLabel, BadgeColor, TextColor]
 */
const AQI_BANDS = Object.freeze([
  [50,       'good',           'Good',                           '#22C55E', '#000000'],
  [100,      'moderate',       'Moderate',                       '#EAB308', '#000000'],
  [150,      'sensitive',      'Unhealthy for sensitive groups',  '#F97316', '#000000'],
  [200,      'unhealthy',      'Unhealthy',                      '#EF4444', '#FFFFFF'],
  [300,      'very_unhealthy', 'Very Unhealthy',                 '#A855F7', '#FFFFFF'],
  [Infinity, 'hazardous',      'Hazardous',                      '#7F1D1D', '#FFFFFF'],
]);

/**
 * Berkeley Air Research factor: 22 µg/m³ of daily mean PM2.5 ≈ 1 cigarette inhaled per day.
 */
const CIGARETTE_EQUIVALENT_PM25_RATIO = 22;

/**
 * Classifies an AQI value into standard health bands with color tokens.
 * @param {number} value - Non-negative numerical AQI value
 * @returns {{ key: string, label: string, level: number, color: string, textColor: string }}
 */
export function classifyAqi(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('AQI must be a non-negative numerical value.');
  }
  const levelIndex = AQI_BANDS.findIndex(([upperLimit]) => value <= upperLimit);
  const [, key, label, color, textColor] = AQI_BANDS[levelIndex];
  return { key, label, level: levelIndex, color, textColor };
}

/**
 * Scans hourly PM2.5 forecasts to find the cleanest consecutive 2-hour daylight window.
 * @param {string[]} timeSeriesIso - Array of ISO 8601 time strings
 * @param {Array<number|null>} pm25Series - Array of PM2.5 forecast concentrations
 * @param {string} currentIso - Reference ISO time string (typically current time)
 * @param {{ from?: number, to?: number }} options - Daylight hour bounds (defaults to 06:00 to 20:00)
 * @returns {{ startHour: number, endHour: number, pm25: number } | null}
 */
export function bestWindow(timeSeriesIso, pm25Series, currentIso, { from = 6, to = 20 } = {}) {
  const startIndex = Math.max(timeSeriesIso.findIndex((timestamp) => timestamp >= currentIso), 0);
  let optimalWindow = null;

  for (let index = startIndex; index < Math.min(timeSeriesIso.length - 1, startIndex + 24); index++) {
    const hour = Number(timeSeriesIso[index].slice(11, 13));
    const currentPm = pm25Series[index];
    const nextPm = pm25Series[index + 1];
    if (hour < from || hour + 2 > to || !Number.isFinite(currentPm) || !Number.isFinite(nextPm)) {
      continue;
    }
    const averagePm25 = (currentPm + nextPm) / 2;
    if (!optimalWindow || averagePm25 < optimalWindow.pm25) {
      optimalWindow = {
        startHour: hour,
        endHour: hour + 2,
        pm25: Math.round(averagePm25 * 10) / 10,
      };
    }
  }

  return optimalWindow;
}

/**
 * Formats a 24-hour PM2.5 forecast chart dataset starting from the reference timestamp.
 * @param {string[]} timeSeriesIso - Array of ISO 8601 time strings
 * @param {Array<number|null>} pm25Series - Array of PM2.5 concentrations
 * @param {string} currentIso - Reference timestamp
 * @returns {Array<{ hour: number, label: string, pm25: number | null }>}
 */
export function buildHourlyChart(timeSeriesIso, pm25Series, currentIso) {
  const startIndex = Math.max(timeSeriesIso.findIndex((timestamp) => timestamp >= currentIso), 0);
  return timeSeriesIso.slice(startIndex, startIndex + 24).map((timestamp, offset) => {
    const hour = Number(timestamp.slice(11, 13));
    return {
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
      pm25: pm25Series[startIndex + offset] ?? null,
    };
  });
}

/**
 * Calculates the tangible cigarette-equivalent exposure per day based on PM2.5 levels.
 * @param {number} pm25 - Fine particulate matter concentration in µg/m³
 * @returns {number} Equivalent cigarettes per day (rounded to 1 decimal place)
 */
export function cigaretteEquivalent(pm25) {
  if (!Number.isFinite(pm25) || pm25 <= 0) return 0;
  return Math.round((pm25 / CIGARETTE_EQUIVALENT_PM25_RATIO) * 10) / 10;
}

/**
 * Detects whether pollution is rising, falling, or stable over the upcoming 6-hour forecast horizon.
 * @param {Array<{ pm25: number | null }>} hourlyChart - 24-hour forecast data
 * @returns {'rising' | 'falling' | 'stable'}
 */
export function detectTrend(hourlyChart) {
  const validReadings = hourlyChart
    .filter((point) => point.pm25 != null)
    .slice(0, 6)
    .map((point) => point.pm25);

  if (validReadings.length < 4) return 'stable';

  const earlyAverage = (validReadings[0] + validReadings[1]) / 2;
  const lateAverage =
    (validReadings[validReadings.length - 2] + validReadings[validReadings.length - 1]) / 2;
  const difference = lateAverage - earlyAverage;

  if (difference > 5) return 'rising';
  if (difference < -5) return 'falling';
  return 'stable';
}
