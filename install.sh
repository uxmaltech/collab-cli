#!/bin/sh
set -eu

REPO_URL=${COLLAB_REPO_URL:-https://github.com/uxmaltech/collab-cli.git}
INSTALL_BASE=${COLLAB_HOME:-$HOME/.collab}
CLI_DIR="$INSTALL_BASE/cli"
LOCAL_BIN_DIR="$HOME/.local/bin"
HOMEBREW_BIN_DIR="/opt/homebrew/bin"
SYSTEM_BIN_DIR="/usr/local/bin"
MIN_NODE_MAJOR=20
MODE=install
PATH_PROMPT_MODE=${COLLAB_INSTALL_PATH_PROMPT:-auto}

say() {
  printf '%s\n' "$*"
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: install.sh [--update] [--help]

Install collab-cli from uxmaltech/collab-cli main branch.

Options:
  --update  Update an existing installation in ~/.collab/cli
  --help    Show this help message
EOF
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --update)
        MODE=update
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Unknown option: $1 (use --help)"
        ;;
    esac
    shift
  done
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

  case "$os_name/$arch_name" in
    Darwin/arm64|Darwin/x86_64|Linux/x86_64|Linux/amd64) ;;
    *)
      die "Unsupported platform: $os_name/$arch_name (supported: macOS arm64/x86_64, Linux x86_64)"
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

ensure_clean_checkout() {
  if [ -n "$(git -C "$CLI_DIR" status --porcelain 2>/dev/null)" ]; then
    die "Local changes detected in $CLI_DIR. Commit/stash or reset before update."
  fi
}

path_contains_dir() {
  dir=$1
  case ":$PATH:" in
    *":$dir:"*) return 0 ;;
    *) return 1 ;;
  esac
}

is_writable_directory() {
  dir=$1
  [ -d "$dir" ] && [ -w "$dir" ]
}

resolve_bin_dir() {
  local_bin_ready=0
  if [ -d "$LOCAL_BIN_DIR" ] && [ -w "$LOCAL_BIN_DIR" ]; then
    local_bin_ready=1
  elif mkdir -p "$LOCAL_BIN_DIR" 2>/dev/null; then
    local_bin_ready=1
  fi

  if [ "$local_bin_ready" -eq 1 ] && path_contains_dir "$LOCAL_BIN_DIR"; then
    BIN_DIR=$LOCAL_BIN_DIR
    return
  fi

  if is_writable_directory "$HOMEBREW_BIN_DIR" && path_contains_dir "$HOMEBREW_BIN_DIR"; then
    BIN_DIR=$HOMEBREW_BIN_DIR
    return
  fi

  if is_writable_directory "$SYSTEM_BIN_DIR" && path_contains_dir "$SYSTEM_BIN_DIR"; then
    BIN_DIR=$SYSTEM_BIN_DIR
    return
  fi

  if [ "$local_bin_ready" -eq 1 ]; then
    BIN_DIR=$LOCAL_BIN_DIR
    return
  fi

  if is_writable_directory "$HOMEBREW_BIN_DIR"; then
    BIN_DIR=$HOMEBREW_BIN_DIR
    return
  fi

  if is_writable_directory "$SYSTEM_BIN_DIR"; then
    BIN_DIR=$SYSTEM_BIN_DIR
    return
  fi

  die "Cannot create '$LOCAL_BIN_DIR', and '$HOMEBREW_BIN_DIR'/'$SYSTEM_BIN_DIR' are not writable."
}

sync_repo() {
  if [ "$MODE" = update ]; then
    [ -d "$CLI_DIR/.git" ] || die "No existing installation found at $CLI_DIR for --update."
    ensure_clean_checkout
    say "Updating existing installation in $CLI_DIR from origin/main"
    git -C "$CLI_DIR" fetch origin main
    git -C "$CLI_DIR" checkout main
    git -C "$CLI_DIR" pull --ff-only origin main
    return
  fi

  if [ -d "$CLI_DIR/.git" ]; then
    ensure_clean_checkout
    say "Existing installation found in $CLI_DIR; refreshing from origin/main"
    git -C "$CLI_DIR" fetch origin main
    git -C "$CLI_DIR" checkout main
    git -C "$CLI_DIR" pull --ff-only origin main
    return
  fi

  if [ -e "$CLI_DIR" ]; then
    die "Path exists but is not a git checkout: $CLI_DIR"
  fi

  say "Cloning repository main branch into $CLI_DIR"
  mkdir -p "$INSTALL_BASE"
  git clone --branch main --single-branch "$REPO_URL" "$CLI_DIR"
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
      maybe_offer_path_update
      ;;
  esac
}

detect_shell_name() {
  if [ -n "${COLLAB_SHELL:-}" ]; then
    shell_path=$COLLAB_SHELL
  elif [ -n "${SHELL:-}" ]; then
    shell_path=$SHELL
  else
    shell_path=sh
  fi

  shell_name=$(basename "$shell_path")
  case "$shell_name" in
    zsh|bash|fish)
      printf '%s' "$shell_name"
      ;;
    *)
      printf 'unknown'
      ;;
  esac
}

