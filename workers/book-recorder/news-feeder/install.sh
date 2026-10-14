#!/bin/sh
# Install / update the news + economic calendar feeder on this server (run as root from the repo
# checkout). Reuses the book feeder's secret file /root/projects/book-feeder/feeder.env and the
# InsightSentry key file (both mode 0600); creates or prints no secret.
set -e
here=$(cd "$(dirname "$0")" && pwd)
dst=/root/projects/book-feeder/news-feeder
test -f /root/projects/book-feeder/feeder.env || { echo "missing /root/projects/book-feeder/feeder.env (see ../README.md)"; exit 1; }
test -f /root/.hermes/profiles/chief-of-staff/scripts/insightsentry.env || { echo "missing the InsightSentry key file"; exit 1; }
mkdir -p "$dst"
install -m 0755 "$here/news_feeder.mjs" "$dst/news_feeder.mjs"
install -m 0644 "$here/../src/news.js" "$dst/news.mjs"
install -m 0644 "$here/news-feeder.service" /etc/systemd/system/news-feeder.service
install -m 0644 "$here/news-feeder.timer" /etc/systemd/system/news-feeder.timer
systemctl daemon-reload
systemctl enable --now news-feeder.timer
systemctl list-timers news-feeder.timer --no-pager
