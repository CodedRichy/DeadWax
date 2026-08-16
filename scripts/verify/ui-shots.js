// Score the UI off what it actually looks like populated, not off an empty
// first load. Three states: main with a real record, the shelf, and the empty
// state a stranger sees.
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

  await page.screenshot({ path: path.join(__dirname, 'ui-empty.png'), timeout: 120000 });

  await page.evaluate(() => {
    const mk = (artist, album, tracks) => ({ artist, album, art: null,
      tracks: tracks.map(([t, sec, plays]) => ({ t, sec, loud: .6, plays })) });
    SHELF.length = 0;
    SHELF.push(mk('Pierce The Veil', 'Misadventures', [
      ['Dive In', 208, 141], ['Texas Is Forever', 236, 96], ['Floral & Fading', 251, 41],
      ['Phantom Power', 224, 22], ['Circles', 262, 9], ['Gold Medal Ribbon', 245, 3],
      ['Bedless', 231, 1], ['Sambuka', 258, 0], ['Today I Saw The Whole World', 240, 0],
      ['Song For Isabelle', 254, 0]]));
    SHELF.push(mk('PARTYNEXTDOOR', 'PARTYNEXTDOOR 4 (P4)', [
      ['Real Woman', 212, 33], ['Her Old Friends', 198, 12], ['Resentment', 226, 4]]));
    SHELF.push(mk('Alvvays', 'Blue Rev', [
      ['Pharmacist', 189, 77], ['Easy On Your Own?', 231, 55], ['After The Earthquake', 214, 30]]));
    renderShelf();
    selectRecord(SHELF[0], 0);
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(__dirname, 'ui-main.png'), timeout: 120000 });

  await page.click('#bShelf');
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(__dirname, 'ui-shelf.png'), timeout: 120000 });

  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await browser.close();
})();
