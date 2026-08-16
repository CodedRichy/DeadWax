const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const p = await b.newPage({viewport:{width:1200,height:900}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://localhost:8484/index.html',{waitUntil:'load'});
  await p.waitForTimeout(2200);
  await p.evaluate(()=>{
    const t=[]; for(let i=1;i<=12;i++) t.push({t:'Track '+i,sec:240,loud:.6,plays:20-i});
    SHELF.length=0; SHELF.push({artist:'Test',album:'Two Sides',art:null,tracks:t});
    renderShelf();
    S.tilt.value=4; sync();          // look straight down at the label
    S.spin.checked=false; sync();
    window.__forceSpin=0;
  });
  for(const side of [0,1]){
    await p.evaluate(s=>{ selectRecord(SHELF[0], s); window.__forceSpin=0; }, side);
    await p.waitForTimeout(900);
    await p.screenshot({path:`side-${side?'B':'A'}.png`, clip:{x:430,y:320,width:340,height:280}});
    console.log('side', side?'B':'A', 'catSide=', await p.evaluate(()=>document.getElementById('catSide').textContent));
  }
  console.log(errs.length?'ERRORS: '+errs.join(' | '):'no page errors');
  await b.close();
})();
