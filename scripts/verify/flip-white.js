// #15: the walkthrough agent saw the record go white mid-flip. Measure it
// properly -- drive the real button and sample every animation frame from
// inside the page, so no round-trip latency skips the arc.
//
// Two harness facts this test exists to respect:
//  - without preserveDrawingBuffer the GL canvas is cleared before drawImage
//    reads it, so every sample returns zero and the test passes by reading
//    nothing at all;
//  - flipRot is a top-level `let`, which is NOT a window property, so it
//    cannot be read from the outside. Sample the pixels, not the variable.
const { chromium } = require('playwright');

(async () => {
  const b = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
  await p.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
      if (/webgl/i.test(type)) attrs = Object.assign({}, attrs, { preserveDrawingBuffer: true });
      return orig.call(this, type, attrs);
    };
  });

  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8484/index.html', { waitUntil: 'load' });
  await p.waitForTimeout(2200);

  await p.evaluate(() => {
    const t = [];
    for (let i = 1; i <= 12; i++) t.push({ t: 'Track ' + i, sec: 240, loud: .6, plays: 20 - i });
    SHELF.length = 0;
    SHELF.push({ artist: 'Test', album: 'Two Sides', art: null, tracks: t });
    renderShelf();
    selectRecord(SHELF[0], 0);
  });
  await p.waitForTimeout(700);

  const out = await p.evaluate(() => new Promise(resolve => {
    const cv = document.querySelector('canvas');
    const o = document.createElement('canvas');
    o.width = 140; o.height = 100;
    const x = o.getContext('2d', { willReadFrequently: true });
    const samples = [];
    const sideAt = [];
    const t0 = performance.now();

    const tick = () => {
      x.drawImage(cv, 0, 0, 140, 100);
      const d = x.getImageData(0, 0, 140, 100).data;
      let sum = 0, peak = 0, hot = 0;
      for (let j = 0; j < d.length; j += 4) {
        const L = d[j] * .299 + d[j + 1] * .587 + d[j + 2] * .114;
        sum += L;
        if (L > peak) peak = L;
        if (L > 200) hot++;                       // near-white pixels
      }
      const n = d.length / 4;
      samples.push({
        ms: Math.round(performance.now() - t0),
        mean: +(sum / n).toFixed(1),
        peak: Math.round(peak),
        hotPct: +(100 * hot / n).toFixed(2),
      });
      sideAt.push(document.getElementById('catSide').textContent);
      if (performance.now() - t0 < 1600) requestAnimationFrame(tick);
      else resolve({ samples, sideAt });
    };

    document.getElementById('bFlip').click();
    requestAnimationFrame(tick);
  }));

  const s = out.samples;
  const base = s[0];
  // Report a spread of the arc rather than all ~90 frames.
  const step = Math.max(1, Math.floor(s.length / 12));
  console.table(s.filter((_, i) => i % step === 0));
  console.log('side went:', [...new Set(out.sideAt)].join(' -> '));
  console.log('frames sampled:', s.length);

  // A "white flash" is a frame far brighter than the resting deck, or one where
  // a real share of the frame is near-white. Both, because a mid-grey wash and
  // a blown highlight fail differently.
  const meanCap = Math.max(base.mean * 2.5, 40);
  const bad = s.filter(f => f.mean > meanCap || f.hotPct > 8);
  const flipped = out.sideAt[0] !== out.sideAt[out.sideAt.length - 1];

  console.log(`resting mean ${base.mean}, cap ${meanCap.toFixed(1)}`);
  console.log(flipped ? 'flip ran' : 'FAIL flip never ran -- test proves nothing');
  console.log(bad.length
    ? 'FAIL white frames: ' + JSON.stringify(bad.slice(0, 5))
    : 'PASS no white frame across the arc');
  console.log(errs.length ? 'ERRORS: ' + errs.join(' | ') : 'no page errors');

  await b.close();
  process.exit(!flipped || bad.length ? 1 : 0);
})();
