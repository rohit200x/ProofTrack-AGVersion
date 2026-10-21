"""Shared schema primitives and validators."""

import re
from datetime import datetime
from typing import Annotated, Generic, TypeVar

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

T = TypeVar("T")

US_STATES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA",
    "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR",
    "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "PR", "GU", "VI", "AS", "MP",
}


def _clean(v: str) -> str:
    return re.sub(r"\s+", " ", v).strip()


def normalize_us_phone(v: str) -> str:
    digits = re.sub(r"\D", "", v)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10 or digits[0] in "01" or digits[3] in "01":
        raise ValueError("Enter a valid US phone number (10 digits).")
    return f"+1{digits}"


def _state(v: str) -> str:
    v = v.strip().upper()
    if v not in US_STATES:
        raise ValueError("Enter a valid two-letter US state code.")
    return v


def _zip(v: str) -> str:
    v = v.strip()
    if not re.fullmatch(r"\d{5}(-\d{4})?", v):
        raise ValueError("Enter a valid ZIP code (12345 or 12345-6789).")
    return v


def _empty_to_none(v):
    if isinstance(v, str) and not v.strip():
        return None
    return v


def _email(v: str) -> str:
    v = v.strip().lower()
    if not v or len(v) > 254 or "@" not in v:
        raise ValueError("Enter a valid email address.")
    from email_validator import EmailNotValidError, validate_email

    try:
        info = validate_email(v, check_deliverability=False, test_environment=True)
        return info.normalized.lower()
    except EmailNotValidError as exc:
        raise ValueError(str(exc)) from None


CleanStr = Annotated[str, AfterValidator(_clean)]
EmailAddr = Annotated[str, AfterValidator(_email)]
UsPhone = Annotated[str, AfterValidator(normalize_us_phone)]
UsState = Annotated[str, AfterValidator(_state)]
UsZip = Annotated[str, AfterValidator(_zip)]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, str_strip_whitespace=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int


class UserBrief(ORMModel):
    id: "UUIDType"
    first_name: str
    last_name: str
    email: str | None = None
    role: str | None = None


from uuid import UUID as UUIDType  # noqa: E402

UserBrief.model_rebuild()

__all__ = [
    "CleanStr", "EmailAddr", "UsPhone", "UsState", "UsZip", "ORMModel", "Page", "UserBrief", "Field", "datetime",
    "normalize_us_phone", "_empty_to_none",
]
