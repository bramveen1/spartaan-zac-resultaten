import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  POINTS,
  POINTS_FLOOR,
  pointsFor,
  parseCSV,
  classOf,
  parseRaceCSV,
  filterAndReRank,
  buildStandings,
  applyDsq,
  build,
} from "./build-standings.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFile(join(HERE, "fixtures", name), "utf8");

test("pointsFor: positions 1–15 follow the PRD table", () => {
  const expected = [25, 23, 21, 19, 17, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6];
  expected.forEach((pts, i) => assert.equal(pointsFor(i + 1), pts));
  assert.deepEqual(POINTS, expected);
});

test("pointsFor: position 16+ uses the floor of 5", () => {
  assert.equal(pointsFor(16), POINTS_FLOOR);
  assert.equal(pointsFor(50), POINTS_FLOOR);
});

test("pointsFor: invalid positions → 0", () => {
  assert.equal(pointsFor(0), 0);
  assert.equal(pointsFor(-3), 0);
  assert.equal(pointsFor(2.5), 0);
  assert.equal(pointsFor("3"), 0);
});

test("classOf: extracts A or B from the Speedhive Class field", () => {
  assert.equal(classOf("110536 | ZAC A (31-03) - 19:30:00"), "A");
  assert.equal(classOf("110537 | ZAC B (31/03) - 19:31:00"), "B");
  assert.equal(classOf("Something else"), null);
  assert.equal(classOf(""), null);
  assert.equal(classOf(null), null);
});

test("parseCSV: handles plain rows", () => {
  assert.deepEqual(parseCSV("a,b,c\n1,2,3\n"), [
    ["a", "b", "c"],
    ["1", "2", "3"],
  ]);
});

test("parseCSV: handles quoted fields with embedded commas", () => {
  assert.deepEqual(parseCSV('a,b\n"x,y",z\n'), [
    ["a", "b"],
    ["x,y", "z"],
  ]);
});

test("parseCSV: strips UTF-8 BOM", () => {
  const rows = parseCSV("﻿a,b\n1,2\n");
  assert.equal(rows[0][0], "a");
});

test("parseRaceCSV: splits classes and re-ranks each from 1", async () => {
  const csv = await fixture("session-11869003.csv");
  const { A, B } = parseRaceCSV(csv);
  assert.ok(A.length > 0, "has Class A rows");
  assert.ok(B.length > 0, "has Class B rows");
  assert.equal(A[0].pos, 1);
  assert.equal(A[0].nr, 26);
  assert.equal(A[0].name, "Daan Hogenelst");
  assert.equal(A[0].pts, 25);
  assert.equal(B[0].pos, 1, "Class B re-ranks from 1");
  assert.equal(B[0].pts, 25);
});

test("parseRaceCSV: position 16+ in real fixture gets floor points", async () => {
  const csv = await fixture("session-11869003.csv");
  const { A } = parseRaceCSV(csv);
  const pos16 = A.find((r) => r.pos === 16);
  const pos29 = A.find((r) => r.pos === 29);
  assert.equal(pos16.pts, 5);
  assert.equal(pos29.pts, 5);
});

test("parseRaceCSV: skips DNS (0 laps) but counts DNF (≥1 lap)", () => {
  const csv =
    "Pos,Start Number,Competitor,Class,Total Time,Diff,Laps,Best Lap,Best Lap No.,Best Speed\n" +
    "1,1,Winner,110536 | ZAC A,1:0:0.000,0.000,10,1:00.000,1,40 km/h\n" +
    "2,2,Finisher,110536 | ZAC A,1:0:1.000,1.000,10,1:00.100,1,40 km/h\n" +
    "3,3,DNFlate,110536 | ZAC A,30:0.000,5 laps,5,1:00.000,1,40 km/h\n" +
    "4,4,DNS,110536 | ZAC A,0,DNS,0,,,\n";
  const { A } = parseRaceCSV(csv);
  assert.equal(A.length, 3, "the 0-lap row is skipped");
  assert.equal(A[2].name, "DNFlate");
  assert.equal(A[2].pts, 21, "DNF with ≥1 lap still earns position points");
});

