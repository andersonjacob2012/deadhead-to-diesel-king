# One-time offline build: fetch highway routes from the public OSRM demo (<=1 req/s), simplify, write ../routes.js
import json,time,urllib.request,itertools,math
from cities import C,pairs
def dp(pts,eps):
  if len(pts)<3:return pts
  a,b=pts[0],pts[-1];dx,dy=b[0]-a[0],b[1]-a[1];L=math.hypot(dx,dy) or 1e-9;mi,md=0,0
  for i,p in enumerate(pts[1:-1],1):
    d=abs(dy*(p[0]-a[0])-dx*(p[1]-a[1]))/L
    if d>md:mi,md=i,d
  return dp(pts[:mi+1],eps)[:-1]+dp(pts[mi:],eps) if md>eps else [a,b]
import os
CACHE='/tmp/osrm_cache.json'
out=json.load(open(CACHE)) if os.path.exists(CACHE) else {}
import sys
for a,b in ([] if 'gen' in sys.argv else pairs()):
 try:
    if a+'-'+b in out or b+'-'+a in out:continue
    u=f"https://router.project-osrm.org/route/v1/driving/{C[a][1]},{C[a][0]};{C[b][1]},{C[b][0]}?overview=full&geometries=geojson&steps=true"
    r=json.load(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'DeadheadToDieselKing-build/1.0'}),timeout=60))['routes'][0]
    refs={}
    for s in r['legs'][0]['steps']:
      for ref in (s.get('ref') or '').split(';'):
        ref=ref.strip()
        if ref.startswith('I '):refs[ref]=refs.get(ref,0)+s['distance']
    top=[k.replace(' ','-') for k,v in sorted(refs.items(),key=lambda x:-x[1]) if v>80000][:4]
    pts=[[round(y,2),round(x,2)] for x,y in dp(r['geometry']['coordinates'],0.03)]
    out[a+'-'+b]={'mi':round(r['distance']/1609.34),'via':top,'pts':pts}
    print(a,b,out[a+'-'+b]['mi'],top,len(pts),flush=True);json.dump(out,open(CACHE,'w'));time.sleep(1.2)
 except Exception as e:print('ERR',a,b,e,flush=True);time.sleep(5)
OLD=list(C)[:12]
keep={a+'-'+b for a,b in pairs()}|{a+'-'+b for a,b in itertools.combinations(OLD,2)}
res={}
for k,v in out.items():
  a,b=k.split('-');kk=k if k in keep else b+'-'+a
  if kk not in keep:continue
  pts=[[round(p[0],2),round(p[1],2)] for p in dp(v['pts'],0.03)]
  res[kk]={'mi':v['mi'],'via':v['via'],'pts':pts}
open('../routes.js','w').write('// Generated once by tools/build_routes.py from OSRM (c) OpenStreetMap contributors (ODbL)\nconst CITY_LL='+json.dumps({k:[v[0],v[1],v[2]] for k,v in C.items()},separators=(',',':'))+';\nconst HUBS='+json.dumps([k for k,v in C.items() if v[3]])+';\nconst ROUTES='+json.dumps(res,separators=(',',':'))+';\n')
print(len(C),'cities',len(res),'lanes')
