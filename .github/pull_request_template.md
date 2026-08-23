## What

<!-- Short description of the change. -->

## Why

<!-- The reason for the change — link the plan task (.claude/plan/...) or issue. -->

## How to test

<!-- Steps to verify locally. Include which device/platform if it's UI. -->

## Screenshots / recording

<!-- Required for any UI change. Delete this section if there is none. -->

## Checklist

CI (`check`) verifies `pnpm check` and `pnpm audit`; everything below needs a human.

- [ ] `pnpm check` passes locally
- [ ] Tested on a physical iOS **and** Android device (if UI) — device + OS version noted above
- [ ] Loading / empty / error / forbidden states handled (if UI)
- [ ] Offline behaviour verified (if the feature writes data — `offline-sync` skill)
- [ ] No new dependency without a `CLAUDE.md` §3 entry
- [ ] No new paid service without passing `CLAUDE.md` §3.4.1
- [ ] Analytics events added, declared in `ANALYTICS.md` first, with no PII
- [ ] Any new user-reachable failure has a row in `ERRORS.md`
- [ ] User-facing copy passes `COPY.md` §CO6
- [ ] `CLAUDE.md` / `DATABASE.md` updated in this PR if a decision changed
- [ ] No secrets committed; nothing new behind `EXPO_PUBLIC_`
- [ ] This PR adds an entry to `authz-allowlist.ts` — the reason is written and a second reviewer approved it. (if it doesn't, leave unchecked)