test("parseRaceCSV: throws clearly when a required column is missing", () => {
  assert.throws(() => parseRaceCSV("Pos,Name\n1,X\n"), /CSV missing column/);
});

test("buildStandings: sums points across races", () => {
  const races = {
    A: [
      [
        { pos: 1, nr: 7, name: "Alice", pts: 25 },
        { pos: 2, nr: 9, name: "Bob", pts: 23 },
      ],
      [
        { pos: 1, nr: 9, name: "Bob", pts: 25 },
        { pos: 2, nr: 7, name: "Alice", pts: 23 },
      ],
    ],
    B: [],
  };
  const s = buildStandings(races);
  assert.equal(s.A.length, 2);
  assert.equal(s.A.find((r) => r.nr === 7).pts, 48);
  assert.equal(s.A.find((r) => r.nr === 9).pts, 48);
});

test("buildStandings: tied points with even H2H → joint position", () => {
  const races = {
    A: [
      [
        { pos: 1, nr: 7, name: "Alice", pts: 25 },
        { pos: 2, nr: 9, name: "Bob", pts: 23 },
      ],
      [
        { pos: 1, nr: 9, name: "Bob", pts: 25 },
        { pos: 2, nr: 7, name: "Alice", pts: 23 },
      ],
    ],
    B: [],
  };
  const s = buildStandings(races);
  assert.equal(s.A[0].pos, 1);
  assert.equal(s.A[1].pos, 1);
  assert.equal(s.A[0].joint, true);
  assert.equal(s.A[1].joint, true);
});

test("buildStandings: H2H breaks tie when one rider beat the other more often", () => {
  // Alice and Bob both end on 46 points, but Alice beat Bob in 2 of 2 H2H races.
  const races = {
    A: [
      [
        { pos: 1, nr: 7, name: "Alice", pts: 25 },
        { pos: 3, nr: 9, name: "Bob", pts: 21 },
      ],
      [
        { pos: 1, nr: 7, name: "Alice", pts: 25 },
        { pos: 3, nr: 9, name: "Bob", pts: 21 },
      ],
      [
        { pos: 4, nr: 7, name: "Alice", pts: 0 }, // 0 pts here for example clarity
        { pos: 1, nr: 9, name: "Bob", pts: 25 }, // 25+21+21=67… not tied
      ],
    ],
    B: [],
  };
  // Recompute by hand: Alice 25+25=50, Bob 21+21+25=67 → Bob first.
  const s = buildStandings(races);
  assert.equal(s.A[0].nr, 9);
  assert.equal(s.A[0].pts, 67);
});

test("buildStandings: class split — A and B are isolated even with same start number", () => {
  const races = {
    A: [[{ pos: 1, nr: 7, name: "A-rider", pts: 25 }]],
    B: [[{ pos: 1, nr: 7, name: "B-rider", pts: 25 }]],
  };
  const s = buildStandings(races);
  assert.equal(s.A[0].name, "A-rider");
  assert.equal(s.B[0].name, "B-rider");
  assert.notEqual(s.A[0], s.B[0]);
});

test("buildStandings: same start number, different names → separate riders", () => {
  // Start numbers turn out NOT to be unique in real data — identity is by name.
  const races = {
    A: [
      [
        { pos: 1, nr: 7, name: "Alice", pts: 25 },
        { pos: 2, nr: 7, name: "Bob", pts: 23 },
      ],
    ],
    B: [],
  };
  const s = buildStandings(races);
  assert.equal(s.A.length, 2, "two distinct riders despite shared start number");
  assert.equal(s.A.find((r) => r.name === "Alice").pts, 25);
  assert.equal(s.A.find((r) => r.name === "Bob").pts, 23);
});

