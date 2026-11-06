#!/bin/sh
# Install / update the ZoroOptions feeder on this server (run as root from the repo checkout).
# Copies the files and reloads systemd. It does NOT enable the timer: the CoS enables it at ship time with
#   systemctl enable --now zoro-feeder.timer
# Needs gex_feeder.py and opt_feeder.py next to it (their install.sh puts them in /root/projects/book-feeder).
# Reuses /root/projects/book-feeder/feeder.env and the chief-of-staff insightsentry.env (mode 0600); prints no secret.
set -e
here=$(cd "$(dirname "$0")" && pwd)
dst=/root/projects/book-feeder
test -f "$dst/feeder.env" || { echo "missing $dst/feeder.env (see ../README.md)"; exit 1; }
test -f "$dst/gex_feeder.py" -a -f "$dst/opt_feeder.py" || { echo "missing gex_feeder.py / opt_feeder.py in $dst"; exit 1; }
install -m 0755 "$here/zoro_feeder.py" "$dst/zoro_feeder.py"
install -m 0644 "$here/zoro-feeder.service" /etc/systemd/system/zoro-feeder.service
install -m 0644 "$here/zoro-feeder.timer" /etc/systemd/system/zoro-feeder.timer
systemctl daemon-reload
echo "installed; timer NOT enabled (systemctl enable --now zoro-feeder.timer at ship)"
