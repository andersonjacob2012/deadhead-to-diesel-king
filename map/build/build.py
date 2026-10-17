#!/usr/bin/env python3
"""Build the Deadhead to Diesel King basemap (map/) from public-domain sources.
Run:  python3 map/build/build.py  (needs: shapely numpy pillow[webp], node, mapshaper on PATH; sources fetched by fetch_sources.sh into $DK_MAP_SRC)
Outputs WGS84 lon/lat GeoJSON bands + cities + hillshade into map/."""
import json, math, os, subprocess, gzip, re
from shapely.geometry import shape, mapping, box, Polygon, MultiPolygon, LineString, MultiLineString, Point, GeometryCollection
from shapely.ops import unary_union, linemerge
from shapely import set_precision
import shapely

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)                       # map/
REPO = os.path.dirname(OUT)
SRC = os.environ.get('DK_MAP_SRC', '/workspace/mapwork/src')
TMP = os.environ.get('DK_MAP_TMP', '/workspace/mapwork/tmp')
os.makedirs(TMP, exist_ok=True)
CLIP = (-140.0, 12.0, -50.0, 60.0)               # neighbor silhouettes kept inside this bbox
CELL = 4                                          # z10+ chunk size, degrees
BANDS = {   # id: source scale, simplify interval (m), coord decimals, hwy DP tol (m), hwy corridor dedupe (m), topojson quantization, neighbor north clip
  'z3':  dict(cb='20m',  iv=1500, dec=3, hwy=900, dd=4000, q=40000,  ne='50m', nn=72, nbr_iv=4000),
  'z7':  dict(cb='5m',   iv=350,  dec=4, hwy=200, dd=1500, q=100000, ne='10m', nn=53, nbr_iv=1500, ua=300e6, ua_iv=400, ua_soft=1500, ua_dp=700),
  'z10': dict(cb='500k', iv=20,   dec=5, hwy=6,   dd=300,  q=100000, ne='10m', nn=53, ua=60e6, ua_iv=50, ua_soft=500, ua_dp=150),
}
NOT_CONUS = {'AK','HI','PR','VI','GU','AS','MP'}

def sh(cmd):
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if r.returncode: raise SystemExit(r.stderr)
    return r.stdout

def load(path): return json.load(open(path))

# ---------------- game data (cities, routes, tiers) ----------------
def game():
    js = """const fs=require('fs');const g=new Function(fs.readFileSync(process.argv[2],'utf8')+';return{CITY_LL,HUBS,ROUTES}')();
const h=fs.readFileSync(process.argv[3],'utf8');const grab=n=>JSON.parse('['+h.match(new RegExp(n+'=new Set\\\\(\\\\[([^\\\\]]*)\\\\]'))[1].replace(/'/g,'"')+']');
const mm=h.match(/SMOOTH=(\\{[^}]*\\})/),sm=mm&&mm[1].replace(/\\/\\*[^*]*\\*\\//g,'');
g.TOP=grab('TOP');g.BIG=grab('BIG');g.SMOOTH=sm&&/smoothPts\\(r\\.pts\\)/.test(h)?(new Function('return '+sm))():null;g.REGN=JSON.parse(h.match(/REGN=(\\[[^\\]]*\\])/)[1].replace(/'/g,'"'));process.stdout.write(JSON.stringify(g))"""
    open(f'{TMP}/g.js','w').write(js)
    return json.loads(sh(f"node {TMP}/g.js {REPO}/routes.js {REPO}/index.html"))

# exact copy of index.html region(c) rule, as plane partitions (first match wins)
def region_of(la, ln):
    if la < 37.2 and -106.8 < ln < -89.5: return 0
    if la >= 36.5 and -104.5 < ln < -80.5: return 1
    if la < 36.5 and ln >= -89.5: return 2
    if -117.3 <= ln < -104.5: return 3
    if ln >= -80.5: return 4
    return 5
def region_cells():
    W = box(-180, 0, 0, 80)
    raw = [box(-106.8, 0, -89.5, 37.2), box(-104.5, 36.5, -80.5, 80), box(-89.5, 0, 0, 36.5),
           box(-117.3, 0, -104.5, 80), box(-80.5, 0, 0, 80), W]
    cells, taken = [], Polygon()
    for r in raw:
        c = r.difference(taken); cells.append(c); taken = taken.union(r)
    return cells