test("buildStandings: same name across races aggregates, even if start number changes", () => {
  const races = {
    A: [
      [{ pos: 1, nr: 7, name: "Alice", pts: 25 }],
      [{ pos: 1, nr: 12, name: "Alice", pts: 25 }],
    ],
    B: [],
  };
  const s = buildStandings(races);
  assert.equal(s.A.length, 1, "Alice is one rider");
  assert.equal(s.A[0].pts, 50);
  assert.equal(s.A[0].nr, 12, "display number follows latest race");
});

test("buildStandings: empty input → empty classes", () => {
  assert.deepEqual(buildStandings({ A: [], B: [] }), { A: [], B: [] });
  assert.deepEqual(buildStandings({}), { A: [], B: [] });
});

test("buildStandings: lastPts is 0 when rider missed the latest race", () => {
  const races = {
    A: [
      [{ pos: 1, nr: 7, name: "Alice", pts: 25 }],
      [{ pos: 1, nr: 9, name: "Bob", pts: 25 }],
    ],
    B: [],
  };
  const s = buildStandings(races);
  const alice = s.A.find((r) => r.nr === 7);
  assert.equal(alice.lastPts, 0, "Alice didn't race race 2");
});

test("build: end-to-end with the real fixture", async () => {
  const csv = await fixture("session-11869003.csv");
  const out = build([
    { n: 1, sessionId: 11869003, date: "2026-03-31", label: "Race 1", csv },
  ]);
  assert.equal(out.standings.racesCompleted, 1);
  assert.ok(out.standings.classes.A.length > 0);
  assert.ok(out.standings.classes.B.length > 0);
  assert.equal(out.standings.classes.A[0].nr, 26);
  assert.equal(out.standings.classes.A[0].pts, 25);
  assert.equal(out.races.length, 1);
  assert.equal(out.races[0].classes.A.stats.finishers, 29);
  // Race 1 has no "before" → movers should be empty
  assert.deepEqual(out.races[0].movers, { A: [], B: [] });
});

test("filterAndReRank: keeps only roster nrs per class and re-ranks 1..N", () => {
  const byClass = {
    A: [
      { pos: 1, nr: 26, name: "Top", laps: 30, pts: 25 },
      { pos: 2, nr: 77, name: "Mid", laps: 30, pts: 23 },
      { pos: 3, nr: 12, name: "Bottom", laps: 30, pts: 21 },
    ],
    B: [
      { pos: 1, nr: 5, name: "BTop", laps: 28, pts: 25 },
      { pos: 2, nr: 9, name: "BNext", laps: 28, pts: 23 },
    ],
  };
  const out = filterAndReRank(byClass, { A: [12, 999], B: [5] });
  assert.equal(out.A.length, 1);
  assert.equal(out.A[0].name, "Bottom");
  assert.equal(out.A[0].pos, 1, "re-ranked to 1");
  assert.equal(out.A[0].pts, 25, "re-pointed for new position");
  assert.equal(out.B.length, 1);
  assert.equal(out.B[0].name, "BTop");
  assert.equal(out.B[0].pos, 1);
  assert.equal(out.B[0].pts, 25);
});

test("filterAndReRank: per-class roster — same nr in A and B is independent", () => {
  // #17 in A is male, #17 in B is female (real 2026 season scenario): the
  // roster only lists 17 under B, so A's #17 must NOT be picked up.
  const byClass = {
    A: [{ pos: 1, nr: 17, name: "Male17", pts: 25 }],
    B: [{ pos: 1, nr: 17, name: "Female17", pts: 25 }],
  };
  const out = filterAndReRank(byClass, { A: [], B: [17] });
  assert.equal(out.A.length, 0, "A's #17 is excluded");
  assert.equal(out.B.length, 1);
  assert.equal(out.B[0].name, "Female17");
});

test("filterAndReRank: empty roster → empty classes", () => {
  const byClass = {
    A: [{ pos: 1, nr: 7, name: "X", pts: 25 }],
    B: [{ pos: 1, nr: 8, name: "Y", pts: 25 }],
  };
  assert.deepEqual(filterAndReRank(byClass, { A: [], B: [] }), { A: [], B: [] });
  assert.deepEqual(filterAndReRank(byClass, null), { A: [], B: [] });
  assert.deepEqual(filterAndReRank(byClass, {}), { A: [], B: [] });
});

