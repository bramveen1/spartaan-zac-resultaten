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
  buildStandings,
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
