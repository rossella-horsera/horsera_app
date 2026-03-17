FROM python:3.11-slim

WORKDIR /app

# System deps for OpenCV + FFmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libgl1-mesa-glx \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake both YOLO models into the image at build time
# so the first request has zero cold-download latency.
RUN python -c "\
from ultralytics import YOLO; \
print('Downloading yolov8n…');  YOLO('yolov8n.pt'); \
print('Downloading yolov8s-pose…'); YOLO('yolov8s-pose.pt'); \
print('Models ready.')"

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
