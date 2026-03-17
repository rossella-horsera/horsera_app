FROM python:3.11-slim

# Cache bust: 2026-03-17b — force rebuild after healthcheck timeout investigation
ARG CACHE_BUST=20260317b

WORKDIR /app

# Minimal system deps for opencv-python-headless
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

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
