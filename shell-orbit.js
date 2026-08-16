// Headshell from four sides. It is claimed to read as a solid only from the
// front, so look at it from the back and the sides rather than arguing about it.
// Crop follows the stylus tip, which moves across the screen as the camera swings.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 908 }, deviceScaleFactor: 2 });
  page.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { const o = document.getElementById('cOrbit'); if (o) o.checked = false; });

  const YAWS = [0.34, 1.90, 3.48, 5.05];
  for (let i = 0; i < YAWS.length; i++) {
    await page.evaluate(y => { cam.yaw = y; }, YAWS[i]);
    await page.waitForTimeout(500);
    // Read the yaw back. Setting cam.yaw and trusting it is how the last run
    // produced two identical crops for two different angles.
    const st = await page.evaluate(() => {
      const cs = [...document.getElementById('arm').querySelectorAll('circle')];
      const c = cs[cs.length - 1];
      return { yaw: +cam.yaw.toFixed(3),
               tip: c ? [+c.getAttribute('cx'), +c.getAttribute('cy')] : null };
    });
    const tip = st.tip;
    if (!tip) { console.log(`yaw ${YAWS[i]}: no stylus tip in the SVG`); continue; }
    if (Math.abs(st.yaw - YAWS[i]) > 0.01) console.log(`  !! yaw drifted to ${st.yaw}`);
    const W = 300, H = 240;
    const clip = {
      x: Math.max(0, Math.min(1920 - W, tip[0] - W * 0.55)),
      y: Math.max(0, Math.min(908 - H, tip[1] - H * 0.62)),
      width: W, height: H,
    };
    await page.screenshot({ path: path.join(__dirname, `shell-yaw${i}.png`), clip, timeout: 120000 });
    console.log(`yaw ${YAWS[i]}  tip ${tip.map(Math.round)}  clip ${clip.x},${clip.y}`);
  }
  await browser.close();
})();
