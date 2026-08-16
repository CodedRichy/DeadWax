// Does wear actually render? Two questions the swarm raised:
//   1. a freshly pressed record (one track, equal counts) used to compute wear 0
//   2. wear was only visible where the specular streak happened to cross
// So: seed a record with a real spread, park the light AWAY from the band, and
// compare the computed wear values plus a screenshot.
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

  // Case 1: the degenerate one. One track, played a lot.
  const solo = await page.evaluate(() => {
    const r = { artist:'Solo', album:'One Track', art:null,
                tracks:[{ t:'Only Song', sec:220, loud:.6, plays:60 }] };
    SHELF.length = 0; SHELF.push(r); selectRecord(r, 0);
    return bands.map(b => +b.wear.toFixed(3));
  });

  // Case 2: a real spread across ten tracks.
  const spread = await page.evaluate(() => {
    const counts = [187, 96, 41, 12, 3, 1, 0, 0, 0, 0];
    const r = { artist:'Spread', album:'Ten Tracks', art:null,
                tracks: counts.map((p,i)=>({ t:'Track '+(i+1), sec:200, loud:.6, plays:p })) };
    SHELF.length = 0; SHELF.push(r); selectRecord(r, 0);
    document.getElementById('cOrbit') && (document.getElementById('cOrbit').checked = false);
    return bands.map(b => ({ plays: b.plays, wear: +b.wear.toFixed(3) }));
  });

  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(__dirname, 'wear-1.png'), timeout: 120000 });

  console.log('single-track record, 60 plays -> wear', JSON.stringify(solo));
  console.log('ten-track spread ->');
  for (const b of spread) console.log('   plays', String(b.plays).padStart(3), ' wear', b.wear);
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await browser.close();
})();
