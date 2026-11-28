/* ============================================================
   Clear Day — Frontend application
   XP iteration: rich render, SVG chart, impact grid,
   colour-coded AQI, cigarette-equivalent, accessibility
   ============================================================ */
document.documentElement.classList.add('js');

// ── Service Worker (PWA) ────────────────────────────────────
if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline registration silent fallback */ });
  });
}

// ── Utilities ────────────────────────────────────────────────
const $  = (s) => document.querySelector(s);
/** @param {string} tag @param {string|null} cls @param {...(Node|string)} kids */
const el = (tag, cls, ...kids) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (kids.length) n.append(...kids);
  return n;
};
const txt  = (s) => document.createTextNode(String(s));
const hh   = (h) => `${String(h).padStart(2, '0')}:00`;
const STORE = 'clearday.profile';

const COMMUTE_LABEL = {
  two_wheeler: 'scooter or motorbike', car: 'car', bus: 'bus',
  metro: 'metro', walk_cycle: 'walking or cycling', wfh: 'working from home',
};
const COOKING_LABEL = {
  lpg: 'LPG / piped gas', wood: 'wood or biomass', induction: 'induction / electric',
};

// ── Form refs ────────────────────────────────────────────────
const form          = $('#plan-form');
const result        = $('#result');
const askForm       = $('#ask-form');
const answer        = $('#answer');
const cityInput     = $('#city');
const geoStatus     = $('#geo-status');
const commuteSelect = $('#commute');
const distanceInput = $('#distanceKm');
const distanceField = $('#distance-field');
const distanceHint  = $('#distance-hint');
const cityChips     = document.querySelectorAll('[data-city]');
let coords   = null;
let lastBody = null;

function syncCommuteDistance() {
  const isWfh = commuteSelect.value === 'wfh';
  distanceInput.disabled = isWfh;
  distanceField?.classList.toggle('field-disabled', isWfh);
  if (distanceHint) {
    distanceHint.textContent = isWfh ? 'Not needed when working from home.' : '';
  }
}

function syncCityChips() {
  const current = cityInput.value.trim().toLowerCase();
  cityChips.forEach((chip) => {
    chip.classList.toggle('active', !coords && chip.dataset.city.toLowerCase() === current);
  });
}

// ── Profile persistence (localStorage only) ──────────────────
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
  for (const [k, v] of Object.entries(saved)) {
    const f = form.elements[k];
    if (!f) continue;
    if (f.type === 'checkbox') f.checked = Boolean(v);
    else f.value = v;
  }
} catch { /* storage unavailable */ }
syncCommuteDistance();
syncCityChips();

commuteSelect.addEventListener('change', syncCommuteDistance);
cityChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    coords = null;
    cityInput.value = chip.dataset.city;
    cityInput.required = true;
    cityInput.classList.remove('error-field');
    geoStatus.textContent = '';
    syncCityChips();
  });
});

// ── Read form into request body ───────────────────────────────
function readBody() {
  const f = new FormData(form);
  try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(f))); } catch { /* ignore */ }
  const profile = {
    children:   f.has('children'),
    elderly:    f.has('elderly'),
    asthma:     f.has('asthma'),
    pregnancy:  f.has('pregnancy'),
    commute:    f.get('commute'),
    cooking:    f.get('cooking'),
    distanceKm: Number(f.get('distanceKm')),
  };
  return coords
    ? { lat: coords.lat, lon: coords.lon, profile }
    : { city: String(f.get('city') || ''), profile };
}

// ── POST helper ───────────────────────────────────────────────
async function post(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong. Please try again.');
  return d;
}

// ── Geolocation ───────────────────────────────────────────────
$('#geo').addEventListener('click', () => {
  geoStatus.textContent = 'Finding your location…';
  if (!navigator.geolocation) {
    geoStatus.textContent = 'Location is not supported here. Enter a city instead.';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (p) => {
      coords = { lat: p.coords.latitude, lon: p.coords.longitude };
      cityInput.value = '';
      cityInput.required = false;
      geoStatus.textContent = 'Using your current location.';
    },
    () => { geoStatus.textContent = 'Location permission denied. Enter a city instead.'; },
    { timeout: 10000 }
  );
});
cityInput.addEventListener('input', () => {
  coords = null;
  cityInput.required = true;
  cityInput.classList.remove('error-field');
  syncCityChips();
});

// ── Feature Helpers: Calendar, Purifier, Share & Speech ───────
/**
 * Computes required Clean Air Delivery Rate (CADR) and DIY filter setup for a room.
 * Matches server-side EPA/ASHRAE bounds in src/domain/purifier.js.
 * @param {number} sqFt - Room floor area in square feet
 * @param {number} [height=9] - Ceiling height in feet
 * @param {number} [ach=4.5] - Target Air Changes per Hour
 * @returns {{ volume: number, cfm: number, m3h: number, time: number, rec: string }}
 */
