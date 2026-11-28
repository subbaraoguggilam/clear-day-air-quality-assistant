# Clear Day: Urban Air Quality Assistant

A GenAI-powered assistant that helps families navigate severe winter smog. It reads live air quality for your location, then produces a personalised smog-safe daily routine, indoor air fixes, and sustainable swaps — with every recommendation's direct health and carbon impact explained.

## Chosen vertical

Families and communities in smog-affected Indian cities (default: Anantapur, Andhra Pradesh). Household vulnerabilities (children, older adults, asthma, pregnancy), commute mode, and cooking fuel drive the advice.

## Approach and logic

> **Deterministic code owns facts and safety. GenAI owns personalisation and language.**

```
City / GPS + Profile
  → Open Meteo air quality & geocoding (live AQI, PM2.5, PM10, NO₂, O₃ + 48 h forecast)
  → AQI band classification (src/domain/aqi.js)
  → Cleanest 2-hour window detection (diurnal inversion scan)
  → Safety rules (src/domain/rules.js) — hard limits before the AI sees anything
  → Impact math (src/domain/impact.js) — CO₂, PM2.5 exposure cut, cigarette equivalents
  → Tier 1: Gemini (GenAI) prompt: CONTEXT + SAFETY_CONSTRAINTS + COMPUTED_IMPACT
  → Schema & safety validation → retry
  → Tier 2 (Fallback): SHAP Explainable ML Model (src/domain/shap.js) with exact Shapley feature attribution
  → Tier 3 (Ultimate Fallback): Deterministic Safety Rule Engine
  → Rich UI: AQI gauge, PM2.5 bar chart, impact grid, SHAP breakdown, ask-anything chat
```

### Key design decisions

| Decision | Detail |
|---|---|
| **Tiered Intelligence Architecture** | **Gemini (GenAI)** produces rich, household-tailored routines and indoor air fixes. If GenAI is unavailable or fails safety filters, the **SHAP Explainable ML Model** acts as primary fallback with exact Shapley attribution before reverting to deterministic safety rules. |
| **Rules before the model** | AQI > 150 → no outdoor exercise for anyone. AQI > 300 → stay indoors. Sensitive households get mask and ventilation constraints injected into every prompt, and Good/Moderate days (`AQI ≤ 100`) scale guidance smoothly without false stay-indoors warnings. |
| **Validated output & guided retry** | Gemini JSON is schema-checked and scanned for forbidden exertion words (`jog`, `run`, `cycle`, `bike`, `sprint`) when AQI > 150. Validation failures feed the specific reason back into a guided retry before falling back to SHAP. |
| **SHAP Explainability & Q&A** | Exact Shapley value computation calculates marginal risk from outdoor AQI, household vulnerability, transit exposure, and indoor cooking fuel—and powers topic-aware Q&A fallback when Gemini is offline. |
| **Numbers never from the model** | CO₂ saved, PM2.5 exposure cut, health score, and cigarette-equivalent values are computed in code and passed in `COMPUTED_IMPACT`. The model is instructed never to invent numbers. |
| **Cleanest window & safe framing** | We scan 24 hours of hourly PM2.5 forecasts (06:00–20:00) for the lowest consecutive 2-hour average, visualise it in an interactive SVG bar chart with hover tooltips, and automatically shift calendar reminders to tomorrow when the window has passed. |
| **Intuitive Planner UX** | Quick-try city presets (`Anantapur`, `Delhi`, `Mumbai`, `Bengaluru`, `Kolkata`), smart `Work from home` commute-distance disabling, cooking-fuel context pills, and suggested Q&A chips make testing and daily use effortless. |
| **Cigarette equivalent** | 22 µg/m³ daily mean PM2.5 ≈ 1 cigarette/day (Berkeley Air). Makes health cost tangible without being alarmist. |
| **Transparency drawer** | A "Why this advice" card lists every rule triggered; an assumptions panel sits under the impact grid. |
| **PWA & Offline Shell** | Web App Manifest and Service Worker enable home screen installation and offline browsing of safety guides and AQI tables. |
| **Community Sharing & Calendar** | 1-tap WhatsApp sharing formatted for family groups, clipboard export, and 1-click Google Calendar / `.ics` integration for the cleanest air window. |
| **CADR Sizing Calculator** | EPA-grounded Clean Air Delivery Rate calculator for room size, ceiling height, and required fan filter setups. |
| **Audio Accessibility** | Native Web Speech API integration reads out a daily smog briefing with a single click. |

## How to run

```bash
npm install
cp .env.example .env     # add your GEMINI_API_KEY (free: https://aistudio.google.com/apikey)
npm start                # → http://localhost:3000
npm run check            # syntax check server and frontend scripts
npm test                 # 50 unit & integration tests, zero network required
```

Without a Gemini key the app still returns a complete SHAP/rule-based plan, clearly labelled as such.

