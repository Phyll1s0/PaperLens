#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CACHE_DIR="$ROOT_DIR/.cache"
PID_FILE="$CACHE_DIR/paperlens.pid"
LOG_FILE="$CACHE_DIR/paperlens.log"

if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT_DIR/.env"
  set +a
fi

is_running() {
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

start_service() {
  mkdir -p "$CACHE_DIR"
  if is_running; then
    echo "PaperLens is already running with PID $(cat "$PID_FILE")."
    exit 0
  fi

  cd "$ROOT_DIR"
  nohup npm start > "$LOG_FILE" 2>&1 &
  echo "$!" > "$PID_FILE"
  echo "PaperLens started with PID $(cat "$PID_FILE")."
  echo "Logs: $LOG_FILE"
}

stop_service() {
  if ! is_running; then
    echo "PaperLens is not running."
    rm -f "$PID_FILE"
    exit 0
  fi

  kill "$(cat "$PID_FILE")"
  rm -f "$PID_FILE"
  echo "PaperLens stopped."
}

status_service() {
  if is_running; then
    echo "PaperLens is running with PID $(cat "$PID_FILE")."
    exit 0
  fi

  echo "PaperLens is not running."
  exit 1
}

case "${1:-status}" in
  start)
    start_service
    ;;
  stop)
    stop_service
    ;;
  status)
    status_service
    ;;
  restart)
    stop_service || true
    start_service
    ;;
  *)
    echo "Usage: $0 {start|stop|status|restart}"
    exit 2
    ;;
esac
