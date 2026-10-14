#!/bin/sh
# Install / update the options analytics feeder on this server (run as root from the repo checkout).
# Reuses /root/projects/book-feeder/feeder.env (recorder URL + ingest secret) and the InsightSentry
# key file of the chief-of-staff profile (both mode 0600); does not create, copy or print a secret.
set -e
here=$(cd "$(dirname "$0")" && pwd)
dst=/root/projects/book-feeder
test -f "$dst/feeder.env" || { echo "missing $dst/feeder.env (see ../README.md)"; exit 1; }
test -f /root/.hermes/profiles/chief-of-staff/scripts/insightsentry.env || { echo "missing insightsentry.env"; exit 1; }
install -m 0755 "$here/opt_feeder.py" "$dst/opt_feeder.py"
install -m 0644 "$here/opt-feeder.service" /etc/systemd/system/opt-feeder.service
install -m 0644 "$here/opt-feeder.timer" /etc/systemd/system/opt-feeder.timer
systemctl daemon-reload
systemctl enable --now opt-feeder.timer
systemctl list-timers opt-feeder.timer --no-pager
