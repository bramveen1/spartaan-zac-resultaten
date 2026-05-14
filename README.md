# spartaan-zac-resultaten

Uitslagen en standen van de Spartaan zomeravondcompetitie.

## What's in this repo right now

This is the **first commit of the production codebase**, currently containing the design prototype (`index.html` + `styles.css` + `prototype.js`).

- It is a single-page, three-view static site: **Klassement** (standings landing), **Race-avond** (race-night results), **Renner-detail** (rider detail).
- It is responsive — desktop ≥ 720px, mobile-first below — and the same DOM serves both surfaces.
- Sample data is hardcoded in `prototype.js` so the screens are reviewable. The real Sporthive CSV ingestion and points/standings computation are out of scope for the prototype.

This file is the visual source of truth: the colours, type, layout, spacing, and components defined here are the design system for the project. Tokens live at the top of `styles.css`.

## How to preview

**Local:** open `index.html` directly in a browser — no build, no server required.

**Hosted preview:** once GitHub Pages is enabled on `main`, the site will be served at:
`https://bramveen1.github.io/spartaan-zac-resultaten/`

## Tap-to-pin

Tapping the **Vastpinnen** button on the rider detail screen stores the rider's start number in `localStorage` under the key `despartaan.me`. Pinned rider is highlighted with a red rail across all three views. Default in the prototype is rider `#47`.

## Out of scope for the prototype

Documented here so they aren't accidentally added during review:
- Admin UI, login, accounts
- Past-season archive
- Push notifications
- Cross-class combined standing
- Live Sporthive ingestion (deliberately mocked)

These are deferred by the PRD; raise with Dave before reopening.

## Roles

- **Lin** — design (this prototype, design tokens, component patterns)
- **Sam** — build (replace sample data with real Sporthive ingestion, deploy)
- **Dave** — PRD, scope, prioritisation