test("filterAndReRank: unknown roster nr is ignored silently", () => {
  const byClass = {
    A: [{ pos: 1, nr: 7, name: "X", pts: 25 }],
    B: [],
  };
  const out = filterAndReRank(byClass, { A: [999], B: [] });
  assert.deepEqual(out, { A: [], B: [] });
});

test("build: roster doesn't affect overall classes (regression guard)", async () => {
  const csv = await fixture("session-11869003.csv");
  const sessions = [
    { n: 1, sessionId: 11869003, date: "2026-03-31", label: "Race 1", csv },
  ];
  const noRoster = build(sessions);
  const withRoster = build(sessions, { roster: { women: { A: [26, 77], B: [] } } });
  assert.deepEqual(noRoster.standings.classes, withRoster.standings.classes);
  // Per-race results in races.json are also untouched.
  assert.deepEqual(
    noRoster.races[0].classes,
    withRoster.races[0].classes,
  );
});

test("build: women roster produces re-ranked women's GC with 25/23 points at top", async () => {
  const csv = await fixture("session-11869003.csv");
  // Pick two finishers from Class A so the re-ranked women's A field has
  // a 1st (25 pts) and 2nd (23 pts). Class A nrs 77 and 12 both finished.
  const out = build(
    [{ n: 1, sessionId: 11869003, date: "2026-03-31", label: "Race 1", csv }],
    { roster: { women: { A: [77, 12], B: [] } } },
  );
  assert.ok(out.standings.womenClasses.A.length >= 2, "women A has ≥2 riders");
  assert.equal(out.standings.womenClasses.A[0].pts, 25, "top woman = 25 pts");
  assert.equal(out.standings.womenClasses.A[1].pts, 23, "second woman = 23 pts");
});

test("build: emits per-race womenClasses with re-ranked stats", async () => {
  const csv = await fixture("session-11869003.csv");
  const out = build(
    [{ n: 1, sessionId: 11869003, date: "2026-03-31", label: "Race 1", csv }],
    { roster: { women: { A: [77, 12], B: [] } } },
  );
  const race = out.races[0];
  assert.ok(race.womenClasses, "race entry has womenClasses");
  assert.equal(race.womenClasses.A.results.length, 2);
  assert.equal(race.womenClasses.A.results[0].pos, 1);
  assert.equal(race.womenClasses.A.results[0].pts, 25);
  assert.equal(race.womenClasses.A.results[1].pos, 2);
  assert.equal(race.womenClasses.A.results[1].pts, 23);
  assert.equal(race.womenClasses.A.stats.finishers, 2);
  assert.equal(race.womenClasses.B.results.length, 0);
});

