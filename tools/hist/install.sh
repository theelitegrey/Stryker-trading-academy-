#!/bin/sh
# DEEP HISTORY server side (history-gap2). Run by the Head of Website Development / CoS AFTER approval; the engineer does not run it.
# 1) one-time backfill (about 1 h per symbol for a year, one request at a time) + upload to the book-recorder store
# 2) a daily timer that re-fetches the newest 3 days and uploads them.
# Needs: the Worker deployed with this branch and "HIST_ON": "1" in workers/book-recorder/wrangler.jsonc vars.
set -eu
SRC=$(cd "$(dirname "$0")" && pwd)
install -d /opt/tz-hist /var/lib/tz-hist
install -m 0755 "$SRC/backfill_m1.py" /opt/tz-hist/backfill_m1.py
[ -d /root/tz-hist ] && cp -rn /root/tz-hist/NQ /root/tz-hist/ES /var/lib/tz-hist/ 2>/dev/null || true   # reuse the test backfill files
TICKSTREAM_ENV=/root/.hermes/profiles/chief-of-staff/scripts/tickstream.env FEEDER_ENV=/root/projects/book-feeder/feeder.env \
  nice -n 15 python3 /opt/tz-hist/backfill_m1.py --symbols NQ,ES --days 366 --redo-days 0 --out /var/lib/tz-hist --post-all
install -m 0644 "$SRC/tz-hist-topup.service" "$SRC/tz-hist-topup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now tz-hist-topup.timer
systemctl list-timers tz-hist-topup.timer --no-pager
