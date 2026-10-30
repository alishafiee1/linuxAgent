# hermes → VLESS proxy (sing-box) with host kill switch

Status: **installed and tested** (2026-10-30). Exit IP through the proxy: 131.123.13.6.

No secrets in this file. The VLESS UUID lives only in `/etc/sing-box/config.json` inside hermes.

## Topology

- Host `rodi` (185.255.211.219), Incus 6.0.5, firewall driver nftables.
- Container `hermes` (project `default`, Debian 13), NIC `eth0` on bridge `incusbr0`
  (10.179.96.1/24, fd42:1db5:17ea:d6cf::1/64), IP 10.179.96.162.
- SSH: `ssh rodi` = host (user hp, in incus-admin). `ssh hermes` = the container, jumped via rodi.
- Proxy server: `3x.n3xus.ir` → 94.184.12.156, port 4433, VLESS over WebSocket, path `/masoud`, no TLS.

## What is installed

| Where | What | State |
|---|---|---|
| host | snapshot `hermes/pre-proxy-20261029` | ✅ |
| host | `~hp/hermes-config-pre-proxy-20261029.yaml` (pre-change `incus config show hermes --expanded`) | ✅ |
| hermes | `/usr/local/bin/sing-box` v1.14.4 (sha256 verified against GitHub release digest) | ✅ |
| hermes | `/etc/sing-box/config.json` (0600), rendered from `sing-box.config.template.json` | ✅ (`sing-box check` OK) |
| hermes | `/etc/sing-box/clash-secret` (0600) – clash_api secret | ✅ |
| hermes | `/etc/systemd/system/sing-box.service` (Restart=always, enabled) | ✅ |
| hermes | `/etc/systemd/resolved.conf.d/sing-box.conf` (`DNS=198.18.0.2`, `Domains=~.`) and `/etc/systemd/network/eth0.network.d/10-no-dhcp-dns.conf` (ignore DHCP/RA DNS), so all DNS goes into the TUN and is resolved through the proxy | ✅ |
| hermes | `/etc/systemd/networkd.conf.d/10-sing-box.conf` (`ManageForeignRoutingPolicyRules=no`, `ManageForeignRoutes=no`). Without it networkd wipes sing-box's `ip rule`s on reconfigure/DHCP renew and traffic silently goes direct (then blocked by the kill switch) | ✅ |
| host | Incus ACL `hermes-killswitch` on hermes eth0 (instance-level device override of the profile NIC) | ✅ |

### Config design

- TUN `sbtun0` (198.18.0.1/30 + fdfe:dcba:9876::1/126), `auto_route`, `strict_route`, `stack: system`.
- `route_exclude_address`: RFC1918, `fc00::/7`, `fe80::/10`, the proxy IP. These never enter the TUN,
  so inbound SSH and host services on the bridge keep working.
- DNS: anything to port 53 inside the TUN is hijacked; sing-box resolves via `tcp://1.1.1.1` **through the proxy** (IPv4 only).
- Final outbound = `proxy`. clash_api on `127.0.0.1:9090`.

## Kill switch (host) – as applied

```bash
# safety net first (hp has no passwordless sudo): auto-rollback in 10 minutes
setsid nohup sh -c "sleep 600; incus config device unset hermes eth0 security.acls security.acls.default.egress.action security.acls.default.ingress.action" >/dev/null 2>&1 </dev/null &
echo $! > ~/hermes-ks-rollback.pid

incus network acl create hermes-killswitch
incus network acl rule add hermes-killswitch egress action=allow protocol=tcp destination=94.184.12.156/32 destination_port=4433
incus network acl rule add hermes-killswitch egress action=allow destination=10.179.96.0/24
incus network acl rule add hermes-killswitch egress action=allow destination=fd42:1db5:17ea:d6cf::/64
incus config device override hermes eth0 security.acls=hermes-killswitch \
  security.acls.default.egress.action=reject security.acls.default.ingress.action=allow
# after all tests pass:
kill $(cat ~/hermes-ks-rollback.pid)
```

## Test results (2026-10-30)

| Test | Result |
|---|---|
| proxy up: api.anthropic.com / claude.ai / api.telegram.org | 404 / 403 / 302 (HTTP answers) |
| proxy up: exit IP (ipify, ifconfig.me) | 131.123.13.6 (host is 185.255.211.219) |
| proxy up: forced direct `curl --interface eth0 http://1.1.1.1` | blocked |
| `systemctl stop sing-box`: same curls, direct IPv4 and IPv6 | all fail (000) |
| `systemctl start sing-box` | all work again |
| hermes-gateway.service | active throughout |
| host / balebot `u1` / balebot services | unchanged and working |

## Operations

Change the proxy link: edit `server`, `server_port`, `uuid`, `transport.path` and `Host` header in
`/etc/sing-box/config.json`. Then run `sing-box check -c /etc/sing-box/config.json && systemctl restart sing-box`.
**If the proxy IP changes, also update the host ACL rule** (`incus network acl edit hermes-killswitch`).

Status:
```bash
systemctl status sing-box
curl -s -H "Authorization: Bearer $(cat /etc/sing-box/clash-secret)" http://127.0.0.1:9090/connections | head -c 500
curl -s https://ifconfig.me   # should NOT be 185.255.211.219
```

## Rollback

Order matters: run the host part (remove the ACL) first, otherwise hermes has no internet once sing-box stops.

Inside hermes:
```bash
systemctl disable --now sing-box
rm -f /etc/systemd/resolved.conf.d/sing-box.conf /etc/systemd/network/eth0.network.d/10-no-dhcp-dns.conf
rm -f /etc/systemd/networkd.conf.d/10-sing-box.conf
systemctl restart systemd-networkd systemd-resolved && networkctl reconfigure eth0
```
On the host:
```bash
incus config device unset hermes eth0 security.acls security.acls.default.egress.action security.acls.default.ingress.action
incus network acl delete hermes-killswitch
# full restore if needed:
incus snapshot restore hermes pre-proxy-20261029
```
