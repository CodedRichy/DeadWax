const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:1600,height:960}, deviceScaleFactor:2 });
  await p.goto('http://127.0.0.1:8484/', { waitUntil:'networkidle' });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: process.argv[2]+'/nav-now.png', clip:{x:600,y:20,width:520,height:120} });
  await p.click('#navCrate'); await p.waitForTimeout(1600);
  await p.screenshot({ path: process.argv[2]+'/nav-crate.png', clip:{x:600,y:20,width:520,height:120} });
  await b.close();
})();
