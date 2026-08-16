// Cut a real transparent favicon out of the stock record image.
//
// The source is a JPEG, so it cannot hold alpha -- the checkerboard people
// read as "transparent" is painted into the pixels. So: find the record by
// ignoring everything that looks like that checkerboard, then mask to the
// disc's own circle and write PNGs that actually have an alpha channel.
//
// Uses the headless browser we already have for the render harness rather than
// pulling in an image library.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUT = path.resolve(__dirname, '..');
const SIZES = [512, 180, 64, 32, 16];

if (!SRC || !fs.existsSync(SRC)) {
  console.error('usage: node scripts/make-favicon.js <source.jpg>');
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const dataUri = 'data:image/jpeg;base64,' + fs.readFileSync(SRC).toString('base64');

  const out = await page.evaluate(async ({ uri, sizes }) => {
    const img = new Image();
    img.src = uri;
    await img.decode();

    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, W, H).data;

    // The checkerboard is light and desaturated. The record is dark, or red.
    // Anything that is neither is background.
    const isSubject = i => {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max < 170) return true;                      // dark: vinyl
      if (r > 120 && r - Math.max(g, b) > 45) return true;  // saturated red: label
      return false;
    };

    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        if (isSubject((py * W + px) * 4)) {
          if (px < x0) x0 = px; if (px > x1) x1 = px;
          if (py < y0) y0 = py; if (py > y1) y1 = py;
        }
      }
    }
    // Do NOT trust the bounding box for the circle: the stock image has a soft
    // drop shadow that reads as subject, which pushes the box out and off-centre
    // and left painted checkerboard around a third of the rim.
    // Measure the disc directly instead -- scan the middle row and middle column
    // for the first and last dark pixel, which are the record's real edges.
    const darkAt = (px, py) => {
      const i = (py * W + px) * 4;
      return Math.max(d[i], d[i + 1], d[i + 2]) < 120;
    };
    const my = Math.round((y0 + y1) / 2), mx = Math.round((x0 + x1) / 2);
    let l = 0, r = W - 1, t = 0, b2 = H - 1;
    while (l < W - 1 && !darkAt(l, my)) l++;
    while (r > 0     && !darkAt(r, my)) r--;
    while (t < H - 1 && !darkAt(mx, t)) t++;
    while (b2 > 0    && !darkAt(mx, b2)) b2--;

    const cx = (l + r) / 2, cy = (t + b2) / 2;
    // Inset ~1.5%: JPEG ringing along a hard edge survives otherwise, and a
    // favicon is judged at 16px where one bright pixel of fringe is visible.
    const rad = Math.min(r - l, b2 - t) / 2 * 0.985;

    const results = {};
    for (const S of sizes) {
      const o = document.createElement('canvas');
      o.width = o.height = S;
      const ox = o.getContext('2d');
      ox.imageSmoothingQuality = 'high';
      ox.save();
      ox.beginPath();
      ox.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
      ox.clip();                                   // everything outside stays alpha 0
      ox.drawImage(img, cx - rad, cy - rad, rad * 2, rad * 2, 0, 0, S, S);
      ox.restore();
      results[S] = o.toDataURL('image/png');
    }
    return { box: { x0, y0, x1, y1, cx, cy, rad }, src: { W, H }, results };
  }, { uri: dataUri, sizes: SIZES });

  console.log(`source ${out.src.W}x${out.src.H}`);
  console.log(`record found at centre (${Math.round(out.box.cx)}, ${Math.round(out.box.cy)}) radius ${Math.round(out.box.rad)}`);

  for (const S of SIZES) {
    const b64 = out.results[S].split(',')[1];
    const file = path.join(OUT, S === 180 ? 'apple-touch-icon.png' : `favicon-${S}.png`);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    console.log('wrote ' + path.basename(file) + '  ' + fs.statSync(file).size + ' bytes');
  }
  await browser.close();
})();
