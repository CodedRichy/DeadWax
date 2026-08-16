const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(900);

  console.log('initial   :', (await page.textContent('#stylusInfo')).replace(/\s+/g, ' ').trim());

  const hit = await page.locator('#arm .hit').first().boundingBox();
  console.log('grab region:', hit ? `${Math.round(hit.width)}x${Math.round(hit.height)}` : 'NOT FOUND');

  // grab a point that is genuinely ON the arm tube, taken from the path itself
  const grab = await page.evaluate(() => {
    const svg = document.getElementById('arm');
    const p = document.querySelector('#arm .hit');
    const local = p.getPointAtLength(p.getTotalLength() * 0.72);  // near the headshell
    const pt = svg.createSVGPoint();
    pt.x = local.x; pt.y = local.y;
    const s = pt.matrixTransform(p.getScreenCTM());
    return { x: s.x, y: s.y };
  });
  console.log('grab point:', Math.round(grab.x), Math.round(grab.y));

  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.waitForTimeout(120);
  // drag toward the label => later track
  await page.mouse.move(820, 520, { steps: 14 });
  await page.waitForTimeout(120);
  console.log('while drag:', (await page.textContent('#stylusInfo')).replace(/\s+/g, ' ').trim());
  await page.screenshot({ path: path.join(__dirname, '07-dragging.png') });
  await page.mouse.up();
  await page.waitForTimeout(700);
  console.log('after drop:', (await page.textContent('#stylusInfo')).replace(/\s+/g, ' ').trim());
  console.log('play btn  :', await page.textContent('#bPlay'));

  await page.screenshot({ path: path.join(__dirname, '08-dropped.png') });

  // cue lever
  await page.click('#bCue');
  await page.waitForTimeout(500);
  console.log('after cue :', await page.textContent('#bCue'), '/', await page.textContent('#bPlay'));
  await page.screenshot({ path: path.join(__dirname, '09-cued.png') });

  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
  await browser.close();
})();
