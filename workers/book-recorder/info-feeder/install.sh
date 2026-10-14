#!/bin/sh
# Install / update the symbol info feeder on this server (run as root from the repo checkout).
# Reuses /root/projects/book-feeder/feeder.env (recorder URL + ingest secret) and the InsightSentry
# key file of the chief-of-staff profile (both mode 0600); does not create, copy or print a secret.
set -e
here=$(cd "$(dirname "$0")" && pwd)
dst=/root/projects/book-feeder
test -f "$dst/feeder.env" || { echo "missing $dst/feeder.env (see ../README.md)"; exit 1; }
test -f /root/.hermes/profiles/chief-of-staff/scripts/insightsentry.env || { echo "missing insightsentry.env"; exit 1; }
install -m 0755 "$here/info_feeder.py" "$dst/info_feeder.py"
install -m 0644 "$here/info-feeder.service" /etc/systemd/system/info-feeder.service
install -m 0644 "$here/info-feeder.timer" /etc/systemd/system/info-feeder.timer
systemctl daemon-reload
systemctl enable --now info-feeder.timer
systemctl list-timers info-feeder.timer --no-pager
