const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const p = await b.newPage({viewport:{width:1600,height:900}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://localhost:8484/index.html',{waitUntil:'load'});
  await p.waitForTimeout(2200);
  await p.evaluate(()=>{
    const t=[['Dive In',208,141],['Texas Is Forever',236,96],['Floral & Fading',251,41],
             ['Phantom Power',224,22],['Circles',262,9]];
    SHELF.length=0;
    SHELF.push({artist:'Pierce The Veil',album:'Misadventures',art:null,
      tracks:t.map(([n,s,pl])=>({t:n,sec:s,loud:.6,plays:pl}))});
    renderShelf(); selectRecord(SHELF[0],0);
  });
  await p.waitForTimeout(900);
  await p.screenshot({path:'look-main.png'});
  // framed player state
  await p.evaluate(()=>{ document.body.classList.add('yton');
    document.getElementById('ytMsg').textContent='pierce the veil · misadventures'; });
  await p.waitForTimeout(400);
  await p.screenshot({path:'look-yt.png', clip:{x:1150,y:520,width:440,height:370}});
  console.log(errs.length?'ERRORS: '+errs.join(' | '):'no page errors');
  await b.close();
})();
