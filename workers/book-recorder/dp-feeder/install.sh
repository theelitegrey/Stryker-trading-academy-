#!/bin/sh
# Install / update the dark pool prints feeder on this server (run as root from the repo checkout).
# Reuses /root/projects/book-feeder/feeder.env (recorder URL + ingest secret) and the InsightSentry
# key file of the chief-of-staff profile (both mode 0600); does not create, copy or print a secret.
# NOTE: deploy the book-recorder Worker first (it must accept the dp_* parts), else every POST gets 400.
set -e
here=$(cd "$(dirname "$0")" && pwd)
dst=/root/projects/book-feeder
test -f "$dst/feeder.env" || { echo "missing $dst/feeder.env (see ../README.md)"; exit 1; }
test -f /root/.hermes/profiles/chief-of-staff/scripts/insightsentry.env || { echo "missing insightsentry.env"; exit 1; }
install -m 0755 "$here/dp_feeder.py" "$dst/dp_feeder.py"
install -m 0644 "$here/dp-feeder.service" /etc/systemd/system/dp-feeder.service
install -m 0644 "$here/dp-feeder.timer" /etc/systemd/system/dp-feeder.timer
systemctl daemon-reload
systemctl enable --now dp-feeder.timer
systemctl list-timers dp-feeder.timer --no-pager