function calcPurifier(sqFt, height = 9, ach = 4.5) {
  const boundedArea = Math.max(20, Math.min(2000, Number(sqFt) || 150));
  const boundedHeight = Math.max(7, Math.min(16, Number(height) || 9));
  const boundedAch = Math.max(2, Math.min(10, Number(ach) || 4.5));
  const volume = Math.round(boundedArea * boundedHeight);
  const cfm = Math.round((volume * boundedAch) / 60);
  const m3h = Math.round(cfm * 1.699);
  const time = Math.round((Math.log(5) / boundedAch) * 60);
  let rec = '';
  if (cfm <= 140) {
    rec = 'Single-Filter Mini Fan Box (₹1,000–₹1,500 / $12–$18) — ideal for small bedrooms.';
  } else if (cfm <= 280) {
    rec = '2-Filter Wedge Corsi-Rosenthal Box (₹1,800–₹2,500 / $22–$30) — ideal for bedrooms & studies.';
  } else {
    rec = 'Full 4-Filter Corsi-Rosenthal Cube (₹2,800–₹3,800 / $34–$45) — high airflow for living spaces.';
  }
  return { volume, cfm, m3h, time, rec };
}

/**
 * Formats an upcoming local hour into an iCalendar/Google Calendar UTC timestamp,
 * rolling to tomorrow when the target hour has already passed today.
 * @param {number} hour - Hour of day (0-23)
 * @returns {string}
 */
function formatCalDate(hour) {
  const now = new Date();
  const dayOffset = hour < now.getHours() ? 1 : 0;
  const dateObj = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, 0, 0);
  return dateObj.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * Builds a pre-filled Google Calendar event URL for the cleanest air window.
 * @param {string} loc - Location display label
 * @param {number} startHour - Start hour
 * @param {number} endHour - End hour
 * @returns {string}
 */
