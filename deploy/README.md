# Deploying linuxAgent to `hermes`

The panel runs inside the existing Incus container `hermes` on `rodi`, next to Hermes Agent
(which is not touched). Internet for hermes already goes through sing-box with a host kill
switch; see `deploy/proxy/README.md`. No secrets live in this repo.

| What | Where |
|---|---|
| App | `/opt/cwp` (root-owned, world-readable) |
| Service | `cwp.service`, user `panel`, listens on `127.0.0.1:8787` |
| Database | `/var/lib/cwp/cwp.db` (0600 panel), daily backup in `/var/backups/cwp` (7 kept) |
| Secrets | `/etc/cwp/env` (0640 root:panel): master key, session secret. Bale/Telegram tokens and the proxy link are stored encrypted in the DB. |
| Bots | user `agent`, home `/home/agent`, shared workspace `/home/agent/workspace`, notes `/home/agent/bots/<slug>/CLAUDE.md` |
| Claude login | `/home/agent/.claude/` (subscription, via `claude` → `/login`) |

## Steps

1. **Snapshot first (host):** `incus snapshot create hermes pre-cwp-$(date +%Y%m%d)`
2. **Get the code into hermes:** `git clone` this repo (or copy it) to e.g. `/root/linuxAgent`.
3. **Provision (in hermes, as root):** `bash /root/linuxAgent/deploy/provision-hermes.sh`
4. **Claude login (in hermes):** `npm i -g @anthropic-ai/claude-code`, then `sudo -iu agent claude` and run `/login` with Masoud's subscription. Check: `sudo -iu agent claude -p "say ok"`.
5. **Panel user (in hermes):**
   `cd /opt/cwp && sudo -u panel CWP_ENV_FILE=/etc/cwp/env node apps/server/dist/cli.js user:init masoud`
   Add the printed key to an authenticator app, then clear the terminal.
6. **Expose to nginx (host):** the panel stays on localhost inside hermes; an Incus proxy device
   publishes it on the docker bridge gateway, where `rodo-proxy-1` can reach it:
   `incus config device add hermes cwp-web proxy listen=tcp:172.18.0.1:8788 connect=tcp:127.0.0.1:8787 bind=host`
   Check from the host: `curl -sI http://172.18.0.1:8788/ | head -1`.
7. **Domain + TLS (host):** point `agent.roditeam.ir` at the server, get a certificate the same way
   as `node.roditeam.ir` (BaleBot phase 5), add `deploy/nginx/agent.roditeam.ir.conf` to
   `/opt/rodo/deploy/nginx.conf`, and reload nginx in `rodo-proxy-1` (`nginx -t` first).
8. **First login:** open https://agent.roditeam.ir, sign in, then in Settings enter the Bale and
   Telegram bot tokens + chat IDs and press "Test".

## Updating

In hermes: pull the repo, re-run `provision-hermes.sh` (it rebuilds and restarts `cwp.service`;
running bots are marked "interrupted" and can be continued from the panel).

## Proxy changes from the panel

Settings → Proxy accepts a share link or a subscription. The panel writes the sing-box config
through `/usr/local/sbin/cwp-proxy-apply`, which only accepts servers listed in
`/etc/sing-box/allowed-servers` (the host kill switch must allow them too). For a new server IP,
run on the host first: `deploy/proxy/allow-proxy.sh <ip> <port>`.

## Rollback

- Stop the panel: `systemctl disable --now cwp.service cwp-backup.timer` (in hermes).
- Remove exposure: `incus config device remove hermes cwp-web` and the nginx block (host).
- Full: `incus snapshot restore hermes pre-cwp-<date>`.
