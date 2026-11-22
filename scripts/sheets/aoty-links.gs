/**
 * Albums of the Year: find Listen, Buy and cover links, right in the sheet.
 * (Google Apps Script. Paste into Extensions → Apps Script in a year's sheet.)
 *
 * Adds an "Albums" menu:
 *   Find links (one batch)       ~5 minutes of lookups, then stops; run again to continue
 *   Keep finding links…          repeats every 5 minutes until every row has been checked
 *   Stop                         cancels the repeating run
 *
 * Works on the tab that has a LISTEN column (the tab you're on when you start it).
 * Column A is "Artist - Title". The script fills, never overwrites:
 *   LISTEN      Apple Music link (the site turns it into an album.link page)
 *   BUY         Bandcamp album page, when MusicBrainz lists one
 *   COVER       cover image address (Apple, else Deezer); the site downloads it
 *   LINK CHECK  what happened, e.g. "2026-11-22 · Listen ✓ · Buy –". A row with
 *               anything here is skipped; clear the cell to have it checked again.
 * COVER and LINK CHECK are added after LISTEN/BUY if missing.
 *
 * How it finds things (no API keys):
 *   Deezer search → the album (and its cover) → its barcode (UPC) → Apple's lookup
 *   by barcode → the Apple Music link. If that misses, Apple's search. Bandcamp links
 *   come from MusicBrainz, which records them for many albums.
 * Source: robmitchum.github.io, scripts/sheets/aoty-links.gs
 */

var CONFIG = {
  secondsPerRun: 270,          // Google stops a run at 6 minutes; leave room to save
  appleGapMs: 3100,            // Apple allows about 20 requests a minute
  musicbrainzGapMs: 1200,      // MusicBrainz asks for at most one a second
  deezerGapMs: 150,
  userAgent: 'robmitchum.com-aoty/1.0 ( https://robmitchum.com )',
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Albums')
    .addItem('Find links (one batch)', 'findLinksBatch')
    .addItem('Keep finding links every 5 minutes', 'startAutomatic')
    .addItem('Stop', 'stopAutomatic')
    .addToUi();
}

// ---------------------------------------------------------------------------
// Menu actions

function findLinksBatch() {
  var sheet = pickSheet_(true);
  if (!sheet) return;
  var result = runBatch_(sheet);
  SpreadsheetApp.getActive().toast(result.message, 'Albums', 10);
}

function startAutomatic() {
  var sheet = pickSheet_(true);
  if (!sheet) return;
  PropertiesService.getDocumentProperties().setProperty('aotySheet', sheet.getName());
  stopTriggers_();
  ScriptApp.newTrigger('automaticRun_').timeBased().everyMinutes(5).create();
  SpreadsheetApp.getActive().toast('Started. A batch runs every 5 minutes on "' + sheet.getName() +
    '" until every row is checked. You can close this tab.', 'Albums', 10);
  automaticRun_();
}

function stopAutomatic() {
  stopTriggers_();
  SpreadsheetApp.getActive().toast('Stopped.', 'Albums', 5);
}

function automaticRun_() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) return; // a batch is still running
  try {
    var name = PropertiesService.getDocumentProperties().getProperty('aotySheet');
    var sheet = name && SpreadsheetApp.getActive().getSheetByName(name);
    if (!sheet) { stopTriggers_(); return; }
    var result = runBatch_(sheet);
    if (result.done) stopTriggers_();
  } finally {
    lock.releaseLock();
  }
}

function stopTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'automaticRun_') ScriptApp.deleteTrigger(t);
  });
}

function pickSheet_(interactive) {
  var sheet = SpreadsheetApp.getActiveSheet();
  if (findColumn_(sheet, 'LISTEN') > 0) return sheet;
  if (interactive) {
    SpreadsheetApp.getUi().alert('Open the tab with the album list (the one with a LISTEN column) and try again.');
  }
  return null;
}

// ---------------------------------------------------------------------------
// The batch

