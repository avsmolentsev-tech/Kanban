"""
Shared transcription microservice (faster-whisper).

Self-hosted, free-at-marginal-cost transcription for all projects on the box.
Called over localhost by Kanban and any other app. Concurrency is capped here
(this service is the single authority) so a burst of uploads never starves the
rest of the server. VAD is on to skip silence; greedy decoding for speed.
"""
import os
import asyncio
import tempfile

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from faster_whisper import WhisperModel

MODEL_SIZE = os.getenv("MODEL_SIZE", "medium")
DEVICE = os.getenv("DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("COMPUTE_TYPE", "int8")
CPU_THREADS = int(os.getenv("CPU_THREADS", "2"))
MAX_CONCURRENCY = int(os.getenv("MAX_CONCURRENCY", "2"))
DEFAULT_LANG = os.getenv("LANG_DEFAULT", "ru")

app = FastAPI(title="Transcribe Service", version="1.0.0")

# One model instance, shared across worker threads (CTranslate2 is thread-safe).
# cpu_threads x MAX_CONCURRENCY should map to the core budget (2 x 2 = 4 cores).
model = WhisperModel(
    MODEL_SIZE,
    device=DEVICE,
    compute_type=COMPUTE_TYPE,
    cpu_threads=CPU_THREADS,
    num_workers=1,
    download_root="/models",
)
_sem = asyncio.Semaphore(MAX_CONCURRENCY)


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_SIZE, "device": DEVICE, "compute": COMPUTE_TYPE}


def _transcribe_sync(data: bytes, suffix: str, language: str) -> str:
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as f:
        f.write(data)
        f.flush()
        segments, _info = model.transcribe(
            f.name,
            language=language or None,
            beam_size=1,          # greedy — faster, tiny accuracy cost
            vad_filter=True,      # skip silence (big win for meetings with pauses)
            vad_parameters={"min_silence_duration_ms": 500},
        )
        return " ".join(seg.text.strip() for seg in segments).strip()


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...), language: str = Form(default="")):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    name = file.filename or "audio"
    suffix = os.path.splitext(name)[1] or ".bin"
    lang = language or DEFAULT_LANG
    async with _sem:
        text = await asyncio.to_thread(_transcribe_sync, data, suffix, lang)
    return {"text": text, "model": MODEL_SIZE}
