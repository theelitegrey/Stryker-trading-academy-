#!/bin/sh
# Copies DISCORD_BOT_TOKEN / DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET from the server env file into GitHub repo secrets
# (never prints them), then starts the Worker deploy. Env file: /root/.config/tradezoro/discord.env (0600), lines KEY=value.
set -e
F="${1:-/root/.config/tradezoro/discord.env}"
[ -f "$F" ] || { echo "no env file at $F"; exit 1; }
for k in DISCORD_BOT_TOKEN DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET; do
  v=$(grep -E "^$k=" "$F" | head -1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//')
  [ -n "$v" ] || { echo "$k missing in $F"; exit 1; }
  printf '%s' "$v" | gh secret set "$k" --repo theelitegrey/Stryker-trading-academy- >/dev/null && echo "$k set"
done
gh workflow run deploy-discord-roles.yml --repo theelitegrey/Stryker-trading-academy- && echo "deploy started"
