// Full frame at two camera angles: side-on and from behind the arm.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { document.getElementById('cOrbit').checked = false; });

  const YAWS = [1.90, 3.48];
  for (let i = 0; i < YAWS.length; i++) {
    await page.evaluate(y => { cam.yaw = y; }, YAWS[i]);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(__dirname, 'yawfull' + i + '.png'), timeout: 120000 });
  }
  console.log('done');
  await browser.close();
})();