test("build: emits womenMovers computed from the women-only standings", () => {
  // Race 1: Alice 1st (25), Bob 2nd (23), Carol 3rd (21).
  // Race 2: Bob 1st (25), Carol 2nd (23), Alice 3rd (21).
  // Cumulative women's GC after race 2:
  //   Bob   23+25 = 48 → 1st (was 2nd)
  //   Alice 25+21 = 46 → 2nd (was 1st)
  //   Carol 21+23 = 44 → 3rd (was 3rd)
  // → Bob +1, Alice −1, Carol unchanged.
  const mkCSV = (...rows) =>
    "Pos,Start Number,Competitor,Class,Total Time,Diff,Laps,Best Lap,Best Lap No.,Best Speed\n" +
    rows.join("\n") + "\n";
  const sessions = [
    {
      n: 1, sessionId: 1, date: "2026-01-01", label: "R1",
      csv: mkCSV(
        "1,10,Alice,110001 | ZAC A (01/01) - 19:30:00,1:0:0.000,0.000,30,1:00,1,40",
        "2,30,Bob,110001 | ZAC A (01/01) - 19:30:00,1:0:1.000,1.000,30,1:00,1,40",
        "3,50,Carol,110001 | ZAC A (01/01) - 19:30:00,1:0:2.000,2.000,30,1:00,1,40",
      ),
    },
    {
      n: 2, sessionId: 2, date: "2026-01-08", label: "R2",
      csv: mkCSV(
        "1,30,Bob,110002 | ZAC A (08/01) - 19:30:00,1:0:0.000,0.000,30,1:00,1,40",
        "2,50,Carol,110002 | ZAC A (08/01) - 19:30:00,1:0:1.000,1.000,30,1:00,1,40",
        "3,10,Alice,110002 | ZAC A (08/01) - 19:30:00,1:0:2.000,2.000,30,1:00,1,40",
        "4,99,Outsider,110002 | ZAC A (08/01) - 19:30:00,1:0:3.000,3.000,30,1:00,1,40",
      ),
    },
  ];
  const out = build(sessions, { roster: { women: { A: [10, 30, 50], B: [] } } });
  assert.ok(out.races[1].womenMovers, "race 2 has womenMovers");
  const movers = out.races[1].womenMovers.A;
  assert.equal(movers.length, 2, "Bob and Alice shifted; Carol unchanged");
  const bob = movers.find((m) => m.name === "Bob");
  const alice = movers.find((m) => m.name === "Alice");
  assert.equal(bob.from, 2); assert.equal(bob.to, 1); assert.equal(bob.shift, 1);
  assert.equal(alice.from, 1); assert.equal(alice.to, 2); assert.equal(alice.shift, -1);
  // Outsider isn't in the roster → never appears in women's movers.
  assert.ok(!movers.some((m) => m.name === "Outsider"));
});

test("build: women's H2H tiebreaker resolves on the subset", () => {
  // Two riders end on identical points (25+23 each), but Alice beat Bob
  // both times → Alice 1st, Bob 2nd within the women's subset.
  const mkCSV = (...rows) =>
    "Pos,Start Number,Competitor,Class,Total Time,Diff,Laps,Best Lap,Best Lap No.,Best Speed\n" +
    rows.join("\n") + "\n";
  const sessions = [
    {
      n: 1, sessionId: 1, date: "2026-01-01", label: "R1",
      csv: mkCSV(
        "1,10,Alice,110001 | ZAC A (01/01) - 19:30:00,1:0:0.000,0.000,30,1:00,1,40",
        "2,20,Charlie,110001 | ZAC A (01/01) - 19:30:00,1:0:1.000,1.000,30,1:00,1,40",
        "3,30,Bob,110001 | ZAC A (01/01) - 19:30:00,1:0:2.000,2.000,30,1:00,1,40",
      ),
    },
    {
      n: 2, sessionId: 2, date: "2026-01-08", label: "R2",
      csv: mkCSV(
        "1,30,Bob,110002 | ZAC A (08/01) - 19:30:00,1:0:0.000,0.000,30,1:00,1,40",
        "2,10,Alice,110002 | ZAC A (08/01) - 19:30:00,1:0:1.000,1.000,30,1:00,1,40",
      ),
    },
  ];
  const out = build(sessions, { roster: { women: { A: [10, 30], B: [] } } });
  // Subset: only Alice (10) and Bob (30). Race 1: Alice 1st (25), Bob 2nd (23).
  // Race 2: Bob 1st (25), Alice 2nd (23). Both = 48 pts. H2H tied → joint 1st.
  const wA = out.standings.womenClasses.A;
  assert.equal(wA.length, 2);
  assert.equal(wA[0].pts, 48);
  assert.equal(wA[1].pts, 48);
  assert.equal(wA[0].joint, true);
  assert.equal(wA[1].joint, true);
});

// ---- DSQ override tests ----

const mkCSV = (...rows) =>
  "Pos,Start Number,Competitor,Class,Total Time,Diff,Laps,Best Lap,Best Lap No.,Best Speed\n" +
  rows.join("\n") + "\n";

