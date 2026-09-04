const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:1600,height:960}, deviceScaleFactor:2 });
  await p.goto('http://127.0.0.1:8484/', { waitUntil:'networkidle' });
  await p.waitForTimeout(2400);
  await p.screenshot({ path: process.argv[2]+'/toprow.png', clip:{x:0,y:26,width:1600,height:112} });
  await b.close();
})();
