"""Safe image intake: bounded streaming read, true content validation, thumbnail generation."""

from __future__ import annotations

import hashlib
import io
import re
import warnings
from dataclasses import dataclass
from tempfile import SpooledTemporaryFile
from typing import BinaryIO

from fastapi import UploadFile
from PIL import Image, ImageFile, ImageOps, UnidentifiedImageError
from pillow_heif import register_heif_opener

from app.core.config import get_settings
from app.core.errors import PayloadTooLarge, UnsupportedMedia, ValidationFailed

register_heif_opener()
ImageFile.LOAD_TRUNCATED_IMAGES = False  # truncated/corrupt files must fail loudly

FORMAT_MAP = {
    "JPEG": ("image/jpeg", "jpg"),
    "MPO": ("image/jpeg", "jpg"),  # multi-picture JPEG produced by many Android/iOS cameras
    "PNG": ("image/png", "png"),
    "WEBP": ("image/webp", "webp"),
    "HEIF": ("image/heic", "heic"),
}
MAX_FRAMES = 10
PREVIEW_MAX_PX = 1600
CHUNK = 64 * 1024
SPOOL_MAX_MEMORY = 2 * 1024 * 1024


@dataclass
class ProcessedImage:
    original: BinaryIO
    thumbnail: BinaryIO
    sha256: str
    size_bytes: int
    thumbnail_size: int
    content_type: str
    extension: str
    width: int
    height: int
    filename: str | None
    preview: BinaryIO | None = None
    preview_size: int = 0

    def close(self) -> None:
        self.original.close()
        self.thumbnail.close()
        if self.preview is not None:
            self.preview.close()


def sanitize_filename(name: str | None) -> str | None:
    if not name:
        return None
    base = re.split(r"[\\/]", name)[-1]
    base = re.sub(r"[^A-Za-z0-9._ -]", "_", base).strip(" .")
    return base[:120] or None


def read_bounded(upload: UploadFile, max_bytes: int) -> tuple[SpooledTemporaryFile, str, int]:
    """Stream an upload into a spooled temp file, enforcing the byte limit and computing SHA-256."""
    tmp = SpooledTemporaryFile(max_size=SPOOL_MAX_MEMORY)  # noqa: SIM115 - closed by caller
    digest = hashlib.sha256()
    total = 0
    try:
        while chunk := upload.file.read(CHUNK):
            total += len(chunk)
            if total > max_bytes:
                raise PayloadTooLarge(
                    f"Image '{sanitize_filename(upload.filename) or 'upload'}' exceeds the {max_bytes // (1024 * 1024)} MB limit."
                )
            digest.update(chunk)
            tmp.write(chunk)
    except Exception:
        tmp.close()
        raise
    if total == 0:
        tmp.close()
        raise ValidationFailed("The uploaded image is empty.")
    tmp.seek(0)
    return tmp, digest.hexdigest(), total


def process_upload(upload: UploadFile) -> ProcessedImage:
    s = get_settings()
    original, sha, size = read_bounded(upload, s.max_upload_bytes)
    try:
        return _validate_and_derive(original, sha, size, sanitize_filename(upload.filename))
    except Exception:
        original.close()
        raise


def _validate_and_derive(original: SpooledTemporaryFile, sha: str, size: int, filename: str | None) -> ProcessedImage:
    s = get_settings()
    Image.MAX_IMAGE_PIXELS = s.max_image_pixels
    bad = ValidationFailed("The file is not a valid image or is corrupted.", code="INVALID_IMAGE")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            original.seek(0)
            with Image.open(original) as probe:
                fmt = (probe.format or "").upper()
                if fmt not in FORMAT_MAP:
                    raise UnsupportedMedia(
                        "Unsupported image type. Use JPEG, PNG, WebP or HEIC.", code="UNSUPPORTED_IMAGE_TYPE"
                    )
                width, height = probe.size
                if width < 1 or height < 1:
                    raise bad
                if max(width, height) > s.max_image_side_px or width * height > s.max_image_pixels:
                    raise ValidationFailed(
                        f"Image dimensions are too large (maximum {s.max_image_side_px}px on a side).",
                        code="IMAGE_TOO_LARGE_DIMENSIONS",
                    )
                if getattr(probe, "n_frames", 1) > MAX_FRAMES:
                    raise bad
            # Full decode of the real pixel data; raises for truncated or corrupt files.
            original.seek(0)
            with Image.open(original) as img:
                img.load()
                oriented = ImageOps.exif_transpose(img)  # bake in orientation before stripping metadata
                width, height = oriented.size
                rgb = _to_rgb(oriented)
                # Derived images are built only from pixel data: no EXIF/GPS/ICC/camera metadata is copied.
                preview_img = rgb.copy()
                preview_img.thumbnail((PREVIEW_MAX_PX, PREVIEW_MAX_PX), Image.Resampling.LANCZOS)
                preview = io.BytesIO()
                preview_img.save(preview, format="JPEG", quality=85, optimize=True)
                rgb.thumbnail((s.thumbnail_max_px, s.thumbnail_max_px), Image.Resampling.LANCZOS)
                thumb = io.BytesIO()
                rgb.save(thumb, format="JPEG", quality=82, optimize=True)
    except (ValidationFailed, UnsupportedMedia):
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ValidationFailed("Image dimensions are too large.", code="IMAGE_TOO_LARGE_DIMENSIONS") from None
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, EOFError, MemoryError):
        raise bad from None
    except Exception:  # decoder plugins (e.g. HEIF) raise assorted exceptions on malformed data
        raise bad from None

    original.seek(0)
    thumb.seek(0)
    preview.seek(0)
    content_type, ext = FORMAT_MAP[fmt]
    return ProcessedImage(
        original=original, thumbnail=thumb, sha256=sha, size_bytes=size, thumbnail_size=thumb.getbuffer().nbytes,
        content_type=content_type, extension=ext, width=width, height=height, filename=filename,
        preview=preview, preview_size=preview.getbuffer().nbytes,
    )


def _to_rgb(img: Image.Image) -> Image.Image:
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        bg = Image.new("RGB", rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.split()[-1])
        return bg
    return img.convert("RGB")
