// Three camera angles with spin + auto-orbit frozen, so the 3D reads in stills.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file:///' + path.resolve(__dirname, 'deadwax-platter.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 780 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(900);

  await page.evaluate(() => {
    document.getElementById('cOrbit').checked = false;
    document.getElementById('cSpin').checked = false;
    window.__forceSpin = 0.9;
  });

  const views = [['A', 0.15, 68], ['B', 1.40, 46], ['C', 2.60, 74]];
  for (const [name, yaw, tilt] of views) {
    await page.evaluate(({ yaw, tilt }) => {
      cam.yaw = yaw;
      const s = document.getElementById('sTilt');
      s.value = tilt;
      s.dispatchEvent(new Event('input'));
    }, { yaw, tilt });
    await page.waitForTimeout(550);
    await page.screenshot({ path: path.join(__dirname, `orbit-${name}.png`) });
    console.log('orbit', name, 'yaw', yaw, 'tilt', tilt);
  }

  console.log(errs.length ? 'ERRORS: ' + errs.join(' | ') : 'no page errors');
  await browser.close();
})();
