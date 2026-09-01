# Clarity Meet, этап 1: медиа-стек и живой звонок

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Два браузера с разных машин видят и слышат друг друга через наш LiveKit, а egress пишет дорожки на диск.

**Architecture:** LiveKit SFU и Egress поднимаются в докере на существующем сервере `31.128.43.174` (Beget, РФ). Сигналинг закрывается TLS через уже работающий на хосте nginx — отдельный Caddy из исходного рунбука не нужен, потому что nginx там и так обслуживает восемнадцать сайтов с сертификатами Let's Encrypt. Медиа идёт мимо всех прокси напрямую в SFU по UDP.

**Tech Stack:** LiveKit Server, LiveKit Egress, Docker Compose v5.4.0, nginx на хосте, certbot 2.9.0, livekit-cli для проверки.

**Spec:** `docs/superpowers/specs/2026-09-01-vks-conference-design.md`

## Global Constraints

- Сервер `31.128.43.174`, доступ по ключу `/root/.ssh/id_tochka_recovery`. Провайдер Beget, РФ.
- **Проверено 01.09.2026:** UDP на 7882 снаружи проходит; порты 7880, 7881, 7882 свободны; на диске 29 ГБ.
- Машина общая: восемь чужих продуктов плюс Clarity Space. Средняя нагрузка 0.26 на 4 ядрах, простой 91%, память 9.3 ГБ занято из 15, свободно 6.4 ГБ. **Память — узкое место, не процессор.**
- nginx на хосте обслуживает 18 сайтов. Любая правка конфига: сначала бэкап, потом `nginx -t`, перезагрузка только при успешной проверке.
- **Clarity Space не трогаем вообще.** Ни `/var/www/kanban-app`, ни её nginx-конфиг, ни её процесс PM2. Это отдельный сервис.
- Каталог стека: `/opt/clarity-meet/`.
- Домены: `meet.clarity-space.ru` — сервис, `livekit.clarity-space.ru` — сигналинг.
- Ключи LiveKit обязаны совпадать в трёх местах: конфиг SFU, конфиг egress, будущее приложение. Рассинхрон даёт молчаливый отказ авторизации.
- Все комментарии в конфигах и сообщения — на русском.
- **Проверять содержимое каждого файла после записи.** Конфиги пишутся heredoc'ами через ssh, где экранирование `$` и кавычек легко ломается. После каждого такого шага прочитать файл на сервере и убедиться, что переменные не подставились раньше времени и не осталось лишних обратных слэшей.
- Образы docker закреплять по версии, а не по `latest`.

---

## Предусловие: DNS (действие владельца, не исполнителя)

До Task 3 в DNS домена `clarity-space.ru` должны появиться две A-записи на `31.128.43.174`:

```
meet     A  31.128.43.174
livekit  A  31.128.43.174
```

Проверка готовности:

```bash
dig +short meet.clarity-space.ru
dig +short livekit.clarity-space.ru
```

Обе команды должны вернуть `31.128.43.174`. Задачи 1 и 2 выполняются без DNS, задача 3 — нет.

---

### Task 1: Каталог стека и ключи LiveKit

**Files:**
- Create: `/opt/clarity-meet/.env` (на сервере, в git не попадает)
- Create: `/opt/clarity-meet/livekit.yaml` (на сервере)
- Create: `infra/clarity-meet/livekit.yaml` (в репозитории, без ключей — образец)
- Create: `infra/clarity-meet/.env.example` (в репозитории)

**Interfaces:**
- Produces: пара `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`, которую потребляют задачи 2, 5 и весь будущий бэкенд.

- [ ] **Шаг 1: Создать каталог на сервере**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 'mkdir -p /opt/clarity-meet/recordings && ls -la /opt/clarity-meet'
```

Ожидаем: каталог создан, внутри `recordings`.

- [ ] **Шаг 2: Сгенерировать ключи**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 \
  'docker run --rm livekit/livekit-server generate-keys'
```

Вывод содержит `API Key` и `API Secret`. **Ключи никуда не печатать повторно и не коммитить.**