# Interstates must sit under the trucks, so they use whatever geometry the game drives: raw routes.js points, or, if
# index.html route() runs smoothPts(r.pts) with a SMOOTH table (a WIP variant seen during this build), the same smoothing.
def smooth_pts(P, S):
    if not S or len(P) < 3: return P     # the committed game drives the raw routes.js polylines (no smoothing)
    c = math.cos(P[0][0] * math.pi / 180); Q = [[p[0], p[1] * c] for p in P]
    for k in range(S['n']):
        o = [Q[0]]
        for i in range(1, len(Q) - 1):
            A, B, C = Q[i-1], Q[i], Q[i+1]
            ux, uy, vx, vy = B[0]-A[0], B[1]-A[1], C[0]-B[0], C[1]-B[1]
            la, lb = math.hypot(ux, uy), math.hypot(vx, vy)
            if la < 1e-9 or lb < 1e-9: continue
            tr = math.degrees(math.acos(max(-1, min(1, (ux*vx+uy*vy)/(la*lb)))))
            if tr < S['min']: o.append(B); continue
            m = S['max'] / (1 << k); da = min(la*S['cut'], m); db = min(lb*S['cut'], m)
            o += [[B[0]-ux/la*da, B[1]-uy/la*da], [B[0]+vx/lb*db, B[1]+vy/lb*db]]
        o.append(Q[-1]); Q = o
    return [[q[0], q[1] / c] for q in Q]

def hwy_lines(G, tol_m):
    """routes.js polylines smoothed exactly like the game (smoothPts), then corridor-deduped: a route's stretch is dropped
    where an already-kept (longer) route runs within tol_m. routes.js is rounded to 0.01 deg (~1 km), so routes sharing an
    interstate wander up to ~1 km apart; tol_m ~1.2 km keeps one clean line per corridor."""
    from shapely.strtree import STRtree
    L = []
    for r in G['ROUTES'].values():
        sm = smooth_pts(r['pts'], G['SMOOTH']); L.append(LineString([(p[1], p[0]) for p in sm]))
    L.sort(key=lambda l: -l.length)
    tol = tol_m / 90000.0; kept, bufs = [], []
    for l in L:
        if bufs:
            idx = STRtree(bufs).query(l)
            l2 = l.difference(unary_union([bufs[i] for i in idx])) if len(idx) else l
        else: l2 = l
        from shapely.ops import substring, nearest_points
        ext = tol * 1.6
        for p_ in lines(l2):
            if p_.length <= tol * 3: continue
            d0, d1 = sorted((l.project(Point(p_.coords[0])), l.project(Point(p_.coords[-1]))))
            q = substring(l, max(0, d0 - ext), min(l.length, d1 + ext))
            cs = list(q.coords)
            if kept:   # close the junction gap: join both ends to the nearest kept line if it is close
                tree = STRtree(kept)
                for end in (0, -1):
                    pt = Point(cs[end]); ix = tree.query(pt.buffer(tol * 2.5))
                    if len(ix):
                        near = min((kept[i] for i in ix), key=lambda k: k.distance(pt))
                        if 0 < near.distance(pt) < tol * 2.5:
                            np_ = nearest_points(near, pt)[0].coords[0]
                            cs = [np_] + cs if end == 0 else cs + [np_]
            q = LineString(cs)
            kept.append(q); bufs.append(p_.buffer(tol, cap_style=2))
    return kept, L

def to_m(g, lat0):
    k = math.cos(math.radians(lat0))
    return shapely.transform(g, lambda a: a * [111320 * k, 110540])
def from_m(g, lat0):
    k = math.cos(math.radians(lat0))
    return shapely.transform(g, lambda a: a / [111320 * k, 110540])
def dp(g, tol):
    lat0 = g.centroid.y
    return from_m(to_m(g, lat0).simplify(tol, preserve_topology=False), lat0)

