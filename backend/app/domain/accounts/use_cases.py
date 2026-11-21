import base64
import hashlib
import re
import secrets
import string
from collections.abc import Iterable
from datetime import datetime, timezone
from urllib.parse import unquote_to_bytes

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, hash_password, password_needs_rehash, verify_password
from app.core.system_admin_registry import SystemAdmin
from app.domain.accounts.entities import UserAccount
from app.domain.audit.entities import AuditLogEntry
from app.domain.companies.entities import Company, CompanyMember, CompanyMembershipRequest
from app.infrastructure.db.models import CompanyMembershipRequestORM, CompanyORM, UserSignatureORM
from app.infrastructure.repositories.sqlalchemy_identity import (
    SqlAlchemyAuditLogRepository,
    SqlAlchemyCompanyMemberRepository,
    SqlAlchemyCompanyMembershipRequestRepository,
    SqlAlchemyCompanyRepository,
    SqlAlchemyDirectoryQueries,
    SqlAlchemyUserAccountRepository,
)
from app.infrastructure.storage.local_storage import LocalStorageService


class UserAlreadyExistsError(Exception):
    pass


class InvalidCredentialsError(Exception):
    pass


class UserNotFoundError(Exception):
    pass


class PendingApprovalError(Exception):
    pass


def _build_username(name: str, email: str, users: SqlAlchemyUserAccountRepository) -> str:
    seed = re.sub(r"[^a-z0-9]+", "", name.lower()) or re.sub(r"[^a-z0-9]+", "", email.split("@")[0].lower())
    seed = seed[:40] or "user"
    candidate = seed
    suffix = 1
    while users.get_by_username(candidate):
        candidate = f"{seed}{suffix}"
        suffix += 1
    return candidate[:80]


def _record_audit(
    audits: SqlAlchemyAuditLogRepository,
    *,
    actor_user_id: int | None,
    company_id: int | None,
    target_type: str,
    target_id: str,
    action: str,
    detail: str | None = None,
) -> None:
    audits.add(
        AuditLogEntry(
            id=None,
            created_at=None,
            actor_user_id=actor_user_id,
            company_id=company_id,
            target_type=target_type,
            target_id=target_id,
            action=action,
            detail=detail,
        )
    )


def _generate_join_code(companies: SqlAlchemyCompanyRepository, length: int = 9) -> str:
    alphabet = string.ascii_uppercase + string.digits
    while True:
        candidate = "".join(secrets.choice(alphabet) for _ in range(length))
        if companies.get_by_join_code(candidate) is None:
            return candidate