function runBatch_(sheet) {
  var started = Date.now();
  var cols = ensureColumns_(sheet);
  var last = sheet.getLastRow();
  if (last < 2) return { done: true, message: 'No albums found.' };
  var width = sheet.getLastColumn();
  var values = sheet.getRange(1, 1, last, width).getValues();

  var checked = 0, found = { listen: 0, buy: 0, cover: 0 }, left = 0;
  for (var r = 1; r < values.length; r++) {
    var album = String(values[r][0] || '').trim();
    if (!album || String(values[r][cols.check - 1] || '').trim()) continue;
    if ((Date.now() - started) / 1000 > CONFIG.secondsPerRun) { left++; continue; }

    var split = splitAlbum_(album);
    var row = r + 1;
    if (!split) {
      sheet.getRange(row, cols.check).setValue(today_() + ' · skipped: no " - " between artist and title');
      continue;
    }
    var have = {
      listen: String(values[r][cols.listen - 1] || '').trim(),
      buy: String(values[r][cols.buy - 1] || '').trim(),
      cover: String(values[r][cols.cover - 1] || '').trim(),
    };
    var out = lookUp_(split.artist, split.title, have);
    if (out.listen && !have.listen) { sheet.getRange(row, cols.listen).setValue(out.listen); found.listen++; }
    if (out.buy && !have.buy) { sheet.getRange(row, cols.buy).setValue(out.buy); found.buy++; }
    if (out.cover && !have.cover) { sheet.getRange(row, cols.cover).setValue(out.cover); found.cover++; }
    sheet.getRange(row, cols.check).setValue(today_() + ' · ' + out.note);
    SpreadsheetApp.flush();
    checked++;
  }
  var message = 'Checked ' + checked + ' albums: ' + found.listen + ' Listen, ' + found.buy + ' Buy, ' +
    found.cover + ' covers added.' + (left ? ' ' + left + ' still to check; run again.' : ' Every row is checked.');
  return { done: left === 0, message: message };
}

