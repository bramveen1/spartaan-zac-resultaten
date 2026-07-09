#!/usr/bin/env node
/* ----------------------------------------------------------------------------
   discover-sessions.mjs

   Finds newly-uploaded ZAC race nights on Speedhive and appends them to
   data/config/sessions.json. Runs before fetch-and-build.mjs in the
   "Update standings" workflow.

   Two undocumented Speedhive endpoints back this:
     GET /organizations/{orgId}/events   -> event list
     GET /events/{eventId}/sessions      -> { groups: [ { sessions } ] }
   Treat both as a fragile external contract: a failed fetch skips that
   event/run rather than failing the whole workflow.

   Fail-closed: a candidate is only appended when exactly one race session
   matches and its date agrees with the event's startDate. Anything
   ambiguous, unreachable, or outside the expected date window is skipped
   with a warning in the run log rather than guessed — a wrong sessionId
   silently corrupts standings.

   CLI:
     node scripts/discover-sessions.mjs
   ---------------------------------------------------------------------------- */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SESSIONS_PATH = join(ROOT, "data/config/sessions.json");

const ORG_ID = 130867; // RWV de Spartaan
const API_BASE = "https://eventresults-api.speedhive.com/api/v0.2.3/eventresults";
const ORG_EVENTS_URL = `${API_BASE}/organizations/${ORG_ID}/events`;
const EVENT_SESSIONS_URL = (eventId) => `${API_BASE}/events/${eventId}/sessions`;

// A new candidate event's date must fall within this many days of the most
// recently known race, or it's treated as ambiguous (e.g. a stray event from
// another season reusing the same name) and skipped rather than guessed.
const MAX_GAP_DAYS = 21;

const NAME_PATTERN = /zomeravondcomp/i;
const RACE_SESSION_PATTERN = /zac/i;

async function fetchJSON(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

function dateOnly(iso) {
  return typeof iso === "string" ? iso.slice(0, 10) : null;
}

function daysBetween(a, b) {
  return Math.abs(new Date(a) - new Date(b)) / (1000 * 60 * 60 * 24);
}

// Picks the single race session out of an /events/{id}/sessions response.
// Fails closed: anything other than exactly one match returns an error.
export function selectRaceSession(eventSessionsResponse) {
  const groups = eventSessionsResponse?.groups ?? [];
  const sessions = groups.flatMap((g) => g.sessions ?? []);
  const candidates = sessions.filter(
    (s) => (s.type ?? "").toLowerCase() === "race" && RACE_SESSION_PATTERN.test(s.name ?? ""),
  );
  if (candidates.length !== 1) {
    return { error: `expected exactly 1 race session, found ${candidates.length}` };
  }
  return { session: candidates[0] };
}

// Pure planner: given the current sessions.json, the org's event list, and a
// map of eventId -> already-fetched event-sessions response (missing/falsy
// for events that failed to fetch), returns the sessions.json update to make.
// No I/O — network calls live in main() so this stays unit-testable offline.
export function planSessionUpdates({ sessionsDoc, events, eventSessionsById }) {
  const sessions = [...(sessionsDoc.sessions ?? [])];
  const knownSessionIds = new Set(sessions.map((s) => s.sessionId));
  const knownDates = new Set(sessions.map((s) => s.date));
  const racesTotal = sessionsDoc.racesTotal ?? Infinity;
  const warnings = [];
  const appended = [];

  let maxN = sessions.reduce((m, s) => Math.max(m, s.n), 0);
  let latestKnownDate = sessions.reduce((m, s) => (!m || s.date > m ? s.date : m), null);

  const candidates = (events ?? [])
    .filter((e) => NAME_PATTERN.test(e.name ?? ""))
    .slice()
    .sort((a, b) => (dateOnly(a.startDate) ?? "").localeCompare(dateOnly(b.startDate) ?? ""));

  for (const event of candidates) {
    const evDate = dateOnly(event.startDate);
    if (!evDate) {
      warnings.push(`event ${event.id} ("${event.name}"): missing/invalid startDate, skipping`);
      continue;
    }
    if (knownDates.has(evDate)) continue; // already have this race night

    if (sessions.length >= racesTotal) {
      warnings.push(
        `event ${event.id} ("${event.name}", ${evDate}): racesTotal (${racesTotal}) already reached, skipping`,
      );
      continue;
    }

    if (latestKnownDate && daysBetween(evDate, latestKnownDate) > MAX_GAP_DAYS) {
      warnings.push(
        `event ${event.id} ("${event.name}", ${evDate}): more than ${MAX_GAP_DAYS} days from latest known race (${latestKnownDate}), skipping to avoid a cross-season match`,
      );
      continue;
    }

    const eventSessionsResponse = eventSessionsById?.[event.id];
    if (!eventSessionsResponse) {
      warnings.push(`event ${event.id} ("${event.name}"): could not fetch its sessions, skipping`);
      continue;
    }

    const { session, error } = selectRaceSession(eventSessionsResponse);
    if (error) {
      warnings.push(`event ${event.id} ("${event.name}"): ${error}, skipping`);
      continue;
    }

    if (knownSessionIds.has(session.id)) continue; // already recorded

    const sessionDate = dateOnly(session.startTime);
    if (sessionDate !== evDate) {
      warnings.push(
        `event ${event.id} ("${event.name}"): session ${session.id} startTime date (${sessionDate}) does not match event startDate (${evDate}), skipping`,
      );
      continue;
    }

    maxN += 1;
    const entry = { n: maxN, sessionId: session.id, date: evDate };
    sessions.push(entry);
    appended.push(entry);
    knownSessionIds.add(session.id);
    knownDates.add(evDate);
    latestKnownDate = evDate;
  }

  return {
    sessionsDoc: { ...sessionsDoc, sessions },
    appended,
    warnings,
    changed: appended.length > 0,
  };
}

async function main() {
  const raw = await readFile(SESSIONS_PATH, "utf8");
  const sessionsDoc = JSON.parse(raw);
  const knownDates = new Set((sessionsDoc.sessions ?? []).map((s) => s.date));

  let events;
  try {
    events = await fetchJSON(ORG_EVENTS_URL);
  } catch (e) {
    console.warn(`discover-sessions: could not fetch org events (${e.message}) — skipping this run.`);
    return;
  }

  const candidates = (events ?? []).filter(
    (e) => NAME_PATTERN.test(e.name ?? "") && !knownDates.has(dateOnly(e.startDate)),
  );
  const eventSessionsById = {};
  for (const event of candidates) {
    try {
      eventSessionsById[event.id] = await fetchJSON(EVENT_SESSIONS_URL(event.id));
    } catch (e) {
      console.warn(`discover-sessions: event ${event.id} ("${event.name}"): could not fetch sessions (${e.message})`);
    }
  }

  const { sessionsDoc: next, appended, warnings, changed } = planSessionUpdates({
    sessionsDoc,
    events,
    eventSessionsById,
  });

  for (const w of warnings) console.warn(`discover-sessions: ${w}`);

  if (!changed) {
    console.log("discover-sessions: no new sessions found.");
    return;
  }

  await writeFile(SESSIONS_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
  for (const a of appended) {
    console.log(`discover-sessions: appended race ${a.n} — session ${a.sessionId} (${a.date})`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
