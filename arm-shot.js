// Close crop on the tonearm, at 3x, so shading and geometry can actually be
// judged. The full-frame shot is too small to see whether the arm is a solid.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file:///' + path.resolve(__dirname, 'deadwax-platter.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { document.getElementById('cOrbit').checked = false; });
  await page.waitForTimeout(300);

  // whole arm: pivot down to the stylus
  await page.screenshot({ path: path.join(__dirname, 'arm-1-full.png'),
                          clip: { x: 640, y: 250, width: 560, height: 460 }, timeout: 120000 });
  // the headshell alone
  await page.screenshot({ path: path.join(__dirname, 'arm-2-shell.png'),
                          clip: { x: 660, y: 530, width: 260, height: 190 }, timeout: 120000 });
  // pivot, gimbal and counterweight
  await page.screenshot({ path: path.join(__dirname, 'arm-3-pivot.png'),
                          clip: { x: 1010, y: 250, width: 260, height: 200 }, timeout: 120000 });

  // and again with the light swung round, to prove the arm responds to it
  await page.evaluate(() => {
    const s = document.getElementById('sLit');
    s.value = 20; s.dispatchEvent(new Event('input'));
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(__dirname, 'arm-4-lit20.png'),
                          clip: { x: 640, y: 250, width: 560, height: 460 }, timeout: 120000 });

  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await browser.close();
})();
