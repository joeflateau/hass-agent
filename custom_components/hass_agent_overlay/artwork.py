"""Bounded embedded raster validation, never an arbitrary remote URL fetch."""
from __future__ import annotations

import base64
from dataclasses import dataclass
import hashlib
from io import BytesIO
import json
import re
from uuid import UUID

from PIL import Image

MAX_BYTES = 512 * 1024
MAX_PAYLOAD = 704 * 1024


@dataclass(frozen=True, slots=True)
class Artwork:
    key: str
    sha256: str
    mime: str
    data: bytes


def decode_artwork(payload: bytes | str) -> Artwork | None:
    """Run outside HA's loop; keep at most one validated image per player."""
    try:
        if len(payload) > MAX_PAYLOAD:
            return None
        value = json.loads(payload)
        if not isinstance(value, dict):
            return None
        key, digest, mime, encoded = (value.get(k) for k in ("key", "sha256", "mime", "data"))
        if not isinstance(key, str) or len(key) != 36 or str(UUID(key)) != key:
            return None
        if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            return None
        if mime not in ("image/jpeg", "image/png") or not isinstance(encoded, str) or len(encoded) > ((MAX_BYTES + 2) // 3) * 4:
            return None
        data = base64.b64decode(encoded, validate=True)
        if not data or len(data) > MAX_BYTES or hashlib.sha256(data).hexdigest() != digest:
            return None
        with Image.open(BytesIO(data)) as image:
            if image.format != {"image/jpeg": "JPEG", "image/png": "PNG"}[mime]:
                return None
            if not (0 < image.width <= 4096 and 0 < image.height <= 4096) or image.width * image.height > 16_000_000:
                return None
            if getattr(image, "n_frames", 1) != 1:
                return None
            image.verify()
        return Artwork(key, digest, mime, data)
    except Exception:
        # Untrusted optional artwork must not break otherwise healthy metadata.
        return None
