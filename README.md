# CoachOS

CoachOS is a mobile-first SaaS platform for online fitness coaches and their clients. It
replaces the fragmented stack — WhatsApp, Google Meet, spreadsheets, Google Drive — that
online coaches currently use, so a coach can see, in one place, whether a client trained,
what they ate, how their form looked, and how they feel.

This repository is a **pnpm + Turborepo monorepo**: one Expo app for both coaches and
clients, one Hono + tRPC API, and a Next.js marketing/dashboard site.

## Where the real documentation lives

Read these before writing any code — this README is not the specification.

| Document | Owns |
|---|---|
| `CLAUDE.md` | What this repository *is* and *why* — product, stack, money, and the decisions nothing else should own |
| `DATABASE.md` | Every table, key, bucket path, and retention rule |
| `.claude/skills/` | Conventions and procedures — load the relevant skill before coding |
| `.claude/plan/` | The build order, phase by phase, task by task — find the lowest-numbered task whose dependencies are done |

## Getting started

```bash
pnpm install
pnpm dev            # api + mobile together
pnpm dev:mobile      # expo start --dev-client
pnpm dev:api
```

See `CLAUDE.md` §24 for the full command list, and the `configuration` skill for local
environment setup.

## Before you contribute

- Run `pnpm check` before opening a PR — it must exit 0.
- No `any` in committed TypeScript.
- Feature branches + PR only; never commit directly to `main`.

See the `git-workflow` and `code-conventions` skills for the full rules.
