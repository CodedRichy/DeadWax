const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const p = await b.newPage({viewport:{width:1200,height:820}});
  await p.goto('http://localhost:8484/index.html',{waitUntil:'load'});
  await p.waitForTimeout(2600);
  for(const t of [58,46,36]){
    await p.evaluate(v=>{ S.tilt.value=v; sync(); S.spin.checked=false; sync(); window.__forceSpin=0; }, t);
    await p.waitForTimeout(900);
    await p.screenshot({path:`tilt-${t}.png`});
    console.log('wrote tilt-'+t+'.png');
  }
  await b.close();
})();
