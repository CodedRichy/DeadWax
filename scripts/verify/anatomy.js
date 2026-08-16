// The launch asset, second attempt.
//
// The first attempt put two whole discs side by side -- one played to death,
// one nearly new -- and it failed. The difference was real but unreadable,
// because the eye compares things that TOUCH, not things across a gap. Asking a
// stranger to hold one disc in memory while judging another is asking too much
// of an image they will look at for one second.
//
// So: one disc, and the comparison happens INSIDE it. Adjacent bands with wildly
// different play counts sit against each other, and a leader line names each
// one. That is the anatomical-plate convention -- specimen on the left, parts
// labelled on the right -- and it suits a record better than a poster does,
// because a record genuinely is a physical object with named regions.
//
// Everything is measured from the render rather than hand-placed: the disc is
// FOUND in the pixels (centroid + outermost lit ring) and each band's radius
// comes from the app's own geometry, so the leaders cannot drift out of
// alignment when the layout changes.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const DOCS = path.join(HERE, '..', '..', 'docs');
// The bare disc render is an intermediate and stays out of docs/ -- docs/*.png
// is the one tracked image directory, and a 5 MB working file does not belong
// in git. Only the finished plate lands there.
const DISC = path.join(HERE, 'anatomy-disc.png');
const OUT = path.join(DOCS, 'anatomy.png');

// A spread wide enough that adjacent bands are obviously different, and honest
// about the shape of a real listening history: one song wears out, the rest of
// the record barely gets touched.
// Runtimes are kept short on purpose: the app splits a record at 22 minutes,
// as a real 12" does, and a longer side would push the never-played track onto
// side B where it cannot be pointed at. That last band is the most useful one
// in the whole image -- mirror-black, untouched, right next to a destroyed one.
const TRACKS = [
  { t: 'Run-In',            sec: 196, loud: .62, plays: 341 },
  { t: 'Second Position',   sec: 208, loud: .58, plays: 96 },
  { t: 'Locked Groove',     sec: 202, loud: .55, plays: 38 },
  { t: 'Quiet Passage',     sec: 214, loud: .44, plays: 11 },
  { t: 'The Long Way Down', sec: 206, loud: .60, plays: 2 },
  { t: 'Never Played',      sec: 198, loud: .52, plays: 0 },
];

