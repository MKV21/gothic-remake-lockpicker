# Database Backups

Production data lives in Postgres through Vercel/Neon. Use two layers:

1. Neon instant restore / PITR for fast recovery from recent mistakes.
2. Daily `pg_dump` export into a private S3-compatible bucket for independent backups.

Do not store database dumps as public GitHub Actions artifacts. The database contains
visitor and IP hashes, so backup files belong in private storage.

## Daily Backup Workflow

The workflow in `.github/workflows/database-backup.yml` runs daily at 03:17 UTC
and can also be started manually from GitHub Actions.

Configure these GitHub repository secrets:

- `DATABASE_URL`: production Postgres connection string
- `BACKUP_S3_BUCKET`: private bucket name
- `BACKUP_S3_ACCESS_KEY_ID`: bucket access key
- `BACKUP_S3_SECRET_ACCESS_KEY`: bucket secret key
- `BACKUP_S3_ENDPOINT_URL`: optional S3-compatible endpoint, for example Cloudflare R2

Configure these GitHub repository variables:

- `BACKUP_S3_PREFIX`: optional path prefix, default `gothic-lockpick-database`
- `BACKUP_S3_REGION`: optional region, default `eu-central-1`

If the required secrets are missing, the workflow exits without creating a backup.

## Restore Check

Download a dump from the bucket and restore it into a disposable database:

```bash
gunzip gothic-lockpick-database-YYYYMMDDTHHMMSSZ.dump.gz
pg_restore --clean --if-exists --no-owner --no-acl --dbname "$RESTORE_DATABASE_URL" gothic-lockpick-database-YYYYMMDDTHHMMSSZ.dump
```

Run a restore check after the first backup and then periodically.

## Retention

Set a lifecycle rule on the bucket instead of deleting backups from CI. A pragmatic
starting point is 30 daily backups. Increase retention if the database becomes more
important than the current fan-tool use case.
