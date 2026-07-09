import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { selectRaceSession, planSessionUpdates } from "./discover-sessions.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixtureJSON = async (name) =>
  JSON.parse(await readFile(join(HERE, "fixtures", name), "utf8"));

const baseSessionsDoc = () => ({
  season: "Zomer 2026",
  racesTotal: 26,
  sessions: [
    { n: 14, sessionId: 12380889, date: "2026-06-30" },
    { n: 15, sessionId: 12429258, date: "2026-07-07" },
  ],
});

test("selectRaceSession: exactly one race session matches", async () => {
  const resp = await fixtureJSON("discover-event-sessions-3700200.json");
  const { session, error } = selectRaceSession(resp);
  assert.equal(error, undefined);
  assert.equal(session.id, 12470001);
});

test("selectRaceSession: zero race sessions fails closed", () => {
  const { session, error } = selectRaceSession({ groups: [{ sessions: [] }] });
  assert.equal(session, undefined);
  assert.match(error, /found 0/);
});

test("selectRaceSession: a ZAC A / ZAC B split fails closed", async () => {
  const resp = await fixtureJSON("discover-event-sessions-3700400.json");
  const { session, error } = selectRaceSession(resp);
  assert.equal(session, undefined);
  assert.match(error, /found 2/);
});

test("planSessionUpdates: appends the one new race, skips known/non-matching/ambiguous/out-of-window events", async () => {
  const events = await fixtureJSON("discover-org-events.json");
  const eventSessionsById = {
    3700200: await fixtureJSON("discover-event-sessions-3700200.json"),
    3700400: await fixtureJSON("discover-event-sessions-3700400.json"),
  };

  const result = planSessionUpdates({ sessionsDoc: baseSessionsDoc(), events, eventSessionsById });

  assert.equal(result.changed, true);
  assert.deepEqual(result.appended, [{ n: 16, sessionId: 12470001, date: "2026-07-14" }]);
  assert.deepEqual(result.sessionsDoc.sessions.at(-1), { n: 16, sessionId: 12470001, date: "2026-07-14" });
  assert.equal(result.sessionsDoc.sessions.length, 3);

  // event 3700400 (ZAC A/B split) and 3800000 (>21 days from the latest race) both warn.
  assert.equal(result.warnings.length, 2);
  assert.ok(result.warnings.some((w) => /3700400/.test(w) && /found 2/.test(w)));
  assert.ok(result.warnings.some((w) => /3800000/.test(w) && /skipping to avoid a cross-season match/.test(w)));
});

test("planSessionUpdates: re-running against the already-updated doc is a no-op", async () => {
  const events = await fixtureJSON("discover-org-events.json");
  const sessionsDoc = {
    ...baseSessionsDoc(),
    sessions: [...baseSessionsDoc().sessions, { n: 16, sessionId: 12470001, date: "2026-07-14" }],
  };
  const eventSessionsById = {
    3700200: await fixtureJSON("discover-event-sessions-3700200.json"),
  };

  const result = planSessionUpdates({ sessionsDoc, events, eventSessionsById });

  assert.equal(result.changed, false);
  assert.deepEqual(result.appended, []);
});

test("planSessionUpdates: stops once racesTotal is reached", async () => {
  const events = [
    { id: 3700200, name: "ZomerAvondComp nr-16 De Spartaan", startDate: "2026-07-14T19:30:00Z" },
  ];
  const eventSessionsById = { 3700200: await fixtureJSON("discover-event-sessions-3700200.json") };
  const sessionsDoc = { ...baseSessionsDoc(), racesTotal: 2 }; // already has 2 sessions recorded

  const result = planSessionUpdates({ sessionsDoc, events, eventSessionsById });

  assert.equal(result.changed, false);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /racesTotal \(2\) already reached/);
});

test("planSessionUpdates: event startDate disagreeing with the session's startTime date fails closed", () => {
  const events = [
    { id: 9999, name: "ZomerAvondComp nr-16 De Spartaan", startDate: "2026-07-14T19:30:00Z" },
  ];
  const eventSessionsById = {
    9999: {
      groups: [{ sessions: [{ id: 1, name: "ZAC A (15/07)", type: "race", startTime: "2026-07-15T19:30:00Z" }] }],
    },
  };

  const result = planSessionUpdates({ sessionsDoc: baseSessionsDoc(), events, eventSessionsById });

  assert.equal(result.changed, false);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /does not match event startDate/);
});

test("planSessionUpdates: an event whose sessions couldn't be fetched is skipped with a warning, not guessed", () => {
  const events = [
    { id: 9999, name: "ZomerAvondComp nr-16 De Spartaan", startDate: "2026-07-14T19:30:00Z" },
  ];

  const result = planSessionUpdates({ sessionsDoc: baseSessionsDoc(), events, eventSessionsById: {} });

  assert.equal(result.changed, false);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /could not fetch its sessions/);
});
