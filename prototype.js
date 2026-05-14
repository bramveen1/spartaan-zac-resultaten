/* ----------------------------------------------------------------------------
   De Spartaan — prototype.js
   Hardcoded sample data + view switching + tap-to-pin behaviour.

   PROTOTYPE SCOPE
   ---------------
   This file exists to make the screens reviewable. It does NOT represent the
   shipping data layer. When Sam wires up Sporthive CSV ingestion, the render
   functions below stay (they render from a normalised model); the SAMPLE_*
   constants get replaced with computed data from the parsed CSVs.
   ---------------------------------------------------------------------------- */

const STORAGE_KEY = "despartaan.me";       // start-number string, e.g. "47"
const DEFAULT_ME = "47";                   // matches the Figma "this is me" example

/* ---------- SAMPLE DATA ---------- */

const STANDINGS_A = [
  { pos: 1,  nr: 12, name: "Joris de Bruin",     pts: 178, lastPts: 18, gap: 0 },
  { pos: 2,  nr: 7,  name: "Mark Visser",        pts: 169, lastPts: 20, gap: 9 },
  { pos: 3,  nr: 23, name: "Pieter van Dijk",    pts: 161, lastPts: 18, gap: 17 },
  { pos: 4,  nr: 47, name: "Bram Veenhof",       pts: 154, lastPts: 22, gap: 24 },
  { pos: 5,  nr: 9,  name: "Sander Bakker",      pts: 148, lastPts: 16, gap: 30 },
  { pos: 6,  nr: 31, name: "Thijs Mulder",       pts: 141, lastPts: 15, gap: 37 },
  { pos: 7,  nr: 18, name: "Erik de Vries",      pts: 133, lastPts: 14, gap: 45 },
  { pos: 8,  nr: 4,  name: "Lars Jansen",        pts: 127, lastPts: 13, gap: 51 },
  { pos: 9,  nr: 56, name: "Daan Hendriks",      pts: 119, lastPts: 12, gap: 59 },
  { pos: 10, nr: 2,  name: "Ruben de Wit",       pts: 112, lastPts: 5,  gap: 66 },
  { pos: 11, nr: 15, name: "Niels Smit",         pts: 104, lastPts: 11, gap: 74 },
  { pos: 12, nr: 39, name: "Tom Peeters",        pts: 97,  lastPts: 10, gap: 81 },
];

const RACE8_A = [
  { pos: 1,  nr: 12, name: "Joris de Bruin",  laps: 18, time: "42:18",  pts: 25 },
  { pos: 2,  nr: 47, name: "Bram Veenhof",    laps: 18, time: "42:24",  pts: 22 },
  { pos: 3,  nr: 7,  name: "Mark Visser",     laps: 18, time: "42:31",  pts: 20 },
  { pos: 4,  nr: 23, name: "Pieter van Dijk", laps: 18, time: "42:47",  pts: 18 },
  { pos: 5,  nr: 9,  name: "Sander Bakker",   laps: 18, time: "43:02",  pts: 16 },
  { pos: 6,  nr: 31, name: "Thijs Mulder",    laps: 18, time: "43:15",  pts: 15 },
  { pos: 7,  nr: 18, name: "Erik de Vries",   laps: 17, time: "+1 ronde", pts: 14 },
  { pos: 8,  nr: 4,  name: "Lars Jansen",     laps: 17, time: "+1 ronde", pts: 13 },
  { pos: 9,  nr: 56, name: "Daan Hendriks",   laps: 17, time: "+1 ronde", pts: 12 },
  { pos: 10, nr: 15, name: "Niels Smit",      laps: 17, time: "+1 ronde", pts: 11 },
  { pos: 11, nr: 39, name: "Tom Peeters",     laps: 17, time: "+1 ronde", pts: 10 },
  { pos: 12, nr: 2,  name: "Ruben de Wit",    laps: 16, time: "+2 ronden", pts: 5 },
];