def register_user(
    db: Session,
    email: str,
    password: str,
    name: str,
    account_type: str = "user",
    organization_name: str | None = None,
    organization_code: str | None = None,
) -> tuple[UserAccount, str | None, str | None]:
    users = SqlAlchemyUserAccountRepository(db)
    companies = SqlAlchemyCompanyRepository(db)
    company_members = SqlAlchemyCompanyMemberRepository(db)
    membership_requests = SqlAlchemyCompanyMembershipRequestRepository(db)
    audits = SqlAlchemyAuditLogRepository(db)

    normalized_email = email.strip().lower()
    if users.get_by_email(normalized_email):
        raise UserAlreadyExistsError(normalized_email)

    username = _build_username(name, normalized_email, users)

    if account_type == "owner":
        if not organization_name:
            raise ValueError("기관 관리자는 기관명을 입력해야 합니다")
        if companies.get_by_name(organization_name.strip()):
            raise ValueError("이미 사용 중인 기관명입니다")
        join_code = _generate_join_code(companies)

        company = companies.add(
            Company(
                id=None,
                created_at=None,
                updated_at=None,
                name=organization_name.strip(),
                join_code=join_code,
                is_active=False,
            )
        )
        user = users.add(
            UserAccount(
                id=None,
                created_at=None,
                updated_at=None,
                username=username,
                display_name=name.strip(),
                email=normalized_email,
                password=hash_password(password),
                global_role="company_owner",
                is_active=False,
                is_approved=False,
                signature_data_url=None,
            )
        )
        company_members.add(
            CompanyMember(
                id=None,
                created_at=None,
                updated_at=None,
                company_id=company.id or 0,
                user_id=user.id or 0,
                role="owner",
            )
        )
        _record_audit(
            audits,
            actor_user_id=user.id,
            company_id=company.id,
            target_type="company",
            target_id=str(company.id),
            action="owner_signup_requested",
            detail=f"Owner signup requested for {company.name}",
        )
        db.commit()
        return user, None, f"Organization owner signup submitted. Waiting for admin approval. Your company code is {join_code}."

    if not organization_code:
        if organization_name:
            raise ValueError("기관에 가입하려면 기관 코드를 입력하세요")
        user = users.add(
            UserAccount(
                id=None,
                created_at=None,
                updated_at=None,
                username=username,
                display_name=name.strip(),
                email=normalized_email,
                password=hash_password(password),
                global_role="user",
                is_active=True,
                is_approved=True,
                signature_data_url=None,
            )
        )
        _record_audit(
            audits,
            actor_user_id=user.id,
            company_id=None,
            target_type="useraccount",
            target_id=str(user.id),
            action="signup",
            detail=f"Standalone user signup for {user.email}",
        )
        db.commit()
        return user, create_access_token(user.id or 0, user.email), "Account created."

    join_code = organization_code.strip().upper()
    if len(join_code) != 9:
        raise ValueError("기관 코드는 9자리여야 합니다")
    company = companies.get_by_join_code(join_code)
    if company is None:
        raise ValueError("기관 코드를 찾을 수 없습니다")
    if organization_name and company.name.strip().lower() != organization_name.strip().lower():
        raise ValueError("기관명과 기관 코드가 일치하지 않습니다")

    user = users.add(
        UserAccount(
            id=None,
            created_at=None,
            updated_at=None,
            username=username,
            display_name=name.strip(),
            email=normalized_email,
            password=hash_password(password),
            global_role="user",
            is_active=False,
            is_approved=False,
            signature_data_url=None,
        )
    )

    message = "Signup request submitted. Waiting for owner approval."
    access_token = None
    membership_requests.add(
        CompanyMembershipRequest(
            id=None,
            created_at=None,
            updated_at=None,
            company_id=company.id or 0,
            user_id=user.id or 0,
            status="pending",
        )
    )
    _record_audit(
        audits,
        actor_user_id=user.id,
        company_id=company.id,
        target_type="company_membership_request",
        target_id=str(user.id),
        action="create_company_membership_request",
        detail=f"Membership request for {user.email}",
    )
    _record_audit(
        audits,
        actor_user_id=user.id,
        company_id=company.id,
        target_type="useraccount",
        target_id=str(user.id),
        action="signup",
        detail=f"User signup for {user.email}",
    )
    db.commit()
    return user, access_token, message


def login_user(db: Session, email: str, password: str) -> tuple[UserAccount, str]:
    users = SqlAlchemyUserAccountRepository(db)
    audits = SqlAlchemyAuditLogRepository(db)
    directory = SqlAlchemyDirectoryQueries(db)

    normalized_email = email.strip().lower()
    user = users.get_by_email(normalized_email)
    if not user or not verify_password(password, user.password):
        raise InvalidCredentialsError()
    if not user.is_approved:
        raise PendingApprovalError()
    if not user.is_active:
        raise InvalidCredentialsError()
    if password_needs_rehash(user.password):
        user.password = hash_password(password)
        users.update(user)

    _record_audit(
        audits,
        actor_user_id=user.id,
        company_id=directory.get_primary_company_id_for_user(user.id or 0),
        target_type="useraccount",
        target_id=str(user.id),
        action="login",
        detail=f"Successful login for {user.email}",
    )
    db.commit()
    return user, create_access_token(user.id or 0, user.email)


def get_user_by_id(db: Session, user_id: int) -> UserAccount:
    user = SqlAlchemyUserAccountRepository(db).get(user_id)
    if not user:
        raise UserNotFoundError(user_id)
    return user


