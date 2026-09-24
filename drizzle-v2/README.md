# Drizzle V2

This directory is the only active migration lineage for the empty V2 database.

`../drizzle/` is V1 historical evidence only. It must never be selected by the active Drizzle configuration or executed against the V2 database.

Before applying this lineage, configure a dedicated empty V2 database with
`V2_DATABASE_URL` and `V2_APP_DATABASE`. The Drizzle configuration rewrites the
database path from `V2_APP_DATABASE`; it has no fallback to V1 settings. Apply
with `pnpm db:migrate`, then bootstrap the first account explicitly with
`pnpm bootstrap:v2` and the `V2_SUPER_ADMIN_*` deployment secrets.