const MOVERS = [
  { nr: 47, name: "Bram Veenhof", from: 7, to: 4,  pts: 22 },
  { nr: 31, name: "Thijs Mulder", from: 9, to: 6,  pts: 15 },
  { nr: 2,  name: "Ruben de Wit", from: 6, to: 10, pts: 5  },
];

const HISTORY_47 = [
  { race: 8, date: "14 mei", pos: "2e",  laps: 18, time: "42:24",   pts: 22 },
  { race: 7, date: "07 mei", pos: "4e",  laps: 18, time: "42:51",   pts: 18 },
  { race: 6, date: "30 apr", pos: "3e",  laps: 18, time: "42:39",   pts: 20 },
  { race: 5, date: "23 apr", pos: "6e",  laps: 17, time: "+1 ronde", pts: 15 },
  { race: 4, date: "16 apr", pos: "5e",  laps: 18, time: "43:12",   pts: 16 },
  { race: 3, date: "09 apr", pos: "8e",  laps: 17, time: "+1 ronde", pts: 13 },
  { race: 2, date: "02 apr", pos: "—",   laps: 0,  time: "DNS",     pts: 0,  dns: true },
  { race: 1, date: "26 mrt", pos: "4e",  laps: 18, time: "43:00",   pts: 18 },
];

/* ---------- "ME" STATE ---------- */

function getMe() {
  try { return localStorage.getItem(STORAGE_KEY) || DEFAULT_ME; }
  catch (_) { return DEFAULT_ME; }
}
function setMe(nr) {
  try { localStorage.setItem(STORAGE_KEY, String(nr)); } catch (_) {}
}
function clearMe() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
}

/* ---------- RENDERERS ---------- */

function renderStandings() {
  const me = getMe();
  const body = document.getElementById("standings-body");
  if (!body) return;
  body.innerHTML = STANDINGS_A.map(row => {
    const isMe = String(row.nr) === me;
    const deltaCls = row.lastPts >= 18 ? "delta--up" : row.lastPts >= 10 ? "delta--flat" : "delta--down";
    const deltaPrefix = row.lastPts >= 18 ? "+" : "";
    return `
      <tr class="${isMe ? "is-me" : ""}" data-nr="${row.nr}" id="row-${row.nr}">
        <td class="num pos">${row.pos}</td>
        <td class="num nr">#${row.nr}</td>
        <td>${row.name}</td>
        <td class="num pts">${row.pts}</td>
        <td class="num desktop-only ${deltaCls}">${deltaPrefix}${row.lastPts}</td>
        <td class="num desktop-only">${row.gap === 0 ? "—" : row.gap}</td>
        <td class="pin">${isMe ? '<span class="pin-mark" aria-label="Vastgepind">★</span>' : ''}</td>
      </tr>
    `;
  }).join("");
}

/* Mobile "Jouw positie" chip — renders only when a rider is pinned.
   Tap → switches to standings view and scrolls to the user's row. */
function renderMePin() {
  const me = getMe();
  const el = document.getElementById("mepin");
  if (!el) return;
  const row = STANDINGS_A.find(r => String(r.nr) === me);
  if (!row) { el.classList.add("is-hidden"); return; }
  el.classList.remove("is-hidden");
  document.getElementById("mepin-pos").innerHTML = `${row.pos}<sup>e</sup>`;
  document.getElementById("mepin-nrm").textContent = `#${row.nr}`;
  document.getElementById("mepin-pts").textContent = `${row.pts} pnt`;
}

