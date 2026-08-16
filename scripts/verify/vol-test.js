const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const ctx = await b.newContext({viewport:{width:1500,height:940}});
  const p = await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://localhost:8484/index.html',{waitUntil:'load'});
  await p.waitForTimeout(2200);
  await p.evaluate(()=>{const s=document.getElementById('sVol'); s.value=37;
    s.dispatchEvent(new Event('input',{bubbles:true}));
    s.dispatchEvent(new Event('change',{bubbles:true}));});
  await p.waitForTimeout(300);
  const set = await p.evaluate(()=>({slider:+document.getElementById('sVol').value,
    label:document.getElementById('vVol').textContent,
    stored:localStorage.getItem('deadwax.vol.v1')}));
  console.log('after set: '+JSON.stringify(set));
  // reload in the SAME context so localStorage survives
  await p.reload({waitUntil:'load'}); await p.waitForTimeout(2200);
  const back = await p.evaluate(()=>({slider:+document.getElementById('sVol').value,
    label:document.getElementById('vVol').textContent}));
  console.log('after reload: '+JSON.stringify(back));
  console.log(back.slider===37 && back.label==='37%' ? 'PASS volume remembered' : 'FAIL');
  // scrollbar
  await p.click('#bAbout'); await p.waitForTimeout(500);
  const sb = await p.evaluate(()=>{const a=document.querySelector('.about');
    return {barPx:a.offsetWidth-a.clientWidth, scrolls:a.scrollHeight>a.clientHeight};});
  console.log('scrollbar width: '+sb.barPx+'px, still scrolls: '+sb.scrolls);
  await p.evaluate(()=>{const a=document.querySelector('.about'); a.scrollTop=a.scrollHeight;});
  await p.waitForTimeout(300);
  await p.screenshot({path:'about-end.png'});
  console.log(errs.length?'ERRORS: '+errs.join(' | '):'no page errors');
  await b.close();
})();
