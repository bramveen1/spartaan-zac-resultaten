/* ----------------------------------------------------------------------------
   De Spartaan — site.js (formerly prototype.js)

   Loads the computed standings + races from data/*.json, renders the three
   views (Klassement, Race-avond, Renner-detail), and handles tap-to-pin.

   Pure vanilla JS, no framework, no bundler. Same render shape as the design
   prototype — the SAMPLE_* constants have been replaced with fetched data.
   ---------------------------------------------------------------------------- */

const STORAGE_KEY = "despartaan.me";       // "<class>:<startNumber>", e.g. "A:47"
const WOMEN_PREVIEW_KEY = "womenGcPreview"; // sessionStorage: "true" enables Women GC tabs

const MAANDEN = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const DAGEN_FULL = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
const DAGEN_SHORT = ["zo", "ma", "di", "wo", "do", "vr", "za"];

function nlDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MAANDEN[m - 1]}`;
}
function nlDayFull(iso) {
  if (!iso) return "";
  return DAGEN_FULL[new Date(iso + "T12:00:00Z").getUTCDay()];
}
function nlDayShort(iso) {
  if (!iso) return "";
  return DAGEN_SHORT[new Date(iso + "T12:00:00Z").getUTCDay()];
}
function nlDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const dd = d.getDate();
  const mm = MAANDEN[d.getMonth()];
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd} ${mm} ${hh}:${mi}`;
}
function ordNL(n) { return `${n}<sup>e</sup>`; }

/* ---------- RACE-TIME FORMATTING ----------
   Speedhive serves times as "H:M:S.mmm" without zero-padding (e.g.
   "1:2:33.558" or "1:3:0.507") and a Diff column that's only meaningful
   relative to the GLOBAL race leader. For a class that doesn't contain
   that leader (e.g. class A in races where class B's leader is fastest
   overall), the Diff field reads "4 laps" for every A rider — useless
   for the in-class comparison the user actually wants. So we compute
   intra-class gaps ourselves from the absolute times.
   ------------------------------------------ */

function parseTimeToSeconds(s) {
  if (!s) return null;
  const parts = s.split(":").map((p) => parseFloat(p));
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

// Pad the integer side of a numeric segment to ≥2 digits.
// "2" → "02"; "33.558" → "33.558" (already 2 digits); "0.507" → "00.507".
function padTimePart(p) {
  if (!p) return p;
  const dot = p.indexOf(".");
  const intLen = dot === -1 ? p.length : dot;
  return intLen < 2 ? "0" + p : p;
}

// "1:2:33.558" → "1:02:33.558"; "1:3:0.507" → "1:03:00.507"
function formatAbsTime(s) {
  if (!s || !s.includes(":")) return s ?? "";
  return s.split(":").map((p, i) => i === 0 ? p : padTimePart(p)).join(":");
}

// 0.088 → "0.088"; 7.334 → "7.334"; 92.5 → "1:32.500"
function formatGap(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  if (seconds < 60) return seconds.toFixed(3);
  const mins = Math.floor(seconds / 60);
  const secs = seconds - mins * 60;
  return `${mins}:${padTimePart(secs.toFixed(3))}`;
}

// Returns the display string for the TIJD column of one race result row.
//   - winner row → absolute time, normalized
//   - same lap as winner → "+gap"
//   - laps down → "+N ronde(n)"
function formatRaceTime(result, winner) {
  if (!result) return "";
  if (!winner || result === winner) return formatAbsTime(result.time);
  if (Number.isFinite(result.laps) && Number.isFinite(winner.laps) && result.laps < winner.laps) {
    const down = winner.laps - result.laps;
    return `+${down} ${down === 1 ? "ronde" : "ronden"}`;
  }
  const a = parseTimeToSeconds(result.time);
  const b = parseTimeToSeconds(winner.time);
  if (a == null || b == null) return formatAbsTime(result.time);
  return `+${formatGap(a - b)}`;
}

// Storage value: "<class>:<rider name>". Split on the FIRST colon so names
// containing ":" don't get truncated.
function classFromMe(me) {
  if (!me) return null;
  const i = me.indexOf(":");
  return i < 0 ? null : me.slice(0, i);
}
function nameFromMe(me) {
  if (!me) return null;
  const i = me.indexOf(":");
  return i < 0 ? null : me.slice(i + 1);
}

function getMe() {
  try { return localStorage.getItem(STORAGE_KEY) || null; }
  catch (_) { return null; }
}
function setMe(cls, name) {
  try { localStorage.setItem(STORAGE_KEY, `${cls}:${name}`); } catch (_) {}
}
function clearMe() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
}

