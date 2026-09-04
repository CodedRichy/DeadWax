const { chromium } = require('playwright');
const { pathToFileURL } = require('url');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:1500,height:1150}, deviceScaleFactor:1 });
  const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  await p.goto(pathToFileURL(process.argv[2]).href, { waitUntil:'networkidle' });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: process.argv[3], fullPage:true });
  console.log(JSON.stringify({errs}));
  await b.close();
})();
