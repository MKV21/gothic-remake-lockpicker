# Gothic Lockpick Database

A Gothic 1 Remake lockpicker based on
[Xetoxyc/gothic-remake-lockpicker](https://github.com/Xetoxyc/gothic-remake-lockpicker),
extended with a shared Chest/Lock database.

The original solver remains available locally: users can set gate count, start
pins, target pins, and links, then solve the lock and save private drafts in the
browser. This fork adds database submission, progressive matching, shared names,
name voting, and output profiles for keyboard and controllers.

## Attribution And License

This project copies the current upstream app as its base. Keep attribution to
Xetoxyc in public deployments and project docs.

At the time this copy was made, the upstream repository did not include an
explicit license. Treat redistribution and relicensing cautiously until that is
resolved.

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
- Private local drafts via browser `localStorage`.
- Submit complete locks to a shared Postgres database.
- Match database locks after gate count and start pins are entered.
- Load a database match back into the solver.
- Suggest better lock names and vote on names.
- Output solution as Moves, Keyboard, Xbox, PS5, or Switch input chain.
- Seed import for upstream `data/chests` and optional religiosa1 `locks/`.

## Deployment

Use Vercel from Milestone 1 onward. GitHub Pages is not enough for the planned
product because it cannot host the serverless API routes or Postgres-backed
database behavior.

Vercel setup:

1. Import the repository in Vercel.
2. Add a Postgres provider from the Vercel Marketplace, preferably Neon.
3. Set environment variables:
   - `DATABASE_URL`
   - `VISITOR_HASH_SALT`
   - `ADMIN_TOKEN`
   - `VITE_STORAGE_BACKEND=local`
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

Without `DATABASE_URL`, the solver and local drafts still work. Database submit,
matching, votes, and admin APIs return a setup error until Postgres is configured.

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
- `GET /api/admin/reports`
- `POST /api/admin/names`

Admin endpoints require `Authorization: Bearer <ADMIN_TOKEN>`.

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
  game/                Browser UI, solver, local storage
  shared/              Shared lock schema, validation, fingerprints
data/chests/           Upstream seed chest JSON
plugins/               Vite dev-only file storage plugin
```
