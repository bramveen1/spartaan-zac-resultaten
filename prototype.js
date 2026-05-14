/* ----------------------------------------------------------------------------
   De Spartaan — site.js (formerly prototype.js)

   Loads the computed standings + races from data/*.json, renders the three
   views (Klassement, Race-avond, Renner-detail), and handles tap-to-pin.

   Pure vanilla JS, no framework, no bundler. Same render shape as the design
   prototype — the SAMPLE_* constants have been replaced with fetched data.
   ---------------------------------------------------------------------------- */

const STORAGE_KEY = "despartaan.me";       // "<class>:<startNumber>", e.g. "A:47"

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

function classFromMe(me) {
  if (!me) return null;
  const [cls] = me.split(":");
  return cls;
}
function nrFromMe(me) {
  if (!me) return null;
  const [, nr] = me.split(":");
  return nr;
}

function getMe() {
  try { return localStorage.getItem(STORAGE_KEY) || null; }
  catch (_) { return null; }
}
function setMe(cls, nr) {
  try { localStorage.setItem(STORAGE_KEY, `${cls}:${nr}`); } catch (_) {}
}
function clearMe() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
}

/* ---------- STATE ---------- */

const state = {
  standings: null,   // data/standings.json
  races: null,       // data/races.json
  cls: "A",          // currently selected class on the standings + race views
  raceIdx: 0,        // currently selected race index (0-based)
  rider: null,       // { cls, nr } when rider detail is open
};

/* ---------- DATA LOAD ---------- */

async function loadData() {
  const [standings, races] = await Promise.all([
    fetch("data/standings.json", { cache: "no-store" }).then((r) => r.json()),
    fetch("data/races.json", { cache: "no-store" }).then((r) => r.json()),
  ]);
  state.standings = standings;
  state.races = races;
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
    riderTab.textContent = me ? `Renner #${nrFromMe(me)}` : "Renner";
  }
}

function renderClassToggle() {
  document.querySelectorAll(".classtoggle__opt").forEach((opt) => {
    const active = opt.dataset.class === state.cls;
    opt.classList.toggle("is-active", active);
    opt.setAttribute("aria-selected", String(active));
  });
}

