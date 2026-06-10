/* ----------------------------------------------------------------------------
   build-standings.mjs

   Pure scoring function: (Speedhive CSVs, scoring rules) → standings + races.
   No I/O — all fetches live in fetch-and-build.mjs so this stays unit-testable.

   PRD reference: see GitHub issue #2.
   ---------------------------------------------------------------------------- */

// Points per finishing position within each class.
// Position 1 → POINTS[0], …, position 15 → POINTS[14], position 16+ → POINTS_FLOOR.
export const POINTS = [25, 23, 21, 19, 17, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6];
export const POINTS_FLOOR = 5;

export function pointsFor(pos) {
  if (!Number.isInteger(pos) || pos < 1) return 0;
  return POINTS[pos - 1] ?? POINTS_FLOOR;
}

// Defensive CSV parser. The Speedhive export uses commas and we haven't seen
// quoted fields in real data, but a future name with a comma shouldn't break us.
export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (c === "\r") {
      // ignore
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.length));
}

// "110536 | ZAC A (31-03) - 19:30:00" → "A"
// "110537 | ZAC B (31/03) - 19:31:00" → "B"
export function classOf(rawClass) {
  if (!rawClass) return null;
  const m = /ZAC\s+([AB])\b/i.exec(rawClass);
  return m ? m[1].toUpperCase() : null;
}

// Try to read the race date out of the Class field, e.g. "(31-03)" or "(31/03)".
// Returns ISO date if it parses, else null. Year inferred from the season the
// fetcher passes in; here we only return month-day and let the caller stitch.
export function dateOf(rawClass) {
  if (!rawClass) return null;
  const m = /\((\d{1,2})[\/\-](\d{1,2})\)/.exec(rawClass);
  if (!m) return null;
  const dd = String(m[1]).padStart(2, "0");
  const mm = String(m[2]).padStart(2, "0");
  return `--${mm}-${dd}`; // partial ISO; caller fills year
}

// One race's CSV → { A: rows, B: rows } with each class re-ranked from 1.
// Skips DNS (0 laps) per PRD; DNF with ≥1 lap counts and gets points.
export function parseRaceCSV(csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return { A: [], B: [] };
  const header = rows[0].map((h) => h.trim());
  const col = (name) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`CSV missing column: ${name}`);
    return i;
  };
  const idx = {
    nr: col("Start Number"),
    name: col("Competitor"),
    cls: col("Class"),
    time: col("Total Time"),
    diff: col("Diff"),
    laps: col("Laps"),
  };
  const byClass = { A: [], B: [] };
  for (const r of rows.slice(1)) {
    const cls = classOf(r[idx.cls] ?? "");
    if (!cls) continue;
    const laps = parseInt(r[idx.laps] ?? "0", 10);
    if (!Number.isFinite(laps) || laps < 1) continue;
    byClass[cls].push({
      nr: parseInt(r[idx.nr], 10),
      name: (r[idx.name] ?? "").trim(),
      laps,
      time: (r[idx.time] ?? "").trim(),
      diff: (r[idx.diff] ?? "").trim(),
    });
  }
  for (const cls of ["A", "B"]) {
    byClass[cls] = byClass[cls].map((r, i) => ({
      pos: i + 1,
      ...r,
      pts: pointsFor(i + 1),
    }));
  }
  return byClass;
}

// Apply DSQ overrides to one race's parsed class arrays.
// Matching rows (by sessionId, class, name) are moved to the end of each
// class array with pos:null, pts:0, dsq:true. Kept rows are re-ranked from 1
// and their points recomputed. Overrides referencing unknown sessions or names
// are skipped with a warning so the build never throws.
export function applyDsq(byClass, sessionId, overrides) {
  if (!overrides || !overrides.length) return byClass;
  const out = { A: [...(byClass.A ?? [])], B: [...(byClass.B ?? [])] };
  for (const cls of ["A", "B"]) {
    const dsqEntries = overrides.filter(
      (o) => o.sessionId === sessionId && o.class === cls,
    );
    if (!dsqEntries.length) continue;
    const dsqNames = new Set(dsqEntries.map((o) => o.name));
    const kept = out[cls].filter((r) => !dsqNames.has(r.name));
    const removed = out[cls].filter((r) => dsqNames.has(r.name));
    // Warn about override entries that matched no row (name not in the CSV).
    for (const entry of dsqEntries) {
      if (!removed.some((r) => r.name === entry.name)) {
        console.warn(`applyDsq: name "${entry.name}" not found in session ${sessionId} class ${cls} — skipping`);
      }
    }
    const reranked = kept.map((r, i) => ({ ...r, pos: i + 1, pts: pointsFor(i + 1) }));
    const dsqRows = removed.map((r) => {
      const entry = dsqEntries.find((o) => o.name === r.name);
      return { ...r, pos: null, pts: 0, dsq: true, dsqReason: entry?.reason ?? "" };
    });
    out[cls] = [...reranked, ...dsqRows];
  }
  return out;
}

