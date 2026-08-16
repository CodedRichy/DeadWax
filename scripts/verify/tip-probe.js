// Is the stylus tip actually on the vinyl? Measure, do not eyeball.
// Reads the tip circle out of the arm SVG, then asks the page which world
// radius that screen point corresponds to on the record plane.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 908 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.log('PAGEERROR: ' + e.message));
  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { const o = document.getElementById('cOrbit'); if (o) o.checked = false; });
  await page.waitForTimeout(300);

  const out = await page.evaluate(() => {
    const svg = document.getElementById('arm');
    const circles = [...svg.querySelectorAll('circle')];
    const tip = circles[circles.length - 1];
    const sx = +tip.getAttribute('cx'), sy = +tip.getAttribute('cy');
    // hitPlane maps a screen point back onto a world z-plane
    const B = camBasis();
    const W = innerWidth, H = innerHeight;
    const w = hitPlane(sx, sy, B, W, H, 0.0127);
    // where does the rim project, at the same world angle?
    const ang = w ? Math.atan2(w[1], w[0]) : 0;
    const rimP = project([Math.cos(ang), Math.sin(ang), 0.0127], B, W, H);
    return {
      armR, R_OUT, R_IN,
      tipScreen: [Math.round(sx), Math.round(sy)],
      tipWorldRadius: w ? +Math.hypot(w[0], w[1]).toFixed(4) : null,
      rimScreenSameAngle: rimP ? [Math.round(rimP[0]), Math.round(rimP[1])] : null,
      pxPastRim: (w && rimP) ? Math.round(Math.hypot(sx - rimP[0], sy - rimP[1])) : null,
      onDisc: w ? Math.hypot(w[0], w[1]) <= 1.0 : null,
      V_OFF, H_OFF, DIST_BASE, camDist: +cam.dist.toFixed(3), shadowPaths: svg.querySelectorAll('g[clip-path] path').length, hasClip: !!svg.querySelector('clipPath'),
    };
  });
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})();
