// Does the stylus track the video clock, or does it just creep on its own timer?
// Paste a link, let it play, and sample armR against the player's currentTime.
// If they are locked, (b.r1 - armR)/(b.r1 - b.r0) should equal t/d every sample.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8484/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2200);

  await page.fill('#ytUrl', 'https://youtu.be/Zzl20a6AmRE');
  await page.press('#ytUrl', 'Enter');
  await page.waitForTimeout(9000);

  const rows = [];
  for (let i = 0; i < 8; i++) {
    rows.push(await page.evaluate(() => {
      const b = window.YT_CTL && window.YT_CTL.band && window.YT_CTL.band();
      const live = !!(window.YT_CTL && window.YT_CTL.live());
      const c = (window.YT_CTL && window.YT_CTL.clock && window.YT_CTL.clock()) || null;
      const t = c ? c.t : null, d = c ? c.d : null;
      return {
        armR: +armR.toFixed(4),
        band: b ? { r0: +b.r0.toFixed(4), r1: +b.r1.toFixed(4) } : null,
        t: t == null ? null : +t.toFixed(2), d: d == null ? null : +d.toFixed(2),
        live,
      };
    }));
    await page.waitForTimeout(2500);
  }

  console.log('sample  armR    t/d      arm-fraction   delta');
  for (const r of rows) {
    if (!r.band || !r.d) { console.log(JSON.stringify(r)); continue; }
    const clock = r.t / r.d;
    const arm = (r.band.r1 - r.armR) / (r.band.r1 - r.band.r0);
    console.log(
      String(r.armR).padEnd(8), r.t + '/' + r.d,
      ' clock ' + clock.toFixed(4), ' arm ' + arm.toFixed(4),
      ' delta ' + Math.abs(clock - arm).toFixed(4), r.live ? '' : ' (NOT LIVE)');
  }
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await browser.close();
})();
