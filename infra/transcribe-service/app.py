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

app = FastAPI(title="Transcribe Service", version="2.0.0")
model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE,
                     cpu_threads=CPU_THREADS, num_workers=1, download_root="/models")
_sem = asyncio.Semaphore(MAX_CONCURRENCY)


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_SIZE, "device": DEVICE, "compute": COMPUTE_TYPE}


def _transcribe_sync(data, suffix, language):
    """
    Распознаёт файл и возвращает не только текст, но и сегменты с временами.

    Времена нужны, чтобы сшивать дорожки разных участников в один диалог по
    порядку. Без них у нескольких дорожек получаются отдельные монологи,
    которые невозможно расположить друг относительно друга.

    VAD включён: он находит интервалы речи и отдаёт их с ИСХОДНЫМИ временами,
    поэтому распознаётся только речь, а таймлайн остаётся от оригинала. На
    встрече впятером это кратно дешевле, чем гонять через модель по часу
    молчания на каждого.
    """
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as f:
        f.write(data)
        f.flush()
        segments, info = model.transcribe(
            f.name,
            language=language or None,
            beam_size=1,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
        )

        items = []
        for seg in segments:
            текст = (seg.text or "").strip()
            if not текст:
                continue
            items.append({
                "start": round(float(seg.start), 3),
                "end": round(float(seg.end), 3),
                "text": текст,
            })

    речь = sum(s["end"] - s["start"] for s in items)
    длительность = float(getattr(info, "duration", 0) or 0)

    return {
        "text": " ".join(s["text"] for s in items).strip(),
        "segments": items,
        "duration": round(длительность, 3),
        "speech_duration": round(речь, 3),
        # Явный признак вместо молчаливой пустоты. Пустой ответ без объяснения
        # выглядит как поломка сервиса, хотя причина обычно в выключенном
        # микрофоне — и понять это по пустой строке невозможно.
        "no_speech": len(items) == 0,
        "language": getattr(info, "language", None),
        "model": MODEL_SIZE,
    }


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...), language: str = Form(default="")):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    suffix = os.path.splitext(file.filename or "audio")[1] or ".bin"
    async with _sem:
        результат = await asyncio.to_thread(_transcribe_sync, data, suffix, language or DEFAULT_LANG)
    return результат
