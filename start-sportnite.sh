#!/usr/bin/env bash
# Launches SPORTNITE: starts the game server in the background (if it isn't already running)
# and opens the game in Chrome. Safe to double-click as many times as you like.
cd "$(dirname "$(readlink -f "$0")")"
export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH"
URL="http://localhost:5173/"
LOG="$HOME/.cache/sportnite-server.log"
mkdir -p "$(dirname "$LOG")"

if ! curl -s -o /dev/null "$URL"; then
  [ -d node_modules ] || npm install >>"$LOG" 2>&1
  nohup npx vite --port 5173 --strictPort >>"$LOG" 2>&1 &
  for i in $(seq 1 40); do curl -s -o /dev/null "$URL" && break; sleep 0.25; done
fi

if command -v google-chrome >/dev/null; then google-chrome --new-window "$URL" >/dev/null 2>&1 &
else xdg-open "$URL" >/dev/null 2>&1 & fi