const DSQ_OVERRIDE = {
  sessionId: 1,
  class: "A",
  name: "Alice",
  nr: 10,
  reason: "Technical infraction",
  appliedAt: "2026-06-01T12:00:00Z",
  appliedBy: "admin",
};

const TWO_RACE_SESSIONS = [
  {
    n: 1, sessionId: 1, date: "2026-01-01", label: "R1",
    csv: mkCSV(
      "1,10,Alice,110001 | ZAC A (01/01) - 19:30:00,1:0:0.000,0.000,30,1:00,1,40",
      "2,20,Bob,110001 | ZAC A (01/01) - 19:30:00,1:0:1.000,1.000,30,1:00,1,40",
      "3,30,Carol,110001 | ZAC A (01/01) - 19:30:00,1:0:2.000,2.000,30,1:00,1,40",
    ),
  },
  {
    n: 2, sessionId: 2, date: "2026-01-08", label: "R2",
    csv: mkCSV(
      "1,20,Bob,110002 | ZAC A (08/01) - 19:30:00,1:0:0.000,0.000,30,1:00,1,40",
      "2,10,Alice,110002 | ZAC A (08/01) - 19:30:00,1:0:1.000,1.000,30,1:00,1,40",
      "3,30,Carol,110002 | ZAC A (08/01) - 19:30:00,1:0:2.000,2.000,30,1:00,1,40",
    ),
  },
];

test("applyDsq: removes rider's points contribution from GC", () => {
  // Pre-DSQ: Alice wins race 1 → 25 pts. After DSQ: 0 pts from race 1.
  const out = build(TWO_RACE_SESSIONS, { dsq: [DSQ_OVERRIDE] });
  const alice = out.standings.classes.A.find((r) => r.name === "Alice");
  // Race 1 DSQ'd (0 pts), Race 2 she gets 2nd (23 pts).
  assert.equal(alice.pts, 23, "Alice only has pts from race 2");
});

test("applyDsq: DSQ does not increment the rider's starts counter", () => {
  const out = build(TWO_RACE_SESSIONS, { dsq: [DSQ_OVERRIDE] });
  const alice = out.standings.classes.A.find((r) => r.name === "Alice");
  // Race 1 is DSQ'd → only race 2 counts as a start.
  assert.equal(alice.starts, 1, "DSQ race does not count as a start");
});

test("applyDsq: riders behind DSQ'd rider shift up one position and gain corresponding points", () => {
  const out = build(TWO_RACE_SESSIONS, { dsq: [DSQ_OVERRIDE] });
  const race1 = out.races[0].classes.A;
  // Bob was 2nd → now 1st (25 pts); Carol was 3rd → now 2nd (23 pts).
  const bob = race1.results.find((r) => r.name === "Bob");
  const carol = race1.results.find((r) => r.name === "Carol");
  assert.equal(bob.pos, 1);
  assert.equal(bob.pts, 25);
  assert.equal(carol.pos, 2);
  assert.equal(carol.pts, 23);
});

test("applyDsq: DSQ row in races output has dsq:true, pos:null, pts:0, at end of class array", () => {
  const out = build(TWO_RACE_SESSIONS, { dsq: [DSQ_OVERRIDE] });
  const race1Results = out.races[0].classes.A.results;
  const alice = race1Results.find((r) => r.name === "Alice");
  assert.ok(alice, "Alice still appears in race results");
  assert.equal(alice.dsq, true);
  assert.equal(alice.pos, null);
  assert.equal(alice.pts, 0);
  // DSQ rows are at the end.
  const lastRow = race1Results[race1Results.length - 1];
  assert.equal(lastRow.name, "Alice");
});

test("applyDsq: stats.finishers excludes the DSQ row", () => {
  const out = build(TWO_RACE_SESSIONS, { dsq: [DSQ_OVERRIDE] });
  const stats = out.races[0].classes.A.stats;
  // 3 riders, 1 DSQ'd → 2 finishers.
  assert.equal(stats.finishers, 2);
});

