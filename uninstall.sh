#!/bin/sh
set -eu

INSTALL_BASE=${COLLAB_HOME:-$HOME/.collab}
CLI_DIR="$INSTALL_BASE/cli"
LOCAL_BIN_DIR="$HOME/.local/bin"
SYSTEM_BIN_DIR="/usr/local/bin"
PATH_MARKER='# collab-cli PATH configuration'
ASSUME_YES=0
WARNINGS=0
PATH_UPDATES=0

say() {
  printf '%s\n' "$*"
}

warn() {
  WARNINGS=$((WARNINGS + 1))
  printf 'Warning: %s\n' "$*" >&2
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF_USAGE'
Usage: uninstall.sh [--yes] [--help]

Completely remove collab-cli installed by install.sh.

Options:
  --yes     Skip confirmation prompt (required for non-interactive use)
  --help    Show this help message

Environment variables:
  COLLAB_HOME  Installation base path (default: ~/.collab)
EOF_USAGE
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --yes)
        ASSUME_YES=1
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

confirm_uninstall() {
  if [ "$ASSUME_YES" -eq 1 ]; then
    return 0
  fi

  if [ ! -r /dev/tty ] || [ ! -w /dev/tty ]; then
    die "Non-interactive mode requires --yes."
  fi

  printf "This will remove collab-cli from '%s' and clean PATH entries. Continue? [y/N] " "$CLI_DIR" > /dev/tty
  IFS= read -r reply < /dev/tty || reply=''

  case "$reply" in
    y|Y|yes|YES|Yes)
      return 0
      ;;
    *)
      say "Uninstall canceled."
      exit 0
      ;;
  esac
}

is_managed_symlink_target() {
  link_target=$1

  case "$link_target" in
    "$CLI_DIR/bin/collab"|*/.collab/cli/bin/collab)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

remove_managed_link() {
  link_path=$1

  if [ ! -L "$link_path" ]; then
    if [ -e "$link_path" ]; then
      say "Skipping unmanaged file at $link_path"
    fi
    return 0
  fi

  link_target=$(readlink "$link_path" 2>/dev/null || printf '')
  if ! is_managed_symlink_target "$link_target"; then
    say "Skipping unmanaged symlink: $link_path -> $link_target"
    return 0
  fi

  if rm -f "$link_path"; then
    say "Removed binary link: $link_path"
    return 0
  fi

  warn "Could not remove $link_path"
  return 1
}

cleanup_rc_file() {
  rc_file=$1

  if [ ! -f "$rc_file" ]; then
    return 0
  fi

  tmp_file=$(mktemp "${TMPDIR:-/tmp}/collab-uninstall.XXXXXX") || {
    warn "Could not allocate temp file for $rc_file"
    return 1
  }

  if ! awk \
    -v marker="$PATH_MARKER" \
    -v local_export="export PATH=\"$LOCAL_BIN_DIR:\$PATH\"" \
    -v system_export="export PATH=\"$SYSTEM_BIN_DIR:\$PATH\"" \
    -v local_fish_if="if not contains \"$LOCAL_BIN_DIR\" \$PATH" \
    -v system_fish_if="if not contains \"$SYSTEM_BIN_DIR\" \$PATH" '
BEGIN { state = "normal" }
{
  if (state == "fish") {
    if ($0 ~ /^[[:space:]]*end[[:space:]]*$/) {
      state = "normal"
    }
    next
  }

  if ($0 == marker) {
    state = "after_marker"
    next
  }

  if (state == "after_marker") {
    if ($0 == local_export || $0 == system_export) {
      state = "normal"
      next
    }
    if ($0 == local_fish_if || $0 == system_fish_if) {
      state = "fish"
      next
    }
    if ($0 ~ /^[[:space:]]*$/) {
      state = "normal"
      next
    }
    state = "normal"
  }

  print
}
END {
  if (state != "normal") {
    exit 1
  }
}
' "$rc_file" > "$tmp_file"; then
    rm -f "$tmp_file"
    warn "Could not parse PATH entries in $rc_file"
    return 1
  fi

  if cmp -s "$rc_file" "$tmp_file"; then
    rm -f "$tmp_file"
    return 0
  fi

  if [ -L "$rc_file" ]; then
    if cat "$tmp_file" > "$rc_file"; then
      rm -f "$tmp_file"
      PATH_UPDATES=$((PATH_UPDATES + 1))
      say "Cleaned PATH entries in $rc_file"
      return 0
    fi
  elif mv "$tmp_file" "$rc_file"; then
    PATH_UPDATES=$((PATH_UPDATES + 1))
    say "Cleaned PATH entries in $rc_file"
    return 0
  fi

  rm -f "$tmp_file"
  warn "Could not update $rc_file"
  return 1
}

cleanup_path_entries() {
  cleanup_rc_file "$HOME/.zshrc" || true
  cleanup_rc_file "$HOME/.bashrc" || true
  cleanup_rc_file "$HOME/.bash_profile" || true
  cleanup_rc_file "$HOME/.config/fish/config.fish" || true
}

remove_installation_directory() {
  if [ ! -e "$CLI_DIR" ]; then
    say "Installation directory not found: $CLI_DIR"
    return 0
  fi

  if rm -rf "$CLI_DIR"; then
    say "Removed installation directory: $CLI_DIR"
  else
    warn "Could not remove installation directory: $CLI_DIR"
    return 1
  fi

  rmdir "$INSTALL_BASE" 2>/dev/null || true
}

main() {
  parse_args "$@"

  say "Starting collab-cli uninstall"
  confirm_uninstall

  remove_managed_link "$LOCAL_BIN_DIR/collab" || true
  remove_managed_link "$SYSTEM_BIN_DIR/collab" || true
  remove_installation_directory || true
  cleanup_path_entries

  if [ "$PATH_UPDATES" -gt 0 ]; then
    say "Updated PATH configuration in $PATH_UPDATES shell file(s)."
  else
    say "No managed PATH entries were found."
  fi

  if [ "$WARNINGS" -gt 0 ]; then
    say "Uninstall completed with $WARNINGS warning(s)."
    say "Manual check: ensure '$LOCAL_BIN_DIR' or '$SYSTEM_BIN_DIR' is removed from PATH if you added it manually."
    exit 1
  fi

  say "Uninstall complete. Open a new terminal or source your shell rc file before running 'collab'."
}

main "$@"