// Filter a parseRaceCSV result down to riders whose start number is on the
// roster for that class, then re-rank positions 1..N within the filtered
// field and re-apply pointsFor. Start numbers overlap across classes
// (#17 in A and #17 in B can be different riders — confirmed in the 2026
// season), so the roster is per-class. Identity within a class is by start
// number — the women's GC has no independent name list (v1 tradeoff, #8).
export function filterAndReRank(byClass, rosterByClass) {
  const out = { A: [], B: [] };
  for (const cls of ["A", "B"]) {
    const allowed = new Set((rosterByClass?.[cls] ?? []).map((n) => Number(n)));
    // DSQ rows are excluded from the women's GC — they have no valid position.
    const filtered = (byClass[cls] ?? []).filter((r) => !r.dsq && allowed.has(r.nr));
    out[cls] = filtered.map((r, i) => ({
      ...r,
      pos: i + 1,
      pts: pointsFor(i + 1),
    }));
  }
  return out;
}

// Head-to-head over a list of per-race results for two riders.
// Counts races both rode (both have a finish position).
function headToHead(a, b) {
  let aWins = 0;
  let bWins = 0;
  const aByRace = new Map(a.results.map((r) => [r.raceIdx, r.pos]));
  for (const br of b.results) {
    const ap = aByRace.get(br.raceIdx);
    if (ap == null) continue;
    if (ap < br.pos) aWins++;
    else if (ap > br.pos) bWins++;
  }
  return { aWins, bWins };
}

// Aggregate races → per-class standings rows with positions and tiebreakers.
// racesByClass.A is an array (one entry per race) of arrays (one per finisher).
export function buildStandings(racesByClass) {
  const out = { A: [], B: [] };
  for (const cls of ["A", "B"]) {
    const races = racesByClass[cls] ?? [];
    const riders = new Map();
    races.forEach((race, raceIdx) => {
      for (const r of race) {
        if (!r.name) continue; // skip nameless rows defensively
        const cur = riders.get(r.name) ?? {
          nr: r.nr,
          name: r.name,
          pts: 0,
          starts: 0,
          results: [],
        };
        cur.nr = r.nr; // latest start number for display (numbers can change mid-season)
        cur.pts += r.pts;
        // DSQ does not count as a start — the rider was removed from the race
        // result for a rule infraction; the entry is an override audit trail (#18).
        if (!r.dsq) cur.starts += 1;
        cur.results.push({ raceIdx, pos: r.pos, pts: r.pts });
        riders.set(r.name, cur);
      }
    });

    const lastIdx = races.length - 1;
    for (const rider of riders.values()) {
      const last = rider.results.find((r) => r.raceIdx === lastIdx);
      rider.lastPts = last ? last.pts : 0;
    }

    const sorted = [...riders.values()].sort((a, b) => {
      if (a.pts !== b.pts) return b.pts - a.pts;
      const { aWins, bWins } = headToHead(a, b);
      if (aWins !== bWins) return bWins - aWins;
      return 0;
    });

    const leader = sorted[0]?.pts ?? 0;
    const rows = [];
    let lastRank = 0;
    sorted.forEach((rider, i) => {
      let pos;
      if (i === 0) {
        pos = 1;
      } else {
        const prev = sorted[i - 1];
        if (rider.pts === prev.pts) {
          const { aWins, bWins } = headToHead(rider, prev);
          pos = aWins === bWins ? lastRank : i + 1;
        } else {
          pos = i + 1;
        }
      }
      lastRank = pos;
      rows.push({
        pos,
        nr: rider.nr,
        name: rider.name,
        pts: rider.pts,
        lastPts: rider.lastPts,
        starts: rider.starts,
        gap: leader - rider.pts,
        joint: false,
      });
    });
    const seen = new Map();
    for (const r of rows) seen.set(r.pos, (seen.get(r.pos) ?? 0) + 1);
    for (const r of rows) if (seen.get(r.pos) > 1) r.joint = true;
    out[cls] = rows;
  }
  return out;
}

