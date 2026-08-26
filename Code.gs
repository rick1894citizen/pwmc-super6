/**
 * ═══════════════════════════════════════════════════════════════════════
 *  PREM PREDICTOR 26/27 — Google Apps Script backend  (v2)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  Built against the real sheet layout:
 *    • Live Leaderboard        title row(s) then headers on row 2
 *    • Master Predictions      2-row header, WIDE: Fixture 1..228 × (Home,
 *                              Away, 1st Goalscorer). Fixtures 1-6 = GW1,
 *                              7-12 = GW2, and so on to fixture 228 = GW38.
 *    • Live Results            headers on row 1
 *    • Tournament Predictions  title row 1, ACTUAL RESULTS row 2, headers row 3
 *    • Payment Tracking        title row 1, headers row 3, totals row at bottom
 *
 *  This script finds the header row itself, reshapes the wide predictions
 *  grid into tidy rows, drops totals/blank rows, and returns clean JSON.
 *
 *  ── INSTALL ──────────────────────────────────────────────────────────
 *  1. Open the Google Sheet → Extensions → Apps Script.
 *  2. Delete the sample code, paste this whole file in, Save.
 *  3. Run → logHeaders, and check the Execution log finds all five tabs.
 *  4. Deploy → New deployment → Web app
 *        Execute as:      Me
 *        Who has access:  Anyone
 *  5. Authorise, copy the /exec URL into CONFIG.API_URL in index.html.
 *
 *  ── AFTER EDITING THIS FILE ──────────────────────────────────────────
 *  Deploy → Manage deployments → pencil → Version: New version → Deploy.
 *  Saving alone does not update the live /exec URL.
 * ═══════════════════════════════════════════════════════════════════════
 */

/** Tab names. First match wins; matching is case-insensitive and also
 *  accepts a tab whose name merely contains the alias. Add yours if the
 *  tabs are named differently. */
var TAB_ALIASES = {
  leaderboard: ['Live Leaderboard', 'Leaderboard', 'Standings'],
  predictions: ['Master Predictions', 'Predictions', 'Weekly Predictions'],
  results:     ['Live Results', 'Results', 'Fixtures'],
  outrights:   ['Tournament Predictions', 'Outright Predictions', 'Outrights'],
  payments:    ['Payment Tracking', 'Payments', 'Payment'],
  gwPoints:    ['Gameweek Points', 'GW Points', 'Weekly Points', 'Points Breakdown'],
};

/** Fixtures per matchweek. Fixture 1-6 → GW1, 7-12 → GW2, … */
var FIXTURES_PER_WEEK = 6;

/** Rows whose Player Name starts with any of these are ignored
 *  (the "Total Players: 24" summary row, etc). */
var IGNORE_ROW_PREFIXES = ['total', 'grand total', 'sum', 'players:'];

/** Seconds to cache the payload server-side. 0 disables. */
var CACHE_SECONDS = 45;


/* ═════════════════════════════════════════════════════════════════════ */
/*  ENTRY POINT                                                          */
/* ═════════════════════════════════════════════════════════════════════ */

