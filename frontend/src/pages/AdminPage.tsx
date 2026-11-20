import { Fragment, FormEvent, useEffect, useMemo, useState } from "react";

import {
  approveOrganization,
  createOrganization,
  getAdminDashboard,
  listAdminUsers,
  listOrganizations,
  listPendingOrganizations,
  rejectOrganization,
  setAdminUserOrganizationRole,
  updateAdminUser,
  updateOrganization,
  type AdminDashboard,
  type AdminUser,
  type Organization,
} from "../api/admin";
import { listAdminFeedback } from "../api/feedback";
import { AdminFeedbackPanel } from "../components/AdminFeedbackPanel";
import { AdminUserCreateForm } from "../components/AdminUserCreateForm";
import { adminPath, parseAdminSection, writePath } from "../lib/routes";

type AdminSection = "dashboard" | "approvals" | "users" | "organizations" | "feedback";
const ADMIN_SECTIONS: readonly AdminSection[] = ["dashboard", "approvals", "users", "organizations", "feedback"];
type RoleFilter = "all" | "admin" | "owner" | "member" | "personal";
type StatusFilter = "all" | "active" | "inactive" | "pending";
type Notice = { kind: "success" | "error"; text: string } | null;

const sections: Array<{ id: AdminSection; label: string; hint: string }> = [
  { id: "dashboard", label: "대시보드", hint: "개요 및 접속 현황" },
  { id: "approvals", label: "승인", hint: "기관 가입 신청" },
  { id: "users", label: "사용자", hint: "계정 및 권한" },
  { id: "organizations", label: "기관", hint: "기관 정보" },
  { id: "feedback", label: "의견", hint: "사용자 불편사항·문의" },
];

const APPROVAL_LABELS: Record<string, string> = { approved: "승인됨", pending: "승인 대기", rejected: "반려됨" };
const EVENT_LABELS: Record<string, string> = { login: "로그인", login_failed: "로그인 실패", logout: "로그아웃" };

/** API timestamps are UTC without a zone suffix; read them as UTC. */
function parseUtc(iso: string): Date {
  const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso.replace(" ", "T")}Z`;
  return new Date(normalized);
}

function formatDateTime(iso: string) {
  return parseUtc(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string) {
  return parseUtc(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "numeric", day: "numeric" });
}

function relativeTime(iso: string) {
  const diff = Date.now() - parseUtc(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.round(hours / 24)}일 전`;
}

function roleOf(user: AdminUser): Exclude<RoleFilter, "all"> {
  if (user.is_admin) return "admin";
  if (user.is_org_owner) return "owner";
  return user.organization_id ? "member" : "personal";
}

const ROLE_LABELS: Record<Exclude<RoleFilter, "all">, string> = {
  admin: "시스템 관리자",
  owner: "기관 관리자",
  member: "연구원",
  personal: "개인 사용자",
};

function ApprovalPill({ status }: { status: string }) {
  const key = status.toLowerCase();
  return <span className={`admin-status-pill status-${key}`}>{APPROVAL_LABELS[key] ?? status}</span>;
}