# ---------------- geometry sources ----------------
def states_band(b):
    cfg = BANDS[b]; f = f'{TMP}/st_{b}'
    flt = ' && '.join(f'STUSPS!="{s}"' for s in NOT_CONUS)
    shp = f'{SRC}/cb_2023_us_state_{cfg["cb"]}/cb_2023_us_state_{cfg["cb"]}.shp'
    sh(f"mapshaper -i {shp} -filter '{flt}' -proj wgs84 -each 'code=STUSPS,name=NAME' -filter-fields code,name "
       f"-simplify interval={cfg['iv']} keep-shapes -o {f}_poly.json format=geojson precision=0.000001 "
       f"-innerlines -o {f}_inner.json format=geojson precision=0.000001")
    sh(f"mapshaper -i {f}_poly.json -dissolve -lines -o {f}_edge.json format=geojson precision=0.000001")
    return load(f'{f}_poly.json')['features'], load(f'{f}_inner.json'), load(f'{f}_edge.json')

def geoms(fc):
    fc = fc if isinstance(fc, dict) else {'features': fc}
    if fc.get('type') == 'GeometryCollection': return [shape(g) for g in fc['geometries']]
    return [shape(f['geometry']) for f in fc['features']]

def ne_countries(scale, nn):
    f = f'{TMP}/ne_ctry_{scale}_{nn}.json'
    sh(f"mapshaper -i {SRC}/ne_{scale}_admin_0_countries/ne_{scale}_admin_0_countries.shp "
       f"-clip bbox={CLIP[0]},{CLIP[1]},{CLIP[2]},{nn} -each 'c=ADM0_A3' -filter-fields c -o {f} format=geojson")
    out = {}
    for ft in load(f)['features']:
        c = ft['properties']['c']; g = shape(ft['geometry'])
        if c == 'USA':   # keep only Alaska (west of -129, north of 51) as a muted neighbor silhouette
            g = g.intersection(box(-180, 51, -129.9, 80)); c = 'AK'
            if g.is_empty: continue
        out[c] = unary_union([out[c], g]) if c in out else g
    return out

def ne_lakes(scale):
    f = f'{TMP}/ne_lakes_{scale}.json'
    sh(f"mapshaper -i {SRC}/ne_{scale}_lakes/ne_{scale}_lakes.shp -clip bbox={','.join(map(str,CLIP))} "
       f"-each 'n=name,r=scalerank' -filter-fields n,r -o {f} format=geojson")
    return [(ft['properties'], shape(ft['geometry'])) for ft in load(f)['features']]

def rnd(g, dec):
    return set_precision(g, 10 ** -dec) if dec else g

def feat(geom, props, dec):
    if geom.is_empty: return None
    gj = mapping(geom)
    def r(x):
        if isinstance(x, (list, tuple)) and x and isinstance(x[0], (int, float)): return [round(x[0], dec), round(x[1], dec)]
        return [r(y) for y in x]
    gj = {'type': gj['type'], 'coordinates': r(gj['coordinates'])}
    return {'type': 'Feature', 'properties': props, 'geometry': gj}

def polys(g):
    if g.is_empty: return []
    if isinstance(g, Polygon): return [g]
    if isinstance(g, MultiPolygon): return list(g.geoms)
    if isinstance(g, GeometryCollection): return [p for x in g.geoms for p in polys(x)]
    return []
def lines(g):
    if g.is_empty: return []
    if isinstance(g, LineString): return [g]
    if isinstance(g, MultiLineString): return list(g.geoms)
    if isinstance(g, GeometryCollection): return [p for x in g.geoms for p in lines(x)]
    return []
def as_poly(ps): return ps[0] if len(ps) == 1 else MultiPolygon(ps)
def as_line(ls): return ls[0] if len(ls) == 1 else MultiLineString(ls)

def nverts(fs):
    n = 0
    def c(x):
        nonlocal n
        if isinstance(x[0], (int, float)): n += 1
        else:
            for y in x: c(y)
    for f in fs: c(f['geometry']['coordinates'])
    return n

