# One-time offline build: fetch highway routes from the public OSRM demo (<=1 req/s), simplify, write ../routes.js
import json,time,urllib.request,itertools,math
C={'SEA':(47.61,-122.33,'Seattle'),'LA':(34.05,-118.24,'Los Angeles'),'PHX':(33.45,-112.07,'Phoenix'),'DEN':(39.74,-104.99,'Denver'),
'DAL':(32.78,-96.80,'Dallas'),'HOU':(29.76,-95.37,'Houston'),'KC':(39.10,-94.58,'Kansas City'),'MEM':(35.15,-90.05,'Memphis'),
'CHI':(41.88,-87.63,'Chicago'),'IND':(39.77,-86.16,'Indianapolis'),'ATL':(33.75,-84.39,'Atlanta'),'NYC':(40.71,-74.01,'New York')}
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
for a,b in itertools.combinations(C,2):
  if a+'-'+b in out:continue
  u=f"https://router.project-osrm.org/route/v1/driving/{C[a][1]},{C[a][0]};{C[b][1]},{C[b][0]}?overview=full&geometries=geojson&steps=true"
  r=json.load(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'DeadheadToDieselKing-build/1.0'}),timeout=60))['routes'][0]
  refs={}
  for s in r['legs'][0]['steps']:
    for ref in (s.get('ref') or '').split(';'):
      ref=ref.strip()
      if ref.startswith('I '):refs[ref]=refs.get(ref,0)+s['distance']
  top=[k.replace(' ','-') for k,v in sorted(refs.items(),key=lambda x:-x[1]) if v>80000][:4]
  pts=[[round(y,3),round(x,3)] for x,y in dp(r['geometry']['coordinates'],0.015)]
  out[a+'-'+b]={'mi':round(r['distance']/1609.34),'via':top,'pts':pts}
  print(a,b,out[a+'-'+b]['mi'],top,len(pts),flush=True);json.dump(out,open(CACHE,'w'));time.sleep(1.1)
open('../routes.js','w').write('// Generated once by tools/build_routes.py from OSRM (c) OpenStreetMap contributors (ODbL)\nconst CITY_LL='+json.dumps({k:[v[0],v[1],v[2]] for k,v in C.items()})+';\nconst ROUTES='+json.dumps(out,separators=(',',':'))+';\n')
