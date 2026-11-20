import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  currentUserName?: string;
  currentUserEmail?: string;
  isAdmin?: boolean;
  entryTone?: "workspace" | "admin";
  showWorkspaceTools?: boolean;
  onLogout?: () => void;
  onOpenProfile?: () => void;
  /** Rendered in the middle of the top bar (the workspace search box). */
  search?: ReactNode;
  /** Extra buttons shown before the user chip (e.g. "의견 보내기"). */
  actions?: ReactNode;
};

export function MainLayout({
  children,
  currentUserName,
  currentUserEmail,
  isAdmin,
  entryTone = "workspace",
  showWorkspaceTools = true,
  onLogout,
  onOpenProfile,
  search,
  actions,
}: Props) {
  const isEntry = !currentUserName;
  const showTools = !isEntry && !isAdmin && showWorkspaceTools;
  const useCompactUserHeader = !isEntry && !search && (Boolean(isAdmin) || !showWorkspaceTools);

  return (
    <main className={`app-shell${isEntry ? ` app-shell-entry app-shell-entry-${entryTone}` : ""}`}>
      <header className={`topbar${isEntry ? " topbar-entry" : ""}${useCompactUserHeader ? " topbar-admin-user" : ""}`}>
        <div className="topbar-brand">
          <p className="eyebrow">{entryTone === "admin" ? "관리자 콘솔" : "연구노트 플랫폼"}</p>
          <h1>LabNote</h1>
        </div>
        {!isEntry && search}
        {currentUserName && (
          <div className="topbar-actions">
            {showTools && (
              <button type="button" className="compact-button primary-button topbar-action-button">
                새 프로젝트
              </button>
            )}
            {actions}
            <div className="user-chip">
              <div className="avatar-badge">{currentUserName.slice(0, 1)}</div>
              <button type="button" className="user-chip-button" onClick={onOpenProfile} disabled={!onOpenProfile}>
                <strong>{currentUserName}</strong>
                <p>
                  {currentUserEmail}
                  {isAdmin ? " 관리자" : ""}
                </p>
              </button>
              {onLogout && (
                <button type="button" className="secondary-button compact-button" onClick={onLogout}>
                  로그아웃
                </button>
              )}
            </div>
          </div>
        )}
      </header>
      {children}
    </main>
  );
}
