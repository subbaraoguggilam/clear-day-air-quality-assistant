/**
 * Clear Day — Express Web Server
 * Exposes REST endpoints for smog-safe air quality advice, contextual Q&A, and health telemetry.
 * Enforces in-memory rate limiting, security headers, input validation, and graceful error handling.
 */

import express from 'express';
import { fileURLToPath } from 'node:url';
import { classifyAqi, detectTrend } from './src/domain/aqi.js';
import { buildConstraints, getAlertBanner, getDiyFilterGuide } from './src/domain/rules.js';
import { estimateImpact } from './src/domain/impact.js';
import { geocode, fetchAir } from './src/services/aqiClient.js';
import { getAdvice, answerQuestion } from './src/services/llm.js';
import { parseRequest, AppError } from './src/api/validate.js';

// Load environment variables if available
try {
  process.loadEnvFile('.env');
} catch {
  // .env is optional; defaults and fallback systems apply
}

/**
 * Server Configuration Constants
 */
const SERVER_CONFIG = Object.freeze({
  BODY_SIZE_LIMIT: '10kb',
  RATE_LIMIT_MAX_REQUESTS: 20,
  RATE_LIMIT_WINDOW_MS: 60 * 1000,
  CLEANUP_INTERVAL_MS: 60 * 1000,
  DEFAULT_PORT: 3000,
});

const publicDirectoryPath = fileURLToPath(new URL('./public', import.meta.url));
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

// Security Headers Middleware
app.use((_req, res, next) => {
  res.set({
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  next();
});

app.use(express.json({ limit: SERVER_CONFIG.BODY_SIZE_LIMIT }));
app.use(express.static(publicDirectoryPath));

/**
 * In-memory IP rate limiter store.
 * @type {Map<string, { count: number, resetTimestamp: number }>}
 */
const rateLimitStore = new Map();

setInterval(() => {
  const currentTime = Date.now();
  for (const [ipAddress, record] of rateLimitStore) {
    if (currentTime > record.resetTimestamp) {
      rateLimitStore.delete(ipAddress);
    }
  }
}, SERVER_CONFIG.CLEANUP_INTERVAL_MS).unref();

/**
 * Rate limiting middleware enforcing request limits per IP.
 * @param {express.Request} req
 * @param {express.Response} res
 * @param {express.NextFunction} next
 */
function rateLimit(req, res, next) {
  const currentTime = Date.now();
  const clientIp = req.ip || 'unknown';
  let clientRecord = rateLimitStore.get(clientIp);

  if (!clientRecord || currentTime > clientRecord.resetTimestamp) {
    clientRecord = { count: 0, resetTimestamp: currentTime + SERVER_CONFIG.RATE_LIMIT_WINDOW_MS };
    rateLimitStore.set(clientIp, clientRecord);
  }

  clientRecord.count += 1;
  if (clientRecord.count > SERVER_CONFIG.RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' });
  }

  next();
}

/**
 * Asynchronous route wrapper catching unhandled promise rejections.
 * @param {(req: express.Request, res: express.Response) => Promise<any>} handlerFunction
 * @returns {express.RequestHandler}
 */
const asyncRouteHandler = (handlerFunction) => (req, res, next) =>
  handlerFunction(req, res).catch(next);

/**
 * Resolves location telemetry, live air metrics, and safety constraints into a unified domain context.
 * @param {{ location: { city?: string, lat?: number, lon?: number }, profile: any }} requestPayload
 * @returns {Promise<any>}
 */
async function buildContext({ location, profile }) {
  const coordinates = location.city ? await geocode(location.city) : location;
  const airMetrics = await fetchAir(coordinates);
  const hasSensitiveMembers = Boolean(
    profile.children || profile.elderly || profile.asthma || profile.pregnancy
  );

  return {
    label: coordinates.label || 'Your location',
    air: airMetrics,
    profile,
    bestWindow: airMetrics.bestWindow,
    band: classifyAqi(airMetrics.aqi),
    constraints: buildConstraints(airMetrics.aqi, profile),
    impact: estimateImpact(profile, airMetrics.pm25, airMetrics.bestWindow),
    alertBanner: getAlertBanner(airMetrics.aqi, hasSensitiveMembers),
    trend: detectTrend(airMetrics.hourlyChart),
    diyFilter: airMetrics.aqi > 100 ? getDiyFilterGuide() : null,
  };
}

/**
 * Extracts clean, deterministic facts from the domain context for client consumption.
 * @param {any} context
 * @returns {Record<string, any>}
 */
function extractContextFacts(context) {
  return {
    location: context.label,
    air: context.air,
    band: context.band,
    bestWindow: context.bestWindow,
    hourlyChart: context.air.hourlyChart,
    constraints: context.constraints,
    impact: context.impact,
    alertBanner: context.alertBanner,
    trend: context.trend,
    diyFilter: context.diyFilter,
  };
}

/**
 * Health check endpoint for monitoring and observability.
 */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'clear-day',
    aiConfigured: Boolean(process.env.GEMINI_API_KEY),
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Air advice generation endpoint.
 */
app.post(
  '/api/advice',
  rateLimit,
  asyncRouteHandler(async (req, res) => {
    const context = await buildContext(parseRequest(req.body));
    const advicePayload = await getAdvice(context);
    res.json({ ...extractContextFacts(context), ...advicePayload });
  })
);

/**
 * Contextual Q&A endpoint.
 */
app.post(
  '/api/ask',
  rateLimit,
  asyncRouteHandler(async (req, res) => {
    const validatedRequest = parseRequest(req.body, { needQuestion: true });
    const context = await buildContext(validatedRequest);
    const answerResult = await answerQuestion(context, validatedRequest.question);
    res.json(answerResult);
  })
);

// Fallback 404 Handler
app.use((_req, res) => res.status(404).sendFile(`${publicDirectoryPath}/404.html`));

// Centralized Error Handling Middleware
app.use((err, _req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body must be valid JSON.' });
  }
  console.error('[Server Error]', err.message);
  res.status(502).json({ error: 'Air quality data is unavailable right now. Try again in a few minutes.' });
});

const serverPort = process.env.PORT || SERVER_CONFIG.DEFAULT_PORT;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(serverPort, () => console.log(`Clear Day running on http://localhost:${serverPort}`));
}

export default app;
