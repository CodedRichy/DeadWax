const { chromium } = require('playwright');
const D = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:1600,height:960}, deviceScaleFactor:2 });
  // block the now-playing feed so consecutive shots land on the same record
  await p.route(u => /\/api\/(stream|now|shelf)/.test(u.href), r => r.abort());
  await p.goto('http://127.0.0.1:8484/', { waitUntil:'networkidle' });
  await p.waitForTimeout(2500);
  await p.evaluate(()=>{ window.__forceSpin = 0.6; });
  await p.waitForTimeout(400);
  await p.screenshot({ path: D+'/z-head.png',  clip:{x:960,y:470,width:360,height:300} });
  await p.screenshot({ path: D+'/z-nearrim.png', clip:{x:560,y:640,width:520,height:200} });
  await p.screenshot({ path: D+'/z-farrim.png',  clip:{x:520,y:130,width:520,height:200} });
  await p.screenshot({ path: D+'/z-pivot.png',  clip:{x:1200,y:20,width:260,height:240} });
  await b.close();
})();
