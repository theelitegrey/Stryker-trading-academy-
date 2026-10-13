#!/bin/sh
# Install / update the GEX chain feeder on this server (run as root from the repo checkout).
# Reuses the book feeder's secret file /root/projects/book-feeder/feeder.env (mode 0600); does not
# create or print the secret.
set -e
here=$(cd "$(dirname "$0")" && pwd)
dst=/root/projects/book-feeder
test -f "$dst/feeder.env" || { echo "missing $dst/feeder.env (see ../README.md)"; exit 1; }
install -m 0755 "$here/gex_feeder.py" "$dst/gex_feeder.py"
install -m 0644 "$here/gex-feeder.service" /etc/systemd/system/gex-feeder.service
install -m 0644 "$here/gex-feeder.timer" /etc/systemd/system/gex-feeder.timer
systemctl daemon-reload
systemctl enable --now gex-feeder.timer
systemctl list-timers gex-feeder.timer --no-pager
