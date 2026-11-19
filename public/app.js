/* ============================================================
   Clear Day — Frontend application
   XP iteration: rich render, SVG chart, impact grid,
   colour-coded AQI, cigarette-equivalent, accessibility
   ============================================================ */
document.documentElement.classList.add('js');

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

// ── Form refs ────────────────────────────────────────────────
const form      = $('#plan-form');
const result    = $('#result');
const askForm   = $('#ask-form');
const answer    = $('#answer');
const cityInput = $('#city');
const geoStatus = $('#geo-status');
let coords   = null;
let lastBody = null;

// ── Profile persistence (localStorage only) ──────────────────
try {
  const saved = JSON.parse(localStorage.getItem(STORE) || '{}');
  for (const [k, v] of Object.entries(saved)) {
    const f = form.elements[k];
    if (!f) continue;
    if (f.type === 'checkbox') f.checked = true;
    else f.value = v;
  }
} catch { /* storage unavailable */ }

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
});

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
  const { air, band, impact, advice, constraints, hourlyChart } = d;
  const win = d.bestWindow
    ? `${hh(d.bestWindow.startHour)} to ${hh(d.bestWindow.endHour)}`
    : 'not available today';

  const nodes = [];

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
    ['PM2.5', `${air.pm25 ?? '—'} µg/m³`],
    ['PM10',  `${air.pm10  ?? '—'} µg/m³`],
    ['NO₂',  `${air.no2   ?? '—'} µg/m³`],
    ['O₃',   `${air.o3    ?? '—'} µg/m³`],
  ];
  metaItems.forEach(([lbl, val]) => {
    const cell = el('div', 'aqi-meta-cell');
    const v = el('div', 'aqi-meta-val'); v.textContent = val;
    const l = el('div', 'aqi-meta-lbl'); l.textContent = lbl;
    cell.append(v, l);
    metaGrid.append(cell);
  });

  aqiCard.append(locationEl, aqiNumEl, bandPill, metaGrid);

  // Best window badge
  if (d.bestWindow) {
    const wb = el('div', 'window-badge');
    wb.innerHTML = `🌿 Cleanest outdoor window: <strong>${win}</strong> (PM2.5 ${d.bestWindow.pm25} µg/m³)`;
    aqiCard.append(wb);
  }

  // PM2.5 chart
  if (hourlyChart && hourlyChart.length) {
    const chartWrap = el('div', 'chart-wrap');
    const svg = buildChart(hourlyChart, d.bestWindow?.startHour ?? null);
    if (svg) {
      const chartLbl = el('p', 'caption-2 muted');
      chartLbl.textContent = '24-hour PM2.5 forecast. Green bars = cleanest window. WHO guideline: 15 µg/m³.';
      chartWrap.append(svg);
      aqiCard.append(chartWrap, chartLbl);
    }
  }

  nodes.push(aqiCard);

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
  const routH = el('h3', 'heading-6'); routH.textContent = 'Your plan for today';
  const sumEl = el('p', 'body-3'); sumEl.textContent = advice.summary;
  const routList = el('ul', 'list');
  routList.setAttribute('aria-label', 'Daily routine steps');
  advice.routine.forEach((r) => {
    const li = el('li');
    const timeTag = el('span', 'list-time'); timeTag.textContent = r.time;
    const act = el('p', 'body-3');  act.textContent = r.action;
    const why = el('p', 'body-2 muted'); why.textContent = r.why;
    li.append(timeTag, act, why);
    routList.append(li);
  });
  routineCard.append(routH, sumEl, routList);
  nodes.push(routineCard);

  // ── 4. Indoor air hacks ────────────────────────────────────
  const hackCard = el('section', 'card');
  hackCard.setAttribute('aria-label', 'Indoor air quality hacks');
  const hackH = el('h3', 'heading-6'); hackH.textContent = 'Indoor air fixes';
  const hackList = el('ul', 'hack-list');
  advice.indoor_hacks.forEach((h, i) => {
    const li   = el('li', 'hack-item');
    const num  = el('div', 'hack-num'); num.textContent = `${i + 1}`;
    num.setAttribute('aria-hidden', 'true');
    const body = el('div', 'hack-body');
    const tip  = el('p', 'body-3');     tip.textContent = h.tip;
    const imp  = el('p', 'body-2 muted'); imp.textContent = h.impact;
    body.append(tip, imp);
    li.append(num, body);
    hackList.append(li);
  });
  hackCard.append(hackH, hackList);
  nodes.push(hackCard);

  // ── 5. Sustainable alternatives ────────────────────────────
  const altCard = el('section', 'card');
  altCard.setAttribute('aria-label', 'Sustainable alternatives');
  const altH = el('h3', 'heading-6'); altH.textContent = 'Sustainable swaps';
  const altList = el('ul', 'hack-list');
  advice.alternatives.forEach((a, i) => {
    const li   = el('li', 'hack-item');
    const num  = el('div', 'hack-num'); num.textContent = ['🌿','⚡','🚶','🌱'][i] || `${i + 1}`;
    num.setAttribute('aria-hidden', 'true');
    const body = el('div', 'hack-body');
    const swap = el('p', 'body-3');       swap.textContent = a.swap;
    const ben  = el('p', 'body-2 muted'); ben.textContent  = a.benefit;
    body.append(swap, ben);
    li.append(num, body);
    altList.append(li);
  });
  altCard.append(altH, altList);
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
    co2Lbl.textContent = `CO₂ saved per day by switching from ${COMMUTE_LABEL[impact.co2.from]} to metro (${impact.co2.savedKgWeek} kg/week)`;
    co2Cell.append(co2Val, co2Lbl);
    impGrid.append(co2Cell);

    // Weekly kg as a visual comparison
    const weekCell = el('div', 'impact-cell');
    const weekVal  = el('div', 'impact-val impact-green');
    weekVal.textContent = `${impact.co2.savedKgWeek} kg`;
    const weekLbl = el('div', 'impact-lbl');
    weekLbl.textContent = 'CO₂ saved per week — roughly equivalent to planting a sapling';
    weekCell.append(weekVal, weekLbl);
    impGrid.append(weekCell);
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

  // ── 7. Source & disclaimer ─────────────────────────────────
  const srcEl = el('p', 'caption-2 muted source-tag');
  const dot   = el('span', `source-dot ${d.source}`); dot.setAttribute('aria-hidden', 'true');
  const srcTxt = el('span');
  srcTxt.textContent = d.source === 'gemini'
    ? 'Plan written by Gemini inside the safety rules.'
    : 'Plan built from safety rules (AI service was unavailable).';
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
form.addEventListener('submit', async (e) => {
  e.preventDefault();
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
    errCard.append(h, p);
    result.replaceChildren(errCard);
  } finally {
    btn.removeAttribute('disabled');
    btn.removeAttribute('aria-disabled');
    result.removeAttribute('aria-busy');
  }
});

// ── Ask form ──────────────────────────────────────────────────
askForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('#question').value.trim();
  if (!q || !lastBody) return;
  answer.replaceChildren(el('p', 'body-2 muted', txt('Thinking…')));
  try {
    const res = await post('/api/ask', { ...lastBody, question: q });
    const p = el('p', 'body-3'); p.textContent = res.answer;
    answer.replaceChildren(p);
  } catch (err) {
    const p = el('p', 'body-2'); p.textContent = err.message;
    answer.replaceChildren(p);
  }
});

// ── Scroll reveal ─────────────────────────────────────────────
const rv = new IntersectionObserver(
  (es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); rv.unobserve(en.target); } }),
  { threshold: 0.12 }
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
