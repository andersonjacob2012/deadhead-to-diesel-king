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
 rpc:(n,a)=>n=='server_now'?(window.__srv?Promise.resolve({data:new Date(window.__srvAt||Date.now()).toISOString(),error:null}):Promise.reject(new Error('offline'))):Promise.resolve({data:{ok:true,rev:1,server_now:null},error:null})}}};`;
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
 const s=await st(p);const pm=s.away?s.away.min:+((s.modal.match(/(\d+)\s*min/)||s.modal.match(/(\d+)h/)||[])[1]||0);console.log('     popup/pending:',JSON.stringify(s.away),s.modal);
 ok(s.state==='verified'&&(s.away?(s.away.min>=179&&s.away.min<=181):/While you were away/i.test(s.modal))&&!errs.length,`server top-up: device paid 0, verified 3h -> 'While you were away' (${s.started?'shown now, game already started':'merged into pending popup'})`);
 ok(Math.abs(s.lastSrv-srvAt)<5e3,'lastSrv stored from server time');await c.close()}
{const sv={...FIX,last:T-2*H,lastSrv:T-2*H};const {c,p}=await open({save:sv,seed:true,extra:CLOUD(true)+`window.__srvAt=${T-H};`});await p.waitForTimeout(50);
 const s=await st(p);ok(s.away&&s.away.min===120,`device clock AHEAD of server (paid 2h, server says 1h): no clawback, popup stays ${s.away&&s.away.min} min`);await c.close()}

await b.close();srvs.forEach(s=>s.kill());console.log(fails?`offline: ${fails} FAILED`:'offline: all passed');process.exit(fails?1:0)})();
