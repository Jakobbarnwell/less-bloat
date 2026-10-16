#!/bin/zsh
# Measures the README's table: the first request's input tokens when you say "hi" in an
# interactive CLI session, out-of-the-box, with and without less-bloat. Each run gets a fresh
# config, so your own plugins, MCP servers, skills and CLAUDE.md don't count.
# Auth: run `claude setup-token` once and export CLAUDE_CODE_OAUTH_TOKEN, or store the token
# in Keychain: security add-generic-password -U -s less-bloat-bench -a "$USER" -w
# Needs expect and jq. Usage: zsh scripts/bench.zsh
set -eu
tok=${CLAUDE_CODE_OAUTH_TOKEN:-$(security find-generic-password -s less-bloat-bench -a "$USER" -w)}
unsets=(${(f)"$(env | grep -E '^CLAUDE' | cut -d= -f1 | sed 's/^/-u\n/')"})
root=$(mktemp -d /tmp/less-bloat-bench.XXXX); root=${root:A}
trap 'rm -rf $root' EXIT

cat > $root/run.exp <<'EOF'
set timeout 120
cd [lindex $argv 0]
spawn claude
sleep 10
send "hi"; sleep 1; send "\r"
sleep 30
send "/exit"; sleep 1; send "\r"; sleep 3
expect eof
EOF

print "Claude Code $(claude --version | cut -d' ' -f1)"
for s in without with; do
  cfg=$root/$s-cfg work=$root/$s-work
  mkdir -p $cfg $work
  print -r -- "{\"hasCompletedOnboarding\":true,\"projects\":{\"$work\":{\"hasTrustDialogAccepted\":true}}}" > $cfg/.claude.json
  e=(env "${unsets[@]}" CLAUDE_CONFIG_DIR=$cfg CLAUDE_CODE_OAUTH_TOKEN=$tok)
  if [[ $s == with ]]; then
    $e claude plugin marketplace add jakobbarnwell/less-bloat >/dev/null
    $e claude plugin install less-bloat@less-bloat >/dev/null
  fi
  $e expect $root/run.exp $work > $root/$s.log 2>&1
  f=$(print -l $cfg/projects/*/*.jsonl(N) | head -1)
  [[ -n $f ]] || { print "$s: no transcript; see the session's screen:"; tail -c 800 $root/$s.log; exit 1; }
  jq -r --arg s $s 'select(.type=="assistant") | .message.usage
    | "\($s) less-bloat: \(.input_tokens + .cache_creation_input_tokens + .cache_read_input_tokens)"' $f | head -1
done
