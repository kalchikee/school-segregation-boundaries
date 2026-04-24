'use strict';

const CHICAGO = [-87.65, 41.88];
const BSI_CRITICAL = 75;
const BSI_HIGH = 50;
const BSI_MODERATE = 25;

let map, zoneData, boundaryData, schoolsById;
let selectedBoundaryKey = null;
let hoverPopup = null;

function bsiColor(score) {
  if (score >= BSI_CRITICAL) return '#e84141';
  if (score >= BSI_HIGH) return '#ff7b00';
  if (score >= BSI_MODERATE) return '#ffd700';
  return '#44cc44';
}

function boundaryKey(p) {
  const a = Math.min(p.school_a_id, p.school_b_id);
  const b = Math.max(p.school_a_id, p.school_b_id);
  return `${a}-${b}`;
}

function showError(msg) {
  const el = document.getElementById('error-banner');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      base: {
        type: 'raster',
        tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],
        tileSize: 256,
        attribution: '© CARTO © OSM'
      }
    },
    layers: [{ id: 'base', type: 'raster', source: 'base' }]
  },
  center: CHICAGO,
  zoom: 11
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

map.on('load', () => {
  Promise.all([
    fetch('data/attendance_zones.geojson').then(r => { if (!r.ok) throw new Error('zones'); return r.json(); }),
    fetch('data/boundary_lines_bsi.geojson').then(r => { if (!r.ok) throw new Error('boundaries'); return r.json(); }),
    fetch('data/schools_demographics.json').then(r => { if (!r.ok) throw new Error('schools'); return r.json(); }),
    fetch('data/schools_points.geojson').then(r => { if (!r.ok) throw new Error('points'); return r.json(); })
  ]).then(([zones, boundaries, schools, points]) => {
    zoneData = zones;
    boundaryData = boundaries;
    schoolsById = schools;

    boundaries.features.forEach(f => { f.properties._key = boundaryKey(f.properties); });

    renderStats(zones, boundaries);

    map.addSource('zones', { type: 'geojson', data: zones });
    map.addSource('boundaries', { type: 'geojson', data: boundaries });
    map.addSource('schools', { type: 'geojson', data: points });
    map.addSource('selected', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    map.addLayer({
      id: 'zone-fill',
      type: 'fill',
      source: 'zones',
      paint: {
        'fill-color': ['interpolate', ['linear'], ['get', 'pct_minority'], 0, '#44cc44', 40, '#ffd700', 70, '#ff7b00', 100, '#e84141'],
        'fill-opacity': 0.55
      }
    });
    map.addLayer({
      id: 'zone-outline',
      type: 'line',
      source: 'zones',
      paint: { 'line-color': '#252933', 'line-width': 0.8 }
    });
    map.addLayer({
      id: 'boundary-bg',
      type: 'line',
      source: 'boundaries',
      paint: {
        'line-color': ['interpolate', ['linear'], ['get', 'bsi_score'], 0, '#44cc44', 25, '#ffd700', 50, '#ff7b00', 75, '#e84141'],
        'line-width': 12,
        'line-opacity': 0.15
      }
    });
    map.addLayer({
      id: 'boundary-casing',
      type: 'line',
      source: 'boundaries',
      paint: {
        'line-color': '#0d0f14',
        'line-width': ['interpolate', ['linear'], ['get', 'bsi_score'], 0, 2.5, 60, 6.5],
        'line-opacity': 0.8
      }
    });
    map.addLayer({
      id: 'boundary-lines',
      type: 'line',
      source: 'boundaries',
      paint: {
        'line-color': ['interpolate', ['linear'], ['get', 'bsi_score'], 0, '#44cc44', 25, '#ffd700', 50, '#ff7b00', 75, '#e84141'],
        'line-width': ['interpolate', ['linear'], ['get', 'bsi_score'], 0, 1, 60, 4.5]
      }
    });
    map.addLayer({
      id: 'boundary-selected',
      type: 'line',
      source: 'selected',
      paint: {
        'line-color': '#ffffff',
        'line-width': 3,
        'line-dasharray': [2, 1.5]
      }
    });
    map.addLayer({
      id: 'school-dot-halo',
      type: 'circle',
      source: 'schools',
      paint: {
        'circle-radius': 7,
        'circle-color': '#0d0f14',
        'circle-opacity': 0.6
      }
    });
    map.addLayer({
      id: 'school-dot',
      type: 'circle',
      source: 'schools',
      paint: {
        'circle-radius': 4,
        'circle-color': '#ffffff',
        'circle-stroke-color': '#0d0f14',
        'circle-stroke-width': 1.5
      }
    });

    setupInteractions();
    setupControls();
    setupCloseHandlers();
    renderTopList(boundaries);
  }).catch(err => {
    console.error('Failed to load data:', err);
    showError('Could not load map data. Check that the data/ files are present and the page is served over HTTP(S), not file://');
  });
});

function renderStats(zones, boundaries) {
  const zonesCount = zones.features.length;
  const bdsCount = boundaries.features.length;
  const highPlus = boundaries.features.filter(f => f.properties.bsi_score >= BSI_HIGH).length;
  const hwyBnd = boundaries.features.filter(f => f.properties.follows_highway).length;
  document.getElementById('stat-zones').textContent = zonesCount;
  document.getElementById('stat-boundaries').textContent = bdsCount;
  document.getElementById('stat-critical').textContent = highPlus;
  document.getElementById('stat-highway').textContent = hwyBnd;
}

function setupInteractions() {
  map.on('mouseenter', 'boundary-lines', e => {
    map.getCanvas().style.cursor = 'pointer';
    showHoverPopup(e.lngLat, hoverPopupHtml(e.features[0].properties));
  });
  map.on('mousemove', 'boundary-lines', e => {
    if (hoverPopup) {
      hoverPopup.setLngLat(e.lngLat);
      hoverPopup.setHTML(hoverPopupHtml(e.features[0].properties));
    }
  });
  map.on('mouseleave', 'boundary-lines', () => {
    map.getCanvas().style.cursor = '';
    if (hoverPopup) { hoverPopup.remove(); hoverPopup = null; }
  });
  map.on('click', 'boundary-lines', e => {
    showBoundaryComparison(e.features[0].properties);
  });

  map.on('mouseenter', 'zone-fill', e => {
    map.getCanvas().style.cursor = 'pointer';
    showHoverPopup(e.lngLat, zonePopupHtml(e.features[0].properties));
  });
  map.on('mousemove', 'zone-fill', e => {
    if (hoverPopup) {
      hoverPopup.setLngLat(e.lngLat);
      hoverPopup.setHTML(zonePopupHtml(e.features[0].properties));
    }
  });
  map.on('mouseleave', 'zone-fill', () => {
    map.getCanvas().style.cursor = '';
    if (hoverPopup) { hoverPopup.remove(); hoverPopup = null; }
  });

  map.on('mouseenter', 'school-dot', e => {
    map.getCanvas().style.cursor = 'pointer';
    const coords = e.features[0].geometry.coordinates.slice();
    showHoverPopup(coords, zonePopupHtml(e.features[0].properties));
  });
  map.on('mouseleave', 'school-dot', () => {
    map.getCanvas().style.cursor = '';
    if (hoverPopup) { hoverPopup.remove(); hoverPopup = null; }
  });
}

function hoverPopupHtml(p) {
  return `<div class="hover-popup">
    <div class="hp-title">${p.school_a_name} ↔ ${p.school_b_name}</div>
    <div class="hp-bsi" style="color:${bsiColor(p.bsi_score)}">BSI ${p.bsi_score}</div>
    ${p.follows_highway ? '<div class="hp-flag">follows highway</div>' : ''}
    ${p.follows_railroad ? '<div class="hp-flag">follows railroad</div>' : ''}
  </div>`;
}

function zonePopupHtml(p) {
  return `<div class="hover-popup">
    <div class="hp-title">${p.school_name}</div>
    <div class="hp-sub">Attendance zone · ${p.community_area}</div>
    <div class="hp-rows">
      <div class="hp-row"><span>% Minority</span><strong>${p.pct_minority}%</strong></div>
      <div class="hp-row"><span>% Low income</span><strong>${p.pct_low_income}%</strong></div>
      <div class="hp-row"><span>Proficiency</span><strong>${p.test_proficiency_pct}%</strong></div>
    </div>
  </div>`;
}

function showHoverPopup(lngLat, html) {
  if (hoverPopup) hoverPopup.remove();
  hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'hp-container', offset: 8 })
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(map);
}

