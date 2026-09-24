# Drizzle V2

This directory is the only active migration lineage for the empty V2 database.

`../drizzle/` is V1 historical evidence only. It must never be selected by the active Drizzle configuration or executed against the V2 database.

Before applying this lineage, configure a dedicated empty V2 database with
`V2_DATABASE_URL` and `V2_APP_DATABASE`. The Drizzle configuration rewrites the
database path from `V2_APP_DATABASE`; it has no fallback to V1 settings. Apply
the explicit provision step once with `pnpm provision:v2:database`, then apply
with `pnpm db:migrate`. The provision step only creates the named empty V2
database and never runs from application startup. Bootstrap the first account explicitly with
`pnpm bootstrap:v2` and the `V2_SUPER_ADMIN_*` deployment secrets.

If the first V2 Super Admin loses access, use the explicit, CLI-only recovery
flow rather than creating a second privileged account. It requires all three
temporary deployment variables below and must be invoked manually with
`pnpm recover:v2:admin`:

- `V2_ADMIN_RECOVERY_CONFIRM=PLAYCELL_V2_ADMIN_RECOVERY`
- `V2_ADMIN_RECOVERY_EMAIL` (the desired login e-mail)
- `V2_ADMIN_RECOVERY_PASSWORD` (a new password with at least 12 characters)

The recovery updates the existing Super Admin in place, writes a redacted audit
event, and never runs from HTTP startup. Remove the three temporary variables
immediately after a successful recovery.
