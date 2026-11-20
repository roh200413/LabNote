import { FormEvent, useState } from "react";

import { changeMyPassword } from "../api/auth";

export function PasswordChangeCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setDone(false);
    if (next !== confirm) {
      setError("새 비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setBusy(true);
    try {
      await changeMyPassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="card">
      <div className="section-head">
        <h3>비밀번호 변경</h3>
      </div>
      <p className="context-copy">관리자가 만든 임시 비밀번호로 로그인했다면 여기서 바꿔 주세요.</p>
      <form className="form-stack password-change-form" onSubmit={onSubmit}>
        <label>
          현재 비밀번호
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </label>
        <label>
          새 비밀번호
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            minLength={8}
            placeholder="8자 이상"
            autoComplete="new-password"
            required
          />
        </label>
        <label>
          새 비밀번호 확인
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </label>
        {mismatch && <p className="error">새 비밀번호 확인이 일치하지 않습니다.</p>}
        {error && <p className="error">오류: {error}</p>}
        {done && <p className="success-copy">비밀번호를 바꿨습니다.</p>}
        <button type="submit" className="compact-button" disabled={busy || mismatch}>
          {busy ? "변경 중..." : "비밀번호 변경"}
        </button>
      </form>
    </article>
  );
}
