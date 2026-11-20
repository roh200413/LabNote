import { FormEvent, useState } from "react";

import {
  approveMembershipRequest,
  createResearcherInvitation,
  registerResearcher,
  rejectMembershipRequest,
  type MembershipRequestItem,
  type RegisteredResearcher,
} from "../api/directory";

type Props = {
  companyName: string;
  companyCode: string;
  pendingRequests: MembershipRequestItem[];
  disabled: boolean;
  /** Reloads the member list after a change. */
  onChanged: () => Promise<void>;
};

type Mode = "new" | "existing";

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function ResearcherRegistration({ companyName, companyCode, pendingRequests, disabled, onChanged }: Props) {
  const [mode, setMode] = useState<Mode>("new");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [setOwnPassword, setSetOwnPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [created, setCreated] = useState<(RegisteredResearcher & { password: string | null }) | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [requestBusy, setRequestBusy] = useState<number | null>(null);

  const reset = () => {
    setName("");
    setEmail("");
    setPassword("");
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setCreated(null);
    setBusy(true);
    try {
      if (mode === "new") {
        const result = await registerResearcher({
          name: name.trim(),
          email: email.trim(),
          password: setOwnPassword ? password : undefined,
        });
        setCreated({ ...result, password: result.temporary_password });
        reset();
      } else {
        await createResearcherInvitation(email.trim());
        setNotice(`${email.trim()} 계정을 기관에 추가했습니다.`);
        reset();
      }
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onCopy = async (key: string, value: string) => {
    if (await copyText(value)) {
      setCopied(key);
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1500);
    }
  };

  const onDecide = async (request: MembershipRequestItem, approve: boolean) => {
    if (!approve && !window.confirm(`${request.name}(${request.email})님의 가입 요청을 거절할까요?`)) return;
    setRequestBusy(request.request_id);
    setError(null);
    setNotice(null);
    try {
      if (approve) {
        await approveMembershipRequest(request.request_id);
        setNotice(`${request.name}님을 연구원으로 승인했습니다. 이제 로그인할 수 있습니다.`);
      } else {
        await rejectMembershipRequest(request.request_id);
        setNotice(`${request.name}님의 가입 요청을 거절했습니다.`);
      }
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRequestBusy(null);
    }
  };

  const signupGuide = `LabNote 회원가입 화면에서 계정 유형 '사용자'를 고르고 기관 코드 ${companyCode} 를 입력하세요. (기관: ${companyName})`;

  return (
    <>
      {pendingRequests.length > 0 && (
        <section className="card researcher-requests">
          <div className="section-head">
            <h3>
              가입 요청 <span className="researcher-count-badge">{pendingRequests.length}</span>
            </h3>
            <span>기관 코드로 가입한 연구원입니다. 승인하면 바로 로그인할 수 있습니다.</span>
          </div>
          <ul className="list">
            {pendingRequests.map((request) => (
              <li key={request.request_id} className="plain-list-item researcher-row">
                <div>
                  <strong>{request.name}</strong>
                  <span>
                    {request.email}
                    {request.requested_at ? ` · ${request.requested_at.slice(0, 10)} 요청` : ""}
                  </span>
                </div>
                <div className="researcher-request-actions">
                  <button
                    type="button"
                    className="compact-button"
                    disabled={requestBusy !== null}
                    onClick={() => void onDecide(request, true)}
                  >
                    승인
                  </button>
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    disabled={requestBusy !== null}
                    onClick={() => void onDecide(request, false)}
                  >
                    거절
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card researcher-register">
        <div className="section-head">
          <h3>연구원 등록</h3>
          <div className="segmented-control" role="tablist" aria-label="등록 방식">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "new"}
              className={mode === "new" ? "active" : ""}
              onClick={() => setMode("new")}
            >
              새 계정 만들기
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "existing"}
              className={mode === "existing" ? "active" : ""}
              onClick={() => setMode("existing")}
            >
              기존 계정 추가
            </button>
          </div>
        </div>
        <p className="context-copy">
          {mode === "new"
            ? "관리자가 연구원 계정을 바로 만듭니다. 만든 계정은 승인 없이 즉시 로그인할 수 있습니다."
            : "이미 LabNote에 가입했지만 기관이 없는 계정을 이메일로 찾아 기관에 추가합니다."}
        </p>

        <form onSubmit={onSubmit} className="researcher-register-form">
          {mode === "new" && (
            <label>
              이름
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" required disabled={disabled || busy} />
            </label>
          )}
          <label>
            이메일
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="researcher@example.com"
              required
              disabled={disabled || busy}
            />
          </label>
          {mode === "new" && (
            <div className="researcher-password-field">
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={setOwnPassword}
                  onChange={(e) => setSetOwnPassword(e.target.checked)}
                  disabled={disabled || busy}
                />
                초기 비밀번호 직접 정하기
              </label>
              {setOwnPassword ? (
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="8자 이상"
                  minLength={8}
                  required
                  autoComplete="new-password"
                  disabled={disabled || busy}
                />
              ) : (
                <span className="field-hint">임시 비밀번호를 자동으로 만들어 등록 후 한 번 보여줍니다.</span>
              )}
            </div>
          )}
          <button type="submit" className="compact-button researcher-register-submit" disabled={disabled || busy}>
            {busy ? "처리 중..." : mode === "new" ? "계정 만들기" : "기관에 추가"}
          </button>
        </form>

        {error && <p className="error">오류: {error}</p>}
        {notice && <p className="success-copy">{notice}</p>}

        {created && (
          <div className="researcher-created" role="status">
            <strong>{created.name}님의 계정을 만들었습니다.</strong>
            <p>아래 정보를 연구원에게 전달하세요. 로그인한 뒤 프로필에서 비밀번호를 바꾸도록 안내해 주세요.</p>
            <dl>
              <div>
                <dt>아이디(이메일)</dt>
                <dd>
                  <code>{created.email}</code>
                  <button type="button" className="secondary-button compact-button" onClick={() => void onCopy("email", created.email)}>
                    {copied === "email" ? "복사됨" : "복사"}
                  </button>
                </dd>
              </div>
              {created.password ? (
                <div>
                  <dt>임시 비밀번호</dt>
                  <dd>
                    <code>{created.password}</code>
                    <button
                      type="button"
                      className="secondary-button compact-button"
                      onClick={() => void onCopy("password", created.password ?? "")}
                    >
                      {copied === "password" ? "복사됨" : "복사"}
                    </button>
                  </dd>
                </div>
              ) : (
                <div>
                  <dt>비밀번호</dt>
                  <dd>직접 정한 비밀번호</dd>
                </div>
              )}
            </dl>
            {created.password && <p className="field-hint">임시 비밀번호는 이 화면을 벗어나면 다시 볼 수 없습니다.</p>}
            <button type="button" className="secondary-button compact-button" onClick={() => setCreated(null)}>
              닫기
            </button>
          </div>
        )}

        <div className="researcher-code-guide">
          <div>
            <strong>연구원이 직접 가입하게 하려면</strong>
            <p>
              기관 코드 <code>{companyCode || "-"}</code> 를 알려주세요. 회원가입 후 위 <b>가입 요청</b>에 나타나면 승인하면 됩니다.
            </p>
          </div>
          <button
            type="button"
            className="secondary-button compact-button"
            disabled={!companyCode}
            onClick={() => void onCopy("guide", signupGuide)}
          >
            {copied === "guide" ? "복사됨" : "안내 문구 복사"}
          </button>
        </div>
      </section>
    </>
  );
}
