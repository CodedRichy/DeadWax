// The flip is now a rigid-body move on the record, not a camera swing. Freeze
// it at five points across the arc and look, because "it compiled" says nothing
// about whether the disc turns or just vanishes.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 880 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8484/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2200);

  // A record long enough to genuinely have two sides: 10 x 4min = 40 min.
  const split = await page.evaluate(() => {
    const r = { artist: 'Two Sides', album: 'Long Player', art: null,
      tracks: Array.from({ length: 10 }, (_, i) =>
        ({ t: 'Track ' + (i + 1), sec: 240, loud: .6, plays: 20 - i })) };
    SHELF.length = 0; SHELF.push(r); selectRecord(r, 0);
    const A = sideTracks(r, 0).map(t => t.t), B = sideTracks(r, 1).map(t => t.t);
    return { A, B, oneSided: isOneSided(r),
             aMin: +(sideTracks(r,0).reduce((s,t)=>s+t.sec,0)/60).toFixed(1),
             bMin: +(sideTracks(r,1).reduce((s,t)=>s+t.sec,0)/60).toFixed(1) };
  });
  console.log('side A (' + split.aMin + ' min):', split.A.join(', '));
  console.log('side B (' + split.bMin + ' min):', split.B.join(', '));
  console.log('overlap:', split.A.filter(t => split.B.includes(t)).length, '(must be 0)');

  // A one-track record must NOT have a side B at all.
  const solo = await page.evaluate(() => {
    const r = { artist: 'Single', album: 'One Cut', art: null,
                tracks: [{ t: 'Only Song', sec: 200, loud: .6, plays: 9 }] };
    SHELF.push(r); selectRecord(r, 0);
    return { oneSided: isOneSided(r), bLen: sideTracks(r, 1).length,
             flipDisabled: document.getElementById('bFlip').disabled };
  });
  console.log('one-track record ->', JSON.stringify(solo));

  // Now freeze the flip arc on the two-sided record.
  await page.evaluate(() => selectRecord(SHELF[0], 0));
  await page.waitForTimeout(400);
  for (const [i, f] of [0, 0.25, 0.5, 0.75, 1].entries()) {
    const st = await page.evaluate(frac => {
      flipAnim = null;
      const fwd = camBasis().fwd;
      const edge = Math.atan2(fwd[2], fwd[1]);
      const dir = edge < 0 ? -1 : 1;
      const k = frac * frac * (3 - 2 * frac);
      const theta = dir * Math.PI * k;
      flipRot = Math.abs(theta) >= Math.abs(edge) ? theta - dir * Math.PI : theta;
      const arc = frac < 0.5 ? frac * 2 : (1 - frac) * 2;
      flipLift = 0.115 * Math.min(1, arc * 2.2);
      return { rot: +flipRot.toFixed(3), lift: +flipLift.toFixed(4) };
    }, f);
    await page.waitForTimeout(260);
    await page.screenshot({ path: path.join(__dirname, `flip-${i}.png`), timeout: 120000 });
    console.log(`t=${f}  rot=${st.rot} rad (${(st.rot * 180 / Math.PI).toFixed(0)} deg)  lift=${st.lift}`);
  }
  await page.evaluate(() => { flipRot = 0; flipLift = 0; });
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await browser.close();
})();
