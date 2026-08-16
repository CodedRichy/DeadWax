const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const p = await b.newPage({viewport:{width:1920,height:900}});
  await p.goto('http://localhost:8484/index.html',{waitUntil:'load'});
  await p.waitForTimeout(2200);
  await p.evaluate(()=>{
    const mk=(a,al,t)=>({artist:a,album:al,art:null,tracks:t.map(([n,s,pl])=>({t:n,sec:s,loud:.6,plays:pl}))});
    SHELF.length=0; SHELF.push(mk('PARTYNEXTDOOR','P4',[['Make It',212,33],['Resentment',226,4]]));
    renderShelf(); selectRecord(SHELF[0],0);
  });
  await p.waitForTimeout(900);
  const r = await p.evaluate(()=>{
    const g=s=>{const e=document.querySelector(s); if(!e)return null;
      const b=e.getBoundingClientRect(); return {fromBottom:Math.round(innerHeight-b.bottom),h:Math.round(b.height)};};
    return { transport_text: (()=>{const btn=document.querySelector('#cue button');
        const cs=getComputedStyle(btn), b=btn.getBoundingClientRect();
        return {fromBottom:Math.round(innerHeight-(b.bottom-parseFloat(cs.paddingBottom)))};})(),
      np_lastline_meta: g('#np .m'), np_stylus: g('#stylusInfo'), np_block: g('#np'),
      yt_input: g('#ytUrl'), yt_block: g('#yt') };
  });
  console.log(JSON.stringify(r,null,1));
  await p.screenshot({path:'baseline.png'});
  // with a status message showing
  await p.evaluate(()=>{document.getElementById('ytMsg').textContent='that video would not load · try another';});
  await p.waitForTimeout(300);
  const r2 = await p.evaluate(()=>{const b=document.getElementById('ytUrl').getBoundingClientRect();
    return Math.round(innerHeight-b.bottom);});
  console.log('yt_input fromBottom WITH message: '+r2);
  await p.screenshot({path:'baseline-msg.png'});
  await b.close();
})();
