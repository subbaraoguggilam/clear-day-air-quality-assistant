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
  → Gemini prompt: CONTEXT + SAFETY_CONSTRAINTS + COMPUTED_IMPACT
  → Schema & safety validation → retry → rule-based fallback
  → Rich UI: AQI gauge, PM2.5 bar chart, impact grid, ask-anything chat
```

### Key design decisions

| Decision | Detail |
|---|---|
| **Rules before the model** | AQI > 150 → no outdoor exercise for anyone. AQI > 300 → stay indoors. Sensitive households get mask and ventilation constraints injected into every prompt. |
| **Validated output** | Gemini JSON is schema-checked and scanned for forbidden exertion words (jog, run, cycle, bike, sprint) when AQI > 150. Failure triggers one retry, then a full rule-based fallback. |
| **Numbers never from the model** | CO₂ saved, PM2.5 exposure reduction, and cigarette-equivalent values are computed in code and cited by text in the prompt. The model is instructed not to invent numbers. |
| **Cleanest window** | We scan 24 hours of hourly PM2.5 forecasts (06:00–20:00) and find the lowest consecutive 2-hour average — visualised in the in-page SVG bar chart. |
| **Cigarette equivalent** | 22 µg/m³ daily mean PM2.5 ≈ 1 cigarette/day (Berkeley Air). Makes health cost tangible without being alarmist. |
| **Transparency drawer** | A "Why this advice" card lists every rule triggered; an assumptions panel sits under the impact grid. |

## How to run

```bash
npm install
cp .env.example .env     # add your GEMINI_API_KEY (free: https://aistudio.google.com/apikey)
npm start                # → http://localhost:3000
npm test                 # 10 unit tests, zero network required
```

Without a Gemini key the app still returns a complete rule-based plan, clearly labelled as such.

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
server.js              — Express server (rate limit, security headers, caching, error handling)
src/
  domain/
    aqi.js             — AQI classification, cleanest window, hourly chart data, cigarette eq.
    rules.js           — Safety constraints, forbidden word filter, rule-based fallback advice
    impact.js          — CO₂ savings, PM2.5 exposure cut, health score math
  services/
    aqiClient.js       — Open Meteo geocoding + air quality client (cached)
    llm.js             — Gemini prompt builder, output validation, retry, fallback
  api/
    validate.js        — Whitelist validation for all request fields
public/
  index.html           — Semantic, accessible single-page app
  styles.css           — Design system: tokens, type scale, AQI colours, responsive layout
  app.js               — Rendering: AQI gauge, SVG PM2.5 chart, impact grid, ask-chat
  404.html             — Lightweight 404 page
tests/
  domain.test.js       — 10 unit tests (zero network, built-in Node test runner)
```
