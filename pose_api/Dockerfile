FROM python:3.11-slim

# Cache bust: 2026-03-17
ARG CACHE_BUST=20260317

WORKDIR /app

# Minimal system deps for opencv-python-headless
# (libsm6/libxext6/libxrender1/ffmpeg not needed — headless OpenCV bundles FFmpeg)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Install CPU-only PyTorch FIRST to prevent ultralytics from pulling CUDA wheels.
# CPU torch ~190 MB vs CUDA torch ~2.5 GB.
RUN pip install --no-cache-dir \
    torch==2.3.1 torchvision==0.18.1 \
    --index-url https://download.pytorch.org/whl/cpu

# App dependencies (ultralytics will reuse the torch already installed above)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# YOLO models download on first request to /root/.config/Ultralytics.
# Mount a Railway volume at that path to persist across deploys.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
