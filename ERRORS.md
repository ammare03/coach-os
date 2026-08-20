# ERRORS.md — CoachOS

> **The closed error catalogue.** One row per failure the user can reach, with its stable
> machine code, its transport code, the exact words the user sees, and what they can
> actually do about it.
>
> The `api-conventions` skill owns *how* to throw an error. This file owns *which errors
> exist* and *what they say*. A code that is not in this file must not be thrown; a code in
> this file with no copy is an unfinished feature.
>
> **The rule that makes this file worth maintaining:** a user should never see
> "Something went wrong." If they do, we failed to anticipate a state we could have named.

---

## ER§0. How errors work here

**Three layers, and they are not the same thing.**

| Layer | Audience | Example |
|---|---|---|
| **Transport code** | The HTTP/tRPC machinery | `BAD_REQUEST`, `FORBIDDEN`, `CONFLICT` |
| **Machine code** (`cause.code`) | The client's `switch` | `SEAT_LIMIT_REACHED` |
| **User copy** | A human, mid-workout, on a bad connection | "You've reached 20 clients on your plan." |

The client **switches on the machine code, never on the message**. Messages get edited and
translated; codes do not. The union in `packages/schemas/src/errors.ts` gives the client
exhaustiveness checking, so adding a code here forces every consumer to handle it.

### ER§0.1 Copy rules

`COPY.md` governs all product copy; these are the additional rules specific to errors.

1. **Say what happened, then what to do.** Two sentences maximum. The second one is a verb.
2. **Never blame the user.** "That invite has expired" — not "You used an invalid invite."
3. **Never expose internals.** No table names, no stack traces, no provider names, no
   HTTP status numbers. Log those; show none of them.
4. **Never diagnose or prescribe.** Error copy is product copy and inherits `CLAUDE.md`
   §21.3 in full — no error message may imply a health judgement.
5. **A recovery action is part of the error.** If there is no action, say so explicitly
   ("Nothing you need to do — we'll retry automatically") rather than leaving a dead end.
6. **Mid-workout errors are quieter than everything else.** A client in a gym with chalked
   hands gets an inline note, never a modal.

### ER§0.2 The three presentation modes

| Mode | When | Looks like |
|---|---|---|
| **Silent** | The system will recover on its own and the user has nothing to do | Nothing, or a small sync indicator |
| **Inline** | The user's next action depends on knowing this | A line under the field or on the row, with the action |
| **Blocking** | Continuing would lose data or money | A sheet with an explicit action. Rare — see the `Mode` column below |

Everything in `ER§1` that is not marked **Blocking** must never interrupt a workout.

---

## ER§1. The catalogue

### ER§1.1 Authorisation and identity

| Code | Transport | Mode | User copy | Action |
|---|---|---|---|---|
| `UNAUTHENTICATED` | UNAUTHORIZED | Blocking | "Your session has ended. Sign in to continue." | Sign in |
| `SESSION_REVOKED` | UNAUTHORIZED | Blocking | "You were signed out for security. Sign in again." | Sign in. Fired on refresh-token reuse detection (`ARCHITECTURE.md` A§8.1) |
| `NOT_YOUR_CLIENT` | **NOT_FOUND** | Inline | "We couldn't find that." | Back. **Deliberately indistinguishable from a genuine 404** — see ER§2.1 |
| `WRONG_ROLE` | FORBIDDEN | Inline | "That's not available on this account." | Back |
| `ASSISTANT_CANNOT_BILL` | FORBIDDEN | Inline | "Only the account owner can change the plan." | Contact owner |
| `ASSISTANT_CANNOT_DELEGATE` | FORBIDDEN | Inline | "Assistant coaches can't add their own assistants." | — |
| `ACCOUNT_PENDING_DELETION` | FORBIDDEN | Blocking | "This account is scheduled for deletion. Restore it to keep using CoachOS." | Restore |

### ER§1.2 Age and eligibility

