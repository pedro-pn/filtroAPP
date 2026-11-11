#!/usr/bin/env bash
set -euo pipefail

# Azure's resolver can time out for Ubuntu mirrors while other domains still work.
# Keep the runner's DNS configuration whenever it can resolve the package mirror.
if timeout 5 getent ahostsv4 archive.ubuntu.com >/dev/null; then
  exit 0
fi

runner_interface=$(ip -4 route show default | awk '/^default/ { print $5; exit }')
if [[ -z "$runner_interface" ]]; then
  echo 'Cannot find the runner network interface for the Ubuntu DNS fallback.' >&2
  exit 1
fi

echo 'Ubuntu mirror DNS timed out; using the public resolver for this CI runner.'
sudo resolvectl dns "$runner_interface" 1.1.1.1
sudo resolvectl flush-caches
timeout 10 getent ahostsv4 archive.ubuntu.com >/dev/null
