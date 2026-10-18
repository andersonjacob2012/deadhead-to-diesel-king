// Offline progress / save fallback / daily contracts, headless. usage: node offline.js <branchDir> <mainDir> <port>
// mainDir = a checkout of the base (default 'auto': git merge-base HEAD origin/main) for the "offline earnings match main" comparison (omit to skip).
const {chromium}=require('playwright');const {spawn}=require('child_process');const fs=require('fs'),path=require('path');
let [dir,mainDir,port0]=process.argv.slice(2);
if(!mainDir||mainDir=='auto'){mainDir='';try{const {execSync}=require('child_process');const base=process.env.OFFLINE_BASE||execSync('git merge-base HEAD origin/main',{cwd:dir}).toString().trim();
 const t=fs.mkdtempSync(path.join(require('os').tmpdir(),'dk-base-'));execSync(`git archive ${base} | tar -x -C ${t}`,{cwd:dir,shell:'/bin/bash'});mainDir=t;console.log('comparing against base',base.slice(0,7))}catch(e){console.log('skip main comparison:',e.message.split('\n')[0])}}const port=+(port0||8780);
const FIX=JSON.parse(fs.readFileSync(path.join(__dirname,'legacy-away.json'),'utf8'));
const H=3600e3,T=new Date(2026,9,17,14,0,0).getTime();          // fixed "now": Oct 17 2026 14:00 local
const SEED=`(()=>{let a=12345;Math.random=()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}})();`;
const CLOUD=(srvOk)=>`window.DK_CONFIG={supabaseUrl:'https://x.supabase.co',supabaseAnonKey:'anon'};window.__srv=${srvOk?'true':'false'};
window.supabase={createClient(){return{auth:{getSession:()=>Promise.resolve({data:{session:{}}})},from:()=>({select:()=>({maybeSingle:()=>Promise.resolve({data:null,error:null})})}),
 rpc:(n,a)=>n=='server_now'?(window.__srv?Promise.resolve({data:new Date(window.__srvFn?window.__srvFn():(window.__srvAt||Date.now())).toISOString(),error:null}):Promise.reject(new Error('offline'))):Promise.resolve({data:{ok:true,rev:1,server_now:null},error:null})}}};`;