| Code | Transport | Mode | User copy | Action |
|---|---|---|---|---|
| `COACH_MUST_BE_ADULT` | FORBIDDEN | Blocking | "Coach accounts are for adults only. You can still join as a client if a coach invites you." | Back to sign-up |
| `GUARDIAN_CONSENT_REQUIRED` | FORBIDDEN | Blocking | "We need a parent or guardian's consent before you can continue." | Start consent flow |
| `GUARDIAN_CONSENT_PENDING` | FORBIDDEN | Inline | "We're waiting on your guardian's confirmation. We'll email you when it's done." | Resend |
| `AGE_BELOW_MINIMUM` | FORBIDDEN | Blocking | "You need to be at least 13 to use CoachOS." | — |

### ER§1.3 Billing and entitlement

| Code | Transport | Mode | User copy | Action |
|---|---|---|---|---|
| `SEAT_LIMIT_REACHED` | BAD_REQUEST | Inline | "You're at {seatLimit} clients on your plan. Add 5 seats or move up a tier to invite more." | Add seats · Upgrade |
| `STORAGE_QUOTA_EXCEEDED` | BAD_REQUEST | Inline | "You're out of storage on your plan. Free some space or upgrade to keep uploading." | Manage storage · Upgrade |
| `LIVE_MINUTES_EXHAUSTED` | BAD_REQUEST | Inline | "You've used this month's live minutes. They reset on {renewalDate}." | Upgrade. **Never fires mid-session** (§15.8) |
| `AI_LIMIT_REACHED` | BAD_REQUEST | Inline | "You've used this month's AI generations. They reset on {renewalDate}." | Upgrade |
| `FEATURE_NOT_IN_TIER` | FORBIDDEN | Inline | "{Feature} is part of {tier}." | See plans |
| `PURCHASE_FAILED` | BAD_REQUEST | Blocking | "The purchase didn't go through. Nothing was charged." | Try again |
| `PURCHASE_ALREADY_OWNED` | CONFLICT | Inline | "You already have this plan. Restoring it now." | — (auto-restores) |
| `TRIAL_ALREADY_USED` | BAD_REQUEST | Inline | "You've already used your free trial." | See plans |
| `BILLING_GRACE_PERIOD` | — (not an error) | Inline banner | "There's a problem with your payment method. You have full access until {graceEnd}." | Update payment |

> `SEAT_LIMIT_REACHED` and `STORAGE_QUOTA_EXCEEDED` are the two most likely to be seen by a
> paying customer. They must read as a plan boundary, not a punishment, and both keep the
> coach's existing clients fully accessible (§15.5).

### ER§1.4 Sync, offline, and idempotency

| Code | Transport | Mode | User copy | Action |
|---|---|---|---|---|
| `SYNC_CONFLICT` | CONFLICT | Inline | "Your coach updated this while you were offline. Showing their version." | — |
| `SYNC_FAILED` | — (client-side) | Inline | "Couldn't sync {n} items. We'll keep trying." | Retry now |
| `SYNC_PERMANENTLY_FAILED` | — (client-side) | Inline | "{n} items couldn't be saved. Tap to see what's stuck." | Review |
| `SESSION_CLAIMED_ELSEWHERE` | CONFLICT | Blocking | "You're logging this session on another device. Continue here instead?" | Continue here · Cancel |
| `STALE_CLIENT_VERSION` | BAD_REQUEST | Blocking | "Update CoachOS to keep going." | Update |

> **A replayed offline mutation is not an error.** `ON CONFLICT DO UPDATE` returns the
> existing row with a success response. `SYNC_CONFLICT` is reserved for genuine divergence.
> Confusing the two makes the outbox retry forever (`api-conventions` skill).

### ER§1.5 Training and programs

| Code | Transport | Mode | User copy | Action |
|---|---|---|---|---|
| `SESSION_ALREADY_COMPLETED` | CONFLICT | Inline | "This session is already finished." | View summary |
| `PROGRAM_CHANGED_MID_SESSION` | — (not an error) | Inline | "Your coach updated this workout. The changes start from your next session." | — |
| `EXERCISE_UNAVAILABLE` | CONFLICT | Inline | "Your coach removed this exercise. Your logged sets are safe." | Skip · Swap |
| `ASSIGNMENT_ENDED` | CONFLICT | Inline | "This program has finished." | View programs |
| `NO_ACTIVE_PROGRAM` | NOT_FOUND | Inline (empty state) | "No program assigned yet." | Message coach |

