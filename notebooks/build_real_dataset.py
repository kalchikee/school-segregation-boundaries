"""Build the real-data GeoJSON files from CPS portal downloads.

Reads:
    data/raw/cps_elem_boundaries.geojson   — CPS Elementary School Attendance Boundaries SY2425 (5ihw-cbdn)
    data/raw/cps_profile.json               — CPS School Profile Information SY2223 (9a5f-2r4p)
    data/raw/cps_progress.json              — CPS School Progress Reports SY2425 (twrw-chuq)

Writes:
    data/attendance_zones.geojson
    data/schools_points.geojson
    data/boundary_lines_bsi.geojson
    data/schools_demographics.json
"""
import json
import os
from shapely.geometry import shape, mapping, LineString, MultiLineString, Point
from shapely.ops import linemerge
from shapely.strtree import STRtree

RATING_SCORE = {
    'FAR ABOVE EXPECTATIONS': 90,
    'ABOVE EXPECTATIONS': 75,
    'MET EXPECTATIONS': 60,
    'BELOW EXPECTATIONS': 40,
    'FAR BELOW EXPECTATIONS': 20,
}

# Approximate centerlines for Chicago expressways, coords as [lng, lat]
EXPRESSWAYS = {
    'Dan Ryan (I-90/94 S)': [[-87.635, 41.876], [-87.634, 41.850], [-87.632, 41.820], [-87.629, 41.780], [-87.625, 41.740], [-87.621, 41.700], [-87.619, 41.660]],
    'Kennedy (I-90/94 N)': [[-87.635, 41.876], [-87.656, 41.888], [-87.700, 41.910], [-87.740, 41.935], [-87.790, 41.960], [-87.840, 41.985], [-87.895, 42.010]],
    'Eisenhower (I-290)': [[-87.638, 41.876], [-87.680, 41.876], [-87.720, 41.875], [-87.770, 41.876], [-87.820, 41.877], [-87.860, 41.877]],
    'Stevenson (I-55)': [[-87.634, 41.870], [-87.660, 41.855], [-87.695, 41.840], [-87.730, 41.823], [-87.775, 41.802], [-87.820, 41.788]],
    'Bishop Ford (I-94 SE)': [[-87.620, 41.700], [-87.590, 41.670], [-87.560, 41.640]],
    'Skyway (I-90 SE)': [[-87.580, 41.730], [-87.550, 41.710], [-87.530, 41.690]],
}


def load_demographics():
    with open('data/raw/cps_profile.json', encoding='utf-8') as f:
        profile_rows = json.load(f)
    with open('data/raw/cps_progress.json', encoding='utf-8') as f:
        progress_rows = json.load(f)

    demo = {}
    for p in profile_rows:
        sid = p.get('school_id')
        if not sid:
            continue
        total = int(p.get('student_count_total') or 0)
        if total < 20:
            continue
        def pct(k):
            v = p.get(k)
            return round(100 * int(v or 0) / total)
        demo[str(sid)] = {
            'school_id': str(sid),
            'school_name': p.get('long_name') or p.get('short_name') or f'School {sid}',
            'pct_black': pct('student_count_black'),
            'pct_white': pct('student_count_white'),
            'pct_hispanic': pct('student_count_hispanic'),
            'pct_asian': pct('student_count_asian'),
            'pct_low_income': pct('student_count_low_income'),
            'pct_minority': 100 - pct('student_count_white'),
            'total_enrollment': total,
        }

    for p in progress_rows:
        sid = str(p.get('school_id'))
        if sid not in demo:
            continue
        try:
            lat = float(p['school_latitude']) if p.get('school_latitude') else None
            lng = float(p['school_longitude']) if p.get('school_longitude') else None
        except (ValueError, TypeError):
            lat, lng = None, None
        demo[sid]['school_latitude'] = lat
        demo[sid]['school_longitude'] = lng
        try:
            demo[sid]['attendance_pct'] = float(p.get('student_attendance_year_2')) if p.get('student_attendance_year_2') else None
        except (ValueError, TypeError):
            demo[sid]['attendance_pct'] = None

    return demo


def load_zones(demo):
    with open('data/raw/cps_elem_boundaries.geojson', encoding='utf-8') as f:
        raw = json.load(f)
    zones = []
    for feat in raw['features']:
        sid = str(feat['properties'].get('school_id') or '')
        d = demo.get(sid)
        if not d:
            continue
        if not d.get('school_latitude'):
            continue
        orig = shape(feat['geometry'])
        if not orig.is_valid:
            orig = orig.buffer(0)
        if orig.is_empty:
            continue
        simp = orig.simplify(0.0005, preserve_topology=True)
        if not simp.is_valid:
            simp = simp.buffer(0)
        zones.append({'sid': sid, 'geom_orig': orig, 'geom': simp, 'props': d})
    return zones


