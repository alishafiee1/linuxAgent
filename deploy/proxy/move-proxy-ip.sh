#!/bin/sh
# Run on the HOST (rodi) as a member of incus-admin.
# Moves the hermes proxy from an old server IP to a new one (same port) when the proxy domain changed its address.
#   sh move-proxy-ip.sh <old-ip> <new-ip> <port>
# It allows the new IP in the kill switch, swaps the IP in the sing-box config (the old config is kept as
# config.json.before-ipmove) and restarts sing-box. If sing-box does not come back, the old config is restored.
set -eu
OLD="${1:?old ip}"; NEW="${2:?new ip}"; PORT="${3:?port}"
ACL=hermes-killswitch
OLD_RE=$(printf '%s' "$OLD" | sed 's/[.]/[.]/g')

# Refuse to touch anything unless OLD really is the proxy server in the config (the DNS section has a "server" too).
CUR=$(incus exec hermes -- grep -A4 '"type": "vless"' /etc/sing-box/config.json | grep -m1 '"server":' | sed -E 's/.*"server": *"([^"]+)".*/\1/')
[ "$CUR" = "$OLD" ] || { echo "the proxy server in the config is '$CUR', not $OLD; nothing changed" >&2; exit 1; }

if incus network acl show "$ACL" | grep -q "destination: $NEW\$"; then
  echo "ACL already allows $NEW"
else
  incus network acl rule add "$ACL" egress action=allow protocol=tcp destination="$NEW" destination_port="$PORT"
  echo "ACL now allows $NEW:$PORT"
fi

incus exec hermes -- sh -c "
set -eu
CONF=/etc/sing-box/config.json
cp -p \$CONF \$CONF.before-ipmove
grep -qxF '$NEW:$PORT' /etc/sing-box/allowed-servers 2>/dev/null || echo '$NEW:$PORT' >> /etc/sing-box/allowed-servers
sed -i 's/$OLD_RE/$NEW/g' \$CONF
/usr/local/bin/sing-box check -c \$CONF
systemctl restart sing-box
sleep 5
if systemctl is-active --quiet sing-box; then
  echo 'sing-box is running with $NEW'
else
  echo 'sing-box did not start; restoring the old config' >&2
  cp -p \$CONF.before-ipmove \$CONF
  systemctl restart sing-box
  exit 1
fi
"
