const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

(async () => {
  const b = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', e => console.log('PAGEERROR', e.message));
  p.on('console', m => console.log('LOG:', m.text()));

  await p.goto(FILE, { waitUntil: 'load' });
  await p.waitForTimeout(2000);
  // replicate ui-shot exactly: open the shelf, screenshot it, then click
  await p.evaluate(() => document.body.classList.add('shelfopen'));
  await p.waitForTimeout(700);
  await p.screenshot({ path: path.join(__dirname, '_probe-shelf.png') });
  await p.evaluate(() => {
    window.__hits = [];
    const orig = window.selectRecord;
    document.querySelectorAll('.rec')[5].click();
  });

  for (const t of [150, 400, 800, 1300, 1900]) {
    await p.waitForTimeout(t === 150 ? 150 : 350);
    const s = await p.evaluate(() => ({
      cls: document.body.className,
      op:  getComputedStyle(document.getElementById('sleeve')).opacity,
      tf:  getComputedStyle(document.getElementById('sleeve')).transform,
      hasSrc: !!document.getElementById('sleeveArt').src,
    }));
    console.log(t, JSON.stringify(s));
    if (t === 800)  await p.screenshot({ path: path.join(__dirname, 'ui-3-sleeve.png') });
    if (t === 1900) await p.screenshot({ path: path.join(__dirname, 'ui-3b-pull.png') });
  }
  await b.close();
})();
