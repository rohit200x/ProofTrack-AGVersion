"""S3-compatible storage (AWS S3, MinIO) using boto3. The bucket is always private; objects are only
ever served through authorised backend endpoints."""

from collections.abc import Iterator
from typing import BinaryIO

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import Settings
from app.storage.base import ObjectNotFound, ObjectStorage, StorageError, StoredObject

CHUNK = 64 * 1024


class S3Storage(ObjectStorage):
    def __init__(self, settings: Settings):
        self.bucket = settings.s3_bucket
        self.settings = settings
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url or None,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": settings.s3_addressing_style},
                retries={"max_attempts": 3, "mode": "standard"},
                connect_timeout=5,
                read_timeout=30,
            ),
        )

    def put(self, key: str, fileobj: BinaryIO, *, content_type: str, size: int) -> None:
        try:
            fileobj.seek(0)
            self.client.upload_fileobj(
                fileobj, self.bucket, key,
                ExtraArgs={"ContentType": content_type, "ServerSideEncryption": "AES256"}
                if not self.settings.s3_endpoint_url
                else {"ContentType": content_type},
            )
        except (BotoCoreError, ClientError) as exc:
            raise StorageError(f"Failed to store object: {exc.__class__.__name__}") from exc

    def get(self, key: str) -> StoredObject:
        try:
            resp = self.client.get_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"NoSuchKey", "404", "NotFound"}:
                raise ObjectNotFound(key) from exc
            raise StorageError(f"Failed to read object: {exc.__class__.__name__}") from exc
        except BotoCoreError as exc:
            raise StorageError(f"Failed to read object: {exc.__class__.__name__}") from exc
        body = resp["Body"]

        def iterate() -> Iterator[bytes]:
            try:
                yield from body.iter_chunks(CHUNK)
            finally:
                body.close()

        return StoredObject(iterate(), resp["ContentLength"], resp.get("ContentType", "application/octet-stream"))

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise StorageError("Failed to check object") from exc
        except BotoCoreError as exc:
            raise StorageError("Failed to check object") from exc

    def delete(self, key: str) -> None:
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
        except (BotoCoreError, ClientError) as exc:
            raise StorageError("Failed to delete object") from exc

    def check(self) -> None:
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except (BotoCoreError, ClientError) as exc:
            raise StorageError("Object storage is unavailable") from exc

    def ensure_bucket(self) -> None:
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except ClientError:
            try:
                self.client.create_bucket(Bucket=self.bucket)
            except (BotoCoreError, ClientError) as exc:
                raise StorageError("Could not create bucket") from exc
        except BotoCoreError as exc:
            raise StorageError("Object storage is unavailable") from exc
        # Explicitly block any public access (no-op on MinIO, enforced on AWS S3).
        try:
            self.client.put_public_access_block(
                Bucket=self.bucket,
                PublicAccessBlockConfiguration={
                    "BlockPublicAcls": True, "IgnorePublicAcls": True,
                    "BlockPublicPolicy": True, "RestrictPublicBuckets": True,
                },
            )
        except (BotoCoreError, ClientError):
            pass
