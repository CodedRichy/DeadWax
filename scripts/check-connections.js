// Connection check for every data source Deadwax touches.
//
// Reads .env at runtime and prints PASS/FAIL only -- never a credential value,
// so the output is safe to paste anywhere. Run: node scripts/check-connections.js
const fs = require('fs');
const path = require('path');

const ENV = {};
try {
  const raw = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) ENV[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
} catch (e) {
  console.log('FAIL  .env  -- not readable: ' + e.code);
  process.exit(1);
}

const has = k => !!(ENV[k] && ENV[k].length);
const rows = [];
const add = (name, ok, note) => rows.push({ name, ok, note });

// MusicBrainz insists on a real contact string; the default UA gets you blocked.
const MB_UA = ENV.MUSICBRAINZ_UA || 'Deadwax/0.1 ( unset )';

async function json(url, opts) {
  const r = await fetch(url, opts);
  let body = null;
  try { body = await r.json(); } catch (_) {}
  return { status: r.status, body };
}

(async () => {
  // ---- ListenBrainz: the shipping source -------------------------------
  if (!has('LISTENBRAINZ_TOKEN')) {
    add('ListenBrainz token', false, 'LISTENBRAINZ_TOKEN not set in .env');
  } else {
    try {
      const r = await json('https://api.listenbrainz.org/1/validate-token', {
        headers: { Authorization: `Token ${ENV.LISTENBRAINZ_TOKEN}` },
      });
      const valid = r.body && r.body.valid;
      add('ListenBrainz token', !!valid,
        valid ? `valid, user "${r.body.user_name}"` : `HTTP ${r.status} — token rejected`);
      if (valid && !ENV.LISTENBRAINZ_USER) ENV.LISTENBRAINZ_USER = r.body.user_name;
    } catch (e) { add('ListenBrainz token', false, e.message); }
  }

  // The token can be perfectly valid against an empty account. That is the
  // failure mode that actually matters here, so count the listens.
  if (has('LISTENBRAINZ_USER')) {
    try {
      const u = encodeURIComponent(ENV.LISTENBRAINZ_USER);
      const r = await json(`https://api.listenbrainz.org/1/user/${u}/listen-count`);
      const n = r.body && r.body.payload && r.body.payload.count;
      add('ListenBrainz history', typeof n === 'number' && n > 0,
        typeof n === 'number'
          ? `${n.toLocaleString()} listens`
          : `HTTP ${r.status} — no count returned`);
    } catch (e) { add('ListenBrainz history', false, e.message); }
  } else {
    add('ListenBrainz history', false, 'LISTENBRAINZ_USER not set');
  }

  // ---- MusicBrainz: unauthenticated reads ------------------------------
  try {
    const r = await json(
      'https://musicbrainz.org/ws/2/release-group?query=artist:PARTYNEXTDOOR&limit=1&fmt=json',
      { headers: { 'User-Agent': MB_UA } });
    const n = r.body && r.body.count;
    add('MusicBrainz read', r.status === 200 && typeof n === 'number',
      r.status === 200 ? `HTTP 200, ${n} release groups` : `HTTP ${r.status}`);
  } catch (e) { add('MusicBrainz read', false, e.message); }

  add('MusicBrainz UA', has('MUSICBRAINZ_UA'),
    has('MUSICBRAINZ_UA') ? 'set' : 'unset — you will be rate-limited or blocked');

  // ---- Cover Art Archive -----------------------------------------------
  try {
    // a stable, well-known MBID: Nirvana, Nevermind
    const r = await fetch(
      'https://coverartarchive.org/release-group/1b022e01-4da6-387b-8658-8678046e4cef',
      { headers: { 'User-Agent': MB_UA } });
    add('Cover Art Archive', r.status === 200 || r.status === 307, `HTTP ${r.status}`);
  } catch (e) { add('Cover Art Archive', false, e.message); }

  // ---- Last.fm: where the history actually lives right now --------------
  if (!has('LASTFM_API_KEY') || !has('LASTFM_USER')) {
    add('Last.fm', false, 'LASTFM_API_KEY or LASTFM_USER not set');
  } else {
    try {
      const r = await json('https://ws.audioscrobbler.com/2.0/?method=user.getinfo'
        + `&user=${encodeURIComponent(ENV.LASTFM_USER)}`
        + `&api_key=${ENV.LASTFM_API_KEY}&format=json`);
      const p = r.body && r.body.user && r.body.user.playcount;
      add('Last.fm', !!p, p ? `${(+p).toLocaleString()} scrobbles as ${ENV.LASTFM_USER}`
                            : `HTTP ${r.status} — ${(r.body && r.body.message) || 'no user'}`);
    } catch (e) { add('Last.fm', false, e.message); }
  }

  // ---- MetaBrainz OAuth app: presence only ------------------------------
  // Not exercised: the token endpoint needs a user-consented code, and this app
  // has no reason to read anyone else's account yet.
  add('MetaBrainz OAuth', has('METABRAINZ_CLIENT_ID') && has('METABRAINZ_CLIENT_SECRET'),
    has('METABRAINZ_CLIENT_ID')
      ? 'id + secret present (unused — reads need no auth)'
      : 'not set (fine — not required)');

  const w = Math.max(...rows.map(r => r.name.length));
  console.log('');
  for (const r of rows)
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(w)}  ${r.note}`);
  console.log('');
  const bad = rows.filter(r => !r.ok).length;
  console.log(bad ? `${bad} of ${rows.length} checks failed.` : 'All checks passed.');
})();