def build_band(b, G, cells):
    cfg = BANDS[b]; dec = cfg['dec']
    st, inner, edge = states_band(b)
    us = unary_union([shape(f['geometry']) for f in st]).buffer(0)
    ctry = ne_countries(cfg['ne'], cfg['nn']); lakes = ne_lakes(cfg['ne'])
    km = 1 / 111.0
    feats = []
    # neighbors: silhouette, pushed under the US edge near the border (no seam), lakes cut out
    big_lakes = unary_union([g for p, g in lakes if (p.get('r') or 9) <= 2])
    for c, g in ctry.items():
        g = g.buffer(0)
        if c in ('CAN', 'MEX'):
            near = g.buffer(4 * km).intersection(us.buffer(4 * km))
            g = unary_union([g, near]).difference(big_lakes)
        g = dp(g, cfg.get('nbr_iv', cfg['iv'] * 1.5)) if b != 'z10' else g
        feats.append(feat(g.buffer(0), {'l': 'nbr', 'c': c}, dec))
    # US-interior lakes not already cut out by the Census shoreline (e.g. Great Salt Lake, Okeechobee)
    for p, g in lakes:
        if (p.get('r') or 9) > (4 if b == 'z3' else 7): continue
        gi = g.intersection(us)
        if gi.area < 0.25 * g.area or g.intersects(ctry['CAN']): continue
        if b == 'z3' and gi.area < 0.05: continue
        feats.append(feat(dp(gi, cfg['iv']).buffer(0), {'l': 'lake', 'n': p.get('n')}, dec))
    # land: states split by the game's region partition -> {code,name,r}
    for f in st:
        g = shape(f['geometry']).buffer(0)
        for ri, cell in enumerate(cells):
            if not g.intersects(cell): continue
            piece = polys(g.intersection(cell))
            piece = [p for p in piece if p.area > 1e-7]
            if piece:
                feats.append(feat(as_poly(piece), {'l': 'land', 'code': f['properties']['code'], 'name': f['properties']['name'], 'r': ri}, dec))
    # urban areas (Census 2020 UA, public domain): soft lighter blobs for context at z7+
    if cfg.get('ua'):
        f = f'{TMP}/ua_{b}.json'
        sh(f"mapshaper -i {SRC}/ua/cb_2020_us_ua20_500k.shp -filter 'ALAND20>{cfg['ua']}' -clip bbox=-126,24,-66,50 -proj wgs84 "
           f"-each 'n=NAME20' -filter-fields n -simplify interval={cfg['ua_iv']} -filter-slivers -o {f} format=geojson precision=0.000001")
        for ft in load(f)['features']:
            g = shape(ft['geometry']).buffer(0); lat0 = g.centroid.y; B = cfg['ua_soft']
            g = from_m(to_m(g, lat0).buffer(B, 4).buffer(-B * 1.15, 4).simplify(cfg['ua_dp']), lat0).buffer(0).intersection(us)   # soft blob, not census blocks
            if not g.is_empty: feats.append(feat(as_poly(polys(g)) if polys(g) else g, {'l': 'urban'}, dec))
    # lines
    for g in geoms(inner): feats.append(feat(g, {'l': 'inner'}, dec))
    for g in geoms(edge): feats.append(feat(g, {'l': 'edge'}, dec))
    # region frontiers (shared edges of the rule partition, on US land): shown where locked meets unlocked
    for i in range(6):
        for j in range(i + 1, 6):
            sh_ = cells[i].boundary.intersection(cells[j].boundary)
            ls = lines(linemerge(lines(sh_))) if not sh_.is_empty else []
            if not ls: continue
            on = as_line(ls).intersection(us)
            if not on.is_empty: feats.append(feat(on, {'l': 'front', 'a': i, 'b': j}, dec))
    # interstates
    hw = [dp(l, cfg['hwy']) for l in hwy_lines(G, cfg['dd'])[0]]
    feats.append(feat(MultiLineString([l for l in hw if l.length > 0]), {'l': 'hwy'}, dec))
    return [f for f in feats if f]

def clip_feats(feats, bb, dec):
    out = []; B = box(*bb)
    for f in feats:
        g = shape(f['geometry'])
        if f['geometry']['type'].endswith('Polygon') and not g.is_valid: g = g.buffer(0)
        if not g.intersects(B): continue
        gi = g.intersection(B)
        gi = as_poly(polys(gi)) if f['geometry']['type'].endswith('Polygon') and polys(gi) else (as_line(lines(gi)) if lines(gi) else None)
        if gi is None or gi.is_empty: continue
        nf = feat(gi, f['properties'], dec)
        if nf: out.append(nf)
    return out

