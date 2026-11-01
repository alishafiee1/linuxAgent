#!/bin/bash
# Run INSIDE the hermes container as root, from a checkout of this repo:
#   sudo bash deploy/provision-hermes.sh
# Idempotent. Does not touch hermes-gateway.service or Hermes Agent files.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/cwp

echo "== 1. users and folders"
id panel >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/cwp-home --shell /usr/sbin/nologin panel
id agent >/dev/null 2>&1 || useradd --create-home --home-dir /home/agent --shell /bin/bash agent
# useradd may create a 0700 home; the panel must reach the workspace and bots folders (.claude stays 0700).
chmod 0711 /home/agent
install -d -o agent -g agent -m 0755 /home/agent/workspace /home/agent/bots /home/agent/shared /home/agent/shared/skills /home/agent/browser
install -d -o panel -g panel -m 0700 /var/lib/cwp
install -d -o panel -g panel -m 0750 /var/backups/cwp
install -d -o root -g panel -m 0750 /etc/cwp

echo "== 2. node 22, pnpm, sqlite3"
if ! node -v 2>/dev/null | grep -q '^v2[2-9]'; then
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y sqlite3 sudo rsync chromium
corepack enable
corepack prepare pnpm@10.28.0 --activate

echo "== 3. app in $APP"
rsync -a --delete --exclude node_modules --exclude .git --exclude 'apps/*/dist' "$REPO/" "$APP/"
cd "$APP"
pnpm install --frozen-lockfile
pnpm -r run build
chown -R root:root "$APP"
chmod -R a+rX "$APP"

echo "== 4. helpers and sudoers"
install -m 0755 "$REPO/deploy/bin/cwp-agent-exec" /usr/local/bin/cwp-agent-exec
install -m 0750 "$REPO/deploy/bin/cwp-proxy-apply" /usr/local/sbin/cwp-proxy-apply
cat > /etc/sudoers.d/cwp <<'SUDO'
panel ALL=(agent) NOPASSWD: /usr/local/bin/cwp-agent-exec
panel ALL=(root) NOPASSWD: /usr/local/sbin/cwp-proxy-apply
SUDO
chmod 0440 /etc/sudoers.d/cwp
visudo -cf /etc/sudoers.d/cwp

echo "== 4b. shared skills (only missing ones; a skill edited in the panel is kept)"
for dir in "$REPO"/deploy/skills/*/; do
  name="$(basename "$dir")"
  if [ ! -e "/home/agent/shared/skills/$name" ]; then
    install -d -o agent -g agent -m 0755 "/home/agent/shared/skills/$name"
    install -o agent -g agent -m 0644 "$dir/SKILL.md" "/home/agent/shared/skills/$name/SKILL.md"
  fi
done

echo "== 5. env file (created once)"
if [ ! -f /etc/cwp/env ]; then
  umask 077
  cat > /etc/cwp/env <<ENV
CWP_MASTER_KEY=$(openssl rand -hex 32)
CWP_SESSION_SECRET=$(openssl rand -hex 32)
CWP_HOST=127.0.0.1
CWP_PORT=8787
CWP_DB_PATH=/var/lib/cwp/cwp.db
CWP_AGENT_HOME=/home/agent
CWP_WEB_DIST=$APP/apps/web/dist
CWP_CLAUDE_PATH=/usr/bin/claude
CWP_AGENT_EXEC=sudo -n -u agent /usr/local/bin/cwp-agent-exec
CWP_PROXY_APPLY=sudo -n /usr/local/sbin/cwp-proxy-apply
CWP_CLASH_API=http://127.0.0.1:9090
CWP_CLASH_SECRET_PATH=/etc/cwp/clash-secret
CWP_PUBLIC_BASE_URL=https://agent.roditeam.ir
ENV
  chown root:panel /etc/cwp/env
  chmod 0640 /etc/cwp/env
fi
# The panel reads sing-box status through the clash API; it needs the secret, read-only.
if [ -f /etc/sing-box/clash-secret ]; then
  install -o root -g panel -m 0640 /etc/sing-box/clash-secret /etc/cwp/clash-secret
fi
# Proxy servers the host kill switch already allows (deploy/proxy/allow-proxy.sh adds more).
touch /etc/sing-box/allowed-servers
chmod 0644 /etc/sing-box/allowed-servers

echo "== 6. services"
install -m 0644 "$REPO/deploy/systemd/cwp.service" "$REPO/deploy/systemd/cwp-backup.service" "$REPO/deploy/systemd/cwp-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now cwp-backup.timer
systemctl enable cwp.service
systemctl restart cwp.service
sleep 2
systemctl --no-pager --lines=5 status cwp.service || true

cat <<'NEXT'

Next steps (manual, once):
  1. Claude Code (pinned: no AVX on this CPU; point CWP_CLAUDE_PATH at its cli.js) and the subscription login for the agent user:
       npm i -g @anthropic-ai/claude-code@2.1.112 && sudo -iu agent claude      # then /login
  2. Create the panel user (shows the TOTP key once):
       cd /opt/cwp && sudo -u panel CWP_ENV_FILE=/etc/cwp/env node apps/server/dist/cli.js user:init masoud
  3. On the host: expose the panel to nginx and add the server block (deploy/README.md steps 6–7).
NEXT
