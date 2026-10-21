"""Object storage abstraction. Production: private S3 bucket. Development: MinIO. Tests: in-memory."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterator
from dataclasses import dataclass
from functools import lru_cache
from typing import BinaryIO

from app.core.config import get_settings


class StorageError(Exception):
    """Raised when the object store is unavailable or an operation fails."""


class ObjectNotFound(StorageError):
    pass


@dataclass
class StoredObject:
    body: Iterator[bytes]
    content_length: int
    content_type: str


class ObjectStorage(ABC):
    @abstractmethod
    def put(self, key: str, fileobj: BinaryIO, *, content_type: str, size: int) -> None: ...

    @abstractmethod
    def get(self, key: str) -> StoredObject: ...

    @abstractmethod
    def exists(self, key: str) -> bool: ...

    @abstractmethod
    def delete(self, key: str) -> None: ...

    @abstractmethod
    def check(self) -> None:
        """Raise StorageError if the backend is not usable (used by readiness probe)."""

    def ensure_bucket(self) -> None:  # optional, development convenience
        return None


@lru_cache
def get_storage() -> ObjectStorage:
    s = get_settings()
    if s.storage_backend == "memory":
        from app.storage.memory import MemoryStorage

        return MemoryStorage()
    from app.storage.s3 import S3Storage

    return S3Storage(s)
