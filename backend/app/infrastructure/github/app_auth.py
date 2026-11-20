"""GitHub App authentication.

* The App signs a short JWT (RS256) with its private key and trades it for a 1-hour installation
  token per installation; tokens are cached in memory until shortly before they expire.
* ``sign_state`` / ``verify_state`` protect the browser round trips (App install, user sign-in):
  the state names the LabNote user and organization, is HMAC-signed and expires in 15 minutes.
"""

import base64
import hashlib
import hmac
import json
import threading
import time
from datetime import datetime
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from app.core.config import get_settings

STATE_TTL_SECONDS = 15 * 60
_token_cache: dict[int, tuple[str, float]] = {}
_cache_lock = threading.Lock()


class GitHubAppNotConfiguredError(Exception):
    pass


class InvalidStateError(ValueError):
    pass


def _b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _private_key_pem() -> str:
    settings = get_settings()
    if settings.github_app_private_key.strip():
        return settings.github_app_private_key.replace("\\n", "\n").strip()
    if settings.github_app_private_key_path.strip():
        path = Path(settings.github_app_private_key_path.strip())
        if path.is_file():
            return path.read_text(encoding="utf-8")
    return ""


def app_configured() -> bool:
    settings = get_settings()
    return bool(settings.github_app_id.strip() and settings.github_app_slug.strip() and _private_key_pem())


def user_login_configured() -> bool:
    settings = get_settings()
    return bool(settings.github_app_client_id.strip() and settings.github_app_client_secret.strip())


def web_base_url() -> str:
    return get_settings().github_web_base_url.rstrip("/")


def create_app_jwt(now: float | None = None) -> str:
    if not app_configured():
        raise GitHubAppNotConfiguredError("GitHub App이 서버에 설정되지 않았습니다")
    issued = int(now if now is not None else time.time()) - 60  # GitHub allows for clock drift this way
    header = {"alg": "RS256", "typ": "JWT"}
    payload = {"iat": issued, "exp": issued + 540, "iss": get_settings().github_app_id.strip()}
    signing_input = f"{_b64url(json.dumps(header, separators=(',', ':')).encode())}.{_b64url(json.dumps(payload, separators=(',', ':')).encode())}"
    key = serialization.load_pem_private_key(_private_key_pem().encode(), password=None)
    signature = key.sign(signing_input.encode(), padding.PKCS1v15(), hashes.SHA256())  # type: ignore[union-attr]
    return f"{signing_input}.{_b64url(signature)}"


def installation_token(client, installation_id: int) -> str:
    """A valid installation token, minted on demand and reused until five minutes before expiry."""
    with _cache_lock:
        cached = _token_cache.get(installation_id)
        if cached and cached[1] - time.time() > 300:
            return cached[0]
    token, expires_at = client.create_installation_token(create_app_jwt(), installation_id)
    try:
        expiry = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00")).timestamp()
    except ValueError:
        expiry = time.time() + 3000
    with _cache_lock:
        _token_cache[installation_id] = (token, expiry)
    return token


def forget_installation(installation_id: int) -> None:
    with _cache_lock:
        _token_cache.pop(installation_id, None)


def _state_signature(body: str) -> str:
    return _b64url(hmac.new(get_settings().app_secret_key.encode(), body.encode(), hashlib.sha256).digest())


def sign_state(purpose: str, **values) -> str:
    body = _b64url(json.dumps({"p": purpose, "exp": int(time.time()) + STATE_TTL_SECONDS, **values}, separators=(",", ":")).encode())
    return f"{body}.{_state_signature(body)}"


def verify_state(state: str, purpose: str) -> dict:
    try:
        body, signature = state.split(".", 1)
        if not hmac.compare_digest(signature, _state_signature(body)):
            raise InvalidStateError("요청 확인값이 올바르지 않습니다")
        values = json.loads(_b64url_decode(body))
    except (ValueError, json.JSONDecodeError) as exc:
        raise InvalidStateError("요청 확인값이 올바르지 않습니다. 처음부터 다시 시도하세요") from exc
    if values.get("p") != purpose:
        raise InvalidStateError("요청 확인값이 올바르지 않습니다")
    if int(values.get("exp") or 0) < time.time():
        raise InvalidStateError("요청 시간이 지났습니다. 처음부터 다시 시도하세요")
    return values
