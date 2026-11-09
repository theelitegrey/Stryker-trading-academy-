#!/bin/sh
# DEEP HISTORY server side. Run by the CoS AFTER the Worker (HIST_ON=1) is deployed and a test POST answers 400/200 (not 404).
set -eu
SRC=$(cd "$(dirname "$0")" && pwd)
install -d /opt/tz-hist /var/lib/tz-hist
install -m 0755 "$SRC/backfill_m1.py" "$SRC/backfill_is_m1.py" /opt/tz-hist/
[ -d /root/tz-hist ] && cp -rn /root/tz-hist/* /var/lib/tz-hist/ 2>/dev/null || true   # reuse the backfilled files
# first load of the store from disk (tick archive: NQ,ES; REST vendor: the other four). Top-up of the newest days is in the timer.
export TICKSTREAM_ENV=/root/.hermes/profiles/chief-of-staff/scripts/tickstream.env INSIGHTSENTRY_ENV=/root/.hermes/profiles/chief-of-staff/scripts/insightsentry.env FEEDER_ENV=/root/projects/book-feeder/feeder.env
nice -n 15 python3 /opt/tz-hist/backfill_m1.py --symbols NQ,ES --days 366 --out /var/lib/tz-hist --post-all
nice -n 15 python3 /opt/tz-hist/backfill_is_m1.py --symbols YM,RTY,MNQ,MES --days 366 --out /var/lib/tz-hist --post-all
install -m 0644 "$SRC/tz-hist-topup.service" "$SRC/tz-hist-topup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now tz-hist-topup.timer
