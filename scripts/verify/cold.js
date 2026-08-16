// What a stranger sees. No seeding, no localStorage, straight off the live URL.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const ctx = await b.newContext({viewport:{width:1440,height:900}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  const t0=Date.now();
  await p.goto(process.argv[2]||'http://localhost:8484/index.html',{waitUntil:'load'});
  const loaded=Date.now()-t0;
  await p.waitForTimeout(3000);
  await p.screenshot({path:'cold-1.png'});
  const s = await p.evaluate(()=>({
    visibleText:[...document.querySelectorAll('body *')]
      .filter(e=>e.children.length===0 && e.textContent.trim() &&
        getComputedStyle(e).visibility!=='hidden' && +getComputedStyle(e).opacity>.05 &&
        e.getBoundingClientRect().width>0)
      .map(e=>e.textContent.trim()).slice(0,30),
    buttons:[...document.querySelectorAll('button')]
      .filter(x=>x.offsetParent).map(x=>x.textContent.trim()),
  }));
  console.log('load ms:',loaded);
  console.log('visible text:',JSON.stringify(s.visibleText,null,0));
  console.log('buttons:',JSON.stringify(s.buttons));
  console.log(errs.length?'ERRORS: '+errs.join(' | '):'no page errors');
  await b.close();
})();
