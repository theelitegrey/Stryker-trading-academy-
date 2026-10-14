#!/bin/sh
# Install / update the order-flow feeder on this server (run as root from the repo checkout).
# Reuses the book feeder's secret file /root/projects/book-feeder/feeder.env and the InsightSentry
# key file (both mode 0600); creates or prints neither.
#   sh install.sh             install + (re)start the live service
#   sh install.sh --backfill  also rebuild the previous 6 UTC days (InsightSentry keeps 7)
set -e
here=$(cd "$(dirname "$0")" && pwd)
dst=/root/projects/book-feeder/of-feeder
test -f /root/projects/book-feeder/feeder.env || { echo "missing /root/projects/book-feeder/feeder.env (see ../README.md)"; exit 1; }
test -f /root/.hermes/profiles/chief-of-staff/scripts/insightsentry.env || { echo "missing the InsightSentry key file"; exit 1; }

mkdir -p "$dst"
install -m 0755 "$here/of_feeder.py" "$dst/of_feeder.py"
install -m 0644 "$here/ofcodec.py" "$dst/ofcodec.py"
install -m 0644 "$here/wsmini.py" "$dst/wsmini.py"
install -m 0644 "$here/of-feeder.service" /etc/systemd/system/of-feeder.service
systemctl daemon-reload
if [ "$1" = "--backfill" ]; then
  systemd-run --wait --collect -p MemoryMax=150M -p EnvironmentFile=/root/projects/book-feeder/feeder.env \
    -p EnvironmentFile=/root/.hermes/profiles/chief-of-staff/scripts/insightsentry.env \
    --unit of-feeder-backfill /usr/bin/python3 "$dst/of_feeder.py" --backfill 6
fi
systemctl enable of-feeder.service
systemctl restart of-feeder.service
systemctl status of-feeder.service --no-pager | head -5
