import express from 'express';
import { fileURLToPath } from 'node:url';
import { classifyAqi } from './src/domain/aqi.js';
import { buildConstraints } from './src/domain/rules.js';
import { estimateImpact } from './src/domain/impact.js';
import { geocode, fetchAir } from './src/services/aqiClient.js';
import { getAdvice, answerQuestion } from './src/services/llm.js';
import { parseRequest, AppError } from './src/api/validate.js';

try { process.loadEnvFile('.env'); } catch { /* .env is optional */ }

const pub = fileURLToPath(new URL('./public', import.meta.url));
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((_req, res, next) => {
  res.set({
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'",
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  });
  next();
});
app.use(express.json({ limit: '10kb' }));
app.use(express.static(pub));

const hits = new Map();
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (n > v.reset) hits.delete(k); }, 60000).unref();
function rateLimit(req, res, next) {
  const now = Date.now();
  let h = hits.get(req.ip);
  if (!h || now > h.reset) { h = { count: 0, reset: now + 60000 }; hits.set(req.ip, h); }
  if (++h.count > 20) return res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' });
  next();
}
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

async function buildContext({ location, profile }) {
  const coords = location.city ? await geocode(location.city) : location;
  const air = await fetchAir(coords);
  return {
    label: coords.label || 'Your location', air, profile, bestWindow: air.bestWindow,
    band: classifyAqi(air.aqi), constraints: buildConstraints(air.aqi, profile),
    impact: estimateImpact(profile, air.pm25, air.bestWindow),
  };
}
const facts = (c) => ({ location: c.label, air: c.air, band: c.band, bestWindow: c.bestWindow, hourlyChart: c.air.hourlyChart, constraints: c.constraints, impact: c.impact });

app.post('/api/advice', rateLimit, wrap(async (req, res) => {
  const ctx = await buildContext(parseRequest(req.body));
  res.json({ ...facts(ctx), ...(await getAdvice(ctx)) });
}));

app.post('/api/ask', rateLimit, wrap(async (req, res) => {
  const parsed = parseRequest(req.body, { needQuestion: true });
  res.json(await answerQuestion(await buildContext(parsed), parsed.question));
}));

app.use((_req, res) => res.status(404).sendFile(`${pub}/404.html`));
app.use((err, _req, res, _next) => {
  if (err instanceof AppError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must be valid JSON.' });
  console.error(err.message);
  res.status(502).json({ error: 'Air quality data is unavailable right now. Try again in a few minutes.' });
});

const port = process.env.PORT || 3000;
if (process.argv[1] === fileURLToPath(import.meta.url)) app.listen(port, () => console.log(`Clear Day running on http://localhost:${port}`));
export default app;
