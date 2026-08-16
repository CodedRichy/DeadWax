// Capture the platter at several states so I can actually look at it.
// Usage: node shot.js [outdir]
const { chromium } = require('playwright');
const path = require('path');

const FILE = 'file:///' + path.resolve(__dirname, 'index.html').replace(/\\/g, '/');
const OUT  = process.argv[2] || __dirname;

const SHOTS = [
  { name: '01-worn',    wear: 1.00, dens: 0.34, lit: 140, spin: 0.0  },
  { name: '02-fresh',   wear: 0.00, dens: 0.34, lit: 140, spin: 0.0  },
  { name: '03-lit40',   wear: 1.00, dens: 0.34, lit:  40, spin: 0.0  },
  { name: '04-real',    wear: 1.00, dens: 1.00, lit: 140, spin: 0.0  },
  { name: '05-spin-a',  wear: 1.00, dens: 0.34, lit: 140, spin: 0.0  },
  { name: '06-spin-b',  wear: 1.00, dens: 0.34, lit: 140, spin: 2.09 }, // +1/3 turn
];

(async () => {
  const browser = await chromium.launch({
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--disable-gpu-sandbox',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console',   m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  // Did WebGL actually come up?
  const diag = await page.evaluate(() => {
    const c = document.getElementById('gl');
    const gl = c && c.getContext('webgl2');
    if (!gl) return { ok: false, why: 'no webgl2 context' };
    return {
      ok: true,
      renderer: gl.getParameter(gl.RENDERER),
      size: [c.width, c.height],
      err: gl.getError(),
    };
  });
  console.log('DIAG', JSON.stringify(diag));

  for (const s of SHOTS) {
    await page.evaluate(({ wear, dens, lit, spin }) => {
      const set = (id, v) => {
        const e = document.getElementById(id);
        e.value = v; e.dispatchEvent(new Event('input'));
      };
      set('sWear', wear); set('sDens', dens); set('sLit', lit);
      document.getElementById('cSpin').checked = false;
      window.__spinOverride = spin;
    }, s);

    // freeze rotation deterministically
    await page.evaluate(v => { window.__forceSpin = v; }, s.spin);
    await page.waitForTimeout(450);

    await page.screenshot({ path: path.join(OUT, s.name + '.png') });
    console.log('shot', s.name);
  }

  if (errs.length) console.log('ERRORS:\n' + errs.join('\n'));
  else console.log('no page errors');

  await browser.close();
})();
