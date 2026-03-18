FROM python:3.11-slim

# Cache bust: 2026-03-17e
ARG CACHE_BUST=20260317e

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libgl1 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Install CPU-only PyTorch FIRST to prevent ultralytics from pulling CUDA wheels.
RUN pip install --no-cache-dir \
    torch==2.3.1 torchvision==0.18.1 \
    --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download YOLO model weights at build time so they're baked into the image.
# This avoids a runtime download on first analysis (which can fail or time out).
RUN python -c "\
from ultralytics import YOLO; \
print('Downloading yolov8n…'); YOLO('yolov8n.pt'); \
print('Downloading yolov8s-pose…'); YOLO('yolov8s-pose.pt'); \
print('Models ready.')"

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
