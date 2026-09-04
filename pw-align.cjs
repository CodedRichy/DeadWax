const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:1600,height:960} });
  await p.goto('http://127.0.0.1:8484/', { waitUntil:'networkidle' });
  await p.waitForTimeout(2200);
  console.log(JSON.stringify(await p.evaluate(() => {
    const g = s => { const e = document.querySelector(s); if(!e) return null;
      const r = e.getBoundingClientRect();
      return {top:+r.top.toFixed(1), bottom:+r.bottom.toFixed(1),
              mid:+((r.top+r.bottom)/2).toFixed(1), h:+r.height.toFixed(1),
              left:+r.left.toFixed(1), right:+r.right.toFixed(1)}; };
    return { head:g('#head'), h1:g('#head h1'), nav:g('#nav'), cat:g('#cat'),
             edge:getComputedStyle(document.documentElement).getPropertyValue('--edge') };
  }), null, 1));
  await b.close();
})();
