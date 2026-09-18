#!/usr/bin/env bash
# Stryker social automation: one-command install on a fresh Ubuntu/Debian VPS.
#
#   curl -fsSL https://raw.githubusercontent.com/theelitegrey/Stryker-trading-academy-/main/automation/install.sh | sudo bash
#
# What it does: installs Docker, clones the repo to /opt/stryker, creates
# .env with a generated admin password, points HTTPS at <server-ip>.sslip.io
# (no domain needed), starts everything, and prints the login. Run it again
# later to update. Set DOMAIN=social.example.com to use your own hostname.
set -euo pipefail

REPO="${REPO:-https://github.com/theelitegrey/Stryker-trading-academy-.git}"
BRANCH="${BRANCH:-main}"
DIR="${DIR:-/opt/stryker}"
WITH_CHATTERBOX="${WITH_CHATTERBOX:-yes}"

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Run with sudo."; exit 1; }

say "Installing Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
apt-get install -y -qq git curl >/dev/null 2>&1 || true

say "Fetching the code"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" checkout -q "$BRANCH" && git -C "$DIR" pull -q origin "$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR/automation"

IP="$(curl -fsS -4 https://api.ipify.org || curl -fsS -4 https://ifconfig.me || hostname -I | awk '{print $1}')"
HOST="${DOMAIN:-${IP}.sslip.io}"

if [ ! -f .env ]; then
  say "Creating .env"
  PASS="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20)"
  cat > .env <<ENV
PUBLIC_BASE_URL=https://${HOST}
PORT=8787
ADMIN_PASSWORD=${PASS}
DATA_DIR=/data
SITE_URL=https://strykertrading.com
ENV
  chmod 600 .env
else
  sed -i "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=https://${HOST}|" .env
fi
PASS="$(grep '^ADMIN_PASSWORD=' .env | cut -d= -f2-)"

say "Writing Caddyfile for ${HOST}"
cat > Caddyfile <<CADDY
${HOST} {
    encode gzip
    reverse_proxy app:8787
}
CADDY

mkdir -p data/music voices
COMPOSE_ARGS=""
if [ "$WITH_CHATTERBOX" != "yes" ]; then
  say "Starting without Chatterbox (Kokoro voice only)"
  COMPOSE_ARGS="--scale chatterbox=0"
fi

say "Building and starting (first time takes 10–20 minutes: the voice models download)"
docker compose up -d --build $COMPOSE_ARGS

say "Done"
cat <<MSG

  Open:      https://${HOST}
  User:      admin
  Password:  ${PASS}

  The password is in ${DIR}/automation/.env if you lose it.
  Next: follow GETTING-STARTED.md (the link is on the page) to connect the platforms.
  Logs:   cd ${DIR}/automation && docker compose logs -f app
  Update: sudo bash ${DIR}/automation/install.sh

MSG
