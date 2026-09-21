"""HTTP watermark remover for retailer product photographs.

POST /clean is the endpoint the backfill uses: it locates the shop's overlay
with detect.py and repaints only that ink with LaMa. An image where no
template matches comes back byte-for-byte unchanged, with changed=false, so a
photograph that was never watermarked is never repainted.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import logging
import os
import threading
from dataclasses import asdict
from pathlib import Path
from typing import Literal

import cv2
import numpy as np
from fastapi import Body, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from detect import SITE_SETTINGS, Settings, build_mask, detect, load_templates, residual

VERSION = "1.0.0"
MAX_BYTES = int(os.environ.get("WATERMARK_MAX_BYTES", 15 * 1024 * 1024))
MAX_PIXELS = int(os.environ.get("WATERMARK_MAX_PIXELS", 40_000_000))
API_KEY = os.environ.get("WATERMARK_SERVICE_API_KEY", "").strip()
DEFAULT_ENGINE = os.environ.get("WATERMARK_ENGINE", "lama")

log = logging.getLogger("watermark")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = FastAPI(title="Retailer watermark remover", version=VERSION)
TEMPLATES = load_templates()


def _fingerprint() -> str:
    """Everything that decides what this service does to an image.

    The backfill records it beside each imported gallery, so a later run can
    tell whether the images it is resuming were produced by this same
    detector, thresholds and template set.
    """
    digest = hashlib.sha256()
    digest.update(VERSION.encode())
    digest.update(DEFAULT_ENGINE.encode())
    digest.update(json.dumps({site: vars(limits) for site, limits in SITE_SETTINGS.items()}, sort_keys=True).encode())
    for path in sorted((Path(__file__).parent / "templates").glob("*/*.png")):
        digest.update(path.relative_to(Path(__file__).parent).as_posix().encode())
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()[:32]


FINGERPRINT = _fingerprint()

_lama_lock = threading.Lock()
_lama = None
_lama_error: str | None = None


def _load_lama():
    """LaMa is loaded once, on the first request that needs it."""
    global _lama, _lama_error
    with _lama_lock:
        if _lama is not None or _lama_error is not None:
            return _lama
        try:
            from iopaint.model_manager import ModelManager

            _lama = ModelManager(name="lama", device="cpu")
            log.info("LaMa model loaded")
        except Exception as error:  # noqa: BLE001 - reported through /health
            _lama_error = f"{type(error).__name__}: {error}"
            log.error("LaMa unavailable: %s", _lama_error)
        return _lama


def _inpaint_request():
    from iopaint.schema import HDStrategy, InpaintRequest

    return InpaintRequest(
        hd_strategy=HDStrategy.RESIZE,
        hd_strategy_crop_trigger_size=1280,
        hd_strategy_crop_margin=196,
        hd_strategy_resize_limit=2048,
    )


def _overrides(body: "CleanRequest") -> dict[str, float]:
    """Only the thresholds a caller actually sent override that site's own."""
    sent = {
        "min_score": body.min_score,
        "min_ink": body.min_ink,
        "min_contrast": body.min_contrast,
        "min_width": body.min_width,
    }
    return {name: value for name, value in sent.items() if value is not None}


def _authorise(authorization: str | None) -> None:
    if not API_KEY:
        return
    if authorization != f"Bearer {API_KEY}":
        raise HTTPException(status_code=401, detail="Bearer token required")


def _decode(data: str, what: str) -> np.ndarray:
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=400, detail=f"{what} is not valid base64") from error
    if not raw:
        raise HTTPException(status_code=400, detail=f"{what} is empty")
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"{what} exceeds {MAX_BYTES} bytes")
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail=f"{what} is not a decodable raster image")
    if image.shape[0] * image.shape[1] > MAX_PIXELS:
        raise HTTPException(status_code=413, detail=f"{what} exceeds {MAX_PIXELS} pixels")
    return image


def _encode(image: np.ndarray) -> str:
    ok, buffer = cv2.imencode(".png", image)
    if not ok:
        raise HTTPException(status_code=500, detail="Could not encode the result as PNG")
    return base64.b64encode(buffer.tobytes()).decode("ascii")