def ensure_system_admin_users(db: Session, admins: Iterable[SystemAdmin]) -> list[UserAccount]:
    users = SqlAlchemyUserAccountRepository(db)
    audits = SqlAlchemyAuditLogRepository(db)
    settings = get_settings()
    seeded_users: list[UserAccount] = []

    for admin in admins:
        normalized_email = admin.email.strip().lower()
        existing = users.get_by_email(normalized_email)
        if existing is None:
            existing = users.get_by_username(admin.username)
        if existing is None:
            user = users.add(
                UserAccount(
                    id=None,
                    created_at=None,
                    updated_at=None,
                    username=admin.username,
                    display_name=admin.display_name.strip(),
                    email=normalized_email,
                    password=hash_password(settings.system_admin_password),
                    global_role="system_admin",
                    is_active=admin.is_active,
                    is_approved=True,
                    signature_data_url=None,
                )
            )
            _record_audit(
                audits,
                actor_user_id=user.id,
                company_id=None,
                target_type="useraccount",
                target_id=str(user.id),
                action="seed_system_admin",
                detail=f"Seeded system admin {user.email}",
            )
            seeded_users.append(user)
            continue

        existing.email = normalized_email
        existing.display_name = admin.display_name.strip()
        existing.username = admin.username
        existing.global_role = "system_admin"
        existing.is_active = admin.is_active
        existing.is_approved = True
        seeded_users.append(users.update(existing))

    db.commit()
    return seeded_users


def list_users(db: Session) -> list[dict]:
    users = SqlAlchemyUserAccountRepository(db).list_all()
    directory = SqlAlchemyDirectoryQueries(db)
    return [
        {
            "id": user.id,
            "email": user.email,
            "name": user.display_name,
            "is_active": user.is_active,
            "is_admin": user.global_role == "system_admin",
            "is_org_owner": directory.is_company_owner(user.id or 0),
            "approval_status": "approved" if user.is_approved else "pending",
            "organization_id": directory.get_primary_company_id_for_user(user.id or 0),
            "created_at": user.created_at,
            "signature_data_url": user.signature_data_url,
        }
        for user in users
    ]


class AdminUpdateRefused(ValueError):
    """An admin edit that is understood but not allowed (as opposed to a missing user)."""


def update_user(db: Session, user_id: int, actor_user_id: int | None = None, **kwargs) -> dict:
    users = SqlAlchemyUserAccountRepository(db)
    company_members = SqlAlchemyCompanyMemberRepository(db)
    audits = SqlAlchemyAuditLogRepository(db)
    user = users.get(user_id)
    if user is None:
        raise ValueError("사용자를 찾을 수 없습니다")
    if actor_user_id is not None and actor_user_id == user_id:
        if kwargs.get("is_active") is False:
            raise AdminUpdateRefused("본인 계정은 비활성화할 수 없습니다")
        if kwargs.get("is_admin") is False and user.global_role == "system_admin":
            raise AdminUpdateRefused("본인의 시스템 관리자 권한은 해제할 수 없습니다")

    if "name" in kwargs and kwargs["name"] is not None:
        user.display_name = kwargs["name"]
    if "is_active" in kwargs and kwargs["is_active"] is not None:
        user.is_active = kwargs["is_active"]
    if "is_admin" in kwargs and kwargs["is_admin"] is not None:
        # The console sends is_admin with every edit; only act on a real change, and when
        # removing system admin, fall back to company owner if the person owns a company.
        if kwargs["is_admin"]:
            user.global_role = "system_admin"
        elif user.global_role == "system_admin":
            owns_company = SqlAlchemyDirectoryQueries(db).is_company_owner(user_id)
            user.global_role = "company_owner" if owns_company else "user"
    updated_user = users.update(user)

    organization_id = kwargs.get("organization_id")
    if organization_id is not None:
        if SqlAlchemyCompanyRepository(db).get(organization_id) is None:
            raise AdminUpdateRefused("기관을 찾을 수 없습니다")
        existing_memberships = list(company_members.list_by_user(user_id))
        if existing_memberships:
            primary = existing_memberships[0]
            if primary.company_id != organization_id:
                if primary.role == "owner":
                    owners = [m for m in company_members.list_by_company(primary.company_id) if m.role == "owner"]
                    if len(owners) <= 1:
                        raise AdminUpdateRefused("기관의 유일한 관리자는 다른 기관으로 옮길 수 없습니다. 먼저 다른 기관 관리자를 지정하세요")
                # Moving to another organization starts as a researcher there.
                primary.company_id = organization_id
                was_owner = primary.role == "owner"
                primary.role = "member"
                company_members.update(primary)
                if was_owner and updated_user.global_role == "company_owner":
                    updated_user.global_role = "user"
                    updated_user = users.update(updated_user)
        else:
            company_members.add(
                CompanyMember(
                    id=None,
                    created_at=None,
                    updated_at=None,
                    company_id=organization_id,
                    user_id=user_id,
                    role="member",
                )
            )

    audits.add(
        AuditLogEntry(
            id=None,
            created_at=None,
            actor_user_id=user_id,
            company_id=organization_id,
            target_type="useraccount",
            target_id=str(user_id),
            action="admin_update_user",
            detail="Admin updated user account",
        )
    )
    db.commit()

    directory = SqlAlchemyDirectoryQueries(db)
    return {
        "id": updated_user.id,
        "email": updated_user.email,
        "name": updated_user.display_name,
        "is_active": updated_user.is_active,
        "is_admin": updated_user.global_role == "system_admin",
        "is_org_owner": directory.is_company_owner(updated_user.id or 0),
        "approval_status": "approved" if updated_user.is_approved else "pending",
        "organization_id": directory.get_primary_company_id_for_user(updated_user.id or 0),
        "created_at": updated_user.created_at,
        "signature_data_url": updated_user.signature_data_url,
    }


