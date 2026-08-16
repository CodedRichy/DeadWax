// Look at the demo pressing (341 -> 0 plays) at a fixed, non-spinning angle so
// the per-track differential is judged on the wear term, not on wherever the
// softbox streak happens to be this frame.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const p = await b.newPage({viewport:{width:1400,height:1000}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://localhost:8484/index.html',{waitUntil:'load'});
  await p.waitForTimeout(2400);
  // flatten the view so every band is readable at once
  await p.evaluate(()=>{ const t=document.getElementById('sTilt');
    t.value=8; t.dispatchEvent(new Event('input')); });
  await p.waitForTimeout(900);
  await p.screenshot({path:'wear-look.png'});
  console.log(errs.length?'ERRORS: '+errs.join(' | '):'no page errors');
  await b.close();
})();