def _repaint(image: np.ndarray, mask: np.ndarray, engine: str) -> np.ndarray:
    if engine == "telea":
        return cv2.inpaint(image, mask, 4, cv2.INPAINT_TELEA)
    model = _load_lama()
    if model is None:
        raise HTTPException(status_code=503, detail=f"LaMa is unavailable: {_lama_error}")
    # IOPaint takes RGB and returns BGR.
    result = model(cv2.cvtColor(image, cv2.COLOR_BGR2RGB), mask, _inpaint_request())
    result = np.asarray(result)
    if result.ndim != 3 or result.shape[:2] != image.shape[:2]:
        raise HTTPException(status_code=500, detail="Inpainting returned an image of a different size")
    return np.clip(result, 0, 255).astype(np.uint8)


class CleanRequest(BaseModel):
    image: str = Field(description="base64-encoded source photograph")
    site: str | None = Field(default=None, description="restrict matching to one retailer's templates")
    # Omitted thresholds keep the per-site values measured in detect.py.
    min_score: float | None = Field(default=None, ge=0.0, le=1.0)
    min_ink: float | None = Field(default=None, ge=0.0, le=1.0)
    min_contrast: float | None = Field(default=None, ge=0.0, le=255.0)
    min_width: int | None = Field(default=None, ge=1, le=4096)
    engine: Literal["lama", "telea"] | None = None


class InpaintRequestBody(BaseModel):
    image: str
    mask: str = Field(description="base64 mask; white is repainted")
    engine: Literal["lama", "telea"] | None = None


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "version": VERSION,
        "fingerprint": FINGERPRINT,
        "engine": DEFAULT_ENGINE,
        "lama": {"loaded": _lama is not None, "error": _lama_error},
        "thresholds": {site: vars(limits) for site, limits in {**SITE_SETTINGS, "default": Settings()}.items()},
        "templates": [template.id for template in TEMPLATES],
        "sites": sorted({template.site for template in TEMPLATES}),
    }


@app.post("/detect")
def detect_endpoint(body: CleanRequest, authorization: str | None = Header(default=None)) -> dict:
    _authorise(authorization)
    image = _decode(body.image, "image")
    detections = detect(image, TEMPLATES, body.site, _overrides(body))
    return {"ok": True, "detections": [asdict(match) for match in detections]}


@app.post("/inpaint")
def inpaint_endpoint(body: InpaintRequestBody, authorization: str | None = Header(default=None)) -> dict:
    _authorise(authorization)
    image = _decode(body.image, "image")
    mask = cv2.cvtColor(_decode(body.mask, "mask"), cv2.COLOR_BGR2GRAY)
    if mask.shape[:2] != image.shape[:2]:
        raise HTTPException(status_code=400, detail="Mask dimensions do not match the image")
    mask = ((mask > 127) * 255).astype(np.uint8)
    if not mask.any():
        return {"ok": True, "changed": False, "image": _encode(image)}
    return {"ok": True, "changed": True, "image": _encode(_repaint(image, mask, body.engine or DEFAULT_ENGINE))}


@app.post("/clean")
def clean_endpoint(body: CleanRequest, authorization: str | None = Header(default=None)) -> dict:
    _authorise(authorization)
    image = _decode(body.image, "image")
    detections = detect(image, TEMPLATES, body.site, _overrides(body))
    payload = {
        "ok": True,
        "changed": False,
        "engine": body.engine or DEFAULT_ENGINE,
        "detections": [asdict(match) for match in detections],
        "width": int(image.shape[1]),
        "height": int(image.shape[0]),
    }
    if not detections:
        # Nothing matched: return the photograph untouched, and say so.
        return {**payload, "image": _encode(image)}
    mask = build_mask(image.shape, detections, TEMPLATES)
    cleaned = _repaint(image, mask, body.engine or DEFAULT_ENGINE)
    # Say whether the repaint actually covered the mark, rather than assuming it.
    left_over = residual(cleaned, detections, TEMPLATES, body.site)
    return {
        **payload,
        "changed": True,
        "maskPixels": int((mask > 0).sum()),
        "residual": [asdict(match) for match in left_over],
        "image": _encode(cleaned),
    }