resolve_shell_rc_file() {
  shell_name=$1

  case "$shell_name" in
    zsh)
      printf '%s/.zshrc' "$HOME"
      ;;
    bash)
      if [ -f "$HOME/.bashrc" ]; then
        printf '%s/.bashrc' "$HOME"
      elif [ -f "$HOME/.bash_profile" ]; then
        printf '%s/.bash_profile' "$HOME"
      elif [ "${os_name:-}" = "Darwin" ]; then
        printf '%s/.bash_profile' "$HOME"
      else
        printf '%s/.bashrc' "$HOME"
      fi
      ;;
    fish)
      printf '%s/.config/fish/config.fish' "$HOME"
      ;;
    *)
      printf ''
      ;;
  esac
}

append_path_block_if_missing() {
  shell_name=$1
  rc_file=$2

  case "$shell_name" in
    zsh|bash)
      marker='# collab-cli PATH configuration'
      entry="export PATH=\"$BIN_DIR:\$PATH\""
      if [ -f "$rc_file" ] && grep -F "$entry" "$rc_file" >/dev/null 2>&1; then
        return 0
      fi

      if ! {
        printf '\n%s\n' "$marker"
        printf '%s\n' "$entry"
      } >> "$rc_file"; then
        return 1
      fi
      return 0
      ;;
    fish)
      if [ -f "$rc_file" ] && grep -F "set -gx PATH \"$BIN_DIR\" \$PATH" "$rc_file" >/dev/null 2>&1; then
        return 0
      fi

      if ! mkdir -p "$(dirname "$rc_file")"; then
        return 1
      fi

      if ! {
        printf '\n# collab-cli PATH configuration\n'
        printf 'if not contains "%s" $PATH\n' "$BIN_DIR"
        printf '  set -gx PATH "%s" $PATH\n' "$BIN_DIR"
        printf 'end\n'
      } >> "$rc_file"; then
        return 1
      fi
      return 0
      ;;
  esac

  return 1
}

print_manual_path_snippet() {
  shell_name=$1

  case "$shell_name" in
    fish)
      say "Manual PATH snippet: set -gx PATH \"$BIN_DIR\" \$PATH"
      ;;
    *)
      say "Manual PATH snippet: export PATH=\"$BIN_DIR:\$PATH\""
      ;;
  esac
}

path_prompt_enabled() {
  case "$PATH_PROMPT_MODE" in
    always)
      return 0
      ;;
    never)
      return 1
      ;;
    auto|'')
      [ -t 1 ] && [ -r /dev/tty ]
      return $?
      ;;
    *)
      return 1
      ;;
  esac
}

read_prompt_reply() {
  if [ -r /dev/tty ]; then
    IFS= read -r reply < /dev/tty || reply=''
  else
    reply=''
  fi
}

refresh_path_for_installer_process() {
  shell_name=$1
  rc_file=$2

  case "$shell_name" in
    zsh|bash)
      if [ -r "$rc_file" ]; then
        # shellcheck disable=SC1090
        if . "$rc_file" >/dev/null 2>&1; then
          hash -r 2>/dev/null || true
          return 0
        fi
      fi
      ;;
  esac

  PATH="$BIN_DIR:$PATH"
  export PATH
  hash -r 2>/dev/null || true
  return 0
}

maybe_offer_path_update() {
  shell_name=$(detect_shell_name)
  rc_file=$(resolve_shell_rc_file "$shell_name")

  if [ -z "$rc_file" ]; then
    say "Add '$BIN_DIR' to your PATH to call 'collab' globally."
    return
  fi

  if ! path_prompt_enabled; then
    say "Add '$BIN_DIR' to your PATH to call 'collab' globally."
    return
  fi

  if [ ! -r /dev/tty ]; then
    say "Add '$BIN_DIR' to your PATH to call 'collab' globally."
    return
  fi

  printf "Add '%s' to your PATH in %s now? [y/N] " "$BIN_DIR" "$rc_file" > /dev/tty
  read_prompt_reply

  case "$reply" in
    y|Y|yes|YES|Yes)
      if append_path_block_if_missing "$shell_name" "$rc_file"; then
        say "PATH configuration updated in $rc_file"
        refresh_path_for_installer_process "$shell_name" "$rc_file" || true
        say "Run 'source $rc_file' in your current terminal (or open a new one), then run 'collab --help'."
      else
        say "Could not update $rc_file automatically (permission or write error)."
        print_manual_path_snippet "$shell_name"
      fi
      ;;
    *)
      say "Skipped PATH update. Add '$BIN_DIR' to your PATH to call 'collab' globally."
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
  parse_args "$@"

  say "Starting collab-cli installation"
  detect_platform

  require_cmd git
  require_cmd node
  require_cmd npm
  check_node_version

  resolve_bin_dir
  say "Using binary directory: $BIN_DIR"
  say "Mode: $MODE"

  sync_repo
  build_cli
  link_binary
  verify_install
  print_path_hint

  say "Done. Run: collab --help"
}

main "$@"