def list_company_members_for_user(db: Session, user_id: int) -> list[dict]:
    directory = SqlAlchemyDirectoryQueries(db)
    company_id = directory.get_primary_company_id_for_user(user_id)
    if company_id is None:
        return []
    return directory.list_company_members_with_users(company_id)


def get_company_access_request_status(db: Session, user_id: int) -> dict | None:
    directory = SqlAlchemyDirectoryQueries(db)
    if directory.get_primary_company_id_for_user(user_id) is not None:
        return None

    row = db.execute(
        select(CompanyMembershipRequestORM, CompanyORM)
        .join(CompanyORM, CompanyORM.id == CompanyMembershipRequestORM.company_id)
        .where(
            CompanyMembershipRequestORM.user_id == user_id,
            CompanyMembershipRequestORM.status == "pending",
        )
        .order_by(CompanyMembershipRequestORM.created_at.desc())
    ).first()
    if row is None:
        return None

    request, company = row
    return {
        "company_id": company.id,
        "company_name": company.name,
        "company_code": company.join_code,
        "status": request.status,
    }


def request_company_access(
    db: Session,
    *,
    user_id: int,
    organization_name: str,
    organization_code: str,
) -> tuple[UserAccount, dict | None, str]:
    users = SqlAlchemyUserAccountRepository(db)
    companies = SqlAlchemyCompanyRepository(db)
    company_members = SqlAlchemyCompanyMemberRepository(db)
    membership_requests = SqlAlchemyCompanyMembershipRequestRepository(db)
    audits = SqlAlchemyAuditLogRepository(db)
    directory = SqlAlchemyDirectoryQueries(db)

    user = users.get(user_id)
    if user is None:
        raise UserNotFoundError(user_id)
    if directory.get_primary_company_id_for_user(user_id) is not None:
        raise ValueError("이 계정은 이미 기관에 연결되어 있습니다")

    normalized_name = organization_name.strip()
    normalized_code = organization_code.strip().upper()
    company = companies.get_by_join_code(normalized_code)
    if company is None:
        raise ValueError("기관 코드를 찾을 수 없습니다")
    if company.name.strip().lower() != normalized_name.lower():
        raise ValueError("기관명과 기관 코드가 일치하지 않습니다")

    if company_members.get_by_company_and_user(company.id or 0, user_id) is not None:
        raise ValueError("이미 이 기관의 구성원입니다")

    pending_request = membership_requests.get_pending_by_company_and_user(company.id or 0, user_id)
    if pending_request is not None:
        return user, {
            "company_id": company.id,
            "company_name": company.name,
            "company_code": company.join_code,
            "status": pending_request.status,
        }, "Your access request is already waiting for owner approval."

    request = membership_requests.add(
        CompanyMembershipRequest(
            id=None,
            created_at=None,
            updated_at=None,
            company_id=company.id or 0,
            user_id=user_id,
            status="pending",
        )
    )
    _record_audit(
        audits,
        actor_user_id=user_id,
        company_id=company.id,
        target_type="company_membership_request",
        target_id=str(request.id),
        action="create_company_membership_request",
        detail=f"Membership request for {user.email}",
    )
    db.commit()
    return user, {
        "company_id": company.id,
        "company_name": company.name,
        "company_code": company.join_code,
        "status": request.status,
    }, "Your company access request has been submitted."


