# spartaan-zac-resultaten

Uitslagen en standen van de Spartaan zomeravondcompetitie.

Live site: **https://spartaan-zac.nl** 

## How the pipeline works

```
Speedhive CSV ──► GitHub Action (cron, Node 20) ──writes──► data/*.json ──commits──► main
                                                                                       │
                                                                                       ▼
                                                                                GitHub Pages
                                                                                (vanilla HTML
                                                                                 reads JSON)
```

A scheduled (and manually triggerable) GitHub Action fetches each race's CSV
from the Speedhive API, runs `scripts/build-standings.mjs` to compute points
and class standings, and commits `data/standings.json` + `data/races.json` to
`main` — but only when the content actually changes. GitHub Pages serves the
static site straight from `main`; the frontend (`index.html` + `prototype.js`)
loads the JSON at page load. No backend, no database.

## Repo layout

```
data/
  sessions.json       hand-curated list of race nights (one entry per race)
  standings.json      computed — per-class season standings
  races.json          computed — per-race results + movers
  raw/                cached Speedhive CSVs (committed for offline replay)
scripts/
  build-standings.mjs pure scoring function (no I/O — unit-tested)
  build-standings.test.mjs
  fetch-and-build.mjs CLI: fetches CSVs, runs build, writes JSON
  fixtures/           CSV fixtures for tests
.github/workflows/
  update-standings.yml cron + workflow_dispatch trigger
index.html, prototype.js, styles.css, assets/  the public site
```

## Adding a new race after race night

1. Open the new race's session page on Sporthive (e.g. `https://sporthive.com/sessions/12086232`).
2. Copy the session ID from the URL.
3. Edit [`data/sessions.json`](data/sessions.json) (via the GitHub web editor is fine) — append one entry:
   ```json
   { "n": 8, "sessionId": 12345678, "date": "2026-05-19" }
   ```
4. Commit to `main`. The next cron run (or a manual rerun, see below) picks it up.

That's the entire human workflow per race. ~30 seconds.

## Manually re-running the pipeline

Actions → **Update standings** → **Run workflow**. Useful if you just added a
session ID and don't want to wait for the next cron tick.

## Scoring rules (from PRD)

| Position | Points |   | Position | Points |
|----------|--------|---|----------|--------|
| 1 | 25 |   | 9  | 12 |
| 2 | 23 |   | 10 | 11 |
| 3 | 21 |   | 11 | 10 |
| 4 | 19 |   | 12 |  9 |
| 5 | 17 |   | 13 |  8 |
| 6 | 15 |   | 14 |  7 |
| 7 | 14 |   | 15 |  6 |
| 8 | 13 |   | 16+|  5 |

- Season total = simple sum across all races. No drop-worst-N.
- Completed ≥1 lap (incl. DNF) counts and earns at least 5 points.
- 0 laps / DNS = no result, 0 points.
- Tiebreaker: head-to-head wins across the season. Still tied → joint position.
- Rider identity = `(class, name)`. Start numbers turn out **not** to be unique
  in real data — multiple riders can share a number across the season, and one
  rider's number can change mid-season — so we key by name within a class. The
  display `#nr` follows the rider's most recent race.

The Speedhive CSV mixes both classes (sorted by global total time); the build
script splits by class and re-ranks each class from 1.

## Local development

The site uses `fetch('data/standings.json')`, so opening `index.html` over
`file://` triggers CORS. Use any static server:

```bash
python3 -m http.server 8080
# → http://localhost:8080
```

Run the tests:

```bash
node --test scripts/build-standings.test.mjs
```

Re-run the build offline against committed `data/raw/` CSVs:

```bash
node scripts/fetch-and-build.mjs --offline
```

Or live (hits Speedhive):

```bash
node scripts/fetch-and-build.mjs
```

## Tap-to-pin

Tapping a row in the standings opens that rider's detail view; tapping
**Vastpinnen** stores `<class>:<startNumber>` in `localStorage` under the key
`despartaan.me`. The pinned rider is highlighted across all three views and
appears in the sticky "Jouw positie" chip on mobile.

## DSQ overrides

Sometimes the raw Speedhive data contains an error — a rider who should be
disqualified still appears with a finishing position. Rather than modifying the
source (Sporthive is read-only truth), the repo carries a hand-curated override
file that the build pipeline applies before computing standings, GC, movers and
stats.

**File:** [`data/dsq.json`](data/dsq.json)

**Schema:**
```json
{
  "version": 1,
  "overrides": [
    {
      "sessionId": 12345678,
      "class": "A",
      "name": "Rider Name",
      "nr": 42,
      "reason": "Short description of the infraction",
      "appliedAt": "2026-06-01T12:00:00Z",
      "appliedBy": "admin"
    }
  ]
}
```

Each entry matches exactly one rider (`sessionId` + `class` + `name`) in one
race. The `nr` field is informational only (audit trail); identity is by name.

**How to apply a DSQ:**
1. Open [`data/dsq.json`](data/dsq.json) in the GitHub web editor.
2. Add an entry to the `overrides` array with the fields above.
3. Commit and push to `main`. The `push` trigger on `data/dsq.json` fires the
   **Update standings** workflow automatically, which rebuilds and commits the
   new `standings.json` and `races.json`.

**How to reverse a DSQ:**
1. Open [`data/dsq.json`](data/dsq.json) in the GitHub web editor.
2. Delete the relevant entry from the `overrides` array.
3. Commit and push to `main`. The workflow fires and restores the original result.

**Audit log:** Git history on `data/dsq.json` is the full audit trail. The
`appliedAt` and `appliedBy` fields inside each entry are for human readability
only — the timestamps in git are authoritative.

## Out of scope

Per PRD: no admin UI, no auth, no past-season archive, no push notifications,
no cross-class combined standing, no Sporthive auto-discovery. Raise with Dave
before reopening any of these.

## Roles from ai-dev-team

- **Lin** — design (visual prototype, tokens, components on `main`)
- **Sam** — build (data pipeline, deploy)
- **Dave** — PRD, scope
- **Bram** — owner, adds session IDs after each race