- [ ] **Шаг 3: Записать ключи в `.env` на сервере**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 'cat > /opt/clarity-meet/.env <<EOF
# Ключи LiveKit. Обязаны совпадать в конфиге SFU, конфиге egress и в приложении.
LIVEKIT_API_KEY=<ключ из шага 2>
LIVEKIT_API_SECRET=<секрет из шага 2>
EOF
chmod 600 /opt/clarity-meet/.env
ls -l /opt/clarity-meet/.env'
```

Ожидаем права `-rw-------`.

- [ ] **Шаг 4: Положить конфиг SFU на сервер**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 'cat > /opt/clarity-meet/livekit.yaml <<EOF
# LiveKit SFU, одноузловой режим. Redis не нужен: он требуется только для
# координации нескольких узлов, а у нас один.
port: 7880
rtc:
  # Один мультиплексированный UDP-порт, а НЕ диапазон. На диапазоне подписки
  # отваливаются с таймаутом, когда в комнате много ICE-пиров: каждый egress
  # заходит как отдельный участник.
  udp_port: 7882
  # Запасной путь, когда UDP у клиента закрыт.
  tcp_port: 7881
  # Обязательно на сервере: иначе SFU анонсирует внутренний адрес контейнера
  # и медиа не устанавливается.
  use_external_ip: true
logging:
  level: info
EOF
echo "конфиг записан"'
```

- [ ] **Шаг 5: Положить образцы в репозиторий**

Создать `infra/clarity-meet/livekit.yaml` — копию конфига из шага 4, и `infra/clarity-meet/.env.example`:

```
# Сгенерировать: docker run --rm livekit/livekit-server generate-keys
# Значения обязаны совпадать в конфиге SFU, конфиге egress и в приложении.
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

- [ ] **Шаг 6: Коммит**

```bash
git add infra/clarity-meet/livekit.yaml infra/clarity-meet/.env.example
git commit -m "infra(meet): конфиг LiveKit SFU и образец переменных окружения"
```

---

### Task 2: LiveKit SFU в докере

**Files:**
- Create: `/opt/clarity-meet/docker-compose.yml` (на сервере)
- Create: `infra/clarity-meet/docker-compose.yml` (в репозитории)

**Interfaces:**
- Consumes: `.env` и `livekit.yaml` из задачи 1.
- Produces: работающий SFU на `127.0.0.1:7880` (HTTP-сигналинг), `0.0.0.0:7881/tcp` и `0.0.0.0:7882/udp` (медиа); docker-сеть `clarity-meet_default`, по имени `livekit` его найдёт egress из задачи 5.

- [ ] **Шаг 0: Узнать актуальные теги образов и закрепить версии**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 \
  'docker pull livekit/livekit-server:latest && docker image inspect livekit/livekit-server:latest --format "{{index .RepoDigests 0}}" && docker run --rm livekit/livekit-server:latest --version'
```

Записать полученную версию и подставить её тегом вместо `latest` в шаге 1 — плавающий тег на проде недопустим. То же для `livekit/egress` в задаче 5.

- [ ] **Шаг 1: Написать compose-файл**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 'cat > /opt/clarity-meet/docker-compose.yml <<EOF
services:
  livekit:
    image: livekit/livekit-server:<тег из шага 0>
    container_name: clarity-meet-livekit
    restart: unless-stopped
    command: --config /etc/livekit.yaml
    environment:
      LIVEKIT_KEYS: "\\\${LIVEKIT_API_KEY}: \\\${LIVEKIT_API_SECRET}"
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro
    ports:
      # Сигналинг только на localhost: наружу его выводит nginx с TLS (задача 3).
      - "127.0.0.1:7880:7880"
      # Медиа идёт напрямую, мимо прокси.
      - "7881:7881"
      - "7882:7882/udp"
    # Машина общая с восемью чужими продуктами. Ограничение обязательно:
    # видеозвонок чувствителен к задержкам, и наоборот — SFU не должен
    # отобрать процессор у Clarity Space.
    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 2G
EOF
echo "compose записан"'
```

- [ ] **Шаг 2: Запустить**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 \
  'cd /opt/clarity-meet && docker compose up -d && sleep 5 && docker compose ps'
```

Ожидаем: контейнер `clarity-meet-livekit` в состоянии `running`.

- [ ] **Шаг 3: Проверить лог на старт**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 \
  'cd /opt/clarity-meet && docker compose logs livekit --tail 30'
```

Ожидаем строку вида `starting LiveKit server`. **Если в логе `could not determine external IP` или отсутствует внешний адрес — SFU анонсирует внутренний адрес, медиа не пойдёт.** В этом случае проверить `use_external_ip: true` в конфиге и переменную `HOST_IP`.

- [ ] **Шаг 4: Проверить, что сигналинг отвечает локально**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 \
  'curl -sS -o /dev/null -w "HTTP %{http_code}\n" --max-time 10 http://127.0.0.1:7880/'
```