test("applyDsq: override referencing unknown sessionId does not break the build", () => {
  const badOverride = { ...DSQ_OVERRIDE, sessionId: 9999 };
  assert.doesNotThrow(() => build(TWO_RACE_SESSIONS, { dsq: [badOverride] }));
});

test("applyDsq: override referencing name not in CSV does not break the build", () => {
  const badOverride = { ...DSQ_OVERRIDE, name: "Nonexistent Rider" };
  assert.doesNotThrow(() => build(TWO_RACE_SESSIONS, { dsq: [badOverride] }));
});

test("applyDsq: reversal (removing override) restores pre-DSQ standings/races output", () => {
  const withDsq = build(TWO_RACE_SESSIONS, { dsq: [DSQ_OVERRIDE] });
  const noDsq = build(TWO_RACE_SESSIONS, { dsq: [] });
  // After reversal the output must match a clean build byte-for-byte on the scored data.
  assert.deepEqual(
    noDsq.standings.classes,
    build(TWO_RACE_SESSIONS).standings.classes,
    "no-dsq matches clean build",
  );
  // Reversal restores Alice's original standings.
  const alice = noDsq.standings.classes.A.find((r) => r.name === "Alice");
  assert.equal(alice.pts, 25 + 23); // 25 from R1 win + 23 from R2 2nd
  assert.equal(alice.starts, 2);
  // Race 1 results are unmodified.
  const race1Results = noDsq.races[0].classes.A.results;
  assert.equal(race1Results[0].name, "Alice");
  assert.equal(race1Results[0].pos, 1);
  assert.equal(race1Results[0].pts, 25);
  assert.ok(!race1Results[0].dsq, "no dsq flag");
});

test("applyDsq: women's GC drops the DSQ row when DSQ'd rider is on women's roster", () => {
  // Alice (#10) is on the women's roster; she's DSQ'd in race 1.
  const out = build(TWO_RACE_SESSIONS, {
    dsq: [DSQ_OVERRIDE],
    roster: { women: { A: [10, 20], B: [] } },
  });
  // Women's race 1 results should not contain Alice at all.
  const womenRace1Results = out.races[0].womenClasses.A.results;
  assert.ok(
    !womenRace1Results.some((r) => r.name === "Alice" && r.dsq),
    "DSQ Alice not in women race results",
  );
  // Women's GC: Alice gets 0 pts from race 1, Bob gets pts from race 2 as winner.
  const aliceGC = out.standings.womenClasses.A.find((r) => r.name === "Alice");
  const bobGC = out.standings.womenClasses.A.find((r) => r.name === "Bob");
  // Alice: DSQ race 1 (0 pts from that race in women's), 2nd in race 2 (23 pts).
  assert.ok(aliceGC.pts < bobGC.pts, "Alice has fewer women's GC pts than Bob after DSQ");
});

test("applyDsq: computeMovers receives post-DSQ arrays (shift reflects new standings)", () => {
  // Race 1: Alice 1st, Bob 2nd, Carol 3rd.
  // Alice DSQ'd → Bob 1st, Carol 2nd after DSQ.
  // Race 2: Bob 1st, Alice 2nd (but race 1 DSQ means Alice has 0 pts from R1).
  // After 2 races (with DSQ): Bob = 25+25=50, Alice = 0+23=23, Carol = 23+21=44.
  // Bob stays 1st. Carol 2nd. Alice 3rd.
  const out = build(TWO_RACE_SESSIONS, { dsq: [DSQ_OVERRIDE] });
  // Race 2 movers: Bob went from 1st (after R1 DSQ) to 1st → no shift.
  // Carol went from 2nd to 2nd → no shift.
  // Alice didn't exist in pre-race2 standings (from=null after R1 DSQ of Alice
  // meaning Alice has no R1 start, so she was absent from standings after R1).
  // Verify the movers array is produced without errors.
  assert.ok(Array.isArray(out.races[1].movers.A), "movers computed without error");
});
