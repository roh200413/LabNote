import { useEffect, useState } from "react";

import {
  getNoteActivity,
  resetActivityRules,
  saveActivityRules,
  type ActivityRules,
  type NoteActivity,
} from "../api/projectData";

type Props = {
  projectId: string;
  /** Changes when notes change, so the panel reloads. */
  refreshKey?: number;
};

/** Project dashboard: who is keeping up with research notes, and who needs a nudge. */
export function NoteActivityPanel({ projectId, refreshKey = 0 }: Props) {
  const [data, setData] = useState<NoteActivity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<ActivityRules | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    getNoteActivity(projectId)
      .then((result) => live && (setData(result), setError(null)))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [projectId, refreshKey, reloadKey]);

  const saveRules = async (reset = false) => {
    if (!editing) return;
    setSaving(true);
    try {
      if (reset) await resetActivityRules(projectId);
      else await saveActivityRules(projectId, editing);
      setEditing(null);
      setReloadKey((value) => value + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (error) return <section className="card note-activity"><p className="error">작성 현황: {error}</p></section>;
  if (!data) return <section className="card note-activity"><p className="field-hint">작성 현황을 불러오는 중...</p></section>;

  const flagged = data.members.filter((member) => member.needs_attention);
  const rows = showAll ? data.members : flagged;
  const targetText = data.monthly_target ? ` / 목표 ${data.monthly_target}건` : "";
  const r = data.rules;
  const ruleText = [
    r.inactive_days ? `${r.inactive_days}일 이상 미작성` : null,
    r.check_rejected ? "반려 미처리" : null,
    r.stale_draft_days ? `${r.stale_draft_days}일 넘은 초안` : null,
    r.review_wait_days ? `${r.review_wait_days}일 넘은 결재 대기` : null,
    r.check_monthly_pace && data.monthly_target ? "월 목표 대비 진도" : null,
  ].filter(Boolean);

  return (
    <section className="card note-activity">
      <div className="note-activity-head">
        <div>
          <h4>연구노트 작성 현황</h4>
          <p className="field-hint">
            이번 달 {data.month_total}건{targetText} · 참여 연구원 {data.member_count}명 · 관리 기준
            {r.is_custom ? "(프로젝트 설정)" : "(기본값)"}: {ruleText.length ? ruleText.join(", ") : "모두 끔"}
          </p>
        </div>
        <div className="note-activity-head-side">
          <div className={`note-activity-badge${data.attention_count ? " warn" : " ok"}`}>
            {data.attention_count ? `관리 필요 ${data.attention_count}명` : "모두 잘 관리되고 있음"}
          </div>
          {data.can_manage_rules && !editing && (
            <button type="button" className="secondary-button compact-button" onClick={() => setEditing({ ...data.rules })}>
              기준 설정
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="note-activity-rules">
          <p className="field-hint">일수를 0으로 두면 그 항목은 확인하지 않습니다. 월 목표는 '프로젝트 편집'에서 정합니다.</p>
          <div className="note-activity-rule-grid">
            <label>
              노트를 안 쓴 지
              <span>
                <input type="number" min={0} max={365} value={editing.inactive_days}
                  onChange={(event) => setEditing({ ...editing, inactive_days: Number(event.target.value) })} />
                일 이상
              </span>
            </label>
            <label>
              초안을 제출 안 한 지
              <span>
                <input type="number" min={0} max={365} value={editing.stale_draft_days}
                  onChange={(event) => setEditing({ ...editing, stale_draft_days: Number(event.target.value) })} />
                일 이상
              </span>
            </label>
            <label>
              결재를 안 한 지 (검토자)
              <span>
                <input type="number" min={0} max={365} value={editing.review_wait_days}
                  onChange={(event) => setEditing({ ...editing, review_wait_days: Number(event.target.value) })} />
                일 이상
              </span>
            </label>
            <label className="note-activity-check">
              <input type="checkbox" checked={editing.check_rejected}
                onChange={(event) => setEditing({ ...editing, check_rejected: event.target.checked })} />
              반려된 노트를 안 고침
            </label>
            <label className="note-activity-check">
              <input type="checkbox" checked={editing.check_monthly_pace}
                onChange={(event) => setEditing({ ...editing, check_monthly_pace: event.target.checked })} />
              월 목표 대비 진도가 늦음 (월 목표 ÷ 인원, 8일부터)
            </label>
          </div>
          <div className="note-activity-rule-actions">
            <button type="button" className="compact-button" onClick={() => void saveRules()} disabled={saving}>
              {saving ? "저장 중..." : "저장"}
            </button>
            <button type="button" className="secondary-button compact-button" onClick={() => setEditing(null)} disabled={saving}>
              취소
            </button>
            {r.is_custom && (
              <button type="button" className="link-button" onClick={() => void saveRules(true)} disabled={saving}>
                기본값으로 되돌리기 (14일 · 7일 · 7일)
              </button>
            )}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="note-activity-empty">관리가 필요한 연구원이 없습니다.</p>
      ) : (
        <div className="table-shell">
          <table className="admin-table note-activity-table">
            <thead>
              <tr>
                <th>연구원</th>
                <th>이번 달</th>
                <th>전체</th>
                <th>마지막 작성</th>
                <th>초안·반려·결재대기</th>
                <th>확인할 점</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((member) => (
                <tr key={member.company_member_id} className={member.needs_attention ? "attention" : ""}>
                  <td>
                    <strong>{member.name}</strong>
                    {member.is_lead && <span className="note-activity-lead">책임자</span>}
                    <span className="note-activity-sub">{member.email}</span>
                  </td>
                  <td>
                    {member.this_month}
                    {member.monthly_share ? <span className="note-activity-sub">/ {member.monthly_share}</span> : null}
                  </td>
                  <td>{member.total}</td>
                  <td>
                    {member.last_written ?? "-"}
                    {member.days_since_last != null && <span className="note-activity-sub">{member.days_since_last}일 전</span>}
                  </td>
                  <td>
                    {member.drafts} · {member.rejected} · {member.waiting_review}
                  </td>
                  <td>
                    {member.issues.length === 0 ? (
                      <span className="note-activity-ok">정상</span>
                    ) : (
                      <ul className="note-activity-issues">
                        {member.issues.map((issue) => (
                          <li key={issue}>{issue}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.members.length > flagged.length && (
        <button type="button" className="link-button note-activity-toggle" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "관리 필요 인원만 보기" : `전체 연구원 보기 (${data.members.length}명)`}
        </button>
      )}
    </section>
  );
}
