// The three bottom corners share one baseline and must never touch. Widening
// the paste bar once put it straight over CONTROLS and ABOUT at 900px, and the
// transport wrapped its last button onto a second line -- both invisible to
// every other check in this directory. Measure across the range of windows
// someone actually uses.
const { chromium } = require('playwright');

const WIDTHS = [900, 1100, 1280, 1500, 1680, 1920, 2560];
const results = [];

(async () => {
  const b = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const errs = [];

  for (const w of WIDTHS) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    p.on('pageerror', e => errs.push(w + ': ' + e.message));
    await p.goto('http://localhost:8484/index.html', { waitUntil: 'load' });
    await p.waitForTimeout(1800);
    await p.evaluate(() => {
      const t = [];
      for (let i = 1; i <= 12; i++) t.push({ t: 'Track ' + i, sec: 240, loud: .6, plays: 20 - i });
      SHELF.length = 0;
      SHELF.push({ artist: 'PARTYNEXTDOOR', album: 'Two Sides', art: null, tracks: t });
      renderShelf();
      selectRecord(SHELF[0], 0);
    });
    await p.waitForTimeout(600);
    await p.evaluate(() =>
      document.querySelectorAll('*').forEach(e => e.getAnimations().forEach(a => a.finish())));

    const m = await p.evaluate(() => {
      const r = id => {
        const e = document.getElementById(id);
        const b = e.getBoundingClientRect();
        return { l: Math.round(b.left), r: Math.round(b.right),
                 t: Math.round(b.top), b: Math.round(b.bottom) };
      };
      const np = r('np'), cue = r('cue'), yt = r('yt');
      const btns = [...document.querySelectorAll('#cue button')]
        .filter(x => getComputedStyle(x).display !== 'none');
      // One line means every visible button shares a top edge.
      const tops = new Set(btns.map(x => Math.round(x.getBoundingClientRect().top)));
      const btnBottom = Math.round(
        btns[0].getBoundingClientRect().bottom - parseFloat(getComputedStyle(btns[0]).paddingBottom));
      const ol = document.getElementById('linerList');
      return {
        np, cue, yt,
        cueRows: tops.size,
        // Shared baseline: transport text bottom, title block bottom, input bottom.
        baseTransport: innerHeight - btnBottom,
        baseTitle: innerHeight - np.b,
        baseInput: innerHeight - Math.round(
          document.getElementById('ytUrl').getBoundingClientRect().bottom),
        linerClipped: ol.scrollHeight > ol.clientHeight + 2,
        linerBottom: Math.round(ol.getBoundingClientRect().bottom),
      };
    });

    const gapNpCue = m.cue.l - m.np.r;
    const gapCueYt = m.yt.l - m.cue.r;
    const baselineOk = m.baseTransport === m.baseTitle && m.baseTransport === m.baseInput;
    const clearOfBar = m.linerBottom < m.yt.t;

    const pass = gapNpCue > 0 && gapCueYt > 0 && m.cueRows === 1 && baselineOk && clearOfBar;
    results.push({ w, gapNpCue, gapCueYt, cueRows: m.cueRows,
                   baseline: `${m.baseTitle}/${m.baseTransport}/${m.baseInput}`,
                   linerScrolls: m.linerClipped, clearOfBar, pass });
    await p.close();
  }

  console.table(results);
  const bad = results.filter(r => !r.pass);
  console.log(`${results.length - bad.length}/${results.length} widths clean`);
  if (bad.length) console.log('FAIL at: ' + bad.map(r => r.w).join(', '));
  console.log(errs.length ? 'ERRORS:\n' + errs.join('\n') : 'no page errors');
  await b.close();
  process.exit(bad.length ? 1 : 0);
})();
