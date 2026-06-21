# Seed Sources

This project imports known locks as reviewed seed data, but keeps source metadata
so community submissions can still correct names and conflicts later.

- `Xetoxyc/gothic-remake-lockpicker`: local `data/chests/*.json` copied with upstream attribution.
- `religiosa1/gothic-lockpick-emulator`: optional remote import from its `locks/` directory via `npm run seed:import -- --fetch-religiosa1`.

Guide-specific locks should be added only with a source URL and review status.
