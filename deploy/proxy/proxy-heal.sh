#!/bin/bash
# Run on the HOST (rodi) as a member of incus-admin, from the user's crontab. OPT-IN: nothing in this repo installs it.
#
# When the proxy domain now points to another IP, and the IP in use no longer answers while the new one does,
# it calls move-proxy-ip.sh (kill switch rule, config swap, restart, rollback on failure).
#
#   DOMAIN=3x.n3xus.ir bash proxy-heal.sh              # act
#   DRY_RUN=1 DOMAIN=3x.n3xus.ir bash proxy-heal.sh    # only say what it would do
#
# The domain can also be set in /etc/cwp/proxy-heal.conf as DOMAIN=...
# Crontab line (every 5 minutes):  */5 * * * * DOMAIN=3x.n3xus.ir bash ~/proxy-heal.sh >> ~/proxy-heal.log 2>&1
set -eu
CONF_FILE="${CWP_HEAL_CONF:-/etc/cwp/proxy-heal.conf}"
# shellcheck disable=SC1090
[ -r "$CONF_FILE" ] && . "$CONF_FILE"
DOMAIN="${DOMAIN:?set DOMAIN (the proxy domain)}"
DIR="$(cd "$(dirname "$0")" && pwd)"
say() { echo "$(date -u +%FT%TZ) proxy-heal: $*"; logger -t cwp-proxy-heal "$*" 2>/dev/null || true; }
reach() { timeout 6 bash -c "exec 3<>/dev/tcp/$1/$2" 2>/dev/null; }

# The proxy outbound is the block after "type": "vless". The DNS section has a "server" too, so a plain grep would pick that one.
BLOCK=$(incus exec hermes -- grep -A4 '"type": "vless"' /etc/sing-box/config.json)
CUR=$(echo "$BLOCK" | grep -m1 '"server":' | sed -E 's/.*"server": *"([^"]+)".*/\1/')
PORT=$(echo "$BLOCK" | grep -m1 '"server_port":' | sed -E 's/[^0-9]*([0-9]+).*/\1/')
NEW=$(getent ahostsv4 "$DOMAIN" | awk '{print $1; exit}')

echo "$CUR" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || { say "cannot read the proxy IP from the hermes config"; exit 1; }
echo "$PORT" | grep -Eq '^[0-9]+$' || { say "cannot read the proxy port from the hermes config"; exit 1; }
echo "$NEW" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' || { say "$DOMAIN does not resolve"; exit 1; }
case "$NEW" in
  10.*|127.*|192.168.*|172.1[6-9].*|172.2?.*|172.3[01].*|169.254.*) say "$DOMAIN resolves to a private address ($NEW); not touching anything"; exit 1 ;;
esac

if reach "$CUR" "$PORT"; then say "$CUR:$PORT answers; nothing to do"; exit 0; fi
if [ "$NEW" = "$CUR" ]; then say "$CUR:$PORT does not answer and the domain still points to it; the server itself is down"; exit 0; fi
if ! reach "$NEW" "$PORT"; then say "$DOMAIN moved to $NEW but $NEW:$PORT does not answer either"; exit 0; fi

say "$DOMAIN moved from $CUR to $NEW (port $PORT)"
if [ "${DRY_RUN:-0}" = "1" ]; then say "dry run: would run move-proxy-ip.sh $CUR $NEW $PORT"; exit 0; fi
sh "$DIR/move-proxy-ip.sh" "$CUR" "$NEW" "$PORT"
say "done"
