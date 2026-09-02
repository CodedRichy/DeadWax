const { chromium } = require('playwright');
const D = process.argv[2] || '.';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:1600,height:960}, deviceScaleFactor:1 });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  p.on('console', m => { if(m.type()==='error') errs.push('CONSOLE ' + m.text()); });
  await p.goto('http://127.0.0.1:8484/', { waitUntil:'networkidle' });
  await p.waitForTimeout(2500);
  await p.screenshot({ path: D + '/1-now.png' });

  // rest, forced rather than waited out
  await p.evaluate(() => window.goRest && window.goRest());
  await p.waitForTimeout(2200);
  await p.screenshot({ path: D + '/2-rest.png' });
  const restOn = await p.evaluate(() => ({
    resting: document.body.classList.contains('resting'),
    line: (document.getElementById('restLine')||{}).textContent,
    w: document.querySelector('canvas').width, iw: innerWidth,
  }));

  await p.mouse.move(800,500);
  await p.waitForTimeout(600);
  await p.click('#navLedger');
  await p.waitForTimeout(1800);
  await p.screenshot({ path: D + '/3-ledger.png' });

  await p.click('#navCrate');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: D + '/4-crate.png' });

  console.log(JSON.stringify({ restOn, errs }, null, 1));
  await b.close();
})();