function renderRace() {
  const me = getMe();
  const body = document.getElementById("race-body");
  if (!body) return;
  body.innerHTML = RACE8_A.map(row => {
    const isMe = String(row.nr) === me;
    return `
      <tr class="${isMe ? "is-me" : ""}" data-nr="${row.nr}">
        <td class="num pos">${row.pos}</td>
        <td class="num nr">#${row.nr}</td>
        <td>${row.name}</td>
        <td class="num">${row.laps}</td>
        <td class="num">${row.time}</td>
        <td class="num pts">${row.pts}</td>
      </tr>
    `;
  }).join("");

  const moversEl = document.getElementById("movers-body");
  if (moversEl) {
    moversEl.innerHTML = MOVERS.map(m => {
      const shift = m.from - m.to;
      const dir = shift > 0 ? "up" : "down";
      const arrow = shift > 0 ? "↑" : "↓";
      const isMe = String(m.nr) === me;
      return `
        <li class="mover ${isMe ? "is-me" : ""}" data-nr="${m.nr}">
          <span class="mover__arrow mover__arrow--${dir}">${arrow}</span>
          <div class="mover__id">
            <div class="mover__name">${m.name}</div>
            <div class="mover__nrm">#${m.nr} · ${m.from}<sup>e</sup> → ${m.to}<sup>e</sup></div>
          </div>
          <div class="mover__shift">${shift > 0 ? "+" : ""}${shift} <small>plekken</small></div>
        </li>
      `;
    }).join("");
  }
}

function renderRider() {
  const body = document.getElementById("rider-body");
  if (!body) return;
  body.innerHTML = HISTORY_47.map(r => `
    <tr class="${r.dns ? "is-dns" : ""}">
      <td class="num">${r.race}</td>
      <td>${r.date}</td>
      <td class="num">${r.pos}</td>
      <td class="num">${r.laps || "—"}</td>
      <td class="num">${r.time}</td>
      <td class="num">${r.pts}</td>
    </tr>
  `).join("");

  // Pin button reflects current state
  const btn = document.getElementById("pin-toggle");
  if (btn) {
    const isPinned = getMe() === "47";
    btn.classList.toggle("is-pinned", isPinned);
    btn.querySelector(".btn__label").textContent = isPinned ? "Vastgepind als mij" : "Vastpinnen als mij";
  }
}

function renderAll() {
  renderStandings();
  renderRace();
  renderRider();
  renderMePin();
}

/* ---------- VIEW SWITCHING ---------- */

function switchView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("is-active", v.id === name));
  document.querySelectorAll(".viewnav__tab").forEach(t => t.classList.toggle("is-active", t.dataset.view === name));
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

/* ---------- EVENTS ---------- */

document.addEventListener("DOMContentLoaded", () => {
  renderAll();

  // Tab nav
  document.querySelectorAll(".viewnav__tab").forEach(tab => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });

  // Class toggle — stub for B (no data wired); flip the active state for the demo
  document.querySelectorAll(".classtoggle__opt").forEach(opt => {
    opt.addEventListener("click", () => {
      document.querySelectorAll(".classtoggle__opt").forEach(o => {
        o.classList.remove("is-active");
        o.setAttribute("aria-selected", "false");
      });
      opt.classList.add("is-active");
      opt.setAttribute("aria-selected", "true");
      // Klasse B data not in prototype scope; standings table reused as-is for demo.
    });
  });

  // Tap a row → open rider detail. In the prototype only #47 has full data wired,
  // so tapping any other row currently still routes to #47's detail screen so the
  // sheet is reviewable. In production every row will deep-link to that rider.
  document.getElementById("standings-body").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-nr]");
    if (!tr) return;
    switchView("rider");
  });
  document.getElementById("race-body").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-nr]");
    if (!tr) return;
    switchView("rider");
  });

  // Close rider detail → back to standings
  document.querySelectorAll("[data-close-rider]").forEach(btn => {
    btn.addEventListener("click", () => switchView("standings"));
  });

  // Mobile "Jouw positie" chip → jump to your row in standings
  const mepinJump = document.getElementById("mepin-jump");
  if (mepinJump) {
    mepinJump.addEventListener("click", () => {
      switchView("standings");
      const me = getMe();
      const row = document.getElementById(`row-${me}`);
      if (row) {
        // Wait a frame so the standings view is visible before scrolling
        requestAnimationFrame(() => {
          row.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    });
  }

  // Pin toggle
  const pinBtn = document.getElementById("pin-toggle");
  if (pinBtn) {
    pinBtn.addEventListener("click", () => {
      if (getMe() === "47") clearMe(); else setMe("47");
      renderAll();
    });
  }
});
