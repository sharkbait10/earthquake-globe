// Earthquake globe: M2.5+ quakes from the live USGS feeds (past hour / day / week / month).
// Plain script, no build step. Globe rendering by globe.gl; land outlines from world-atlas.

const LAND_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json';
const FEED_BASE = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/';
const MIN = 60e3, HOUR = 36e5, DAY = 864e5;
const FEED_TIMEOUT_MS = 15000;
const RETRY_AFTER_FAILURE_MS = MIN;
const MAX_NEW_RINGS = 100;

// USGS updates the hour/day/week feeds every minute and the month feed every 15 minutes.
const SPANS = {
  hour:  { feed: '2.5_hour',  ms: HOUR,     refreshMs: MIN,      title: 'An hour of earthquakes',      word: 'hour',    every: 'every minute' },
  day:   { feed: '2.5_day',   ms: DAY,      refreshMs: MIN,      title: 'A day of earthquakes',        word: 'day',     every: 'every minute' },
  week:  { feed: '2.5_week',  ms: 7 * DAY,  refreshMs: MIN,      title: 'Seven days of earthquakes',   word: 'week',    every: 'every minute' },
  month: { feed: '2.5_month', ms: 30 * DAY, refreshMs: 15 * MIN, title: 'Thirty days of earthquakes',  word: '30 days', every: 'every 15 minutes' },
};

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// localStorage can be unavailable (private mode, blocked storage); everything still works without it.
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, String(v)); } catch { /* ignore */ } },
};
const KEY_SPAN = 'eqglobe.span', KEY_AUTO = 'eqglobe.autoRefresh', KEY_SEEN = 'eqglobe.lastSeen';

// ---------- colour scales ----------
const magStops = [[2.5, [111, 159, 166]], [4, [217, 180, 74]], [5, [224, 122, 63]], [6, [194, 53, 58]]];
const depthStops = [[0, [230, 140, 60]], [70, [200, 190, 90]], [300, [90, 150, 170]], [700, [80, 90, 170]]];

function scale(stops, v) {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i];
    if (v <= b) {
      const t = (v - a) / (b - a);
      return ca.map((c, j) => Math.round(c + (cb[j] - c) * t));
    }
  }
  return stops[stops.length - 1][1];
}

