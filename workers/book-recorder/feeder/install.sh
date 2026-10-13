#!/bin/sh
# Install / update the book feeder on this server (run as root from the repo checkout).
# Does NOT create or touch the secret: /root/projects/book-feeder/feeder.env (mode 0600) must
# already exist (see ../README.md, "Secret").
set -e
here=$(cd "$(dirname "$0")" && pwd)
dst=/root/projects/book-feeder
mkdir -p "$dst"
install -m 0755 "$here/feeder.py" "$dst/feeder.py"
test -f "$dst/feeder.env" || { echo "missing $dst/feeder.env (see README)"; exit 1; }
chmod 600 "$dst/feeder.env"
install -m 0644 "$here/book-feeder.service" /etc/systemd/system/book-feeder.service
install -m 0644 "$here/book-feeder.timer" /etc/systemd/system/book-feeder.timer
systemctl daemon-reload
systemctl enable --now book-feeder.timer
systemctl list-timers book-feeder.timer --no-pager