function getGoogleCalUrl(loc, startHour, endHour) {
  const start = formatCalDate(startHour);
  const end = formatCalDate(endHour);
  const title = encodeURIComponent(`🌿 Cleanest Air Window — ${loc}`);
  const details = encodeURIComponent(`Clear Day recommendation: Cleanest 2-hour air window today in ${loc} (${hh(startHour)}–${hh(endHour)}). Best time to open windows or run essential errands.`);
  const location = encodeURIComponent(loc);
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${location}`;
}

/**
 * Generates and triggers a download for a standard .ics calendar event file.
 * @param {string} loc - Location display label
 * @param {number} startHour - Start hour
 * @param {number} endHour - End hour
 */
function downloadIcs(loc, startHour, endHour) {
  const start = formatCalDate(startHour);
  const end = formatCalDate(endHour);
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Clear Day//Air Quality Assistant//EN',
    'BEGIN:VEVENT',
    `SUMMARY:🌿 Cleanest Air Window (${hh(startHour)}-${hh(endHour)}) - ${loc}`,
    `DESCRIPTION:Cleanest air window today in ${loc}. Recommended time for ventilation and essential errands.`,
    `LOCATION:${loc}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `clearday-window-${startHour}h.ics`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Formats a concise, emoji-friendly advisory summary for clipboard and WhatsApp sharing.
 * @param {any} data - Rendered API advice response
 * @returns {string}
 */
function getShareSummary(data) {
  const win = data.bestWindow ? `${hh(data.bestWindow.startHour)} to ${hh(data.bestWindow.endHour)}` : 'N/A';
  return [
    `🌤️ Clear Day Air Advisory — ${data.location}`,
    `AQI: ${data.air.aqi} (${data.band.label}) | PM2.5: ${data.air.pm25} µg/m³`,
    data.alertBanner ? `⚠️ ${data.alertBanner.text}` : null,
    data.bestWindow ? `🌿 Cleanest window: ${win}` : null,
    data.advice?.summary ? `\n📋 Plan: ${data.advice.summary}` : null,
    data.impact?.exposure ? `🛡️ Inhaled PM2.5 cut: ~${data.impact.exposure.cutPct}% with mask & smart timing.` : null,
    `\nGet your free plan: ${window.location.origin}`
  ].filter(Boolean).join('\n');
}

/**
 * Speaks or stops the daily spoken air briefing using the browser Web Speech API.
 * @param {string} text - Spoken briefing script
 * @param {HTMLButtonElement} btn - Trigger button element
 */
function toggleBriefing(text, btn) {
  if (!('speechSynthesis' in window)) {
    btn.textContent = 'Speech not supported';
    return;
  }
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    btn.textContent = '🔊 Listen to plan';
    btn.setAttribute('aria-pressed', 'false');
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  utterance.onend = () => {
    btn.textContent = '🔊 Listen to plan';
    btn.setAttribute('aria-pressed', 'false');
  };
  utterance.onerror = () => {
    btn.textContent = '🔊 Listen to plan';
    btn.setAttribute('aria-pressed', 'false');
  };
  btn.textContent = '⏹️ Stop listening';
  btn.setAttribute('aria-pressed', 'true');
  window.speechSynthesis.speak(utterance);
}

// ── SVG PM2.5 bar chart ───────────────────────────────────────
/**
 * @param {Array<{label:string, hour:number, pm25:number|null}>} data
 * @param {number|null} bestStart – startHour of the cleanest window
 */
function buildChart(data, bestStart) {
  if (!data || !data.length) return null;
  const W = 600, H = 100, PAD_L = 0, PAD_B = 22, PAD_T = 8;
  const pts = data.filter((d) => d.pm25 != null);
  if (!pts.length) return null;
  const max = Math.max(...pts.map((d) => d.pm25), 50);
  const colW = (W - PAD_L) / data.length;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Hourly PM2.5 forecast for the next 24 hours');
  svg.classList.add('chart-svg');

  // PM2.5 WHO guideline line at 15 µg/m³
  const whoY = PAD_T + (1 - 15 / max) * (H - PAD_B - PAD_T);
  const guideline = document.createElementNS(ns, 'line');
  guideline.setAttribute('x1', PAD_L); guideline.setAttribute('x2', W);
  guideline.setAttribute('y1', whoY);  guideline.setAttribute('y2', whoY);
  guideline.setAttribute('stroke', '#22C55E'); guideline.setAttribute('stroke-width', '1');
  guideline.setAttribute('stroke-dasharray', '3 4'); guideline.setAttribute('opacity', '.5');
  svg.appendChild(guideline);

  data.forEach((d, i) => {
    const x   = PAD_L + i * colW;
    const pct = d.pm25 != null ? Math.min(d.pm25 / max, 1) : 0;
    const barH = pct * (H - PAD_B - PAD_T);
    const y   = H - PAD_B - barH;

    // Highlight best window
    const isWin = bestStart != null && d.hour >= bestStart && d.hour < bestStart + 2;
    if (isWin) {
      const hl = document.createElementNS(ns, 'rect');
      hl.setAttribute('x', x); hl.setAttribute('y', PAD_T);
      hl.setAttribute('width', colW); hl.setAttribute('height', H - PAD_B - PAD_T);
      hl.setAttribute('fill', 'rgba(34,197,94,0.12)');
      svg.appendChild(hl);
    }

    if (d.pm25 != null) {
      // Colour based on level
      const fillColor = d.pm25 <= 12 ? '#22C55E'
        : d.pm25 <= 35 ? '#EAB308'
        : d.pm25 <= 55 ? '#F97316'
        : '#EF4444';

      const bar = document.createElementNS(ns, 'rect');
      bar.setAttribute('x', x + 1); bar.setAttribute('y', y);
      bar.setAttribute('width', Math.max(colW - 2, 2)); bar.setAttribute('height', barH);
      bar.setAttribute('fill', isWin ? '#22C55E' : fillColor);
      bar.setAttribute('rx', '2');
      const tip = document.createElementNS(ns, 'title');
      tip.textContent = `${d.label}: ${d.pm25} µg/m³${isWin ? ' (Cleanest window)' : ''}`;
      bar.appendChild(tip);
      svg.appendChild(bar);
    }

    // X-axis labels — every 4 hours
    if (d.hour % 4 === 0) {
      const lbl = document.createElementNS(ns, 'text');
      lbl.setAttribute('x', x + colW / 2); lbl.setAttribute('y', H - 6);
      lbl.setAttribute('text-anchor', 'middle');
      lbl.setAttribute('fill', '#666'); lbl.setAttribute('font-size', '9');
      lbl.textContent = `${String(d.hour).padStart(2, '0')}h`;
      svg.appendChild(lbl);
    }
  });

  // WHO label
  const whoLbl = document.createElementNS(ns, 'text');
  whoLbl.setAttribute('x', W - 2); whoLbl.setAttribute('y', whoY - 3);
  whoLbl.setAttribute('text-anchor', 'end');
  whoLbl.setAttribute('fill', '#22C55E'); whoLbl.setAttribute('font-size', '8');
  whoLbl.textContent = 'WHO 15 µg/m³';
  svg.appendChild(whoLbl);

  return svg;
}

// ── Main render function ──────────────────────────────────────
function render(d) {
  const { air, band, impact, advice, constraints, hourlyChart, alertBanner, trend, diyFilter } = d;
  const win = d.bestWindow
    ? `${hh(d.bestWindow.startHour)} to ${hh(d.bestWindow.endHour)}`
    : 'not available today';

  const nodes = [];

  // ── 0. Alert banner (hazardous / danger / warning) ───────────
  if (alertBanner) {
    const banner = el('div', 'alert-banner');
    banner.setAttribute('role', 'alert');
    banner.style.setProperty('--banner-color', alertBanner.color);
    const icon = el('span', 'alert-icon');
    icon.textContent = alertBanner.level === 'emergency' ? '🚨' : alertBanner.level === 'danger' ? '⚠️' : '🔶';
    icon.setAttribute('aria-hidden', 'true');
    const msg = el('span', 'alert-text'); msg.textContent = alertBanner.text;
    banner.append(icon, msg);
    nodes.push(banner);
  }

  // ── 1. AQI hero card ──────────────────────────────────────
  const aqiCard = el('section', 'card aqi-hero-card');
  aqiCard.style.setProperty('--aqi-glow', band.color || '#fff');

  const bandPill = el('div', 'aqi-band-pill');
  bandPill.style.setProperty('--aqi-bg',   band.color   || '#888');
  bandPill.style.setProperty('--aqi-text', band.textColor || '#fff');
  bandPill.append(txt(`Level ${band.level + 1} of 6 — ${band.label}`));

  const aqiNumEl = el('div', 'aqi-num');
  aqiNumEl.textContent = air.aqi;

  const locationEl = el('p', 'title-2');
  locationEl.textContent = d.location;

  const metaGrid = el('div', 'aqi-meta-grid');
  const metaItems = [
    ['PM2.5 (Fine dust)', `${air.pm25 ?? '—'} µg/m³`],
    ['PM10 (Coarse dust)', `${air.pm10 ?? '—'} µg/m³`],
    ['NO₂ (Traffic gas)', `${air.no2 ?? '—'} µg/m³`],
    ['O₃ (Ozone)', `${air.o3 ?? '—'} µg/m³`],
  ];
  metaItems.forEach(([lbl, val]) => {
    const cell = el('div', 'aqi-meta-cell');
    const v = el('div', 'aqi-meta-val'); v.textContent = val;
    const l = el('div', 'aqi-meta-lbl'); l.textContent = lbl;
    cell.append(v, l);
    metaGrid.append(cell);
  });

  const unitLegend = el('p', 'caption-2 muted');
  unitLegend.textContent = 'µg/m³ = micrograms of pollutant per cubic meter of air (lower is cleaner).';

  aqiCard.append(locationEl, aqiNumEl, bandPill, metaGrid, unitLegend);

  // Best window badge & calendar actions (framed safely for severe AQI)
  if (d.bestWindow) {
    const windowPrefix =
      air.aqi > 300
        ? '🪟 Lowest-pollution window (stay indoors; brief check only): '
        : air.aqi > 200
          ? '😷 Briefest exposure window (essential trips only, N95): '
          : '🌿 Cleanest outdoor window: ';
    const wb = el(
      'div',
      'window-badge',
      txt(windowPrefix),
      el('strong', null, win),
      txt(` (PM2.5 ${d.bestWindow.pm25} µg/m³)`)
    );

    const calWrap = el('div', 'cal-actions');
    const gCalLink = el('a', 'btn btn-ghost btn-sm');
    gCalLink.href = getGoogleCalUrl(d.location, d.bestWindow.startHour, d.bestWindow.endHour);
    gCalLink.target = '_blank';
    gCalLink.rel = 'noopener noreferrer';
    gCalLink.textContent = '📅 Add to Google Calendar';

    const icsBtn = el('button', 'btn btn-ghost btn-sm');
    icsBtn.type = 'button';
    icsBtn.textContent = '📥 Download .ics';
    icsBtn.addEventListener('click', () => downloadIcs(d.location, d.bestWindow.startHour, d.bestWindow.endHour));

    calWrap.append(gCalLink, icsBtn);
    aqiCard.append(wb, calWrap);
  }

  // Trend badge
  if (trend) {
    const trendBadge = el('div', 'trend-badge');
    const trendIcon = trend === 'rising' ? '📈' : trend === 'falling' ? '📉' : '➡️';
    const trendText = trend === 'rising' ? 'PM2.5 rising — plan to stay in soon'
      : trend === 'falling' ? 'PM2.5 falling — conditions improving'
      : 'PM2.5 stable';
    trendBadge.setAttribute('aria-label', `Pollution trend: ${trendText}`);
    const trendEl = el('span'); trendEl.textContent = `${trendIcon} ${trendText}`;
    trendBadge.append(trendEl);
    aqiCard.append(trendBadge);
  }

  // PM2.5 chart
  if (hourlyChart && hourlyChart.length) {
    const chartWrap = el('div', 'chart-wrap');
    const svg = buildChart(hourlyChart, d.bestWindow?.startHour ?? null);
    if (svg) {
      const chartLbl = el('p', 'caption-2 muted');
      chartLbl.textContent = '24-hour fine dust (PM2.5) forecast. Hover bars for hourly readings.';
      const legend = el(
        'div',
        'chart-legend',
        el('span', 'legend-item', Object.assign(el('span', 'legend-swatch'), { style: 'background:#22C55E' }), txt('Cleanest window / ≤12 µg/m³')),
        el('span', 'legend-item', Object.assign(el('span', 'legend-swatch'), { style: 'background:#EAB308' }), txt('13–35 µg/m³')),
        el('span', 'legend-item', Object.assign(el('span', 'legend-swatch'), { style: 'background:#F97316' }), txt('36–55 µg/m³')),
        el('span', 'legend-item', Object.assign(el('span', 'legend-swatch'), { style: 'background:#EF4444' }), txt('>55 µg/m³'))
      );
      chartWrap.append(svg, legend);
      aqiCard.append(chartWrap, chartLbl);
    }
  }

  if (air.updated) {
    const upd = el('p', 'caption-2 muted');
    upd.textContent = `Live reading timestamp: ${air.updated.replace('T', ' ')}`;
    aqiCard.append(upd);
  }

  nodes.push(aqiCard);

  // ── 1.5 Plan Action Bar (WhatsApp, Copy, Print, Audio Briefing) ─
  const actionsWrap = el('div', 'plan-actions');
  const shareText = getShareSummary(d);

  // WhatsApp Share button
  const waBtn = el('a', 'btn btn-sm btn-whatsapp');
  waBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
  waBtn.target = '_blank';
  waBtn.rel = 'noopener noreferrer';
  waBtn.setAttribute('aria-label', "Share today's air plan on WhatsApp");
  waBtn.textContent = '💬 Share on WhatsApp';

  // Copy Plan button
  const copyBtn = el('button', 'btn btn-ghost btn-sm');
  copyBtn.type = 'button';
  copyBtn.textContent = '📋 Copy plan';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => { copyBtn.textContent = '📋 Copy plan'; }, 2000);
    } catch {
      copyBtn.textContent = 'Failed to copy';
    }
  });

  // Print / PDF button
  const printBtn = el('button', 'btn btn-ghost btn-sm');
  printBtn.type = 'button';
  printBtn.textContent = '🖨️ Print / PDF';
  printBtn.addEventListener('click', () => window.print());

  // Audio Speech button
  const audioBtn = el('button', 'btn btn-ghost btn-sm');
  audioBtn.type = 'button';
  audioBtn.textContent = '🔊 Listen to plan';
  const speechText = `Today's air quality in ${d.location} is AQI ${air.aqi}, which is ${band.label}. ${advice.summary || ''} ${d.bestWindow ? `Your cleanest outdoor window is from ${hh(d.bestWindow.startHour)} to ${hh(d.bestWindow.endHour)}.` : ''}`;
  audioBtn.addEventListener('click', () => toggleBriefing(speechText, audioBtn));

  actionsWrap.append(waBtn, copyBtn, printBtn, audioBtn);
  nodes.push(actionsWrap);

  // ── 2. Why this advice ─────────────────────────────────────
  const whyCard = el('section', 'card');
  whyCard.setAttribute('aria-label', 'Why this advice');
  const whyH = el('h3', 'heading-6'); whyH.textContent = 'Why this advice';
  const whySub = el('p', 'body-2 muted');
  whySub.textContent = `Triggered by AQI ${air.aqi} (${band.label}) and your household profile.`;
  whyCard.append(whyH, whySub);

  if (constraints.length) {
    const cl = el('ul', 'constraint-list');
    cl.setAttribute('aria-label', 'Active safety rules');
    constraints.forEach((c) => {
      const li = el('li', 'constraint-item');
      const dot = el('div', 'constraint-dot'); dot.setAttribute('aria-hidden', 'true');
      const sp = el('span'); sp.textContent = c.text;
      li.append(dot, sp);
      cl.append(li);
    });
    whyCard.append(cl);
  } else {
    const ok = el('p', 'body-3');
    ok.textContent = 'No special limits today. Normal precautions apply.';
    whyCard.append(ok);
  }
  nodes.push(whyCard);

  // ── 3. Daily routine ───────────────────────────────────────
  const routineCard = el('section', 'card');
  routineCard.setAttribute('aria-label', 'Your daily routine plan');
  const routHead = el('div', 'card-head');
  const routH = el('h3', 'heading-6'); routH.textContent = 'Your low-emission routine';
  const routPill = el('span', 'card-pill');
  routPill.textContent = d.bestWindow ? `Timed for ${win}` : 'Daily schedule';
  routHead.append(routH, routPill);
  const sumEl = el('p', 'body-3'); sumEl.textContent = advice.summary;
  const routList = el('ul', 'list');
  routList.setAttribute('aria-label', 'Daily routine steps');
  advice.routine.forEach((r) => {
    const li = el('li');
    const timeTag = el('span', 'list-time'); timeTag.textContent = r.time;
    const act = el('p', 'body-3');  act.textContent = r.action;
    const why = el('p', 'body-2 muted');
    why.append(el('span', 'impact-tag', txt('Why: ')), txt(r.why));
    li.append(timeTag, act, why);
    routList.append(li);
  });
  routineCard.append(routHead, sumEl, routList);
  nodes.push(routineCard);

  // ── 4. Indoor air hacks ────────────────────────────────────
  const hackCard = el('section', 'card');
  hackCard.setAttribute('aria-label', 'Indoor air quality hacks');
  const hackHead = el('div', 'card-head');
  const hackH = el('h3', 'heading-6'); hackH.textContent = 'Indoor air fixes';
  const cookFuel = lastBody?.profile?.cooking;
  if (cookFuel && COOKING_LABEL[cookFuel]) {
    const cookPill = el('span', 'card-pill');
    cookPill.textContent = `Tailored for ${COOKING_LABEL[cookFuel]}`;
    hackHead.append(hackH, cookPill);
  } else {
    hackHead.append(hackH);
  }
  const hackList = el('ul', 'hack-list');
  advice.indoor_hacks.forEach((h, i) => {
    const li   = el('li', 'hack-item');
    const num  = el('div', 'hack-num'); num.textContent = `${i + 1}`;
    num.setAttribute('aria-hidden', 'true');
    const body = el('div', 'hack-body');
    const tip  = el('p', 'body-3');     tip.textContent = h.tip;
    const imp  = el('p', 'body-2 muted');
    imp.append(el('span', 'impact-tag', txt('Impact: ')), txt(h.impact));
    body.append(tip, imp);
    li.append(num, body);
    hackList.append(li);
  });
  hackCard.append(hackHead, hackList);
  nodes.push(hackCard);

  // ── 5. Sustainable alternatives ────────────────────────────
  const altCard = el('section', 'card');
  altCard.setAttribute('aria-label', 'Sustainable alternatives');
  const altHead = el('div', 'card-head');
  const altH = el('h3', 'heading-6'); altH.textContent = 'Low-emission swaps';
  const commuteMode = lastBody?.profile?.commute;
  if (commuteMode && COMMUTE_LABEL[commuteMode]) {
    const commPill = el('span', 'card-pill');
    commPill.textContent = `Current: ${COMMUTE_LABEL[commuteMode]}`;
    altHead.append(altH, commPill);
  } else {
    altHead.append(altH);
  }
  const altList = el('ul', 'hack-list');
  advice.alternatives.forEach((a, i) => {
    const li   = el('li', 'hack-item');
    const num  = el('div', 'hack-num'); num.textContent = ['🌿','⚡','🚶','🌱'][i] || `${i + 1}`;
    num.setAttribute('aria-hidden', 'true');
    const body = el('div', 'hack-body');
    const swap = el('p', 'body-3');       swap.textContent = a.swap;
    const ben  = el('p', 'body-2 muted');
    ben.append(el('span', 'impact-tag', txt('Benefit: ')), txt(a.benefit));
    body.append(swap, ben);
    li.append(num, body);
    altList.append(li);
  });
  altCard.append(altHead, altList);
  nodes.push(altCard);

  // ── 6. Impact numbers ──────────────────────────────────────
  const impCard = el('section', 'card');
  impCard.setAttribute('aria-label', 'Health and carbon impact');
  const impH = el('h3', 'heading-6'); impH.textContent = 'Your impact today';
  const impGrid = el('div', 'impact-grid');

  // PM2.5 exposure cut
  const expCell = el('div', 'impact-cell');
  const expVal  = el('div', 'impact-val impact-green');
  expVal.textContent = `${impact.exposure.cutPct}%`;
  const expLbl = el('div', 'impact-lbl');
  expLbl.textContent = 'less PM2.5 inhaled — with a fitted mask and outdoor time in the cleanest window';
  expCell.append(expVal, expLbl);
  impGrid.append(expCell);

  // Cigarettes equivalent
  if (impact.cigarettesPerDay != null) {
    const cigCell = el('div', 'impact-cell');
    const cigVal  = el('div', 'impact-val');
    cigVal.textContent = `≈ ${impact.cigarettesPerDay}`;
    const cigLbl = el('div', 'impact-lbl');
    cigLbl.textContent = `cigarette-equivalent per day at today's PM2.5 of ${air.pm25} µg/m³ (Berkeley Air estimate)`;
    cigCell.append(cigVal, cigLbl);
    impGrid.append(cigCell);
  }

  // CO₂ saved
  if (impact.co2) {
    const co2Cell = el('div', 'impact-cell');
    const co2Val  = el('div', 'impact-val impact-green');
    co2Val.textContent = `${impact.co2.savedKgDay} kg`;
    const co2Lbl = el('div', 'impact-lbl');
    co2Lbl.textContent = `kilograms (kg) of CO₂ saved per day by switching from ${COMMUTE_LABEL[impact.co2.from]} to metro (${impact.co2.savedKgWeek} kg/week)`;
    co2Cell.append(co2Val, co2Lbl);
    impGrid.append(co2Cell);

    // Weekly kg as a visual comparison
    const weekCell = el('div', 'impact-cell');
    const weekVal  = el('div', 'impact-val impact-green');
    weekVal.textContent = `${impact.co2.savedKgWeek} kg`;
    const weekLbl = el('div', 'impact-lbl');
    weekLbl.textContent = 'kilograms (kg) of CO₂ saved per week — roughly equivalent to planting a sapling';
    weekCell.append(weekVal, weekLbl);
    impGrid.append(weekCell);
  }

  // Health score
  if (impact.healthScore != null) {
    const hsCell = el('div', 'impact-cell');
    const hsVal  = el('div', impact.healthScore >= 60 ? 'impact-val impact-green' : 'impact-val impact-red');
    hsVal.textContent = `${impact.healthScore}/100`;
    const hsLbl = el('div', 'impact-lbl');
    hsLbl.textContent = 'air health score today — 100 is clean, 0 is hazardous (based on PM2.5)';
    hsCell.append(hsVal, hsLbl);
    impGrid.append(hsCell);
  }

  // Assumptions details
  const assump = el('details');
  const assumpS = el('summary', 'title-4'); assumpS.textContent = 'How we calculated this';
  const assumpList = el('ul', 'hack-list');
  impact.assumptions.forEach((a) => {
    const li = el('li', 'hack-item');
    const dot = el('div', 'hack-num'); dot.textContent = '·'; dot.setAttribute('aria-hidden', 'true');
    const sp = el('p', 'body-2 muted'); sp.textContent = a;
    li.append(dot, sp);
    assumpList.append(li);
  });
  assump.append(assumpS, assumpList);

  impCard.append(impH, impGrid, assump);
  nodes.push(impCard);

  // ── 7. DIY Filter Guide (AQI > 100 only) ──────────────────
  if (diyFilter) {
    const diyCard = el('section', 'card');
    diyCard.setAttribute('aria-label', 'DIY air filter guide');
    const diyH = el('h3', 'heading-6'); diyH.textContent = `🛠️ ${diyFilter.title}`;
    const diyCost = el('p', 'body-2 muted');
    diyCost.textContent = `Cost: ${diyFilter.cost} · ${diyFilter.effectiveness}`;

    const diyDetails = el('details');
    const diySum = el('summary', 'title-4'); diySum.textContent = 'How to build it';
    const matH = el('p', 'body-3'); matH.textContent = 'You will need:';
    const matList = el('ul', 'hack-list');
    diyFilter.materials.forEach((m) => {
      const li = el('li', 'hack-item');
      const dot = el('div', 'hack-num'); dot.textContent = '·'; dot.setAttribute('aria-hidden', 'true');
      const sp = el('p', 'body-3 muted'); sp.textContent = m;
      li.append(dot, sp); matList.append(li);
    });
    const stepH = el('p', 'body-3'); stepH.textContent = 'Steps:';
    const stepList = el('ol', 'hack-list');
    diyFilter.steps.forEach((s, i) => {
      const li = el('li', 'hack-item');
      const num = el('div', 'hack-num'); num.textContent = `${i + 1}`; num.setAttribute('aria-hidden', 'true');
      const sp = el('p', 'body-3 muted'); sp.textContent = s;
      li.append(num, sp); stepList.append(li);
    });
    diyDetails.append(diySum, matH, matList, stepH, stepList);
    diyCard.append(diyH, diyCost, diyDetails);

    // ── Interactive Room Purifier & CADR Sizing Tool ──────────
    const calcSection = el('div', 'cadr-calc');
    const calcTitle = el('h4', 'title-4'); calcTitle.textContent = '📐 Room Air Purifier Sizing Calculator';
    const calcDesc = el('p', 'caption-2 muted');
    calcDesc.textContent = 'Find the fan airflow power and DIY filter size needed to clear 80% of smoke and dust from your room.';
    
    const cGrid = el('div', 'cadr-calc-grid');
    const areaWrap = el('div', 'cadr-input-wrap');
    const areaLbl = el('label'); areaLbl.htmlFor = 'cadr-area'; areaLbl.textContent = 'Room Floor Area (sq ft):';
    const areaInput = el('input');
    areaInput.id = 'cadr-area'; areaInput.type = 'number'; areaInput.min = '30'; areaInput.max = '1500'; areaInput.value = '150';
    areaWrap.append(areaLbl, areaInput);

    const heightWrap = el('div', 'cadr-input-wrap');
    const heightLbl = el('label'); heightLbl.htmlFor = 'cadr-height'; heightLbl.textContent = 'Ceiling Height (feet):';
    const heightInput = el('input');
    heightInput.id = 'cadr-height'; heightInput.type = 'number'; heightInput.min = '7'; heightInput.max = '16'; heightInput.value = '9';
    heightWrap.append(heightLbl, heightInput);

    const achWrap = el('div', 'cadr-input-wrap');
    const achLbl = el('label'); achLbl.htmlFor = 'cadr-ach'; achLbl.textContent = 'Air Refreshes per Hour:';
    const achInput = el('select');
    achInput.id = 'cadr-ach';
    [
      ['3', '3× / hour (Normal air day)'],
      ['4.5', '4.5× / hour (Smoggy day — Recommended)'],
      ['6', '6× / hour (Severe smog emergency)']
    ].forEach(([val, label]) => {
      const opt = el('option'); opt.value = val; opt.textContent = label;
      if (val === '4.5') opt.selected = true;
      achInput.append(opt);
    });
    achWrap.append(achLbl, achInput);
    cGrid.append(areaWrap, heightWrap, achWrap);

    const outBox = el('div', 'cadr-output');
    function updateCadr() {
      const sqFt = Math.max(20, Math.min(2000, Number(areaInput.value) || 150));
      const sqMeters = Math.round(sqFt * 0.0929 * 10) / 10;
      const ht = Math.max(7, Math.min(16, Number(heightInput.value) || 9));
      const ach = Math.max(2, Math.min(10, Number(achInput.value) || 4.5));
      const res = calcPurifier(sqFt, ht, ach);
      outBox.replaceChildren(
        el('div', 'cadr-stat', el('span', null, 'Room Size:'), el('strong', null, `${sqFt} sq ft (${sqMeters} m²)`)),
        el('div', 'cadr-stat', el('span', null, 'Required Clean Airflow:'), el('strong', null, `${res.m3h} m³/h (${res.cfm} CFM)`)),
        el('div', 'cadr-stat', el('span', null, 'Time to Clear 80% of Dust:'), el('strong', null, `~${res.time} minutes`)),
        el('p', 'caption-2 muted', `Recommended Setup: ${res.rec}`),
        el('p', 'caption-2 muted', 'Units: m³/h = cubic meters of clean air per hour · CFM = cubic feet per minute.')
      );
    }
    areaInput.addEventListener('input', updateCadr);
    heightInput.addEventListener('input', updateCadr);
    achInput.addEventListener('change', updateCadr);
    updateCadr();

    calcSection.append(calcTitle, calcDesc, cGrid, outBox);
    diyCard.append(calcSection);

    nodes.push(diyCard);
  }

  // ── 7.5 SHAP Explainability Breakdown (when source is 'shap') ─
  const shapData = d.shapExplainer || d.advice?.shapExplainer;
  if (shapData && Array.isArray(shapData.features)) {
    const shapCard = el('section', 'card');
    shapCard.setAttribute('aria-label', 'SHAP Risk Attribution Analysis');
    const shapH = el('h3', 'heading-6');
    shapH.textContent = '⚖️ SHAP Machine Learning Attribution (Fallback Explainability)';
    const shapSub = el('p', 'body-2 muted');
    shapSub.textContent = `Baseline Risk: ${shapData.baseline}% → Predicted Total Risk: ${shapData.predictedRisk}%. Marginal feature contributions (Shapley values):`;
    shapCard.append(shapH, shapSub);

    const shapList = el('ul', 'hack-list');
    shapData.features.forEach((feat) => {
      const li = el('li', 'hack-item');
      const valBadge = el('div', 'hack-num');
      valBadge.textContent = feat.shapValue >= 0 ? `+${feat.shapValue}%` : `${feat.shapValue}%`;
      valBadge.style.color = feat.shapValue > 0 ? 'var(--warn)' : 'var(--accent)';
      
      const body = el('div', 'hack-body');
      const title = el('p', 'body-3');
      title.textContent = feat.name;
      const desc = el('p', 'body-2 muted');
      desc.textContent = feat.shapValue > 0
        ? `Added +${feat.shapValue}% to the predicted smog risk quotient.`
        : 'Neutral / zero marginal impact under current profile.';
      body.append(title, desc);
      li.append(valBadge, body);
      shapList.append(li);
    });

    shapCard.append(shapList);
    nodes.push(shapCard);
  }

  // ── 8. Source & disclaimer ─────────────────────────────────
  const srcEl = el('p', 'caption-2 muted source-tag');
  const dot   = el('span', `source-dot ${d.source}`); dot.setAttribute('aria-hidden', 'true');
  const srcTxt = el('span');
  if (d.source === 'gemini') {
    srcTxt.textContent = 'Plan written by Gemini inside the safety rules.';
  } else if (d.source === 'shap') {
    srcTxt.textContent = 'Plan generated by SHAP Explainable ML Model with feature attribution (Gemini was unavailable).';
  } else {
    srcTxt.textContent = 'Plan built from safety rules (AI services were unavailable).';
  }
  srcEl.append(dot, srcTxt);
  nodes.push(srcEl);

  const disc = el('p', 'caption-2 muted'); disc.textContent = advice.disclaimer;
  nodes.push(disc);

  result.replaceChildren(...nodes);
}