function statsFor(results) {
  if (!results.length) return { winnerTime: null, laps: 0, finishers: 0 };
  const winner = results[0];
  return {
    winnerTime: winner.time,
    laps: winner.laps,
    finishers: results.filter((r) => !r.dsq).length,
  };
}

// Top-3 standings shifts per race per class. `racesByClass` and
// `parsedRaceClasses` both index by race; the former is for buildStandings
// (cumulative), the latter is the per-race rows used to look up race points.
function computeMovers(racesByClass, parsedRaceClasses) {
  const standingsAfter = parsedRaceClasses.map((_, i) =>
    buildStandings({
      A: racesByClass.A.slice(0, i + 1),
      B: racesByClass.B.slice(0, i + 1),
    })
  );
  const standingsBefore = parsedRaceClasses.map((_, i) =>
    i === 0 ? { A: [], B: [] } : standingsAfter[i - 1]
  );
  return parsedRaceClasses.map((raceClasses, i) => {
    const out = { A: [], B: [] };
    for (const cls of ["A", "B"]) {
      const before = new Map(standingsBefore[i][cls].map((r) => [r.name, r.pos]));
      const after = standingsAfter[i][cls];
      const shifts = after
        .map((r) => {
          const from = before.get(r.name);
          const raceRow = raceClasses[cls].find((x) => x.name === r.name);
          return {
            nr: r.nr,
            name: r.name,
            from: from ?? null,
            to: r.pos,
            shift: from != null ? from - r.pos : null,
            pts: raceRow?.pts ?? 0,
          };
        })
        .filter((s) => s.shift !== null && s.shift !== 0);
      shifts.sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift));
      out[cls] = shifts.slice(0, 3);
    }
    return out;
  });
}

// Top-level builder used by both the fetcher and the tests.
// `sessions`: [{ n, sessionId, date, label, csv }] — csv is the raw CSV text.
// `options.roster.women`: optional { A: [...], B: [...] } of start numbers
//   per class for the women's GC. Per-class because start numbers overlap
//   across classes.
export function build(sessions, options = {}) {
  const womenRoster = options?.roster?.women ?? { A: [], B: [] };
  const dsqOverrides = options?.dsq ?? [];
  const parsedRaces = sessions.map((s) => {
    const classes = applyDsq(parseRaceCSV(s.csv), s.sessionId, dsqOverrides);
    return {
      n: s.n,
      sessionId: s.sessionId,
      date: s.date ?? null,
      label: s.label ?? `Race ${s.n}`,
      classes,
      womenClasses: filterAndReRank(classes, womenRoster),
    };
  });

  const racesByClass = {
    A: parsedRaces.map((r) => r.classes.A),
    B: parsedRaces.map((r) => r.classes.B),
  };
  const womenRacesByClass = {
    A: parsedRaces.map((r) => r.womenClasses.A),
    B: parsedRaces.map((r) => r.womenClasses.B),
  };
  const standings = buildStandings(racesByClass);
  const womenStandings = buildStandings(womenRacesByClass);

  // Movers per race: position shift in season standing caused by that race.
  // O(R²) total; trivially fast for ≤26 races, keeps the math obvious.
  const moversByRace = computeMovers(racesByClass, parsedRaces.map((r) => r.classes));
  const womenMoversByRace = computeMovers(womenRacesByClass, parsedRaces.map((r) => r.womenClasses));

  const racesOut = parsedRaces.map((r, i) => ({
    n: r.n,
    sessionId: r.sessionId,
    date: r.date,
    label: r.label,
    classes: {
      A: { results: r.classes.A, stats: statsFor(r.classes.A) },
      B: { results: r.classes.B, stats: statsFor(r.classes.B) },
    },
    womenClasses: {
      A: { results: r.womenClasses.A, stats: statsFor(r.womenClasses.A) },
      B: { results: r.womenClasses.B, stats: statsFor(r.womenClasses.B) },
    },
    movers: moversByRace[i],
    womenMovers: womenMoversByRace[i],
  }));

  return {
    standings: {
      racesCompleted: parsedRaces.length,
      classes: standings,
      womenClasses: womenStandings,
    },
    races: racesOut,
  };
}
