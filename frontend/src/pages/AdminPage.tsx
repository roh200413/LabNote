import { Fragment, FormEvent, useEffect, useState } from "react";

import {
  approveOrganization,
  createOrganization,
  getAdminDashboard,
  listAdminUsers,
  listOrganizations,
  listPendingOrganizations,
  rejectOrganization,
  updateAdminUser,
  updateOrganization,
  type AdminDashboard,
  type AdminUser,
  type Organization,
} from "../api/admin";

type AdminSection = "dashboard" | "approvals" | "users" | "organizations";

const sections: Array<{ id: AdminSection; label: string; hint: string }> = [
  { id: "dashboard", label: "Dashboard", hint: "Overview and traffic" },
  { id: "approvals", label: "Approvals", hint: "Owner signup queue" },
  { id: "users", label: "Users", hint: "Accounts and roles" },
  { id: "organizations", label: "Organizations", hint: "Company records" },
];

export function AdminPage() {
  const [activeSection, setActiveSection] = useState<AdminSection>("dashboard");
  const [userOrganizationFilter, setUserOrganizationFilter] = useState("all");
  const [dashboard, setDashboard] = useState<AdminDashboard | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [pendingOrganizations, setPendingOrganizations] = useState<Organization[]>([]);
  const [orgName, setOrgName] = useState("");
  const [orgCode, setOrgCode] = useState("");
  const [orgDescription, setOrgDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

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
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const onCreateOrganization = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await createOrganization({ name: orgName, code: orgCode, description: orgDescription });
      setOrgName("");
      setOrgCode("");
      setOrgDescription("");
      await refresh();
      setActiveSection("organizations");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onToggleUserActive = async (user: AdminUser) => {
    try {
      await updateAdminUser(user.id, {
        name: user.name,
        is_active: !user.is_active,
        is_admin: user.is_admin,
        organization_id: user.organization_id,
      });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onToggleUserAdmin = async (user: AdminUser) => {
    try {
      await updateAdminUser(user.id, {
        name: user.name,
        is_active: user.is_active,
        is_admin: !user.is_admin,
        organization_id: user.organization_id,
      });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onAssignOrganization = async (user: AdminUser, organizationId: number | null) => {
    try {
      await updateAdminUser(user.id, {
        name: user.name,
        is_active: user.is_active,
        is_admin: user.is_admin,
        organization_id: organizationId,
      });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onToggleOrganization = async (organization: Organization) => {
    try {
      await updateOrganization(organization.id, {
        name: organization.name,
        code: organization.code,
        description: organization.description,
        is_active: !organization.is_active,
      });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onApproveOrganization = async (organizationId: number) => {
    try {
      await approveOrganization(organizationId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onRejectOrganization = async (organizationId: number) => {
    try {
      await rejectOrganization(organizationId);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const activeMeta = sections.find((section) => section.id === activeSection) ?? sections[0];
  const statusClass = (status: string) => `admin-status-pill status-${status.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const organizationNameById = new Map(organizations.map((organization) => [organization.id, organization.name]));
  const usersByOrganization = new Map<string, { label: string; users: AdminUser[] }>();

  users.forEach((user) => {
    const key = user.organization_id === null ? "none" : String(user.organization_id);
    const label = user.organization_id === null
      ? "No organization"
      : organizationNameById.get(user.organization_id) ?? `Organization #${user.organization_id}`;
    const group = usersByOrganization.get(key) ?? { label, users: [] };
    group.users.push(user);
    usersByOrganization.set(key, group);
  });

  const userOrganizationOptions = [
    { value: "all", label: "All organizations", count: users.length },
    { value: "none", label: "No organization", count: usersByOrganization.get("none")?.users.length ?? 0 },
    ...organizations.map((organization) => ({
      value: String(organization.id),
      label: organization.name,
      count: usersByOrganization.get(String(organization.id))?.users.length ?? 0,
    })),
  ];
  const filteredUsers = userOrganizationFilter === "all"
    ? users
    : users.filter((user) => (user.organization_id === null ? "none" : String(user.organization_id)) === userOrganizationFilter);
  const selectedOrganizationLabel =
    userOrganizationOptions.find((option) => option.value === userOrganizationFilter)?.label ?? "Selected organization";
  const knownOrganizationIds = new Set(organizations.map((organization) => organization.id));
  const userOrganizationGroups: Array<{ key: string; label: string; users: AdminUser[] }> =
    userOrganizationFilter === "all"
      ? [
          ...organizations
            .map((organization) => ({
              key: String(organization.id),
              label: organization.name,
              users: usersByOrganization.get(String(organization.id))?.users ?? [],
            }))
            .filter((group) => group.users.length > 0),
          ...Array.from(usersByOrganization.entries())
            .filter(([key]) => key === "none" || !knownOrganizationIds.has(Number(key)))
            .map(([key, group]) => ({ key, label: group.label, users: group.users }))
            .filter((group) => group.users.length > 0),
        ]
      : [{ key: userOrganizationFilter, label: selectedOrganizationLabel, users: filteredUsers }];

  return (
    <div className="admin-console">
      <aside className="admin-console-sidebar">
        <div className="admin-sidebar-title">
          <p className="eyebrow">Admin</p>
          <h2>Console</h2>
        </div>
        <nav className="admin-side-nav" aria-label="Admin sections">
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`admin-side-nav-item${activeSection === section.id ? " active" : ""}`}
              onClick={() => setActiveSection(section.id)}
            >
              <strong>{section.label}</strong>
              <span>{section.hint}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="admin-main">
        <header className="admin-summary-header">
          <div className="admin-summary-copy">
            <p className="eyebrow">System Admin</p>
            <h2>{activeMeta.label}</h2>
            <span>{activeMeta.hint}</span>
          </div>
          <div className="admin-summary-actions">
            <div className="admin-summary-strip" aria-label="System summary">
              <span><strong>{dashboard?.pending_organizations ?? 0}</strong> pending approvals</span>
              <span><strong>{dashboard?.active_admins ?? 0}</strong> active admins</span>
              <span><strong>{users.length}</strong> loaded users</span>
            </div>
            <button type="button" className="secondary-button compact-button" onClick={() => void refresh()}>
              Refresh
            </button>
          </div>
        </header>

        <section className="admin-panel">
          {activeSection === "dashboard" && (
            <div className="admin-stack">
              <section className="dashboard-grid dashboard-grid-4">
                <article className="metric-card">
                  <p>Total users</p>
                  <strong>{dashboard?.total_users ?? 0}</strong>
                </article>
                <article className="metric-card">
                  <p>Organizations</p>
                  <strong>{dashboard?.total_organizations ?? 0}</strong>
                </article>
                <article className="metric-card">
                  <p>Active admins</p>
                  <strong>{dashboard?.active_admins ?? 0}</strong>
                </article>
                <article className="metric-card">
                  <p>Pending organizations</p>
                  <strong>{dashboard?.pending_organizations ?? 0}</strong>
                </article>
              </section>

              <section className="card">
                <div className="section-head">
                  <div>
                    <p className="eyebrow">Traffic</p>
                    <h2>Weekly Access Trend</h2>
                  </div>
                </div>
                <div className="chart-row">
                  {dashboard?.logins_by_day.map((point) => (
                    <div key={point.date} className="chart-bar-wrap">
                      <div className="chart-value">{point.count}</div>
                      <div className="chart-bar" style={{ height: `${Math.max(point.count * 18, 8)}px` }} />
                      <div className="chart-label">{point.date.slice(5)}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="card">
                <div className="section-head">
                  <div>
                    <p className="eyebrow">Recent access</p>
                    <h2>Latest Sessions</h2>
                  </div>
                </div>
                <div className="table-shell">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Event</th>
                        <th>When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard?.recent_logins.map((event) => (
                        <tr key={event.id}>
                          <td>{event.email}</td>
                          <td>{event.event_type}</td>
                          <td>{new Date(event.occurred_at).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}

        {activeSection === "approvals" && (
          <section className="card">
            <div className="section-head">
              <div>
                <p className="eyebrow">Approval queue</p>
                <h2>Pending Organization Owners</h2>
              </div>
            </div>
            <div className="table-shell">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Code</th>
                    <th>Description</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingOrganizations.length === 0 && (
                    <tr>
                      <td colSpan={5}>No pending organizations.</td>
                    </tr>
                  )}
                  {pendingOrganizations.map((organization) => (
                    <tr key={organization.id}>
                      <td>{organization.name}</td>
                      <td>{organization.code}</td>
                      <td>{organization.description ?? "-"}</td>
                      <td>
                        <span className={statusClass(organization.approval_status)}>
                          {organization.approval_status}
                        </span>
                      </td>
                      <td>
                        <div className="table-actions">
                          <button
                            type="button"
                            className="secondary-button compact-button"
                            onClick={() => void onApproveOrganization(organization.id)}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="secondary-button compact-button"
                            onClick={() => void onRejectOrganization(organization.id)}
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeSection === "users" && (
          <section className="card">
            <div className="section-head">
              <div>
                <p className="eyebrow">Account management</p>
                <h2>User Table</h2>
              </div>
            </div>
            <div className="admin-filter-bar">
              <label className="admin-filter-field">
                Organization
                <select value={userOrganizationFilter} onChange={(e) => setUserOrganizationFilter(e.target.value)}>
                  {userOrganizationOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} ({option.count})
                    </option>
                  ))}
                </select>
              </label>
              <div className="admin-filter-summary">
                <span>{filteredUsers.length} users shown</span>
                <span>{organizations.length} organizations</span>
              </div>
            </div>
            <div className="table-shell">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Approval</th>
                    <th>Organization</th>
                    <th>Role</th>
                    <th>Active</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {userOrganizationGroups.length === 0 && (
                    <tr>
                      <td colSpan={7}>No users match this organization.</td>
                    </tr>
                  )}
                  {userOrganizationGroups.map((group) => (
                    <Fragment key={group.key}>
                      <tr className="admin-org-group-row">
                        <td colSpan={7}>
                          <strong>{group.label}</strong>
                          <span>{group.users.length} {group.users.length === 1 ? "user" : "users"}</span>
                        </td>
                      </tr>
                      {group.users.map((user) => (
                        <tr key={user.id}>
                          <td>{user.name}</td>
                          <td>{user.email}</td>
                          <td>
                            <span className={statusClass(user.approval_status)}>{user.approval_status}</span>
                          </td>
                          <td>
                            <select
                              value={user.organization_id ?? ""}
                              onChange={(e) =>
                                void onAssignOrganization(user, e.target.value ? Number(e.target.value) : null)
                              }
                            >
                              <option value="">No organization</option>
                              {organizations.map((organization) => (
                                <option key={organization.id} value={organization.id}>
                                  {organization.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <span className={`admin-status-pill ${user.is_admin ? "role-admin" : user.is_org_owner ? "role-owner" : "role-user"}`}>
                              {user.is_admin ? "Admin" : user.is_org_owner ? "Owner" : "User"}
                            </span>
                          </td>
                          <td>
                            <span className={`admin-status-pill ${user.is_active ? "status-active" : "status-inactive"}`}>
                              {user.is_active ? "Active" : "Inactive"}
                            </span>
                          </td>
                          <td>
                            <div className="table-actions">
                              <button
                                type="button"
                                className="secondary-button compact-button"
                                onClick={() => void onToggleUserActive(user)}
                              >
                                {user.is_active ? "Deactivate" : "Activate"}
                              </button>
                              <button
                                type="button"
                                className="secondary-button compact-button"
                                onClick={() => void onToggleUserAdmin(user)}
                              >
                                {user.is_admin ? "Remove admin" : "Make admin"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeSection === "organizations" && (
          <div className="admin-stack">
            <section className="card">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Create organization</p>
                  <h2>New Organization</h2>
                </div>
              </div>
              <form onSubmit={onCreateOrganization} className="form-stack">
                <label>
                  Name
                  <input value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
                </label>
                <label>
                  Code
                  <input value={orgCode} onChange={(e) => setOrgCode(e.target.value)} required />
                </label>
                <label>
                  Description
                  <textarea value={orgDescription} onChange={(e) => setOrgDescription(e.target.value)} />
                </label>
                <button type="submit">Create organization</button>
              </form>
            </section>

            <section className="card">
              <div className="section-head">
                <div>
                  <p className="eyebrow">Directory</p>
                  <h2>Organization Table</h2>
                </div>
              </div>
              <div className="table-shell">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Code</th>
                      <th>Owner</th>
                      <th>Status</th>
                      <th>Approval</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {organizations.map((organization) => (
                      <tr key={organization.id}>
                        <td>{organization.name}</td>
                        <td>{organization.code}</td>
                        <td>{organization.owner_user_id ?? "-"}</td>
                        <td>
                          <span className={`admin-status-pill ${organization.is_active ? "status-active" : "status-inactive"}`}>
                            {organization.is_active ? "Active" : "Disabled"}
                          </span>
                        </td>
                        <td>
                          <span className={statusClass(organization.approval_status)}>
                            {organization.approval_status}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="secondary-button compact-button"
                            onClick={() => void onToggleOrganization(organization)}
                          >
                            {organization.is_active ? "Disable" : "Enable"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {error && <p className="error">{error}</p>}
      </section>
      </main>
    </div>
  );
}
