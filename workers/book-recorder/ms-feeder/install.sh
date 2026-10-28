#!/bin/sh
# Install / update the Market Stats feeder on this server (run as root from the repo checkout, AFTER the Worker with the
# ms_* parts is deployed). Reuses feeder.env and the InsightSentry key file; does not create, copy or print a secret.
set -e
here=$(cd "$(dirname "$0")" && pwd)
dst=/root/projects/book-feeder
test -f "$dst/feeder.env" || { echo "missing $dst/feeder.env (see ../README.md)"; exit 1; }
test -f /root/.hermes/profiles/chief-of-staff/scripts/insightsentry.env || { echo "missing insightsentry.env"; exit 1; }
mkdir -p "$dst/ms-cache"
install -m 0755 "$here/ms_feeder.py" "$dst/ms_feeder.py"
install -m 0644 "$here/ms-feeder.service" /etc/systemd/system/ms-feeder.service
install -m 0644 "$here/ms-feeder.timer" /etc/systemd/system/ms-feeder.timer
systemctl daemon-reload
systemctl enable --now ms-feeder.timer
systemctl list-timers ms-feeder.timer --no-pager
