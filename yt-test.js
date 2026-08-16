// Does the paste-a-link path actually work? Over http, not file://, because
// MusicBrainz and the YouTube API both need a real origin.
const { chromium } = require('playwright');
const path = require('path');

const URL_ = 'http://localhost:8484/index.html';
const LINK = process.argv[2] || 'https://www.youtube.com/watch?v=Z0dLbSGjbBw';

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 200)); });

  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => { const o = document.getElementById('cOrbit'); if (o) o.checked = false; });

  await page.fill('#ytUrl', LINK);
  await page.click('#ytGo');

  // give the API script, the player, MusicBrainz and Cover Art Archive time
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(2000);
    const st = await page.evaluate(() => ({
      msg: document.getElementById('ytMsg').textContent,
      yton: document.body.classList.contains('yton'),
      iframe: !!document.querySelector('#ytHost iframe'),
      album: document.querySelector('#np .t') && document.querySelector('#np .t').textContent,
      artist: document.querySelector('#np .a') && document.querySelector('#np .a').textContent,
      tracks: document.querySelectorAll('#liner li').length,
      armR: typeof armR !== 'undefined' ? +armR.toFixed(4) : null,
      syncing: typeof YT_SYNC === 'function' ? YT_SYNC() : null,
    }));
    console.log(i, JSON.stringify(st));
    if (st.iframe && st.syncing && st.album && st.tracks > 1) break;
  }

  await page.screenshot({ path: path.join(__dirname, 'yt-1.png'), timeout: 120000 });
  console.log(errs.length ? errs.slice(0, 8).join('\n') : 'no page errors');
  await browser.close();
})();