let fails=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)fails++};
(async()=>{const srvs=[spawn('python3',['-m','http.server',String(port),'-d',dir],{stdio:'ignore'})];if(mainDir)srvs.push(spawn('python3',['-m','http.server',String(port+1),'-d',mainDir],{stdio:'ignore'}));
await new Promise(r=>setTimeout(r,900));const b=await chromium.launch();
async function open(o){const c=await b.newContext({viewport:{width:390,height:844}});const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
 if(o.block)await p.route(/platform\/save-store\.js/,r=>r.fulfill({status:404,body:'nope'}));
 if(o.clock!==false){await p.clock.install({time:(o.time||T)-5000});await p.clock.pauseAt(o.time||T)}
 await p.addInitScript(([seed,save,meta,extra])=>{if(seed)eval(seed);if(extra)eval(extra);if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');localStorage.clear();if(save)localStorage.setItem('idletruck',save);if(meta)localStorage.setItem('dk.save.meta',meta)}},[o.seed?SEED:'',o.save?JSON.stringify(o.save):'',o.meta?JSON.stringify(o.meta):'',o.extra||'']);
 await p.goto(`http://127.0.0.1:${o.port||port}/index.html`,{waitUntil:'load'});return{c,p,errs}}
const st=p=>p.evaluate(()=>({started:!!S.started,modal:(()=>{const m=document.getElementById('modal');return m&&m.style.display=='flex'?m.innerText.replace(/\s+/g,' ').slice(0,160):''})(),cash:S.cash,earned:S.earned,away:S.pendingAway||null,last:S.last,lastSrv:S.lastSrv||0,ct:S.ct&&{day:S.ct.day,sd:S.ct.sd,streak:S.ct.streak,sdp:S.ct.sdp||0,n:S.ct.list.length},state:DKSave.clock.state()}));

// 1) save fallback: save-store.js 404 -> shim; game loads, saves, reloads
{const {c,p,errs}=await open({block:true,clock:false});await p.waitForTimeout(1200);await p.click('.tgo');await p.evaluate(()=>{S.company='Shim Freight';S.cash=777777;save()});
 const be=await p.evaluate(()=>DKSave.status().backend);await p.reload({waitUntil:'load'});await p.waitForTimeout(800);const r=await p.evaluate(()=>({co:S.company,cash:Math.round(S.cash),started:!!S.started}));
 ok(be==='shim'&&r.co==='Shim Freight'&&r.cash>=777777&&r.started&&!errs.length,`fallback shim: save-store.js blocked -> backend ${be}, reload ${JSON.stringify(r)}, errors ${errs.length}`);await c.close()}

// 2) new game + old save load (fixed clock)
{const {c,p,errs}=await open({});const s=await st(p);ok(s.cash===37000&&!errs.length&&s.state==='none','new game loads: cash 37000, clock state none');await c.close()}
{const sv={...FIX,last:T-5e3};const {c,p,errs}=await open({save:sv});const s=await st(p);ok(Math.round(s.cash)===Math.round(FIX.cash)&&!errs.length,`old save loads unchanged (cash ${Math.round(s.cash)})`);await c.close()}

// 3) 1 hour away: identical payout to main (seeded RNG, fixed clock)
{const sv={...FIX,last:T-H};const A=await open({save:sv,seed:true});const a=await st(A.p);
 ok(a.away&&a.away.g>0&&a.away.min===60,`1h away pays (branch +$${a.away&&a.away.g}, ${a.away&&a.away.min} min)`);
 if(mainDir){const B=await open({save:sv,seed:true,port:port+1});const m=await B.p.evaluate(()=>({cash:S.cash,away:S.pendingAway||null}));
  ok(Math.abs(a.cash-m.cash)<1e-6&&JSON.stringify(a.away)===JSON.stringify(m.away),`1h away matches main exactly (branch ${a.cash.toFixed(2)} vs main ${m.cash.toFixed(2)})`);await B.c.close()}
 await A.c.close()}
{const sv={...FIX,last:T-30*H};const A=await open({save:sv,seed:true});const a=await st(A.p);ok(a.away&&a.away.min===480,`30h away capped at 8h (${a.away&&a.away.min} min)`);await A.c.close()}

// 4) clock rollback: device clock 3h behind the last save / high-water mark -> no payout, no crash, S.last not rewound
{const sv={...FIX,last:T+3*H};const {c,p,errs}=await open({save:sv,meta:{device:'x',maxNow:T+3*H}});const s=await st(p);
 await p.evaluate(()=>save());const last2=await p.evaluate(()=>S.last);
 ok(!s.away&&Math.round(s.cash)===Math.round(FIX.cash)&&!errs.length,'rollback: no payout, no errors');ok(last2===T+3*H,'rollback: S.last not rewound on save');
 await p.evaluate(()=>save());await c.close()}
{const sv={...FIX,last:T+3*H};const {c,p,errs}=await open({save:sv});const s=await st(p);ok(!s.away&&!errs.length,'clock behind S.last without meta (negative elapsed): clamped to 0');await c.close()}

// 5) daily contracts across local midnight + streak rules
const midT=new Date(2026,9,17,23,59,30).getTime();
{const {c,p,errs}=await open({time:midT});const d0=await p.evaluate(()=>({day:S.ct.day,list:S.ct.list.map(x=>x.id).join()}));
 await p.clock.runFor(60e3);const d1=await p.evaluate(()=>({day:S.ct.day,list:S.ct.list.map(x=>x.id).join()}));
 ok(d0.day===20261017&&d1.day===20261018&&d0.list!==d1.list&&!errs.length,`contracts roll at local midnight (${d0.day} -> ${d1.day}, new list)`);
 // streak +1 on the next day
 const r=await p.evaluate(()=>{S.ct.sd=dayNum()-1;S.ct.streak=3;const x=S.ct.list[0];x.p=x.n;ctClaim(x.id);return{streak:S.ct.streak,sd:S.ct.sd==dayNum()}});
 ok(r.streak===4&&r.sd,'claim on the next day: streak 3 -> 4');await c.close()}
{const sv={...FIX,last:T-60e3,ct:{...(FIX.ct||{}),day:20261014,sd:0,streak:5,list:[],ms:{},msc:{}}};sv.ct.sd=Math.round(new Date(2026,9,14).getTime()/864e5);
 const {c,p}=await open({save:sv});const s=await st(p);ok(s.ct.streak===0,`no server configured: 3-day gap breaks the streak at load, as today (streak ${s.ct.streak})`);await c.close()}
{const sv={...FIX,last:T-60e3,ct:{...(FIX.ct||{}),day:20261014,streak:5,list:[],ms:{},msc:{}}};sv.ct.sd=Math.round(new Date(2026,9,14).getTime()/864e5);
 const {c,p,errs}=await open({save:sv,extra:CLOUD(false)});const s=await st(p);
 ok(s.state==='unverified'&&s.ct.streak===5,`server configured but unreachable: gap does NOT break the streak (state ${s.state}, streak ${s.ct.streak})`);
 const r=await p.evaluate(()=>{const x=S.ct.list[0];x.p=x.n;ctClaim(x.id);return{streak:S.ct.streak,sdp:S.ct.sdp||0}});
 ok(r.streak===5&&r.sdp>0,'unreachable: claim beyond +1 day is deferred (no streak day awarded)');
 const v=await p.evaluate(()=>{DKSave.clock._anchor(Date.now());return{streak:S.ct.streak,sdp:S.ct.sdp||0,sd:S.ct.sd==dayNum()}});
 ok(v.streak===1&&!v.sdp&&v.sd&&!errs.length,`server reached: deferred claim settles as a new streak (gap was real): streak ${v.streak}`);await c.close()}
{const sv={...FIX,last:T-60e3,ct:{...(FIX.ct||{}),day:20261016,streak:5,list:[],ms:{},msc:{}}};sv.ct.sd=Math.round(new Date(2026,9,16).getTime()/864e5);
 const {c,p}=await open({save:sv,extra:CLOUD(false)});const r=await p.evaluate(()=>{const x=S.ct.list[0];x.p=x.n;ctClaim(x.id);return S.ct.streak});
 ok(r===6,`unreachable: +1 day still awards the streak day (5 -> ${r})`);await c.close()}

// 6) server time top-up into the "while you were away" popup (device clock wrong/behind; server says 3h passed)
{const sv={...FIX,last:T+H,lastSrv:T+H-1000};const srvAt=T+4*H;   // device clock T is 1h BEHIND the last save; server says 3h after it
 const {c,p,errs}=await open({save:sv,seed:true,extra:CLOUD(true)+`window.__srvAt=${srvAt};`});await p.waitForTimeout(50);
 const s=await st(p);const pm=s.away?s.away.min:+((s.modal.match(/(\d+)\s*min/)||s.modal.match(/(\d+)h/)||[])[1]||0); const tt=await p.evaluate(()=>document.getElementById('toast').textContent);
 ok(s.state==='verified'&&s.started&&!s.modal&&/verified away earnings/.test(tt)&&!errs.length,`boot server top-up after the game started -> toast, no second popup ("${tt}")`);
 ok(Math.abs(s.lastSrv-srvAt)<5e3,'lastSrv stored from server time');await c.close()}
{const sv={...FIX,last:T-2*H,lastSrv:T-2*H};const {c,p}=await open({save:sv,seed:true,extra:CLOUD(true)+`window.__srvAt=${T-H};`});await p.waitForTimeout(50);
 const s=await st(p);ok(s.away&&s.away.min===120,`device clock AHEAD of server (paid 2h, server says 1h): no clawback, popup stays ${s.away&&s.away.min} min`);await c.close()}


// 7) resume offline progress (visibilitychange), frozen clock + held rAF
const VIS=`(()=>{let v='visible';Object.defineProperty(Document.prototype,'visibilityState',{get:()=>v,configurable:true});Object.defineProperty(Document.prototype,'hidden',{get:()=>v=='hidden',configurable:true});
 window.__vis=x=>{v=x;document.dispatchEvent(new Event('visibilitychange',{bubbles:true}))};
 const raf=window.requestAnimationFrame.bind(window);window.__q=[];window.__hold=false;
 window.requestAnimationFrame=cb=>{if(window.__hold){window.__q.push(cb);return 0}return raf(cb)};window.__step=()=>window.__q.splice(0).forEach(cb=>raf(cb))})();`;
async function game(o={}){const r=await open({save:{...FIX,last:T-5e3},seed:true,...o,extra:VIS+(o.extra||'')});await r.p.clock.runFor(500);   // a few real frames
 await r.p.evaluate(()=>{window.__hold=true});await r.p.clock.runFor(100);return r}
const R=p=>p.evaluate(()=>({r:OFFR.r,cash:S.cash,pend:S.pendingAway||null,toast:document.getElementById('toast').style.display=='block'?document.getElementById('toast').textContent:'',modal:document.getElementById('modal').style.display=='flex'?document.getElementById('modal').innerText.replace(/\s+/g,' ').slice(0,80):'',lastTick:OFFR.t,now:Date.now()}));
async function hide(p,ms,ff=true){await p.evaluate(()=>{window.__q.length||0;__vis('hidden')});if(ff)await p.clock.fastForward(ms)}
async function show(p){await p.evaluate(()=>__vis('visible'));await p.clock.runFor(50)}
const mins=r=>r&&r.r?Math.round(r.r.s/60):0;
{const {c,p,errs}=await game();const b0=await R(p);
 // short hide (< 30s): nothing
 await hide(p,20e3);const saved=await p.evaluate(()=>JSON.parse(localStorage.getItem('idletruck')).last);await show(p);let r=await R(p);
 ok(!r.r&&r.cash===b0.cash&&!/away/.test(r.toast),'resume: 20s hide pays nothing');
 ok(Math.abs(saved-(b0.now+100))<2e3,'existing visibilitychange save still runs on hide (S.last stamped at hide)');
 // long hide, loop fully suspended: pays the whole gap since the last tick; < 15 min -> toast
 await hide(p,10*60e3);await show(p);r=await R(p);
 ok(r.r&&Math.abs(r.r.s-(10*60+20.1))<3&&r.cash>b0.cash&&/while away \(10 min\)/.test(r.toast)&&!r.modal,`resume: 10 min suspended -> pays ${r.r&&r.r.s.toFixed(0)}s since last tick, toast "${r.toast}"`);
 // rapid hide/show (no frame in between): second resume pays only its own hide, not again since the old tick
 const c1=r.cash;await hide(p,40e3);await show(p);r=await R(p);const s2=r.r.s;await hide(p,40e3);await show(p);r=await R(p);
 ok(Math.abs(s2-40)<2&&Math.abs(r.r.s-40)<2,`rapid hide/show: 40s + 40s paid separately (${s2.toFixed(0)}s, ${r.r.s.toFixed(0)}s), no double count`);
 // throttled loop: kept ticking 1 frame/s for 2 min while hidden, then suspended 5 min -> pays only the 5 min remainder
 await hide(p,0,false);for(let i=0;i<120;i++){await p.clock.fastForward(1000);await p.evaluate(()=>__step());await p.clock.runFor(20)}
 const tk=await R(p);await p.clock.fastForward(5*60e3);await show(p);r=await R(p);
 ok(Math.abs(r.r.s-(5*60+0.05))<3&&Math.abs(tk.now-tk.lastTick)<100,`throttled-then-suspended: pays only since the last tick (${r.r.s.toFixed(0)}s of ~420s hidden)`);
 // big gap -> 'While you were away' popup; 30h -> capped at 8h
 await hide(p,30*3600e3);await show(p);r=await R(p);
 ok(Math.round(r.r.s)===8*3600&&/While you were away/.test(r.modal)&&/8\.0 h/.test(r.modal),`30h hide -> capped at 8h, shown in the popup (${r.modal.slice(0,50)})`);
 // clock rolled back while hidden: nothing paid, no crash
 await p.evaluate(()=>document.getElementById('modal').style.display='none');const c2=(await R(p)).cash;
 await hide(p,0,false);await p.clock.setSystemTime((await p.evaluate(()=>Date.now()))-3*3600e3);await p.clock.fastForward(60e3);await show(p);r=await R(p);
 ok(Math.abs(r.cash-c2)<1e-6&&!r.modal,`clock set back 3h while hidden: no payout (cash unchanged: ${Math.abs(r.cash-c2)<1e-6})`);
 // loop resumes normally after all this
 await p.evaluate(()=>{window.__hold=false;__step()});await p.clock.runFor(2000);const t2=await R(p);
 ok(!errs.length&&Math.abs(t2.now-t2.lastTick)<100,`no page errors (${errs.length}); loop ticking again`);await c.close()}
// PR #4: the resume grant waits while the Hot list is held (finger down), and its toast is low priority
{const {c,p,errs}=await game();await p.evaluate(()=>{OFFR.r=null});
 await hide(p,5*60e3);await p.evaluate(()=>{HOLD.down=1;HOLD.t=performance.now();HOLD.s=0});const c0=(await R(p)).cash;   // finger lands as the app comes back
await show(p);await p.clock.runFor(1000);let r=await R(p);
 ok(!r.r&&r.cash===c0,'resume while the list is held: payout deferred (nothing paid yet)');
 await p.evaluate(()=>{HOLD.down=0;HOLD.up=0;HOLD.g=0;toast('🐔 Too slow — another rig already took that one',3000)});await p.clock.runFor(500);r=await R(p);
 ok(r.r&&Math.abs(r.r.s-300)<3&&r.cash>c0,`hold released: deferred payout lands once (${r.r&&r.r.s.toFixed(0)}s)`);
 ok(/Too slow/.test(r.toast),`resume toast is low priority: a Book toast already up is not replaced ("${r.toast.slice(0,30)}")`);
 await p.clock.runFor(3000);const r2=await R(p);ok(Math.abs(r2.cash-r.cash)<1e-6||r2.r===r.r,'no second payout after release');
 ok(!errs.length,'no page errors in hold/defer case');await c.close()}
// before Start (title screen): resume payout merges into the pending popup
{const {c,p}=await open({save:{...FIX,started:false,last:T-5e3},seed:true,extra:VIS});await p.clock.runFor(300);await p.evaluate(()=>{window.__hold=true});await p.clock.runFor(100);
 await hide(p,5*60e3);await show(p);const r=await R(p);ok(r.pend&&r.pend.min===5&&!r.toast.includes('away'),`resume before Start: merged into the popup shown at Start (${JSON.stringify(r.pend)})`);await c.close()}
// server verified: device clock set back while hidden -> device pays 0, server says 20 min -> toast "verified away earnings"
{const {c,p,errs}=await game({extra:CLOUD(true)+`window.__srvAt=${T};`});await p.waitForTimeout(30);
 const st0=await p.evaluate(()=>DKSave.clock.state());await p.evaluate(()=>{window.__srvAt=null;window.__srvOff=0});
 // mock: server_now = real elapsed time (perf-based) from T, independent of the device wall clock
 await p.evaluate(t=>{const p0=performance.now();window.__srvAt=undefined;window.__srvFn=()=>t+(performance.now()-p0)},await p.evaluate(()=>DKSave.clock.now()));
 await hide(p,0,false);const dnow=await p.evaluate(()=>Date.now());await p.clock.fastForward(20*60e3);await p.clock.setSystemTime(dnow);   // device wall clock "set back" to hide time
 await show(p);await p.waitForTimeout(50);await p.clock.runFor(50);const r=await R(p);
 ok(st0==='verified'&&r.r&&r.r.ver&&Math.abs(r.r.s-1200)<5&&/verified away earnings/.test(r.toast)&&!r.modal&&!errs.length,`resume server top-up: device paid 0, server 20 min -> toast "${r.toast}" (${r.r&&r.r.s.toFixed(0)}s)`);await c.close()}
await b.close();srvs.forEach(s=>s.kill());console.log(fails?`offline: ${fails} FAILED`:'offline: all passed');process.exit(fails?1:0)})();
