#!/bin/sh
set -eu
if [ "$#" -ne 0 ]; then
  printf 'The manager console accepts no arguments.\n' >&2
  exit 64
fi
exec /usr/bin/sudo -n /usr/local/libexec/hermes-manager-console
