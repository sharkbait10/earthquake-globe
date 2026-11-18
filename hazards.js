// NASA EONET hazard layers: volcanoes, wildfires and severe storms, each toggled on/off.
// Loaded after app.js and reuses its globals (world, $, esc, css, store, reduceMotion, fmtTime, closeDetail, selected).
// Hazards show what's active now; they don't follow the quake time span or the timeline window.

const EONET = 'https://eonet.gsfc.nasa.gov/api/v3/events';
const HAZARD_REFRESH_MS = 15 * 60e3;
const KEY_HAZARDS = 'eqglobe.hazards';

const ICONS = {
  volcanoes: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M1.5 14.5 6.2 6h3.6l4.7 8.5z"/><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" d="M6.6 3.6c.6-1.4 1.6-1.4 2.2 0M8.8 3.4c.5-1 1.3-1.1 1.9-.3"/></svg>',
  wildfires: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8.2 1C8.6 3.8 12 5.1 12 9a4 4 0 0 1-8 0c0-1.9.9-3 1.8-3.9.1 1.4.7 2.3 1.6 2.6C7.2 5.5 7.4 3 8.2 1z"/></svg>',
  severeStorms: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.3" fill="currentColor"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M8.5 2.8C5.2 2.6 3.2 4.6 2.9 7.2M7.5 13.2c3.3.2 5.3-1.8 5.6-4.4"/></svg>',
};

// Volcanoes are dated by when the eruption began (often months ago), so we take every open one.
// Wildfires and storms: only those with activity in the past 30 days (EONET keeps thousands of stale wildfires open).
const LAYERS = {
  volcanoes:    { url: `${EONET}?category=volcanoes&status=open`,          label: 'Volcanoes', one: 'Volcano',  colourVar: '--hz-volcano', blurb: 'Volcanoes erupting now' },
  wildfires:    { url: `${EONET}?category=wildfires&status=open&days=30`,  label: 'Wildfires', one: 'Wildfire', colourVar: '--hz-fire',    blurb: 'Wildfires active in the past 30 days (EONET reports are mostly US incidents)' },
  severeStorms: { url: `${EONET}?category=severeStorms&status=open`,       label: 'Storms',    one: 'Storm',    colourVar: '--hz-storm',   blurb: 'Tropical cyclones and severe storms active now, with their tracks' },
};

const SOURCE_NAMES = {
  SIVolcano: 'Smithsonian Global Volcanism Program', EO: 'NASA Earth Observatory', IRWIN: 'IRWIN incident record',
  JTWC: 'Joint Typhoon Warning Center', NOAA_NHC: 'NOAA National Hurricane Center', GDACS: 'GDACS', ReliefWeb: 'ReliefWeb',
  CEMS: 'Copernicus Emergency Management', InciWeb: 'InciWeb', CALFIRE: 'CAL FIRE', PDC: 'Pacific Disaster Center',
};

const hazardState = {};
for (const k of Object.keys(LAYERS)) hazardState[k] = { on: false, status: 'idle', items: [], loadedAt: 0 };
try { for (const k of JSON.parse(store.get(KEY_HAZARDS) || '[]')) if (hazardState[k]) hazardState[k].on = true; } catch { /* ignore */ }

const saveHazardPrefs = () => store.set(KEY_HAZARDS, JSON.stringify(Object.keys(LAYERS).filter(k => hazardState[k].on)));

// ---------- data ----------
function toHazard(kind, e) {
  const track = e.geometry
    .filter(g => g.type === 'Point')
    .map(g => ({ lng: g.coordinates[0], lat: g.coordinates[1], date: Date.parse(g.date), value: g.magnitudeValue, unit: g.magnitudeUnit }))
    .sort((a, b) => a.date - b.date);
  if (!track.length) return null;
  const last = track[track.length - 1];
  return { kind, id: e.id, title: e.title, description: e.description, sources: e.sources || [], track, lat: last.lat, lng: last.lng, last };
}

async function loadLayer(kind) {
  const st = hazardState[kind];
  st.status = 'loading';
  renderChips();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(LAYERS[kind].url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`EONET returned ${res.status}`);
    const data = await res.json();
    st.items = (data.events || []).map(e => toHazard(kind, e)).filter(Boolean);
    st.status = 'ok';
    st.loadedAt = Date.now();
  } catch (err) {
    console.error(`EONET ${kind} failed to load`, err);
    st.status = 'error';
  } finally {
    clearTimeout(timer);
    renderChips();
    renderHazards();
  }
}

// ---------- globe layers ----------
function hazardMarker(h) {
  const wrap = document.createElement('div');
  wrap.className = 'hz-wrap';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `hz hz-${h.kind}`;
  b.innerHTML = ICONS[h.kind];
  b.setAttribute('aria-label', `${LAYERS[h.kind].one}: ${h.title}`);
  b.title = h.title;
  b.addEventListener('click', e => { e.stopPropagation(); showHazard(h); });
  wrap.appendChild(b);
  return wrap;
}

