# Prem Predictor 26/27

A mobile-first PWA for the Premier League predictor league. Reads your Google Sheet as its
database via an Apps Script JSON endpoint. No build step, no server, no npm install.

```
prem-predictor/          (all files sit flat, no subfolders)
├── index.html      ← the entire app (React + Tailwind, single file)
├── Code.gs         ← paste into Apps Script, attached to your Google Sheet
├── manifest.json   ← PWA manifest (Add to Home Screen)
├── sw.js           ← service worker (offline support)
├── icon-*.png      ← 180 / 192 / 512 / 512-maskable app icons
└── README.md
```

---

## Built against your actual sheet

`Code.gs` v2 was written from your five tabs as they stand, not from a generic template. It
handles all of the following without you changing a thing:

| Your layout | How it is handled |
|---|---|
| **Live Leaderboard** headers on row 2, title above | Header row is auto-detected, not hardcoded |
| Leaderboard has **no outrights or total column** | Total = `Weekly Points Total` + `Total Bonus Points` pulled from the Outrights tab, matched on player name |
| **Master Predictions** is wide, 2-row header, `Fixture 1…228` | Reshaped into tidy rows in Apps Script. Fixture 1-6 → GW1, 7-12 → GW2, … 223-228 → GW38 |
| Predictions carry **no team names** | Matched to fixtures on (Matchweek, Fixture Number) instead |
| **Live Results** pre-seeded with 228 rows, teams still blank | Fixtures still render, shown as `TBC v TBC` until you fill them |
| Results uses **`Fixture Number`**, not "Match No" | Added as the primary alias |
| **Tournament Predictions** title r1, `ACTUAL RESULTS:` r2, headers r3 | Header row auto-detected; the ACTUAL RESULTS row is read separately |
| Outright answers currently all `TBC` | Treated as unsettled. Replace a TBC with the real answer and the app ticks every correct pick green and totals the confirmed points |
| **Payment Tracking** headers on row 3, title above | Auto-detected |
| Headers like `1st Payment (£20 - Due Aug 2026)` | Matched by prefix, ignoring case, spaces, brackets and `£` |
| Tickbox columns returning `TRUE`/`FALSE` | Read as paid / not paid |
| `£40.00` formatted currency cells | Parsed to numbers |
| The **`Total Players: 24`** summary row and the trailing blank tickbox rows | Excluded from the player list and from all maths |
| MOTM only running in **September, January and April** | `CONFIG.MOTM.months`; other month columns are read but never shown |
| 24 players, not 35 | Everything counts rows dynamically |

`Code.gs` itself was verified end to end against a replica of your tabs: 19 Apps Script checks
covering header detection, the wide-predictions reshape, and the outright-answers row. It has not
needed to change since.

The frontend (`index.html`) was substantially rebuilt in August 2026 for the live scoring rules and
UI brief above — the Leaderboard's filter pills, the Gameweek tab's tap-to-expand accordion, and the
in-app scoring engine are new. If you spot a mismatch against what is documented here, the ⚙
Diagnostics screen is the fastest way to see exactly what the sheet returned and what didn't map.

### One change needed for Manager of the Month

MOTM runs in **three months only: September, January and April**. Add one column per prize month
to the Live Leaderboard tab, anywhere to the right of the existing ones.

```
A    | B           | C                   | D                    | E   | F   | G   |
Rank | Player Name | Weekly Points Total | Manager of the Month | Sep | Jan | Apr |
1    | Scott S     | 60                  | September            | 20  |     |     |
2    | Rick F      | 55                  |                      | 35  |     |     |
```

**During those three months only, add each result's points twice:** once to the running
`Weekly Points Total` as you do now, and once to that month's cell. Nine months of the season are
unaffected.

- Headers can be `Sep`, `September`, `Sep 26` or `September 2026`. The year is optional;
  August-December are assumed to be 2026 and January-July 2027 (`CONFIG.SEASON` if that changes).
- Only whole month names count, so `Manager of the Month`, `Rank` and a player called `Marcus`
  are never mistaken for months.
- Add all three columns now. January and April show as **Upcoming** until they have points, so
  everyone can see what is still to play for.
- A month column that is *not* a prize month is read but never shown. Change
  `CONFIG.MOTM.months` if the three ever change.
- **Keep the `Manager of the Month` column.** It still drives the gold winner badge: type
  `September` against whoever won and they get it on their leaderboard row and on the MOTM card.

> **If you would rather avoid the double entry,** add all ten months (`Aug` … `May`), set
> `Weekly Points Total` to `=SUM()` of them, and switch `CONFIG.MOTM.reconcileWithTotal` to
> `true`. You then only ever type a number once, the season total maintains itself, and
> Diagnostics reconciles the two on every load. MOTM still shows only September, January and
> April. More columns, less typing, and one less thing to get wrong.