def write_topo(path, feats, q, bbox=None):
    """Mixed features -> TopoJSON (objects 'poly' and 'line', shared arcs, quantized) via mapshaper."""
    base = f'{TMP}/w_' + re.sub(r'\W', '_', os.path.relpath(path, OUT))
    pf = [f for f in feats if f['geometry']['type'].endswith('Polygon')]
    lf = [f for f in feats if not f['geometry']['type'].endswith('Polygon')]
    ins = []
    for nm, fs in (('poly', pf), ('line', lf)):
        if fs:
            json.dump({'type': 'FeatureCollection', 'features': fs}, open(f'{base}_{nm}.json', 'w')); ins.append(f'{base}_{nm}.json')
    for nm in ('poly', 'line'):
        pass
    sh(f"mapshaper -i {' '.join(ins)} combine-files -rename-layers {','.join(os.path.basename(x)[len(os.path.basename(base))+1:-5] for x in ins)} "
       f"-o {path} format=topojson quantization={q} force")
    t = json.load(open(path))
    if bbox: t['dkBBox'] = bbox
    s = json.dumps(t, separators=(',', ':')); open(path, 'w').write(s)
    return len(s), len(gzip.compress(s.encode(), 9))

def write(path, obj):
    s = json.dumps(obj, separators=(',', ':'))
    open(path, 'w').write(s)
    return len(s), len(gzip.compress(s.encode(), 9))

def hillshade():
    """NE SR_50M (public domain) -> Web Mercator RGBA WebP, US land only, subtle light/dark deltas."""
    import numpy as np
    from PIL import Image, ImageDraw
    Image.MAX_IMAGE_PIXELS = None
    a = np.asarray(Image.open(f'{SRC}/SR_50M/SR_50M.tif')).astype(np.float32)
    W, S_, E, N = -127.0, 23.0, -65.0, 50.5
    merc = lambda lat: math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    w = 1400; yN, yS = merc(N), merc(S_); h = int(round(w * (yN - yS) / math.radians(E - W)))
    ys = np.linspace(yN, yS, h); lats = np.degrees(2 * np.arctan(np.exp(ys)) - math.pi / 2)
    lons = np.linspace(W, E, w)
    rr = np.clip(((90 - lats) * 30).astype(int), 0, a.shape[0] - 1); cc = np.clip(((lons + 180) * 30).astype(int), 0, a.shape[1] - 1)
    v = a[rr][:, cc]
    d = v - 208.0
    # mask to US land (Census 5m) so the ocean stays flat navy
    us = unary_union([shape(f['geometry']) for f in load(f'{TMP}/st_z7_poly.json')['features']])
    m = Image.new('L', (w, h), 0); dr = ImageDraw.Draw(m)
    px = lambda lon, lat: ((lon - W) / (E - W) * w, (yN - merc(lat)) / (yN - yS) * h)
    for p in polys(us):
        dr.polygon([px(x, y) for x, y in p.exterior.coords], fill=255)
        for i in p.interiors: dr.polygon([px(x, y) for x, y in i.coords], fill=0)
    mask = np.asarray(m).astype(np.float32) / 255
    # light side -> pale steel, shadow side -> deep navy; alpha from |delta|
    alpha = np.clip(np.abs(d) * 2.8, 0, 255) * mask
    rgb = np.where(d[..., None] > 0, np.array([200, 214, 240], np.float32), np.array([2, 5, 12], np.float32))
    img = np.dstack([np.broadcast_to(rgb, (h, w, 3)), alpha]).astype(np.uint8)
    Image.fromarray(img, 'RGBA').save(f'{OUT}/hillshade.webp', 'WEBP', quality=50, alpha_quality=45, method=6)
    return [[S_, W], [N, E]], (w, h)

