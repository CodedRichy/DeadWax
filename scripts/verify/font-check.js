const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const p = await b.newPage({viewport:{width:1500,height:900}});
  const ext=[]; const errs=[];
  p.on('request', r => { const u=r.url();
    if(!/^http:\/\/localhost:8484/.test(u) && !/^data:/.test(u)) ext.push(u); });
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('http://localhost:8484/index.html',{waitUntil:'networkidle'});
  await p.waitForTimeout(1800);
  const f = await p.evaluate(async () => {
    await document.fonts.ready;
    const loaded = [...document.fonts].map(x => x.family+'/'+x.style+'='+x.status);
    const h1 = getComputedStyle(document.querySelector('h1')).fontFamily;
    return { loaded, h1, ok: document.fonts.check('16px "Instrument Serif"') };
  });
  console.log('font faces:', JSON.stringify(f.loaded));
  console.log('h1 family :', f.h1);
  console.log('resolves  :', f.ok);
  console.log('external requests:', ext.length ? JSON.stringify(ext) : 'NONE');
  console.log(errs.length ? 'ERRORS: '+errs.join(' | ') : 'no page errors');
  await b.close();
})();