The **`Date` column on Live Results is optional.** Month names come from the column headers, so
MOTM does not need it. Add it if you want kick-off dates on the match cards, and it lets the app
mark a month **Final** as soon as the last result lands rather than waiting for the calendar.

### Still on you either way

1. **Live Results** — team names for the 228 fixtures, 12 teams per week from the 20 in the
   league. Matchweek and Fixture Number are already there, so the app works today, it just shows
   `TBC v TBC` until you fill them in. A week at a time is fine.
2. **Master Predictions** — extend the `Fixture N` header groups rightwards as the season goes on.
   Each fixture needs three columns in this order: Home Score, Away Score, 1st Goalscorer. Keep
   the numbering unbroken (Fixture 7 must be GW2's first game) because that is how the app derives
   the matchweek.
3. **Live Leaderboard** — `Weekly Points Total` is yours to calculate. The app never recalculates
   points, it only displays what the sheet says.

Leave unplayed score cells **empty, not `0`**. The app picks the current gameweek by finding the
first matchweek with an empty score, so a stray zero will push it forward.

---

## How Manager of the Month works

The Leaderboard tab gains a **Manager of the Month** card: one pill per prize month, and the
standings for whichever you tap, read straight from that month's column.

- **Which gameweek counts towards which month is your call**, decided when you type the points in.
  A week straddling the month end goes wherever you put it, so there is no rule to argue with.
- **Upcoming → In progress → Final.** A month is Final once the calendar month has passed; with a
  `Date` column on Live Results the app is stricter and waits for every fixture in that month to
  have a result.
- **The confirmed winner comes from your sheet.** Type `September` into the `Manager of the Month`
  column against a player and they get the gold Winner badge on the card and on their leaderboard
  row. The table underneath is live and derived; your column is the record.
- If the month in play has no points yet, the card and the stat tile fall back to the last prize
  month that does, rather than showing an empty table.

**Diagnostics reconciles for you** — but only when `CONFIG.MOTM.reconcileWithTotal` is `true`,
since three months of columns are not expected to add up to a season total. Switch it on with the
ten-column setup and the ⚙ screen compares the two on every load, green if they agree, amber
naming the players and both figures if they do not.

### How the Leaderboard's "Gameweek" filter works

`Weekly Points Total` (Col E) is a season running total, so it can't answer "who won this week" —
tapping the **Gameweek** pill and picking a matchweek instead calculates every player's points for
just that week, live, from Master Predictions + Live Results using `CONFIG.SCORING`. Nothing needs
adding to the sheet for this to work.

The app also still reads an optional **`Gameweek Points`** tab if you have one (Player Name down
column A, `GW1`…`GW38` across the top), in case a future feature wants a sheet-authoritative
per-week figure instead of the calculated one — it isn't used by the Leaderboard today.

---

## Part 1 — Connect the Google Sheet

**1.** Open the sheet → **Extensions → Apps Script**.

**2.** Delete the sample `function myFunction() {}`, paste in the whole of `Code.gs`, click **Save**.

**3.** In the toolbar, choose the function **`logHeaders`** and click **Run**. Authorise when
prompted (you will see an "unverified app" warning because it is your own script: click
**Advanced → Go to [project name]**). Check the Execution log shows a ✔ against all five tabs:

```
✔ leaderboard  → tab "Live Leaderboard", header row 2, 24 data rows
✔ predictions  → tab "Master Predictions", header row 2, 144 data rows
✔ results      → tab "Live Results", header row 1, 228 data rows
✔ outrights    → tab "Tournament Predictions", header row 3, 24 data rows
✔ payments     → tab "Payment Tracking", header row 3, 24 data rows
–  gwPoints    → no tab found (optional)
```

If a tab shows ✘, add its exact name to `TAB_ALIASES` at the top of `Code.gs`. `gwPoints` is
optional and shows a `–` rather than a ✘ if you have not created it.

**4.** Run **`testPayload`** as a second check. It prints row counts and the payload size.

**5.** **Deploy → New deployment**. Click the gear next to "Select type" → **Web app**.

| Field | Value |
|---|---|
| Description | `Prem Predictor API` |
| Execute as | **Me** |
| Who has access | **Anyone** |

Click **Deploy** and copy the **Web app URL**. It ends in `/exec`. Do not use the `/dev` URL.

> **On "Anyone":** the endpoint is public but read-only, and returns nothing except the five tabs
> listed in `TAB_ALIASES`. Your spreadsheet stays private and nobody can write to it through this.
> Anyone with the URL could read the league data, which for a predictor league is fine. If that
> bothers you, the alternative is a server-side proxy with a Google service account.

**6.** Open `index.html` in any text editor. Near the top, in the `CONFIG` block:

```js
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfy……/exec',   // ← paste yours
  USE_MOCK: false,                                              // ← change to false
```

This repo's `index.html` already has `API_URL` pointed at the live deployment and `USE_MOCK: false`
set, so step 6 is only needed again if you redeploy the Apps Script and get a new `/exec` URL.

**7.** Open `index.html` in a browser and tap the **⚙ gear** in the header. Diagnostics shows,
per tab: which sheet it found, which row it used as headers, how many rows it read, and any
column it could not map. Everything should read **All mapped**.

If instead every tab shows **not found · 0 rows**, the endpoint is reachable but the deployed
Apps Script isn't returning your five tabs — either `Code.gs` hasn't been pasted into the script
attached to your actual spreadsheet yet, or that spreadsheet's tab names don't match
`TAB_ALIASES`. Run `logHeaders` in the Apps Script editor (see step 3) to see exactly what it
finds server-side.

---

## Part 2 — Publish on Netlify

Two routes. Pick the first if you just want it live in two minutes.

### Route A — drag and drop (fastest)

1. Sign in at <https://app.netlify.com> (free account).
2. Go to **Sites** and drag the whole **`prem-predictor` folder** onto the drop zone. Drag the
   folder itself, not the files inside it, and make sure `index.html` sits at the folder root.
3. Netlify gives you a URL like `https://spontaneous-otter-4f2a1c.netlify.app`. It is live and on
   HTTPS immediately.
4. **Site configuration → Change site name** to something memorable, e.g.
   `https://prem-predictor-2627.netlify.app`.

To publish an update later: open the site → **Deploys** tab → drag the folder onto the
"Drag and drop your project output folder here" area at the bottom. Same URL, new version.

### Route B — GitHub (better if you will tweak it often)

1. Create a GitHub repo and push the contents of `prem-predictor` to the root.
2. Netlify → **Add new site → Import an existing project → GitHub**, pick the repo.
3. Leave **Build command** empty and set **Publish directory** to `/` (or `.`). There is no build
   step. Click **Deploy**.
4. Every `git push` now redeploys automatically.

### After every deploy

**Bump `CACHE_VERSION` in `sw.js`** before you upload, for example `'pp2627-v1'` → `'pp2627-v2'`.
The service worker caches the app on people's phones, and without a version bump they will keep
seeing the old build.

### Getting it onto phones

Send everyone the Netlify URL.

- **iPhone/iPad** — must be **Safari**. Share button → **Add to Home Screen**.
- **Android** — Chrome → **⋮** → **Install app** / **Add to Home screen**.

It then opens full-screen, no address bar, with the app icon.

---

## The Gameweek tab

Fixture-first: pick a matchweek and you see all six fixtures as collapsed cards, each showing the
score (or `TBC v TBC` before kick-off) and the actual 1st goalscorer once played. **Tap a card to
expand it** into an accordion listing every player's prediction for that fixture and the points it
scored, under the rules on [What the app calculates, and what it does not](#what-the-app-calculates-and-what-it-does-not).
A search box inside the expanded card finds a specific player quickly.

A player picker above the fixtures remembers whoever you looked at last (most people only check
their own) and shows that player's pick and points inline on every collapsed card, plus a running
"Your GW*n*" total, without needing to expand anything.

---

## What the app calculates, and what it does not

**Match points are calculated in-app; season totals are still the sheet's own numbers.** As of
the August 2026 rules update, the Gameweek tab and the Leaderboard's **Gameweek** filter work out
each prediction's points live, in the browser, from `CONFIG.SCORING`:

| Outcome | Points |
|---|---|
| Correct outcome (Home Win / Draw / Away Win) | 5 pts |
| Exact scoreline | +5 pts on top of the above (10 pts total) |
| Correct 1st goalscorer — Forward | 5 pts |
| Correct 1st goalscorer — Midfielder | 7 pts |
| Correct 1st goalscorer — Defender | 10 pts |
| Blank, incorrect or unrecognised goalscorer position | 0 pts |
| Each outright bonus (of 5 categories) | 25 pts |

The goalscorer tier is read from the **position code of the actual 1st goalscorer**, which must
be its own column on **Live Results** (documented as Column I in the brief; matched by header
text, not a fixed column letter — see below). Change any of these figures in `CONFIG.SCORING` in
`index.html` if the rules change again; nothing else needs editing.

**`Weekly Points Total`, `Total Bonus Points`, the derived overall total, and the Manager of the
Month columns are still read straight from the sheet, not recalculated.** The Leaderboard's
**Overall** and **MOTM: Sep / Jan / Apr** filters show exactly what those columns say.

Two further things are computed in the browser, both using the figures above:

- The **payment status pill**, derived from `Total Paid` against the £40 fee. Your own
  `Payment Status` column is not used for the pill, only for reference. Change `CONFIG.FEE` if
  the fee ever changes.
- The outright slip's **confirmed score**, once you replace a `TBC` on the ACTUAL RESULTS row —
  each correct pick is worth `CONFIG.SCORING.outrightBonus` (25 pts by default).

### The goalscorer position column

Add a column to **Live Results** carrying the actual 1st goalscorer's position for each fixture
(`F` for forward, `M` for midfielder, `D` for defender). The app matches it by header text —
`Position`, `Position Code`, `Pos`, `Scorer Position` or `Goalscorer Position` all work out of the
box. If your header is something else, open the ⚙ Diagnostics screen: it will list
`actualScorerPosition` as unmapped on the `results` tab, and you add your real header to
`CONFIG.COLUMNS.results.actualScorerPosition` in `index.html`.

---

## Caching

| Layer | Duration | Where to change |
|---|---|---|
| Apps Script server cache | 45s | `CACHE_SECONDS` in `Code.gs` |
| Browser localStorage | 3 min | `CONFIG.CACHE_MINUTES` in `index.html` |
| Service worker | app shell and CDN files only, never the API | `sw.js` |

The **↻ button** in the header bypasses the browser cache. To bypass the Apps Script cache too,
run `clearCache` in the script editor or append `?nocache=1` to the endpoint.

### A scaling note for late season

Predictions are only sent for fixtures that have something filled in, so the payload is tiny now.
By matchweek 38 it will be roughly 5,500 rows — around 650 KB uncompressed, perhaps 70 KB over the
wire, which is still fine on mobile. What does break at that size is the Apps Script cache, which
has a hard 100 KB limit, so requests will start re-reading the sheet each time and feel a second
or two slower.

`Code.gs` already accepts `?gw=5` to return a single gameweek, so the fix is a small frontend
change to fetch one gameweek at a time. Worth doing around Christmas if it starts to drag; not
worth doing now.

---

## Deliberate deviations from the original brief

1. **Single HTML file rather than a Next.js project.** React 18, Tailwind and Babel load from CDN
   and are cached by the service worker, so the app works offline after the first load. Babel
   compiles the JSX in the browser on each cold start (roughly 200-400ms on a modern phone); a
   loading spinner covers it. If the app grows, port it to Next.js and that step disappears.
2. **CSS animations instead of Framer Motion,** which has no reliable UMD build for a no-bundler
   setup. The `.rise`, `.fade` and `.sheet-up` classes give the staggered entrances and the
   iOS-style sheet transition, and they respect `prefers-reduced-motion`.
3. **Lucide icon paths inlined** rather than `lucide-react`, which needs a bundler. Same icons,
   zero dependency. Add more by dropping path data into the `P` object.
4. **Sample data is illustrative.** With `USE_MOCK: true` the app generates fabricated points for
   your 24 named players, and the club names in sample fixtures are real English clubs used as
   filler only. They are **not** the 2026/27 fixture list, and I have not verified the 2026/27
   Premier League composition. An amber banner marks it as sample data until you switch over.

---

## Troubleshooting

**Blank screen or an error banner after going live.** ⚙ Diagnostics shows the fetch error. Most
often the deployment access is not set to "Anyone", or you copied the `/dev` URL instead of
`/exec`.

**A column shows blank or zero.** ⚙ Diagnostics lists unmapped fields per tab. Add your header
name to the relevant array in `CONFIG.COLUMNS`.

**A gameweek shows fixtures but no predictions.** The `Fixture N` numbering in Master Predictions
has a gap, or those cells are genuinely empty. Fixture N must equal `(matchweek - 1) × 6 + fixture`.

**Predictions attached to the wrong match.** Same cause: a break in the fixture numbering shifts
everything after it.

**Changes to `Code.gs` have no effect.** Apps Script pins the live URL to a version.
Deploy → **Manage deployments** → pencil → Version: **New version** → Deploy. Saving is not enough.

**Phones still showing the old app.** You did not bump `CACHE_VERSION` in `sw.js`. As a one-off
fix, people can close the app, reopen it twice, or delete and re-add it to the home screen.

**CORS error in the console.** Rare, but `Code.gs` supports JSONP: append `&callback=fn` to the
endpoint and adapt `loadData` accordingly.

**iOS won't offer "Add to Home Screen".** It must be Safari, not Chrome on iOS, and the site must
be HTTPS. Netlify is HTTPS by default.
