'use strict';
const CHICAGO = [-87.65, 41.88];
let map, zoneData, boundaryData, schoolData;

function bsiColor(score) {
  if (score >= 75) return '#e84141';
  if (score >= 50) return '#ff7b00';
  if (score >= 25) return '#ffd700';
  return '#44cc44';
}

map = new maplibregl.Map({
  container:'map',
  style:{version:8,sources:{base:{type:'raster',tiles:['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],tileSize:256,attribution:'© CARTO © OSM'}},layers:[{id:'base',type:'raster',source:'base'}]},
  center:CHICAGO, zoom:11
});
map.addControl(new maplibregl.NavigationControl({showCompass:false}),'bottom-right');

map.on('load', () => {
  Promise.all([
    fetch('data/attendance_zones.geojson').then(r=>r.json()),
    fetch('data/boundary_lines_bsi.geojson').then(r=>r.json()),
    fetch('data/schools_demographics.json').then(r=>r.json()),
  ]).then(([zones, boundaries, schools]) => {
    zoneData = zones;
    boundaryData = boundaries;
    schoolData = schools;

    const critical = boundaries.features.filter(f=>f.properties.bsi_score>=75).length;
    const hwyBnd = boundaries.features.filter(f=>f.properties.follows_highway).length;
    document.getElementById('stat-critical').textContent = critical;
    document.getElementById('stat-highway').textContent = hwyBnd;

    map.addSource('zones', {type:'geojson', data:zones});
    map.addSource('boundaries', {type:'geojson', data:boundaries});

    map.addLayer({
      id:'zone-fill', type:'fill', source:'zones',
      paint:{
        'fill-color':['interpolate',['linear'],['get','pct_minority'],0,'#44cc44',40,'#ffd700',70,'#ff7b00',100,'#e84141'],
        'fill-opacity':0.55
      }
    });
    map.addLayer({
      id:'zone-outline', type:'line', source:'zones',
      paint:{'line-color':'#252933','line-width':0.8}
    });
    map.addLayer({
      id:'boundary-bg', type:'line', source:'boundaries',
      paint:{
        'line-color':['interpolate',['linear'],['get','bsi_score'],0,'#44cc44',50,'#ff7b00',75,'#e84141'],
        'line-width':8, 'line-opacity':0.15
      }
    });
    map.addLayer({
      id:'boundary-lines', type:'line', source:'boundaries',
      paint:{
        'line-color':['interpolate',['linear'],['get','bsi_score'],0,'#44cc44',50,'#ff7b00',75,'#e84141'],
        'line-width':['interpolate',['linear'],['get','bsi_score'],0,1,100,4]
      }
    });

    map.on('mouseenter','boundary-lines',()=>map.getCanvas().style.cursor='pointer');
    map.on('mouseleave','boundary-lines',()=>map.getCanvas().style.cursor='');
    map.on('click','boundary-lines', e => showBoundaryComparison(e.features[0].properties));

    map.on('mouseenter','zone-fill',()=>map.getCanvas().style.cursor='crosshair');
    map.on('mouseleave','zone-fill',()=>map.getCanvas().style.cursor='');

    setupControls();
    document.getElementById('comp-close').addEventListener('click',()=>{
      document.getElementById('comparison-panel').style.display='none';
      document.getElementById('about-panel').style.display='';
    });
  });
});

function showBoundaryComparison(p) {
  document.getElementById('comparison-panel').style.display='';
  document.getElementById('about-panel').style.display='none';

  const bsi = p.bsi_score;
  const color = bsiColor(bsi);
  const hwyFlag = p.follows_highway ? '<div class="highway-flag">⚠ This boundary follows a highway — physical infrastructure built through communities of color in the mid-20th century</div>' : '';

  // Get both schools from zone data
  const sA = findSchoolInZones(p.school_a_name);
  const sB = findSchoolInZones(p.school_b_name);

  document.getElementById('comparison-content').innerHTML = `
    <div class="bsi-score-display">
      <div class="score" style="color:${color}">${bsi}</div>
      <div class="score-label">Boundary Segregation Index</div>
    </div>
    <div class="school-compare">
      ${schoolCard(p.school_a_name, sA)}
      ${schoolCard(p.school_b_name, sB)}
    </div>
    <div class="bsi-components">
      <div class="bsi-comp-row">
        <div class="bsi-comp-label"><span>Racial discontinuity</span><span style="color:var(--text)">${p.racial_discontinuity}%</span></div>
        <div class="bsi-comp-track"><div class="bsi-comp-fill" style="width:${p.racial_discontinuity}%;background:#e84141"></div></div>
      </div>
      <div class="bsi-comp-row">
        <div class="bsi-comp-label"><span>Economic discontinuity</span><span style="color:var(--text)">${p.economic_discontinuity}%</span></div>
        <div class="bsi-comp-track"><div class="bsi-comp-fill" style="width:${p.economic_discontinuity}%;background:#ff7b00"></div></div>
      </div>
      <div class="bsi-comp-row">
        <div class="bsi-comp-label"><span>Performance gap</span><span style="color:var(--text)">${p.performance_discontinuity} pts</span></div>
        <div class="bsi-comp-track"><div class="bsi-comp-fill" style="width:${Math.min(100,p.performance_discontinuity*1.5)}%;background:#ffd700"></div></div>
      </div>
    </div>
    ${hwyFlag}
  `;
}

function findSchoolInZones(name) {
  const f = zoneData.features.find(z => z.properties.school_name === name);
  return f ? f.properties : null;
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

function setupControls() {
  document.getElementById('zone-color').addEventListener('change', e => {
    const val = e.target.value;
    const field = val==='race' ? 'pct_minority' : val==='income' ? 'pct_low_income' : 'test_proficiency_pct';
    const invert = val === 'performance';
    const expr = ['interpolate',['linear'],['get',field],
      ...(invert ? [0,'#e84141',50,'#ffd700',100,'#44cc44'] : [0,'#44cc44',50,'#ffd700',100,'#e84141'])
    ];
    map.setPaintProperty('zone-fill','fill-color', expr);
    document.getElementById('legend-zone-desc').textContent = val==='race' ? '% minority' : val==='income' ? '% low income' : 'proficiency';
  });

  document.getElementById('bsi-threshold').addEventListener('input', e => {
    const val = parseInt(e.target.value);
    document.getElementById('bsi-label').textContent = val > 0 ? `Show BSI ≥ ${val}` : 'Show all boundaries';
    const filter = val > 0 ? ['>=',['get','bsi_score'],val] : null;
    ['boundary-lines','boundary-bg'].forEach(l=>map.setFilter(l,filter));
  });

  document.getElementById('toggle-highway-only').addEventListener('change', e => {
    const filter = e.target.checked ? ['==',['get','follows_highway'],true] : null;
    ['boundary-lines','boundary-bg'].forEach(l=>map.setFilter(l,filter));
  });
}
