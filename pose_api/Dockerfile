# ── Stage 1: Export YOLO .pt weights → .onnx ─────────────────────────────────
# torch + ultralytics are only needed here.  They are NOT copied to the
# runtime image, so the 400 MB torch payload never loads in production.
FROM python:3.11-slim AS exporter

WORKDIR /export

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 libgomp1 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    torch==2.3.1 torchvision==0.18.1 \
    --index-url https://download.pytorch.org/whl/cpu

RUN pip install --no-cache-dir ultralytics==8.4.22 onnx==1.16.0

RUN python -c "\
from ultralytics import YOLO; \
print('Exporting yolov8n → ONNX...'); \
YOLO('yolov8n.pt').export(format='onnx', opset=12, simplify=False); \
print('Exporting yolov8s-pose → ONNX...'); \
YOLO('yolov8s-pose.pt').export(format='onnx', opset=12, simplify=False); \
print('ONNX export complete.')"

# ── Stage 2: Runtime — no torch, no ultralytics ───────────────────────────────
# Runtime upgraded to Python 3.14 for newer onnxruntime wheels.
# Memory budget at startup: ~200 MB (vs ~500 MB with torch).
FROM python:3.14-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy only the ONNX weights from the exporter stage — no torch binary
COPY --from=exporter /export/yolov8n.onnx .
COPY --from=exporter /export/yolov8s-pose.onnx .

COPY . .

EXPOSE 8000
CMD ["sh", "-c", "python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]
