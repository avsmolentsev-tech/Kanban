#!/usr/bin/env bash
# Проверка стека Clarity Meet после развёртывания.
#
# Проверяет содержимое ответов, а не только коды: SPA отвечает 200 и HTML на
# любой путь, поэтому проверка «код 200» зелёная даже при полностью неверной
# маршрутизации. Ровно так уже пряталась поломка /health и /mcp в Clarity Space.
#
# Имена переменных латиницей намеренно: bash не принимает кириллицу в
# идентификаторах и молча ломается на каждой строке. Сообщения — русские.
#
# Запуск: ./scripts/meet-smoke.sh
#         BASE=https://meet.clarity-space.ru ./scripts/meet-smoke.sh
set -uo pipefail

BASE="${BASE:-https://meet.clarity-space.ru}"
LK="${LK:-https://livekit.clarity-space.ru}"
SERVER="${SERVER:-root@31.128.43.174}"
SSH_KEY="${SSH_KEY:-/root/.ssh/id_tochka_recovery}"
FAILED=0

pass() { printf '  ok     %-28s %s\n' "$1" "$2"; }
fail() { printf '  ПРОВАЛ %-26s %s\n' "$1" "$2"; FAILED=1; }

check_body() {
  local name="$1" url="$2" marker="$3" want="${4:-200}"
  local out code body
  out=$(curl -sS --max-time 20 -w $'\n%{http_code}' "$url" 2>/dev/null) || { fail "$name" "запрос не выполнился"; return; }
  code="${out##*$'\n'}"
  body="${out%$'\n'*}"
  if [ "$code" != "$want" ]; then
    fail "$name" "ожидали код $want, получили $code"
  elif ! printf '%s' "$body" | grep -qF "$marker"; then
    fail "$name" "код $code, но в теле нет «$marker» — ответил не тот сервис"
  else
    pass "$name" "код $code, найден маркер «$marker»"
  fi
}

echo "Проверка Clarity Meet: $BASE"
echo

echo "-- сигналинг LiveKit --"
check_body "livekit" "$LK/" "OK"

echo "-- интерфейс --"
check_body "SPA" "$BASE/" 'id="root"'

echo "-- API комнат --"
check_body "health" "$BASE/api/health" '"status":"ok"'

echo "-- несуществующая комната отвечает JSON, а не HTML от SPA --"
check_body "404 комнаты" "$BASE/api/rooms/aaa-bbb-ccc" '"error"' 404

echo "-- создание с чужим паролем сервиса отклоняется --"
out=$(curl -sS --max-time 20 -X POST "$BASE/api/rooms" -H 'Content-Type: application/json' \
  -d '{"title":"smoke","servicePassword":"zavedomo-nevernyj"}' -w $'\n%{http_code}' 2>/dev/null)
code="${out##*$'\n'}"
if [ "$code" = "401" ]; then pass "пароль сервиса" "код 401, чужой пароль отклонён"
else fail "пароль сервиса" "ожидали 401, получили $code"; fi

echo
echo "-- контейнеры и порты на сервере --"
if [ -r "$SSH_KEY" ]; then
  state=$(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=15 "$SERVER" \
    'docker inspect -f "{{.Name}} {{.State.Status}}" clarity-meet-livekit clarity-meet-egress clarity-meet-redis 2>/dev/null; ss -ulnp 2>/dev/null | grep -c ":7882"' 2>/dev/null)
  for c in clarity-meet-livekit clarity-meet-egress clarity-meet-redis; do
    if printf '%s' "$state" | grep -q "/$c running"; then pass "$c" "running"
    else fail "$c" "не running"; fi
  done
  udp=$(printf '%s' "$state" | tail -1)
  if [ "${udp:-0}" -gt 0 ] 2>/dev/null; then pass "медиа-порт 7882/udp" "слушается"
  else fail "медиа-порт 7882/udp" "не слушается"; fi

  echo
  echo "-- каталог записей доступен egress на запись --"
  if ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=15 "$SERVER" \
      'docker exec clarity-meet-egress sh -c "touch /out/.smoke && rm -f /out/.smoke"' >/dev/null 2>&1; then
    pass "права на /out" "контейнер может писать"
  else
    fail "права на /out" "egress не может писать — запись рапортует успех и не создаёт файл"
  fi
else
  printf '  ...    %-28s %s\n' "проверки на сервере" "ключ недоступен — пропущено"
fi

echo
echo "-- Clarity Space не пострадала --"
if [ -x ./scripts/smoke.sh ]; then
  if BASE=https://clarity-space.ru ./scripts/smoke.sh >/dev/null 2>&1; then pass "Clarity Space" "smoke зелёный"
  else fail "Clarity Space" "её собственный smoke красный"; fi
else
  printf '  ...    %-28s %s\n' "Clarity Space" "scripts/smoke.sh не найден — пропущено"
fi

echo
if [ "$FAILED" = 0 ]; then echo 'Всё зелёное.'; else echo 'Есть провалы.'; exit 1; fi
