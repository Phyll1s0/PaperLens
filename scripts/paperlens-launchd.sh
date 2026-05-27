#!/usr/bin/env sh
set -eu

LABEL="com.phyll1s0.paperlens"
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE_BIN=$(command -v node)
USER_ID=$(id -u)
SERVICE_PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.npm-global/bin"
PROXY_ENV_XML=""

xml_escape() {
  printf '%s' "$1" |
    sed \
      -e 's/&/\&amp;/g' \
      -e 's/</\&lt;/g' \
      -e 's/>/\&gt;/g' \
      -e 's/"/\&quot;/g' \
      -e "s/'/\&apos;/g"
}

add_proxy_env() {
  key="$1"
  value="$2"
  if [ -z "$value" ]; then
    return
  fi

  escaped_value=$(xml_escape "$value")
  PROXY_ENV_XML="$PROXY_ENV_XML
    <key>$key</key>
    <string>$escaped_value</string>"
}

install_service() {
  mkdir -p "$HOME/Library/LaunchAgents" "$ROOT_DIR/.cache"
  http_proxy_value="${HTTP_PROXY:-${http_proxy:-}}"
  https_proxy_value="${HTTPS_PROXY:-${https_proxy:-}}"
  all_proxy_value="${ALL_PROXY:-${all_proxy:-}}"
  no_proxy_value="${NO_PROXY:-${no_proxy:-}}"
  add_proxy_env "HTTP_PROXY" "$http_proxy_value"
  add_proxy_env "HTTPS_PROXY" "$https_proxy_value"
  add_proxy_env "ALL_PROXY" "$all_proxy_value"
  add_proxy_env "NO_PROXY" "$no_proxy_value"
  add_proxy_env "http_proxy" "$http_proxy_value"
  add_proxy_env "https_proxy" "$https_proxy_value"
  add_proxy_env "all_proxy" "$all_proxy_value"
  add_proxy_env "no_proxy" "$no_proxy_value"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>WorkingDirectory</key>
  <string>$ROOT_DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$ROOT_DIR/server.js</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOST</key>
    <string>127.0.0.1</string>
    <key>PORT</key>
    <string>3000</string>
    <key>PAPERLENS_PDF_ENGINE</key>
    <string>auto</string>
    <key>PATH</key>
    <string>$SERVICE_PATH</string>
$PROXY_ENV_XML
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$ROOT_DIR/.cache/paperlens.launchd.log</string>
  <key>StandardErrorPath</key>
  <string>$ROOT_DIR/.cache/paperlens.launchd.err.log</string>
</dict>
</plist>
EOF

  launchctl bootout "gui/$USER_ID" "$PLIST" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$USER_ID" "$PLIST"
  launchctl enable "gui/$USER_ID/$LABEL"
  launchctl kickstart -k "gui/$USER_ID/$LABEL"
  echo "PaperLens launchd service installed: $LABEL"
}

uninstall_service() {
  launchctl bootout "gui/$USER_ID" "$PLIST" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  echo "PaperLens launchd service removed: $LABEL"
}

status_service() {
  launchctl print "gui/$USER_ID/$LABEL"
}

case "${1:-status}" in
  install)
    install_service
    ;;
  uninstall)
    uninstall_service
    ;;
  restart)
    launchctl kickstart -k "gui/$USER_ID/$LABEL"
    ;;
  status)
    status_service
    ;;
  *)
    echo "Usage: $0 {install|uninstall|restart|status}"
    exit 2
    ;;
esac
