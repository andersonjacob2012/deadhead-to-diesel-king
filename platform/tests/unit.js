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