// Older deploys stored "<class>:<startNumber>". If the second half is purely
// numeric, try to resolve it via standings and re-store by name; else clear.
function migrateMeFromNrToName() {
  const me = getMe();
  if (!me || !state.standings) return;
  const cls = classFromMe(me);
  const ident = nameFromMe(me);
  if (!cls || !ident) return;
  const isNumeric = /^\d+$/.test(ident);
  if (!isNumeric) return;
  const row = (state.standings.classes[cls] ?? []).find((r) => String(r.nr) === ident);
  if (row) setMe(cls, row.name);
  else clearMe();
}

// Minimal HTML escape — rider names are user-supplied via the CSV and end up
// inside data attributes and cell text.
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
function idSafe(s) {
  return String(s).replace(/[^a-zA-Z0-9]/g, "-");
}

/* ---------- STATE ---------- */

const state = {
  standings: null,   // data/standings.json
  races: null,       // data/races.json
  siteConfig: null,  // data/site_config.json (features flags)
  womenRoster: null, // data/roster/women.json (per-class start numbers)
  cls: "A",          // currently selected class on the standings view: "A" | "B" | "WA" | "WB"
  raceIdx: 0,        // currently selected race index (0-based)
  rider: null,       // { cls, name } when rider detail is open
  riderView: "overall", // "overall" | "women" — toggled from inside the rider modal
};

// "WA" / "WB" → "A" / "B"; passthrough for non-women classes. Women's tabs
// re-use the underlying class for race-night, rider detail, and pin matching.
function effectiveCls(cls) {
  return cls === "WA" || cls === "WB" ? cls.slice(1) : cls;
}
function isWomenCls(cls) {
  return cls === "WA" || cls === "WB";
}

function isWomenVisible() {
  if (state.siteConfig?.features?.womenGc === true) return true;
  try { return sessionStorage.getItem(WOMEN_PREVIEW_KEY) === "true"; }
  catch (_) { return false; }
}

// Does the rider with start number `nr` in class `cls` appear on the
// women's roster? Used to gate the Overall/Vrouwen toggle in rider detail.
function isWomanRider(cls, nr) {
  const list = state.womenRoster?.women?.[cls];
  if (!Array.isArray(list)) return false;
  return list.map(Number).includes(Number(nr));
}

/* ---------- DATA LOAD ---------- */