function showBoundaryComparison(p) {
  selectedBoundaryKey = p._key || boundaryKey(p);
  const selectedFeature = boundaryData.features.find(f => f.properties._key === selectedBoundaryKey);
  if (selectedFeature) {
    map.getSource('selected').setData({ type: 'FeatureCollection', features: [selectedFeature] });
  }

  document.getElementById('comparison-panel').style.display = '';
  document.getElementById('about-panel').style.display = 'none';

  const bsi = p.bsi_score;
  const color = bsiColor(bsi);
  const flags = [];
  if (p.follows_highway) flags.push('<div class="highway-flag">⚠ This boundary follows a highway — physical infrastructure built through communities of color in the mid-20th century</div>');
  if (p.follows_railroad) flags.push('<div class="highway-flag">⚠ This boundary follows a railroad corridor</div>');

  const sA = schoolsById[p.school_a_name] || null;
  const sB = schoolsById[p.school_b_name] || null;
  const expGap = (sA && sB) ? Math.abs(sA.per_pupil_expenditure - sB.per_pupil_expenditure) : null;

  document.getElementById('comparison-content').innerHTML = `
    <div class="bsi-score-display">
      <div class="score" style="color:${color}">${bsi}</div>
      <div class="score-label">Boundary Segregation Index</div>
      <div class="score-tier">${bsi >= BSI_CRITICAL ? 'Critical' : bsi >= BSI_HIGH ? 'High' : bsi >= BSI_MODERATE ? 'Moderate' : 'Low'} discontinuity</div>
    </div>
    <div class="school-compare">
      ${schoolCard(p.school_a_name, sA)}
      ${schoolCard(p.school_b_name, sB)}
    </div>
    ${expGap !== null ? `<div class="exp-gap">Per-pupil spending gap: <strong>$${expGap.toLocaleString()}/yr</strong></div>` : ''}
    <div class="bsi-components">
      <div class="bsi-comp-row">
        <div class="bsi-comp-label"><span>Racial discontinuity (40%)</span><span style="color:var(--text)">${p.racial_discontinuity}%</span></div>
        <div class="bsi-comp-track"><div class="bsi-comp-fill" style="width:${p.racial_discontinuity}%;background:#e84141"></div></div>
      </div>
      <div class="bsi-comp-row">
        <div class="bsi-comp-label"><span>Economic discontinuity (30%)</span><span style="color:var(--text)">${p.economic_discontinuity}%</span></div>
        <div class="bsi-comp-track"><div class="bsi-comp-fill" style="width:${p.economic_discontinuity}%;background:#ff7b00"></div></div>
      </div>
      <div class="bsi-comp-row">
        <div class="bsi-comp-label"><span>Performance gap (30%)</span><span style="color:var(--text)">${p.performance_discontinuity} pts</span></div>
        <div class="bsi-comp-track"><div class="bsi-comp-fill" style="width:${Math.min(100, p.performance_discontinuity * 1.5)}%;background:#ffd700"></div></div>
      </div>
    </div>
    ${flags.join('')}
  `;
}