SIGNATURE_PADDING = 4
SIGNATURE_MAX_SIDE = 1200


def normalize_signature_image(image_bytes: bytes) -> bytes:
    """Crop blank margins and drop the white paper background so the ink fills the signature box.

    Returns a PNG. Images with no detectable ink are returned unchanged (as PNG).
    """
    from io import BytesIO

    from PIL import Image, ImageChops, ImageOps, UnidentifiedImageError

    try:
        with Image.open(BytesIO(image_bytes)) as source:
            image = ImageOps.exif_transpose(source).convert("RGBA")
    except (UnidentifiedImageError, OSError) as exc:
        raise ValueError("서명 이미지를 읽을 수 없습니다") from exc

    image.thumbnail((SIGNATURE_MAX_SIDE, SIGNATURE_MAX_SIDE))
    width, height = image.size
    red, green, blue, alpha = image.split()
    darkest = ImageChops.darker(red, ImageChops.darker(green, blue))
    # Near-white or (almost) transparent pixels are background; everything else is ink.
    ink = darkest.point(lambda value: 255 if value < 235 else 0)
    visible = alpha.point(lambda value: 255 if value >= 16 else 0)
    image.putalpha(ImageChops.darker(alpha, ImageChops.darker(ink, visible)))
    bbox = image.getchannel("A").getbbox()
    if bbox:
        left, top, right, bottom = bbox
        image = image.crop(
            (
                max(0, left - SIGNATURE_PADDING),
                max(0, top - SIGNATURE_PADDING),
                min(width, right + SIGNATURE_PADDING),
                min(height, bottom + SIGNATURE_PADDING),
            )
        )
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _signature_data_url(png_bytes: bytes) -> str:
    return f"data:image/png;base64,{base64.b64encode(png_bytes).decode('ascii')}"


def update_user_signature(db: Session, user_id: int, signature_data_url: str | None) -> UserAccount:
    users = SqlAlchemyUserAccountRepository(db)
    user = users.get(user_id)
    if user is None:
        raise UserNotFoundError(user_id)
    if signature_data_url:
        signature_data_url = _signature_data_url(
            normalize_signature_image(_decode_signature_data_url(signature_data_url))
        )
    user.signature_data_url = signature_data_url
    updated_user = users.update(user)
    if signature_data_url:
        create_user_signature_from_data_url(db, user_id=user_id, signature_data_url=signature_data_url)
    else:
        db.query(UserSignatureORM).filter(
            UserSignatureORM.user_id == user_id,
            UserSignatureORM.status == "active",
        ).update({"status": "revoked", "revoked_at": datetime.now(timezone.utc)})
    db.commit()
    return updated_user


def _decode_signature_data_url(signature_data_url: str) -> bytes:
    if not signature_data_url.startswith("data:image/"):
        raise ValueError("서명은 이미지여야 합니다")
    header, encoded = signature_data_url.split(",", 1)
    if ";base64" in header:
        return base64.b64decode(encoded)
    return unquote_to_bytes(encoded)


