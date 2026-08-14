// Diagnostic for album-shape.js. Is the "shuffle-shaped" verdict real, or did
// the run-detection logic break? Prints the raw distribution so the verdict
// can be checked by eye rather than trusted.

const fs = require('fs'), path = require('path');
const env = {};
for (const line of fs.readFileSync(path.resolve(__dirname, '..', '.env'), 'utf-8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].trim();
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const call = async p => {
  const qs = new URLSearchParams({ ...p, api_key: env.LASTFM_API_KEY, format: 'json' });
  const r = await fetch(`https://ws.audioscrobbler.com/2.0/?${qs}`); return r.json();
};

(async () => {
  const s = [];
  for (let page = 1; page <= 40; page++) {
    const j = await call({ method: 'user.getRecentTracks', user: env.LASTFM_USER, limit: 200, page });
    for (const t of j.recenttracks.track || []) {
      if (!t.date) continue;
      s.push({ artist: (t.artist['#text']||'').trim(), album: (t.album['#text']||'').trim(),
               track: (t.name||'').trim(), ts: parseInt(t.date.uts,10) });
    }
    await sleep(160);
  }
  s.sort((a,b)=>a.ts-b.ts);

  // run-length histogram
  const runs = []; let cur = null;
  for (let i=0;i<s.length;i++){
    const x=s[i], prev=s[i-1];
    const newSess = !prev || (x.ts-prev.ts) > 20*60;
    if (cur && !newSess && cur.artist===x.artist && cur.album===x.album && x.album){ cur.tracks.add(x.track); cur.n++; }
    else { if(cur) runs.push(cur); cur = x.album ? {artist:x.artist,album:x.album,tracks:new Set([x.track]),n:1} : null; }
  }
  if (cur) runs.push(cur);

  const hist = {};
  for (const r of runs) { const b = r.tracks.size; hist[b] = (hist[b]||0)+1; }
  console.log('Distinct-tracks-per-run histogram:');
  for (const k of Object.keys(hist).map(Number).sort((a,b)=>a-b))
    console.log(`  ${String(k).padStart(3)} tracks : ${hist[k]} runs`);

  // gap distribution -- is 20 min the wrong session boundary?
  const gaps = [];
  for (let i=1;i<s.length;i++) gaps.push((s[i].ts-s[i-1].ts)/60);
  gaps.sort((a,b)=>a-b);
  const q = p => gaps[Math.floor(p*gaps.length)].toFixed(1);
  console.log(`\nInter-scrobble gap minutes: p25=${q(.25)} p50=${q(.5)} p75=${q(.75)} p90=${q(.9)}`);

  // consecutive same-ARTIST runs -- looser than album
  let artRuns=[], c2=null;
  for (let i=0;i<s.length;i++){
    const x=s[i], prev=s[i-1];
    const newSess = !prev || (x.ts-prev.ts) > 20*60;
    if (c2 && !newSess && c2.artist===x.artist){ c2.n++; } else { if(c2) artRuns.push(c2); c2={artist:x.artist,n:1}; }
  }
  if(c2) artRuns.push(c2);
  const longArt = artRuns.filter(r=>r.n>=5).length;
  console.log(`Same-artist runs of 5+ consecutive scrobbles: ${longArt} of ${artRuns.length}`);

  // top albums by raw scrobble count, ignoring order entirely
  const byAlbum = {};
  for (const x of s) if (x.album) { const k=`${x.artist} - ${x.album}`; (byAlbum[k]=byAlbum[k]||{n:0,tr:new Set()}); byAlbum[k].n++; byAlbum[k].tr.add(x.track); }
  const top = Object.entries(byAlbum).sort((a,b)=>b[1].n-a[1].n).slice(0,15);
  console.log('\nTop albums by total scrobbles (order ignored):');
  for (const [k,v] of top) console.log(`  ${String(v.n).padStart(4)} plays, ${String(v.tr.size).padStart(2)} distinct tracks : ${k}`);

  console.log(`\nDistinct albums: ${Object.keys(byAlbum).length}  Distinct tracks: ${new Set(s.map(x=>x.track)).size}`);
})();
