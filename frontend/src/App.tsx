import { FormEvent, useEffect, useState } from "react";

import { getMe, login, signUp, type AuthUser } from "./api/auth";
import { setAccessToken } from "./api/client";
import { MainLayout } from "./layout/MainLayout";
import { AdminPage } from "./pages/AdminPage";
import { HomePage } from "./pages/HomePage";

export default function App() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [profileOpenToken, setProfileOpenToken] = useState(0);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountType, setAccountType] = useState<"owner" | "user">("user");
  const [organizationName, setOrganizationName] = useState("");
  const [organizationCode, setOrganizationCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const isAdminRoute = window.location.pathname.startsWith("/admin");

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const user = await getMe();
        if (mounted) {
          setCurrentUser(user);
          setError(null);
        }
      } catch (err) {
        setAccessToken(null);
        if (!isAdminRoute && mounted && (err as Error).message !== "UNAUTHORIZED") {
          setError((err as Error).message);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    try {
      const result = mode === "login" || isAdminRoute
        ? await login({ email, password })
        : await signUp({
            name,
            email,
            password,
            account_type: accountType === "owner" ? "owner" : "user",
            organization_name: organizationName || undefined,
            organization_code: accountType === "user" ? organizationCode.trim().toUpperCase() : undefined,
          });

      if (result.access_token) {
        setCurrentUser(result.user);
      } else {
        setNotice(result.message ?? "Signup completed.");
        setMode("login");
      }
      setPassword("");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onLogout = () => {
    setAccessToken(null);
    setCurrentUser(null);
    setPassword("");
  };

  const onOpenProfile = () => {
    if (!currentUser || currentUser.is_admin) return;
    setProfileOpenToken((value) => value + 1);
  };

  if (isLoading) {
    return (
      <MainLayout>
        <section className="auth-shell">
          <div className="auth-card">
            <p>Loading...</p>
          </div>
        </section>
      </MainLayout>
    );
  }

  if (!currentUser) {
    if (isAdminRoute) {
      return (
        <MainLayout entryTone="admin">
          <section className="admin-entry-shell">
            <div className="admin-entry-card">
              <aside className="admin-entry-visual">
                <p className="eyebrow">Admin Console</p>
                <h2>System Admin</h2>
                <div className="admin-entry-grid" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <div className="admin-entry-tags">
                  <span>Organizations</span>
                  <span>Users</span>
                  <span>Approvals</span>
                </div>
              </aside>
              <div className="admin-entry-form">
                <p className="eyebrow">Secure sign in</p>
                <h2>Administrator login</h2>
                <form onSubmit={onSubmit} className="form-stack">
                  <label>
                    Email
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </label>
                  <label>
                    Password
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      minLength={8}
                      required
                    />
                  </label>
                  <button type="submit">Log in</button>
                </form>
                {error && <p className="error">{error}</p>}
              </div>
            </div>
          </section>
        </MainLayout>
      );
    }

    return (
      <MainLayout entryTone="workspace">
        <section className="admin-entry-shell workspace-entry-shell">
          <div className="admin-entry-card workspace-entry-card">
            <aside className="admin-entry-visual workspace-entry-visual">
              <div>
                <p className="eyebrow">Research Workspace</p>
                <h2>LabNote</h2>
              </div>
              <div className="admin-entry-grid" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="admin-entry-tags">
                <span>Projects</span>
                <span>Research Notes</span>
                <span>Approvals</span>
              </div>
            </aside>
            <div className="admin-entry-form workspace-entry-form">
              <p className="eyebrow">{mode === "login" ? "Secure sign in" : "Create workspace access"}</p>
              <h2>{mode === "login" ? "Log in to LabNote" : "Create account"}</h2>

              <form onSubmit={onSubmit} className="form-stack">
                {mode === "signup" && (
                  <>
                    <label>
                      Sign up as
                      <select
                        value={accountType}
                        onChange={(e) => setAccountType(e.target.value as "owner" | "user")}
                      >
                        <option value="user">User</option>
                        <option value="owner">Organization owner</option>
                      </select>
                    </label>
                    <label>
                      Name
                      <input value={name} onChange={(e) => setName(e.target.value)} required />
                    </label>
                    {accountType === "owner" && (
                      <label>
                        Organization name
                        <input
                          value={organizationName}
                          onChange={(e) => setOrganizationName(e.target.value)}
                          required
                        />
                      </label>
                    )}
                    {accountType === "user" && (
                      <>
                        <label>
                          Organization name (optional)
                          <input
                            value={organizationName}
                            onChange={(e) => setOrganizationName(e.target.value)}
                          />
                        </label>
                        <label>
                          Organization code (optional)
                          <input
                            value={organizationCode}
                            onChange={(e) => setOrganizationCode(e.target.value.toUpperCase())}
                            placeholder="9 characters"
                          />
                        </label>
                        <p className="auth-help">Leave both fields empty for a standalone user account. Enter the company code only when you want to join a company.</p>
                      </>
                    )}
                  </>
                )}
                <label>
                  Email
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </label>
                <button type="submit">{mode === "login" ? "Log in" : "Create account"}</button>
              </form>

              <button className="secondary-button workspace-entry-switch" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
                {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
              </button>

              {error && <p className="error">{error}</p>}
              {notice && <p className="profile-notice">{notice}</p>}
            </div>
          </div>
        </section>
      </MainLayout>
    );
  }

  return (
    currentUser.is_admin ? (
      <MainLayout
        currentUserName={currentUser.name}
        currentUserEmail={currentUser.email}
        isAdmin={currentUser.is_admin}
        onLogout={onLogout}
        onOpenProfile={onOpenProfile}
      >
        <AdminPage />
      </MainLayout>
    ) : (
      <MainLayout
        currentUserName={currentUser.name}
        currentUserEmail={currentUser.email}
        showWorkspaceTools={false}
        onLogout={onLogout}
        onOpenProfile={onOpenProfile}
      >
        <HomePage
          currentUser={currentUser}
          onCurrentUserChange={setCurrentUser}
          openProfileToken={profileOpenToken}
        />
      </MainLayout>
    )
  );
}