// Near flat-on. A rake looks better in isolation but turns the bands into
// ellipses, and an ellipse cannot be pointed at cleanly.
const TILT = 7;

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({
    viewport: { width: 1100, height: 1100 }, deviceScaleFactor: 2,
  });
  await page.addInitScript(() => {
    const o = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (t, a) {
      if (/webgl/i.test(t)) a = Object.assign({}, a, { preserveDrawingBuffer: true });
      return o.call(this, t, a);
    };
  });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('http://localhost:8484/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2600);

  await page.evaluate(({ TRACKS, TILT }) => {
    SHELF.length = 0;
    SHELF.push({ artist: 'Deadwax', album: 'Test Pressing', art: null, tracks: TRACKS });
    renderShelf(); selectRecord(SHELF[0], 0);
    // No tonearm: it crosses the bands the labels point at, and the asset is
    // about the surface, not the hardware.
    const arm = document.getElementById('cArm');
    if (arm && arm.checked) { arm.checked = false; arm.dispatchEvent(new Event('input')); }
    const t = document.getElementById('sTilt');
    t.value = TILT; t.dispatchEvent(new Event('input'));
    // Strip the UI -- this is the object, not a screenshot of software.
    const cv = document.querySelector('canvas');
    for (const el of document.body.children) if (!el.contains(cv)) el.style.display = 'none';
    document.body.style.background = '#000';
  }, { TRACKS, TILT });
  await page.waitForTimeout(1600);

  await page.screenshot({ path: DISC, timeout: 120000 });

  // Measure the disc in the rendered pixels, exactly as wear-visible.js does,
  // and return everything as FRACTIONS of the image so the sheet can scale the
  // render freely without the leaders sliding off their bands.
  const geo = await page.evaluate(() => {
    const cv = document.querySelector('canvas');
    const o = document.createElement('canvas');
    o.width = cv.width; o.height = cv.height;
    const x = o.getContext('2d', { willReadFrequently: true });
    x.drawImage(cv, 0, 0);
    const W = o.width, H = o.height, d = x.getImageData(0, 0, W, H).data;
    const lum = i => d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
    const LIT = 6;
    let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < H; y++) for (let px = 0; px < W; px++) {
      if (lum((y * W + px) * 4) > LIT) { sx += px; sy += y; n++; }
    }
    if (!n) return { error: 'canvas readback was empty' };
    const cx = sx / n, cy = sy / n;
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
    return {
      cx: cx / W, cy: cy / H, rim: rim / W,
      bands: bands.map(b => ({
        t: b.t, plays: b.plays, wear: +b.wear.toFixed(3),
        mid: (b.r0 + b.r1) / 2,
      })),
    };
  });
  if (geo.error) { console.log('FAIL ' + geo.error); await browser.close(); process.exit(1); }

  // ---- compose the plate ---------------------------------------------------
  const SHEET_W = 2000, SHEET_H = 1250;
  const D = 1060;                       // rendered disc, displayed size
  const DX = 96, DY = (SHEET_H - D) / 2;
  const COL = 1330;                     // x where the label column starts

  const cx = DX + geo.cx * D, cy = DY + geo.cy * D;

  // Only annotate the bands that tell the story: the destroyed one, one in the
  // middle, and the one that was never played. Six leaders is a diagram; three
  // is a sentence.
  const pick = [0, 2, geo.bands.length - 1].map(i => geo.bands[i]).filter(Boolean);
  // Fan the touch points down the right-hand edge so no two leaders cross, and
  // let each label sit at its own leader's height rather than on an even stack
  // -- a label that is not level with the thing it names makes the eye work.
  const A0 = -54, A1 = 42;
  const rows = pick.map((b, i) => {
    const frac = pick.length > 1 ? i / (pick.length - 1) : .5;
    const ang = (A0 + (A1 - A0) * frac) * Math.PI / 180;
    const R = b.mid * geo.rim * D;
    const py = cy + Math.sin(ang) * R;
    return {
      b,
      px: cx + Math.cos(ang) * R,
      py,
      ly: Math.min(Math.max(py, DY + 110), DY + D - 190),
    };
  });

  const leaders = rows.map(r =>
    `<path d="M${r.px.toFixed(1)},${r.py.toFixed(1)} L${(COL - 42).toFixed(1)},${r.ly.toFixed(1)} L${COL - 18},${r.ly.toFixed(1)}"/>
     <circle cx="${r.px.toFixed(1)}" cy="${r.py.toFixed(1)}" r="4.5"/>`).join('\n');

  const labels = rows.map(r => `
    <div class="lab" style="top:${(r.ly - 34).toFixed(1)}px">
      <div class="n">${r.b.plays.toLocaleString()}</div>
      <div class="c">${r.b.plays === 1 ? 'play' : 'plays'} &middot; ${esc(r.b.t)}</div>
    </div>`).join('');

  const html = `<!doctype html>
<meta charset="utf-8">
<style>
  @font-face{font-family:'Instrument Serif';font-style:normal;font-weight:400;
    src:url('../../fonts/instrument-serif-latin.woff2') format('woff2')}
  @font-face{font-family:'Instrument Serif';font-style:italic;font-weight:400;
    src:url('../../fonts/instrument-serif-latin-italic.woff2') format('woff2')}
  /* --bg matches the black the record was rendered against, so the capture's
     rectangle does not show as a lighter panel behind the disc. */
  :root{--ink:#EDE9E1;--ink-2:#8E8880;--ink-3:#57524C;--rule:#4A423A;--bg:#000;
    --display:'Instrument Serif',Georgia,serif;
    --mono:ui-monospace,'Cascadia Mono',Consolas,monospace}
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:${SHEET_W}px;height:${SHEET_H}px;background:var(--bg);color:var(--ink);
    overflow:hidden;position:relative}
  .disc{position:absolute;left:${DX}px;top:${DY}px;width:${D}px;height:${D}px}
  svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
  svg path{fill:none;stroke:var(--rule);stroke-width:1.25}
  svg circle{fill:none;stroke:#9A9084;stroke-width:1.4}
  .lab{position:absolute;left:${COL}px}
  .lab .n{font-family:var(--display);font-size:60px;line-height:1;
    letter-spacing:-.012em}
  .lab .c{font-family:var(--mono);font-size:10.5px;letter-spacing:.24em;
    text-transform:uppercase;color:var(--ink-3);margin-top:11px}
  .mark{position:absolute;top:58px;left:${COL}px;font-family:var(--display);
    font-size:34px}
  .mark span{display:block;font-family:var(--mono);font-size:10px;
    letter-spacing:.26em;text-transform:uppercase;color:var(--ink-3);margin-top:12px}
  .foot{position:absolute;left:${COL}px;right:74px;bottom:64px;
    font-family:var(--display);font-size:27px;line-height:1.32;color:var(--ink-2)}
  .foot em{font-style:italic;color:var(--ink)}
</style>
<img class="disc" src="./anatomy-disc.png" alt="">
<svg viewBox="0 0 ${SHEET_W} ${SHEET_H}">${leaders}</svg>
<div class="mark">DeadWax<span>one side &middot; one listener</span></div>
${labels}
<div class="foot">One record, one year. The grooves went dull exactly where the
stylus kept going &mdash; so you can read what somebody loved <em>off the
object</em>, before you can count.</div>
`;
  fs.writeFileSync(path.join(HERE, 'anatomy-sheet.html'), html, 'utf8');

  const sheet = await browser.newPage({
    viewport: { width: SHEET_W, height: SHEET_H }, deviceScaleFactor: 1,
  });
  await sheet.goto('http://localhost:8484/scripts/verify/anatomy-sheet.html',
    { waitUntil: 'load' });
  await sheet.evaluate(() => document.fonts.ready);
  await sheet.waitForTimeout(500);
  const serifOK = await sheet.evaluate(() =>
    document.fonts.check('400 60px "Instrument Serif"'));
  if (!serifOK) console.log('WARN Instrument Serif did not load -- fallback in use');
  await sheet.screenshot({ path: OUT, timeout: 120000 });

  console.log('disc: centre ' + geo.cx.toFixed(3) + ',' + geo.cy.toFixed(3)
    + '  rim ' + geo.rim.toFixed(3));
  console.table(geo.bands);
  console.log('WROTE ->', OUT);
  console.log(errs.length ? 'ERRORS: ' + errs.join(' | ') : 'no page errors');
  await browser.close();
})();

function esc(s) {
  return String(s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
