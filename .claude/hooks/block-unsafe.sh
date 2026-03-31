#!/bin/bash
# Block unsafe commands that agents should never use.
# Covers destructive operations (data loss) and discipline violations
# (blanket staging, hook bypass). The user can always run these manually.
#
# Destructive: git stash drop/clear, git checkout --/restore (any file), git clean -f,
#              git reset --hard, kill -9/-KILL, killall, pkill,
#              git push --force (but NOT --force-with-lease), rm -rf
# Discipline:  git add ./git add -A (stage by name instead),
#              git commit --no-verify (fix the hook, don't bypass)

INPUT=$(cat)

# jq is required to parse the JSON input. If missing, deny ALL Bash
# commands with a clear error rather than silently allowing everything.
if ! command -v jq &>/dev/null; then
  echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: block-unsafe.sh hook requires jq but it is not installed. Install jq or remove the hook. Denying all Bash commands as a safety precaution."}}'
  exit 0
fi

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Only filter Bash commands
if [[ "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

# Block patterns — each with a reason
block_with_reason() {
  jq -n --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

# git stash drop / git stash clear — destroys stashed work permanently
if echo "$COMMAND" | grep -qE 'git\s+stash\s+(drop|clear)'; then
  block_with_reason "BLOCKED: git stash drop/clear destroys stashed work permanently (including untracked files saved with -u). If you need to drop a stash, ask the user to do it manually."
fi

# git checkout -- (any file or blanket) — discards uncommitted changes permanently
if echo "$COMMAND" | grep -qE 'git\s+checkout\s+--'; then
  block_with_reason "BLOCKED: git checkout -- discards uncommitted changes permanently. This may destroy other sessions' work. If you need to undo your own change, use git diff to see what changed and edit it back manually."
fi

# git restore (any file or blanket) — modern equivalent of checkout --
if echo "$COMMAND" | grep -qE 'git\s+restore\s'; then
  block_with_reason "BLOCKED: git restore discards uncommitted changes permanently. If you need to undo your own change, use git diff to see what changed and edit it back manually."
fi

# git clean -f (permanent file deletion)
if echo "$COMMAND" | grep -qE 'git\s+clean\s+-[a-zA-Z]*f'; then
  block_with_reason "BLOCKED: git clean -f permanently deletes untracked files. These cannot be recovered from git."
fi

# git reset --hard (discards everything)
if echo "$COMMAND" | grep -qE 'git\s+reset\s+--hard'; then
  block_with_reason "BLOCKED: git reset --hard discards all uncommitted changes and staged work. Use git reset (soft) or ask the user."
fi

# kill -9 / kill -KILL / kill -SIGKILL / kill -s 9 / killall / pkill
if echo "$COMMAND" | grep -qE 'kill\s+(-9|-KILL|-SIGKILL|-s\s+(9|KILL|SIGKILL))|killall\s|pkill\s'; then
  block_with_reason "BLOCKED: kill -9/killall/pkill can kill container-critical processes. Ask the user to stop the process manually."
fi

# fuser -k (kills whatever process holds a port — disrupts other sessions' dev servers and E2E tests)
if echo "$COMMAND" | grep -qE 'fuser\s+(.*-[a-z]*k[a-z]*|--kill)'; then
  block_with_reason "BLOCKED: fuser -k kills whatever process holds a port. Other sessions may need that dev server for E2E tests. Ask the user to stop the process manually."
fi

# git push (any form — agents should never push; the user pushes when ready)
if echo "$COMMAND" | grep -qE 'git\s+push'; then
  block_with_reason "BLOCKED: Agents must not push. The user decides when to push — they can run: ! git push"
fi

# rm -rf / rm -r -f (mass deletion, with separate or combined flags)
if echo "$COMMAND" | grep -qE 'rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|(-r\s+-f|-f\s+-r)|--recursive\s+--force|--force\s+--recursive)'; then
  block_with_reason "BLOCKED: rm -rf performs mass file deletion. Delete specific files by name, or ask the user."
fi

# git add . / git add -A / git add --all (sweeps in unrelated changes)
if echo "$COMMAND" | grep -qE 'git\s+add\s+(-A|--all|\.(\s|$))'; then
  block_with_reason "BLOCKED: git add . / git add -A sweeps in ALL changes, including other sessions' work. Stage files by name: git add file1 file2."
fi

# Piping test output (loses failures, forces re-runs — capture to file instead)
if echo "$COMMAND" | grep -qP '(npm\s+test(\s|$)|npm\s+run\s+test(:\S+)?(\s|$)|node\s+--test\s)' && \
   echo "$COMMAND" | grep -qP '\|'; then
  block_with_reason "Don't pipe test output — it loses failure details. Instead: npm run test:all > .test-results.txt 2>&1 then read the file. To inspect results, grep the captured file."
fi

# git commit --no-verify (skips pre-commit hooks)
if echo "$COMMAND" | grep -qE 'git\s+commit\s+.*--no-verify'; then
  block_with_reason "BLOCKED: --no-verify skips pre-commit hooks. Hooks exist for safety — fix the hook failure, don't bypass it."
fi

# --- Safety net: transcript-based verification on git commit ---
# When an agent runs git commit, check the session transcript to verify
# that tests were actually run.
if echo "$COMMAND" | grep -qE '^git\s+commit'; then
  TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')
  if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
    if ! grep -q 'npm run test:all' "$TRANSCRIPT" 2>/dev/null; then
      CODE_FILES=$(git diff --cached --name-only 2>/dev/null | grep -E '\.(js|css|html)$')
      if [ -n "$CODE_FILES" ]; then
        block_with_reason "BLOCKED: Committing code but 'npm run test:all' was not found in the session transcript. Run tests before committing. (Content-only commits are exempt.)"
      fi
    fi
  fi
fi

# No match — allow
exit 0
