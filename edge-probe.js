// At what flipRot is the record actually edge-on? Do not infer it from the
// tilt slider -- it is not obvious whether that value is measured from the
// vertical or from the platter, and guessing wrong put the face swap at the
// most visible point of the arc.
//
// Reading the GL canvas back does not work (no preserveDrawingBuffer, so it is
// cleared by the time drawImage runs), so solve it from the camera instead,
// which is exact rather than sampled: the disc is edge-on when its normal is
// perpendicular to the view direction.
//
//   n(a) = rotX((0,0,1), a) = (0, -sin a, cos a)
//   dot(n, fwd) = 0  ->  tan a = fwd.z / fwd.y
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 760 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8484/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2200);

  const r = await page.evaluate(() => {
    const rec = { artist: 'Probe', album: 'Edge On', art: null,
      tracks: Array.from({ length: 8 }, (_, i) => ({ t: 'T' + i, sec: 240, loud: .6, plays: 10 })) };
    SHELF.length = 0; SHELF.push(rec); selectRecord(rec, 0);
    const B = camBasis();
    const f = B.fwd;
    const edge = Math.atan2(f[2], f[1]);          // radians, signed
    // foreshortening at a few angles: |dot(n, fwd)| is 1 face-on, 0 edge-on
    const fore = a => {
      const n = [0, -Math.sin(a), Math.cos(a)];
      return Math.abs(n[0]*f[0] + n[1]*f[1] + n[2]*f[2]);
    };
    const D = Math.PI/180;
    return {
      tilt: +S.tilt.value,
      camPos: B.pos.map(v => +v.toFixed(3)),
      fwd: f.map(v => +v.toFixed(4)),
      edgeDeg: +(edge/D).toFixed(1),
      flat:   +fore(0).toFixed(3),
      atEdge: +fore(edge).toFixed(4),
      at90:   +fore(Math.PI/2).toFixed(3),
    };
  });

  console.log('tilt slider      ', r.tilt);
  console.log('camera fwd       ', JSON.stringify(r.fwd));
  console.log('EDGE-ON at       ', r.edgeDeg, 'deg');
  console.log('foreshortening   flat(0deg)=' + r.flat,
              ' edge(' + r.edgeDeg + 'deg)=' + r.atEdge,
              ' at 90deg=' + r.at90);
  console.log('90 - tilt =', 90 - r.tilt, '  tilt =', r.tilt);
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await browser.close();
})();
