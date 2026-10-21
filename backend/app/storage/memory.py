"""In-memory storage used by unit tests (with failure injection)."""

from collections.abc import Iterator
from threading import Lock
from typing import BinaryIO

from app.storage.base import ObjectNotFound, ObjectStorage, StorageError, StoredObject


class MemoryStorage(ObjectStorage):
    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}
        self.fail_puts = False
        self.fail_after_n_puts: int | None = None
        self.fail_deletes = False
        self.fail_gets = False
        self.put_count = 0
        self._lock = Lock()

    def put(self, key: str, fileobj: BinaryIO, *, content_type: str, size: int) -> None:
        with self._lock:
            self.put_count += 1
            if self.fail_puts or (self.fail_after_n_puts is not None and self.put_count > self.fail_after_n_puts):
                raise StorageError("injected put failure")
            fileobj.seek(0)
            self.objects[key] = (fileobj.read(), content_type)

    def get(self, key: str) -> StoredObject:
        if self.fail_gets:
            raise StorageError("injected get failure")
        if key not in self.objects:
            raise ObjectNotFound(key)
        data, ctype = self.objects[key]

        def it() -> Iterator[bytes]:
            yield data

        return StoredObject(it(), len(data), ctype)

    def exists(self, key: str) -> bool:
        return key in self.objects

    def delete(self, key: str) -> None:
        if self.fail_deletes:
            raise StorageError("injected delete failure")
        self.objects.pop(key, None)

    def check(self) -> None:
        return None

    def reset(self) -> None:
        self.objects.clear()
        self.fail_puts = False
        self.fail_after_n_puts = None
        self.fail_deletes = False
        self.fail_gets = False
        self.put_count = 0
