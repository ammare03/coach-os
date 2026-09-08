# apps/mobile/src/db

The device-side SQLite mirror (`DATABASE.md` DB§13), built with `expo-sqlite` +
`drizzle-orm/expo-sqlite`. **This is not `packages/db`, and the two must never be
confused for each other** despite both using Drizzle as the query builder:

|                           | `apps/mobile/src/db`                                                             | `packages/db`                            |
| ------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------- |
| Engine                    | SQLite (on-device)                                                               | PostgreSQL (server)                      |
| Shape                     | Denormalised — `payload_json` blobs for fast rendering                           | Normalised, relational                   |
| Ids                       | `text`, a server uuid or a local-only uuidv7 before sync                         | `uuid`                                   |
| Authorization             | Never decides one — the API already did (`CLAUDE.md` §6.2)                       | `ownsResource`'s source of truth (DB§6)  |
| Soft delete / audit trail | None                                                                             | Yes                                      |
| Lifetime                  | Wiped whole on logout; dropped and re-fetched on schema mismatch, never migrated | Durable; migrated forward, never dropped |

Importing a `packages/db` schema type into this folder, or a device-shaped type the
other way, is a bug — see
`.claude/plan/phase-08-offline-core/local-database/01-sqlite-drizzle-setup.md`'s Risks
section, which is what this file exists to close off.
