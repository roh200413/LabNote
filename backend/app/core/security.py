import base64
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone

from app.core.config import get_settings


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100000)
    return f"{base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, encoded_hash: str) -> bool:
    salt_b64, digest_b64 = encoded_hash.split("$", maxsplit=1)
    salt = base64.b64decode(salt_b64.encode())
    expected = base64.b64decode(digest_b64.encode())
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100000)
    return hmac.compare_digest(actual, expected)


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}".encode())


def create_access_token(user_id: int, email: str) -> str:
    settings = get_settings()
    header = {"alg": "HS256", "typ": "JWT"}
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": str(user_id), "email": email, "exp": int(expires_at.timestamp())}

    header_segment = _b64url_encode(json.dumps(header, separators=(",", ":")).encode())
    payload_segment = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode())
    signature = hmac.new(
        settings.app_secret_key.encode(),
        f"{header_segment}.{payload_segment}".encode(),
        hashlib.sha256,
    ).digest()
    return f"{header_segment}.{payload_segment}.{_b64url_encode(signature)}"


def decode_access_token(token: str) -> dict[str, str | int]:
    settings = get_settings()
    try:
        header_segment, payload_segment, signature_segment = token.split(".")
    except ValueError as exc:
        raise ValueError("Invalid token format") from exc

    expected_signature = hmac.new(
        settings.app_secret_key.encode(),
        f"{header_segment}.{payload_segment}".encode(),
        hashlib.sha256,
    ).digest()
    actual_signature = _b64url_decode(signature_segment)
    if not hmac.compare_digest(actual_signature, expected_signature):
        raise ValueError("Invalid token signature")

    payload = json.loads(_b64url_decode(payload_segment).decode())
    if int(payload["exp"]) < int(datetime.now(timezone.utc).timestamp()):
        raise ValueError("Token expired")
    return payload
