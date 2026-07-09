FROM python:3.11-slim

# ffmpeg: faster-whisper decodes audio via PyAV/ffmpeg
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

ENV MODEL_SIZE=medium \
    DEVICE=cpu \
    COMPUTE_TYPE=int8 \
    CPU_THREADS=2 \
    MAX_CONCURRENCY=2 \
    LANG_DEFAULT=ru

EXPOSE 8091

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8091", "--workers", "1"]
