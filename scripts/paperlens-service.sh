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

PORT="${PORT:-${PAPERLENS_PORT:-3000}}"
HOST="${HOST:-127.0.0.1}"
export PORT HOST

read_pid_file() {
  [ -f "$PID_FILE" ] || return 1
  pid=$(cat "$PID_FILE" 2>/dev/null || true)
  case "$pid" in
    ""|*[!0-9]*)
      return 1
      ;;
  esac
  printf '%s\n' "$pid"
}

is_pid_running() {
  pid="$1"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

pid_from_port() {
  command -v lsof >/dev/null 2>&1 || return 1
  pid=$(lsof -tiTCP:"$PORT" -sTCP:LISTEN -n -P 2>/dev/null | sed -n '1p' || true)
  [ -n "$pid" ] || return 1
  printf '%s\n' "$pid"
}

health_ok() {
  node <<'NODE'
const http = require("node:http");
const port = Number(process.env.PORT || 3000);
const host = !process.env.HOST || process.env.HOST === "0.0.0.0"
  ? "127.0.0.1"
  : process.env.HOST;
const request = http.get({
  hostname: host,
  port,
  path: "/api/health",
  timeout: 900,
}, (response) => {
  let body = "";
  response.setEncoding("utf8");
  response.on("data", (chunk) => {
    body += chunk;
  });
  response.on("end", () => {
    try {
      const payload = JSON.parse(body);
      process.exit(response.statusCode === 200 && payload && payload.ok ? 0 : 1);
    } catch {
      process.exit(1);
    }
  });
});
request.on("timeout", () => request.destroy());
request.on("error", () => process.exit(1));
NODE
}

find_service_pid() {
  if health_ok; then
    if pid=$(pid_from_port); then
      mkdir -p "$CACHE_DIR"
      printf '%s\n' "$pid" > "$PID_FILE"
      printf '%s\n' "$pid"
      return 0
    fi

    if pid=$(read_pid_file) && is_pid_running "$pid"; then
      printf '%s\n' "$pid"
      return 0
    fi
  fi

  rm -f "$PID_FILE"
  return 1
}

wait_for_service_pid() {
  attempts=0
  while [ "$attempts" -lt 12 ]; do
    if pid=$(find_service_pid); then
      printf '%s\n' "$pid"
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 1
  done

  return 1
}

start_service() {
  mkdir -p "$CACHE_DIR"
  if pid=$(find_service_pid); then
    echo "PaperLens is already running with PID $pid on port $PORT."
    exit 0
  fi

  cd "$ROOT_DIR"
  nohup npm start > "$LOG_FILE" 2>&1 &
  launcher_pid="$!"
  echo "$launcher_pid" > "$PID_FILE"
  if pid=$(wait_for_service_pid); then
    echo "PaperLens started with PID $pid on port $PORT."
  else
    echo "PaperLens start requested with launcher PID $launcher_pid, but health check is not ready yet."
  fi
  echo "Logs: $LOG_FILE"
}

stop_service() {
  if ! pid=$(find_service_pid); then
    echo "PaperLens is not running."
    rm -f "$PID_FILE"
    exit 0
  fi

  kill "$pid"
  rm -f "$PID_FILE"
  echo "PaperLens stopped."
}

status_service() {
  if pid=$(find_service_pid); then
    echo "PaperLens is running with PID $pid on port $PORT."
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
