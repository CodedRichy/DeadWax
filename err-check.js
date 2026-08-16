// Load the page and report any script error. Fast guard after a batch of edits.
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 220)); });
  await page.goto('http://localhost:8484/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  // A TDZ throw partway down the script leaves every binding BELOW it dead
  // while the functions above still work, so "no pageerror + a rendered liner"
  // is not proof the page booted. Probe a binding from the very bottom.
  const st = await page.evaluate(() => ({
    booted: (() => { try { return typeof U === 'function' && typeof YT_CTL === 'object'; }
                     catch (e) { return 'DEAD: ' + e.message; } })(),
    shelf: SHELF.length,
    rec: REC && REC.album,
    blank: !!(REC && REC.blank),
    noshelf: document.body.classList.contains('noshelf'),
    liner: document.querySelectorAll('#liner li').length,
  }));
  console.log(JSON.stringify(st));
  console.log(errs.length ? errs.slice(0, 6).join('\n') : 'no errors');
  await browser.close();
})();
