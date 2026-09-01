#!/usr/bin/env bash
#
# Smoke-тест после деплоя Clarity Space.
#
# Проверяет не только HTTP-код, но и содержимое ответа. Причина: nginx
# проксирует на API только `location /v1/` — запросы к /health и /mcp,
# если маршрут не настроен, проваливаются в SPA-фолбэк и получают
# HTTP 200 с HTML-страницей фронтенда. Проверка «код == 200» такое
# не отличит от настоящего ответа API и покажет ложно-зелёный результат.
# Поэтому каждая проверка ниже смотрит на форму тела ответа, а не только
# на код.
#
# Использование:
#   ./scripts/smoke.sh                                   # прод (по умолчанию)
#   BASE=http://localhost:3001 ./scripts/smoke.sh         # локальный API
#   MCP_TOKEN=cs_xxx ./scripts/smoke.sh                   # + проверка MCP tools/list с токеном
#
# Код возврата: 0, если все проверки прошли; 1, если хотя бы одна провалилась.

set -uo pipefail

BASE="${BASE:-https://clarity-space.ru}"
BASE="${BASE%/}"
MCP_TOKEN="${MCP_TOKEN:-}"

fail=0
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

pass()    { printf '  ok     %-24s %s\n' "$1" "$2"; }
problem() { printf '  ПРОВАЛ %-24s %s\n' "$1" "$2"; fail=1; }
skip()    { printf '  ...    %-24s %s\n' "$1" "$2"; }

# curl_get URL OUTFILE -> печатает "HTTP_CODE|CONTENT_TYPE" в stdout,
# тело ответа пишет в OUTFILE. Никогда не падает и не оставляет пустой вывод —
# при сбое соединения печатает "000|-".
curl_get() {
  local url="$1" out="$2" w
  w="$(curl -sS -o "$out" -w '%{http_code}|%{content_type}' --max-time 10 "$url" 2>/dev/null)"
  if [ -z "$w" ]; then echo "000|-"; else echo "$w"; fi
}

# curl_post URL OUTFILE JSON_BODY [BEARER_TOKEN] -> тот же формат вывода, что и curl_get.
curl_post() {
  local url="$1" out="$2" body="$3" token="${4:-}" w
  if [ -n "$token" ]; then
    w="$(curl -sS -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $token" \
      -d "$body" -o "$out" -w '%{http_code}|%{content_type}' --max-time 10 "$url" 2>/dev/null)"
  else
    w="$(curl -sS -X POST -H 'Content-Type: application/json' \
      -d "$body" -o "$out" -w '%{http_code}|%{content_type}' --max-time 10 "$url" 2>/dev/null)"
  fi
  if [ -z "$w" ]; then echo "000|-"; else echo "$w"; fi
}

echo "Проверка $BASE"
echo

# ---------------------------------------------------------------------------
# /health — должен быть JSON с полем status и массивом checks, не HTML.
# ---------------------------------------------------------------------------
echo "-- /health --"
out="$tmp/health.json"
resp="$(curl_get "$BASE/health" "$out")"
code="${resp%%|*}"
if python3 - "$out" "$code" <<'PY'
import json, sys
path, code = sys.argv[1], sys.argv[2]
try:
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
except Exception as e:
    print(f"  ПРОВАЛ health                    тело не JSON ({e}), код {code} — похоже, ответила SPA, а не API")
    sys.exit(1)

if not isinstance(data, dict) or 'status' not in data or not isinstance(data.get('checks'), list) or not data['checks']:
    print(f"  ПРОВАЛ health                    JSON есть, но нет ожидаемой формы (status/checks), код {code}: {data!r}")
    sys.exit(1)

status = data['status']
print(f"  ok     health                    код {code}, общий статус: {status}")
print("  Статус зависимостей:")
for c in data['checks']:
    mark = 'ok  ' if c.get('ok') else 'СБОЙ'
    name = c.get('name', '?')
    detail = c.get('detail', '')
    line = f"    {mark} {name}"
    if detail:
        line += f" — {detail}"
    print(line)

if status == 'down':
    print("  ПРОВАЛ health                    общий статус down — критичная зависимость недоступна")
    sys.exit(1)
sys.exit(0)
PY
then :; else fail=1; fi
echo

# ---------------------------------------------------------------------------
# /v1/openapi.yaml — должен быть YAML, начинающийся с "openapi: 3.1", не HTML.
# ---------------------------------------------------------------------------
echo "-- /v1/openapi.yaml --"
out="$tmp/openapi.txt"
resp="$(curl_get "$BASE/v1/openapi.yaml" "$out")"
code="${resp%%|*}"
ctype="${resp##*|}"
first_line="$(head -n1 "$out" 2>/dev/null || true)"
if [ "$code" = "200" ] && printf '%s' "$first_line" | grep -q '^openapi: 3\.1' && ! printf '%s' "$ctype" | grep -qi 'text/html'; then
  pass "openapi.yaml" "код 200, content-type $ctype, начинается с «$first_line»"
