// Earthquake globe: past 7 days of M2.5+ quakes from the USGS live feed.
// Plain script, no build step. Globe rendering by globe.gl; land outlines from world-atlas.

const FEED_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson';
const LAND_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json';
const DAY = 864e5;

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

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

// ---------- formatting ----------
const fmtTime = t => new Date(t).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function ago(t) {
  const h = (Date.now() - t) / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} minutes ago`;
  if (h < 48) return `${Math.round(h)} hours ago`;
  return `${Math.round(h / 24)} days ago`;
}

// ---------- state ----------
let quakes = [];            // sorted oldest → newest
let tMin = 0, tMax = 0;     // timeline domain (the feed's 7-day window)
let minMag = 2.5;
let range = null;           // [start, end] ms, or null for the whole week
let selected = null;

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
  .pointLabel(q => `<div class="tip"><b>M ${q.mag.toFixed(1)}</b> · ${esc(q.place)}</div>`)
  .onPointClick(q => select(q))
  .onPointHover(q => { hovered = q; el.style.cursor = q ? 'pointer' : ''; })
  .onGlobeClick(c => clickAt(c))
  .onPolygonClick((_, __, c) => clickAt(c))
  .ringLat('lat').ringLng('lon')
  .ringMaxRadius(q => 2 + (q.mag - 5) * 2.5)
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
  drawStrip();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

new ResizeObserver(() => { world.width(el.clientWidth).height(el.clientHeight); drawStrip(); }).observe(el);

// ---------- render ----------
function render() {
  const v = visible();
  world.pointsData(v).pointColor(q => q === selected ? css('--ink') : colour(q, 0.92));
  world.ringsData(reduceMotion ? [] : v.filter(q => q.mag >= 5)).ringColor(q => t => colour(q, 1 - t));

  const big = v.reduce((m, q) => !m || q.mag > m.mag ? q : m, null);
  $('sum').innerHTML = v.length
    ? `<b>${v.length}</b> earthquakes of magnitude ${minMag.toFixed(1)} or more${range ? ' in the selected window' : ' in the past week'}. The largest was <b>M ${big.mag.toFixed(1)}</b>, ${esc(big.place)}.`
    : 'No earthquakes match. Lower the minimum magnitude or widen the time window.';

  $('legend').innerHTML = colourMode === 'mag'
    ? [[3, 'M 3'], [4, 'M 4'], [5, 'M 5'], [6, 'M 6+']].map(([m, l]) => {
        const s = 6 + (m - 2.5) * 3;
        return `<span><i style="width:${s}px;height:${s}px;background:${colour({ mag: m })}"></i>${l}</span>`;
      }).join('')
    : [[10, 'Shallow, under 70 km'], [150, 'Intermediate'], [500, 'Deep, over 300 km']].map(([d, l]) =>
        `<span><i style="width:10px;height:10px;background:${colour({ depth: d })}"></i>${l}</span>`).join('');

  drawStrip();
}

// ---------- detail panel ----------
function select(q) {
  selected = q;
  $('detailBody').innerHTML = `
    <p class="mag">${q.mag.toFixed(1)}<small>magnitude</small></p>
    <p class="place">${esc(q.place)}</p>
    ${q.tsunami ? '<span class="tsunami">Tsunami alert issued</span>' : ''}
    <dl>
      <dt>When</dt><dd>${fmtTime(q.time)}<br><span style="color:var(--muted)">${ago(q.time)}</span></dd>
      <dt>Depth</dt><dd>${q.depth.toFixed(1)} km</dd>
      <dt>Location</dt><dd>${q.lat.toFixed(2)}°, ${q.lon.toFixed(2)}°</dd>
    </dl>
    <a href="${esc(q.url)}" target="_blank" rel="noopener">Read the USGS event page</a>`;
  $('detail').hidden = false;
  setSpin(false);
  world.pointOfView({ lat: q.lat, lng: q.lon, altitude: 1.6 }, reduceMotion ? 0 : 1100);
  render();
}
$('close').onclick = () => { selected = null; $('detail').hidden = true; render(); };
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('close').click(); });

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

function drawStrip() {
  const w = svg.clientWidth, h = 74, base = 58;
  if (!w || !tMax) return;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const sel = currentSel();
  let s = '';
  if (sel) {
    const x0 = xOf(sel[0], w), x1 = xOf(sel[1], w);
    s += `<rect x="${x0}" y="0" width="${Math.max(1, x1 - x0)}" height="${base}" fill="${css('--focus')}" opacity=".12"/>`;
    s += `<line x1="${x0}" x2="${x0}" y1="0" y2="${base}" stroke="${css('--focus')}" stroke-width="2"/>`;
    s += `<line x1="${x1}" x2="${x1}" y1="0" y2="${base}" stroke="${css('--focus')}" stroke-width="2"/>`;
  }
  for (let d = 0; d <= 7; d++) {
    const t = tMin + d * DAY, x = xOf(t, w);
    s += `<line x1="${x}" x2="${x}" y1="0" y2="${base}" stroke="${css('--rule')}"/>`;
    if (d < 7) s += `<text x="${x + 4}" y="${h - 3}">${new Date(t + DAY / 2).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</text>`;
  }
  s += `<line x1="0" x2="${w}" y1="${base}" y2="${base}" stroke="${css('--muted')}" opacity=".5"/>`;
  for (const q of quakes) {
    if (q.mag < minMag) continue;
    const x = xOf(q.time, w), hh = 4 + (q.mag - 2.5) * 12;
    const inRange = !sel || (q.time >= sel[0] && q.time <= sel[1]);
    const stroke = q === selected ? css('--ink') : colour(q, inRange ? 0.95 : 0.22);
    s += `<line x1="${x}" x2="${x}" y1="${base}" y2="${base - hh}" stroke="${stroke}" stroke-width="${q.mag >= 5 ? 2.4 : 1.4}" stroke-linecap="round"/>`;
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
    const span = drag.orig[1] - drag.orig[0];
    let start = drag.orig[0] + (t - drag.t0);
    start = Math.max(tMin, Math.min(tMax - span, start));
    drag.sel = [start, start + span];
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
    $('rangeLabel').textContent = 'Drag across the week to focus on a time window';
    $('clearRange').hidden = true;
  }
}
$('clearRange').onclick = () => { range = null; updateRangeLabel(); render(); };

// ---------- load data ----------
async function load() {
  $('sum').textContent = 'Loading the latest earthquakes from USGS…';
  applyTheme();

  // Land outlines are decoration: if they fail, still show the quakes.
  fetch(LAND_URL).then(r => r.json())
    .then(topo => { world.polygonsData(topojson.feature(topo, topo.objects.land).features); applyTheme(); })
    .catch(err => console.warn('Land outlines failed to load', err));

  try {
    const res = await fetch(FEED_URL);
    if (!res.ok) throw new Error(`USGS feed returned ${res.status}`);
    const geo = await res.json();
    quakes = geo.features
      .filter(f => f.properties.mag != null && f.geometry)
      .map(f => {
        const [lon, lat, depth] = f.geometry.coordinates;
        const p = f.properties;
        return { id: f.id, lat, lon, depth: depth ?? 0, mag: p.mag, place: p.place || p.title || 'Unknown location', time: p.time, url: p.url, tsunami: p.tsunami };
      })
      .sort((a, b) => a.time - b.time);

    tMax = geo.metadata.generated;
    tMin = tMax - 7 * DAY;
    $('src').innerHTML = `Data: <a href="https://earthquake.usgs.gov/earthquakes/feed/" target="_blank" rel="noopener">USGS earthquake feed</a>, magnitude 2.5 and above, updated ${new Date(tMax).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}. Land outlines from Natural Earth.`;
    render();
  } catch (err) {
    console.error(err);
    $('sum').textContent = 'Could not load the USGS earthquake feed. Check your connection and reload the page.';
  }
}

load();
