const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const p = await b.newPage({viewport:{width:1500,height:940}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://localhost:8484/index.html',{waitUntil:'load'});
  await p.waitForTimeout(2200);
  await p.click('#bAbout'); await p.waitForTimeout(500);
  const top = await p.evaluate(()=>document.querySelector('.about').classList.contains('more'));
  await p.evaluate(()=>{const a=document.querySelector('.about'); a.scrollTop=a.scrollHeight;});
  await p.waitForTimeout(300);
  const bot = await p.evaluate(()=>document.querySelector('.about').classList.contains('more'));
  console.log('fade at top: '+top+'   fade at bottom: '+bot);
  await p.screenshot({path:'about-end.png'});
  console.log(errs.length?'ERRORS: '+errs.join(' | '):'no page errors');
  await b.close();
})();