world
  .htmlLat('lat').htmlLng('lng').htmlAltitude(0.012)
  .htmlElement(hazardMarker)
  .htmlTransitionDuration(0)
  // Hide markers on the far side of the globe instead of drawing them through it.
  .htmlElementVisibilityModifier((el, isVisible) => {
    el.style.opacity = isVisible ? '1' : '0';
    el.style.pointerEvents = isVisible ? '' : 'none';
  })
  .pathPoints('track').pathPointLat('lat').pathPointLng('lng').pathPointAlt(0.008)
  .pathStroke(2.2)
  .pathDashLength(0.06).pathDashGap(0.012)
  .pathDashAnimateTime(reduceMotion ? 0 : 9000)
  .pathTransitionDuration(0)
  .pathLabel(h => `<div class="tip"><b>${esc(h.title)}</b> · track since ${fmtTime(h.track[0].date)}</div>`)
  .onPathClick(h => showHazard(h));

function renderHazards() {
  const shown = Object.keys(LAYERS).filter(k => hazardState[k].on && hazardState[k].status === 'ok').flatMap(k => hazardState[k].items);
  world.htmlElementsData(shown);
  const storm = css('--hz-storm');
  world.pathsData(shown.filter(h => h.kind === 'severeStorms' && h.track.length > 1)).pathColor(() => storm);
  if (typeof render === 'function' && quakes.length) render(); // refresh the legend
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderHazards);

// Legend entries for the layers that are on (app.js appends this to its legend).
function hazardLegend() {
  return Object.keys(LAYERS).filter(k => hazardState[k].on && hazardState[k].status === 'ok')
    .map(k => `<span><span class="hz-mini hz-${k}">${ICONS[k]}</span>${LAYERS[k].label}</span>`).join('');
}

// ---------- detail panel ----------
const fmtDate = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function hazardFacts(h) {
  const rows = [];
  const { last, track } = h;
  if (h.kind === 'volcanoes') {
    rows.push(['Activity since', fmtDate(track[0].date)]);
  } else if (h.kind === 'wildfires') {
    rows.push(['Last report', `${fmtTime(last.date)}<br><span style="color:var(--muted)">${ago(last.date)}</span>`]);
    if (last.value != null && last.unit === 'acres') {
      rows.push(['Area', `${Math.round(last.value).toLocaleString()} acres (${Math.round(last.value * 0.404686).toLocaleString()} ha)`]);
    }
  } else {
    rows.push(['Latest position', `${fmtTime(last.date)}<br><span style="color:var(--muted)">${ago(last.date)}</span>`]);
    if (last.value != null && last.unit === 'kts') {
      rows.push(['Wind', `${Math.round(last.value)} knots (${Math.round(last.value * 1.852)} km/h)`]);
    }
    if (track.length > 1) rows.push(['Tracked', `${track.length} positions since ${fmtTime(track[0].date)}`]);
  }
  rows.push(['Location', `${h.lat.toFixed(2)}°, ${h.lng.toFixed(2)}°`]);
  return rows;
}

function showHazard(h) {
  selected = null; // deselect any quake
  const L = LAYERS[h.kind];
  const links = h.sources.filter(s => /^https?:\/\//.test(s.url))
    .map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(SOURCE_NAMES[s.id] || s.id)}</a></li>`).join('');
  $('detailBody').innerHTML = `
    <p class="hz-kind hz-${h.kind}">${ICONS[h.kind]}<span>${L.one}</span></p>
    <p class="place">${esc(h.title)}</p>
    ${h.description ? `<p class="hz-desc">${esc(h.description)}</p>` : ''}
    <dl>${hazardFacts(h).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    ${links ? `<p class="hz-src-label">More from</p><ul class="hz-sources">${links}</ul>` : ''}
    <p class="hz-credit">Event data: NASA EONET</p>`;
  $('detail').hidden = false;
  setSpin(false);
  world.pointOfView({ lat: h.lat, lng: h.lng, altitude: 1.6 }, reduceMotion ? 0 : 1100);
  if (quakes.length) render();
}

// ---------- toggles ----------
function renderChips() {
  for (const b of document.querySelectorAll('#hazardChips .chip')) {
    const st = hazardState[b.dataset.layer];
    b.setAttribute('aria-pressed', st.on);
    b.classList.toggle('error', st.on && st.status === 'error');
    b.setAttribute('aria-busy', st.on && st.status === 'loading');
    const count = b.querySelector('.count');
    count.textContent = !st.on ? '' : st.status === 'loading' ? '…' : st.status === 'error' ? '!' : st.items.length;
    b.title = st.on && st.status === 'error'
      ? `Couldn’t load ${LAYERS[b.dataset.layer].label.toLowerCase()} from NASA EONET. Click to try again.`
      : LAYERS[b.dataset.layer].blurb;
  }
}

for (const b of document.querySelectorAll('#hazardChips .chip')) {
  b.insertAdjacentHTML('afterbegin', `<span class="hz-mini hz-${b.dataset.layer}">${ICONS[b.dataset.layer]}</span>`);
  b.onclick = () => {
    const st = hazardState[b.dataset.layer];
    if (st.on && st.status === 'error') { loadLayer(b.dataset.layer); return; } // retry
    st.on = !st.on;
    saveHazardPrefs();
    if (st.on && (st.status !== 'ok' || Date.now() - st.loadedAt > HAZARD_REFRESH_MS)) loadLayer(b.dataset.layer);
    renderChips();
    renderHazards();
  };
}

// Refresh layers that are on every 15 minutes while the page is visible.
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  for (const k of Object.keys(LAYERS)) {
    const st = hazardState[k];
    if (st.on && st.status !== 'loading' && Date.now() - st.loadedAt >= HAZARD_REFRESH_MS) loadLayer(k);
  }
}, 60e3);

renderChips();
for (const k of Object.keys(LAYERS)) if (hazardState[k].on) loadLayer(k);
