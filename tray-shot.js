// The controls tray, open. It was unreadable because the title block behind it
// showed through -- so look at it open, not closed.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8484/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.click('#bCtl');
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(__dirname, 'tray-open.png'), timeout: 120000 });
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await browser.close();
})();
