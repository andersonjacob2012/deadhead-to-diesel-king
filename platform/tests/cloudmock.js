// Two "devices" (separate browser contexts) share one fake Supabase row held in node.
const {chromium}=require('playwright');const {spawn}=require('child_process');
const [dir,port]=process.argv.slice(2);let ROW=null;const log=[];
const MOCK=`window.DK_CONFIG={supabaseUrl:'https://example.supabase.co',supabaseAnonKey:'anon-test'};
window.supabase={createClient(){const q=()=>({select:()=>({maybeSingle:()=>window.__get().then(r=>({data:r,error:null}))})});
 return{auth:{getSession:()=>Promise.resolve({data:{session:null}}),signInAnonymously:()=>Promise.resolve({data:{session:{user:{id:'u1'}}},error:null})},from:q,
 rpc:(n,a)=>window.__put(a).then(r=>({data:r,error:null}))}}};`;
(async()=>{const srv=spawn('python3',['-m','http.server',port,'-d',dir],{stdio:'ignore'});await new Promise(r=>setTimeout(r,800));
const b=await chromium.launch();const url=`http://127.0.0.1:${port}/index.html`;const out={};
async function device(name){const c=await b.newContext();await c.exposeFunction('__get',()=>ROW&&{rev:ROW.rev,data:ROW.data,client_saved_at:ROW.client_saved_at,updated_at:ROW.updated_at});
 await c.exposeFunction('__put',a=>{const cur=ROW?ROW.rev:0;if(a.p_base_rev!==cur){log.push(name+' put rejected base '+a.p_base_rev+' cur '+cur);return{ok:false,rev:cur}}ROW={rev:cur+1,data:a.p_data,client_saved_at:a.p_client_saved_at,updated_at:new Date().toISOString()};log.push(name+' put ok rev '+ROW.rev);return{ok:true,rev:ROW.rev,flags:[]}});
 await c.addInitScript(MOCK);const p=await c.newPage();p.on('pageerror',e=>log.push(name+' pageerror '+e.message));return p}
const A=await device('A');await A.goto(url);await A.waitForTimeout(2500);await A.click('.tgo');await A.waitForTimeout(500);
await A.evaluate(()=>{S.company='Cloud Co';S.cash=555555;S.earned=1000;save()});out.A1=await A.evaluate(()=>DKSave.sync());
const B=await device('B');await B.goto(url);await B.waitForTimeout(5000); // boot sync should auto-adopt cloud (fresh device) and reload
out.B_after_boot=await B.evaluate(()=>({company:S.company,cash:Math.round(S.cash),st:DKSave.status()}));
// both devices diverge -> conflict, resolved by handler
await B.evaluate(()=>{S.cash+=1;save()});out.B_push=await B.evaluate(()=>DKSave.sync());
await A.evaluate(()=>{S.cash=1;save()});out.A_conflict_noHandler=await A.evaluate(()=>DKSave.sync());
await A.evaluate(()=>{DKSave.onConflict=x=>{window.__seen=x;return 'local'}});out.A_conflict_keepLocal=await A.evaluate(()=>DKSave.sync());
out.A_seen=await A.evaluate(()=>window.__seen);out.remote_cash=Math.round(ROW.data.cash);out.log=log;
console.log(JSON.stringify(out,null,1));await b.close();srv.kill()})();
