#!/usr/bin/env bash
set -euo pipefail

SUBDOMAIN="${1:-echo.miningqwq.cn}"
ROOT_DOMAIN="${2:-miningqwq.cn}"
API_PATH="${3:-/api/music/search?q=%E6%99%B4%E5%A4%A9&page=1&pageSize=5}"

GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

ok() { echo -e "${GREEN}[OK]${RESET} $*"; }
warn() { echo -e "${YELLOW}[WARN]${RESET} $*"; }
err() { echo -e "${RED}[ERR]${RESET} $*"; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "缺少命令: $1"
    exit 1
  fi
}

require_cmd curl

echo "== 1) DNS 检查: ${SUBDOMAIN} =="
if command -v dig >/dev/null 2>&1; then
  DIG_RESULT="$(dig +short A "$SUBDOMAIN" | tr '\n' ' ' | xargs || true)"
  if [[ -n "${DIG_RESULT}" ]]; then
    ok "A 记录: ${DIG_RESULT}"
  else
    warn "未查到 A 记录，请等待 DNS 生效。"
  fi
else
  require_cmd nslookup
  nslookup "$SUBDOMAIN" || true
  warn "未安装 dig，已输出 nslookup 结果，请人工确认 IP。"
fi

echo
echo "== 2) HTTP/HTTPS 连通性检查 =="
HTTP_CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://${SUBDOMAIN}" || true)"
HTTPS_CODE="$(curl -s -o /dev/null -w '%{http_code}' "https://${SUBDOMAIN}" || true)"

if [[ "${HTTP_CODE}" =~ ^(200|301|302)$ ]]; then
  ok "http://${SUBDOMAIN} -> ${HTTP_CODE}"
else
  warn "http://${SUBDOMAIN} -> ${HTTP_CODE}（预期 200/301/302）"
fi

if [[ "${HTTPS_CODE}" =~ ^(200|301|302)$ ]]; then
  ok "https://${SUBDOMAIN} -> ${HTTPS_CODE}"
else
  err "https://${SUBDOMAIN} -> ${HTTPS_CODE}（预期 200/301/302）"
fi

echo
echo "== 3) BFF 接口检查 =="
API_URL="https://${SUBDOMAIN}${API_PATH}"
API_BODY="$(curl -sS "${API_URL}" || true)"
if echo "${API_BODY}" | grep -q '"code"[[:space:]]*:[[:space:]]*0'; then
  ok "接口可用: ${API_URL}"
else
  warn "接口返回未命中 code:0，请检查上游与 BFF。"
  echo "返回片段: ${API_BODY:0:240}"
fi

echo
echo "== 4) 主域名隔离检查 =="
ROOT_CODE="$(curl -s -o /dev/null -w '%{http_code}' "https://${ROOT_DOMAIN}" || true)"
ROOT_HEADER="$(curl -sI "https://${ROOT_DOMAIN}" | tr -d '\r' | head -n 15 || true)"

warn "请人工确认主域名未返回当前前端内容。"
echo "https://${ROOT_DOMAIN} -> ${ROOT_CODE}"
echo "${ROOT_HEADER}"

echo
ok "检查完成。若存在 WARN/ERR，请按 docs/echo-subdomain-deploy.md 排障。"