let colourMode = 'mag';
const rgb = q => colourMode === 'mag' ? scale(magStops, q.mag) : scale(depthStops, q.depth);
const colour = (q, alpha = 1) => `rgba(${rgb(q).join(',')},${alpha})`;

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, c => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// ---------- formatting ----------
const fmtTime = t => new Date(t).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtClock = t => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  const h = s / 3600;
  if (h < 48) return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} ago`;
  return `${Math.round(h / 24)} days ago`;
}

// ---------- state ----------
let span = SPANS[store.get(KEY_SPAN)] ? store.get(KEY_SPAN) : 'week';  // span currently shown
let quakes = [];            // sorted oldest → newest
let tMin = 0, tMax = 0;     // timeline domain
let minMag = 2.5;
let range = null;           // [start, end] ms time-window filter, or null for the whole span
let selected = null;

let autoRefresh = store.get(KEY_AUTO) !== 'false';
let generatedAt = 0;        // when USGS generated the feed we're showing
let nextRefreshAt = Infinity;
let refreshFailed = false;
let loadSeq = 0, inFlight = false;
let pendingSpan = null;     // span the user asked for that failed to load

// "Last visit" = the last time this browser had the page open and visible.
const storedSeen = Number(store.get(KEY_SEEN));
let lastVisit = storedSeen > 0 && storedSeen < Date.now() ? storedSeen : null;
const markSeen = () => store.set(KEY_SEEN, Date.now());
const isNew = q => lastVisit != null && q.time > lastVisit;

const visible = () => quakes.filter(q => q.mag >= minMag && (!range || (q.time >= range[0] && q.time <= range[1])));

// ---------- globe ----------
const el = $('globe');
let hovered = null;

// Points are small; when a click misses, pick the nearest visible quake within a zoom-dependent radius.
function clickAt(c) {
  if (hovered) { select(hovered); return; }
  if (!c) return;
  const toR = Math.PI / 180, alt = world.pointOfView().altitude, limit = 1.2 + alt * 1.4;
  let best = null, bestDeg = Infinity;
  for (const q of visible()) {
    const cos = Math.sin(c.lat * toR) * Math.sin(q.lat * toR) + Math.cos(c.lat * toR) * Math.cos(q.lat * toR) * Math.cos((c.lng - q.lon) * toR);
    const deg = Math.acos(Math.min(1, cos)) / toR;
    if (deg < bestDeg) { bestDeg = deg; best = q; }
  }
  if (best && bestDeg <= limit) select(best);
}

const world = Globe()(el)
  .backgroundColor('rgba(0,0,0,0)')
  .showGraticules(true)
  .polygonAltitude(0.006)
  .polygonSideColor(() => 'rgba(0,0,0,0)')
  .pointLat('lat').pointLng('lon')
  .pointRadius(q => 0.18 + Math.pow(q.mag - 2, 1.6) * 0.09)
  .pointAltitude(q => 0.01 + Math.max(0, q.mag - 2.5) * 0.025)
  .pointResolution(16)
  .pointLabel(q => `<div class="tip">${isNew(q) ? '<span class="new">New</span> · ' : ''}<b>M ${q.mag.toFixed(1)}</b> · ${esc(q.place)}</div>`)
  .onPointClick(q => select(q))
  .onPointHover(q => { hovered = q; el.style.cursor = q ? 'pointer' : ''; })
  .onGlobeClick(c => clickAt(c))
  .onPolygonClick((_, __, c) => clickAt(c))
  .ringLat('lat').ringLng('lon')
  .ringMaxRadius(q => isNew(q) ? Math.max(4, 2 + (q.mag - 5) * 2.5) : 2 + (q.mag - 5) * 2.5)
  .ringPropagationSpeed(1.4)
  .ringRepeatPeriod(1600)
  .atmosphereAltitude(0.14);

world.controls().autoRotateSpeed = 0.45;
world.pointOfView({ lat: 15, lng: 150, altitude: 2.4 });

function applyTheme() {
  world.polygonCapColor(() => css('--land')).polygonStrokeColor(() => css('--land-edge')).atmosphereColor(css('--atmo'));
  const m = world.globeMaterial();
  m.color.set(css('--ocean'));
  if (m.emissive) m.emissive.set(css('--ocean'));
  if ('emissiveIntensity' in m) m.emissiveIntensity = 0.35;
  if (quakes.length) render(); else drawStrip();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

new ResizeObserver(() => { world.width(el.clientWidth).height(el.clientHeight); drawStrip(); }).observe(el);

// ---------- render ----------
function render() {
  const v = visible();
  world.pointsData(v).pointColor(q => q === selected ? css('--ink') : colour(q, 0.92));

  // Pulsing rings: M5+ quakes in their own colour, plus quakes new since the last visit in the accent colour.
  // Cap the new-quake rings so a long absence on the month view doesn't add thousands of animations.
  const newest = v.filter(isNew).slice(-MAX_NEW_RINGS);
  const ringSet = new Set([...v.filter(q => q.mag >= 5), ...newest]);
  const focus = css('--focus');
  world.ringsData(reduceMotion ? [] : [...ringSet])
    .ringColor(q => isNew(q) ? t => hexToRgba(focus, 1 - t) : t => colour(q, 1 - t));

  const s = SPANS[span];
  const big = v.reduce((m, q) => !m || q.mag > m.mag ? q : m, null);
  $('sum').innerHTML = v.length
    ? `<b>${v.length}</b> earthquake${v.length === 1 ? '' : 's'} of magnitude ${minMag.toFixed(1)} or more${range ? ' in the selected window' : ` in the past ${s.word}`}. The largest was <b>M ${big.mag.toFixed(1)}</b>, ${esc(big.place)}.`
    : `No earthquakes match${quakes.length ? '' : ` in the past ${s.word}`}. ${quakes.length ? 'Lower the minimum magnitude or widen the time window.' : 'Try a longer time span.'}`;

  renderNewNote();

  $('legend').innerHTML = (colourMode === 'mag'
    ? [[3, 'M 3'], [4, 'M 4'], [5, 'M 5'], [6, 'M 6+']].map(([m, l]) => {
        const sz = 6 + (m - 2.5) * 3;
        return `<span><i style="width:${sz}px;height:${sz}px;background:${colour({ mag: m })}"></i>${l}</span>`;
      }).join('')
    : [[10, 'Shallow, under 70 km'], [150, 'Intermediate'], [500, 'Deep, over 300 km']].map(([d, l]) =>
        `<span><i style="width:10px;height:10px;background:${colour({ depth: d })}"></i>${l}</span>`).join(''))
    + (lastVisit != null ? `<span><i style="width:10px;height:10px;background:none;border:2px solid ${focus}"></i>New since last visit</span>` : '');

  drawStrip();
}

function renderNewNote() {
  const note = $('newNote');
  if (lastVisit == null) { note.hidden = true; return; }
  const n = quakes.filter(q => q.mag >= minMag && isNew(q)).length;
  note.hidden = false;
  note.innerHTML = n
    ? `<b>${n} new</b> since your last visit (${fmtTime(lastVisit)}). <button type="button" id="showNew">Show only these</button> · <button type="button" id="markSeen">Mark all as seen</button>`
    : `Nothing new since your last visit (${fmtTime(lastVisit)}).`;
  if (n) {
    $('showNew').onclick = () => { range = [Math.max(tMin, lastVisit), tMax]; updateRangeLabel(); render(); };
    $('markSeen').onclick = () => { lastVisit = Date.now(); markSeen(); render(); if (selected) select(selected, { fly: false }); };
  }
}

// ---------- detail panel ----------
function select(q, { fly = true } = {}) {
  selected = q;
  $('detailBody').innerHTML = `
    <p class="mag">${q.mag.toFixed(1)}<small>magnitude</small></p>
    <p class="place">${esc(q.place)}</p>
    ${isNew(q) ? '<span class="newbadge">New since your last visit</span>' : ''}
    ${q.tsunami ? '<span class="tsunami">Tsunami alert issued</span>' : ''}
    <dl>
      <dt>When</dt><dd>${fmtTime(q.time)}<br><span style="color:var(--muted)">${ago(q.time)}</span></dd>
      <dt>Depth</dt><dd>${q.depth.toFixed(1)} km</dd>
      <dt>Location</dt><dd>${q.lat.toFixed(2)}°, ${q.lon.toFixed(2)}°</dd>
    </dl>
    <a href="${esc(q.url)}" target="_blank" rel="noopener">Read the USGS event page</a>`;
  $('detail').hidden = false;
  if (fly) {
    setSpin(false);
    world.pointOfView({ lat: q.lat, lng: q.lon, altitude: 1.6 }, reduceMotion ? 0 : 1100);
  }
  render();
}
function closeDetail() { selected = null; $('detail').hidden = true; render(); }
$('close').onclick = closeDetail;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });

// ---------- controls ----------
const slider = $('minMag');
slider.oninput = () => { minMag = +slider.value; $('minMagVal').textContent = minMag.toFixed(1); render(); };

function setMode(m) {
  colourMode = m;
  $('byMag').setAttribute('aria-pressed', m === 'mag');
  $('byDepth').setAttribute('aria-pressed', m === 'depth');
  render();
}
$('byMag').onclick = () => setMode('mag');
$('byDepth').onclick = () => setMode('depth');

function setSpin(on) {
  world.controls().autoRotate = on;
  $('spin').setAttribute('aria-pressed', on);
  $('spin').textContent = on ? 'Pause rotation' : 'Resume rotation';
}
setSpin(!reduceMotion);
$('spin').onclick = () => setSpin(!world.controls().autoRotate);

// Time span switch
const spanButtons = [...document.querySelectorAll('#spanSeg button')];
function showSpanButtons(active, busy = null) {
  for (const b of spanButtons) {
    b.setAttribute('aria-pressed', b.dataset.span === active);
    if (b.dataset.span === busy) b.setAttribute('aria-busy', 'true'); else b.removeAttribute('aria-busy');
  }
}
for (const b of spanButtons) {
  b.onclick = () => {
    if (b.dataset.span === span && quakes.length && !inFlight) return;
    loadFeed(b.dataset.span);
  };
}

// Auto-refresh toggle
$('autoRefresh').checked = autoRefresh;
$('autoRefresh').onchange = () => {
  autoRefresh = $('autoRefresh').checked;
  store.set(KEY_AUTO, autoRefresh);
  updateFreshness();
  tick();
};

// ---------- timeline strip ----------
// Drag on empty space to draw a window; drag inside a window to slide it; drag near its edge to resize it;
// a plain click jumps to the biggest quake under the pointer.
const svg = $('strip');
const EDGE_PX = 7;
let drag = null;

const xOf = (t, w) => (t - tMin) / (tMax - tMin) * w;
const tOf = (x, w) => tMin + Math.max(0, Math.min(1, x / w)) * (tMax - tMin);
const px = e => e.clientX - svg.getBoundingClientRect().left;
const currentSel = () => drag ? drag.sel : range;

// Tick marks aligned to local clock boundaries, sized to the span.
function ticks() {
  const out = [];
  const d = new Date(tMin);
  if (span === 'hour') {
    const step = 10 * MIN;
    for (let t = Math.ceil(tMin / step) * step; t <= tMax; t += step) out.push([t, fmtClock(t)]);
  } else if (span === 'day') {
    d.setMinutes(0, 0, 0);
    while (d.getTime() < tMin || d.getHours() % 3) d.setHours(d.getHours() + 1);
    for (; d.getTime() <= tMax; d.setHours(d.getHours() + 3)) {
      const t = d.getTime();
      out.push([t, d.getHours() === 0 ? d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) : fmtClock(t)]);
    }
  } else {
    d.setHours(0, 0, 0, 0);
    if (d.getTime() < tMin) d.setDate(d.getDate() + 1);
    for (; d.getTime() <= tMax; d.setDate(d.getDate() + 1)) {
      if (span === 'month' && d.getDay() !== 1) continue; // Mondays only
      const opts = span === 'month' ? { day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric' };
      out.push([d.getTime(), d.toLocaleDateString(undefined, opts)]);
    }
  }
  return out;
}

function drawStrip() {
  const w = svg.clientWidth, h = 74, base = 58;
  if (!w || !tMax) { svg.innerHTML = ''; return; }
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const sel = currentSel();
  const focus = css('--focus');
  let s = '';
  if (sel) {
    const x0 = xOf(sel[0], w), x1 = xOf(sel[1], w);
    s += `<rect x="${x0}" y="0" width="${Math.max(1, x1 - x0)}" height="${base}" fill="${focus}" opacity=".12"/>`;
    s += `<line x1="${x0}" x2="${x0}" y1="0" y2="${base}" stroke="${focus}" stroke-width="2"/>`;
    s += `<line x1="${x1}" x2="${x1}" y1="0" y2="${base}" stroke="${focus}" stroke-width="2"/>`;
  }
  for (const [t, label] of ticks()) {
    const x = xOf(t, w);
    s += `<line x1="${x}" x2="${x}" y1="0" y2="${base}" stroke="${css('--rule')}"/>`;
    if (x < w - 36) s += `<text x="${x + 4}" y="${h - 3}">${esc(label)}</text>`;
  }
  s += `<line x1="0" x2="${w}" y1="${base}" y2="${base}" stroke="${css('--muted')}" opacity=".5"/>`;

  // "Last visit" marker
  if (lastVisit != null && lastVisit > tMin && lastVisit < tMax) {
    const x = xOf(lastVisit, w);
    s += `<line x1="${x}" x2="${x}" y1="0" y2="${base}" stroke="${focus}" stroke-dasharray="3 3" stroke-width="1.5"/>`;
    s += `<text x="${x > w - 90 ? x - 4 : x + 4}" y="10" text-anchor="${x > w - 90 ? 'end' : 'start'}" style="fill:${focus}">last visit</text>`;
  }

  const thin = span === 'month';
  for (const q of quakes) {
    if (q.mag < minMag) continue;
    const x = xOf(q.time, w), hh = 4 + (q.mag - 2.5) * 12;
    const inRange = !sel || (q.time >= sel[0] && q.time <= sel[1]);
    const stroke = q === selected ? css('--ink') : colour(q, inRange ? 0.95 : 0.22);
    const sw = q.mag >= 5 ? (thin ? 1.8 : 2.4) : (thin ? 1 : 1.4);
    s += `<line x1="${x}" x2="${x}" y1="${base}" y2="${base - hh}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>`;
    if (isNew(q) && inRange) s += `<circle cx="${x}" cy="${base - hh - 4}" r="2" fill="${focus}"/>`;
  }
  svg.innerHTML = s;
}

