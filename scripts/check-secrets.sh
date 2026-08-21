#!/usr/bin/env bash
# Pre-commit secret scan (quality-gates/02). Scans STAGED content only, never
# the working tree — a developer's real, correctly-untracked .env must never
# trip this, only what is actually about to enter history.
#
# Escape hatch: a genuine false positive (a test fixture, a doc example) is
# allow-listed by appending `# secret-scan-ignore` to that exact line — a
# visible, reviewable annotation in the diff, never a blanket `--no-verify`.
#
# The scan cannot catch every secret — a value with no recognisable shape
# passes. The real control is discipline: secrets live in EAS Secrets and Fly
# secrets, .env is gitignored, .env.example carries placeholders only (see the
# `configuration` skill).
set -uo pipefail

fail=0

# --- 1. Reject any staged .env file other than .env.example -----------------
# .gitignore already blocks these; this catches a `git add -f` bypass.
while IFS= read -r file; do
  base="$(basename "$file")"
  case "$base" in
    .env.example) ;;
    .env | .env.*)
      echo "✗ $file: only .env.example may ever be committed, and only with placeholders (configuration skill §5)."
      fail=1
      ;;
  esac
done < <(git diff --cached --name-only --diff-filter=ACM)

# --- 2. Scan staged additions for secret-shaped values -----------------------
# .env.example is excluded here (not from check 1 above) — it is the one file
# whose entire purpose is to hold placeholder values shaped like the real
# thing, e.g. `DATABASE_URL=postgres://user:password@localhost:5432/coachos`. # secret-scan-ignore
diff_content="$(git diff --cached -U0 --diff-filter=ACM -- . ':(exclude).env.example' 2>/dev/null || true)"
added_lines="$(echo "$diff_content" | grep -E '^\+[^+]' | grep -v 'secret-scan-ignore' || true)"

check_pattern() {
  local label="$1"
  local pattern="$2"
  local hits
  hits="$(echo "$added_lines" | grep -E -e "$pattern" || true)"
  if [ -n "$hits" ]; then
    echo "✗ Possible $label in staged changes:"
    echo "$hits" | sed 's/^/    /'
    fail=1
  fi
}

check_pattern "private key" '-----BEGIN [A-Z ]*PRIVATE KEY-----'
check_pattern "AWS access key ID" 'AKIA[0-9A-Z]{16}'
check_pattern "Stripe live secret key" 'sk_live_[A-Za-z0-9]{10,}'
check_pattern "Google API key" 'AIza[0-9A-Za-z_-]{35}'
check_pattern "bearer token" '[Bb]earer +[A-Za-z0-9._-]{20,}'
check_pattern "credentialed Postgres connection string" 'postgres(ql)?://[^:/@[:space:]]+:[^@/[:space:]]+@'
check_pattern "EXPO_PUBLIC_ variable assigned a secret-shaped value (configuration skill §3)" \
  'EXPO_PUBLIC_[A-Z0-9_]+ *= *["'"'"']?(AKIA[0-9A-Z]{16}|sk_live_[A-Za-z0-9]{10,}|AIza[0-9A-Za-z_-]{35})'

if [ "$fail" -ne 0 ]; then
  echo
  echo "Pre-commit secret scan failed. If a value is real: remove it, and rotate it"
  echo "immediately — deleting the file is not the fix (git-workflow skill §7)."
  echo "If this is a genuine false positive, append '# secret-scan-ignore' to that"
  echo "exact line rather than committing with --no-verify."
  exit 1
fi

exit 0