function schoolCard(name, data) {
  if (!data) return `<div class="school-card"><div class="sc-name">${name}</div></div>`;
  return `
    <div class="school-card">
      <div class="sc-name">${name}</div>
      <div class="sc-row"><span>% Minority</span><span class="sc-val">${data.pct_minority}%</span></div>
      <div class="sc-row"><span>% Low income</span><span class="sc-val">${data.pct_low_income}%</span></div>
      <div class="sc-row"><span>Test proficiency</span><span class="sc-val">${data.test_proficiency_pct}%</span></div>
      <div class="sc-row"><span>Per-pupil exp.</span><span class="sc-val">$${Number(data.per_pupil_expenditure).toLocaleString()}</span></div>
    </div>
  `;
}

function applyBoundaryFilter() {
  const threshold = parseInt(document.getElementById('bsi-threshold').value, 10);
  const hwyOnly = document.getElementById('toggle-highway-only').checked;
  const clauses = [];
  if (threshold > 0) clauses.push(['>=', ['get', 'bsi_score'], threshold]);
  if (hwyOnly) clauses.push(['==', ['get', 'follows_highway'], true]);
  const filter = clauses.length === 0 ? null : clauses.length === 1 ? clauses[0] : ['all', ...clauses];
  ['boundary-lines', 'boundary-bg', 'boundary-casing'].forEach(l => map.setFilter(l, filter));
}