function hitTest(x, w) {
  if (!range) return 'new';
  const x0 = xOf(range[0], w), x1 = xOf(range[1], w);
  if (Math.abs(x - x0) <= EDGE_PX) return 'left';
  if (Math.abs(x - x1) <= EDGE_PX) return 'right';
  if (x > x0 && x < x1) return 'move';
  return 'new';
}

svg.addEventListener('pointermove', e => {
  const w = svg.clientWidth, x = px(e);
  if (!drag) {
    const hit = hitTest(x, w);
    svg.style.cursor = hit === 'left' || hit === 'right' ? 'ew-resize' : hit === 'move' ? 'grab' : 'crosshair';
    return;
  }
  const t = tOf(x, w);
  if (drag.mode === 'new') drag.sel = [Math.min(drag.t0, t), Math.max(drag.t0, t)];
  else if (drag.mode === 'left') drag.sel = [Math.min(t, drag.orig[1]), drag.orig[1]];
  else if (drag.mode === 'right') drag.sel = [drag.orig[0], Math.max(t, drag.orig[0])];
  else {
    const width = drag.orig[1] - drag.orig[0];
    let start = drag.orig[0] + (t - drag.t0);
    start = Math.max(tMin, Math.min(tMax - width, start));
    drag.sel = [start, start + width];
  }
  drawStrip();
});

