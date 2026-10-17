// usage: node smoke.js <dir> <port> [legacySave.json]
const {chromium}=require('playwright');const {spawn}=require('child_process');const fs=require('fs');
const [dir,port,legacy]=process.argv.slice(2);
(async()=>{const srv=spawn('python3',['-m','http.server',port,'-d',dir],{stdio:'ignore'});await new Promise(r=>setTimeout(r,800));
const url=`http://127.0.0.1:${port}/index.html`;const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:390,height:844}});const p=await ctx.newPage();
const errs=[];p.on('pageerror',e=>errs.push('pageerror: '+e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errs.push('console: '+m.text())});
const out={};try{
if(legacy){await p.addInitScript(s=>{if(!sessionStorage.getItem('seeded')){sessionStorage.setItem('seeded','1');localStorage.clear();localStorage.setItem('idletruck',s)}},fs.readFileSync(legacy,'utf8'));}
await p.goto(url,{waitUntil:'load'});await p.waitForTimeout(1500);
out.leaflet=await p.evaluate(()=>typeof L);
if(!legacy){await p.click('.tgo');}else{await p.click('.tgo').catch(()=>{});}
await p.waitForTimeout(5000);
out.after=await p.evaluate(()=>{const s=localStorage.getItem('idletruck');const j=s&&JSON.parse(s);return{bytes:s&&s.length,company:j&&j.company,cash:j&&Math.round(j.cash),trucks:j&&j.trucks.length,v:j&&j.v,keys:Object.keys(localStorage),meta:localStorage.getItem('dk.save.meta'),api:typeof window.DKSave,status:window.DKSave&&DKSave.status&&DKSave.status()}});
fs.writeFileSync(require('path').join(require('os').tmpdir(),'dk-save-'+port+'.json'),await p.evaluate(()=>localStorage.getItem('idletruck')));
await p.reload({waitUntil:'load'});await p.waitForTimeout(2000);
out.reload=await p.evaluate(()=>({company:S.company,cash:Math.round(S.cash),started:!!S.started,trucks:S.trucks.length}));
}catch(e){errs.push('test: '+e.message)}
out.errors=errs;console.log(JSON.stringify(out,null,1));await b.close();srv.kill();process.exit(errs.length?1:0)})();
