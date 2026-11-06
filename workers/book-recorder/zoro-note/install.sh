#!/bin/sh
# Copies the note job next to the other feeders. Does NOT enable the timer: the CoS does that when ZoroOptions ships.
set -e
S=$(cd "$(dirname "$0")" && pwd)
cp "$S"/zoro_note.py /root/projects/book-feeder/zoro_note.py
cp "$S"/zoro-note.service "$S"/zoro-note.timer /etc/systemd/system/
systemctl daemon-reload
echo "installed; enable with: systemctl enable --now zoro-note.timer"