svg.addEventListener('pointerdown', e => {
  if (!tMax) return;
  svg.setPointerCapture(e.pointerId);
  const w = svg.clientWidth, x = px(e), t = tOf(x, w);
  const mode = hitTest(x, w);
  drag = { mode, t0: t, x0: x, orig: range, sel: mode === 'new' ? [t, t] : range };
  if (mode === 'move') svg.style.cursor = 'grabbing';
  drawStrip();
});

svg.addEventListener('pointerup', e => {
  if (!drag) return;
  const d = drag; drag = null;
  if (Math.abs(px(e) - d.x0) < 4) {
    // A click, not a drag: select the largest quake near that moment.
    const win = (tMax - tMin) / svg.clientWidth * 6;
    const near = quakes.filter(q => q.mag >= minMag && Math.abs(q.time - d.t0) <= win)
      .reduce((m, q) => !m || q.mag > m.mag ? q : m, null);
    if (near) select(near); else drawStrip();
    return;
  }
  range = d.sel;
  updateRangeLabel();
  render();
});

function updateRangeLabel() {
  if (range) {
    $('rangeLabel').textContent = `Showing ${fmtTime(range[0])} to ${fmtTime(range[1])}`;
    $('clearRange').hidden = false;
  } else {
    $('rangeLabel').textContent = 'Drag across the timeline to focus on a time window';
    $('clearRange').hidden = true;
  }
}
$('clearRange').onclick = () => { range = null; updateRangeLabel(); render(); };

