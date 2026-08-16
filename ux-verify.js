// Drive the fixes, do not assume them. Every check here maps to a finding from
// the walkthrough or to something I changed this pass.
const { chromium } = require('playwright');
const path = require('path');

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '   ' + detail : ''));
};

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 160)); });

  // Native dialogs must never fire. If one does, this records it and dismisses
  // it so the run does not hang.
  const natives = [];
  page.on('dialog', async d => { natives.push(d.type() + ': ' + d.message()); await d.dismiss(); });

  await page.goto('http://localhost:8484/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2300);

  // ---- empty state ------------------------------------------------------
  const emptyVis = await page.evaluate(() => {
    const e = document.getElementById('empty');
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    const bar = document.getElementById('yt').getBoundingClientRect();
    const overlapsLabel = r.left < innerWidth * 0.62 && r.right > innerWidth * 0.38
                       && r.top < innerHeight * 0.62 && r.bottom > innerHeight * 0.38;
    return { display: cs.display, overlapsLabel,
      importBtn: !!document.getElementById('emptyImport'),
      transportVisible: [...document.querySelectorAll('#cue button')]
        .filter(b => getComputedStyle(b).display !== 'none').map(b => b.textContent) };
  });
  check('#8 empty state is off the record label', !emptyVis.overlapsLabel);
  check('#21 import offered on the empty state', emptyVis.importBtn);
  check('#9 empty deck hides the transport',
        emptyVis.transportVisible.length === 0, JSON.stringify(emptyVis.transportVisible));

  // ---- seed a shelf -----------------------------------------------------
  await page.evaluate(() => {
    const mk = (artist, album, tracks) => ({ artist, album, art: null,
      tracks: tracks.map(([t, sec, plays]) => ({ t, sec, loud: .6, plays })) });
    SHELF.length = 0;
    SHELF.push(mk('Pierce The Veil', 'Misadventures', [
      ['Dive In', 208, 141], ['Texas Is Forever', 236, 96], ['Floral & Fading', 251, 41],
      ['Phantom Power', 224, 22], ['Circles', 262, 9], ['Gold Medal Ribbon', 245, 3],
      ['Bedless', 231, 1], ['Sambuka', 258, 0], ['Today I Saw The Whole World', 240, 0],
      ['Song For Isabelle', 254, 0]]));
    SHELF.push(mk('PARTYNEXTDOOR', 'P4', [['M a k e  I t', 212, 33], ['Resentment', 226, 4]]));
    SHELF.push(mk('Alvvays', 'Blue Rev', [['Pharmacist', 189, 77], ['Belinda Says', 231, 55]]));
    renderShelf(); selectRecord(SHELF[0], 0);
  });
  await page.waitForTimeout(700);

  // ---- #5/#4 chrome leaves screens it does not belong to -----------------
  await page.click('#bShelf'); await page.waitForTimeout(650);
  // Under headless SwiftShader the compositor never presents, so CSS
  // transitions sit at currentTime 0 forever and getComputedStyle keeps
  // returning the PRE-transition value. That is a harness artifact, not app
  // behaviour -- settle them so we assert the state the user actually ends up
  // looking at.
  await page.evaluate(() => document.querySelectorAll('*')
    .forEach(e => e.getAnimations().forEach(a => a.finish())));
  const onShelf = await page.evaluate(() => {
    const vis = id => { const e = document.getElementById(id);
      const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && +cs.opacity > 0.05; };
    const cy = getComputedStyle(document.getElementById('yt'));
    return { yt: vis('yt'), cue: vis('cue'), body: document.body.className,
             ytRaw: cy.opacity + '/' + cy.visibility,
             sleeves: document.querySelectorAll('#rail .slv').length,
             withArt: [...document.querySelectorAll('#rail .slv img')]
               .filter(i => i.getAttribute('src')).length };
  });
  check('#5 paste bar hidden on the crate', !onShelf.yt, onShelf.body + ' yt=' + onShelf.ytRaw);
  check('#4 transport hidden on the crate', !onShelf.cue, onShelf.body);
  check('crate renders every record', onShelf.sleeves === 3, `${onShelf.sleeves} sleeves`);
  check('every sleeve has generated art', onShelf.withArt === 3, `${onShelf.withArt}/3`);
  await page.screenshot({ path: path.join(__dirname, 'v-crate.png'), timeout: 120000 });

  // ---- riffling ---------------------------------------------------------
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(600);
  const idx = await page.evaluate(() => crateIdx);
  check('riffle with the keyboard', idx === 1, 'crateIdx=' + idx);

  // ---- #6 panels are mutually exclusive ---------------------------------
  await page.evaluate(() => { setPanel('ui'); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { setPanel('shelf'); });
  await page.waitForTimeout(400);
  const panels = await page.evaluate(() => ({ cls: document.body.className,
    ctl: document.getElementById('bCtl').textContent }));
  check('#6 never both panels at once',
        !(panels.cls.includes('uiopen') && panels.cls.includes('shelfopen')), panels.cls);
  check('#6 Controls button tells the truth', panels.ctl === 'Controls', panels.ctl);

  // ---- #1 rename is a designed dialog, not prompt() ----------------------
  await page.evaluate(() => { setPanel('shelf'); crateTo(0); });
  await page.waitForTimeout(400);
  await page.click('#crRen'); await page.waitForTimeout(400);
  const modalUp = await page.evaluate(() => ({
    open: document.body.classList.contains('modalopen'),
    fields: document.querySelectorAll('#modalFields input').length,
    title: document.getElementById('modalTitle').textContent }));
  check('#1 rename uses the in-page dialog', modalUp.open && modalUp.fields === 2,
        `${modalUp.fields} fields`);
  await page.screenshot({ path: path.join(__dirname, 'v-modal.png'), timeout: 120000 });

  await page.fill('#mf0', 'Renamed Album');
  await page.fill('#mf1', 'Renamed Artist');
  await page.click('#modalYes'); await page.waitForTimeout(600);
  const renamed = await page.evaluate(() => ({
    shelf: SHELF[0].album, title: document.getElementById('npTitle').textContent,
    crate: document.getElementById('crateTitle').textContent,
    status: document.getElementById('ytMsg').textContent }));
  check('#1 rename writes through', renamed.shelf === 'Renamed Album'
        && renamed.title === 'Renamed Album' && renamed.crate === 'Renamed Album');
  check('#11 rename also corrects the status line',
        renamed.status.includes('Renamed Album'), JSON.stringify(renamed.status));

  // ---- #12 per-track remove --------------------------------------------
  await page.evaluate(() => { setPanel(null); });
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => REC.tracks.length);
  await page.evaluate(() => {
    document.querySelector('#linerList li [data-tdel]').click();
  });
  await page.waitForTimeout(400);
  const confirmUp = await page.evaluate(() => document.body.classList.contains('modalopen'));
  check('#12 per-track remove exists and confirms', confirmUp);
  await page.click('#modalYes'); await page.waitForTimeout(600);
  const after = await page.evaluate(() => REC.tracks.length);
  check('#12 track actually removed', after === before - 1, `${before} -> ${after}`);

  // ---- #7 tray table is tidied -----------------------------------------
  await page.evaluate(() => { selectRecord(SHELF[1], 0); setPanel('ui'); });
  await page.waitForTimeout(600);
  const tray = await page.evaluate(() =>
    [...document.querySelectorAll('#tb tr td:nth-child(2)')].map(t => t.textContent));
  check('#7 tray table de-spaces titles',
        tray.some(t => /Make It/.test(t)), JSON.stringify(tray));

  // ---- #22 debug controls are not shipped -------------------------------
  const dbg = await page.evaluate(() => ({
    hidden: getComputedStyle(document.getElementById('dbg')).display === 'none',
    worn: !!document.getElementById('bWorn').offsetParent }));
  check('#22 render-grading controls hidden by default', dbg.hidden && !dbg.worn);

  // ---- #2/#3/#23 press-flow guards --------------------------------------
  await page.evaluate(() => { setPanel(null); });
  await page.waitForTimeout(300);
  await page.fill('#ytUrl', '');
  await page.click('#ytGo'); await page.waitForTimeout(250);
  const emptyMsg = await page.evaluate(() => document.getElementById('ytMsg').textContent);
  check('#23 empty input gets its own message',
        /paste a youtube link first/.test(emptyMsg), JSON.stringify(emptyMsg));

  await page.fill('#ytUrl', 'https://open.spotify.com/track/abc');
  await page.click('#ytGo'); await page.waitForTimeout(250);
  const spotMsg = await page.evaluate(() => document.getElementById('ytMsg').textContent);
  check('#23 a non-youtube link says so',
        /not youtube/.test(spotMsg), JSON.stringify(spotMsg));

  // ---- native dialogs anywhere? ----------------------------------------
  check('#1 no native prompt/confirm fired anywhere',
        natives.length === 0, natives.join(' | '));

  console.log('');
  const bad = results.filter(r => !r.pass);
  console.log(`${results.length - bad.length}/${results.length} passed`);
  console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 8).join('\n') : 'no page errors');
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
