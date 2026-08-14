// Deadwax on localhost: static files plus one live endpoint.
//
//   node scripts/serve.js     ->   http://127.0.0.1:8484
//
// Two things this fixes that file:// cannot.
//
// 1. The API key stays out of the page. Last.fm's key is a query parameter,
//    so a page that calls the API directly ships the key to every visitor.
//    Here the browser calls /api/now and this process holds the key -- the
//    same arrangement a deployed build would use, just with the function
//    running on your own machine instead of someone's edge.
// 2. It is a real origin. The prototype's file:// workarounds -- data-URI art
//    so the WebGL texture is not tainted, deadwax-data.js emitted as
//    assignable JS because fetch() of a sibling JSON is blocked -- exist
//    because of file://, and none of them are needed over http.
//
// No dependencies, no build step. The page is still one HTML file.

const fs = require('fs'), path = require('path'), http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PORT = +process.env.PORT || 8484;

// Same .env reader as scripts/build-data.js. Deliberately not a library and
// deliberately not cached -- edit .env, hit reload, no restart.
function env(){
  const out = {};
  let raw = '';
  try { raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8'); }
  catch { return out; }
  for (const l of raw.split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const TYPES = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',   '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml',
  '.woff2':'font/woff2', '.ico':'image/x-icon',
};

// ---- last.fm ------------------------------------------------------------
// user.getRecentTracks is the only call that reports what is playing RIGHT
// now: the head track carries @attr.nowplaying="true" and, unlike every other
// track in the list, has no date. Poll it; there is no push side to Last.fm.
async function nowPlaying(){
  const e = env();
  if (!e.LASTFM_API_KEY) throw Object.assign(new Error('LASTFM_API_KEY missing from .env'), { code: 'NOKEY' });
  if (!e.LASTFM_USER)    throw Object.assign(new Error('LASTFM_USER missing from .env'),    { code: 'NOKEY' });

  const qs = new URLSearchParams({
    method: 'user.getrecenttracks', user: e.LASTFM_USER,
    api_key: e.LASTFM_API_KEY, format: 'json', limit: '1', extended: '0',
  });
  const r = await fetch(`https://ws.audioscrobbler.com/2.0/?${qs}`, {
    headers: { 'user-agent': e.MUSICBRAINZ_UA || 'Deadwax/0.1' },
  });
  if (r.status === 429) throw Object.assign(new Error('rate limited'), { code: 'RATE' });
  const j = await r.json();
  if (j.error) throw Object.assign(new Error(`last.fm ${j.error}: ${j.message}`), { code: 'API' });

  const t = [].concat(j.recenttracks && j.recenttracks.track || [])[0];
  if (!t) return { playing: false };

  // The flag is a string, and it is absent rather than "false" when the user
  // is not listening -- do not compare it to a boolean.
  const live = !!(t['@attr'] && t['@attr'].nowplaying === 'true');
  return {
    playing: live,
    artist: (t.artist && (t.artist['#text'] || t.artist.name)) || '',
    track:  t.name || '',
    album:  (t.album && t.album['#text']) || '',
    // largest of the fixed-size variants last.fm returns
    art:    ([].concat(t.image || []).pop() || {})['#text'] || '',
    // only meaningful for a scrobbled track, absent while one is playing
    at:     t.date ? +t.date.uts : null,
  };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/now') {
    try {
      const body = JSON.stringify(await nowPlaying());
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8',
                           'cache-control': 'no-store' });
      return res.end(body);
    } catch (err) {
      // The page has to keep working when this fails, so the failure is data,
      // not a dead socket: it renders the baked shelf and says so.
      res.writeHead(err.code === 'NOKEY' ? 503 : 502,
                    { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ playing: false, error: err.message, code: err.code || 'NET' }));
    }
  }

  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/deadwax-platter.html';
  const file = path.join(ROOT, p);
  // no traversal, and .env is never servable even by exact path
  if (!file.startsWith(ROOT + path.sep) || path.basename(file) === '.env') {
    res.writeHead(403); return res.end('forbidden');
  }
  fs.readFile(file, (e, buf) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
                         'cache-control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, '127.0.0.1', () => {
  const e = env();
  console.log(`deadwax  http://127.0.0.1:${PORT}`);
  console.log(e.LASTFM_API_KEY && e.LASTFM_USER
    ? `now-playing: polling last.fm as ${e.LASTFM_USER}`
    : `now-playing: OFF -- set LASTFM_API_KEY and LASTFM_USER in .env`);
});
