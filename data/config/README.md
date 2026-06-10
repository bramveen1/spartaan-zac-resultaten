# data/config — maintainer-edited inputs

Files in this folder are **hand-edited by maintainers** and are the source of truth for the pipeline.

Files in `data/` outside this folder (`standings.json`, `races.json`) are **generated outputs** — do not edit them by hand; they are overwritten on every pipeline run.

---

## sessions.json

Lists the race nights for the current season.

**Schema:**

```json
{
  "season": "string — human-readable season label, e.g. \"Zomer 2026\"",
  "racesTotal": "integer — total races planned for the season",
  "sessions": [
    {
      "n": "integer — race number (1-based, sequential)",
      "sessionId": "integer — Speedhive session ID from the event URL",
      "date": "string — ISO date of the race night, e.g. \"2026-03-31\""
    }
  ]
}
```

**Worked example:**

```json
{
  "season": "Zomer 2026",
  "racesTotal": 26,
  "sessions": [
    { "n": 1, "sessionId": 11869003, "date": "2026-03-31" },
    { "n": 2, "sessionId": 11899083, "date": "2026-04-07" }
  ]
}
```

To add a new race: append one entry to `sessions` with the next `n`, the session ID copied from the Speedhive URL, and the race date. Commit to `main`; the next cron run picks it up.

---

## dsq.json

Carries DSQ overrides — riders whose Speedhive result should be treated as disqualified when computing standings. The build pipeline applies these before scoring; it never modifies the source data.

**Schema:**

```json
{
  "version": 1,
  "overrides": [
    {
      "sessionId": "integer — Speedhive session ID of the race",
      "class": "string — rider class, e.g. \"A\" or \"B\"",
      "name": "string — rider name exactly as it appears in the CSV",
      "nr": "integer — start number (informational only; identity is by name)",
      "reason": "string — short description of the infraction",
      "appliedAt": "string — ISO 8601 timestamp when the DSQ was recorded",
      "appliedBy": "string — username of the person applying the DSQ"
    }
  ]
}
```

**Worked example:**

```json
{
  "version": 1,
  "overrides": [
    {
      "sessionId": 12253330,
      "class": "A",
      "name": "Rider Name",
      "nr": 42,
      "reason": "Cut the course at lap 3",
      "appliedAt": "2026-06-01T12:00:00Z",
      "appliedBy": "admin"
    }
  ]
}
```

**How to apply a DSQ:** open `data/config/dsq.json` in the GitHub web editor, add an entry to `overrides`, and commit to `main`. The `push` trigger on this file fires the **Update standings** workflow automatically, which rebuilds and commits the new `standings.json` and `races.json`.

**How to reverse a DSQ:** delete the relevant entry and commit. The workflow fires and restores the original result.

**Audit log:** git history on `data/config/dsq.json` is the authoritative audit trail. The `appliedAt` and `appliedBy` fields are for human readability; the git timestamps are authoritative.

**Build trigger:** any push that touches `data/config/dsq.json` fires the **Update standings** workflow (`.github/workflows/update-standings.yml`). This means a DSQ edit always produces a fresh `standings.json` within minutes, without needing a manual workflow dispatch.

---

## roster/women.json

Lists the start numbers classified as women riders, keyed by class.

**Schema:**

```json
{
  "women": {
    "<class>": ["array of integer start numbers for women in that class"]
  }
}
```

**Worked example:**

```json
{
  "women": {
    "A": [17],
    "B": [46, 9, 52, 38]
  }
}
```

The build uses this roster to populate the `womenClasses` standings alongside the open-class `classes` standings. A rider whose start number appears here is counted in the women's standings for their class. Identity for the open standings is always by name (start numbers are not unique across the season); the women's roster uses start numbers as a lightweight tagging mechanism.

Add a rider's start number to the appropriate class array and commit to `main`. The next pipeline run recomputes the women's standings.
