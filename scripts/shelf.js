// Correct shelf sizing, using lifetime counts instead of a scrobble sample.
//
// Supersedes album-shape.js / coverage-rule.js, both of which paginated
// user.getRecentTracks and only ever saw the most recent ~8000 scrobbles.
// user.getTopAlbums&period=overall returns true lifetime counts in 3 calls.
//
// Rule under test: an album is PRESSED when you have heard enough of it,
// regardless of order. Sequential front-to-back is dead -- 98% of this user's
// listening runs are a single track.

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

// Deluxe/remaster editions fragment counts across what is really one record.
const norm = s => s.toLowerCase()
  .replace(/\s*[\(\[](deluxe|deluxe edition|remaster(ed)?|remastered \d{4}|\d{4} remaster|anniversary|special|expanded|explicit|bonus[^)\]]*|standard)[^)\]]*[\)\]]/g,'')
  .replace(/\s*-\s*(deluxe|remaster(ed)?|ep|single)$/,'')
  .replace(/\s+/g,' ').trim();

(async () => {
  const U = env.LASTFM_USER;
  const info = await call({method:'user.getInfo', user:U});
  const total = parseInt(info.user.playcount,10);
  const reg   = new Date(parseInt(info.user.registered.unixtime,10)*1000);
  console.log(`user ${U}: ${total} scrobbles since ${reg.toISOString().slice(0,10)}`);
  console.log(`  ${info.user.album_count} albums, ${info.user.track_count} tracks\n`);

  // --- lifetime per-album and per-track counts, 1000 per page ---------------
  const pull = async (method, item) => {
    const out = []; let page = 1, totalPages = 1;
    do {
      const j = await call({method, user:U, period:'overall', limit:1000, page});
      // response root key varies in case between methods -- take whatever is there
      const root = j[Object.keys(j)[0]];
      totalPages = parseInt(root['@attr'].totalPages,10);
      const rows = root[item];
      out.push(...(Array.isArray(rows) ? rows : rows ? [rows] : []));
      page++; await sleep(200);
    } while (page <= totalPages);
    return out;
  };
  const albums = await pull('user.getTopAlbums','album');
  const tracks = await pull('user.getTopTracks','track');
  console.log(`pulled ${albums.length} albums, ${tracks.length} tracks (lifetime)\n`);

  // --- merge editions -------------------------------------------------------
  const merged = new Map();
  for (const a of albums){
    const k = `${a.artist.name.toLowerCase()}|||${norm(a.name)}`;
    if(!merged.has(k)) merged.set(k,{artist:a.artist.name, album:a.name, plays:0});
    merged.get(k).plays += parseInt(a.playcount,10);
  }
  console.log(`${albums.length} albums -> ${merged.size} after merging editions\n`);

  // --- how many distinct tracks of each album has the user heard? -----------
  // getTopTracks has no album field, so join by album tracklist below.
  const trackPlays = new Map();
  for (const t of tracks)
    trackPlays.set(`${t.artist.name.toLowerCase()}|||${t.name.toLowerCase()}`, parseInt(t.playcount,10));

  const cands = [...merged.values()].sort((a,b)=>b.plays-a.plays).slice(0,150);
  process.stderr.write(`resolving ${cands.length} tracklists...\n`);
  const shelf = [];
  for (const a of cands){
    let j; try { j = await call({method:'album.getInfo', artist:a.artist, album:a.album, autocorrect:1}); }
    catch(e){ continue; }
    const tr = j.album && j.album.tracks && j.album.tracks.track;
    const list = Array.isArray(tr) ? tr : (tr ? [tr] : []);
    if (list.length < 5) { await sleep(200); continue; }
    const per = list.map(t => trackPlays.get(`${a.artist.toLowerCase()}|||${t.name.toLowerCase()}`) || 0);
    const heard = per.filter(n => n > 0).length;
    shelf.push({...a, len:list.length, heard, cov:heard/list.length, per});
    await sleep(200);
  }

  console.log('Shelf size by coverage threshold:');
  for (const th of [0.4,0.5,0.6,0.7,0.8]){
    console.log(`  coverage >= ${(th*100).toFixed(0)}% : ${shelf.filter(a=>a.cov>=th).length} records`);
  }

  const press = shelf.filter(a=>a.cov>=0.6).sort((x,y)=>y.plays-x.plays);
  console.log(`\nPressed at 60% coverage -- ${press.length} records:\n`);
  for (const a of press){
    const nz = a.per.filter(n=>n>0);
    console.log(`  ${String(a.plays).padStart(4)} plays  ${a.heard}/${a.len} (${(a.cov*100).toFixed(0)}%)`
      + `  wear ${Math.min(...nz)}-${Math.max(...nz)}x  :  ${a.artist} - ${a.album}`);
  }
})().catch(e=>{ console.error('FAILED:', e.message); process.exit(1); });
