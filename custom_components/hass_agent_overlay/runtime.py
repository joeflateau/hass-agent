"""Small shared discovery status, owned by the config entry."""

from dataclasses import dataclass, field
from typing import Callable


@dataclass
class Runtime:
    player_count: int = 0
    listeners: set[Callable[[], None]] = field(default_factory=set)

    def update(self, count: int) -> None:
        if self.player_count != count:
            self.player_count = count
            for listener in tuple(self.listeners):
                listener()