else
  short="$(printf '%s' "$first_line" | cut -c1-60)"
  problem "openapi.yaml" "ожидали YAML «openapi: 3.1...», получили код $code, content-type $ctype, начало тела: «$short»"
fi
echo

# ---------------------------------------------------------------------------
# /v1/docs — Swagger UI (легитимный HTML, но со своим узнаваемым маркером).
# ---------------------------------------------------------------------------
echo "-- /v1/docs --"
out="$tmp/docs.html"
resp="$(curl_get "$BASE/v1/docs" "$out")"
code="${resp%%|*}"
ctype="${resp##*|}"
if [ "$code" = "200" ] && grep -q 'id="swagger-ui"' "$out" 2>/dev/null; then
  pass "docs (Swagger UI)" "код 200, найден маркер id=\"swagger-ui\""
else
  problem "docs (Swagger UI)" "ожидали HTML со Swagger UI (id=\"swagger-ui\"), получили код $code, content-type $ctype — возможно, отдалась SPA"
fi
echo

# ---------------------------------------------------------------------------
# / — сама SPA, которая легитимно является HTML. Проверяем корневой div,
# чтобы отличить настоящую сборку фронтенда от произвольной HTML-заглушки.
# ---------------------------------------------------------------------------
echo "-- / (SPA) --"
out="$tmp/spa.html"
resp="$(curl_get "$BASE/" "$out")"
code="${resp%%|*}"
if [ "$code" = "200" ] && grep -q 'id="root"' "$out" 2>/dev/null; then
  pass "SPA" "код 200, найден корневой <div id=\"root\">"
else
  problem "SPA" "ожидали HTML SPA (<div id=\"root\">), получили код $code"
fi
echo

# ---------------------------------------------------------------------------
# POST /mcp без токена — должен быть 401 от API с JSON-ошибкой, не 200 от SPA.
# ---------------------------------------------------------------------------
echo "-- POST /mcp без токена --"
out="$tmp/mcp_noauth.json"
resp="$(curl_post "$BASE/mcp" "$out" '{"jsonrpc":"2.0","id":1,"method":"initialize"}')"
code="${resp%%|*}"
ctype="${resp##*|}"
if python3 - "$out" "$code" "$ctype" <<'PY'
import json, sys
path, code, ctype = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    is_error_shape = isinstance(data, dict) and ('error' in data or data.get('success') is False)
except Exception:
    is_error_shape = False

if code == '401' and is_error_shape:
    print("  ok     mcp без токена           код 401, тело — JSON-ошибка авторизации (не HTML от SPA)")
    sys.exit(0)
print(f"  ПРОВАЛ mcp без токена           ожидали 401 + JSON-ошибку авторизации, получили код {code}, content-type {ctype} — похоже на SPA-фолбэк")
sys.exit(1)
PY
then :; else fail=1; fi
echo

# ---------------------------------------------------------------------------
# POST /mcp с токеном (tools/list) — только если задан MCP_TOKEN.
# ---------------------------------------------------------------------------
echo "-- POST /mcp с токеном (tools/list) --"
if [ -z "$MCP_TOKEN" ]; then
  skip "mcp tools/list" "переменная MCP_TOKEN не задана — проверка пропущена (задайте MCP_TOKEN=cs_... или JWT для запуска)"
else
  out="$tmp/mcp_tools.json"
  resp="$(curl_post "$BASE/mcp" "$out" '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "$MCP_TOKEN")"
  code="${resp%%|*}"
  ctype="${resp##*|}"
  if python3 - "$out" "$code" "$ctype" <<'PY'
import json, sys
path, code, ctype = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    tools = data.get('result', {}).get('tools')
    ok = isinstance(tools, list) and len(tools) > 0
except Exception:
    tools, ok = None, False

if code == '200' and ok:
    names = ', '.join(t.get('name', '?') for t in tools)
    print(f"  ok     mcp tools/list           код 200, инструментов: {len(tools)} ({names})")
    sys.exit(0)
print(f"  ПРОВАЛ mcp tools/list           ожидали 200 + непустой result.tools, получили код {code}, content-type {ctype} — проверьте MCP_TOKEN")
sys.exit(1)
PY
  then :; else fail=1; fi
fi
echo

if [ "$fail" = 0 ]; then
  echo "Всё зелёное."
else
  echo "Есть провалы — см. «ПРОВАЛ» выше."
fi
exit "$fail"