Ожидаем `HTTP 200`. LiveKit отвечает `OK` на корень.

- [ ] **Шаг 5: Проверить, что порты слушаются**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 \
  'ss -tulnp | grep -E ":788[0-2]"'
```

Ожидаем три строки: 7880 на `127.0.0.1`, 7881 на `0.0.0.0` tcp, 7882 на `0.0.0.0` udp.

- [ ] **Шаг 6: Убедиться, что Clarity Space не пострадала**

```bash
BASE=https://clarity-space.ru ./scripts/smoke.sh
```

Ожидаем: всё зелёное. Это контрольная проверка после каждого изменения на сервере.

- [ ] **Шаг 7: Скопировать compose в репозиторий и закоммитить**

```bash
git add infra/clarity-meet/docker-compose.yml
git commit -m "infra(meet): LiveKit SFU в докере с ограничением ресурсов"
```

---

### Task 3: TLS для сигналинга через nginx

**Files:**
- Create: `/etc/nginx/sites-available/livekit.clarity-space.conf` (на сервере)
- Create: `infra/clarity-meet/nginx-livekit.conf` (в репозитории, образец)

**Interfaces:**
- Consumes: SFU на `127.0.0.1:7880` из задачи 2.
- Produces: `wss://livekit.clarity-space.ru` — публичный адрес сигналинга, который потребляют браузеры и задача 4.

**Предусловие:** A-запись `livekit.clarity-space.ru` → `31.128.43.174` уже создана и разрешается.

- [ ] **Шаг 1: Проверить DNS**

```bash
dig +short livekit.clarity-space.ru
```

Ожидаем `31.128.43.174`. Если пусто — остановиться, задача не может быть выполнена.

- [ ] **Шаг 2: Выпустить сертификат**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 \
  'certbot certonly --nginx -d livekit.clarity-space.ru --non-interactive --agree-tos -m admin@clarity-space.ru'
```

Ожидаем `Successfully received certificate`.

- [ ] **Шаг 3: Написать конфиг nginx**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 'cat > /etc/nginx/sites-available/livekit.clarity-space.conf <<EOF
# Сигналинг LiveKit. Медиа сюда НЕ идёт — оно летит напрямую в SFU по UDP 7882.
server {
    listen 80;
    server_name livekit.clarity-space.ru;
    server_tokens off;
    return 301 https://\\\$host\\\$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name livekit.clarity-space.ru;
    server_tokens off;

    ssl_certificate /etc/letsencrypt/live/livekit.clarity-space.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/livekit.clarity-space.ru/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://127.0.0.1:7880;
        proxy_http_version 1.1;
        # Без этих двух строк звонок «почти работает»: интерфейс поднимается,
        # камера включается, а участники друг друга не видят — сигналинг
        # не проходит.
        proxy_set_header Upgrade \\\$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        # Сигнальное соединение живёт всю встречу.
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF
echo "конфиг записан"'
```

- [ ] **Шаг 4: Включить, проверить, перезагрузить**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 'set -e
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p /root/backups
ln -sf /etc/nginx/sites-available/livekit.clarity-space.conf /etc/nginx/sites-enabled/livekit.clarity-space.conf
if nginx -t 2>&1; then
  systemctl reload nginx
  echo "OK: конфиг проверен, nginx перезагружен"
else
  rm -f /etc/nginx/sites-enabled/livekit.clarity-space.conf
  echo "ОТКАТ: проверка не прошла, символическая ссылка удалена"
  exit 1
fi'
```

- [ ] **Шаг 5: Проверить снаружи**

```bash
curl -sS -o /dev/null -w "HTTP %{http_code}\n" --max-time 15 https://livekit.clarity-space.ru/
```

Ожидаем `HTTP 200`. Если приходит HTML — значит запрос попал не туда.

- [ ] **Шаг 6: Проверить, что Clarity Space жива**

```bash
BASE=https://clarity-space.ru ./scripts/smoke.sh
```

Ожидаем: всё зелёное.

- [ ] **Шаг 7: Коммит образца**

```bash
git add infra/clarity-meet/nginx-livekit.conf
git commit -m "infra(meet): TLS-прокси сигналинга LiveKit на nginx"
```

---

### Task 4: Живой звонок двумя браузерами

Это критерий приёмки всего этапа. Своего фронтенда ещё нет, поэтому проверяем официальным тестовым клиентом LiveKit — он умеет подключаться к произвольному серверу по токену.

**Files:** ничего не создаётся, это проверка.

**Interfaces:**
- Consumes: `wss://livekit.clarity-space.ru` из задачи 3, ключи из задачи 1.