def main():
    G = game()
    cells = region_cells()
    rep = {'files': {}}
    for b in BANDS:
        feats = build_band(b, G, cells)
        rep[b + '_verts'] = nverts(feats)
        if b != 'z10':
            rep['files'][f'base-{b}.json'] = write_topo(f'{OUT}/base-{b}.json', feats, BANDS[b]['q'])
        else:
            os.makedirs(f'{OUT}/z10', exist_ok=True)
            for old in os.listdir(f'{OUT}/z10'): os.remove(f'{OUT}/z10/{old}')
            idx = []
            for x in range(-128, -64, CELL):
                for y in range(24, 52, CELL):
                    bb = (x, y, x + CELL, y + CELL)
                    cf = clip_feats(feats, bb, BANDS[b]['dec'])
                    if not any(f['properties']['l'] in ('land', 'hwy', 'edge') for f in cf): continue
                    name = f'{x}_{y}.json'
                    rep['files'][f'z10/{name}'] = write_topo(f'{OUT}/z10/{name}', cf, BANDS[b]['q'], list(bb))
                    idx.append([x, y])
            rep['files']['z10/index.json'] = write(f'{OUT}/z10/index.json', {'cell': CELL, 'cells': idx})
    # cities
    st = load(f'{TMP}/st_z10_poly.json')['features']; stg = [(f['properties']['code'], shape(f['geometry'])) for f in st]
    top, big, hub = set(G['TOP']), set(G['BIG']), set(G['HUBS'])
    cities, unplaced = [], []
    for k, (la, ln, n) in G['CITY_LL'].items():
        p = Point(ln, la); code = next((c for c, g in stg if g.contains(p)), None)
        if code is None:
            near = min(stg, key=lambda cg: cg[1].distance(p)); code = near[0]
            unplaced.append({'k': k, 'n': n, 'note': f'point is {near[1].distance(p)*111:.2f} km offshore of {code}; kept at game coords'})
        tier = 1 if k in top else 2 if k in big else 3 if k in hub else 4
        cities.append({'k': k, 'n': n, 'lat': la, 'lon': ln, 't': tier, 'hub': k in hub, 'st': code, 'r': region_of(la, ln)})
    from shapely.ops import polylabel
    states = []
    for f in load(f'{TMP}/st_z7_poly.json')['features']:
        g = max(polys(shape(f['geometry'])), key=lambda p: p.area)
        lp = polylabel(g, tolerance=0.02)
        states.append({'code': f['properties']['code'], 'n': f['properties']['name'], 'lat': round(lp.y, 3), 'lon': round(lp.x, 3)})
    rep['files']['cities.json'] = write(f'{OUT}/cities.json', {'regions': G['REGN'], 'tiers': {'1': 'TOP', '2': 'BIG', '3': 'HUBS', '4': 'all'}, 'cities': cities, 'states': states})
    rep['unplaced'] = unplaced
    # hwy vs truck path check: max distance from game-smoothed routes to the z10 network
    net = unary_union(hwy_lines(G, BANDS['z10']['dd'])[0]); worst = []
    for kk, r in list(G['ROUTES'].items()):
        sm = smooth_pts(r['pts'], G['SMOOTH'])
        pts = [Point(p[1], p[0]) for p in sm[::3]]
        dmax = max(net.distance(q) for q in pts)
        lat0 = sm[0][0]; worst.append((dmax * 111000 * math.cos(math.radians(lat0)), kk))
    worst.sort(reverse=True); rep['hwy_offset_m'] = {'max': round(worst[0][0]), 'route': worst[0][1], 'p95': round(worst[len(worst)//20][0]), 'median': round(worst[len(worst)//2][0])}
    hb, hs = hillshade(); rep['hillshade'] = {'bounds': hb, 'size': hs}
    json.dump(rep, open(f'{TMP}/report.json', 'w'), indent=1)
    print(json.dumps({k: v for k, v in rep.items() if k != 'files'}, indent=1))
    tot = sum(v[0] for v in rep['files'].values()); totg = sum(v[1] for v in rep['files'].values())
    print('files', len(rep['files']), 'raw', tot, 'gz', totg)
    for k in ('base-z3.json', 'base-z7.json', 'cities.json', 'z10/index.json'): print(k, rep['files'][k])
    z = [v for k, v in rep['files'].items() if k.startswith('z10/') and k != 'z10/index.json']
    print('z10 cells', len(z), 'gz max', max(v[1] for v in z), 'gz mean', sum(v[1] for v in z) // len(z), 'gz total', sum(v[1] for v in z))

if __name__ == '__main__': main()
