# Denser road geometry for the existing lanes (keeps each lane's mi/via so the economy is unchanged): refetch the full OSRM
# geometry (public demo, <=1 req/s), simplify with a tighter Douglas-Peucker tolerance, keep 3 decimals, pin the city ends,
# and rewrite ../routes.js.  python3 densify_routes.py [eps_deg=0.008]   (cache: /tmp/osrm_full.json, resumable)
import json,time,urllib.request,os,sys,math
sys.setrecursionlimit(100000)
def dp(pts,eps):
  if len(pts)<3:return pts
  a,b=pts[0],pts[-1];dx,dy=b[0]-a[0],b[1]-a[1];L=math.hypot(dx,dy) or 1e-9;mi,md=0,0
  for i,p in enumerate(pts[1:-1],1):
    d=abs(dy*(p[0]-a[0])-dx*(p[1]-a[1]))/L
    if d>md:mi,md=i,d
  return dp(pts[:mi+1],eps)[:-1]+dp(pts[mi:],eps) if md>eps else [a,b]
EPS=float(sys.argv[1]) if len(sys.argv)>1 else 0.008
src=open('../routes.js').read();head=src[:src.find('const ROUTES=')];R=json.loads(src[src.find('const ROUTES=')+13:].strip().rstrip(';'))
CACHE='/tmp/osrm_full.json';cache=json.load(open(CACHE)) if os.path.exists(CACHE) else {}
for k,v in R.items():
  if k in cache:continue
  a,b=v['pts'][0],v['pts'][-1]
  for tr in range(4):
    try:
      u=f"https://router.project-osrm.org/route/v1/driving/{a[1]},{a[0]};{b[1]},{b[0]}?overview=full&geometries=geojson"
      g=json.load(urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'DeadheadToDieselKing-build/1.0'}),timeout=60))['routes'][0]['geometry']['coordinates']
      cache[k]=[[round(y,4),round(x,4)] for x,y in dp(g,0.001)];print(k,len(g),len(cache[k]),flush=True);break
    except Exception as e:print('ERR',k,e,flush=True);time.sleep(5*(tr+1))
  json.dump(cache,open(CACHE,'w'));time.sleep(1.1)
n=0
for k,v in R.items():
  if k not in cache:continue
  p=[[round(q[0],3),round(q[1],3)] for q in dp(cache[k],EPS)];p[0]=v['pts'][0];p[-1]=v['pts'][-1];v['pts']=p;n+=1
open('../routes.js','w').write(head+'const ROUTES='+json.dumps(R,separators=(',',':'))+';\n')
print(n,'of',len(R),'lanes densified, eps',EPS,'pts',sum(len(v['pts']) for v in R.values()),'bytes',os.path.getsize('../routes.js'))