def create_user_signature_from_data_url(
    db: Session,
    *,
    user_id: int,
    signature_data_url: str,
) -> UserSignatureORM:
    image_bytes = _decode_signature_data_url(signature_data_url)
    storage = LocalStorageService()
    db.query(UserSignatureORM).filter(
        UserSignatureORM.user_id == user_id,
        UserSignatureORM.status == "active",
    ).update({"status": "revoked", "revoked_at": datetime.now(timezone.utc)})
    storage_key = storage.save_bytes(image_bytes, f"signatures/{user_id}", "signature.png")
    signature = UserSignatureORM(
        user_id=user_id,
        image_storage_key=storage_key,
        checksum=hashlib.sha256(image_bytes).hexdigest(),
        status="active",
    )
    db.add(signature)
    db.flush()
    return signature


def create_user_signature(
    db: Session,
    *,
    user_id: int,
    filename: str,
    file_bytes: bytes,
    mime_type: str | None = None,
) -> UserSignatureORM:
    users = SqlAlchemyUserAccountRepository(db)
    user = users.get(user_id)
    if user is None:
        raise UserNotFoundError(user_id)

    file_bytes = normalize_signature_image(file_bytes)
    storage = LocalStorageService()
    db.query(UserSignatureORM).filter(
        UserSignatureORM.user_id == user_id,
        UserSignatureORM.status == "active",
    ).update({"status": "revoked", "revoked_at": datetime.now(timezone.utc)})
    stem = filename.rsplit(".", 1)[0] if "." in filename else filename
    storage_key = storage.save_bytes(file_bytes, f"signatures/{user_id}", f"{stem or 'signature'}.png")
    user.signature_data_url = _signature_data_url(file_bytes)
    users.update(user)
    signature = UserSignatureORM(
        user_id=user_id,
        image_storage_key=storage_key,
        checksum=hashlib.sha256(file_bytes).hexdigest(),
        status="active",
    )
    db.add(signature)
    db.commit()
    db.refresh(signature)
    return signature


def list_user_signatures(db: Session, *, user_id: int) -> list[UserSignatureORM]:
    return list(
        db.scalars(
            select(UserSignatureORM)
            .where(UserSignatureORM.user_id == user_id)
            .order_by(UserSignatureORM.created_at.desc(), UserSignatureORM.id.desc())
        ).all()
    )


def revoke_user_signature(db: Session, *, user_id: int, signature_id: int) -> None:
    signature = db.get(UserSignatureORM, signature_id)
    if signature is None or signature.user_id != user_id:
        raise ValueError("서명을 찾을 수 없습니다")
    was_active = signature.status == "active"
    signature.status = "revoked"
    signature.revoked_at = datetime.now(timezone.utc)
    if was_active:
        users = SqlAlchemyUserAccountRepository(db)
        user = users.get(user_id)
        if user is not None:
            user.signature_data_url = None
            users.update(user)
    db.commit()


def change_user_password(db: Session, user_id: int, *, current_password: str, new_password: str) -> None:
    users = SqlAlchemyUserAccountRepository(db)
    user = users.get(user_id)
    if user is None:
        raise UserNotFoundError(user_id)
    if not verify_password(current_password, user.password):
        raise InvalidCredentialsError()
    if len(new_password) < 8:
        raise ValueError("새 비밀번호는 8자 이상이어야 합니다")
    if new_password == current_password:
        raise ValueError("새 비밀번호가 현재 비밀번호와 같습니다")
    user.password = hash_password(new_password)
    users.update(user)
    _record_audit(
        SqlAlchemyAuditLogRepository(db),
        actor_user_id=user_id,
        company_id=SqlAlchemyDirectoryQueries(db).get_primary_company_id_for_user(user_id),
        target_type="useraccount",
        target_id=str(user_id),
        action="change_password",
        detail="Password changed by the account owner",
    )
    db.commit()


