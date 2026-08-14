// Frames through the flip, so it can be judged as a motion, not a still.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file:///' + path.resolve(__dirname, 'deadwax-platter.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { document.getElementById('cOrbit').checked = false; });

  await page.screenshot({ path: path.join(__dirname, 'flip-0.png') });
  await page.evaluate(() => document.getElementById('bFlip').click());

  // swiftshader capture is slow, so read state before each shot, not after
  for (let i = 1; i <= 4; i++) {
    const st = await page.evaluate(() => ({
      tilt: document.getElementById('sTilt').value,
      side: document.getElementById('catSide').textContent,
      anim: !!window.flipAnim,
    }));
    console.log('frame', i, JSON.stringify(st));
    await page.screenshot({ path: path.join(__dirname, `flip-${i}.png`) });
  }
  await page.waitForTimeout(1500);
  console.log('settled:', await page.evaluate(() => ({
    tilt: document.getElementById('sTilt').value,
    side: document.getElementById('catSide').textContent,
  })));
  await page.screenshot({ path: path.join(__dirname, 'flip-5.png') });
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await browser.close();
})();