### ER§1.6 Media

| Code | Transport | Mode | User copy | Action |
|---|---|---|---|---|
| `MEDIA_STILL_PROCESSING` | CONFLICT | Inline | "Still processing — this usually takes under a minute." | — (polls) |
| `MEDIA_PROCESSING_FAILED` | — | Inline | "We couldn't process that video. Try uploading it again." | Retry · Delete |
| `UPLOAD_TOO_LARGE` | PAYLOAD_TOO_LARGE | Inline | "That file is too large. Videos can be up to {maxMinutes} minutes." | — |
| `UPLOAD_UNSUPPORTED_TYPE` | BAD_REQUEST | Inline | "That file type isn't supported." | — |
| `UPLOAD_INTERRUPTED` | — (client-side) | Silent | — | Resumes automatically (`ARCHITECTURE-ESSENTIALS.md` E§15) |
| `MEDIA_EXPIRED` | NOT_FOUND | Inline | "This video is past your plan's {retentionDays}-day storage window." | See plans |

### ER§1.7 Nutrition

| Code | Transport | Mode | User copy | Action |
|---|---|---|---|---|
| `FOOD_NOT_FOUND` | NOT_FOUND | Inline | "We don't have that barcode yet. Add it manually and we'll remember it." | Add manually |
| `FOOD_SOURCE_UNAVAILABLE` | — | Inline | "Food search is unavailable right now. Your recent foods still work." | Retry |

### ER§1.8 Messaging, comments, and safety

| Code | Transport | Mode | User copy | Action |
|---|---|---|---|---|
| `BLOCKED_BY_RECIPIENT` | FORBIDDEN | Inline | "You can't send messages in this conversation." | — **Never reveals that a block exists.** See ER§2.2 |
| `YOU_BLOCKED_RECIPIENT` | FORBIDDEN | Inline | "You've blocked this person. Unblock them to send messages." | Unblock |
| `CONTENT_REMOVED` | NOT_FOUND | Inline | "This was removed." | — |
| `ACCOUNT_SUSPENDED` | FORBIDDEN | Blocking | "Your account is suspended while we review a report. Check your email for details." | Appeal |
| `REPORT_ALREADY_FILED` | CONFLICT | Inline | "You already reported this. We're looking into it." | — |
| `COMMENT_TARGET_GONE` | NOT_FOUND | Inline | "The thing this refers to was deleted." | Back |

### ER§1.9 Invites and coach relationships

| Code | Transport | Mode | User copy | Action |
|---|---|---|---|---|
| `INVITE_EXPIRED` | BAD_REQUEST | Blocking | "That invite has expired. Ask your coach for a new one." | — |
| `INVITE_ALREADY_USED` | CONFLICT | Blocking | "That invite has already been used." | Sign in |
| `CLIENT_ALREADY_HAS_COACH` | CONFLICT | Blocking | "You're already working with a coach. Leave them first to accept this invite." | Manage coach |
| `CANNOT_LEAVE_MID_TRANSFER` | CONFLICT | Inline | "We're still moving your history. Try again in a moment." | — |

### ER§1.10 Live sessions

| Code | Transport | Mode | User copy | Action |
|---|---|---|---|---|
| `RECORDING_CONSENT_REQUIRED` | FORBIDDEN | Blocking | "Both people need to agree before recording can start." | — |
| `LIVE_ROOM_UNAVAILABLE` | — | Inline | "We couldn't connect to the session. Try again." | Retry |
| `LIVE_SESSION_ENDED` | CONFLICT | Inline | "This session has ended." | Back |

### ER§1.11 Generic and infrastructure

