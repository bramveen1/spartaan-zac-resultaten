import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { buildDocs, writeJSONIfChanged, loadCSV } from "./fetch-and-build.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFile(join(HERE, "fixtures", name), "utf8");

const withTmpDir = async (fn) => {
  const dir = await mkdtemp(join(tmpdir(), "fetch-and-build-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

test("buildDocs: assembles standingsDoc/racesDoc from sessions + config", async () => {
  const csv = await fixture("session-11869003.csv");
  const sessions = [{ n: 1, sessionId: 11869003, date: "2026-03-31", csv }];

  const { standingsDoc, racesDoc } = buildDocs({
    meta: { season: "Zomer 2026", racesTotal: 26 },
    sessions,
    roster: { women: [] },
    dsq: [],
    updatedAt: "2026-07-09T12:00:00.000Z",
  });

  assert.equal(standingsDoc.season, "Zomer 2026");
  assert.equal(standingsDoc.racesTotal, 26);
  assert.equal(standingsDoc.racesCompleted, 1);
  assert.equal(standingsDoc.updatedAt, "2026-07-09T12:00:00.000Z");
  assert.ok(standingsDoc.classes.A.length > 0, "class A has GC rows");
  assert.equal(racesDoc.updatedAt, "2026-07-09T12:00:00.000Z");
  assert.equal(racesDoc.races.length, 1);
});

test("buildDocs: falls back to defaults for missing season/racesTotal", async () => {
  const csv = await fixture("session-11869003.csv");
  const sessions = [{ n: 1, sessionId: 11869003, date: "2026-03-31", csv }];

  const { standingsDoc } = buildDocs({ meta: {}, sessions, roster: { women: [] }, dsq: [], updatedAt: "x" });

  assert.equal(standingsDoc.season, "Zomer 2026");
  assert.equal(standingsDoc.racesTotal, 26);
});

test("writeJSONIfChanged: writes a new file and reports changed", async () => {
  await withTmpDir(async (dir) => {
    const path = join(dir, "out.json");
    const changed = await writeJSONIfChanged(path, { a: 1 });
    assert.equal(changed, true);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { a: 1 });
  });
});

test("writeJSONIfChanged: identical content (ignoring volatile keys) is a no-op", async () => {
  await withTmpDir(async (dir) => {
    const path = join(dir, "out.json");
    await writeJSONIfChanged(path, { a: 1, updatedAt: "t0" }, ["updatedAt"]);
    const changed = await writeJSONIfChanged(path, { a: 1, updatedAt: "t1" }, ["updatedAt"]);
    assert.equal(changed, false);
    assert.equal(JSON.parse(await readFile(path, "utf8")).updatedAt, "t0", "file left untouched");
  });
});

test("writeJSONIfChanged: differing content writes and reports changed", async () => {
  await withTmpDir(async (dir) => {
    const path = join(dir, "out.json");
    await writeJSONIfChanged(path, { a: 1 });
    const changed = await writeJSONIfChanged(path, { a: 2 });
    assert.equal(changed, true);
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { a: 2 });
  });
});

test("loadCSV: fetches via the injected fetch impl and caches it to rawDir", async () => {
  await withTmpDir(async (dir) => {
    let calledUrl = null;
    const fetchImpl = async (url) => {
      calledUrl = url;
      return { ok: true, text: async () => "Pos,Competitor\n1,Alice\n" };
    };

    const csv = await loadCSV(12345, { offline: false, rawDir: dir, fetchImpl });

    assert.match(calledUrl, /sessions\/12345\/csv$/);
    assert.equal(csv, "Pos,Competitor\n1,Alice\n");
    assert.equal(await readFile(join(dir, "12345.csv"), "utf8"), "Pos,Competitor\n1,Alice\n");
  });
});

test("loadCSV: offline mode reads straight from the cache without touching fetch", async () => {
  await withTmpDir(async (dir) => {
    await writeFile(join(dir, "999.csv"), "cached content", "utf8");
    const fetchImpl = async () => {
      throw new Error("network must not be called in offline mode");
    };

    const csv = await loadCSV(999, { offline: true, rawDir: dir, fetchImpl });

    assert.equal(csv, "cached content");
  });
});

test("loadCSV: a failed fetch falls back to a previously cached CSV", async () => {
  await withTmpDir(async (dir) => {
    await writeFile(join(dir, "555.csv"), "stale but usable", "utf8");
    const fetchImpl = async () => ({ ok: false, status: 500, statusText: "Internal Server Error" });

    const csv = await loadCSV(555, { offline: false, rawDir: dir, fetchImpl });

    assert.equal(csv, "stale but usable");
  });
});

test("loadCSV: a failed fetch with no cache rethrows", async () => {
  await withTmpDir(async (dir) => {
    const fetchImpl = async () => ({ ok: false, status: 404, statusText: "Not Found" });

    await assert.rejects(() => loadCSV(1, { offline: false, rawDir: dir, fetchImpl }), /HTTP 404/);
  });
});
