// The wear VALUES are right (wear-check.js). This asks the only question that
// matters to a visitor: can you SEE the difference on the disc?
//
// The first version of this test lied. It mapped a band's disc-space radius to
// screen pixels with a guessed centre and a guessed scale (H_OFF / V_OFF / zoom
// globals that do not exist), so two of five sample rings landed off the disc
// entirely and read lum 0 -- which inflated the spread and made the test report
// PASS for the wrong reason. A test that passes because it is measuring black
// space is worse than no test.
//
// So nothing here is assumed about the projection. The disc is FOUND in the
// rendered image: centroid of the lit pixels gives the centre, the outermost lit
// radius gives r = 1.0, and every band maps through that one measured scale.
// Valid because the camera is driven to near top-down first, where the disc
// projects as a circle rather than an ellipse.
const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 1000, height: 1000 } });
  // Canvas readback is all zeros under SwiftShader unless the drawing buffer is
  // preserved -- the compositor has already discarded it by the time we read.
  await p.addInitScript(() => {
    const o = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, a) {
      if (/webgl/i.test(t)) a = Object.assign({}, a, { preserveDrawingBuffer: true });
      return o.call(this, t, a);
    };
  });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8484/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(2600);

  // Near top-down, spin stopped: no band is favoured by where the softbox streak
  // happens to be, and the disc projects round enough to measure radially.
  await p.evaluate(() => {
    const t = document.getElementById('sTilt');
    t.value = 2; t.dispatchEvent(new Event('input'));
  });
  await p.waitForTimeout(1400);
  await p.screenshot({ path: 'wear-top.png' });

  const r = await p.evaluate(() => {
    const cv = document.querySelector('canvas');
    const o = document.createElement('canvas');
    o.width = cv.width; o.height = cv.height;
    const x = o.getContext('2d', { willReadFrequently: true });
    x.drawImage(cv, 0, 0);
    const W = o.width, H = o.height, d = x.getImageData(0, 0, W, H).data;
    const lum = i => d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;

    // --- find the disc, do not assume it -------------------------------------
    // Anything above the black backdrop is disc, label, or arm. The arm is a thin
    // diagonal and contributes almost nothing to a centroid dominated by a large
    // filled circle.
    const LIT = 6;
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < H; y++) for (let px = 0; px < W; px++) {
      if (lum((y * W + px) * 4) > LIT) { sx += px; sy += y; n++; }
    }
    if (!n) return { error: 'nothing rendered -- canvas readback was empty' };
    const cx = sx / n, cy = sy / n;

    // r = 1.0 is the outermost radius that still has disc on most of the ring.
    // "Most of" rather than "any", so the tonearm cannot extend the measured rim.
    const maxR = Math.min(cx, cy, W - cx, H - cy);
    const ringLit = R => {
      let hit = 0, tot = 0;
      for (let a = 0; a < 360; a += 2) {
        const th = a * Math.PI / 180;
        const px = Math.round(cx + Math.cos(th) * R), py = Math.round(cy + Math.sin(th) * R);
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        tot++; if (lum((py * W + px) * 4) > LIT) hit++;
      }
      return tot ? hit / tot : 0;
    };
    let rim = 0;
    for (let R = Math.floor(maxR); R > 8; R--) { if (ringLit(R) > 0.9) { rim = R; break; } }
    if (!rim) return { error: 'could not find the disc rim' };

    // --- sample each band at its own mid-radius ------------------------------
    // MEDIAN around the ring, not mean: the tonearm crosses a few samples of some
    // rings and none of others, and a mean would read that as wear.
    const out = [];
    for (const bd of bands) {
      const rr = (bd.r0 + bd.r1) / 2;            // 0..1 in disc space
      const R = rr * rim;
      const vals = [];
      for (let a = 0; a < 360; a += 1) {
        const th = a * Math.PI / 180;
        const px = Math.round(cx + Math.cos(th) * R), py = Math.round(cy + Math.sin(th) * R);
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        vals.push(lum((py * W + px) * 4));
      }
      vals.sort((a, c) => a - c);
      const med = vals.length ? vals[vals.length >> 1] : 0;
      out.push({
        track: bd.t, plays: bd.plays, wear: +bd.wear.toFixed(2),
        px: Math.round(R), lit: +(vals.filter(v => v > LIT).length / Math.max(1, vals.length)).toFixed(2),
        lum: +med.toFixed(1),
      });
    }
    return { cx: Math.round(cx), cy: Math.round(cy), rim: Math.round(rim), bands: out };
  });

  if (r.error) {
    console.log('FAIL ' + r.error);
    await b.close();
    process.exit(1);
  }
  console.log(`disc found: centre ${r.cx},${r.cy}  rim ${r.rim}px`);
  console.table(r.bands);

  // A ring that is not almost entirely on the disc is not a measurement. This is
  // the check the old version was missing.
  const offDisc = r.bands.filter(v => v.lit < 0.9);
  if (offDisc.length) {
    console.log('FAIL sample rings fell off the disc: '
      + offDisc.map(v => `${v.track} (lit ${v.lit})`).join(', '));
    console.log(errs.length ? 'ERRORS: ' + errs.join(' | ') : 'no page errors');
    await b.close();
    process.exit(1);
  }

  const L = r.bands.map(v => v.lum);
  const spread = Math.max(...L) - Math.min(...L);
  // Monotonicity matters as much as spread: more plays must not read cleaner.
  // Compare the most- and least-worn bands directly rather than requiring a
  // perfect ordering, which the inner-groove velocity term legitimately breaks.
  const byWear = [...r.bands].sort((a, c) => a.wear - c.wear);
  const dir = byWear[byWear.length - 1].lum - byWear[0].lum;

  console.log('luminance spread across bands:', spread.toFixed(1));
  console.log('most-worn minus least-worn    :', dir.toFixed(1));
  const pass = spread >= 12 && dir > 0;
  console.log(pass ? 'PASS wear reads on the disc'
    : (dir <= 0 ? 'FAIL the most-worn band is not the brightest -- wear reads backwards'
      : 'FAIL wear is not visible on the disc'));
  console.log(errs.length ? 'ERRORS: ' + errs.join(' | ') : 'no page errors');
  await b.close();
  process.exit(pass ? 0 : 1);
})();
