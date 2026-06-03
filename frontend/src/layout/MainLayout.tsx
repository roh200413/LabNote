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
}: Props) {
  const isEntry = !currentUserName;
  const showTools = !isEntry && !isAdmin && showWorkspaceTools;
  const useCompactUserHeader = !isEntry && (Boolean(isAdmin) || !showWorkspaceTools);

  return (
    <main className={`app-shell${isEntry ? ` app-shell-entry app-shell-entry-${entryTone}` : ""}`}>
      <header className={`topbar${isEntry ? " topbar-entry" : ""}${useCompactUserHeader ? " topbar-admin-user" : ""}`}>
        <div className="topbar-brand">
          <p className="eyebrow">{entryTone === "admin" ? "Admin Console" : "Research Notes Platform"}</p>
          <h1>LabNote</h1>
        </div>
        {showTools && (
          <div className="topbar-search">
            <span aria-hidden="true">⌕</span>
            <input type="text" placeholder="Search projects, notes, researchers" />
          </div>
        )}
        {currentUserName && (
          <div className="topbar-actions">
            {showTools && (
              <button type="button" className="compact-button primary-button topbar-action-button">
                New Project
              </button>
            )}
            <div className="user-chip">
              <div className="avatar-badge">{currentUserName.slice(0, 1)}</div>
              <button type="button" className="user-chip-button" onClick={onOpenProfile} disabled={!onOpenProfile}>
                <strong>{currentUserName}</strong>
                <p>
                  {currentUserEmail}
                  {isAdmin ? " Admin" : ""}
                </p>
              </button>
              {onLogout && (
                <button type="button" className="secondary-button compact-button" onClick={onLogout}>
                  Log out
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
