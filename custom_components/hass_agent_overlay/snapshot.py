"""Validate the existing MQTT sensor boundary without trusting restored metadata."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import math
import re
from typing import Any
from uuid import UUID

from homeassistant.core import State
from homeassistant.util import dt as dt_util

from .const import FRESHNESS_SECONDS


def timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or len(value) > 64:
        return None
    result = dt_util.parse_datetime(value)
    return result if result is not None and result.tzinfo is not None else None


def number(value: Any, maximum: float = 604800) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if 0 <= value <= maximum and math.isfinite(value) else None


def text(value: Any, limit: int = 512) -> str | None:
    return value[:limit] if isinstance(value, str) and value else None


@dataclass(frozen=True, slots=True)
class Snapshot:
    state: str
    session: str
    version: str | None
    observed_at: str
    observed: datetime
    attributes: dict[str, Any]

    def fresh(self, now: datetime | None = None) -> bool:
        return -2 <= ((now or dt_util.utcnow()) - self.observed).total_seconds() <= FRESHNESS_SECONDS

    @classmethod
    def from_state(cls, source: State | None) -> Snapshot | None:
        if source is None or source.attributes.get("restored") or source.state not in ("playing", "paused", "idle"):
            return None
        attrs = source.attributes
        session = attrs.get("session")
        if not isinstance(session, str) or len(session) != 36:
            return None
        try:
            UUID(session)
        except ValueError:
            return None
        observed_at = attrs.get("observed_at")
        observed = timestamp(observed_at)
        if observed is None:
            return None
        version = attrs.get("version")
        if source.state != "idle" and (
            not isinstance(version, str) or not re.fullmatch(r"[a-f0-9]{64}", version)
        ):
            return None
        return cls(source.state, session, version, observed_at, observed, dict(attrs))