async function loadData() {
  const [standings, races, siteConfig, womenRoster] = await Promise.all([
    fetch("data/standings.json", { cache: "no-store" }).then((r) => r.json()),
    fetch("data/races.json", { cache: "no-store" }).then((r) => r.json()),
    // site_config is optional — missing or invalid → no feature flags
    fetch("data/site_config.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { features: {} }))
      .catch(() => ({ features: {} })),
    // Roster is optional — missing → no woman ever flagged in rider detail
    fetch("data/roster/women.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { women: { A: [], B: [] } }))
      .catch(() => ({ women: { A: [], B: [] } })),
  ]);
  state.standings = standings;
  state.races = races;
  state.siteConfig = siteConfig;
  state.womenRoster = womenRoster;
  // Default to latest race; default class follows the pinned rider, else A.
  state.raceIdx = Math.max(0, (races.races?.length ?? 1) - 1);
  const me = getMe();
  if (me && classFromMe(me)) state.cls = classFromMe(me);
}

/* ---------- RENDERERS ---------- */

function renderHeaderMeta() {
  const s = state.standings;
  const sub = document.querySelector("#standings .view__sub");
  if (sub) {
    sub.textContent = `Na ${s.racesCompleted} van ${s.racesTotal} races · bijgewerkt ${nlDateTime(s.updatedAt)}`;
  }
  // Topbar tab label reflects the pinned rider (or just "Renner" if not pinned).
  const riderTab = document.querySelector('.viewnav__tab[data-view="rider"]');
  if (riderTab) {
    const me = getMe();
    const meName = nameFromMe(me);
    const meCls = classFromMe(me);
    const row = meName ? (state.standings?.classes[meCls] ?? []).find((r) => r.name === meName) : null;
    riderTab.textContent = row ? `Renner #${row.nr}` : "Renner";
  }
}

function renderClassToggle() {
  // Both views now have 4 options (A, B, WA, WB) — exact match on state.cls.
  document.querySelectorAll(".classtoggle__opt").forEach((opt) => {
    const active = opt.dataset.class === state.cls;
    opt.classList.toggle("is-active", active);
    opt.setAttribute("aria-selected", String(active));
  });
}

function applyWomenVisibility() {
  const visible = isWomenVisible();
  document.querySelectorAll(".classtoggle__opt--women").forEach((b) => {
    b.hidden = !visible;
  });
  document.querySelectorAll(".classtoggle").forEach((tg) => {
    tg.classList.toggle("classtoggle--with-women", visible);
  });
  // If the flag turns off mid-session (or the user clears sessionStorage),
  // fall back to the underlying class so the views stay valid, and snap the
  // rider modal back to the overall view.
  if (!visible) {
    if (isWomenCls(state.cls)) state.cls = effectiveCls(state.cls);
    if (state.riderView === "women") state.riderView = "overall";
  }
}

function renderStandings() {
  const body = document.getElementById("standings-body");
  if (!body || !state.standings) return;
  const women = isWomenCls(state.cls);
  const eff = effectiveCls(state.cls);
  const rows = women
    ? (state.standings.womenClasses?.[eff] ?? [])
    : (state.standings.classes[eff] ?? []);
  const me = getMe();
  const meCls = classFromMe(me);
  const meName = nameFromMe(me);

  body.innerHTML = rows.map((row) => {
    // Pin keys by the underlying class (a rider is in A or B, not "WA").
    const isMe = meCls === eff && row.name === meName;
    const deltaCls = row.lastPts >= 21 ? "delta--up" : row.lastPts >= 10 ? "delta--flat" : "delta--down";
    const deltaPrefix = row.lastPts > 0 ? "+" : "";
    const posLabel = row.joint ? `${row.pos}<sup>jt</sup>` : row.pos;
    return `
      <tr class="${isMe ? "is-me" : ""}" data-name="${esc(row.name)}" data-class="${eff}" id="row-${state.cls}-${idSafe(row.name)}">
        <td class="num pos">${posLabel}</td>
        <td class="num nr">#${row.nr}</td>
        <td>${esc(row.name)}</td>
        <td class="num pts">${row.pts}</td>
        <td class="num desktop-only ${deltaCls}">${deltaPrefix}${row.lastPts}</td>
        <td class="num desktop-only">${row.gap === 0 ? "—" : row.gap}</td>
        <td class="pin">${isMe ? '<span class="pin-mark" aria-label="Vastgepind">★</span>' : ""}</td>
      </tr>
    `;
  }).join("");
}

function renderMePin() {
  const el = document.getElementById("mepin");
  if (!el || !state.standings) return;
  const me = getMe();
  if (!me) { el.classList.add("is-hidden"); return; }
  const meCls = classFromMe(me);
  const meName = nameFromMe(me);
  const row = (state.standings.classes[meCls] ?? []).find((r) => r.name === meName);
  if (!row) { el.classList.add("is-hidden"); return; }
  el.classList.remove("is-hidden");
  document.getElementById("mepin-pos").innerHTML = ordNL(row.pos);
  document.getElementById("mepin-nrm").textContent = `#${row.nr}`;
  document.getElementById("mepin-pts").textContent = `${row.pts} pnt`;
}

function renderRace() {
  if (!state.races) return;
  const race = state.races.races[state.raceIdx];
  if (!race) return;
  const women = isWomenCls(state.cls);
  const raceCls = effectiveCls(state.cls); // "A" or "B" — used for click-through + label
  const classLabel = women ? `Vrouwen ${raceCls}` : `Klasse ${raceCls}`;

  // Eyebrow + title meta
  const eyebrow = document.querySelector("#race .eyebrow");
  if (eyebrow) {
    eyebrow.textContent = `Race ${race.n} · ${nlDayFull(race.date)} ${nlDate(race.date)} · ${classLabel}`;
  }
  const pagerLabel = document.querySelector("#race .racepager__label");
  if (pagerLabel) {
    pagerLabel.innerHTML = `Race <strong>${race.n}</strong> / ${state.standings?.racesTotal ?? "—"}`;
  }
  const total = state.races.races.length;
  const prev = document.querySelector('#race .racepager__btn[aria-label="Vorige race"]');
  const next = document.querySelector('#race .racepager__btn[aria-label="Volgende race"]');
  if (prev) prev.classList.toggle("is-disabled", state.raceIdx === 0);
  if (prev) prev.disabled = state.raceIdx === 0;
  if (next) next.classList.toggle("is-disabled", state.raceIdx >= total - 1);
  if (next) next.disabled = state.raceIdx >= total - 1;

  // Card meta (laps / winner time / finishers). Women's tab reads from the
  // per-race women's subset; fall back to empty if the JSON pre-dates it.
  const cls = women
    ? (race.womenClasses?.[raceCls] ?? { results: [], stats: {} })
    : (race.classes[raceCls] ?? { results: [], stats: {} });
  const meta = document.querySelector("#race .card .card__meta");
  if (meta) {
    const s = cls.stats;
    const winnerTimeStr = s.winnerTime ? formatAbsTime(s.winnerTime) : "—";
    meta.textContent = `${s.laps ?? 0} ronden · ${winnerTimeStr} winnaar · ${s.finishers ?? 0} finishers`;
  }
  const sourceLink = document.getElementById("race-source-link");
  if (sourceLink) {
    if (race.sessionId) {
      sourceLink.href = `https://sporthive.com/sessions/${race.sessionId}#byclass`;
      sourceLink.hidden = false;
    } else {
      sourceLink.hidden = true;
    }
  }

  // Results table
  const body = document.getElementById("race-body");
  const me = getMe();
  const meCls = classFromMe(me);
  const meName = nameFromMe(me);
  const results = cls.results ?? [];
  const raceWinner = results[0] ?? null;
  body.innerHTML = results.map((r) => {
    const isMe = meCls === raceCls && r.name === meName;
    const timeDisplay = formatRaceTime(r, raceWinner);
    return `
      <tr class="${isMe ? "is-me" : ""}" data-name="${esc(r.name)}" data-class="${raceCls}">
        <td class="num pos">${r.pos}</td>
        <td class="num nr">#${r.nr}</td>
        <td>${esc(r.name)}</td>
        <td class="num">${r.laps}</td>
        <td class="num">${timeDisplay}</td>
        <td class="num pts">${r.pts}</td>
      </tr>
    `;
  }).join("");

  // Movers — separate dataset for the women's GC shifts.
  const moversEl = document.getElementById("movers-body");
  if (moversEl) {
    const moversSource = women ? race.womenMovers : race.movers;
    const movers = (moversSource && moversSource[raceCls]) ?? [];
    if (!movers.length) {
      moversEl.innerHTML = `<li class="mover mover--empty">Geen verschuivingen om te tonen.</li>`;
    } else {
      moversEl.innerHTML = movers.map((m) => {
        const dir = m.shift > 0 ? "up" : "down";
        const arrow = m.shift > 0 ? "↑" : "↓";
        const isMe = meCls === raceCls && m.name === meName;
        return `
          <li class="mover ${isMe ? "is-me" : ""}" data-name="${esc(m.name)}" data-class="${raceCls}">
            <span class="mover__arrow mover__arrow--${dir}">${arrow}</span>
            <div class="mover__id">
              <div class="mover__name">${esc(m.name)}</div>
              <div class="mover__nrm">#${m.nr} · ${m.from}<sup>e</sup> → ${m.to}<sup>e</sup></div>
            </div>
            <div class="mover__shift">${m.shift > 0 ? "+" : ""}${m.shift} <small>plekken</small></div>
          </li>
        `;
      }).join("");
    }
  }

  // Next race card. For past races we use the actual following race's date.
  // For the most recent race (no next entry in data yet) we project current
  // race date + 7 days so the card shows next Tuesday by default.
  let nextDate = null;
  let nextNumber = null;
  const followUp = state.races.races[state.raceIdx + 1];
  if (followUp) {
    nextDate = followUp.date;
    nextNumber = followUp.n;
  } else if (race.date) {
    const d = new Date(race.date + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + 7);
    nextDate = d.toISOString().slice(0, 10);
    nextNumber = race.n + 1;
  }
  if (nextDate) {
    const day = document.querySelector(".next__day");
    const num = document.querySelector(".next__num");
    const mon = document.querySelector(".next__mon");
    const nm = document.querySelector(".next__name");
    if (day) day.textContent = nlDayShort(nextDate).replace(/^./, (c) => c.toUpperCase());
    if (num) num.textContent = String(new Date(nextDate + "T12:00:00Z").getUTCDate());
    if (mon) mon.textContent = MAANDEN[new Date(nextDate + "T12:00:00Z").getUTCMonth()];
    if (nm) nm.textContent = `Race ${nextNumber} — Zomeravondcompetitie`;
  }
}

function renderRider() {
  if (!state.rider || !state.races || !state.standings) return;
  const { cls, name } = state.rider;
  // Find the rider's overall standing first — we need her start number to
  // check the roster, and the overall row is the fallback if the women's
  // standing doesn't have her (e.g. she's on the roster but never raced).
  const overallStanding = (state.standings.classes[cls] ?? []).find((r) => r.name === name);
  const riderNr = overallStanding?.nr ?? null;

  // Determine whether the Overall/Vrouwen toggle is applicable.
  const womenToggleVisible =
    isWomenVisible() &&
    riderNr != null &&
    isWomanRider(cls, riderNr);
  const women = womenToggleVisible && state.riderView === "women";

  // Show/hide the toggle and reflect the active option.
  const toggleEl = document.getElementById("rider-view-toggle");
  if (toggleEl) {
    toggleEl.hidden = !womenToggleVisible;
    toggleEl.querySelectorAll(".classtoggle__opt").forEach((opt) => {
      const active = (opt.dataset.riderView === "women") === women;
      opt.classList.toggle("is-active", active);
      opt.setAttribute("aria-selected", String(active));
    });
  }

  // Pick the standing + history source based on the active view.
  const standing = women
    ? (state.standings.womenClasses?.[cls] ?? []).find((r) => r.name === name)
    : overallStanding;
  const classLabel = women ? `Vrouwen ${cls}` : `Klasse ${cls}`;

  // Title block
  const numEl = document.querySelector(".ridercard__num");
  const nameEl = document.querySelector(".ridercard__name");
  const posEl = document.querySelector(".ridercard__pos");
  // Number is always displayed from the overall row (women's subset shares it).
  if (numEl) numEl.textContent = overallStanding ? `#${overallStanding.nr}` : "#—";
  if (nameEl) nameEl.textContent = name;
  if (posEl) posEl.innerHTML = standing
    ? `${ordNL(standing.pos)} in ${classLabel} · ${standing.pts} pnt`
    : `Geen klassement in ${classLabel}`;

  // History rows — source flips with the view. The race's stored laps/time/
  // diff are identical; only pos and pts change in the women's subset.
  const races = state.races.races;
  const history = races.map((race) => {
    const source = women
      ? (race.womenClasses?.[cls]?.results ?? [])
      : (race.classes[cls]?.results ?? []);
    const result = source.find((r) => r.name === name);
    const winner = source[0] ?? null;
    return { race, result, winner };
  });

  const body = document.getElementById("rider-body");
  body.innerHTML = history.map(({ race, result, winner }) => {
    if (!result) {
      return `
        <tr class="is-dns">
          <td class="num">${race.n}</td>
          <td>${nlDate(race.date)}</td>
          <td class="num">—</td>
          <td class="num">—</td>
          <td class="num">DNS</td>
          <td class="num">0</td>
        </tr>
      `;
    }
    const timeDisplay = formatRaceTime(result, winner);
    return `
      <tr>
        <td class="num">${race.n}</td>
        <td>${nlDate(race.date)}</td>
        <td class="num">${ordNL(result.pos)}</td>
        <td class="num">${result.laps}</td>
        <td class="num">${timeDisplay}</td>
        <td class="num">${result.pts}</td>
      </tr>
    `;
  }).reverse().join("");

  // Stats — recomputed from the active history.
  const completed = history.filter((h) => h.result);
  const bestFinish = completed.reduce((b, h) => !b || h.result.pos < b.result.pos ? h : b, null);
  const avgPts = completed.length ? (completed.reduce((s, h) => s + h.result.pts, 0) / completed.length) : 0;
  const dns = history.length - completed.length;

  const stats = document.querySelector("#rider .stats");
  if (stats) {
    stats.innerHTML = `
      <div class="stat">
        <span class="stat__label">Beste finish</span>
        <span class="stat__value">${bestFinish ? ordNL(bestFinish.result.pos) : "—"}</span>
        <span class="stat__meta">${bestFinish ? `Race ${bestFinish.race.n} · ${nlDate(bestFinish.race.date)}` : "—"}</span>
      </div>
      <div class="stat">
        <span class="stat__label">Gem. punten</span>
        <span class="stat__value">${avgPts.toFixed(1).replace(".", ",")}</span>
        <span class="stat__meta">over ${completed.length} ${completed.length === 1 ? "start" : "starts"}</span>
      </div>
      <div class="stat">
        <span class="stat__label">Starts</span>
        <span class="stat__value">${completed.length} / ${history.length}</span>
        <span class="stat__meta">${dns} DNS</span>
      </div>
      <div class="stat">
        <span class="stat__label">Punten totaal</span>
        <span class="stat__value">${standing?.pts ?? 0}</span>
        <span class="stat__meta">${classLabel}</span>
      </div>
    `;
  }

  // Pin button reflects current state (pin keys by underlying class only).
  const btn = document.getElementById("pin-toggle");
  if (btn) {
    const me = getMe();
    const isPinned = classFromMe(me) === cls && nameFromMe(me) === name;
    btn.classList.toggle("is-pinned", isPinned);
    btn.querySelector(".btn__label").textContent = isPinned ? "Vastgepind als mij" : "Vastpinnen als mij";
  }
}

function renderAll() {
  applyWomenVisibility();
  renderHeaderMeta();
  renderClassToggle();
  renderStandings();
  renderRace();
  renderMePin();
  if (state.rider) renderRider();
}

/* ---------- VIEW SWITCHING ---------- */

function switchView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("is-active", v.id === name));
  document.querySelectorAll(".viewnav__tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === name));
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

function openRider(cls, name) {
  if (!name) return;
  state.rider = { cls, name: String(name) };
  state.riderView = "overall"; // fresh open always starts on Overall
  renderRider();
  switchView("rider");
}

/* ---------- BOOT ---------- */

document.addEventListener("DOMContentLoaded", async () => {
  // Preview gate: ?preview=women flips sessionStorage so navigating the site
  // (and refresh) keeps the Women GC tabs visible. A new tab from a clean URL
  // drops the flag. Once site_config.features.womenGc is true, this is a no-op.
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("preview") === "women") {
      sessionStorage.setItem(WOMEN_PREVIEW_KEY, "true");
    }
  } catch (_) { /* sessionStorage unavailable — fall back to flag-only */ }

  try {
    await loadData();
  } catch (e) {
    console.error("Failed to load data:", e);
    const body = document.getElementById("standings-body");
    if (body) body.innerHTML = `<tr><td colspan="7" style="padding:24px;text-align:center">Kon de standen niet laden. Probeer later opnieuw.</td></tr>`;
    return;
  }
  migrateMeFromNrToName();
  renderAll();

  // Tab nav
  document.querySelectorAll(".viewnav__tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const view = tab.dataset.view;
      if (view === "rider") {
        const me = getMe();
        if (me) openRider(classFromMe(me), nameFromMe(me));
        else {
          // Default to the leader of the current class so the view is reachable.
          // For Vrouwen tabs fall back to the underlying class's leader.
          const eff = effectiveCls(state.cls);
          const leader = state.standings?.classes[eff]?.[0];
          if (leader) openRider(eff, leader.name);
        }
      } else {
        switchView(view);
      }
    });
  });

  // Class toggle
  document.querySelectorAll(".classtoggle__opt").forEach((opt) => {
    opt.addEventListener("click", () => {
      state.cls = opt.dataset.class;
      renderClassToggle();
      renderStandings();
      renderRace();
      renderMePin();
    });
  });

  // Race pager
  const prev = document.querySelector('#race .racepager__btn[aria-label="Vorige race"]');
  const next = document.querySelector('#race .racepager__btn[aria-label="Volgende race"]');
  if (prev) prev.addEventListener("click", () => { if (state.raceIdx > 0) { state.raceIdx--; renderRace(); } });
  if (next) next.addEventListener("click", () => { if (state.raceIdx < (state.races?.races?.length ?? 1) - 1) { state.raceIdx++; renderRace(); } });

  // Tap row → rider detail
  document.getElementById("standings-body").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-name]");
    if (!tr) return;
    openRider(tr.dataset.class, tr.dataset.name);
  });
  document.getElementById("race-body").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-name]");
    if (!tr) return;
    openRider(tr.dataset.class, tr.dataset.name);
  });
  document.getElementById("movers-body")?.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-name]");
    if (!li) return;
    openRider(li.dataset.class, li.dataset.name);
  });

  // Close rider detail
  document.querySelectorAll("[data-close-rider]").forEach((btn) => {
    btn.addEventListener("click", () => { state.rider = null; switchView("standings"); });
  });

  // Mobile "Jouw positie" chip
  document.getElementById("mepin-jump")?.addEventListener("click", () => {
    switchView("standings");
    const me = getMe();
    if (!me) return;
    state.cls = classFromMe(me); // jumps to the overall A/B tab, not Vrouwen
    renderClassToggle();
    renderStandings();
    const row = document.getElementById(`row-${state.cls}-${idSafe(nameFromMe(me))}`);
    if (row) requestAnimationFrame(() => row.scrollIntoView({ behavior: "smooth", block: "center" }));
  });

  // Overall ↔ Vrouwen toggle inside the rider modal
  document.getElementById("rider-view-toggle")?.addEventListener("click", (e) => {
    const opt = e.target.closest("[data-rider-view]");
    if (!opt) return;
    state.riderView = opt.dataset.riderView === "women" ? "women" : "overall";
    renderRider();
  });

  // Pin toggle
  document.getElementById("pin-toggle")?.addEventListener("click", () => {
    if (!state.rider) return;
    const me = getMe();
    const isPinned = classFromMe(me) === state.rider.cls && nameFromMe(me) === state.rider.name;
    if (isPinned) clearMe();
    else setMe(state.rider.cls, state.rider.name);
    renderAll();
  });
});
