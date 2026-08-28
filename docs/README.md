# docs/

Supporting documentation that isn't one of the root-level `*.md` files
(`CLAUDE.md`, `DATABASE.md`, `ARCHITECTURE.md`, etc. — see repo root).

- `PILOT-PLAYBOOK.md` — the ship-gate-1 pilot playbook (CLAUDE.md §23).
- `runbooks/`, `screens/` — see their own contents.
- `UNFORGET.md` (gitignored, see registry below) — the deferred-work ledger.

<!-- unforget-registry:begin -->

### unforget registry

> Machine-maintained. Do not hand-edit between the markers except to
> correct a value; the skill rewrites this block on init/import/branch.

**Global**

| key                     | value            |
| ----------------------- | ---------------- |
| git_posture             | split            |
| recall_block            | maintained       |
| recall_file             | CLAUDE.md        |
| recall_home             | docs/UNFORGET.md |
| policy_deferral         | aggressive       |
| policy_multiaxis        | lifespan-wins    |
| ratio_flag_threshold    | 3                |
| stale_trivial_sessions  | 2                |
| row_char_budget         | (unset)          |
| display_view            | (unset)          |
| display_group_by        | (unset)          |
| display_verbosity       | (unset)          |
| display_sections        | (unset)          |
| display_prefs_set       | (unset)          |
| archive_nudge_threshold | (unset)          |
| stale_days_this         | (unset)          |
| stale_days_next         | (unset)          |
| stale_days_later        | (unset)          |
| stale_days_someday      | (unset)          |

**Ledgers**

| name        | path        | role | axis | discipline     | parent | death |
| ----------- | ----------- | ---- | ---- | -------------- | ------ | ----- |
| UNFORGET.md | UNFORGET.md | main | —    | standard-10col | —      | —     |

<!-- unforget-registry:end -->
