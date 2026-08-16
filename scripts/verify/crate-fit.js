const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  for(const [w,h] of [[1800,1013],[1500,900],[1920,1080]]){
    const p = await b.newPage({viewport:{width:w,height:h}});
    await p.goto('http://localhost:8484/index.html',{waitUntil:'load'});
    await p.waitForTimeout(1900);
    await p.evaluate(()=>{
      const mk=(a,al,t)=>({artist:a,album:al,art:null,tracks:t.map(([n,s,pl])=>({t:n,sec:s,loud:.6,plays:pl}))});
      SHELF.length=0;
      for(const n of ['A','B','C','D']) SHELF.push(mk('Artist '+n,'Album '+n,[['T1',210,20]]));
      renderShelf(); selectRecord(SHELF[0],0);
    });
    await p.click('#bShelf'); await p.waitForTimeout(1100);
    await p.evaluate(()=>document.querySelectorAll('*').forEach(e=>e.getAnimations().forEach(a=>a.finish())));
    const m = await p.evaluate(()=>{
      const on = document.querySelector('#rail .slv.on');
      const r = on.getBoundingClientRect();
      const cap = document.getElementById('crateCap').getBoundingClientRect();
      const slv = getComputedStyle(document.documentElement).getPropertyValue('--slv').trim();
      return { slv, left:Math.round(r.left), right:Math.round(r.right),
               top:Math.round(r.top), bottom:Math.round(r.bottom),
               cx:Math.round(r.left+r.width/2), cy:Math.round(r.top+r.height/2),
               wPct:+(100*r.width/innerWidth).toFixed(1),
               hPct:+(100*r.height/innerHeight).toFixed(1),
               capTop:Math.round(cap.top), overlapsCap: r.bottom > cap.top };
    });
    console.log(`${w}x${h}  --slv=${m.slv}  sleeve ${m.wPct}%w ${m.hPct}%h  centre(${m.cx},${m.cy}) want(${w/2},${h/2})  dx=${m.cx-w/2}  overlapsCaption=${m.overlapsCap}`);
    await p.close();
  }
  await b.close();
})();
