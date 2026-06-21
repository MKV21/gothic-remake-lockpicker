# Gothic Lockpick Database

Live fork version on Vercel:
[gothic-lockpick-database.vercel.app](https://gothic-lockpick-database.vercel.app/)

Original author's GitHub Pages version:
[xetoxyc.github.io/gothic-remake-lockpicker](https://xetoxyc.github.io/gothic-remake-lockpicker/)

Upstream repository:
[Xetoxyc/gothic-remake-lockpicker](https://github.com/Xetoxyc/gothic-remake-lockpicker)

This fork repository:
[MKV21/gothic-remake-lockpicker](https://github.com/MKV21/gothic-remake-lockpicker)

A Gothic 1 Remake lockpicker based on Xetoxyc's solver, extended with a shared
Chest/Lock database, anonymous submissions, matching, moderation, name voting,
and keyboard/controller output profiles.

## Fork Changes Compared To Upstream

This is the running change list for this fork. Add new user-visible fork
changes here as they land.

- `0.3.2`
  - Updated the in-app fork attribution link to the public fork repository.
- `0.3.1`
  - Removed browser-local chest draft saving from the UI to avoid confusion with
    shared database entries.
  - Reset now clears the current chest name, so a fresh lock cannot accidentally
    reuse the previous name.
  - Removed the obsolete Vite local/file chest storage backend and
    `VITE_STORAGE_BACKEND` setting.
  - Updated fork documentation with live deployment, upstream attribution, and
    this fork change list.
- `0.3.0`
  - Added Vercel API routes backed by Postgres.
  - Added shared lock submission and duplicate/report handling.
  - Added progressive database matching by gate count and start pins.
  - Added hidden chest names with explicit reveal controls to reduce spoilers.
  - Added name suggestions, one-vote-per-visitor voting, and public hiding for
    heavily downvoted chests.
  - Added admin UI for viewing, editing, hiding, and deleting database locks.
  - Added German/English UI with automatic language detection and manual picker.
  - Added output profiles for Moves, Keyboard, Xbox, PS5, and Switch.
  - Added visible app version and public attribution links.
  - Added seed import tooling for bundled Xetoxyc chest data and optional
    religiosa1 lock data.

## Attribution And License

This project is a public fork of
[Xetoxyc/gothic-remake-lockpicker](https://github.com/Xetoxyc/gothic-remake-lockpicker).
Keep attribution to Xetoxyc in public deployments and project docs.

At the time this fork was created, the upstream repository did not include an
explicit license. Treat redistribution and relicensing cautiously until that is
resolved.

Generic solver improvements should be considered for contribution upstream.
Database, moderation, deployment, and fork-specific product work belongs in this
fork.

## Competitive Notes

- [gothic-remake-lockbreaker.com](https://gothic-remake-lockbreaker.com/) and
  [gothiclockbreaker.com](https://gothiclockbreaker.com/) are strong browser
  solvers with local/share-link flows, but no shared lock database.
- [religiosa1/gothic-lockpick-emulator](https://github.com/religiosa1/gothic-lockpick-emulator)
  has local save/export/import and a small static `locks/` dataset.
- [marvin098/GothicRemakeChestResolver](https://github.com/marvin098/GothicRemakeChestResolver)
  supports Base64 URL sharing, but no server-backed database.

The differentiator here is the shared, searchable, curated database: submissions,
matching, duplicate handling, source attribution, and name quality workflows.

## Features

- 4-7 gate lock setup and shortest-path solver.
- Submit complete locks to a shared Postgres database.
- Automatically submit solved locks, even without a chest name.
- Match database locks after gate count and start pins are entered.
- Load a database match back into the solver.
- Hide chest names until the user explicitly reveals them.
- Suggest better lock names and vote on names.
- Output solution as Moves, Keyboard, Xbox, PS5, or Switch input chain.
- Seed import for upstream `data/chests` and optional religiosa1 `locks/`.

## Deployment

Use Vercel for this fork. GitHub Pages is not enough for the planned product
because it cannot host the serverless API routes or Postgres-backed database
behavior.

Vercel setup:

1. Import the repository in Vercel.
2. Add a Postgres provider from the Vercel Marketplace, preferably Neon.
3. Set environment variables:
   - `DATABASE_URL`
   - `VISITOR_HASH_SALT`
   - `ADMIN_TOKEN`
4. Run `npm run db:migrate`.
5. Run `npm run seed:import`.
6. Deploy with `npm run build`.

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

Open <http://localhost:5173>.

Without `DATABASE_URL`, the solver still works. Database submit, matching,
votes, and admin APIs return a setup error until Postgres is configured.

## Database

Apply migrations:

```bash
npm run db:migrate
```

Import bundled Xetoxyc seed chests:

```bash
npm run seed:import
```

Also fetch and import religiosa1 locks:

```bash
npm run seed:import -- --fetch-religiosa1
```

Seed imports store source project, source URL, import timestamp, and metadata in
`seed_sources`. Imported names are suggestions with review state, not permanent
truth.

## API

- `GET /api/locks/match?gateCount=6&pins=1,2,3`
- `GET /api/locks/:id`
- `POST /api/locks`
- `POST /api/locks/:id/names`
- `POST /api/names/:nameId/vote`
- `POST /api/admin/session`
- `GET /api/admin/locks`
- `POST /api/admin/locks`
- `POST /api/admin/names`
- `GET /api/admin/reports`

Admin endpoints use the admin session cookie from `/api/admin/session` and
require the matching CSRF header for write requests.

## Test And Release Checks

```bash
npm test
npm run check:server
npm run build
```

Before release, also smoke-test a Vercel preview with a real `DATABASE_URL`.

## Project Layout

```text
api/                   Vercel API functions
db/migrations/         Postgres schema
tools/                 Migration and seed import tooling
src/
  game/                Browser UI, solver, database matching
  shared/              Shared lock schema, validation, fingerprints
data/chests/           Upstream seed chest JSON
```