export function AdminPage({ currentUserId }: { currentUserId?: number }) {
  const [activeSection, setActiveSection] = useState<AdminSection>(() =>
    parseAdminSection(window.location.pathname, ADMIN_SECTIONS, "dashboard")
  );

  // /admin/{section} in the address bar, so refresh and back/forward keep the section.
  useEffect(() => {
    writePath(adminPath(activeSection, "dashboard"), false);
  }, [activeSection]);
  useEffect(() => {
    const onPop = () => setActiveSection(parseAdminSection(window.location.pathname, ADMIN_SECTIONS, "dashboard"));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [pendingOrganizations, setPendingOrganizations] = useState<Organization[]>([]);
  const [feedbackOpenCount, setFeedbackOpenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  // users filters
  const [userQuery, setUserQuery] = useState("");
  const [userOrganizationFilter, setUserOrganizationFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // organizations
  const [orgName, setOrgName] = useState("");
  const [orgCode, setOrgCode] = useState("");
  const [orgQuery, setOrgQuery] = useState("");
  const [editingOrgId, setEditingOrgId] = useState<number | null>(null);
  const [editingOrgName, setEditingOrgName] = useState("");

  const refresh = async () => {
    try {
      const [dashboardData, userData, organizationData, pendingOrganizationData] = await Promise.all([
        getAdminDashboard(),
        listAdminUsers(),
        listOrganizations(),
        listPendingOrganizations(),
      ]);
      setDashboard(dashboardData);
      setUsers(userData);
      setOrganizations(organizationData);
      setPendingOrganizations(pendingOrganizationData);
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setLoading(false);
    }
    try {
      setFeedbackOpenCount((await listAdminFeedback("open")).open_count);
    } catch {
      // the feedback panel reports its own errors
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (notice?.kind !== "success") return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /** Runs one admin change with a busy flag, a refresh, and a notice. */
  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusyKey(key);
    setNotice(null);
    try {
      await action();
      await refresh();
      setNotice({ kind: "success", text: success });
    } catch (err) {
      setNotice({ kind: "error", text: (err as Error).message });
    } finally {
      setBusyKey(null);
    }
  };

  const userPayload = (user: AdminUser) => ({
    name: user.name,
    is_active: user.is_active,
    is_admin: user.is_admin,
    organization_id: user.organization_id,
  });

  const onToggleUserActive = (user: AdminUser) => {
    if (user.is_active && !window.confirm(`${user.name}(${user.email}) 계정을 비활성화할까요? 이 사용자는 더 이상 로그인할 수 없습니다.`)) return;
    void run(
      `active-${user.id}`,
      () => updateAdminUser(user.id, { ...userPayload(user), is_active: !user.is_active }),
      user.is_active ? `${user.name} 계정을 비활성화했습니다.` : `${user.name} 계정을 활성화했습니다.`
    );
  };

  const onToggleUserAdmin = (user: AdminUser) => {
    const message = user.is_admin
      ? `${user.name}님의 시스템 관리자 권한을 해제할까요?`
      : `${user.name}(${user.email})님을 시스템 관리자로 지정할까요? 모든 기관과 사용자를 관리할 수 있게 됩니다.`;
    if (!window.confirm(message)) return;
    void run(
      `admin-${user.id}`,
      () => updateAdminUser(user.id, { ...userPayload(user), is_admin: !user.is_admin }),
      user.is_admin ? "시스템 관리자 권한을 해제했습니다." : "시스템 관리자로 지정했습니다."
    );
  };

  const onToggleOrganizationRole = (user: AdminUser) => {
    const nextRole = user.is_org_owner ? "member" : "owner";
    const message = nextRole === "owner"
      ? `${user.name}(${user.email})님을 기관 관리자로 지정할까요? 노트 포맷, 연구원 관리, GitHub 계정 연동 등을 바꿀 수 있게 됩니다.`
      : `${user.name}(${user.email})님을 연구원으로 바꿀까요? 기관 관리 권한이 없어집니다.`;
    if (!window.confirm(message)) return;
    void run(
      `role-${user.id}`,
      () => setAdminUserOrganizationRole(user.id, nextRole),
      nextRole === "owner" ? "기관 관리자로 지정했습니다." : "연구원으로 변경했습니다."
    );
  };

  const onAssignOrganization = (user: AdminUser, organizationId: number) => {
    const target = organizations.find((organization) => organization.id === organizationId);
    if (!target || organizationId === user.organization_id) return;
    const message = user.organization_id === null
      ? `${user.name}님을 ${target.name}의 연구원으로 추가할까요?`
      : `${user.name}님을 ${target.name}(으)로 옮길까요? 새 기관에서는 연구원 권한으로 시작합니다.`;
    if (!window.confirm(message)) return;
    void run(
      `org-${user.id}`,
      () => updateAdminUser(user.id, { ...userPayload(user), organization_id: organizationId }),
      `${user.name}님의 기관을 ${target.name}(으)로 변경했습니다.`
    );
  };

  const onApproveOrganization = (organization: Organization) =>
    void run(`approve-${organization.id}`, () => approveOrganization(organization.id), `${organization.name} 가입을 승인했습니다.`);

  const onRejectOrganization = (organization: Organization) => {
    if (!window.confirm(`${organization.name}의 가입 신청을 반려할까요?`)) return;
    void run(`reject-${organization.id}`, () => rejectOrganization(organization.id), `${organization.name} 가입 신청을 반려했습니다.`);
  };

  const onToggleOrganization = (organization: Organization) => {
    if (organization.is_active && !window.confirm(`${organization.name}을(를) 비활성화할까요? 소속 사용자가 기관 기능을 쓸 수 없게 됩니다.`)) return;
    void run(
      `org-active-${organization.id}`,
      () => updateOrganization(organization.id, { is_active: !organization.is_active }),
      organization.is_active ? `${organization.name}을(를) 비활성화했습니다.` : `${organization.name}을(를) 활성화했습니다.`
    );
  };

  const onSaveOrganizationName = (organization: Organization) => {
    const name = editingOrgName.trim();
    if (!name || name === organization.name) {
      setEditingOrgId(null);
      return;
    }
    void run(`org-name-${organization.id}`, async () => {
      await updateOrganization(organization.id, { name });
      setEditingOrgId(null);
    }, "기관 이름을 바꿨습니다.");
  };

  const onCreateOrganization = (event: FormEvent) => {
    event.preventDefault();
    const name = orgName.trim();
    if (!name) return;
    void run("org-create", async () => {
      await createOrganization({ name, code: orgCode.trim() || undefined });
      setOrgName("");
      setOrgCode("");
    }, `${name} 기관을 만들었습니다.`);
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setNotice({ kind: "success", text: `기관 코드 ${code}를 복사했습니다.` });
    } catch {
      setNotice({ kind: "error", text: "클립보드에 복사하지 못했습니다." });
    }
  };

  const showUsersOf = (organizationId: number) => {
    setUserOrganizationFilter(String(organizationId));
    setUserQuery("");
    setRoleFilter("all");
    setStatusFilter("all");
    setActiveSection("users");
  };

  // ── derived data ───────────────────────────────────────────────
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const memberCountByOrganization = useMemo(() => {
    const counts = new Map<number, number>();
    users.forEach((user) => {
      if (user.organization_id !== null) counts.set(user.organization_id, (counts.get(user.organization_id) ?? 0) + 1);
    });
    return counts;
  }, [users]);
  const organizationNameById = new Map(organizations.map((organization) => [organization.id, organization.name]));

  const normalizedQuery = userQuery.trim().toLowerCase();
  const filteredUsers = users.filter((user) => {
    const orgKey = user.organization_id === null ? "none" : String(user.organization_id);
    if (userOrganizationFilter !== "all" && orgKey !== userOrganizationFilter) return false;
    if (roleFilter !== "all" && roleOf(user) !== roleFilter) return false;
    if (statusFilter === "active" && !user.is_active) return false;
    if (statusFilter === "inactive" && user.is_active) return false;
    if (statusFilter === "pending" && user.approval_status !== "pending") return false;
    if (normalizedQuery && !`${user.name} ${user.email}`.toLowerCase().includes(normalizedQuery)) return false;
    return true;
  });

  const groupMap = new Map<string, { key: string; label: string; users: AdminUser[] }>();
  filteredUsers.forEach((user) => {
    const key = user.organization_id === null ? "none" : String(user.organization_id);
    const label = user.organization_id === null
      ? "기관 없음"
      : organizationNameById.get(user.organization_id) ?? `기관 #${user.organization_id}`;
    const group = groupMap.get(key) ?? { key, label, users: [] };
    group.users.push(user);
    groupMap.set(key, group);
  });
  const userGroups = [
    ...organizations.map((organization) => groupMap.get(String(organization.id))).filter((group): group is NonNullable<typeof group> => Boolean(group)),
    ...Array.from(groupMap.values()).filter((group) => group.key === "none" || !organizationNameById.has(Number(group.key))),
  ];
  const filtersActive = Boolean(normalizedQuery) || userOrganizationFilter !== "all" || roleFilter !== "all" || statusFilter !== "all";

  const normalizedOrgQuery = orgQuery.trim().toLowerCase();
  const filteredOrganizations = organizations.filter((organization) =>
    !normalizedOrgQuery || `${organization.name} ${organization.code}`.toLowerCase().includes(normalizedOrgQuery)
  );

  const pendingCount = pendingOrganizations.length;
  const activeAdmins = users.filter((user) => user.is_admin && user.is_active).length;
  const loginMax = Math.max(1, ...(dashboard?.logins_by_day.map((point) => point.count) ?? [0]));
  const activeMeta = sections.find((section) => section.id === activeSection) ?? sections[0];

  const ownerLabel = (organization: Organization) => {
    const owner = organization.owner_user_id === null ? undefined : usersById.get(organization.owner_user_id);
    if (!owner) return <span className="admin-muted">-</span>;
    return (
      <span className="admin-person">
        <strong>{owner.name}</strong>
        <span>{owner.email}</span>
      </span>
    );
  };

  const navBadge = (id: AdminSection) => {
    if (id === "approvals" && pendingCount > 0) return pendingCount;
    if (id === "feedback" && feedbackOpenCount > 0) return feedbackOpenCount;
    return null;
  };

  // ── sections ──────────────────────────────────────────────────
  const renderApprovalRows = (list: Organization[]) =>
    list.map((organization) => (
      <tr key={organization.id}>
        <td>
          <strong className="admin-cell-title">{organization.name}</strong>
        </td>
        <td>{ownerLabel(organization)}</td>
        <td><code className="admin-code">{organization.code}</code></td>
        <td className="admin-nowrap">{formatDate(organization.created_at)}</td>
        <td>
          <div className="table-actions">
            <button
              type="button"
              className="compact-button"
              disabled={busyKey !== null}
              onClick={() => onApproveOrganization(organization)}
            >
              승인
            </button>
            <button
              type="button"
              className="secondary-button compact-button admin-danger-text"
              disabled={busyKey !== null}
              onClick={() => onRejectOrganization(organization)}
            >
              반려
            </button>
          </div>
        </td>
      </tr>
    ));

  const approvalTable = (list: Organization[]) => (
    <div className="table-shell">
      <table className="admin-table">
        <thead>
          <tr>
            <th>기관</th>
            <th>신청자</th>
            <th>기관 코드</th>
            <th>신청일</th>
            <th>작업</th>
          </tr>
        </thead>
        <tbody>{renderApprovalRows(list)}</tbody>
      </table>
    </div>
  );

  return (
    <div className="admin-console">
      <aside className="admin-console-sidebar">
        <div className="admin-sidebar-title">
          <p className="eyebrow">관리자</p>
          <h2>콘솔</h2>
        </div>
        <nav className="admin-side-nav" aria-label="관리 메뉴">
          {sections.map((section) => {
            const badge = navBadge(section.id);
            return (
              <button
                key={section.id}
                type="button"
                className={`admin-side-nav-item${activeSection === section.id ? " active" : ""}`}
                onClick={() => setActiveSection(section.id)}
              >
                <strong>
                  {section.label}
                  {badge !== null && <em className="admin-nav-badge">{badge}</em>}
                </strong>
                <span>{section.hint}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="admin-main">
        <header className="admin-summary-header">
          <div className="admin-summary-copy">
            <p className="eyebrow">시스템 관리자</p>
            <h2>{activeMeta.label}</h2>
            <span>{activeMeta.hint}</span>
          </div>
          <div className="admin-summary-actions">
            <div className="admin-summary-strip" aria-label="시스템 요약">
              <span>승인 대기 <strong>{pendingCount}</strong></span>
              <span>사용자 <strong>{users.length}</strong></span>
              <span>기관 <strong>{organizations.length}</strong></span>
            </div>
            <button
              type="button"
              className="secondary-button compact-button"
              disabled={loading || busyKey !== null}
              onClick={() => { setLoading(true); void refresh(); }}
            >
              {loading ? "불러오는 중..." : "새로고침"}
            </button>
          </div>
        </header>

        {notice && (
          <div className={`admin-notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
            <span>{notice.text}</span>
            <button type="button" aria-label="알림 닫기" onClick={() => setNotice(null)}>×</button>
          </div>
        )}

        <section className="admin-panel">
          {activeSection === "dashboard" && (
            <div className="admin-stack">
              <section className="dashboard-grid dashboard-grid-4">
                <button type="button" className="metric-card admin-metric-link" onClick={() => setActiveSection("users")}>
                  <p>전체 사용자</p>
                  <strong>{users.length}</strong>
                  <span>활성 {users.filter((user) => user.is_active).length}명</span>
                </button>
                <button type="button" className="metric-card admin-metric-link" onClick={() => setActiveSection("organizations")}>
                  <p>기관</p>
                  <strong>{organizations.length}</strong>
                  <span>활성 {organizations.filter((organization) => organization.is_active).length}곳</span>
                </button>
                <button type="button" className="metric-card admin-metric-link" onClick={() => { setRoleFilter("admin"); setActiveSection("users"); }}>
                  <p>활성 관리자</p>
                  <strong>{activeAdmins}</strong>
                  <span>시스템 관리자</span>
                </button>
                <button type="button" className="metric-card admin-metric-link" onClick={() => setActiveSection("approvals")}>
                  <p>승인 대기 기관</p>
                  <strong>{pendingCount}</strong>
                  <span>{pendingCount > 0 ? "검토가 필요합니다" : "모두 처리됨"}</span>
                </button>
              </section>

              {pendingCount > 0 && (
                <section className="card admin-callout">
                  <div className="section-head">
                    <div>
                      <p className="eyebrow">할 일</p>
                      <h2>가입 승인을 기다리는 기관 {pendingCount}곳</h2>
                    </div>
                    {pendingCount > 3 && (
                      <button type="button" className="secondary-button compact-button" onClick={() => setActiveSection("approvals")}>
                        모두 보기
                      </button>
                    )}
                  </div>
                  {approvalTable(pendingOrganizations.slice(0, 3))}
                </section>
              )}

              <div className="admin-dashboard-split">
                <section className="card">
                  <div className="section-head">
                    <div>
                      <p className="eyebrow">접속 현황</p>
                      <h2>최근 7일 로그인</h2>
                    </div>
                    <span className="admin-muted">
                      합계 {dashboard?.logins_by_day.reduce((sum, point) => sum + point.count, 0) ?? 0}회
                    </span>
                  </div>
                  <div className="admin-login-chart" role="img" aria-label="최근 7일 일별 로그인 수">
                    {dashboard?.logins_by_day.map((point) => (
                      <div key={point.date} className="admin-login-col">
                        <span className="admin-login-value">{point.count}</span>
                        <div className="admin-login-track">
                          <div
                            className={`admin-login-bar${point.count === 0 ? " empty" : ""}`}
                            style={{ height: `${point.count === 0 ? 3 : Math.max(6, (point.count / loginMax) * 100)}%` }}
                          />
                        </div>
                        <span className="admin-login-label">{Number(point.date.slice(5, 7))}/{Number(point.date.slice(8, 10))}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="card">
                  <div className="section-head">
                    <div>
                      <p className="eyebrow">최근 접속</p>
                      <h2>최근 로그인한 사용자</h2>
                    </div>
                  </div>
                  {dashboard && dashboard.recent_logins.length === 0 ? (
                    <p className="admin-empty">최근 로그인 기록이 없습니다.</p>
                  ) : (
                    <ul className="admin-activity-list">
                      {dashboard?.recent_logins.map((event) => {
                        const person = usersById.get(event.user_id);
                        return (
                          <li key={event.id}>
                            <span className="admin-avatar" aria-hidden>{(person?.name || event.email || "?").slice(0, 1).toUpperCase()}</span>
                            <span className="admin-person">
                              <strong>{person?.name ?? event.email}</strong>
                              <span>{person ? event.email : EVENT_LABELS[event.event_type] ?? event.event_type}</span>
                            </span>
                            <time dateTime={event.occurred_at} title={formatDateTime(event.occurred_at)}>
                              {relativeTime(event.occurred_at)}
                            </time>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </div>
            </div>
          )}

          {activeSection === "approvals" && (
            <section className="card">
              <div className="section-head">
                <div>
                  <p className="eyebrow">승인 대기열</p>
                  <h2>가입 신청한 기관</h2>
                </div>
              </div>
              <p className="admin-section-note">
                승인하면 기관이 활성화되고 신청자가 기관 관리자로 로그인할 수 있습니다.
              </p>
              {pendingCount === 0 ? (
                <p className="admin-empty">승인을 기다리는 기관이 없습니다.</p>
              ) : (
                approvalTable(pendingOrganizations)
              )}
            </section>
          )}

          {activeSection === "users" && (
            <div className="admin-stack">
              <AdminUserCreateForm organizations={organizations} onCreated={refresh} />
              <section className="card">
                <div className="section-head">
                  <div>
                    <p className="eyebrow">계정 관리</p>
                    <h2>사용자 목록</h2>
                  </div>
                  <span className="admin-muted">
                    {filtersActive ? `${users.length}명 중 ${filteredUsers.length}명` : `${users.length}명`}
                  </span>
                </div>
                <div className="admin-filter-bar">
                  <label className="admin-filter-field admin-filter-search">
                    검색
                    <input
                      type="search"
                      value={userQuery}
                      placeholder="이름 또는 이메일"
                      onChange={(event) => setUserQuery(event.target.value)}
                    />
                  </label>
                  <label className="admin-filter-field">
                    기관
                    <select value={userOrganizationFilter} onChange={(event) => setUserOrganizationFilter(event.target.value)}>
                      <option value="all">전체 기관</option>
                      <option value="none">기관 없음</option>
                      {organizations.map((organization) => (
                        <option key={organization.id} value={organization.id}>
                          {organization.name} ({memberCountByOrganization.get(organization.id) ?? 0})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="admin-filter-field">
                    권한
                    <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}>
                      <option value="all">전체</option>
                      {(Object.keys(ROLE_LABELS) as Array<keyof typeof ROLE_LABELS>).map((role) => (
                        <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="admin-filter-field">
                    상태
                    <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                      <option value="all">전체</option>
                      <option value="active">활성</option>
                      <option value="inactive">비활성</option>
                      <option value="pending">승인 대기</option>
                    </select>
                  </label>
                  {filtersActive && (
                    <button
                      type="button"
                      className="secondary-button compact-button"
                      onClick={() => { setUserQuery(""); setUserOrganizationFilter("all"); setRoleFilter("all"); setStatusFilter("all"); }}
                    >
                      필터 초기화
                    </button>
                  )}
                </div>
                <div className="table-shell">
                  <table className="admin-table admin-user-table">
                    <thead>
                      <tr>
                        <th>사용자</th>
                        <th>기관</th>
                        <th>권한</th>
                        <th>상태</th>
                        <th>가입일</th>
                        <th>작업</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userGroups.length === 0 && (
                        <tr>
                          <td colSpan={6}>{loading ? "불러오는 중..." : "조건에 맞는 사용자가 없습니다."}</td>
                        </tr>
                      )}
                      {userGroups.map((group) => (
                        <Fragment key={group.key}>
                          {userOrganizationFilter === "all" && (
                            <tr className="admin-org-group-row">
                              <td colSpan={6}>
                                <strong>{group.label}</strong>
                                <span>{group.users.length}명</span>
                              </td>
                            </tr>
                          )}
                          {group.users.map((user) => {
                            const isSelf = user.id === currentUserId;
                            const role = roleOf(user);
                            const rowBusy = busyKey !== null && busyKey.endsWith(`-${user.id}`);
                            return (
                              <tr key={user.id} className={user.is_active ? undefined : "admin-row-inactive"}>
                                <td>
                                  <span className="admin-person">
                                    <strong>
                                      {user.name}
                                      {isSelf && <em className="admin-self-tag">나</em>}
                                    </strong>
                                    <span>{user.email}</span>
                                  </span>
                                </td>
                                <td>
                                  {role === "admin" ? (
                                    <span className="admin-muted">{user.organization_id === null ? "-" : organizationNameById.get(user.organization_id) ?? "-"}</span>
                                  ) : (
                                    <select
                                      aria-label={`${user.name} 기관`}
                                      value={user.organization_id ?? ""}
                                      disabled={busyKey !== null}
                                      onChange={(event) => event.target.value && onAssignOrganization(user, Number(event.target.value))}
                                    >
                                      {user.organization_id === null && <option value="">기관 선택...</option>}
                                      {organizations
                                        .filter((organization) => organization.id === user.organization_id || (organization.approval_status === "approved" && organization.is_active))
                                        .map((organization) => (
                                        <option key={organization.id} value={organization.id}>
                                          {organization.name}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </td>
                                <td>
                                  <span className={`admin-status-pill role-${role === "admin" ? "admin" : role === "owner" ? "owner" : "user"}`}>
                                    {ROLE_LABELS[role]}
                                  </span>
                                </td>
                                <td>
                                  <span className="admin-pill-row">
                                    <span className={`admin-status-pill ${user.is_active ? "status-active" : "status-inactive"}`}>
                                      {user.is_active ? "활성" : "비활성"}
                                    </span>
                                    {user.approval_status !== "approved" && <ApprovalPill status={user.approval_status} />}
                                  </span>
                                </td>
                                <td className="admin-nowrap">{formatDate(user.created_at)}</td>
                                <td>
                                  <div className="table-actions">
                                    {user.organization_id !== null && !user.is_admin && (
                                      <button
                                        type="button"
                                        className="secondary-button compact-button"
                                        disabled={busyKey !== null}
                                        onClick={() => onToggleOrganizationRole(user)}
                                      >
                                        {user.is_org_owner ? "연구원으로 변경" : "기관 관리자로 지정"}
                                      </button>
                                    )}
                                    {!isSelf && (
                                      <button
                                        type="button"
                                        className="secondary-button compact-button"
                                        disabled={busyKey !== null}
                                        onClick={() => onToggleUserAdmin(user)}
                                      >
                                        {user.is_admin ? "시스템 관리자 해제" : "시스템 관리자 지정"}
                                      </button>
                                    )}
                                    {!isSelf && (
                                      <button
                                        type="button"
                                        className={`secondary-button compact-button${user.is_active ? " admin-danger-text" : ""}`}
                                        disabled={busyKey !== null}
                                        onClick={() => onToggleUserActive(user)}
                                      >
                                        {user.is_active ? "비활성화" : "활성화"}
                                      </button>
                                    )}
                                    {rowBusy && <span className="admin-muted">처리 중...</span>}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

          {activeSection === "feedback" && <AdminFeedbackPanel onOpenCountChange={setFeedbackOpenCount} />}

          {activeSection === "organizations" && (
            <div className="admin-stack">
              <section className="card">
                <div className="section-head">
                  <div>
                    <p className="eyebrow">기관 만들기</p>
                    <h2>새 기관</h2>
                  </div>
                </div>
                <form onSubmit={onCreateOrganization} className="admin-org-create">
                  <label>
                    기관 이름
                    <input value={orgName} onChange={(event) => setOrgName(event.target.value)} placeholder="예: 딥아이 연구소" required maxLength={255} />
                  </label>
                  <label>
                    <span>기관 코드 <span className="admin-muted">(선택)</span></span>
                    <input
                      value={orgCode}
                      onChange={(event) => setOrgCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                      placeholder="비워두면 자동 생성"
                      maxLength={9}
                      pattern="[A-Z0-9]{9}"
                      title="영문 대문자와 숫자 9자리"
                    />
                  </label>
                  <button type="submit" disabled={busyKey !== null || !orgName.trim()}>
                    {busyKey === "org-create" ? "만드는 중..." : "기관 만들기"}
                  </button>
                </form>
                <p className="admin-section-note">연구원은 기관 코드로 가입 신청합니다. 코드는 영문 대문자·숫자 9자리입니다.</p>
              </section>

              <section className="card">
                <div className="section-head">
                  <div>
                    <p className="eyebrow">디렉터리</p>
                    <h2>기관 목록</h2>
                  </div>
                  <input
                    type="search"
                    className="admin-inline-search"
                    value={orgQuery}
                    placeholder="기관 이름·코드 검색"
                    onChange={(event) => setOrgQuery(event.target.value)}
                  />
                </div>
                <div className="table-shell">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>기관</th>
                        <th>기관 코드</th>
                        <th>기관 관리자</th>
                        <th>구성원</th>
                        <th>상태</th>
                        <th>작업</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredOrganizations.length === 0 && (
                        <tr>
                          <td colSpan={6}>{organizations.length === 0 ? "등록된 기관이 없습니다." : "검색 결과가 없습니다."}</td>
                        </tr>
                      )}
                      {filteredOrganizations.map((organization) => {
                        const editing = editingOrgId === organization.id;
                        const memberCount = memberCountByOrganization.get(organization.id) ?? 0;
                        return (
                          <tr key={organization.id} className={organization.is_active ? undefined : "admin-row-inactive"}>
                            <td>
                              {editing ? (
                                <form
                                  className="admin-inline-edit"
                                  onSubmit={(event) => { event.preventDefault(); onSaveOrganizationName(organization); }}
                                >
                                  <input
                                    autoFocus
                                    value={editingOrgName}
                                    maxLength={255}
                                    onChange={(event) => setEditingOrgName(event.target.value)}
                                    onKeyDown={(event) => event.key === "Escape" && setEditingOrgId(null)}
                                  />
                                  <button type="submit" className="compact-button" disabled={busyKey !== null}>저장</button>
                                  <button type="button" className="secondary-button compact-button" onClick={() => setEditingOrgId(null)}>취소</button>
                                </form>
                              ) : (
                                <span className="admin-person">
                                  <strong>{organization.name}</strong>
                                  <span>{formatDate(organization.created_at)} 등록</span>
                                </span>
                              )}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="admin-code admin-code-button"
                                title="클릭해서 복사"
                                onClick={() => void copyCode(organization.code)}
                              >
                                {organization.code}
                              </button>
                            </td>
                            <td>{ownerLabel(organization)}</td>
                            <td>
                              <button type="button" className="admin-link-button" onClick={() => showUsersOf(organization.id)}>
                                {memberCount}명
                              </button>
                            </td>
                            <td>
                              <span className="admin-pill-row">
                                {organization.approval_status === "approved" ? (
                                  <span className={`admin-status-pill ${organization.is_active ? "status-active" : "status-inactive"}`}>
                                    {organization.is_active ? "활성" : "비활성"}
                                  </span>
                                ) : (
                                  <ApprovalPill status={organization.approval_status} />
                                )}
                              </span>
                            </td>
                            <td>
                              <div className="table-actions">
                                {!editing && (
                                  <button
                                    type="button"
                                    className="secondary-button compact-button"
                                    disabled={busyKey !== null}
                                    onClick={() => { setEditingOrgId(organization.id); setEditingOrgName(organization.name); }}
                                  >
                                    이름 변경
                                  </button>
                                )}
                                {organization.approval_status === "pending" ? (
                                  <button type="button" className="compact-button" disabled={busyKey !== null} onClick={() => onApproveOrganization(organization)}>
                                    승인
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className={`secondary-button compact-button${organization.is_active ? " admin-danger-text" : ""}`}
                                    disabled={busyKey !== null}
                                    onClick={() => onToggleOrganization(organization)}
                                  >
                                    {organization.is_active ? "비활성화" : "활성화"}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