def compute_boundaries(zones):
    # Use original (non-simplified) geometries for adjacency so edges line up
    origs = [z['geom_orig'] for z in zones]
    tree = STRtree(origs)
    exp_lines = [LineString(pts) for pts in EXPRESSWAYS.values()]
    out = []
    seen = set()

    for i, z in enumerate(zones):
        for j in tree.query(origs[i]):
            j = int(j)
            if j <= i:
                continue
            key = (i, j)
            if key in seen:
                continue
            zb = zones[j]
            if not origs[i].touches(origs[j]):
                continue
            shared = origs[i].boundary.intersection(origs[j].boundary)
            if shared.is_empty:
                continue
            if shared.geom_type == 'LineString':
                lines = [shared]
            elif shared.geom_type == 'MultiLineString':
                lines = list(shared.geoms)
            elif shared.geom_type == 'GeometryCollection':
                lines = [g for g in shared.geoms if g.geom_type == 'LineString']
                if not lines:
                    continue
            else:
                continue
            total_len = sum(l.length for l in lines)
            if total_len < 0.0003:
                continue
            # Join contiguous segments then simplify aggressively (~100m tolerance)
            merged_full = MultiLineString(lines) if len(lines) > 1 else lines[0]
            try:
                merged = linemerge(merged_full) if merged_full.geom_type == 'MultiLineString' else merged_full
            except Exception:
                merged = merged_full
            merged = merged.simplify(0.001, preserve_topology=False)
            if merged.is_empty:
                merged = merged_full
            seen.add(key)

            a, b = z['props'], zb['props']
            racial = abs(a['pct_minority'] - b['pct_minority'])
            econ = abs(a['pct_low_income'] - b['pct_low_income'])
            if a.get('attendance_pct') is not None and b.get('attendance_pct') is not None:
                attendance_gap = round(abs(a['attendance_pct'] - b['attendance_pct']))
                # attendance spread is narrow (85-96%); scale ~5x so it reads on 0-100
                perf = min(100, attendance_gap * 5)
            else:
                perf = 0
            bsi = round(0.4 * racial + 0.3 * econ + 0.3 * perf)
            tier = 'critical' if bsi >= 75 else 'high' if bsi >= 50 else 'moderate' if bsi >= 25 else 'low'

            sample = merged if merged.geom_type == 'LineString' else lines[0]
            mid = sample.interpolate(0.5, normalized=True)
            min_hwy = min(mid.distance(el) for el in exp_lines)
            follows_highway = min_hwy < 0.003

            out.append({
                'type': 'Feature',
                'geometry': mapping(merged),
                'properties': {
                    'school_a_id': a['school_id'], 'school_a_name': a['school_name'],
                    'school_b_id': b['school_id'], 'school_b_name': b['school_name'],
                    'bsi_score': bsi, 'racial_discontinuity': racial,
                    'economic_discontinuity': econ, 'performance_discontinuity': perf,
                    'follows_highway': follows_highway, 'follows_railroad': False,
                    'tier': tier,
                }
            })
    return out


def write_outputs(zones, boundaries):
    zones_fc = {'type': 'FeatureCollection', 'features': []}
    points_fc = {'type': 'FeatureCollection', 'features': []}
    demo_out = {}

    for z in zones:
        p = z['props']
        props = {
            'school_id': p['school_id'],
            'school_name': p['school_name'],
            'pct_black': p['pct_black'], 'pct_white': p['pct_white'],
            'pct_hispanic': p['pct_hispanic'], 'pct_asian': p['pct_asian'],
            'pct_low_income': p['pct_low_income'], 'pct_minority': p['pct_minority'],
            'attendance_pct': p.get('attendance_pct'),
            'total_enrollment': p['total_enrollment'],
            'community_area': 'Chicago',
        }
        zones_fc['features'].append({
            'type': 'Feature',
            'geometry': mapping(z['geom']),
            'properties': props,
        })
        points_fc['features'].append({
            'type': 'Feature',
            'geometry': {'type': 'Point', 'coordinates': [p['school_longitude'], p['school_latitude']]},
            'properties': props,
        })
        demo_out[p['school_name']] = props

    with open('data/attendance_zones.geojson', 'w') as f:
        json.dump(zones_fc, f)
    with open('data/schools_points.geojson', 'w') as f:
        json.dump(points_fc, f)
    with open('data/boundary_lines_bsi.geojson', 'w') as f:
        json.dump({'type': 'FeatureCollection', 'features': boundaries}, f)
    with open('data/schools_demographics.json', 'w') as f:
        json.dump(demo_out, f)


def main():
    demo = load_demographics()
    print(f'Schools with demographics: {len(demo)}')
    zones = load_zones(demo)
    print(f'Zones with complete data: {len(zones)}')
    boundaries = compute_boundaries(zones)
    print(f'Adjacency boundaries: {len(boundaries)}')
    print(f'  critical (>=75): {sum(1 for b in boundaries if b["properties"]["bsi_score"] >= 75)}')
    print(f'  high (50-74):    {sum(1 for b in boundaries if 50 <= b["properties"]["bsi_score"] < 75)}')
    print(f'  follow highway:  {sum(1 for b in boundaries if b["properties"]["follows_highway"])}')
    write_outputs(zones, boundaries)
    for f in ['data/attendance_zones.geojson', 'data/schools_points.geojson', 'data/boundary_lines_bsi.geojson', 'data/schools_demographics.json']:
        print(f'{f}  {os.path.getsize(f)/1024:.1f} KB')


if __name__ == '__main__':
    main()
