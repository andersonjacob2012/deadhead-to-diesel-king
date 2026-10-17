// Reset save must really reset (pagehide save during reload must not resurrect the old run).
const {chromium}=require('playwright');const {spawn}=require('child_process');
const [dir,port]=process.argv.slice(2);
(async()=>{const srv=spawn('python3',['-m','http.server',port,'-d',dir],{stdio:'ignore'});await new Promise(r=>setTimeout(r,800));
const b=await chromium.launch();const p=await b.newPage();const url=`http://127.0.0.1:${port}/index.html`;
await p.goto(url);await p.waitForTimeout(1000);await p.click('.tgo');await p.waitForTimeout(1500);
await p.evaluate(()=>{S.cash=123456;save()});p.on('dialog',d=>d.accept());
await p.evaluate(()=>settings());await p.click('text=Reset save');await p.waitForLoadState('load');await p.waitForTimeout(1500);
const r=await p.evaluate(()=>({cash:Math.round(S.cash),started:!!S.started,meta:!!localStorage.getItem('dk.save.meta')}));console.log('reset',JSON.stringify(r));await b.close();srv.kill();if(r.cash===123456||r.started){console.error('RESET FAILED');process.exit(1)}})();
