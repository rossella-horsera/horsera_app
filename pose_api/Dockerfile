FROM python:3.11-slim-bullseye

WORKDIR /app

# System deps for OpenCV + FFmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libgl1 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# YOLO models (yolov8n.pt, yolov8s-pose.pt) are NOT baked into the image.
# They download automatically on first startup via ultralytics and are
# cached to /root/.config/Ultralytics — mount a Railway volume there
# to persist across deploys and avoid re-downloading on every restart.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