function setupControls() {
  document.getElementById('zone-color').addEventListener('change', e => {
    const val = e.target.value;
    const field = val === 'race' ? 'pct_minority' : val === 'income' ? 'pct_low_income' : 'test_proficiency_pct';
    const invert = val === 'performance';
    const expr = ['interpolate', ['linear'], ['get', field],
      ...(invert ? [0, '#e84141', 50, '#ffd700', 100, '#44cc44'] : [0, '#44cc44', 50, '#ffd700', 100, '#e84141'])
    ];
    map.setPaintProperty('zone-fill', 'fill-color', expr);
    document.getElementById('legend-zone-desc').textContent =
      val === 'race' ? '% minority' : val === 'income' ? '% low income' : 'proficiency';
  });

  document.getElementById('bsi-threshold').addEventListener('input', e => {
    const val = parseInt(e.target.value, 10);
    document.getElementById('bsi-label').textContent = val > 0 ? `Show BSI ≥ ${val}` : 'Show all boundaries';
    applyBoundaryFilter();
  });

  document.getElementById('toggle-highway-only').addEventListener('change', applyBoundaryFilter);
}

function closeComparison() {
  document.getElementById('comparison-panel').style.display = 'none';
  document.getElementById('about-panel').style.display = '';
  selectedBoundaryKey = null;
  if (map.getSource('selected')) {
    map.getSource('selected').setData({ type: 'FeatureCollection', features: [] });
  }
}

function setupCloseHandlers() {
  document.getElementById('comp-close').addEventListener('click', closeComparison);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('comparison-panel').style.display !== 'none') {
      closeComparison();
    }
  });
}

function renderTopList(boundaries) {
  const container = document.getElementById('top-list');
  if (!container) return;
  const top = [...boundaries.features]
    .sort((a, b) => b.properties.bsi_score - a.properties.bsi_score)
    .slice(0, 8);
  container.innerHTML = top.map(f => {
    const p = f.properties;
    return `<button class="top-item" data-key="${p._key}">
      <span class="top-score" style="color:${bsiColor(p.bsi_score)}">${p.bsi_score}</span>
      <span class="top-names">${p.school_a_name}<br>${p.school_b_name}</span>
      ${p.follows_highway ? '<span class="top-tag">HWY</span>' : p.follows_railroad ? '<span class="top-tag">RAIL</span>' : ''}
    </button>`;
  }).join('');

  container.addEventListener('click', e => {
    const btn = e.target.closest('.top-item');
    if (!btn) return;
    const key = btn.getAttribute('data-key');
    const feat = boundaryData.features.find(f => f.properties._key === key);
    if (!feat) return;
    const coords = feat.geometry.coordinates;
    const mid = coords[Math.floor(coords.length / 2)];
    map.flyTo({ center: mid, zoom: 13, speed: 1.2 });
    showBoundaryComparison(feat.properties);
  });
}
