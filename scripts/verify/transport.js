const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const p = await b.newPage({viewport:{width:1500,height:900}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://localhost:8484/index.html',{waitUntil:'load'});
  await p.waitForTimeout(2200);
  await p.evaluate(()=>{
    const mk=(a,al,t)=>({artist:a,album:al,art:null,tracks:t.map(([n,s,pl])=>({t:n,sec:s,loud:.6,plays:pl}))});
    SHELF.length=0; SHELF.push(mk('PARTYNEXTDOOR','P4',[['Make It',212,33],['Resentment',226,4]]));
    renderShelf(); selectRecord(SHELF[0],0);
  });
  await p.waitForTimeout(700);
  const vis = () => p.evaluate(()=>[...document.querySelectorAll('#cue button')]
    .filter(x=>getComputedStyle(x).display!=='none').map(x=>x.textContent));
  console.log('arm ON :', JSON.stringify(await vis()));
  await p.evaluate(()=>{S.arm.checked=false; S.arm.dispatchEvent(new Event('change',{bubbles:true}));});
  await p.waitForTimeout(400);
  console.log('arm OFF:', JSON.stringify(await vis()));
  console.log('version:', await p.evaluate(()=>document.getElementById('verBtn').textContent));
  console.log(errs.length?'ERRORS: '+errs.join(' | '):'no page errors');
  await b.close();
})();
