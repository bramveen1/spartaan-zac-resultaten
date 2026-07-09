#!/usr/bin/env node
/* ----------------------------------------------------------------------------
   fetch-and-build.mjs

   Reads data/sessions.json, fetches each session's CSV from Speedhive, runs
   the pure build() function, and writes data/standings.json + data/races.json
   only when they actually change (ignoring the volatile updatedAt timestamp).

   Network failures on a single session are logged and skipped — the action
   doesn't fail the whole run for one CSV hiccup.

   CLI:
     node scripts/fetch-and-build.mjs            fetch live
     node scripts/fetch-and-build.mjs --offline  use cached CSVs in data/raw
   ---------------------------------------------------------------------------- */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "./build-standings.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SESSIONS_PATH = join(ROOT, "data/config/sessions.json");
const STANDINGS_PATH = join(ROOT, "data/standings.json");
const RACES_PATH = join(ROOT, "data/races.json");
const RAW_DIR = join(ROOT, "data/raw");
const WOMEN_ROSTER_PATH = join(ROOT, "data/config/roster/women.json");
const DSQ_PATH = join(ROOT, "data/config/dsq.json");

const CSV_URL = (id) =>
  `https://eventresults-api.speedhive.com/api/v0.2.3/eventresults/sessions/${id}/csv`;

const offline = process.argv.includes("--offline");

async function fetchCSV(sessionId, fetchImpl) {
  const res = await fetchImpl(CSV_URL(sessionId), {
    headers: { Accept: "text/csv,*/*" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.text();
}

// rawDir/fetchImpl are injectable so tests can exercise this against a temp
// cache dir and a stubbed fetch instead of the real data/raw dir and network.
export async function loadCSV(sessionId, { offline: isOffline = offline, rawDir = RAW_DIR, fetchImpl = fetch } = {}) {
  const cachePath = join(rawDir, `${sessionId}.csv`);
  if (isOffline) {
    return readFile(cachePath, "utf8");
  }
  try {
    const csv = await fetchCSV(sessionId, fetchImpl);
    await mkdir(rawDir, { recursive: true });
    await writeFile(cachePath, csv, "utf8");
    return csv;
  } catch (e) {
    if (existsSync(cachePath)) {
      console.warn(`  fetch failed (${e.message}), using cached CSV`);
      return readFile(cachePath, "utf8");
    }
    throw e;
  }
}

export async function writeJSONIfChanged(path, data, ignore = []) {
  const next = JSON.stringify(data, null, 2) + "\n";
  let prev = null;
  try { prev = await readFile(path, "utf8"); } catch (_) {}
  if (prev) {
    try {
      const a = JSON.parse(prev);
      const b = JSON.parse(next);
      for (const k of ignore) { delete a[k]; delete b[k]; }
      if (JSON.stringify(a) === JSON.stringify(b)) return false;
    } catch (_) {
      // fall through to write
    }
  }
  await writeFile(path, next, "utf8");
  return true;
}

// Pure: turns fetched sessions + config into the two output docs. No I/O, so
// it's unit-testable against fixture CSVs without touching the filesystem.
export function buildDocs({ meta, sessions, roster, dsq, updatedAt }) {
  const { standings, races } = build(sessions, { roster, dsq });

  const standingsDoc = {
    season: meta.season ?? "Zomer 2026",
    racesCompleted: standings.racesCompleted,
    racesTotal: meta.racesTotal ?? 26,
    updatedAt,
    classes: standings.classes,
    womenClasses: standings.womenClasses,
  };
  const racesDoc = { updatedAt, races };

  return { standingsDoc, racesDoc };
}

async function main() {
  const meta = JSON.parse(await readFile(SESSIONS_PATH, "utf8"));
  const sessions = [];
  for (const s of meta.sessions ?? []) {
    process.stdout.write(`Race ${s.n} (session ${s.sessionId})… `);
    try {
      const csv = await loadCSV(s.sessionId);
      sessions.push({ ...s, csv });
      process.stdout.write("ok\n");
    } catch (e) {
      process.stdout.write(`SKIPPED (${e.message})\n`);
    }
  }

  let roster = { women: [] };
  try {
    roster = JSON.parse(await readFile(WOMEN_ROSTER_PATH, "utf8"));
  } catch (_) {
    // Roster file is optional — empty roster yields empty womenClasses.
  }

  let dsq = [];
  try {
    const dsqDoc = JSON.parse(await readFile(DSQ_PATH, "utf8"));
    dsq = dsqDoc.overrides ?? [];
  } catch (_) {
    // DSQ file is optional — no overrides means no DSQs applied.
  }

  const updatedAt = new Date().toISOString();
  const { standingsDoc, racesDoc } = buildDocs({ meta, sessions, roster, dsq, updatedAt });

  const sChanged = await writeJSONIfChanged(STANDINGS_PATH, standingsDoc, ["updatedAt"]);
  const rChanged = await writeJSONIfChanged(RACES_PATH, racesDoc, ["updatedAt"]);
  console.log(`standings.json: ${sChanged ? "updated" : "unchanged"}`);
  console.log(`races.json:     ${rChanged ? "updated" : "unchanged"}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
