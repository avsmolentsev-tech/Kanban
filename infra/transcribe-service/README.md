# Transcribe Service

Shared, self-hosted transcription microservice (faster-whisper). Free at marginal
cost — pay only for the server, never per minute. Called over `127.0.0.1:8091` by
Kanban and any other project on the box.

## API

- `GET /health` → `{status, model, device, compute}`
- `POST /transcribe` (multipart): `file=<audio>`, optional `language=ru` → `{text, model}`

## Run

```bash
cd /opt/transcribe-service
docker compose up -d --build      # first build downloads the medium model (~1.5GB)
curl -s http://127.0.0.1:8091/health
curl -s -F file=@sample.ogg http://127.0.0.1:8091/transcribe
```

## Tuning

Env (in `docker-compose.yml`):
- `MODEL_SIZE` — `small` (fast) / `medium` (balanced, default) / `large-v3` (Plaud-grade, needs GPU)
- `COMPUTE_TYPE` — `int8` (CPU) / `float16` (GPU)
- `CPU_THREADS` × `MAX_CONCURRENCY` ≈ core budget (2×2 = 4 cores). Leave headroom for other apps.
- `cpus` / `mem_limit` cap the container so it can't starve the shared box.

## Scaling to Plaud-grade

- Move to a GPU box: set `DEVICE=gpu`, `COMPUTE_TYPE=float16`, `MODEL_SIZE=large-v3`. One consumer GPU = 10-30x realtime.
- Horizontal: run this container on N worker boxes behind a queue; point clients at a load balancer.
- The service is portable: consumers only know the URL, so relocating is a one-line config change.

> This lives in the Kanban repo for now for version control. It is infra shared by
> all projects and should eventually move to its own repo/deploy.
