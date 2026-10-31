#!/bin/bash
set -u
task_dir=$(cd -- "$(dirname -- "$0")/.." && pwd)
case "$task_dir" in /home/aiops/releases/echo-*) ;; *) exit 2 ;; esac
umask 077
sudo -n flock -n /var/lock/echo-release.lock /usr/bin/node "$task_dir/ops/deploy-echo.cjs" "$task_dir"
task_code=$?
if [ "$task_code" -ne 0 ] && [ ! -f "$task_dir/result.json" ]; then
  printf '{"id":"%s","status":"failed"}\n' "$(basename "$task_dir")" > "$task_dir/result.json"
fi
exit "$task_code"
