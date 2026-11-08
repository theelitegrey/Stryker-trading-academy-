#!/bin/sh
# Install the Discord levels bot (run as root from the repo checkout). Does not create or print a secret.
# Before: create /etc/tradezoro/discord-levels.env (mode 0600) with two lines:
#   DISCORD_LEVELS_CHANNEL_ID=<channel id>
#   DISCORD_ENV_FILE=<path of the existing env file that holds DISCORD_BOT_TOKEN, e.g. /root/.config/tradezoro/discord.env>
# The bot must be in the server with Send Messages in that channel.
set -e
here=$(cd "$(dirname "$0")" && pwd)
test -f /etc/tradezoro/discord-levels.env || { echo "missing /etc/tradezoro/discord-levels.env (see the comments above)"; exit 1; }
install -d /opt/tradezoro/discord-levels
install -m 0755 "$here/post.py" /opt/tradezoro/discord-levels/post.py
install -m 0644 "$here/tradezoro-discord-levels@.service" /etc/systemd/system/
install -m 0644 "$here/tz-levels-morning.timer" "$here/tz-levels-prints.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now tz-levels-morning.timer tz-levels-prints.timer
systemctl list-timers 'tz-levels-*' --no-pager
echo "dry check:  python3 /opt/tradezoro/discord-levels/post.py morning --dry"
