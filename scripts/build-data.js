// Bakes the user's real Last.fm shelf into a JS file the prototype can load.
//
// The prototype runs from file://, where fetch() of a sibling JSON is blocked
// but <script src> is not. So we emit assignable JS, not JSON, and inline the
// album art as data URIs (a file:// <img> would taint the WebGL texture).
//
//   node scripts/build-data.js   ->   deadwax-data.js

const fs = require('fs'), path = require('path');
const env = {};
for (const l of fs.readFileSync(path.resolve(__dirname,'..','.env'),'utf-8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].trim();
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(p){
  const qs = new URLSearchParams({...p, api_key: env.LASTFM_API_KEY, format:'json'});
  for(let a=0;a<4;a++){
    const r = await fetch(`https://ws.audioscrobbler.com/2.0/?${qs}`);
    if(r.status===429){ await sleep(2000*(a+1)); continue; }
    const j = await r.json();
    if(j.error) throw new Error(`last.fm ${j.error}: ${j.message}`);
    return j;
  }
  throw new Error('rate limited');
}

const COVERAGE = 0.50;          // PRD 6.2 -- pressed at 50% of distinct tracks
const MAX_ALBUMS = 12;
const PLACEHOLDER = '2a96cbd8b46e442fc41c2b86b821562f';   // returns HTTP 200

const norm = s => s.toLowerCase()
  .replace(/\s*[\(\[](deluxe|remaster(ed)?|anniversary|special|expanded|explicit|bonus[^)\]]*|standard)[^)\]]*[\)\]]/g,'')
  .replace(/\s+/g,' ').trim();

// Groove pitch needs a loudness envelope we do not have from scrobble data.
// This is the DurationEstimator of TRD section 5 -- deterministic per title so
// the banding is stable between builds, and clearly not real analysis.
function estimateLoud(title){
  let h = 0; for (let i=0;i<title.length;i++) h = (h*31 + title.charCodeAt(i)) | 0;
  return 0.25 + (Math.abs(h) % 1000)/1000 * 0.6;
}

// iTunes Search: keyless, and one album lookup returns every track's 30s
// previewUrl. Prototype only -- the shipped app never plays audio (TRD 2).
async function itunesPreviews(artist, album){
  const out = new Map();
  try{
    const q = encodeURIComponent(`${artist} ${album}`);
    const s = await fetch(`https://itunes.apple.com/search?term=${q}&entity=album&limit=1`);
    const sj = await s.json();
    if(!sj.results || !sj.results.length) return out;
    const id = sj.results[0].collectionId;
    await sleep(400);   // ~20 req/min per IP, undocumented
    const l = await fetch(`https://itunes.apple.com/lookup?id=${id}&entity=song&limit=200`);
    const lj = await l.json();
    for(const r of lj.results || [])
      if(r.wrapperType === 'track' && r.previewUrl)
        out.set(r.trackName.toLowerCase(), r.previewUrl);
  }catch(e){ /* previews are optional */ }
  return out;
}

async function artDataUri(url){
  if(!url || url.includes(PLACEHOLDER)) return null;
  try{
    const r = await fetch(url);
    if(!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if(buf.length > 400_000) return null;
    return `data:${r.headers.get('content-type')||'image/jpeg'};base64,${buf.toString('base64')}`;
  }catch(e){ return null; }
}

(async () => {
  const U = env.LASTFM_USER;
  const info = await call({method:'user.getInfo', user:U});
  console.log(`${U}: ${info.user.playcount} scrobbles, ${info.user.album_count} albums`);

  const pull = async (method, item) => {
    const out = []; let page = 1, pages = 1;
    do {
      const j = await call({method, user:U, period:'overall', limit:1000, page});
      const root = j[Object.keys(j)[0]];
      pages = parseInt(root['@attr'].totalPages,10);
      const rows = root[item];
      out.push(...(Array.isArray(rows)?rows:rows?[rows]:[]));
      page++; await sleep(200);
    } while (page <= pages);
    return out;
  };

  const albums = await pull('user.getTopAlbums','album');
  const tracks = await pull('user.getTopTracks','track');
  console.log(`pulled ${albums.length} albums, ${tracks.length} tracks`);

  const trackPlays = new Map();
  for (const t of tracks)
    trackPlays.set(`${t.artist.name.toLowerCase()}|||${t.name.toLowerCase()}`, parseInt(t.playcount,10));

  // merge deluxe/remaster editions into one record
  const merged = new Map();
  for (const a of albums){
    const k = `${a.artist.name.toLowerCase()}|||${norm(a.name)}`;
    if(!merged.has(k)) merged.set(k,{artist:a.artist.name, album:a.name, plays:0});
    merged.get(k).plays += parseInt(a.playcount,10);
  }

  const cands = [...merged.values()].sort((a,b)=>b.plays-a.plays).slice(0,120);
  const shelf = [];
  for (const a of cands){
    if (shelf.length >= MAX_ALBUMS) break;
    let j; try { j = await call({method:'album.getInfo', artist:a.artist, album:a.album, autocorrect:1}); }
    catch(e){ await sleep(200); continue; }
    const alb = j.album; if(!alb){ await sleep(200); continue; }
    const tr = alb.tracks && alb.tracks.track;
    const list = Array.isArray(tr) ? tr : (tr ? [tr] : []);
    if (list.length < 5) { await sleep(200); continue; }

    const rows = list.map(t => ({
      t: t.name,
      sec: parseInt(t.duration,10) || 0,
      plays: trackPlays.get(`${a.artist.toLowerCase()}|||${t.name.toLowerCase()}`) || 0,
      loud: estimateLoud(t.name),
    }));
    const heard = rows.filter(r => r.plays > 0).length;
    if (heard / rows.length < COVERAGE) { await sleep(200); continue; }

    const prev = await itunesPreviews(a.artist, alb.name);
    let got = 0;
    for (const r of rows){
      r.prev = prev.get(r.t.toLowerCase()) || null;
      if (r.prev) got++;
    }
    await sleep(400);

    // durations are often null on last.fm -- fall back to the album median
    const known = rows.map(r=>r.sec).filter(s=>s>30).sort((x,y)=>x-y);
    const med = known.length ? known[Math.floor(known.length/2)] : 225;
    for (const r of rows) if (r.sec < 30) r.sec = med;

    // strip the size segment for the original upload (see lastfm-api note)
    const imgs = alb.image || [];
    const big = imgs.length ? imgs[imgs.length-1]['#text'] : '';
    const art = await artDataUri(big.replace(/\/i\/u\/[^/]+\//, '/i/u/300x300/'));

    shelf.push({
      artist: a.artist, album: alb.name, plays: a.plays,
      heard, len: rows.length, art, tracks: rows,
    });
    console.log(`  + ${a.artist} - ${alb.name}  ${heard}/${rows.length}  ${a.plays} plays`
      + `${art?'':'  (no art)'}  ${got}/${rows.length} previews`);
    await sleep(200);
  }

  const out = `// GENERATED by scripts/build-data.js -- do not edit.\n`
            + `// Real listening history for ${U}. Regenerate with: node scripts/build-data.js\n`
            + `window.DEADWAX = ${JSON.stringify({user:U, built:new Date().toISOString().slice(0,10), shelf}, null, 1)};\n`;
  const dest = path.resolve(__dirname, '..', 'deadwax-data.js');
  fs.writeFileSync(dest, out, 'utf-8');
  console.log(`\nwrote deadwax-data.js  (${shelf.length} records, ${(out.length/1024).toFixed(0)} KB)`);
})().catch(e=>{ console.error('FAILED:', e.message); process.exit(1); });
