// Contact sheet: every ink against every layout, so the set can be judged as a
// set. One sleeve always looks fine; twelve is where a template shows.
const { chromium } = require('playwright');
const NAMES = [
  ['Pierce The Veil','Misadventures'], ['Alvvays','Blue Rev'],
  ['Big Thief','Dragon New Warm Mountain'], ['Fontaines D.C.','Skinty Fia'],
  ['Black Country','New Road'], ['Sufjan Stevens','Carrie & Lowell'],
  ['Slowdive','Souvlaki'], ['The Cure','Disintegration'],
  ['Portishead','Dummy'], ['Boards Of Canada','Geogaddi'],
  ['Aphex Twin','Selected Ambient Works'], ['Cocteau Twins','Heaven Or Las Vegas'],
];
(async () => {
  const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const p = await b.newPage({viewport:{width:1360,height:1100}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://localhost:8484/index.html',{waitUntil:'load'});
  await p.waitForTimeout(2600);
  await p.evaluate(async (names)=>{
    await document.fonts.ready;
    document.body.innerHTML = '';
    document.body.style.cssText='background:#0b0b0d;margin:0;padding:22px;'
      +'display:grid;grid-template-columns:repeat(4,1fr);gap:18px';
    for(const [a,al] of names){
      const im = new Image();
      im.src = window.genSleeve(a, al);
      im.style.cssText='width:100%;display:block';
      document.body.appendChild(im);
    }
    await new Promise(r=>setTimeout(r,600));
  }, NAMES);
  await p.waitForTimeout(900);
  await p.screenshot({path:'sleeves.png',fullPage:true});
  console.log(errs.length?'ERRORS: '+errs.join(' | '):'no page errors');
  await b.close();
})();