def admin_create_user(
    db: Session,
    actor_user_id: int,
    *,
    name: str,
    email: str,
    password: str | None = None,
    organization_id: int | None = None,
    role: str = "member",
) -> tuple[dict, str | None]:
    """System admin registers an account that can log in right away.

    Returns the user payload and, when no password was given, the generated temporary password.
    """
    from app.domain.companies.use_cases import generate_temporary_password

    users = SqlAlchemyUserAccountRepository(db)
    companies = SqlAlchemyCompanyRepository(db)
    company_members = SqlAlchemyCompanyMemberRepository(db)

    name = name.strip()
    normalized_email = email.strip().lower()
    if not name:
        raise ValueError("이름을 입력하세요")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized_email):
        raise ValueError("올바른 이메일 주소를 입력하세요")
    if users.get_by_email(normalized_email):
        raise UserAlreadyExistsError(normalized_email)
    if role not in {"member", "owner"}:
        raise ValueError("역할이 올바르지 않습니다")
    if role == "owner" and organization_id is None:
        raise ValueError("기관 관리자로 만들려면 기관을 고르세요")
    if organization_id is not None and companies.get(organization_id) is None:
        raise ValueError("기관을 찾을 수 없습니다")

    generated = not password
    initial_password = password or generate_temporary_password()
    if len(initial_password) < 8:
        raise ValueError("비밀번호는 8자 이상이어야 합니다")

    user = users.add(
        UserAccount(
            id=None,
            created_at=None,
            updated_at=None,
            username=_build_username(name, normalized_email, users),
            display_name=name,
            email=normalized_email,
            password=hash_password(initial_password),
            global_role="company_owner" if role == "owner" else "user",
            is_active=True,
            is_approved=True,
            signature_data_url=None,
        )
    )
    if organization_id is not None:
        company_members.add(
            CompanyMember(
                id=None,
                created_at=None,
                updated_at=None,
                company_id=organization_id,
                user_id=user.id or 0,
                role=role,
            )
        )
    _record_audit(
        SqlAlchemyAuditLogRepository(db),
        actor_user_id=actor_user_id,
        company_id=organization_id,
        target_type="useraccount",
        target_id=str(user.id),
        action="admin_create_user",
        detail=f"System admin created {normalized_email} ({role})",
    )
    db.commit()
    payload = next(item for item in list_users(db) if item["id"] == user.id)
    return payload, initial_password if generated else None


def admin_set_organization_role(db: Session, actor_user_id: int, user_id: int, *, role: str) -> dict:
    """System admin makes an existing member the company's admin (owner) or back to researcher."""
    from app.infrastructure.db.models import CompanyMemberORM, UserAccountORM

    if role not in {"member", "owner"}:
        raise ValueError("역할이 올바르지 않습니다")
    user = db.get(UserAccountORM, user_id)
    if user is None:
        raise UserNotFoundError(user_id)
    membership = db.scalar(
        select(CompanyMemberORM).where(CompanyMemberORM.user_id == user_id).order_by(CompanyMemberORM.id.asc())
    )
    if membership is None:
        raise ValueError("기관에 소속된 사용자만 역할을 바꿀 수 있습니다. 먼저 기관을 지정하세요.")
    if role == "member" and membership.role == "owner":
        other_owners = db.scalar(
            select(func.count(CompanyMemberORM.id)).where(
                CompanyMemberORM.company_id == membership.company_id,
                CompanyMemberORM.role == "owner",
                CompanyMemberORM.id != membership.id,
            )
        )
        if not other_owners:
            raise ValueError("기관에 관리자가 한 명은 있어야 합니다. 다른 사람을 먼저 기관 관리자로 지정하세요.")

    membership.role = role
    if user.global_role != "system_admin":
        user.global_role = "company_owner" if role == "owner" else "user"
    user.is_active = True if role == "owner" else user.is_active
    user.is_approved = True if role == "owner" else user.is_approved
    _record_audit(
        SqlAlchemyAuditLogRepository(db),
        actor_user_id=actor_user_id,
        company_id=membership.company_id,
        target_type="company_member",
        target_id=str(membership.id),
        action="admin_set_organization_role",
        detail=f"Set {user.email} as {role}",
    )
    db.commit()
    return next(item for item in list_users(db) if item["id"] == user_id)
