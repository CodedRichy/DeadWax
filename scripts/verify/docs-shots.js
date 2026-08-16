// README images. Seeded with demo records on purpose -- the old hero.png was a
// screenshot of the real personal history, and those numbers are permanent once
// they are in a public repo.
const { chromium } = require('playwright');
const SEED = () => {
  const mk = (artist, album, tracks) => ({ artist, album, art: null,
    tracks: tracks.map(([t, sec, plays]) => ({ t, sec, loud: .6, plays })) });
  SHELF.length = 0;
  SHELF.push(mk('Pierce The Veil','Misadventures',[['Dive In',208,141],
    ['Texas Is Forever',236,96],['Floral & Fading',251,41],['Phantom Power',224,22],
    ['Circles',262,9],['Gold Medal Ribbon',245,3],['Bedless',231,1],['Sambuka',258,0]]));
  SHELF.push(mk('Alvvays','Blue Rev',[['Pharmacist',189,77],['Belinda Says',231,55],
    ['Very Online Guy',204,31],['Easy On Your Own?',248,12]]));
  SHELF.push(mk('Big Thief','Dragon New Warm Mountain',[['Time Escaping',215,64],
    ['Certainty',232,38],['Spud Infinity',248,17]]));
  SHELF.push(mk('Fontaines D.C.','Skinty Fia',[['Jackie Down The Line',241,58],
    ['Roman Holiday',252,29]]));
  renderShelf(); selectRecord(SHELF[0], 0);
};
(async () => {
  const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const p = await b.newPage({viewport:{width:1800,height:1013},deviceScaleFactor:1});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://localhost:8484/index.html',{waitUntil:'load'});
  await p.waitForTimeout(2400);
  await p.evaluate(SEED);
  await p.waitForTimeout(1200);
  await p.screenshot({path:'docs/hero.png'});
  console.log('wrote docs/hero.png');
  await p.click('#bShelf'); await p.waitForTimeout(900);
  await p.evaluate(()=>document.querySelectorAll('*').forEach(e=>e.getAnimations().forEach(a=>a.finish())));
  await p.waitForTimeout(500);
  await p.screenshot({path:'docs/crate.png'});
  console.log('wrote docs/crate.png');
  console.log(errs.length?'ERRORS: '+errs.join(' | '):'no page errors');
  await b.close();
})();
