import { FormEvent, useState } from "react";

import { createAdminUser, type Organization } from "../api/admin";

type Props = {
  organizations: Organization[];
  onCreated: () => Promise<void>;
};

type Created = { name: string; email: string; password: string | null; organization: string; role: string };

export function AdminUserCreateForm({ organizations, onCreated }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organizationId, setOrganizationId] = useState("");
  const [role, setRole] = useState<"member" | "owner">("member");
  const [ownPassword, setOwnPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const orgId = organizationId ? Number(organizationId) : null;
      const result = await createAdminUser({
        name: name.trim(),
        email: email.trim(),
        password: ownPassword ? password : undefined,
        organization_id: orgId,
        role: orgId ? role : "member",
      });
      setCreated({
        name: result.user.name,
        email: result.user.email,
        password: result.temporary_password,
        organization: organizations.find((item) => item.id === orgId)?.name ?? "기관 없음",
        role: result.user.is_org_owner ? "기관 관리자" : "연구원",
      });
      setName("");
      setEmail("");
      setPassword("");
      await onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
    } catch {
      // Clipboard may be blocked; the value is still visible to copy by hand.
    }
  };

  return (
    <section className="card admin-user-create">
      <div className="section-head">
        <div>
          <p className="eyebrow">계정 만들기</p>
          <h2>사용자 등록</h2>
        </div>
        <button type="button" className={open ? "secondary-button compact-button" : "compact-button"} onClick={() => setOpen((value) => !value)}>
          {open ? "접기" : "+ 사용자 등록"}
        </button>
      </div>

      {open && (
        <form className="admin-user-create-form" onSubmit={onSubmit}>
          <label>
            이름
            <input value={name} onChange={(e) => setName(e.target.value)} required disabled={busy} />
          </label>
          <label>
            이메일
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={busy} />
          </label>
          <label>
            기관
            <select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)} disabled={busy}>
              <option value="">기관 없음 (개인 계정)</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>
                  {organization.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            역할
            <select value={role} onChange={(e) => setRole(e.target.value as "member" | "owner")} disabled={busy || !organizationId}>
              <option value="member">연구원</option>
              <option value="owner">기관 관리자</option>
            </select>
          </label>
          <div className="admin-user-password">
            <label className="checkbox-inline">
              <input type="checkbox" checked={ownPassword} onChange={(e) => setOwnPassword(e.target.checked)} disabled={busy} />
              비밀번호 직접 정하기
            </label>
            {ownPassword ? (
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                placeholder="8자 이상"
                autoComplete="new-password"
                required
                disabled={busy}
              />
            ) : (
              <span className="field-hint">임시 비밀번호를 자동으로 만들어 한 번 보여줍니다.</span>
            )}
          </div>
          <button type="submit" className="compact-button" disabled={busy}>
            {busy ? "등록 중..." : "등록"}
          </button>
        </form>
      )}

      {error && <p className="error">오류: {error}</p>}

      {created && (
        <div className="researcher-created" role="status">
          <strong>
            {created.name} 계정을 만들었습니다 · {created.organization} · {created.role}
          </strong>
          <p>바로 로그인할 수 있습니다. 로그인 후 프로필에서 비밀번호를 바꾸도록 안내하세요.</p>
          <dl>
            <div>
              <dt>아이디(이메일)</dt>
              <dd>
                <code>{created.email}</code>
                <button type="button" className="secondary-button compact-button" onClick={() => void copy("email", created.email)}>
                  {copied === "email" ? "복사됨" : "복사"}
                </button>
              </dd>
            </div>
            <div>
              <dt>{created.password ? "임시 비밀번호" : "비밀번호"}</dt>
              <dd>
                {created.password ? (
                  <>
                    <code>{created.password}</code>
                    <button type="button" className="secondary-button compact-button" onClick={() => void copy("password", created.password ?? "")}>
                      {copied === "password" ? "복사됨" : "복사"}
                    </button>
                  </>
                ) : (
                  "직접 정한 비밀번호"
                )}
              </dd>
            </div>
          </dl>
          {created.password && <p className="field-hint">임시 비밀번호는 이 화면을 벗어나면 다시 볼 수 없습니다.</p>}
          <button type="button" className="secondary-button compact-button" onClick={() => setCreated(null)}>
            닫기
          </button>
        </div>
      )}
    </section>
  );
}