// ---------- freshness & auto-refresh ----------
function updateFreshness() {
  const s = SPANS[span];
  $('autoEvery').textContent = s.every;
  const f = $('fresh');
  if (!generatedAt) { f.textContent = ''; return; }
  const failing = refreshFailed && autoRefresh;
  f.textContent = !autoRefresh
    ? `Updated ${ago(generatedAt)} · auto-refresh is off`
    : failing
      ? `Updated ${ago(generatedAt)} · couldn’t refresh just now, trying again shortly`
      : `Updated ${ago(generatedAt)}`;
  f.classList.toggle('stale', failing);
}

// Runs every 15 s: keeps "updated x min ago" current and refreshes when due.
// Hidden tabs don't refresh; they catch up as soon as they're visible again.
function tick() {
  updateFreshness();
  if (autoRefresh && document.visibilityState === 'visible' && !inFlight && quakes.length && Date.now() >= nextRefreshAt) {
    loadFeed(span, { quiet: true });
  }
}
setInterval(tick, 15000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') markSeen(); else tick();
});
window.addEventListener('pagehide', markSeen);

// ---------- load data ----------
// Land outlines are decoration: if they fail, still show the quakes.
function loadLand() {
  fetch(LAND_URL).then(r => r.json())
    .then(topo => { world.polygonsData(topojson.feature(topo, topo.objects.land).features); applyTheme(); })
    .catch(err => console.warn('Land outlines failed to load', err));
}