// ── Skeleton loader ───────────────────────────────────────────
function showSkeleton() {
  const sk = el('div', 'card');
  sk.append(
    el('div', 'skel skel-h'),
    el('div', 'skel skel-xl'),
    el('div', 'skel'),
    el('div', 'skel'),
  );
  result.replaceChildren(sk);
}

// ── Form submit ───────────────────────────────────────────────
async function submitPlan() {
  if (!coords && cityInput.value.trim().length < 2) {
    cityInput.classList.add('error-field');
    cityInput.focus();
    geoStatus.textContent = 'Enter a city of at least 2 characters or use your location.';
    return;
  }
  const btn = $('#submit');
  lastBody = readBody();
  btn.setAttribute('disabled', '');
  btn.setAttribute('aria-disabled', 'true');
  result.setAttribute('aria-busy', 'true');
  showSkeleton();
  try {
    render(await post('/api/advice', lastBody));
    askForm.hidden = false;
    answer.replaceChildren();
  } catch (err) {
    const errCard = el('div', 'card');
    errCard.setAttribute('role', 'alert');
    const h = el('h3', 'heading-6'); h.textContent = 'Could not build your plan';
    const p = el('p',  'body-3 muted'); p.textContent = err.message;
    const retryBtn = el('button', 'btn btn-ghost btn-sm');
    retryBtn.type = 'button';
    retryBtn.textContent = 'Try again';
    retryBtn.style.width = 'fit-content';
    retryBtn.addEventListener('click', submitPlan);
    errCard.append(h, p, retryBtn);
    result.replaceChildren(errCard);
  } finally {
    btn.removeAttribute('disabled');
    btn.removeAttribute('aria-disabled');
    result.removeAttribute('aria-busy');
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  submitPlan();
});

