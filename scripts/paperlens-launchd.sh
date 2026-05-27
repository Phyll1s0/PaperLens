#!/usr/bin/env sh
set -eu

LABEL="com.phyll1s0.paperlens"
ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE_BIN=$(command -v node)
USER_ID=$(id -u)

install_service() {
  mkdir -p "$HOME/Library/LaunchAgents" "$ROOT_DIR/.cache"
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