- [ ] **Шаг 1: Установить livekit-cli на сервер**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 \
  'curl -sSL https://get.livekit.io/cli | bash && lk --version'
```

Ожидаем версию.

- [ ] **Шаг 2: Выпустить два токена в одну комнату**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 'cd /opt/clarity-meet && set -a && . ./.env && set +a
for who in ivan maria; do
  echo "=== токен для $who ==="
  lk token create --api-key "$LIVEKIT_API_KEY" --api-secret "$LIVEKIT_API_SECRET" \
    --join --room proverka --identity "$who" --valid-for 2h
done'
```

Ожидаем два длинных JWT.

- [ ] **Шаг 3: Подключиться с двух машин**

Открыть `https://meet.livekit.io/?tab=custom` на двух разных компьютерах (не двух вкладках одного — нужен разный сетевой путь). В каждом указать:

- Server URL: `wss://livekit.clarity-space.ru`
- Token: соответствующий токен из шага 2

**Критерий приёмки этапа: оба участника видят и слышат друг друга.**

- [ ] **Шаг 4: Снять показатели во время звонка**

Пока звонок идёт, с третьей машины:

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 \
  'uptime; docker stats --no-stream --format "{{.Name}} CPU {{.CPUPerc}} MEM {{.MemUsage}}" clarity-meet-livekit; free -h | head -2'
```

Записать цифры в отчёт. Это первые реальные данные для решения об апгрейде — оценка в разделе 9 ТЗ была умозрительной.

- [ ] **Шаг 5: Если участники не видят друг друга — диагностика по порядку**

1. В консоли браузера ошибка на WebSocket → нет `Upgrade`/`Connection` в nginx (задача 3, шаг 3).
2. Соединение установилось, медиа нет → в логе SFU проверить анонсируемый адрес; вероятен `use_external_ip`.
3. Работает по TCP, но не по UDP → проверить `ss -ulnp | grep 7882` и firewall провайдера. **UDP проверен 01.09.2026 и проходил.**
4. `unauthorized` → ключи в `.env` и в токене не совпадают.

---

### Task 5: Egress и запись дорожек

**Files:**
- Create: `/opt/clarity-meet/egress.yaml` (на сервере)
- Modify: `/opt/clarity-meet/docker-compose.yml` (добавить сервис)
- Modify: `infra/clarity-meet/docker-compose.yml` (в репозитории)
- Create: `infra/clarity-meet/egress.yaml` (в репозитории)

**Interfaces:**
- Consumes: SFU по имени `livekit` в docker-сети, ключи из задачи 1.
- Produces: записанные дорожки в `/opt/clarity-meet/recordings/`.

- [ ] **Шаг 1: Конфиг egress**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 'cat > /opt/clarity-meet/egress.yaml <<EOF
# Egress пишет отдельные дорожки. Общую сборку через headless Chrome не
# используем — она стоит около четырёх ядер на встречу.
redis: {}
ws_url: ws://livekit:7880
log_level: info
# Куда складывать. S3 не подключаем: на старте пишем на диск сервера.
EOF
echo "конфиг записан"'
```

- [ ] **Шаг 2: Добавить сервис в compose**

Дописать в `/opt/clarity-meet/docker-compose.yml` внутрь `services:`:

```yaml
  egress:
    image: livekit/egress:v1.9
    container_name: clarity-meet-egress
    restart: unless-stopped
    environment:
      EGRESS_CONFIG_FILE: /etc/egress.yaml
      LIVEKIT_API_KEY: "${LIVEKIT_API_KEY}"
      LIVEKIT_API_SECRET: "${LIVEKIT_API_SECRET}"
    volumes:
      - ./egress.yaml:/etc/egress.yaml:ro
      - ./recordings:/out
    depends_on:
      - livekit
    # Записываем звук по дорожкам и демонстрацию экрана. Камеры не пишем,
    # поэтому лимит скромный.
    deploy:
      resources:
        limits:
          cpus: "1.5"
          memory: 2G
```

- [ ] **Шаг 3: Поднять**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 \
  'cd /opt/clarity-meet && docker compose up -d && sleep 8 && docker compose ps && docker compose logs egress --tail 20'
