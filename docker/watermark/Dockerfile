# CPU-only image: this runs on a laptop beside the scraper, not on a GPU host.
# iopaint 1.6.0 pins gradio 4.21 and Pillow at versions with no cp312 wheel,
# so 3.11 is the interpreter this dependency set actually resolves on.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    XDG_CACHE_HOME=/models \
    TORCH_HOME=/models/torch

RUN apt-get update \
 && apt-get install -y --no-install-recommends libglib2.0-0 libgl1 libgomp1 curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Torch first, from the CPU index: the default wheel pulls ~2 GB of CUDA the
# service never uses.
COPY requirements.txt ./
RUN pip install --index-url https://download.pytorch.org/whl/cpu \
        torch==2.6.0 torchvision==0.21.0 \
 && pip install $(grep -vE '^(#|torch|torchvision)' requirements.txt)

# Bake the LaMa weights in, so a run does not depend on a GitHub release being
# reachable and every container starts with the same model.
RUN mkdir -p /models && iopaint download --model lama --model-dir /models/iopaint

COPY detect.py server.py test_detect.py ./
COPY templates ./templates

ENV WATERMARK_ENGINE=lama \
    XDG_CACHE_HOME=/models
EXPOSE 8770

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8770/health || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8770"]
