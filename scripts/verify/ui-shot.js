// UI verification pass. Captures the states that matter and reports console
// errors, so the design can be judged without the user opening a browser.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(2500);           // fonts + sleeve animation settle

  await page.evaluate(() => {
    document.getElementById('cOrbit').checked = false;
    window.__forceSpin = 0.9;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(__dirname, 'ui-1-hero.png') });

  // the shelf
  await page.evaluate(() => document.body.classList.add('shelfopen'));
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(__dirname, 'ui-2-shelf.png') });

  // pick a different record -- exercises accent extraction + sleeve slide
  await page.evaluate(() => document.querySelectorAll('.rec')[5].click());
  await page.waitForTimeout(760);            // shelf faded, sleeve at full travel
  // read state BEFORE the screenshot -- swiftshader capture costs ~600ms and
  // the sleeve class clears at 1700ms
  console.log('sleeve opacity at capture:', await page.evaluate(() =>
    getComputedStyle(document.getElementById('sleeve')).opacity));
  await page.screenshot({ path: path.join(__dirname, 'ui-3-sleeve.png') });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: path.join(__dirname, 'ui-4-settled.png') });

  // side B
  await page.evaluate(() => document.getElementById('bFlip').click());
  await page.waitForTimeout(1300);
  await page.screenshot({ path: path.join(__dirname, 'ui-5-sideb.png') });

  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent'));
  const liner = await page.evaluate(() =>
    document.querySelectorAll('#linerList li').length);
  console.log('accent:', accent.trim(), '| liner rows:', liner);
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await browser.close();
})();
