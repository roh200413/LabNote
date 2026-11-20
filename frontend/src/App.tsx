import { FormEvent, useEffect, useState } from "react";

import { getMe, login, signUp, type AuthUser } from "./api/auth";
import { setAccessToken } from "./api/client";
import type { SearchNavigation } from "./api/search";
import { FeedbackButton } from "./components/FeedbackButton";
import { GlobalSearch } from "./components/GlobalSearch";
import { MainLayout } from "./layout/MainLayout";
import { AdminPage } from "./pages/AdminPage";
import { HomePage } from "./pages/HomePage";

export default function App() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [profileOpenToken, setProfileOpenToken] = useState(0);
  const [searchRequest, setSearchRequest] = useState<{ token: number; target: SearchNavigation } | null>(null);
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
        setNotice(result.message ?? "회원가입이 완료되었습니다.");
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
            <p>불러오는 중...</p>
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
                <p className="eyebrow">관리자 콘솔</p>
                <h2>시스템 관리자</h2>
                <div className="admin-entry-grid" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
                <div className="admin-entry-tags">
                  <span>기관</span>
                  <span>사용자</span>
                  <span>승인</span>
                </div>
              </aside>
              <div className="admin-entry-form">
                <p className="eyebrow">보안 로그인</p>
                <h2>관리자 로그인</h2>
                <form onSubmit={onSubmit} className="form-stack">
                  <label>
                    이메일
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </label>
                  <label>
                    비밀번호
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      minLength={8}
                      required
                    />
                  </label>
                  <button type="submit">로그인</button>
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
                <p className="eyebrow">연구 작업 공간</p>
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
                <span>프로젝트</span>
                <span>연구노트</span>
                <span>승인</span>
              </div>
            </aside>
            <div className="admin-entry-form workspace-entry-form">
              <p className="eyebrow">{mode === "login" ? "보안 로그인" : "작업 공간 가입"}</p>
              <h2>{mode === "login" ? "LabNote 로그인" : "계정 만들기"}</h2>

              <form onSubmit={onSubmit} className="form-stack">
                {mode === "signup" && (
                  <>
                    <label>
                      가입 유형
                      <select
                        value={accountType}
                        onChange={(e) => setAccountType(e.target.value as "owner" | "user")}
                      >
                        <option value="user">사용자</option>
                        <option value="owner">기관 관리자</option>
                      </select>
                    </label>
                    <label>
                      이름
                      <input value={name} onChange={(e) => setName(e.target.value)} required />
                    </label>
                    {accountType === "owner" && (
                      <label>
                        기관명
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
                          기관명 (선택)
                          <input
                            value={organizationName}
                            onChange={(e) => setOrganizationName(e.target.value)}
                          />
                        </label>
                        <label>
                          기관 코드 (선택)
                          <input
                            value={organizationCode}
                            onChange={(e) => setOrganizationCode(e.target.value.toUpperCase())}
                            placeholder="9 characters"
                          />
                        </label>
                        <p className="auth-help">개인 계정은 두 칸을 비워 두세요. 기관에 가입하려면 기관 코드만 입력하세요.</p>
                      </>
                    )}
                  </>
                )}
                <label>
                  이메일
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </label>
                <label>
                  비밀번호
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </label>
                <button type="submit">{mode === "login" ? "로그인" : "계정 만들기"}</button>
              </form>

              <button className="secondary-button workspace-entry-switch" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
                {mode === "login" ? "계정이 없나요? 회원가입" : "이미 계정이 있나요? 로그인"}
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
        <AdminPage currentUserId={currentUser.id} />
      </MainLayout>
    ) : (
      <MainLayout
        currentUserName={currentUser.name}
        currentUserEmail={currentUser.email}
        showWorkspaceTools={false}
        onLogout={onLogout}
        onOpenProfile={onOpenProfile}
        actions={<FeedbackButton />}
        search={
          currentUser.organization_id || currentUser.is_org_owner ? (
            <GlobalSearch onNavigate={(target) => setSearchRequest({ token: Date.now(), target })} />
          ) : undefined
        }
      >
        <HomePage
          currentUser={currentUser}
          onCurrentUserChange={setCurrentUser}
          openProfileToken={profileOpenToken}
          searchRequest={searchRequest}
        />
      </MainLayout>
    )
  );
}