```

Ожидаем: оба контейнера `running`, в логе egress нет ошибок подключения к LiveKit. **Ошибка авторизации означает рассинхрон ключей — они обязаны совпадать в трёх местах.**

- [ ] **Шаг 4: Записать дорожку живого звонка**

Повторить звонок из задачи 4, и во время него запустить запись дорожки участника:

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 'cd /opt/clarity-meet && set -a && . ./.env && set +a
lk egress start --api-key "$LIVEKIT_API_KEY" --api-secret "$LIVEKIT_API_SECRET" \
  --url http://127.0.0.1:7880 \
  track --room proverka --identity ivan --filepath /out/proverka-ivan'
```

- [ ] **Шаг 5: Проверить, что файл появился**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 \
  'ls -lh /opt/clarity-meet/recordings/ && file /opt/clarity-meet/recordings/*'
```

Ожидаем: файл ненулевого размера. **Критерий: на диске лежит дорожка, которую можно прослушать.**

- [ ] **Шаг 6: Снять показатели с записью**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 \
  'uptime; docker stats --no-stream --format "{{.Name}} CPU {{.CPUPerc}} MEM {{.MemUsage}}"; free -h | head -2'
```

Записать. Это вторая точка данных: сколько стоит звонок с записью.

- [ ] **Шаг 7: Коммит**

```bash
git add infra/clarity-meet/egress.yaml infra/clarity-meet/docker-compose.yml
git commit -m "infra(meet): egress для записи дорожек"
```

---

### Task 6: Автозапуск, здоровье и документация

**Files:**
- Create: `infra/clarity-meet/README.md`
- Create: `scripts/meet-smoke.sh`

**Interfaces:**
- Consumes: весь стек из задач 2, 3, 5.

- [ ] **Шаг 1: Проверить, что стек переживает перезагрузку докера**

```bash
ssh -i /root/.ssh/id_tochka_recovery root@31.128.43.174 \
  'cd /opt/clarity-meet && docker compose down && docker compose up -d && sleep 10 && docker compose ps'
```

Ожидаем: оба контейнера снова `running`. `restart: unless-stopped` обеспечит подъём после ребута хоста.

- [ ] **Шаг 2: Написать проверку стека**

Создать `scripts/meet-smoke.sh` по образцу существующего `scripts/smoke.sh` — с проверками **по содержимому, а не только по коду ответа**:

- `https://livekit.clarity-space.ru/` отвечает 200 и телом `OK`, а не HTML;
- контейнеры `clarity-meet-livekit` и `clarity-meet-egress` в состоянии running;
- порт 7882/udp слушается;
- Clarity Space по-прежнему зелёная (вызвать существующий `scripts/smoke.sh`).

Вывод на русском, ненулевой код возврата при любом провале.

- [ ] **Шаг 3: Прогнать проверку**

```bash
chmod +x scripts/meet-smoke.sh && ./scripts/meet-smoke.sh
```

Ожидаем: всё зелёное.

- [ ] **Шаг 4: Написать README стека**

`infra/clarity-meet/README.md`: что это, где лежит на сервере, как поднять и остановить, где ключи, где записи, куда смотреть при проблемах — с четырьмя пунктами диагностики из задачи 4 шага 5.

- [ ] **Шаг 5: Записать замеры в ТЗ**

В `docs/superpowers/specs/2026-09-01-vks-conference-design.md`, раздел 9, заменить оценочные цифры на фактические из задач 4 и 5. Отметить, что это замер на звонке вдвоём — не экстраполяция.

- [ ] **Шаг 6: Коммит**

```bash
git add infra/clarity-meet/README.md scripts/meet-smoke.sh docs/superpowers/specs/2026-09-01-vks-conference-design.md
git commit -m "infra(meet): проверка стека, README и фактические замеры ресурсов"
```

---

## Критерий готовности этапа

1. Два человека с разных машин видят и слышат друг друга через `wss://livekit.clarity-space.ru`.
2. Дорожка участника записана на диск и воспроизводится.
3. `./scripts/meet-smoke.sh` зелёный.
4. `BASE=https://clarity-space.ru ./scripts/smoke.sh` зелёный — Clarity Space не пострадала.
5. В ТЗ записаны фактические цифры потребления вместо оценок.

## Чего в этом этапе нет

Комнат, паролей, зала ожидания, ролей, своего фронтенда, расшифровки, задач в Clarity Space. Всё это — этапы 2–5. Здесь только медиа-фундамент и доказательство, что он работает на нашем железе.
