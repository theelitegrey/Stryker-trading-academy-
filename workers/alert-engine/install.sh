#!/bin/sh
# Installs/updates the alert engine on THIS server: copies the code to /root/projects/alert-engine and (re)starts the unit.
set -e
D=/root/projects/alert-engine; S=$(cd "$(dirname "$0")" && pwd)
mkdir -p $D; cp "$S"/alert_core.py "$S"/alert_engine.py "$S"/fsrest.py "$S"/wsmini.py $D/
cp "$S"/alert-engine.service /etc/systemd/system/alert-engine.service
systemctl daemon-reload; systemctl enable alert-engine.service >/dev/null 2>&1; systemctl restart alert-engine.service
sleep 4; systemctl is-active alert-engine.service; journalctl -u alert-engine -n 8 --no-pager