function renderStandings() {
  const body = document.getElementById("standings-body");
  if (!body || !state.standings) return;
  const rows = state.standings.classes[state.cls] ?? [];
  const me = getMe();
  const meCls = classFromMe(me);
  const meNr = nrFromMe(me);

  body.innerHTML = rows.map((row) => {
    const isMe = meCls === state.cls && String(row.nr) === meNr;
    const deltaCls = row.lastPts >= 21 ? "delta--up" : row.lastPts >= 10 ? "delta--flat" : "delta--down";
    const deltaPrefix = row.lastPts > 0 ? "+" : "";
    const posLabel = row.joint ? `${row.pos}<sup>jt</sup>` : row.pos;
    return `
      <tr class="${isMe ? "is-me" : ""}" data-nr="${row.nr}" data-class="${state.cls}" id="row-${state.cls}-${row.nr}">
        <td class="num pos">${posLabel}</td>
        <td class="num nr">#${row.nr}</td>
        <td>${row.name}</td>
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
  const meCls = classFromMe(me);
  const meNr = nrFromMe(me);
  if (!me) { el.classList.add("is-hidden"); return; }
  const row = (state.standings.classes[meCls] ?? []).find((r) => String(r.nr) === meNr);
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

  // Eyebrow + title meta
  const eyebrow = document.querySelector("#race .eyebrow");
  if (eyebrow) {
    eyebrow.textContent = `Race ${race.n} · ${nlDayFull(race.date)} ${nlDate(race.date)} · Klasse ${state.cls}`;
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

  // Card meta (laps / winner time / finishers)
  const cls = race.classes[state.cls] ?? { results: [], stats: {} };
  const meta = document.querySelector("#race .card .card__meta");
  if (meta) {
    const s = cls.stats;
    meta.textContent = `${s.laps ?? 0} ronden · ${s.winnerTime ?? "—"} winnaar · ${s.finishers ?? 0} finishers`;
  }

  // Results table
  const body = document.getElementById("race-body");
  const me = getMe();
  const meCls = classFromMe(me);
  const meNr = nrFromMe(me);
  body.innerHTML = (cls.results ?? []).map((r) => {
    const isMe = meCls === state.cls && String(r.nr) === meNr;
    const timeDisplay = /\d+\s+laps?/.test(r.diff) ? `+${r.diff.replace(/\s+laps?/, (m) => m.includes("laps") ? " ronden" : " ronde")}` : r.time;
    return `
      <tr class="${isMe ? "is-me" : ""}" data-nr="${r.nr}" data-class="${state.cls}">
        <td class="num pos">${r.pos}</td>
        <td class="num nr">#${r.nr}</td>
        <td>${r.name}</td>
        <td class="num">${r.laps}</td>
        <td class="num">${timeDisplay}</td>
        <td class="num pts">${r.pts}</td>
      </tr>
    `;
  }).join("");

  // Movers
  const moversEl = document.getElementById("movers-body");
  if (moversEl) {
    const movers = (race.movers && race.movers[state.cls]) ?? [];
    if (!movers.length) {
      moversEl.innerHTML = `<li class="mover mover--empty">Geen verschuivingen om te tonen.</li>`;
    } else {
      moversEl.innerHTML = movers.map((m) => {
        const dir = m.shift > 0 ? "up" : "down";
        const arrow = m.shift > 0 ? "↑" : "↓";
        const isMe = meCls === state.cls && String(m.nr) === meNr;
        return `
          <li class="mover ${isMe ? "is-me" : ""}" data-nr="${m.nr}" data-class="${state.cls}">
            <span class="mover__arrow mover__arrow--${dir}">${arrow}</span>
            <div class="mover__id">
              <div class="mover__name">${m.name}</div>
              <div class="mover__nrm">#${m.nr} · ${m.from}<sup>e</sup> → ${m.to}<sup>e</sup></div>
            </div>
            <div class="mover__shift">${m.shift > 0 ? "+" : ""}${m.shift} <small>plekken</small></div>
          </li>
        `;
      }).join("");
    }
  }

  // Next race card (last race → hide; else infer date +7 days)
  const nextDate = state.races.races[state.raceIdx + 1]?.date;
  if (nextDate) {
    const n = state.races.races[state.raceIdx + 1];
    const day = document.querySelector(".next__day");
    const num = document.querySelector(".next__num");
    const mon = document.querySelector(".next__mon");
    const nm = document.querySelector(".next__name");
    if (day) day.textContent = nlDayShort(nextDate).replace(/^./, (c) => c.toUpperCase());
    if (num) num.textContent = String(new Date(nextDate + "T12:00:00Z").getUTCDate());
    if (mon) mon.textContent = MAANDEN[new Date(nextDate + "T12:00:00Z").getUTCMonth()];
    if (nm) nm.textContent = `Race ${n.n} — Zomeravondcompetitie`;
  }
}

function renderRider() {
  if (!state.rider || !state.races || !state.standings) return;
  const { cls, nr } = state.rider;
  const standing = (state.standings.classes[cls] ?? []).find((r) => String(r.nr) === String(nr));

  // Title block
  const numEl = document.querySelector(".ridercard__num");
  const nameEl = document.querySelector(".ridercard__name");
  const posEl = document.querySelector(".ridercard__pos");
  if (numEl) numEl.textContent = `#${nr}`;
  if (nameEl) nameEl.textContent = standing?.name ?? "Onbekend";
  if (posEl) posEl.innerHTML = standing
    ? `${ordNL(standing.pos)} in Klasse ${cls} · ${standing.pts} pnt`
    : `Geen klassement in Klasse ${cls}`;

  // History rows
  const races = state.races.races;
  const history = races.map((race) => {
    const result = (race.classes[cls]?.results ?? []).find((r) => String(r.nr) === String(nr));
    return { race, result };
  });

  const body = document.getElementById("rider-body");
  body.innerHTML = history.map(({ race, result }) => {
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
    const timeDisplay = /\d+\s+laps?/.test(result.diff)
      ? `+${result.diff.replace(/\s+laps?/, (m) => m.includes("laps") ? " ronden" : " ronde")}`
      : result.time;
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

  // Stats
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
        <span class="stat__meta">Klasse ${cls}</span>
      </div>
    `;
  }

  // Pin button reflects current state
  const btn = document.getElementById("pin-toggle");
  if (btn) {
    const me = getMe();
    const isPinned = classFromMe(me) === cls && nrFromMe(me) === String(nr);
    btn.classList.toggle("is-pinned", isPinned);
    btn.querySelector(".btn__label").textContent = isPinned ? "Vastgepind als mij" : "Vastpinnen als mij";
  }
}

function renderAll() {
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

function openRider(cls, nr) {
  state.rider = { cls, nr: String(nr) };
  renderRider();
  switchView("rider");
}

/* ---------- BOOT ---------- */

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadData();
  } catch (e) {
    console.error("Failed to load data:", e);
    const body = document.getElementById("standings-body");
    if (body) body.innerHTML = `<tr><td colspan="7" style="padding:24px;text-align:center">Kon de standen niet laden. Probeer later opnieuw.</td></tr>`;
    return;
  }
  renderAll();

  // Tab nav
  document.querySelectorAll(".viewnav__tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const view = tab.dataset.view;
      if (view === "rider") {
        const me = getMe();
        if (me) openRider(classFromMe(me), nrFromMe(me));
        else {
          // Default to the leader of the current class so the view is reachable.
          const leader = state.standings?.classes[state.cls]?.[0];
          if (leader) openRider(state.cls, leader.nr);
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
    const tr = e.target.closest("tr[data-nr]");
    if (!tr) return;
    openRider(tr.dataset.class, tr.dataset.nr);
  });
  document.getElementById("race-body").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-nr]");
    if (!tr) return;
    openRider(tr.dataset.class, tr.dataset.nr);
  });
  document.getElementById("movers-body")?.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-nr]");
    if (!li) return;
    openRider(li.dataset.class, li.dataset.nr);
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
    state.cls = classFromMe(me);
    renderClassToggle();
    renderStandings();
    const row = document.getElementById(`row-${state.cls}-${nrFromMe(me)}`);
    if (row) requestAnimationFrame(() => row.scrollIntoView({ behavior: "smooth", block: "center" }));
  });

  // Pin toggle
  document.getElementById("pin-toggle")?.addEventListener("click", () => {
    if (!state.rider) return;
    const me = getMe();
    const isPinned = classFromMe(me) === state.rider.cls && nrFromMe(me) === state.rider.nr;
    if (isPinned) clearMe();
    else setMe(state.rider.cls, state.rider.nr);
    renderAll();
  });
});
