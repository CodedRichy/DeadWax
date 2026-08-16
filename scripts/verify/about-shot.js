const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const p = await b.newPage({viewport:{width:1500,height:940}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://localhost:8484/index.html',{waitUntil:'load'});
  await p.waitForTimeout(2200);
  await p.evaluate(()=>{
    const mk=(a,al,t)=>({artist:a,album:al,art:null,tracks:t.map(([n,s,pl])=>({t:n,sec:s,loud:.6,plays:pl}))});
    SHELF.length=0; SHELF.push(mk('PARTYNEXTDOOR','P4',[['Make It',212,33],['Resentment',226,4]]));
    renderShelf(); selectRecord(SHELF[0],0);
  });
  await p.waitForTimeout(700);
  await p.click('#bAbout'); await p.waitForTimeout(600);
  await p.evaluate(()=>document.querySelectorAll('*').forEach(e=>e.getAnimations().forEach(a=>a.finish())));
  const st = await p.evaluate(()=>({open:document.body.classList.contains('modalopen'),
    cancelHidden:getComputedStyle(document.getElementById('modalNo')).display==='none',
    scrollable:(()=>{const a=document.querySelector('.about');return a?a.scrollHeight>a.clientHeight:null})()}));
  console.log(JSON.stringify(st));
  await p.screenshot({path:'about.png'});
  console.log(errs.length?'ERRORS: '+errs.join(' | '):'no page errors');
  await b.close();
})();
