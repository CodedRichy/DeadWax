// Screenshots force the compositor to present, which the SwiftShader harness
// otherwise never does -- so this is the only way to actually see the flip arc.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const p = await b.newPage({viewport:{width:900,height:620}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://localhost:8484/index.html',{waitUntil:'load'});
  await p.waitForTimeout(2200);
  await p.evaluate(()=>{
    const t=[]; for(let i=1;i<=12;i++) t.push({t:'Track '+i,sec:240,loud:.6,plays:20-i});
    SHELF.length=0; SHELF.push({artist:'Test',album:'Two Sides',art:null,tracks:t});
    renderShelf(); selectRecord(SHELF[0],0);
  });
  await p.waitForTimeout(700);
  await p.click('#bFlip');
  for(let i=0;i<6;i++){
    await p.screenshot({path:`flipf-${i}.png`});
    console.log('frame',i,'side=',await p.evaluate(()=>document.getElementById('catSide').textContent));
  }
  console.log(errs.length?'ERRORS: '+errs.join(' | '):'no page errors');
  await b.close();
})();