| Code | Transport | Mode | User copy | Action |
|---|---|---|---|---|
| `VALIDATION_FAILED` | BAD_REQUEST | Inline | *(per-field, from the Zod message)* | Fix the field |
| `RATE_LIMITED` | TOO_MANY_REQUESTS | Inline | "Too many attempts. Try again in {retryAfter}." | — |
| `OFFLINE` | — (client-side) | Silent/Inline | "You're offline. We'll save this and sync later." | — |
| `SERVER_UNAVAILABLE` | INTERNAL_SERVER_ERROR | Inline | "CoachOS is having trouble right now. Your data is safe and we'll retry." | Retry |
| `UNEXPECTED` | INTERNAL_SERVER_ERROR | Inline | "Something didn't work. We've been notified." | Retry |

> **`UNEXPECTED` is the failure of this document, not of the code.** Every time it appears
> in production, the fix is to name the state and give it a row above. Track its rate: it
> should trend toward zero, and a spike is a release regression.

---

## ER§2. Errors that lie on purpose

Three cases where the honest error is the wrong error. Each is deliberate and each must
survive future "helpful" refactors.

### ER§2.1 `NOT_YOUR_CLIENT` returns `NOT_FOUND`

Returning `FORBIDDEN` confirms the resource exists. That is an enumeration oracle: a coach
could walk UUIDs and learn which belong to real clients. **Authorisation failures on
another coach's resource are indistinguishable from a genuine 404**, in both the transport
code and the copy. Logged server-side as an authorisation failure, with the real reason.

### ER§2.2 `BLOCKED_BY_RECIPIENT` never says "blocked"

Telling A that B blocked them turns blocking into a provocation, which is exactly the
escalation the feature exists to prevent. The copy is deliberately flat and identical to a
generic send failure. **The person who blocked is never named and the block is never
confirmed.**

### ER§2.3 Auth failures are uniform

`SIGN_IN_FAILED` covers wrong password, unknown email, and locked account with one message
("That email or password isn't right") and one timing profile. Distinguishing them enumerates
registered users.

---

## ER§3. What is never an error

Naming these prevents a whole class of bad UX where a normal state is rendered as a failure.

| Situation | Correct treatment |
|---|---|
| A replayed offline mutation | Success, returning the existing row |
| Being offline while logging | A sync indicator. Not an error, not a warning, not a toast |
| An empty list | A designed empty state with one primary action (`ui-conventions`) |
| A health-sync export failing | Silent. The client can do nothing about it (`phase-24-health-sync/workout-export/02`) |
| A push notification failing to deliver | Silent. The durable in-app record is unaffected |
| A coach exceeding their seat limit after a downgrade | A persistent, non-modal banner. Existing clients keep working (§15.5) |
| A video still processing | A progress state, not a failure |
| An analytics emit failing | Silent, always. Fire-and-forget |

---

## ER§4. Server-side handling

- **Never surface a raw database error, a stack trace, a provider name, or an internal
  message.** Log it with the request ID; return the nearest catalogued code, or `UNEXPECTED`.
- Every thrown error carries the request ID in its log line so a support conversation can be
  traced from a screenshot (`SUPPORT.md`).
- `UNEXPECTED` and `SERVER_UNAVAILABLE` are the only two codes that may originate from an
  unhandled exception. Everything else is thrown deliberately.
- Errors are **not** analytics events, with one exception: `sync_failed` (`ANALYTICS.md`
  §AN3.8), because the outbox's permanent-failure rate is a product health metric.

---

## ER§5. Adding an error

1. Add the row here, in the right subsection, with copy and an action.
2. Add the code to the union in `packages/schemas/src/errors.ts`. The client will fail to
   compile until every consumer handles it — that is the point.
3. Add the copy to the client's error-copy map, keyed by code.
4. If it is **Blocking**, justify it in the PR. Blocking is rare by design.
5. Check it against ER§0.1's six copy rules, especially rule 4.

**A code with no user-facing copy is not finished.** A code that only appears in logs
belongs in the log, not in this catalogue.

---

*Companions: `api-conventions` skill (how to throw) · `ANALYTICS.md` (the other typed
catalogue) · `SUPPORT.md` (what a human does with these) · Owner: Ammar ·
Last updated: 16 August 2026*