function feedErrorMessage(err) {
  if (!navigator.onLine) return 'It looks like you’re offline. Check your internet connection, then try again.';
  if (err.name === 'AbortError') return 'The USGS server is taking too long to respond. It may be busy; try again in a moment.';
  if (err.status) return `The USGS server answered with an error (${err.status}). It’s usually temporary; try again in a minute or two.`;
  return 'The USGS earthquake service didn’t respond. It may be briefly down, or something on your network is blocking it. Try again in a moment.';
}

function showFeedError(err, key) {
  pendingSpan = key;
  const hasData = quakes.length > 0;
  $('noticeTitle').textContent = hasData ? `We couldn’t load the past ${SPANS[key].word}` : 'We couldn’t reach the earthquake feed';
  $('noticeBody').textContent = feedErrorMessage(err) + (hasData ? ` You’re still looking at the past ${SPANS[span].word}.` : '');
  $('dismissNotice').hidden = !hasData;
  $('notice').hidden = false;
  $('retry').disabled = false;
  $('retry').textContent = 'Try again';
  if (!hasData) $('sum').textContent = 'No earthquake data loaded yet.';
  showSpanButtons(hasData ? span : key);
  $('retry').focus();
}

$('retry').onclick = () => {
  $('retry').disabled = true;
  $('retry').textContent = 'Trying…';
  loadFeed(pendingSpan || span);
};
$('dismissNotice').onclick = () => { $('notice').hidden = true; pendingSpan = null; };
window.addEventListener('online', () => { if (!$('notice').hidden) $('retry').click(); });

async function loadFeed(key = span, { quiet = false } = {}) {
  const seq = ++loadSeq;
  inFlight = true;
  if (!quiet) {
    showSpanButtons(key, key);
    if (!quakes.length) $('sum').textContent = `Loading the past ${SPANS[key].word} of earthquakes from USGS…`;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(`${FEED_BASE}${SPANS[key].feed}.geojson`, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw Object.assign(new Error(`USGS feed returned ${res.status}`), { status: res.status });
    const geo = await res.json();
    if (!Array.isArray(geo.features)) throw new Error('Unexpected feed format');
    if (seq !== loadSeq) return; // a newer request superseded this one

    const switching = key !== span || !quakes.length;
    quakes = geo.features
      .filter(f => f.properties.mag != null && f.geometry)
      .map(f => {
        const [lon, lat, depth] = f.geometry.coordinates;
        const p = f.properties;
        // Round to one decimal as USGS displays it; the "2.5+" feeds include raw values like 2.46.
        return { id: f.id, lat, lon, depth: depth ?? 0, mag: Math.round(p.mag * 10) / 10, place: p.place || p.title || 'Unknown location', time: p.time, url: p.url, tsunami: p.tsunami };
      })
      .sort((a, b) => a.time - b.time);

    span = key;
    store.set(KEY_SPAN, key);
    generatedAt = geo.metadata?.generated || Date.now();
    tMax = generatedAt;
    tMin = tMax - SPANS[key].ms;

    if (switching) {
      range = null;
    } else if (range) {
      // Keep the user's window on refresh, clamped to the new domain.
      range = [Math.max(tMin, range[0]), Math.min(tMax, range[1])];
      if (range[1] <= range[0]) range = null;
    }
    updateRangeLabel();

    // Keep the open quake if it's still in the data; otherwise close the panel.
    if (selected) {
      const again = quakes.find(q => q.id === selected.id);
      if (again) select(again, { fly: false }); else closeDetail();
    }

    $('title').textContent = SPANS[key].title;
    document.title = `${SPANS[key].title} · Earthquake Globe`;
    $('notice').hidden = true;
    pendingSpan = null;
    refreshFailed = false;
    nextRefreshAt = Date.now() + SPANS[key].refreshMs;
    showSpanButtons(key);
    render();
    updateFreshness();
    if (document.visibilityState === 'visible') markSeen();
  } catch (err) {
    if (seq !== loadSeq) return;
    console.error('USGS feed failed to load', err);
    if (quiet) {
      refreshFailed = true;
      nextRefreshAt = Date.now() + RETRY_AFTER_FAILURE_MS;
      updateFreshness();
    } else {
      showFeedError(err, key);
    }
  } finally {
    clearTimeout(timer);
    if (seq === loadSeq) inFlight = false;
  }
}

showSpanButtons(span);
$('title').textContent = SPANS[span].title;
applyTheme();
loadLand();
loadFeed(span);