## Deployment & Live Link Verification

`render.yaml` is included for one-click deployment on [Render](https://render.com) (free Node web service with automatic `/api/health` checks):

1. Push this repository to GitHub (`main` branch).
2. In Render, choose **New → Blueprint**, connect `subbaraoguggilam/clear-day-air-quality-assistant`, and apply `render.yaml`.
3. Set the secret environment variable `GEMINI_API_KEY` in the Render dashboard (optional: without it, Tier 2 SHAP + Tier 3 Rules run automatically).
4. Verify the live deployment after deploy completes:
   - `GET https://<your-live-url>/api/health` returns `{"status":"ok","service":"clear-day","aiConfigured":true,...}`.
   - Open `https://<your-live-url>/`, tap a quick city chip (e.g., **Delhi** or **Anantapur**), and verify the live AQI card, 24h PM2.5 chart, low-emission routine, indoor fixes, and Q&A response.

> **Live Demo URL:** _Add your deployed Render / Railway URL here after publishing (`https://<your-app>.onrender.com`)._

## Security

| Measure | Implementation |
|---|---|
| API key server-side only | Never exposed to the browser — all Gemini calls go through the Express proxy |
| Strict input validation | Whitelist validation of every field before it touches a prompt (`src/api/validate.js`) |
| Prompt injection guard | User-supplied question text is delimited in the prompt and labelled "UNTRUSTED" |
| HTTP security headers | CSP, X-Content-Type-Options, Referrer-Policy set on every response |
| Rate limiting | 20 requests per minute per IP, enforced in memory before any upstream call |
| Body size limit | 10 KB maximum JSON payload (Express `limit`) |
| XSS prevention | UI built entirely with `textContent` and `createElementNS` — no `innerHTML` |
| Caching | Air data and advice cached 10 minutes by geo-bucket (lat/lon rounded to 2 dp) |

## Accessibility

- Semantic HTML (`<main>`, `<section>`, `<article>`, `<fieldset>`, `<legend>`, `<details>`)
- Skip-to-content link
- Visible focus rings on all interactive elements (`focus-visible`)
- `aria-live="polite"` on the results region and ask-form answer
- AQI levels displayed as text + colour — never colour alone
- `prefers-reduced-motion` support: disables all animations and transitions
- Responsive from 320 px to 1200 px; check-grid collapses to single column on small screens
- Screen-reader hidden decorative elements (`aria-hidden="true"`)

## Assumptions

- AQI uses the US scale from Open Meteo (CAMS forecast model).
- Emission factors (g CO₂ per km): scooter 45, car 170, bus 70, metro 30. Typical estimates, not measured values.
- Commute is counted as a round trip, 5 days a week.
- Outdoor exposure hours: 1.5 h/day (0.5 h if working from home).
- A fitted N95/FFP2 mask cuts inhaled PM2.5 by 50 % in daily use.
- Cigarette equivalent: 22 µg/m³ PM2.5 ≈ 1 cigarette/day (Berkeley Air research).
- The safety word filter is intentionally conservative and may replace a valid plan with the fallback.

## Limitations

This is general guidance, not medical advice. Impact figures are estimates. English only.

## Project layout

```
render.yaml            — One-click Render Blueprint deployment config (/api/health check)
server.js              — Express server (rate limit, security headers, caching, /api/health, error handling)
src/
  domain/
    aqi.js             — AQI classification, cleanest window, hourly chart data, cigarette eq.
    rules.js           — Safety constraints, forbidden word filter, tailored indoor hacks & swaps, rule fallback
    impact.js          — CO₂ savings, PM2.5 exposure cut, health score math
    shap.js            — SHAP Explainable ML Model (fallback intelligence & feature attribution)
    purifier.js        — CADR (Clean Air Delivery Rate) and DIY purifier sizing math
  services/
    aqiClient.js       — Open Meteo geocoding + air quality client (cached, comma-city fallback)
    llm.js             — Gemini prompt builder, output validation, guided retry, SHAP/rule fallback
  api/
    validate.js        — Whitelist validation & sanitization for all request fields
public/
  index.html           — Semantic, accessible single-page app & PWA metadata
  styles.css           — Design system: tokens, AQI colours, print stylesheet, responsive layout
  app.js               — Frontend logic: city chips, AQI hero, SVG tooltips, CADR calculator, sharing, speech & calendar
  manifest.json        — PWA web app manifest
  sw.js                — Service Worker for offline static asset caching
  icon.svg             — Vector PWA application icon
  404.html             — Lightweight 404 page
tests/
  domain.test.js       — 30 domain unit tests (zero network, built-in Node test runner)
  llm.test.js          — 6 mocked Gemini, guided retry, and SHAP fallback tests
  server.test.js       — 5 Express route, validation, and security header tests
  validation.test.js   — 9 API validation & safety unit tests
```