// ── Ask form ──────────────────────────────────────────────────
async function submitQuestion(q) {
  if (!q || !lastBody) return;
  const askBtn = $('#ask-submit');
  askBtn?.setAttribute('disabled', '');
  answer.replaceChildren(el('p', 'body-2 muted', txt('Thinking…')));
  try {
    const res = await post('/api/ask', { ...lastBody, question: q });
    const p = el('p', 'body-3'); p.textContent = res.answer;
    const meta = el('p', 'answer-meta');
    meta.textContent =
      res.source === 'gemini'
        ? 'Answered by Gemini grounded in your live AQI & safety rules.'
        : 'Answered by SHAP Explainability Model + Safety Rules.';
    answer.replaceChildren(p, meta);
  } catch (err) {
    const p = el('p', 'body-2'); p.textContent = err.message;
    answer.replaceChildren(p);
  } finally {
    askBtn?.removeAttribute('disabled');
  }
}

askForm.addEventListener('submit', (e) => {
  e.preventDefault();
  submitQuestion($('#question').value.trim());
});

document.querySelectorAll('[data-question]').forEach((chip) => {
  chip.addEventListener('click', () => {
    const q = chip.dataset.question;
    $('#question').value = q;
    submitQuestion(q);
  });
});

// ── Scroll reveal ─────────────────────────────────────────────
const rv = new IntersectionObserver(
  (es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); rv.unobserve(en.target); } }),
  { threshold: 0.05 }
);
document.querySelectorAll('.rv').forEach((n) => rv.observe(n));

// ── Tagline word cascade reveal ───────────────────────────────
const tag = $('#tagline');
const words = tag.textContent.trim().split(/\s+/);
tag.replaceChildren(
  ...words.flatMap((w, i) => [
    Object.assign(el('span', 'w'), { textContent: w }),
    document.createTextNode(i < words.length - 1 ? ' ' : ''),
  ])
);
const wo = new IntersectionObserver(
  (es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('on'); wo.unobserve(en.target); } }),
  { rootMargin: '0px 0px -30% 0px' }
);
tag.querySelectorAll('.w').forEach((n) => wo.observe(n));
