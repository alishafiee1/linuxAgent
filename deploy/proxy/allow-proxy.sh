#!/bin/sh
# Run on the HOST (rodi) as a member of incus-admin. Allows hermes to reach a new proxy server
# through the kill switch, and tells the in-container helper that this server is allowed.
#   deploy/proxy/allow-proxy.sh <server-ip> <port>
set -eu
IP="${1:?server ip}"; PORT="${2:?port}"
ACL=hermes-killswitch
if incus network acl show "$ACL" | grep -q "destination: $IP\$"; then
  echo "ACL already allows $IP"
else
  incus network acl rule add "$ACL" egress action=allow protocol=tcp destination="$IP" destination_port="$PORT"
fi
incus exec hermes -- sh -c "grep -qxF '$IP:$PORT' /etc/sing-box/allowed-servers 2>/dev/null || echo '$IP:$PORT' >> /etc/sing-box/allowed-servers"
echo "allowed $IP:$PORT for hermes"
