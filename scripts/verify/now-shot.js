// Full frame + arm crop, current state.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 908 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { const o = document.getElementById('cOrbit'); if (o) o.checked = false; });
  await page.waitForTimeout(300);

  await page.screenshot({ path: path.join(__dirname, 'now-1-full.png'), timeout: 120000 });

  // where is the arm actually drawn? measure its bbox so the crop is not a guess.
  const box = await page.evaluate(() => {
    const s = document.getElementById('armSvg');
    if (!s) return null;
    const b = s.getBBox ? s.getBBox() : null;
    const r = s.getBoundingClientRect();
    return { bbox: b && { x: b.x, y: b.y, w: b.width, h: b.height },
             rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
  });
  console.log(JSON.stringify(box));
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await browser.close();
})();
