#!/bin/sh
# Install / update the Hyperliquid wallet-intel feeder on this server (run as root from the repo checkout).
# Reuses the book feeder's secret file /root/projects/book-feeder/feeder.env (mode 0600); creates or prints nothing secret.
# Needs the book-recorder Worker with /hl-ingest deployed first (else every POST answers 404).
#   sh install.sh             install + (re)start the live service
#   sh install.sh --dry 120   only a 120 s dry run (no POSTs), payloads in /tmp/hl-dry
set -e
here=$(cd "$(dirname "$0")" && pwd)
dst=/root/projects/book-feeder/hl-feeder
if [ "$1" = "--dry" ]; then
  python3 "$here/hl_feeder.py" --dry-run "${2:-120}" --out /tmp/hl-dry
  exit 0
fi
test -f /root/projects/book-feeder/feeder.env || { echo "missing /root/projects/book-feeder/feeder.env (see ../README.md)"; exit 1; }
mkdir -p "$dst"
install -m 0755 "$here/hl_feeder.py" "$dst/hl_feeder.py"
install -m 0644 "$here/hlcore.py" "$dst/hlcore.py"
install -m 0644 "$here/../of-feeder/wsmini.py" "$dst/wsmini.py"
install -m 0644 "$here/hl-feeder.service" /etc/systemd/system/hl-feeder.service
systemctl daemon-reload
systemctl enable hl-feeder.service
systemctl restart hl-feeder.service
systemctl status hl-feeder.service --no-pager | head -5
