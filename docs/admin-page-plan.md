# Admin Page Plan

Goal: move moderation out of the solver sidebar into a dedicated admin page with
enough horizontal space to review, filter, edit, and clean up database entries.

Status: initial `/admin` page implemented in `0.4.0` with a full-width shell,
client-side table filters, sorting, and the existing JSON editor in a larger
detail panel. Server-side pagination and structured non-JSON editing remain
future improvements.

## Route

- Add a dedicated `/admin` client route.
- Keep admin API endpoints under `/api/admin/*`.
- Keep `/admin` protected by the existing password/session flow.
- Remove the admin entry point from the public solver UI; admins can open the URL
  directly.

## Layout

- Use a full-width admin shell instead of the current sidebar.
- Top bar:
  - App name and version
  - Environment indicator
  - Refresh button
  - Logout button
- Main area:
  - Left column: lock table
  - Right column: selected lock detail/editor
  - Optional lower drawer/tab for reports and raw JSON

## Lock Table

Columns:

- Name
- Review status
- Gate count
- Start pins
- Set links count
- Top name score
- Created
- Updated
- Source/reports count, once available

Table controls:

- Search by name, fingerprint, or pins
- Filter by review status
- Filter by 0 links / has links
- Filter hidden-by-votes entries
- Sort by created, updated, score, links count, or status
- Pagination or cursor-based loading instead of loading every row indefinitely

## Detail Panel

Show structured fields first, JSON second:

- Display name and all proposed names
- Review status controls
- Approve/reject buttons
- Delete button
- Gate count and pins
- Links count and link matrix preview
- Solution moves summary
- Created/updated timestamps
- Reports/conflicts list

Editing should move away from raw JSON for common actions:

- Status dropdown
- Name moderation buttons per proposed name
- Delete confirmation
- Raw JSON editor as an advanced section only

## API Changes

- Add list query parameters to `GET /api/admin/locks`:
  - `status`
  - `q`
  - `hasLinks`
  - `hidden`
  - `sort`
  - `cursor` or `page`
- Include metadata per lock:
  - `createdAt`
  - `updatedAt`
  - `setLinksCount`
  - optional `reportCount`
  - optional `conflictCount`
- Keep mutations status-specific where possible, instead of requiring full lock
  JSON updates.

## Migration Path

1. Introduce `/admin` route that mounts the existing admin panel full-width.
2. Replace the list with a table and keep the existing JSON editor.
3. Add server-side filters/sorting/pagination.
4. Add structured detail controls for approve/delete/name moderation.
5. Move raw JSON editing into an advanced section.
6. Remove the old `?admin=1` sidebar path once `/admin` covers all workflows.

## Acceptance Criteria

- Public solver UI has no visible admin link.
- `/admin` gives more room than the sidebar and works on desktop and mobile.
- Admin can review pending entries without opening raw JSON.
- Admin can quickly spot locks with 0 links, low scores, conflicts, and recent
  submissions.
- The page remains private behind the existing admin session and CSRF behavior.
