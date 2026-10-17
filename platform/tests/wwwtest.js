// Serves www/ and BLOCKS unpkg.com to prove Leaflet is vendored; tiles (arcgis) are still remote by design.
const {chromium}=require('playwright');const {spawn}=require('child_process');
(async()=>{const srv=spawn('python3',['-m','http.server','8718','-d',require('path').join(__dirname,'../../www')],{stdio:'ignore'});await new Promise(r=>setTimeout(r,800));
const b=await chromium.launch();const p=await b.newPage();const errs=[],cdn=[];p.on('pageerror',e=>errs.push(e.message));
await p.route(/unpkg\.com/,r=>{cdn.push(r.request().url());r.abort()});
await p.goto('http://127.0.0.1:8718/index.html');await p.waitForTimeout(1500);await p.click('.tgo');await p.waitForTimeout(3000);
const r=await p.evaluate(()=>({L:typeof L,ver:L&&L.version,started:S.started,saved:!!localStorage.getItem('idletruck'),dk:DKSave.status().cloud,rigs:document.querySelectorAll('.dk-rig').length}));
console.log(JSON.stringify({r,cdnBlocked:cdn,errs}));await b.close();srv.kill()})();
