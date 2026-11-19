// Context layer: tectonic plate boundaries, so you can see quakes tracing the plate edges.
// Data: Peter Bird (2003), "An updated digital model of plate boundaries", G-Cubed 4(3), 1027,
// as converted to GeoJSON by Hugo Ahlenius / Nordpil (github.com/fraxen/tectonicplates). Licence: ODC-BY 1.0.
// Loaded after app.js and reuses its globals (world, $, esc, store, quakes, render, setPaths, pathStyles).

const PLATES_URL = 'https://cdn.jsdelivr.net/gh/fraxen/tectonicplates@339b0c56563c118307b1f4542703047f5f698fae/GeoJSON/PB2002_boundaries.json';
const KEY_PLATES = 'eqglobe.plates';
// Boundaries are drawn as lines, but the zones they mark are wide: at subduction zones, quakes occur up to a few
// hundred km from the trench line as the diving plate descends. 250 km captures that without stretching far into plate interiors.
const NEAR_KM = 250;

// Plate codes used in PB2002, with the dataset's own plate names (saves loading the 330 KB plates file).
const PLATE_NAMES = { AF: 'Africa', AN: 'Antarctica', SO: 'Somalia', IN: 'India', AU: 'Australia', EU: 'Eurasia', NA: 'North America', SA: 'South America', NZ: 'Nazca', PA: 'Pacific', AR: 'Arabia', SU: 'Sunda', TI: 'Timor', KE: 'Kermadec', TO: 'Tonga', NI: 'Niuafo’ou', WL: 'Woodlark', MO: 'Maoke', SB: 'South Bismarck', SS: 'Solomon Sea', NB: 'North Bismarck', NH: 'New Hebrides', CA: 'Caribbean', CO: 'Cocos', OK: 'Okhotsk', JF: 'Juan de Fuca', AP: 'Altiplano', ND: 'North Andes', ON: 'Okinawa', PS: 'Philippine Sea', AM: 'Amur', CL: 'Caroline', MA: 'Mariana', FT: 'Futuna', SC: 'Scotia', SL: 'Shetland', AS: 'Aegean Sea', AT: 'Anatolia', YA: 'Yangtze', BU: 'Burma', RI: 'Rivera', BH: 'Bird’s Head', MS: 'Molucca Sea', BS: 'Banda Sea', MN: 'Manus', CR: 'Conway Reef', BR: 'Balmoral Reef', EA: 'Easter', JZ: 'Juan Fernandez', GP: 'Galápagos', SW: 'Sandwich', PM: 'Panama' };
const plateName = c => PLATE_NAMES[c] || c;

const plates = { on: store.get(KEY_PLATES) !== 'off', status: 'idle', lines: [], segments: [] };

pathStyles.plate = {
  color: d => css(d.subduction ? '--plate-sub' : '--plate'),
  stroke: null, // thin GL lines: cheap for 241 boundaries
  label: d => `<div class="tip"><b>${esc(plateName(d.a))} – ${esc(plateName(d.b))}</b> plate boundary${d.subduction ? ' · subduction zone' : ''}</div>`,
};
// Subduction zones get a slightly heavier line so they stand out.
pathStyles.plateSub = { ...pathStyles.plate, stroke: 1.4 };

// ---------- data ----------
async function loadPlates() {
  plates.status = 'loading';
  renderPlateChip();
  try {
    const res = await fetch(PLATES_URL);
    if (!res.ok) throw new Error(`Plate data returned ${res.status}`);
    const geo = await res.json();
    plates.lines = geo.features
      .filter(f => f.geometry?.type === 'LineString')
      .map(f => {
        const p = f.properties, subduction = p.Type === 'subduction';
        return { kind: subduction ? 'plateSub' : 'plate', subduction, a: p.PlateA, b: p.PlateB,
                 track: f.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })) };
      });
    // Flat segment list for distance checks: [lat1, lng1, lat2, lng2]
    plates.segments = plates.lines.flatMap(l => l.track.slice(1).map((p, i) => [l.track[i].lat, l.track[i].lng, p.lat, p.lng]));
    plates.status = 'ok';
  } catch (err) {
    console.error('Plate boundaries failed to load', err);
    plates.status = 'error';
  }
  renderPlates();
}

// Distance in km from a quake to the nearest boundary segment. A local flat projection around the quake
// is accurate to a few percent at these distances, which is plenty for a "within 100 km" count.
function kmToBoundary(q) {
  if (q._plateKm !== undefined) return q._plateKm;
  const kmPerDeg = 111.32, cosLat = Math.cos(q.lat * Math.PI / 180);
  const bandDeg = 3; // ignore segments whose latitude range is far away
  let best = Infinity;
  for (const [la1, lo1, la2, lo2] of plates.segments) {
    if (Math.min(la1, la2) - bandDeg > q.lat || Math.max(la1, la2) + bandDeg < q.lat) continue;
    const wrap = d => ((d + 540) % 360) - 180;
    const ax = wrap(lo1 - q.lon) * cosLat * kmPerDeg, ay = (la1 - q.lat) * kmPerDeg;
    const bx = wrap(lo2 - q.lon) * cosLat * kmPerDeg, by = (la2 - q.lat) * kmPerDeg;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) best = d;
  }
  q._plateKm = best;
  return best;
}

// ---------- hooks used by app.js render() ----------
function plateSummary(v) {
  if (!plates.on || plates.status !== 'ok' || !v.length) return '';
  const near = v.filter(q => kmToBoundary(q) <= NEAR_KM).length;
  const pct = Math.round(near / v.length * 100);
  const why = 'Plate boundaries are drawn as lines, but the zones they mark are wide: at subduction zones, quakes happen up to a few hundred km from the trench line. Small quakes in this feed also over-represent the US, where monitoring is densest.';
  return ` <span class="plate-stat" title="${why}"><b>${pct}%</b> of ${v.length === 1 ? 'it lies' : 'them lie'} within ${NEAR_KM} km of a plate boundary.</span>`;
}

function plateLegend() {
  if (!plates.on || plates.status !== 'ok') return '';
  return `<span><i class="line-swatch sub"></i>Subduction zone</span><span><i class="line-swatch"></i>Other plate boundary</span>`;
}

// ---------- rendering & toggle ----------
function renderPlates() {
  setPaths('plates', plates.on && plates.status === 'ok' ? plates.lines : []);
  renderPlateChip();
  if (quakes.length) render();
}

function renderPlateChip() {
  const b = $('platesChip');
  b.setAttribute('aria-pressed', plates.on);
  b.setAttribute('aria-busy', plates.on && plates.status === 'loading');
  b.classList.toggle('error', plates.on && plates.status === 'error');
  b.querySelector('.count').textContent = plates.on && plates.status === 'loading' ? '…' : plates.on && plates.status === 'error' ? '!' : '';
  b.title = plates.on && plates.status === 'error'
    ? 'Couldn’t load the plate boundaries. Click to try again.'
    : 'Tectonic plate boundaries (Bird 2003). Most earthquakes happen along them.';
}

$('platesChip').onclick = () => {
  if (plates.on && plates.status === 'error') { loadPlates(); return; } // retry
  plates.on = !plates.on;
  store.set(KEY_PLATES, plates.on ? 'on' : 'off');
  if (plates.on && plates.status !== 'ok') loadPlates(); else renderPlates();
};

renderPlateChip();
if (plates.on) loadPlates();