function doGet(e) {
  var params = (e && e.parameter) || {};
  var payload;

  try {
    payload = getPayload(params.nocache === '1', params.gw ? Number(params.gw) : null);
  } catch (err) {
    payload = JSON.stringify({ error: String((err && err.message) || err) });
  }

  if (params.callback) {                       // JSONP fallback if CORS ever bites
    return ContentService
      .createTextOutput(params.callback + '(' + payload + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(payload)
    .setMimeType(ContentService.MimeType.JSON);
}


function getPayload(skipCache, onlyGw) {
  var cache = CacheService.getScriptCache();
  var KEY = 'pp2627_v2_' + (onlyGw || 'all');

  if (CACHE_SECONDS > 0 && !skipCache) {
    var hit = cache.get(KEY);
    if (hit) return hit;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var warnings = [];
  var diagnostics = {};

  function grab(key, reader, optional) {
    var sheet = resolveSheet(ss, TAB_ALIASES[key]);
    if (!sheet) {
      if (!optional) {
        warnings.push('Tab not found for "' + key + '" (tried: ' + TAB_ALIASES[key].join(', ') + ')');
      }
      diagnostics[key] = { tabName: null, headerRow: null, headers: [], rowCount: 0, optional: !!optional };
      return [];
    }
    var res = reader(sheet);
    diagnostics[key] = {
      tabName: sheet.getName(),
      headerRow: res.headerRow,
      headers: res.headers,
      rowCount: res.rows.length,
    };
    return res.rows;
  }

  var out = {
    generatedAt: new Date().toISOString(),
    spreadsheet: ss.getName(),
    tabs: {
      leaderboard: grab('leaderboard', function (sh) { return readTable(sh, ['player name', 'rank']); }),
      results:     grab('results',     function (sh) { return readTable(sh, ['matchweek', 'home team']); }),
      outrights:   grab('outrights',   function (sh) { return readTable(sh, ['player name', 'premier league winner']); }),
      payments:    grab('payments',    function (sh) { return readTable(sh, ['player name', 'payment status']); }),
      predictions: grab('predictions', function (sh) { return readWidePredictions(sh, onlyGw); }),
      gwPoints:    grab('gwPoints',    function (sh) { return readGameweekPoints(sh); }, true),
    },
    outrightAnswers: readOutrightAnswers(ss),
    warnings: warnings,
    diagnostics: diagnostics,
  };

  var json = JSON.stringify(out);
  if (CACHE_SECONDS > 0 && json.length < 100000) {
    try { cache.put(KEY, json, CACHE_SECONDS); } catch (ignore) {}
  }
  return json;
}


/* ═════════════════════════════════════════════════════════════════════ */
/*  SHEET READERS                                                        */
/* ═════════════════════════════════════════════════════════════════════ */

/** Finds a sheet by exact name, then case-insensitively, then by "contains". */
function resolveSheet(ss, aliases) {
  var sheets = ss.getSheets();
  var byLower = {};
  sheets.forEach(function (s) { byLower[s.getName().toLowerCase().trim()] = s; });

  for (var i = 0; i < aliases.length; i++) {
    var a = aliases[i].toLowerCase().trim();
    if (byLower[a]) return byLower[a];
  }
  for (var j = 0; j < aliases.length; j++) {
    var needle = aliases[j].toLowerCase().trim();
    for (var k = 0; k < sheets.length; k++) {
      if (sheets[k].getName().toLowerCase().indexOf(needle) !== -1) return sheets[k];
    }
  }
  return null;
}

function nrm(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/[\s_\-./()£$,:]+/g, '').trim();
}

function isIgnoredRowLabel(label) {
  var l = String(label || '').toLowerCase().trim();
  if (!l) return true;
  for (var i = 0; i < IGNORE_ROW_PREFIXES.length; i++) {
    if (l.indexOf(IGNORE_ROW_PREFIXES[i]) === 0) return true;
  }
  return false;
}

/**
 * Generic reader for the four "normal" tabs.
 * Scans the first 12 rows for the header row — the one containing the most
 * of the supplied `expectHints` — then reads everything below it.
 */
function readTable(sheet, expectHints) {
  var values = sheet.getDataRange().getDisplayValues();
  if (!values.length) return { headerRow: null, headers: [], rows: [] };

  var hints = (expectHints || []).map(nrm);
  var bestRow = 0, bestScore = -1;
  var limit = Math.min(12, values.length);

  for (var r = 0; r < limit; r++) {
    var filled = 0, score = 0;
    for (var c = 0; c < values[r].length; c++) {
      var cell = nrm(values[r][c]);
      if (!cell) continue;
      filled++;
      for (var h = 0; h < hints.length; h++) {
        if (cell === hints[h] || cell.indexOf(hints[h]) === 0) { score += 10; break; }
      }
    }
    score += Math.min(filled, 8);                 // a header row is usually well filled
    if (score > bestScore) { bestScore = score; bestRow = r; }
  }

  var rawHeaders = values[bestRow];
  var headers = [], seen = {};
  for (var i = 0; i < rawHeaders.length; i++) {
    var h = String(rawHeaders[i] == null ? '' : rawHeaders[i]).trim();
    if (!h) { headers.push(null); continue; }
    if (seen[h]) { seen[h]++; h = h + ' ' + seen[h]; } else { seen[h] = 1; }
    headers.push(h);
  }

  // Which column holds the row label we use to spot totals rows?
  var labelCol = -1;
  for (var L = 0; L < headers.length; L++) {
    if (headers[L] && nrm(headers[L]).indexOf('playername') === 0) { labelCol = L; break; }
  }

  var rows = [];
  for (var d = bestRow + 1; d < values.length; d++) {
    var row = values[d], obj = {}, hasData = false;

    if (labelCol >= 0 && isIgnoredRowLabel(row[labelCol])) continue;

    for (var m = 0; m < headers.length; m++) {
      if (headers[m] === null) continue;
      var v = row[m] == null ? '' : String(row[m]).trim();
      // an unticked checkbox is not "data"
      if (v !== '' && v.toUpperCase() !== 'FALSE') hasData = true;
      obj[headers[m]] = v;
    }
    if (hasData) rows.push(obj);
  }

  return {
    headerRow: bestRow + 1,
    headers: headers.filter(function (x) { return x !== null; }),
    rows: rows,
  };
}


/**
 * Reads the WIDE Master Predictions grid and returns tidy rows.
 *
 *   Row 1:  Player Name |     Fixture 1      |     Fixture 2      | …
 *           — or, just as often —
 *           Player Name | Arsenal vs Coventry City | Hull City vs Man Utd | …
 *   Row 2:              | Home | Away | Scorer | Home | Away | Scorer | …
 *   Row 3+: Scott S     |  2   |  0   | Tonali |  0   |  3   | Haaland| …
 *
 * The fixture index comes from whichever the header actually gives us:
 *   - a literal "Fixture N" style header uses N directly, or
 *   - a team-matchup header ("Arsenal vs Coventry City") has no number in
 *     it, so the index is just left-to-right column order — group 1 is
 *     Fixture 1, group 2 is Fixture 2, and so on, which lines up with the
 *     Fixture Number column on Live Results because both are filled in the
 *     same left-to-right order as the season is played.
 * "Fixture N" maps to Matchweek ceil(N/6) and Fixture Number ((N-1)%6)+1.
 * Only fixtures with at least one filled cell are emitted, which keeps the
 * payload small early in the season.
 */
function readWidePredictions(sheet, onlyGw) {
  var values = sheet.getDataRange().getDisplayValues();
  if (values.length < 3) return { headerRow: null, headers: [], rows: [] };

  var groupRow = values[0];
  var subRow = values[1];
  var width = Math.max(groupRow.length, subRow.length);

  // Forward-fill the merged "Fixture N" / "Team vs Team" labels across their
  // 3 columns.
  var groups = [], last = '';
  for (var c = 0; c < width; c++) {
    var g = String(groupRow[c] == null ? '' : groupRow[c]).trim();
    if (g) last = g;
    groups[c] = last;
  }

  // Locate Player Name (it lives in a cell merged across rows 1-2).
  var playerCol = -1, mwCol = -1;
  for (var p = 0; p < width; p++) {
    var a = nrm(groupRow[p]), b = nrm(subRow[p]);
    if (playerCol === -1 && (a.indexOf('playername') === 0 || b.indexOf('playername') === 0 ||
                             a === 'player' || b === 'player')) playerCol = p;
    if (mwCol === -1 && (a === 'matchweek' || b === 'matchweek' || a === 'gw' || b === 'gw')) mwCol = p;
  }
  if (playerCol === -1) playerCol = 0;

  // Build the fixture column map: fixtureIndex -> {home, away, scorer}
  var fixtures = {};
  var groupOrder = [], groupIndexOf = {};   // label -> 1-based column order, for non-numeric headers
  for (var q = 0; q < width; q++) {
    if (q === playerCol || q === mwCol) continue;
    var label = String(groups[q] || '').trim();
    if (!label) continue;

    var idx;
    var numMatch = label.match(/(\d+)/);
    if (numMatch && /fixture/i.test(label)) {
      // Literal "Fixture N" header — trust the number.
      idx = parseInt(numMatch[1], 10);
    } else {
      // No fixture number in the header (e.g. a team-matchup name) — assign
      // one by the order distinct labels first appear, left to right.
      if (!(label in groupIndexOf)) {
        groupOrder.push(label);
        groupIndexOf[label] = groupOrder.length;
      }
      idx = groupIndexOf[label];
    }
    if (!idx) continue;

    var kind = nrm(subRow[q]);
    var slot = null;
    if (kind.indexOf('home') === 0) slot = 'home';
    else if (kind.indexOf('away') === 0) slot = 'away';
    else if (kind.indexOf('goalscorer') !== -1 || kind.indexOf('scorer') !== -1) slot = 'scorer';
    if (!slot) continue;

    if (!fixtures[idx]) fixtures[idx] = {};
    fixtures[idx][slot] = q;
  }

  var indexes = Object.keys(fixtures).map(Number).sort(function (a, b) { return a - b; });
  var rows = [];

  for (var r = 2; r < values.length; r++) {
    var row = values[r];
    var player = String(row[playerCol] == null ? '' : row[playerCol]).trim();
    if (isIgnoredRowLabel(player)) continue;

    for (var i = 0; i < indexes.length; i++) {
      var idx = indexes[i];
      var cols = fixtures[idx];

      var mw = Math.ceil(idx / FIXTURES_PER_WEEK);
      var fixNo = ((idx - 1) % FIXTURES_PER_WEEK) + 1;
      if (mwCol >= 0 && row[mwCol]) {                    // explicit column wins if you add one
        var explicit = parseInt(String(row[mwCol]).replace(/\D/g, ''), 10);
        if (explicit) mw = explicit;
      }
      if (onlyGw && mw !== onlyGw) continue;

      var hs = cols.home   !== undefined ? String(row[cols.home]   || '').trim() : '';
      var as = cols.away   !== undefined ? String(row[cols.away]   || '').trim() : '';
      var sc = cols.scorer !== undefined ? String(row[cols.scorer] || '').trim() : '';
      if (hs === '' && as === '' && sc === '') continue;  // nothing submitted

      rows.push({
        'Matchweek': mw,
        'Fixture Number': fixNo,
        'Fixture Index': idx,
        'Player Name': player,
        'Home Score': hs,
        'Away Score': as,
        '1st Goalscorer': sc,
      });
    }
  }

  return {
    headerRow: 2,
    headers: ['Matchweek', 'Fixture Number', 'Player Name', 'Home Score', 'Away Score', '1st Goalscorer'],
    rows: rows,
  };
}


/**
 * Reads the optional "Gameweek Points" tab, which drives Manager of the Month.
 *
 *   Row 1:  Player Name | GW1 | GW2 | GW3 | … | GW38 | (Total)
 *   Row 2+: Rick F      |  9  | 14  |  6  | … |
 *
 * Column headers may be 'GW1', 'Gameweek 1', 'Matchweek 1' or just '1'.
 * Any column without a number in its header (a Total column, say) is skipped,
 * as are blank cells — so an unplayed week contributes nothing rather than 0.
 */
function readGameweekPoints(sheet) {
  var values = sheet.getDataRange().getDisplayValues();
  if (values.length < 2) return { headerRow: null, headers: [], rows: [] };

  // header row = the one in the first 8 containing "Player Name"
  var headerRow = 0;
  for (var r = 0; r < Math.min(8, values.length); r++) {
    for (var c = 0; c < values[r].length; c++) {
      if (nrm(values[r][c]).indexOf('playername') === 0) { headerRow = r; r = 99; break; }
    }
  }

  var hdr = values[headerRow];
  var playerCol = -1, gwCols = [];

  for (var k = 0; k < hdr.length; k++) {
    var label = nrm(hdr[k]);
    if (!label) continue;
    if (playerCol === -1 && (label.indexOf('playername') === 0 || label === 'player' || label === 'name')) {
      playerCol = k; continue;
    }
    if (label.indexOf('total') === 0 || label.indexOf('rank') === 0) continue;
    var m = String(hdr[k]).match(/(\d+)/);
    if (!m) continue;
    var gw = parseInt(m[1], 10);
    if (gw >= 1 && gw <= 38) gwCols.push({ col: k, gw: gw });
  }
  if (playerCol === -1) playerCol = 0;

  var rows = [];
  for (var d = headerRow + 1; d < values.length; d++) {
    var row = values[d];
    var player = String(row[playerCol] == null ? '' : row[playerCol]).trim();
    if (isIgnoredRowLabel(player)) continue;

    for (var g = 0; g < gwCols.length; g++) {
      var raw = String(row[gwCols[g].col] == null ? '' : row[gwCols[g].col]).trim();
      if (raw === '') continue;                       // week not scored yet
      var pts = parseFloat(raw.replace(/[^0-9.\-]/g, ''));
      if (!isFinite(pts)) continue;
      rows.push({ 'Player Name': player, 'Matchweek': gwCols[g].gw, 'Points': pts });
    }
  }

  return {
    headerRow: headerRow + 1,
    headers: ['Player Name', 'Matchweek', 'Points'],
    rows: rows,
  };
}


/**
 * Reads the "ACTUAL RESULTS:" row that sits above the headers on the
 * Tournament Predictions tab, so the app can tick off correct outrights
 * once you replace the TBCs.
 */
function readOutrightAnswers(ss) {
  var sheet = resolveSheet(ss, TAB_ALIASES.outrights);
  if (!sheet) return {};

  var values = sheet.getDataRange().getDisplayValues();
  if (values.length < 3) return {};

  // find the row labelled "ACTUAL RESULTS" and the header row beneath it
  var answerRow = -1, headerRow = -1;
  for (var r = 0; r < Math.min(8, values.length); r++) {
    var first = nrm(values[r][0]);
    if (first.indexOf('actualresult') === 0) answerRow = r;
    for (var c = 0; c < values[r].length; c++) {
      if (nrm(values[r][c]).indexOf('premierleaguewinner') === 0 ||
          nrm(values[r][c]).indexOf('goldenboot') === 0) { headerRow = r; break; }
    }
    if (headerRow !== -1) break;
  }
  if (answerRow === -1 || headerRow === -1) return {};

  var out = {};
  for (var k = 0; k < values[headerRow].length; k++) {
    var header = String(values[headerRow][k] || '').trim();
    var val = String((values[answerRow] || [])[k] || '').trim();
    if (!header || !val) continue;
    // skip the label column itself ("Player Name" ↔ "ACTUAL RESULTS:")
    if (nrm(header).indexOf('playername') === 0 || nrm(header) === 'player') continue;
    if (nrm(val).indexOf('actualresult') === 0) continue;
    if (val.toUpperCase() === 'TBC' || val === '-') continue;   // not decided yet
    out[header] = val;
  }
  return out;
}


/* ═════════════════════════════════════════════════════════════════════ */
/*  MANUAL HELPERS — run these from the Apps Script editor                */
/* ═════════════════════════════════════════════════════════════════════ */

/** Run → logHeaders. Confirms every tab is found and prints its headers. */
function logHeaders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TAB_ALIASES).forEach(function (key) {
    var sh = resolveSheet(ss, TAB_ALIASES[key]);
    if (!sh) {
      Logger.log((key === 'gwPoints' ? '– ' : '✘ ') + key + ' — no tab found' +
                 (key === 'gwPoints' ? ' (optional: add a "Gameweek Points" tab to enable Manager of the Month)' : ''));
      return;
    }
    var res = key === 'predictions' ? readWidePredictions(sh, null)
            : key === 'gwPoints'    ? readGameweekPoints(sh)
            : readTable(sh, []);
    Logger.log('✔ ' + key + '  →  tab "' + sh.getName() + '", header row ' + res.headerRow +
               ', ' + res.rows.length + ' data rows\n     ' + res.headers.join(' | ') + '\n');
  });
}

/** Run → testPayload. Row counts and payload size, plus any warnings. */
function testPayload() {
  var json = getPayload(true, null);
  var data = JSON.parse(json);
  if (data.error) { Logger.log('ERROR: ' + data.error); return; }
  Object.keys(data.tabs).forEach(function (k) {
    Logger.log(k + ': ' + data.tabs[k].length + ' rows');
  });
  Logger.log('Outright answers known: ' + JSON.stringify(data.outrightAnswers));
  Logger.log('Payload: ' + Math.round(json.length / 1024) + ' KB');
  if (data.warnings.length) Logger.log('WARNINGS:\n  ' + data.warnings.join('\n  '));
  else Logger.log('No warnings.');
}

/** Run → clearCache. Forces the next request to re-read the sheet. */
function clearCache() {
  var c = CacheService.getScriptCache();
  c.remove('pp2627_v2_all');
  for (var i = 1; i <= 38; i++) c.remove('pp2627_v2_' + i);
  Logger.log('Cache cleared.');
}
