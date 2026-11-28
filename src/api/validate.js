/**
 * Request Input Validation and Whitelisting Layer.
 * Strictly validates every incoming HTTP payload field before it reaches domain logic or AI prompts.
 */

/**
 * Custom HTTP error with an associated status code for predictable client responses.
 */
export class AppError extends Error {
  /**
   * @param {number} status - HTTP status code (e.g., 400, 404)
   * @param {string} message - Human-readable error message
   */
  constructor(status, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

const VALID_COMMUTE_MODES = Object.freeze(['two_wheeler', 'car', 'bus', 'metro', 'walk_cycle', 'wfh']);
const VALID_COOKING_FUELS = Object.freeze(['lpg', 'wood', 'induction']);

/**
 * Helper to create a 400 Bad Request AppError.
 * @param {string} message
 * @returns {AppError}
 */
const createValidationError = (message) => new AppError(400, message);

/**
 * Validates that a value belongs to a predefined whitelist.
 * @param {unknown} value
 * @param {readonly string[]} allowedValues
 * @param {string} fieldName
 * @returns {string}
 */
function requireOneOf(value, allowedValues, fieldName) {
  if (typeof value !== 'string' || !allowedValues.includes(value)) {
    throw createValidationError(`Choose a valid ${fieldName}.`);
  }
  return value;
}

/**
 * Validates that a value is a finite number within inclusive bounds.
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {string} fieldName
 * @returns {number}
 */
function requireBoundedNumber(value, min, max, fieldName) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw createValidationError(`${fieldName} must be a number from ${min} to ${max}.`);
  }
  return value;
}

/**
 * Parses, sanitizes, and validates request bodies for /api/advice and /api/ask.
 * @param {any} body - Raw parsed JSON request body
 * @param {{ needQuestion?: boolean }} [options]
 * @returns {{
 *   location: { lat: number, lon: number } | { city: string },
 *   profile: {
 *     children: boolean,
 *     elderly: boolean,
 *     asthma: boolean,
 *     pregnancy: boolean,
 *     commute: string,
 *     cooking: string,
 *     distanceKm: number
 *   },
 *   question: string | undefined
 * }}
 */
export function parseRequest(body, { needQuestion = false } = {}) {
  if (!body || typeof body !== 'object') {
    throw createValidationError('Request body is required.');
  }

  let location;
  if (body.lat !== undefined) {
    location = {
      lat: requireBoundedNumber(body.lat, -90, 90, 'Latitude'),
      lon: requireBoundedNumber(body.lon, -180, 180, 'Longitude'),
    };
  } else {
    const city = typeof body.city === 'string' ? body.city.replace(/\s+/g, ' ').trim() : '';
    if (city.length < 2 || city.length > 60) {
      throw createValidationError('Enter a city name of 2 to 60 characters.');
    }
    location = { city };
  }

  const rawProfile = body.profile ?? {};
  const profile = {
    children: rawProfile.children === true,
    elderly: rawProfile.elderly === true,
    asthma: rawProfile.asthma === true,
    pregnancy: rawProfile.pregnancy === true,
    commute: requireOneOf(rawProfile.commute, VALID_COMMUTE_MODES, 'commute'),
    cooking: requireOneOf(rawProfile.cooking, VALID_COOKING_FUELS, 'cooking fuel'),
    distanceKm: requireBoundedNumber(rawProfile.distanceKm, 0, 100, 'Commute distance'),
  };

  let question;
  if (needQuestion) {
    question =
      typeof body.question === 'string'
        ? body.question.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
        : '';
    if (!question || question.length > 300) {
      throw createValidationError('Ask a question of up to 300 characters.');
    }
  }

  return { location, profile, question };
}
