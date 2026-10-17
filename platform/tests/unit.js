const fs=require('fs'),vm=require('vm'),assert=require('assert');
function env(store={}){const ls={getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>{delete store[k]}};
 const w={localStorage:ls,addEventListener(){},console,setTimeout,location:{reload(){}}};w.window=w;vm.createContext(w);vm.runInContext(fs.readFileSync(process.argv[2],'utf8'),w);return{w,store}}
const {w}=env();const R=w.DKSave.resolve;
assert.equal(R({rev:0,baseRev:0,dirty:false},null),'none');
assert.equal(R({rev:3,baseRev:0,dirty:true},null),'push');
assert.equal(R({baseRev:5,dirty:true},{rev:5}),'push');
assert.equal(R({baseRev:5,dirty:false},{rev:5}),'none');
assert.equal(R({baseRev:5,dirty:false},{rev:7}),'pull');
assert.equal(R({baseRev:5,dirty:true},{rev:7}),'conflict');
assert.equal(R({baseRev:9,dirty:false},{rev:7}),'push');
// legacy passthrough: existing 'idletruck' string is returned byte-identical, and write keeps format
const legacy=fs.readFileSync(__dirname+'/legacy-v4.json','utf8');const e2=env({idletruck:legacy});assert.equal(e2.w.DKSave.read(),legacy);
const S=JSON.parse(legacy);e2.w.DKSave.write(S);assert.deepEqual(JSON.parse(e2.store.idletruck),S);const m=JSON.parse(e2.store['dk.save.meta']);assert.equal(m.rev,1);assert.equal(m.dirty,true);
// clock rollback: meta.maxNow in the future by 1h -> rollback flagged on boot
const e3=env({'dk.save.meta':JSON.stringify({maxNow:Date.now()+3600e3,device:'x'})});e3.w.DKSave.write({a:1});assert.equal(e3.w.DKSave.status().rollback,1);
// inert cloud
assert.equal(w.DKSave.status().cloud,'inert');w.DKSave.sync().then(r=>{assert.equal(r.action,'inert');console.log('unit: all passed')});
// ---- trusted clock (offline progress) ----
{const H=3600e3,CAP=8*3600;
 // no cloud: state none, firm, device clock, 8h cap, negative -> 0
 const e=env();const C=e.w.DKSave.clock;assert.equal(C.state(),'none');assert.equal(C.firm(),true);assert.equal(C.verified(),false);
 let a=C.away(Date.now()-5*H,CAP);assert.equal(a.source,'device');assert.equal(Math.round(a.secs),5*3600);
 a=C.away(Date.now()-30*H,CAP);assert.equal(Math.round(a.secs),CAP);                           // 8h cap kept on client time
 a=C.away(Date.now()+2*H,CAP);assert.equal(a.secs,0);assert.equal(a.reason,'negative');         // clock behind S.last -> 0
 const S={last:Date.now()-H};assert.ok(Math.abs(C.stamp(S)-Date.now())<50);assert.equal(S.lastSrv,undefined); // no server: no lastSrv
 // rollback (device clock > 5 min behind the high-water mark): no payout, S.last never rewinds
 const r=env({'dk.save.meta':JSON.stringify({maxNow:Date.now()+3*H,device:'x'})});const RC=r.w.DKSave.clock;
 assert.equal(RC.rollback(),true);assert.equal(RC.away(Date.now()-5*H,CAP).secs,0);assert.equal(RC.away(Date.now()-5*H,CAP).reason,'clock_rollback');
 const S2={last:Date.now()+3*H};assert.equal(RC.stamp(S2),S2.last);
 // far rollback (> 7 days): accepted as the new clock, not frozen
 const f=env({'dk.save.meta':JSON.stringify({maxNow:Date.now()+10*24*H,device:'x'})});assert.equal(f.w.DKSave.clock.rollback(),false);
 // configurable stricter device cap (for when accounts/IAP ship)
 const g={};const ls={getItem:k=>k in g?g[k]:null,setItem:(k,v)=>{g[k]=String(v)},removeItem:k=>{delete g[k]}};
 const w={localStorage:ls,addEventListener(){},console,setTimeout,location:{reload(){}},DK_CONFIG:{offlineDeviceCapH:2}};w.window=w;vm.createContext(w);vm.runInContext(fs.readFileSync(process.argv[2],'utf8'),w);
 assert.equal(Math.round(w.DKSave.clock.away(Date.now()-5*H,CAP).secs),2*3600);
 // anchoring: verified, now() follows server time, onVerify fires once with server now, stamp sets lastSrv
 let got=[];C.onVerify(t=>got.push(t));const srv=Date.now()+90e3;C._anchor(srv);C._anchor(srv+1);
 assert.equal(got.length,1);assert.ok(Math.abs(got[0]-srv)<5);assert.equal(C.verified(),true);assert.ok(Math.abs(C.now()-srv)<200);
 assert.ok(Math.abs(C.at(Date.now())-srv)<200);assert.equal(C.at(5000)-C.at(4000),1000);assert.equal(e.w.DKSave.clock.at&&env().w.DKSave.clock.at(1),0);  // at(): server ms at a perf instant; 0 unverified
 const S3={last:0};C.stamp(S3);assert.ok(Math.abs(S3.lastSrv-srv)<200);
 let late=0;C.onVerify(()=>late++);assert.equal(late,1);                                        // late subscriber called immediately
 console.log('clock: all passed')}