function ensureColumns_(sheet) {
  var listen = findColumn_(sheet, 'LISTEN');
  var buy = findColumn_(sheet, 'BUY');
  if (!buy) { buy = listen + 1; sheet.insertColumnAfter(listen); sheet.getRange(1, buy).setValue('BUY'); }
  var cover = findColumn_(sheet, 'COVER');
  if (!cover) { cover = buy + 1; sheet.insertColumnAfter(buy); sheet.getRange(1, cover).setValue('COVER'); }
  var check = findColumn_(sheet, 'LINK CHECK');
  if (!check) { check = cover + 1; sheet.insertColumnAfter(cover); sheet.getRange(1, check).setValue('LINK CHECK'); }
  // Clip long links and notes instead of wrapping them, so rows stay one line tall.
  [listen, buy, cover, check].forEach(function (c) {
    sheet.getRange(1, c, sheet.getMaxRows(), 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  });
  return { listen: listen, buy: buy, cover: cover, check: check };
}

function findColumn_(sheet, name) {
  var width = sheet.getLastColumn();
  if (!width) return 0;
  var header = sheet.getRange(1, 1, 1, width).getValues()[0];
  for (var i = 0; i < header.length; i++) {
    if (String(header[i]).trim().toUpperCase() === name) return i + 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Lookups for one album

function lookUp_(artist, title, have) {
  var selfTitled = /^(s\/t|self[- ]titled)$/i.test(title.trim());
  var want = wanted_(artist, selfTitled ? artist : title);
  var out = { listen: '', buy: '', cover: '' };
  var notes = [];

  // Listen + cover
  var appleId = have.listen ? (have.listen.match(/music\.apple\.com\/.*\/(\d{6,})/) || [])[1] : null;
  if (!have.listen || !have.cover) {
    var dz = null;
    if (!have.listen || (!have.cover && !appleId)) dz = findDeezer_(artist, title, selfTitled, want);
    var apple = null;
    if (!have.listen) {
      if (dz) apple = appleByUpc_(dz.id);
      if (!apple) apple = findAppleSearch_(artist, selfTitled ? '' : title, want);
      if (apple) out.listen = String(apple.collectionViewUrl).replace(/\?.*$/, '');
    } else if (appleId && !have.cover) {
      apple = appleLookup_({ id: appleId });
    }
    if (!have.cover) {
      if (apple && apple.artworkUrl100) out.cover = apple.artworkUrl100.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/300x300bb.jpg');
      else if (dz) out.cover = dz.md5_image
        ? 'https://e-cdns-images.dzcdn.net/images/cover/' + dz.md5_image + '/300x300-000000-80-0-0.jpg'
        : (dz.cover_medium || '');
    }
  }
  notes.push('Listen ' + (have.listen ? '(yours)' : out.listen ? '✓' : '–'));

  // Buy
  if (!have.buy) {
    try { out.buy = bandcampFromMusicBrainz_(artist, selfTitled ? artist : title, want) || ''; }
    catch (e) { notes.push('MusicBrainz error: ' + e.message); }
  }
  notes.push('Buy ' + (have.buy ? '(yours)' : out.buy ? '✓' : '–'));
  notes.push('Cover ' + (have.cover ? '(yours)' : out.cover ? '✓' : '–'));
  out.note = notes.join(' · ');
  return out;
}

function findDeezer_(artist, title, selfTitled, want) {
  var queries = selfTitled
    ? ['artist:"' + artist + '"', artist]
    : ['artist:"' + artist + '" album:"' + title + '"', artist + ' ' + title, 'album:"' + title + '"'];
  for (var i = 0; i < queries.length; i++) {
    var json = getJson_('https://api.deezer.com/search/album?limit=25&q=' + encodeURIComponent(queries[i]), CONFIG.deezerGapMs);
    var results = (json && json.data) || [];
    var best = pickBest_(want, results.map(function (r) { return { r: r, a: (r.artist && r.artist.name) || '', t: r.title || '' }; }));
    if (best && best.s >= 1.5) return best.r;
  }
  return null;
}

function appleByUpc_(deezerId) {
  var album = getJson_('https://api.deezer.com/album/' + deezerId, CONFIG.deezerGapMs);
  var upc = album && album.upc;
  if (!upc) return null;
  var codes = [upc, upc.replace(/^0+/, ''), ('0000000000000' + upc).slice(-13)];
  for (var i = 0; i < codes.length; i++) {
    if (i > 0 && codes[i] === codes[i - 1]) continue;
    var hit = appleLookup_({ upc: codes[i] });
    if (hit) return hit;
  }
  return null;
}

function appleLookup_(params) {
  var q = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
  var json = getJson_('https://itunes.apple.com/lookup?entity=album&country=US&' + q, CONFIG.appleGapMs);
  var results = (json && json.results) || [];
  for (var i = 0; i < results.length; i++) {
    if (results[i].collectionId && results[i].collectionViewUrl) return results[i];
  }
  return null;
}

function findAppleSearch_(artist, title, want) {
  var json = getJson_('https://itunes.apple.com/search?media=music&entity=album&country=US&limit=25&term=' +
    encodeURIComponent((artist + ' ' + title).trim()), CONFIG.appleGapMs);
  var results = (json && json.results) || [];
  var best = pickBest_(want, results.map(function (r) { return { r: r, a: r.artistName, t: r.collectionName }; }));
  return best && best.s >= 1.5 ? best.r : null;
}

function bandcampFromMusicBrainz_(artist, title, want) {
  var esc = function (s) { return s.replace(/(["\\])/g, '\\$1'); };
  var query = 'releasegroup:"' + esc(title) + '" AND artist:"' + esc(artist) + '"';
  var json = getJson_('https://musicbrainz.org/ws/2/release-group/?fmt=json&limit=5&query=' + encodeURIComponent(query), CONFIG.musicbrainzGapMs);
  var groups = (json && json['release-groups']) || [];
  var best = pickBest_(want, groups.map(function (g) { return { r: g, a: credit_(g['artist-credit']), t: g.title }; }));
  if (!best || best.s < 1.5) return null;
  var rg = getJson_('https://musicbrainz.org/ws/2/release-group/' + best.r.id + '?fmt=json&inc=url-rels%2Breleases', CONFIG.musicbrainzGapMs);
  var url = bandcampIn_(rg && rg.relations);
  var releases = ((rg && rg.releases) || []).slice(0, 4);
  for (var i = 0; !url && i < releases.length; i++) {
    var rel = getJson_('https://musicbrainz.org/ws/2/release/' + releases[i].id + '?fmt=json&inc=url-rels', CONFIG.musicbrainzGapMs);
    url = bandcampIn_(rel && rel.relations);
  }
  return url;
}

function bandcampIn_(relations) {
  relations = relations || [];
  for (var i = 0; i < relations.length; i++) {
    var res = (relations[i].url && relations[i].url.resource) || '';
    if (/bandcamp\.com\/album\//.test(res)) return res.replace(/\?.*$/, '');
  }
  return null;
}

function credit_(ac) {
  return (ac || []).map(function (c) { return (c.name || (c.artist && c.artist.name) || '') + (c.joinphrase || ''); }).join('');
}

// Fetch JSON, pausing first; retries "busy" answers a few times.
function getJson_(url, gapMs) {
  for (var attempt = 0; attempt < 4; attempt++) {
    if (gapMs) Utilities.sleep(gapMs);
    var res;
    try {
      res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': CONFIG.userAgent, Accept: 'application/json' } });
    } catch (e) { Utilities.sleep(3000); continue; }
    var code = res.getResponseCode();
    if (code === 403 || code === 429 || code >= 500) { Utilities.sleep(4000 * (attempt + 1)); continue; }
    if (code !== 200) return null;
    try { return JSON.parse(res.getContentText()); } catch (e) { return null; }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Matching: up to 1 point for the artist, up to 1 for the title.

function splitAlbum_(s) {
  var m = String(s).match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? { artist: m[1].trim(), title: m[2].trim() } : null;
}
function wanted_(artist, title) { return { a: norm_(artist), t: normTitle_(title), artists: splitArtists_(artist) }; }
function pickBest_(want, cands) {
  var best = null;
  for (var i = 0; i < cands.length; i++) {
    var s = artistScore_(want, cands[i].a) + titleScore_(want.t, normTitle_(cands[i].t));
    if (!best || s > best.s) best = { r: cands[i].r, s: s };
  }
  return best;
}
function artistScore_(want, name) {
  var got = norm_(name);
  if (!got) return 0;
  if (got === want.a) return 1;
  var parts = splitArtists_(name);
  for (var i = 0; i < want.artists.length; i++) if (parts.indexOf(want.artists[i]) >= 0) return 0.9;
  if (got.indexOf(want.a) >= 0 || want.a.indexOf(got) >= 0) return 0.8;
  return overlap_(got, want.a);
}
function titleScore_(want, got) {
  if (!got) return 0;
  if (got === want) return 1;
  if (got.replace(/ /g, '') === want.replace(/ /g, '')) return 0.95;
  if (got.indexOf(want) === 0 || want.indexOf(got) === 0) return 0.8;
  return overlap_(got, want);
}
function overlap_(x, y) {
  var a = x.split(' '), b = y.split(' '), common = 0;
  a.forEach(function (w) { if (b.indexOf(w) >= 0) common++; });
  return common / Math.max(a.length, b.length, 1) * 0.75;
}
function norm_(s) {
  return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/\$/g, 's').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^the /, '');
}
function normTitle_(s) {
  var t = String(s).replace(/\s+-\s+(ep|single)$/i, '');
  for (var i = 0; i < 2; i++) t = t.replace(/\s*[(\[][^)\]]*[)\]]\s*$/, '');
  return norm_(t || s);
}
function splitArtists_(s) {
  return String(s).split(/\s*(?:,|&|\band\b|\bwith\b|\bx\b|\bfeat\.?|\bft\.?|\+)\s*/i).map(norm_).filter(Boolean);
}
function today_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
