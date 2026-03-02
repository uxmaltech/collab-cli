#!/bin/sh
set -eu

REPO_URL=${COLLAB_REPO_URL:-https://github.com/uxmaltech/collab-cli.git}
INSTALL_BASE=${COLLAB_HOME:-$HOME/.collab}
CLI_DIR="$INSTALL_BASE/cli"
LOCAL_BIN_DIR="$HOME/.local/bin"
SYSTEM_BIN_DIR="/usr/local/bin"
MIN_NODE_MAJOR=20

say() {
  printf '%s\n' "$*"
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    die "Missing prerequisite: $1"
  fi
}

detect_platform() {
  os_name=$(uname -s 2>/dev/null || printf 'unknown')
  arch_name=$(uname -m 2>/dev/null || printf 'unknown')

  case "$os_name" in
    Darwin|Linux) ;;
    *) die "Unsupported operating system: $os_name" ;;
  esac

  case "$arch_name" in
    arm64|aarch64|x86_64|amd64) ;;
    *)
      say "Warning: architecture '$arch_name' is not officially validated yet."
      ;;
  esac

  say "Detected platform: $os_name/$arch_name"
}

check_node_version() {
  node_major=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || printf '0')

  case "$node_major" in
    ''|*[!0-9]*) die "Unable to read Node.js major version." ;;
  esac

  if [ "$node_major" -lt "$MIN_NODE_MAJOR" ]; then
    die "Node.js >= $MIN_NODE_MAJOR is required. Found: $(node -v)"
  fi

  say "Node.js version: $(node -v)"
}

resolve_bin_dir() {
  if mkdir -p "$LOCAL_BIN_DIR" 2>/dev/null; then
    BIN_DIR=$LOCAL_BIN_DIR
    return
  fi

  if [ -d "$SYSTEM_BIN_DIR" ] && [ -w "$SYSTEM_BIN_DIR" ]; then
    BIN_DIR=$SYSTEM_BIN_DIR
    return
  fi

  die "Cannot create '$LOCAL_BIN_DIR' and '$SYSTEM_BIN_DIR' is not writable."
}

sync_repo() {
  if [ -d "$CLI_DIR/.git" ]; then
    say "Updating existing installation in $CLI_DIR"
    git -C "$CLI_DIR" pull --ff-only origin main
    return
  fi

  if [ -e "$CLI_DIR" ]; then
    die "Path exists but is not a git checkout: $CLI_DIR"
  fi

  say "Cloning repository into $CLI_DIR"
  mkdir -p "$INSTALL_BASE"
  git clone "$REPO_URL" "$CLI_DIR"
}

build_cli() {
  say "Installing dependencies"
  (cd "$CLI_DIR" && npm install)

  say "Building project"
  (cd "$CLI_DIR" && npm run build)
}

link_binary() {
  target="$CLI_DIR/bin/collab"
  link_path="$BIN_DIR/collab"

  [ -f "$target" ] || die "Missing binary target: $target"
  chmod +x "$target"

  say "Creating symlink: $link_path -> $target"
  ln -sf "$target" "$link_path"
}

print_path_hint() {
  case ":$PATH:" in
    *":$BIN_DIR:"*)
      say "PATH already includes $BIN_DIR"
      ;;
    *)
      say "Add '$BIN_DIR' to your PATH to call 'collab' globally."
      ;;
  esac
}

verify_install() {
  if "$BIN_DIR/collab" --help >/dev/null 2>&1; then
    say "Install successful: collab --help"
  else
    die "Installation completed but 'collab --help' failed."
  fi
}

main() {
  say "Starting collab-cli installation"
  detect_platform

  require_cmd git
  require_cmd node
  require_cmd npm
  check_node_version

  resolve_bin_dir
  say "Using binary directory: $BIN_DIR"

  sync_repo
  build_cli
  link_binary
  verify_install
  print_path_hint

  say "Done. Run: collab --help"
}

main "$@"
