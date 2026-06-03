import { DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import {
  createMySignature,
  getMyCompanyAccessRequest,
  listMySignatures,
  requestMyCompanyAccess,
  revokeMySignature,
  type AuthUser,
  type CompanyAccessRequestInfo,
  type UserSignature,
  updateMySignature,
} from "../api/auth";
import {
  createResearcherInvitation,
  getResearcherManagement,
  listCompanyMembers,
  removeResearcherMember,
  type CompanyMemberDirectoryItem,
  type ResearcherManagementData,
} from "../api/directory";
import { listNoteFiles, listNotePages, replaceNotePageAsset, uploadNoteFile, type NoteFile, type NotePage } from "../api/file";
import {
  assignProjectMember,
  createProject,
  getProjectCover,
  getProjectMembers,
  listProjects,
  type ProjectNoteCover,
  type Project,
  type ProjectMember,
  removeProjectMember,
  updateProject,
  upsertProjectCover,
} from "../api/project";
import {
  approveResearchNote,
  createResearchNote,
  deleteResearchNote,
  getResearchNote,
  listResearchNoteApprovalEvents,
  listResearchNotes,
  rejectResearchNote,
  reopenResearchNote,
  submitResearchNote,
  updateResearchNote,
  type ResearchNote,
  type ResearchNoteApprovalEvent,
} from "../api/researchNote";
import {
  createResearchNoteDocument,
  downloadSelectedResearchNotesPdf,
  getResearchNoteDocument,
  listResearchNoteDocuments,
  updateResearchNoteDocument,
} from "../api/documentEditor";
import { DocumentEditor } from "../components/DocumentEditor";
import { getBackendAssetUrl } from "../api/client";
import {
  createGitHubIntegration,
  createGitHubProjectMapping,
  deleteGitHubIntegration,
  deleteGitHubProjectMapping,
  generateResearchNoteFromGitHubEvent,
  listGitHubEvents,
  listGitHubIntegrations,
  listGitHubProjectMappings,
  rotateGitHubWebhookSecret,
  updateGitHubIntegration,
  updateGitHubProjectMapping,
  type GitHubEvent,
  type GitHubProjectMapping,
  type GitHubRepositoryIntegration,
} from "../api/githubIntegration";
import type { DocumentSchema, ResearchNoteDocument, ResearchNoteDocumentSummary, TextBlock, ImageBlock } from "../types/document";
import coverLayoutData from "../../../shared/cover_layout.json";

type UserSection = "home" | "projects" | "researchers" | "github" | "platforms" | "profile";
type ProjectWorkspaceView = "dashboard" | "members" | "notes" | "cover";
type SidebarIconName = UserSection | ProjectWorkspaceView;
type CoverTemplate = {
  organization: string;
  projectTitle: string;
  coverTitle: string;
  projectCode: string;
  principalInvestigator: string;
  projectPeriod: string;
  footerNote: string;
  overrideOrganization: boolean;
  overrideProjectTitle: boolean;
  overridePrincipalInvestigator: boolean;
  showOrganization: boolean;
  showProjectTitle: boolean;
  showCoverTitle: boolean;
  showCode: boolean;
  showPrincipalInvestigator: boolean;
  showProjectPeriod: boolean;
};

const COVER_LAYOUT = coverLayoutData as {
  page_width: number;
  page_height: number;
  frame: { x: number; y: number; width: number; height: number };
  top_label: { top: number; height: number; font_size: number };
  title: { x: number; y: number; width: number; height: number; font_size: number };
  table: { x: number; y: number; label_width: number; value_width: number; row_height: number; font_size: number };
  footer: { x: number; y: number; width: number; height: number; font_size: number };
};

type Props = {
  currentUser: AuthUser;
  onCurrentUserChange: (user: AuthUser) => void;
  openProfileToken: number;
};

const sectionMeta: Array<{ id: UserSection; title: string; description: string }> = [
  { id: "home", title: "Home", description: "Check workspace status and move into each management area." },
  { id: "projects", title: "Project Management", description: "Manage company projects and open project workspaces." },
  { id: "researchers", title: "Researcher Management", description: "Manage researcher accounts and participation status." },
  { id: "github", title: "GitHub Integration", description: "Connect repositories and collaboration flows." },
  { id: "platforms", title: "Platform Integration", description: "Manage external platform and storage connections." },
];

const projectViewMeta: Record<ProjectWorkspaceView, { title: string; description: string }> = {
  dashboard: {
    title: "Project Dashboard",
    description: "Overview, dates, lead member, and project status.",
  },
  members: {
    title: "Researcher Management",
    description: "Assign and manage project-only participant members.",
  },
  notes: {
    title: "Research Note",
    description: "Open note viewer, upload files, and download note packages.",
  },
  cover: {
    title: "Cover Template",
    description: "Manage the saved research note cover used in package exports.",
  },
};

function SidebarIcon({ name }: { name: SidebarIconName }) {
  const commonProps = {
    className: "nav-icon",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "home":
      return (
        <svg {...commonProps}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 10v10h14V10" />
          <path d="M9 20v-6h6v6" />
        </svg>
      );
    case "projects":
    case "dashboard":
      return (
        <svg {...commonProps}>
          <rect x="4" y="4" width="7" height="7" rx="1.5" />
          <rect x="13" y="4" width="7" height="7" rx="1.5" />
          <rect x="4" y="13" width="7" height="7" rx="1.5" />
          <rect x="13" y="13" width="7" height="7" rx="1.5" />
        </svg>
      );
    case "researchers":
    case "members":
      return (
        <svg {...commonProps}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
          <circle cx="9.5" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "github":
      return (
        <svg {...commonProps}>
          <path d="M9 19c-5 1.5-5-2.5-7-3" />
          <path d="M15 22v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 19 4.77 5.07 5.07 0 0 0 18.91 1S17.73.65 15 2.48a13.38 13.38 0 0 0-7 0C5.27.65 4.09 1 4.09 1A5.07 5.07 0 0 0 4 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 8 18.13V22" />
        </svg>
      );
    case "platforms":
      return (
        <svg {...commonProps}>
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <path d="M8 22h8" />
          <path d="M12 18v4" />
          <path d="M8 9h8" />
          <path d="M8 13h5" />
        </svg>
      );
    case "notes":
      return (
        <svg {...commonProps}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M8 13h8" />
          <path d="M8 17h6" />
        </svg>
      );
    case "cover":
      return (
        <svg {...commonProps}>
          <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 0-3-3z" />
          <path d="M5 4v13" />
          <path d="M9 8h6" />
          <path d="M9 12h4" />
        </svg>
      );
    case "profile":
    default:
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      );
  }
}

const EDITABLE_NOTE_STATUSES = new Set(["draft", "rejected", "reopened"]);

const noteStatusLabels: Record<string, string> = {
  draft: "Draft",
  reopened: "Reopened",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
};

const approvalEventLabels: Record<string, string> = {
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  reopened: "Reopened",
};

const approvalNoticeByAction: Record<"submit" | "approve" | "reject" | "reopen", string> = {
  submit: "Research note submitted for approval.",
  approve: "Research note approved and locked.",
  reject: "Research note rejected for revision.",
  reopen: "Approved research note reopened for revision.",
};

const projectStatusOptions = [
  { value: "active", label: "Active" },
  { value: "planned", label: "Planned" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
];

function formatProjectPeriod(startDate: string | null, endDate: string | null) {
  const start = startDate ?? "TBD";
  const end = endDate ?? "TBD";
  return `${start} - ${end}`;
}

function buildDefaultCoverTemplate(project: Project | null, managerName = "", organizationName = "LABNOTE"): CoverTemplate {
  return {
    organization: organizationName,
    projectTitle: project?.name ?? "Research Note",
    coverTitle: "The Research Notes",
    projectCode: project?.code ?? "",
    principalInvestigator: managerName,
    projectPeriod: formatProjectPeriod(project?.start_date ?? null, project?.end_date ?? null),
    footerNote: "This cover template is used for the research note package.",
    overrideOrganization: false,
    overrideProjectTitle: false,
    overridePrincipalInvestigator: false,
    showOrganization: true,
    showProjectTitle: true,
    showCoverTitle: false,
    showCode: true,
    showPrincipalInvestigator: true,
    showProjectPeriod: true,
  };
}

function parseCoverTemplate(payload: string | null, project: Project | null, managerName = "", organizationName = "LABNOTE"): CoverTemplate {
  if (!payload) return buildDefaultCoverTemplate(project, managerName, organizationName);
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return {
      ...buildDefaultCoverTemplate(project, managerName, organizationName),
      organization: (parsed.organization as string) ?? (parsed.businessName as string) ?? buildDefaultCoverTemplate(project, managerName, organizationName).organization,
      projectTitle: (parsed.projectTitle as string) ?? (parsed.title as string) ?? buildDefaultCoverTemplate(project, managerName, organizationName).projectTitle,
      coverTitle: (parsed.coverTitle as string) ?? (parsed.subtitle as string) ?? buildDefaultCoverTemplate(project, managerName, organizationName).coverTitle,
      projectCode:
        (parsed.projectCode as string)
        ?? (parsed.project_code as string)
        ?? (parsed.code as string)
        ?? buildDefaultCoverTemplate(project, managerName, organizationName).projectCode,
      principalInvestigator: (parsed.principalInvestigator as string) ?? (parsed.managerName as string) ?? buildDefaultCoverTemplate(project, managerName, organizationName).principalInvestigator,
      projectPeriod: (parsed.projectPeriod as string) ?? (parsed.periodText as string) ?? buildDefaultCoverTemplate(project, managerName, organizationName).projectPeriod,
      footerNote: (parsed.footerNote as string) ?? buildDefaultCoverTemplate(project, managerName, organizationName).footerNote,
      overrideOrganization: (parsed.overrideOrganization as boolean) ?? false,
      overrideProjectTitle: (parsed.overrideProjectTitle as boolean) ?? false,
      overridePrincipalInvestigator: (parsed.overridePrincipalInvestigator as boolean) ?? false,
      showOrganization: (parsed.showOrganization as boolean) ?? (parsed.showBusinessName as boolean) ?? true,
      showProjectTitle: (parsed.showProjectTitle as boolean) ?? (parsed.showTitle as boolean) ?? true,
      showCoverTitle: (parsed.showCoverTitle as boolean) ?? false,
      showCode: (parsed.showCode as boolean) ?? (parsed.show_code as boolean) ?? true,
      showPrincipalInvestigator: (parsed.showPrincipalInvestigator as boolean) ?? (parsed.showManager as boolean) ?? true,
      showProjectPeriod: (parsed.showProjectPeriod as boolean) ?? (parsed.showPeriod as boolean) ?? true,
    };
  } catch {
    return buildDefaultCoverTemplate(project, managerName, organizationName);
  }
}

function resolveCoverTemplate(template: CoverTemplate, project: Project | null, managerName = "", organizationName = "LABNOTE") {
  const defaults = buildDefaultCoverTemplate(project, managerName, organizationName);
  return {
    ...template,
    organization: template.overrideOrganization ? template.organization : defaults.organization,
    projectTitle: template.overrideProjectTitle ? template.projectTitle : defaults.projectTitle,
    principalInvestigator: template.overridePrincipalInvestigator ? template.principalInvestigator : defaults.principalInvestigator,
    projectCode: template.projectCode?.trim() ? template.projectCode : defaults.projectCode,
    projectPeriod: template.projectPeriod?.trim() ? template.projectPeriod : defaults.projectPeriod,
  };
}

function loadFontFace(font: string) {
  return typeof document !== "undefined" && "fonts" in document ? document.fonts.load(font) : Promise.resolve([]);
}

async function generateCoverImageDataUrl(template: CoverTemplate, project: Project | null): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = COVER_LAYOUT.page_width;
  canvas.height = COVER_LAYOUT.page_height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to prepare cover image canvas");

  await Promise.all([
    loadFontFace(`${COVER_LAYOUT.top_label.font_size}px "Segoe UI"`),
    loadFontFace(`700 ${COVER_LAYOUT.title.font_size}px "Segoe UI"`),
    loadFontFace(`${COVER_LAYOUT.table.font_size}px "Segoe UI"`),
    loadFontFace(`${COVER_LAYOUT.footer.font_size}px "Segoe UI"`),
  ]);

  const frame = COVER_LAYOUT.frame;
  const topLabel = COVER_LAYOUT.top_label;
  const titleRect = COVER_LAYOUT.title;
  const table = COVER_LAYOUT.table;
  const footer = COVER_LAYOUT.footer;

  const rows = [
    { label: "과제번호", value: template.showCode ? template.projectCode : "" },
    { label: "연구책임자", value: template.showPrincipalInvestigator ? template.principalInvestigator : "" },
    { label: "연구기관", value: template.showOrganization ? template.organization : "" },
    {
      label: "기간",
      value: template.showProjectPeriod ? `${project?.start_date ?? "TBD"} - ${project?.end_date ?? "TBD"}` : "",
    },
  ];

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#d8dee8";
  ctx.lineWidth = 1;
  ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);

  ctx.fillStyle = "#64748b";
  ctx.font = `700 ${topLabel.font_size}px "Segoe UI"`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("연구노트", canvas.width / 2, topLabel.top + topLabel.height / 2);

  ctx.fillStyle = "#0f172a";
  ctx.font = `800 ${titleRect.font_size}px "Segoe UI"`;
  ctx.fillText(template.showProjectTitle ? template.projectTitle : "", canvas.width / 2, titleRect.y + titleRect.height / 2);

  const tableWidth = table.label_width + table.value_width;
  const tableHeight = table.row_height * rows.length;
  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 1;
  ctx.strokeRect(table.x, table.y, tableWidth, tableHeight);
  ctx.beginPath();
  ctx.moveTo(table.x + table.label_width, table.y);
  ctx.lineTo(table.x + table.label_width, table.y + tableHeight);
  for (let idx = 1; idx < rows.length; idx += 1) {
    const y = table.y + table.row_height * idx;
    ctx.moveTo(table.x, y);
    ctx.lineTo(table.x + tableWidth, y);
  }
  ctx.stroke();

  ctx.font = `${table.font_size}px "Segoe UI"`;
  ctx.fillStyle = "#111827";
  ctx.textBaseline = "middle";
  for (let idx = 0; idx < rows.length; idx += 1) {
    const row = rows[idx];
    const centerY = table.y + table.row_height * idx + table.row_height / 2;
    ctx.textAlign = "center";
    ctx.fillText(row.label, table.x + table.label_width / 2, centerY);
    ctx.textAlign = "left";
    ctx.fillText(row.value, table.x + table.label_width + 12, centerY);
  }

  ctx.font = `${COVER_LAYOUT.footer.font_size}px "Segoe UI"`;
  ctx.fillStyle = "#64748b";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    "Research records are maintained according to the registered project information.",
    footer.x + footer.width / 2,
    footer.y + footer.height / 2
  );

  return canvas.toDataURL("image/png");
}

async function generateTocImageDataUrl(
  entries: Array<{ index: number; title: string; createdAt: string; page: number }>,
  showTitle = true
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 794;
  canvas.height = 1123;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to prepare toc image canvas");

  await Promise.all([loadFontFace(`700 18px "Segoe UI"`), loadFontFace(`10px "Segoe UI"`)]);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = "#d8dee8";
  ctx.lineWidth = 1;
  ctx.strokeRect(34, 34, canvas.width - 68, canvas.height - 68);

  let topY = 72;
  if (showTitle) {
    ctx.fillStyle = "#0f172a";
    ctx.font = `700 18px "Segoe UI"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("목차", canvas.width / 2, 91);
    topY = 150;
  }

  const tableX = 76;
  const tableY = topY;
  const tableW = canvas.width - 152;
  const rowH = 38;
  const indexW = 58;
  const titleW = 430;
  const dateW = 110;
  const pageW = tableW - indexW - titleW - dateW;

  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 1;
  ctx.strokeRect(tableX, tableY, tableW, rowH * 21);

  for (let idx = 1; idx < 21; idx += 1) {
    const y = tableY + rowH * idx;
    ctx.beginPath();
    ctx.moveTo(tableX, y);
    ctx.lineTo(tableX + tableW, y);
    ctx.stroke();
  }

  [tableX + indexW, tableX + indexW + titleW, tableX + indexW + titleW + dateW].forEach((x) => {
    ctx.beginPath();
    ctx.moveTo(x, tableY);
    ctx.lineTo(x, tableY + rowH * 21);
    ctx.stroke();
  });

  const headers = [
    { label: "Index", x: tableX, w: indexW },
    { label: "Title", x: tableX + indexW, w: titleW },
    { label: "Created", x: tableX + indexW + titleW, w: dateW },
    { label: "Page", x: tableX + indexW + titleW + dateW, w: pageW },
  ];

  ctx.fillStyle = "#334155";
  ctx.font = `10px "Segoe UI"`;
  headers.forEach((header) => {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(header.label, header.x + header.w / 2, tableY + rowH / 2);
  });

  ctx.fillStyle = "#0f172a";
  entries.slice(0, 20).forEach((entry, idx) => {
    const centerY = tableY + rowH * (idx + 1) + rowH / 2;
    ctx.textAlign = "center";
    ctx.fillText(String(entry.index), tableX + indexW / 2, centerY);
    ctx.textAlign = "left";
    ctx.fillText(entry.title, tableX + indexW + 8, centerY);
    ctx.textAlign = "center";
    ctx.fillText(entry.createdAt, tableX + indexW + titleW + dateW / 2, centerY);
    ctx.fillText(String(entry.page), tableX + indexW + titleW + dateW + pageW / 2, centerY);
  });

  return canvas.toDataURL("image/png");
}

function makeTextBlock(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  content: string,
  options: Partial<TextBlock> = {}
): TextBlock {
  return {
    id,
    type: "text",
    x,
    y,
    w,
    h,
    content,
    locked: options.locked ?? true,
    style: options.style ?? { fontSize: 14, fontWeight: "normal", textAlign: "left" },
  };
}

type NoteTemplateContext = {
  projectTitle: string;
  projectPeriod: string;
  principalInvestigator: string;
  organization: string;
  authorName: string;
  writtenDate: string;
  reviewerName: string;
  reviewedDate: string;
  authorSignatureUrl: string | null;
  reviewerSignatureUrl: string | null;
};

type NoteTemplateOverrides = {
  authorMemberId?: number | "";
  writtenDate?: string;
  reviewerMemberId?: number | "";
  reviewedDate?: string;
};

function buildResearchNotePageTemplateSvg(): string {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123" viewBox="0 0 794 1123">
      <rect x="20" y="25" width="754" height="1073" fill="#ffffff" stroke="#94a3b8" stroke-width="1.5" />
      <line x1="20" y1="55" x2="774" y2="55" stroke="#94a3b8" stroke-width="1.2" />
      <line x1="20" y1="955" x2="774" y2="955" stroke="#94a3b8" stroke-width="1.2" />
      <line x1="20" y1="1026" x2="774" y2="1026" stroke="#94a3b8" stroke-width="1.2" />
      <line x1="250" y1="955" x2="250" y2="1098" stroke="#94a3b8" stroke-width="1.2" />
      <line x1="510" y1="955" x2="510" y2="1098" stroke="#94a3b8" stroke-width="1.2" />
      <text x="32" y="44" font-size="12" fill="#334155" font-family="Arial">Title :</text>
      <text x="32" y="971" font-size="11" fill="#334155" font-family="Arial">Recorded By</text>
      <text x="270" y="971" font-size="11" fill="#334155" font-family="Arial">Signature</text>
      <text x="528" y="971" font-size="11" fill="#334155" font-family="Arial">Date</text>
      <text x="32" y="1042" font-size="11" fill="#334155" font-family="Arial">Witnessed By</text>
      <text x="270" y="1042" font-size="11" fill="#334155" font-family="Arial">Signature</text>
      <text x="528" y="1042" font-size="11" fill="#334155" font-family="Arial">Date</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function buildNoteTemplateBlocks(note: ResearchNote, context: NoteTemplateContext): Array<TextBlock | ImageBlock> {
  const blocks: Array<TextBlock | ImageBlock> = [
    makeTextBlock("note-title", 82, 26, 640, 20, note.title, {
      style: { fontSize: 13, fontWeight: "normal", textAlign: "left" },
    }),
    makeTextBlock("continued-page", 652, 946, 92, 14, "", {
      style: { fontSize: 11, fontWeight: "normal", textAlign: "left" },
    }),
    makeTextBlock("recorded-by", 34, 983, 200, 38, context.authorName, {
      style: { fontSize: 16, fontWeight: "normal", textAlign: "center" },
    }),
    makeTextBlock("recorded-date", 528, 983, 140, 38, context.writtenDate, {
      style: { fontSize: 16, fontWeight: "normal", textAlign: "center" },
    }),
    makeTextBlock("witnessed-by", 34, 1054, 200, 38, context.reviewerName, {
      style: { fontSize: 16, fontWeight: "normal", textAlign: "center" },
    }),
    makeTextBlock("witnessed-date", 528, 1054, 140, 38, context.reviewedDate, {
      style: { fontSize: 16, fontWeight: "normal", textAlign: "center" },
    }),
  ];

  if (context.authorSignatureUrl) {
    blocks.push({
      id: "author-signature",
      type: "image",
      x: 258,
      y: 975,
      w: 194,
      h: 58,
      src: context.authorSignatureUrl,
      locked: true,
    });
  }

  if (context.reviewerSignatureUrl) {
    blocks.push({
      id: "reviewer-signature",
      type: "image",
      x: 258,
      y: 1046,
      w: 194,
      h: 52,
      src: context.reviewerSignatureUrl,
      locked: true,
    });
  }

  return blocks;
}

function buildDefaultNoteDocument(
  note: ResearchNote,
  firstPage: NotePage | null,
  context: NoteTemplateContext
): DocumentSchema {
  const blocks = buildNoteTemplateBlocks(note, context);
  if (firstPage) {
    blocks.push({
      id: "content-image",
      type: "image",
      x: 34,
      y: 64,
      w: 726,
      h: 884,
      src: getBackendAssetUrl(`/storage/${firstPage.image_storage_key}`),
      locked: false,
    });
  }

  return {
    schemaVersion: 1,
    id: `draft-${crypto.randomUUID()}`,
    title: `${note.title} Layout`,
    page: {
      width: 794,
      height: 1123,
      background: "#ffffff",
      backgroundImage: buildResearchNotePageTemplateSvg(),
    },
    meta: {
      noteId: note.id,
      sourceFileId: firstPage?.file_id ?? null,
      sourcePageId: firstPage?.id ?? null,
    },
    blocks,
  };
}

function ensureResearchNoteDocumentFrame(document: DocumentSchema, note: ResearchNote, context: NoteTemplateContext): DocumentSchema {
  const templateBlocks = buildNoteTemplateBlocks(note, context);
  const templateById = new Map(templateBlocks.map((block) => [block.id, block]));
  const frameBlockIds = new Set([
    "note-title",
    "continued-page",
    "recorded-by",
    "recorded-date",
    "witnessed-by",
    "witnessed-date",
    "author-signature",
    "reviewer-signature",
  ]);
  const hasExistingFrame = document.blocks.some((block) => frameBlockIds.has(block.id));
  const sourcePageImage =
    document.page.backgroundImage && !document.page.backgroundImage.startsWith("data:image/svg+xml")
      ? document.page.backgroundImage
      : null;
  const nextBackgroundImage =
    !document.page.backgroundImage || document.page.backgroundImage.startsWith("data:image/svg+xml")
      ? buildResearchNotePageTemplateSvg()
      : document.page.backgroundImage;

  if (document.blocks.length === 0) {
    return {
      ...document,
      page: {
        ...document.page,
        backgroundImage: buildResearchNotePageTemplateSvg(),
      },
      blocks: templateBlocks,
    };
  }

  const nextBlocks = document.blocks
    .filter((block) => block.type === "image" || frameBlockIds.has(block.id))
    .map((block) => {
    const templateBlock = templateById.get(block.id);
    if (!templateBlock || templateBlock.type !== block.type) {
      return block;
    }

    if (block.type === "text" && templateBlock.type === "text") {
      return {
        ...block,
        x: templateBlock.x,
        y: templateBlock.y,
        w: templateBlock.w,
        h: templateBlock.h,
        locked: templateBlock.locked,
        style: templateBlock.style,
        content: templateBlock.content,
      };
    }

    if (block.type === "image" && templateBlock.type === "image") {
      return {
        ...block,
        x: templateBlock.x,
        y: templateBlock.y,
        w: templateBlock.w,
        h: templateBlock.h,
        locked: templateBlock.locked,
        src: templateBlock.src,
      };
    }

    return block;
  });

  const missingTemplateBlocks = templateBlocks.filter(
    (templateBlock) => !nextBlocks.some((block) => block.id === templateBlock.id)
  );

  const hasContentImage = nextBlocks.some((block) => block.id === "content-image");
  const recoveredContentImage =
    !hasExistingFrame && sourcePageImage && !hasContentImage
      ? [
          {
            id: "content-image",
            type: "image" as const,
            x: 34,
            y: 64,
            w: 726,
            h: 884,
            src: sourcePageImage,
            locked: false,
          },
        ]
      : [];

  return {
    ...document,
    page: {
      ...document.page,
      backgroundImage: nextBackgroundImage,
    },
    blocks: [...nextBlocks, ...missingTemplateBlocks, ...recoveredContentImage],
  };
}

export function HomePage({ currentUser, onCurrentUserChange, openProfileToken }: Props) {
  const [activeSection, setActiveSection] = useState<UserSection>("home");
  const [projectView, setProjectView] = useState<ProjectWorkspaceView>("dashboard");
  const [showCreateProjectForm, setShowCreateProjectForm] = useState(false);
  const [showGitHubRepositoryModal, setShowGitHubRepositoryModal] = useState(false);
  const [showGitHubMappingModal, setShowGitHubMappingModal] = useState(false);
  const [openedProjectId, setOpenedProjectId] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [companyMembers, setCompanyMembers] = useState<CompanyMemberDirectoryItem[]>([]);
  const [researcherManagement, setResearcherManagement] = useState<ResearcherManagementData | null>(null);
  const [githubIntegrations, setGithubIntegrations] = useState<GitHubRepositoryIntegration[]>([]);
  const [githubProjectMappings, setGithubProjectMappings] = useState<GitHubProjectMapping[]>([]);
  const [githubEvents, setGithubEvents] = useState<GitHubEvent[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [projectCover, setProjectCover] = useState<ProjectNoteCover | null>(null);
  const [coverPreviewImageUrl, setCoverPreviewImageUrl] = useState<string | null>(null);
  const [tocPreviewImageUrl, setTocPreviewImageUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [selectedNote, setSelectedNote] = useState<ResearchNote | null>(null);
  const [approvalEvents, setApprovalEvents] = useState<ResearchNoteApprovalEvent[]>([]);
  const [approvalComment, setApprovalComment] = useState("");
  const [noteFiles, setNoteFiles] = useState<NoteFile[]>([]);
  const [noteDocuments, setNoteDocuments] = useState<ResearchNoteDocumentSummary[]>([]);
  const [activeNoteDocument, setActiveNoteDocument] = useState<ResearchNoteDocument | null>(null);
  const [selectedFile, setSelectedFile] = useState<NoteFile | null>(null);
  const [notePages, setNotePages] = useState<NotePage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [signaturePreview, setSignaturePreview] = useState<string | null>(currentUser.signature_data_url);
  const [signatureVersions, setSignatureVersions] = useState<UserSignature[]>([]);
  const [isSignatureDragging, setIsSignatureDragging] = useState(false);
  const [isSavingSignature, setIsSavingSignature] = useState(false);
  const signatureInputRef = useRef<HTMLInputElement | null>(null);
  const [companyAccessRequest, setCompanyAccessRequest] = useState<CompanyAccessRequestInfo | null>(null);
  const [companyAccessName, setCompanyAccessName] = useState("");
  const [companyAccessCode, setCompanyAccessCode] = useState("");
  const [companyAccessNotice, setCompanyAccessNotice] = useState<string | null>(null);
  const [githubRepoOwner, setGithubRepoOwner] = useState("");
  const [githubRepoName, setGithubRepoName] = useState("");
  const [githubRepoUrl, setGithubRepoUrl] = useState("");
  const [githubDefaultBranch, setGithubDefaultBranch] = useState("main");
  const [githubNotes, setGithubNotes] = useState("");
  const [githubMappingIntegrationId, setGithubMappingIntegrationId] = useState<number | "">("");
  const [githubMappingProjectId, setGithubMappingProjectId] = useState("");
  const [githubMappingBranchPattern, setGithubMappingBranchPattern] = useState("main");
  const [githubMappingMode, setGithubMappingMode] = useState("pr_merge");
  const [githubMappingAuthorMemberId, setGithubMappingAuthorMemberId] = useState<number | "">("");
  const [githubMappingReviewerMemberId, setGithubMappingReviewerMemberId] = useState<number | "">("");
  const [githubWebhookSecretNotice, setGithubWebhookSecretNotice] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [ownerMemberId, setOwnerMemberId] = useState<number | "">("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [monthlyNoteTarget, setMonthlyNoteTarget] = useState("");

  const [memberId, setMemberId] = useState<number | "">("");
  const [memberRole, setMemberRole] = useState("member");
  const [inviteEmail, setInviteEmail] = useState("");

  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [projectCodeDraft, setProjectCodeDraft] = useState("");
  const [projectDescriptionDraft, setProjectDescriptionDraft] = useState("");
  const [projectStatusDraft, setProjectStatusDraft] = useState("active");
  const [projectOwnerDraft, setProjectOwnerDraft] = useState<number | "">("");
  const [projectStartDateDraft, setProjectStartDateDraft] = useState("");
  const [projectEndDateDraft, setProjectEndDateDraft] = useState("");
  const [projectMonthlyTargetDraft, setProjectMonthlyTargetDraft] = useState("");
  const [showProjectEditModal, setShowProjectEditModal] = useState(false);

  const [coverTemplate, setCoverTemplate] = useState<CoverTemplate>(buildDefaultCoverTemplate(null));

  const [noteTitle, setNoteTitle] = useState("");
  const [noteOwnerMemberId, setNoteOwnerMemberId] = useState<number | "">("");
  const [noteWrittenDate, setNoteWrittenDate] = useState("");
  const [noteReviewerMemberId, setNoteReviewerMemberId] = useState<number | "">("");
  const [noteReviewedDate, setNoteReviewedDate] = useState("");

  const [noteFileQuery, setNoteFileQuery] = useState("");
  const [noteFileTypeFilter, setNoteFileTypeFilter] = useState("all");
  const [isNoteFileDragging, setIsNoteFileDragging] = useState(false);
  const noteUploadInputRef = useRef<HTMLInputElement | null>(null);
  const noteCreateUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteModalMode, setNoteModalMode] = useState<"create" | "edit">("create");
  const [openedResearchNoteId, setOpenedResearchNoteId] = useState<string | null>(null);
  const [isResearchFilesExpanded, setIsResearchFilesExpanded] = useState(true);
  const [pendingNoteFiles, setPendingNoteFiles] = useState<File[]>([]);
  const [noteNotice, setNoteNotice] = useState<string | null>(null);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [isNoteSelectionMode, setIsNoteSelectionMode] = useState(false);
  const [notesPage, setNotesPage] = useState(1);
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [batchDownloadProgress, setBatchDownloadProgress] = useState<number | null>(null);
  const [noteLayoutStatus, setNoteLayoutStatus] = useState<Record<string, boolean>>({});

  const currentCompanyMember = companyMembers.find((member) => member.user_id === currentUser.id) ?? null;
  const canManageSelectedProject = Boolean(
    selectedProject &&
      (currentUser.is_org_owner ||
        (currentCompanyMember && selectedProject.owner_member_id === currentCompanyMember.company_member_id))
  );
  const canManageGitHubIntegrations = currentUser.is_org_owner || currentUser.is_admin;
  const availableProjectResearchers = companyMembers.filter(
    (companyMember) => !members.some((member) => member.company_member_id === companyMember.company_member_id)
  );
  const organizationResearchers = [...(researcherManagement?.members ?? [])].sort((left, right) => {
      if (left.role === "owner" && right.role !== "owner") return -1;
      if (left.role !== "owner" && right.role === "owner") return 1;
      return left.name.localeCompare(right.name, "ko");
    });
  const todayIso = new Date().toISOString().slice(0, 10);
  const defaultNoteAuthorMemberId: number | "" = currentCompanyMember?.company_member_id ?? companyMembers[0]?.company_member_id ?? "";
  const defaultNoteReviewerMemberId: number | "" = selectedProject?.owner_member_id ?? "";
  const projectResearchers = [...members].sort((left, right) => {
    const leftIsLead = selectedProject?.owner_member_id === left.company_member_id;
    const rightIsLead = selectedProject?.owner_member_id === right.company_member_id;
    if (leftIsLead && !rightIsLead) return -1;
    if (!leftIsLead && rightIsLead) return 1;
    return left.name.localeCompare(right.name, "ko");
  });
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const notesThisMonth = notes.filter((note) => (note.written_date ?? note.created_at).slice(0, 7) === currentMonthKey).length;
  const projectMonthlyGoal = selectedProject?.monthly_note_target ?? 0;
  const monthlyGoalProgress = projectMonthlyGoal > 0 ? Math.min(100, Math.round((notesThisMonth / projectMonthlyGoal) * 100)) : 0;
  const inactivityThresholdMs = 1000 * 60 * 60 * 24 * 7;
  const inactiveProjectResearchers = projectResearchers
    .map((member) => {
      const memberNotes = notes
        .filter((note) => note.owner_member_id === member.company_member_id)
        .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime());
      const lastActivity = memberNotes[0]?.updated_at ?? null;
      const isInactive = !lastActivity || Date.now() - new Date(lastActivity).getTime() > inactivityThresholdMs;
      return {
        member,
        lastActivity,
        noteCount: memberNotes.length,
        isInactive,
      };
    })
    .filter((entry) => entry.isInactive);

  useEffect(() => {
    setSelectedNoteIds((current) => current.filter((id) => notes.some((note) => note.id === id)));
  }, [notes]);

  useEffect(() => {
    setNotesPage(1);
    setSelectedNoteIds([]);
    setIsNoteSelectionMode(false);
  }, [selectedProject?.id]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(notes.length / 10));
    setNotesPage((current) => Math.min(current, totalPages));
  }, [notes]);

  const getCompanyMemberName = (companyMemberId: number | null | undefined) => {
    if (!companyMemberId) return "Unassigned";
    return companyMembers.find((member) => member.company_member_id === companyMemberId)?.name ?? `Member #${companyMemberId}`;
  };

  const getCompanyMember = (companyMemberId: number | null | undefined) =>
    companyMemberId ? companyMembers.find((member) => member.company_member_id === companyMemberId) ?? null : null;

  const selectedNoteIsLocked = selectedNote ? !EDITABLE_NOTE_STATUSES.has(selectedNote.status) : false;
  const selectedNoteIsAuthor = Boolean(
    selectedNote && currentCompanyMember?.company_member_id === selectedNote.owner_member_id
  );
  const selectedNoteIsReviewer = Boolean(
    selectedNote && currentCompanyMember?.company_member_id === selectedNote.reviewer_member_id
  );
  const selectedNoteStatusLabel = selectedNote
    ? noteStatusLabels[selectedNote.status] ?? selectedNote.status
    : "";
  const canSubmitSelectedNote = Boolean(
    selectedNote &&
      EDITABLE_NOTE_STATUSES.has(selectedNote.status) &&
      (canManageSelectedProject || selectedNoteIsAuthor)
  );
  const canReviewSelectedNote = Boolean(
    selectedNote &&
      selectedNote.status === "submitted" &&
      (canManageSelectedProject || selectedNoteIsReviewer)
  );
  const canReopenSelectedNote = Boolean(
    selectedNote &&
      selectedNote.status === "approved" &&
      canManageSelectedProject
  );

  const buildNoteTemplateContext = (overrides: NoteTemplateOverrides = {}): NoteTemplateContext => {
      const requestedAuthorMemberId = overrides.authorMemberId ?? noteOwnerMemberId;
      const requestedReviewerMemberId = overrides.reviewerMemberId ?? noteReviewerMemberId;
      const projectManagerMemberId =
        typeof selectedProject?.owner_member_id === "number" ? selectedProject.owner_member_id : undefined;
      const normalizedAuthorMemberId: number | undefined =
        requestedAuthorMemberId === ""
          ? typeof defaultNoteAuthorMemberId === "number"
            ? defaultNoteAuthorMemberId
            : undefined
          : typeof requestedAuthorMemberId === "number"
            ? requestedAuthorMemberId
            : undefined;
      const normalizedReviewerMemberId: number | undefined =
        requestedReviewerMemberId === ""
          ? typeof defaultNoteReviewerMemberId === "number"
            ? defaultNoteReviewerMemberId
            : projectManagerMemberId
          : typeof requestedReviewerMemberId === "number"
            ? requestedReviewerMemberId
            : projectManagerMemberId;
      return {
        projectTitle: selectedProject?.name ?? "Research Project",
        projectPeriod: formatProjectPeriod(selectedProject?.start_date ?? null, selectedProject?.end_date ?? null),
        principalInvestigator: getCompanyMemberName(selectedProject?.owner_member_id),
        organization: researcherManagement?.company.name ?? coverTemplate.organization ?? "LABNOTE",
        authorName: getCompanyMemberName(normalizedAuthorMemberId),
        writtenDate: overrides.writtenDate ?? (noteWrittenDate || todayIso),
        reviewerName: getCompanyMemberName(normalizedReviewerMemberId),
        reviewedDate: overrides.reviewedDate ?? (noteReviewedDate || todayIso),
        authorSignatureUrl: getCompanyMember(normalizedAuthorMemberId)?.signature_data_url ?? null,
        reviewerSignatureUrl: getCompanyMember(normalizedReviewerMemberId)?.signature_data_url ?? null,
      };
    };

  const hydrateDefaultMember = (items: CompanyMemberDirectoryItem[]) => {
    if (items.length === 0) return;
    const firstId = items[0].company_member_id;
    setOwnerMemberId((current) => (current === "" ? firstId : current));
    setMemberId((current) => (current === "" ? firstId : current));
    setNoteOwnerMemberId((current) => (current === "" ? firstId : current));
    setNoteReviewerMemberId((current) => (current === "" ? firstId : current));
  };

  const refreshProjects = async () => {
    try {
      if (!currentUser.organization_id) {
        setProjects([]);
        return;
      }
      const data = await listProjects(currentUser.organization_id);
      setProjects(data);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const refreshCompanyMembers = async () => {
    try {
      const data = await listCompanyMembers();
      setCompanyMembers(data);
      hydrateDefaultMember(data);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const refreshResearcherManagement = async () => {
    if (!currentUser.is_org_owner) {
      setResearcherManagement(null);
      return;
    }
    try {
      const data = await getResearcherManagement();
      setResearcherManagement(data);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const refreshSignatures = async () => {
    try {
      const data = await listMySignatures();
      setSignatureVersions(data);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const refreshGitHubIntegrations = async () => {
    try {
      if (!currentUser.organization_id) {
        setGithubIntegrations([]);
        setGithubProjectMappings([]);
        setGithubEvents([]);
        return;
      }
      const data = await listGitHubIntegrations(currentUser.organization_id);
      setGithubIntegrations(data);
      setGithubMappingIntegrationId((current) => data.some((integration) => integration.id === current) ? current : data[0]?.id || "");
      const mappingGroups = await Promise.all(data.map((integration) => listGitHubProjectMappings(integration.id)));
      setGithubProjectMappings(mappingGroups.flat());
      setGithubEvents(await listGitHubEvents());
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const refreshNotes = async (projectId: string) => {
    try {
      const data = await listResearchNotes(projectId);
      setNotes(data);
      const layoutEntries = await Promise.all(
        data.map(async (note) => {
          const documents = await listResearchNoteDocuments(note.id);
          return [note.id, documents.length > 0] as const;
        })
      );
      setNoteLayoutStatus(Object.fromEntries(layoutEntries));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const refreshNoteFiles = async (noteId: string) => {
    try {
      const files = await listNoteFiles(noteId);
      setNoteFiles(files);
      return files;
    } catch (err) {
      setError((err as Error).message);
      return [];
    }
  };

  const loadNotePagesForFiles = async (files: NoteFile[]) => {
    if (files.length === 0) {
      setNotePages([]);
      return [];
    }
    const pageGroups = await Promise.all(files.map((file) => listNotePages(file.id)));
    const pages = pageGroups.flat();
    setNotePages(pages);
    return pages;
  };

  const refreshNoteDocuments = async (noteId: string, overrides: NoteTemplateOverrides = {}) => {
      try {
        const documents = await listResearchNoteDocuments(noteId);
        setNoteDocuments(documents);
        if (documents.length === 0) {
          setActiveNoteDocument(null);
        return false;
      }
        const preferredId = activeNoteDocument?.note_id === noteId ? activeNoteDocument.id : documents[0].id;
        const resolvedId = documents.find((item) => item.id === preferredId)?.id ?? documents[0].id;
        const fullDocument = await getResearchNoteDocument(resolvedId);
        const targetNote = selectedNote && selectedNote.id === noteId ? selectedNote : await getResearchNote(noteId);
        setActiveNoteDocument({
          ...fullDocument,
          document: ensureResearchNoteDocumentFrame(fullDocument.document, targetNote, buildNoteTemplateContext(overrides)),
        });
        return true;
      } catch (err) {
        setError((err as Error).message);
        return false;
      }
    };

  const hydrateProjectDrafts = (project: Project) => {
    setProjectNameDraft(project.name);
    setProjectCodeDraft(project.code);
    setProjectDescriptionDraft(project.description ?? "");
    setProjectStatusDraft(project.status);
    setProjectOwnerDraft(project.owner_member_id ?? "");
    setProjectStartDateDraft(project.start_date ?? "");
    setProjectEndDateDraft(project.end_date ?? "");
    setProjectMonthlyTargetDraft(project.monthly_note_target?.toString() ?? "");
  };

  const hydrateCoverDrafts = (cover: ProjectNoteCover | null, project: Project | null = selectedProject) => {
    setProjectCover(cover);
    setCoverPreviewImageUrl(cover?.cover_image_data_url ?? null);
    setCoverTemplate(
      parseCoverTemplate(
        cover?.template_payload ?? null,
        project,
        getCompanyMemberName(project?.owner_member_id),
        researcherManagement?.company.name ?? "LABNOTE"
      )
    );
  };

  useEffect(() => {
    void refreshProjects();
    void refreshCompanyMembers();
    void refreshResearcherManagement();
    void refreshSignatures();
    void refreshGitHubIntegrations();
  }, [currentUser.id, currentUser.organization_id, currentUser.is_org_owner]);

  useEffect(() => {
    setSignaturePreview(currentUser.signature_data_url);
  }, [currentUser.signature_data_url]);

  useEffect(() => {
    if (openProfileToken > 0) {
      setActiveSection("profile");
      setOpenedProjectId(null);
    }
  }, [openProfileToken]);

  useEffect(() => {
    if (currentUser.is_org_owner || currentUser.organization_id) {
      setCompanyAccessRequest(null);
      setCompanyAccessNotice(null);
      return;
    }

    void (async () => {
      try {
        const result = await getMyCompanyAccessRequest();
        setCompanyAccessRequest(result.request);
        setCompanyAccessNotice(result.message);
        onCurrentUserChange(result.user);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [currentUser.id, currentUser.is_org_owner, currentUser.organization_id, onCurrentUserChange]);

  useEffect(() => {
    if (selectedNote) {
      const stillExists = notes.some((note) => note.id === selectedNote.id);
      if (!stillExists) {
        setSelectedNote(null);
        setApprovalComment("");
        setApprovalEvents([]);
      }
      return;
    }

    if (notes.length > 0) {
      void onSelectNote(notes[0].id);
    }
  }, [notes, selectedNote]);

  useEffect(() => {
    if (noteFiles.length === 0) {
      setSelectedFile(null);
      setNotePages([]);
      return;
    }
    if (selectedFile && noteFiles.some((file) => file.id === selectedFile.id)) {
      return;
    }
    void onSelectFile(noteFiles[0]);
  }, [noteFiles, selectedFile]);

  useEffect(() => {
    if (!selectedProject) return;
    const stillAccessible = projects.some((project) => project.id === selectedProject.id);
    if (!stillAccessible) {
      setSelectedProject(null);
      setOpenedProjectId(null);
      setMembers([]);
      setNotes([]);
      setSelectedNote(null);
      setApprovalComment("");
      setApprovalEvents([]);
    }
  }, [projects, selectedProject]);

  useEffect(() => {
    if (!selectedProject) {
      setCoverPreviewImageUrl(null);
      return;
    }

    const resolved = resolveCoverTemplate(
      coverTemplate,
      selectedProject,
      getCompanyMemberName(selectedProject?.owner_member_id),
      researcherManagement?.company.name ?? "LABNOTE"
    );

    let cancelled = false;
    void generateCoverImageDataUrl(resolved, selectedProject)
      .then((url) => {
        if (!cancelled) {
          setCoverPreviewImageUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCoverPreviewImageUrl(projectCover?.cover_image_data_url ?? null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [coverTemplate, selectedProject, researcherManagement?.company.name, projectCover?.cover_image_data_url]);

  useEffect(() => {
    let cancelled = false;

    const fallbackTitle = selectedProject?.name ?? "Research Note";
    const sampleEntries = (notes.length > 0 ? notes.slice(0, 20) : [{ id: "sample", title: fallbackTitle, created_at: new Date().toISOString() } as ResearchNote]).map(
      (note, index) => ({
        index: index + 1,
        title: note.title,
        createdAt: note.created_at ? new Date(note.created_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        page: index + 3,
      })
    );

    void generateTocImageDataUrl(sampleEntries, true)
      .then((url) => {
        if (!cancelled) {
          setTocPreviewImageUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTocPreviewImageUrl(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [notes, selectedProject?.name]);

  const onCreateProject = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      if (!currentUser.organization_id) {
        throw new Error("You must belong to an organization before creating a project.");
      }
      await createProject({
        company_id: currentUser.organization_id,
        name,
        code,
        description,
        owner_member_id: ownerMemberId === "" ? undefined : ownerMemberId,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        monthly_note_target: monthlyNoteTarget ? Number(monthlyNoteTarget) : undefined,
      });
      setName("");
      setCode("");
      setDescription("");
      setOwnerMemberId("");
      setStartDate("");
      setEndDate("");
      setMonthlyNoteTarget("");
      setShowCreateProjectForm(false);
      await refreshProjects();
      hydrateDefaultMember(companyMembers);
      setActiveSection("projects");
      setProjectView("dashboard");
      setOpenedProjectId(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onSelectProject = async (project: Project) => {
    setActiveSection("projects");
    setSelectedProject(project);
    setProjectView("dashboard");
    setSelectedNote(null);
    setOpenedResearchNoteId(null);
    setActiveNoteDocument(null);
    setNoteDocuments([]);
    setSelectedFile(null);
    setNotePages([]);
    setNoteFiles([]);
    setApprovalComment("");
    setApprovalEvents([]);

    try {
      const [memberData] = await Promise.all([getProjectMembers(project.id), refreshNotes(project.id)]);
      setMembers(memberData);
      hydrateProjectDrafts(project);
        const cover = await getProjectCover(project.id);
        hydrateCoverDrafts(cover, project);
        return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  };

  const onOpenProjectPage = async (project: Project) => {
    const loaded = await onSelectProject(project);
    if (!loaded) return;
    setOpenedProjectId(project.id);
    setProjectView("dashboard");
  };

  const onBackToProjects = () => {
    setOpenedProjectId(null);
  };

  const onAssignMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProject || memberId === "") return;

    try {
      await assignProjectMember(selectedProject.id, memberId, memberRole);
      const data = await getProjectMembers(selectedProject.id);
      setMembers(data);
      setMemberId("");
      setMemberRole("member");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onRemoveAssignedMember = async (companyMemberId: number) => {
    if (!selectedProject) return;

    try {
      await removeProjectMember(selectedProject.id, companyMemberId);
      const data = await getProjectMembers(selectedProject.id);
      setMembers(data);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onSaveProjectDashboard = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProject) return;

    try {
      const updated = await updateProject(selectedProject.id, {
        name: projectNameDraft,
        code: projectCodeDraft,
        description: projectDescriptionDraft,
        status: projectStatusDraft,
        owner_member_id: projectOwnerDraft === "" ? undefined : projectOwnerDraft,
        start_date: projectStartDateDraft || undefined,
        end_date: projectEndDateDraft || undefined,
        monthly_note_target: projectMonthlyTargetDraft ? Number(projectMonthlyTargetDraft) : undefined,
      });
      setSelectedProject(updated);
      setProjects((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      hydrateProjectDrafts(updated);
      await refreshProjects();
        const [memberData, cover] = await Promise.all([getProjectMembers(updated.id), getProjectCover(updated.id)]);
        setMembers(memberData);
        hydrateCoverDrafts(cover, updated);
      } catch (err) {
        setError((err as Error).message);
      }
  };

  const onCreateNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProject || noteOwnerMemberId === "") return;

    try {
        const created = await createResearchNote({
          project_id: selectedProject.id,
          title: noteTitle,
          owner_member_id: noteOwnerMemberId,
          written_date: noteWrittenDate || undefined,
          reviewer_member_id: noteReviewerMemberId === "" ? undefined : noteReviewerMemberId,
        reviewed_date: noteReviewedDate || undefined,
        last_updated_by: currentUser.id,
      });
      if (pendingNoteFiles.length > 0) {
        for (const pendingFile of pendingNoteFiles) {
          await uploadNoteFile(created.id, noteOwnerMemberId, pendingFile);
        }
      }
        setNoteTitle("");
        setNoteWrittenDate("");
        setNoteReviewedDate("");
      setPendingNoteFiles([]);
      setShowNoteModal(false);
      await refreshNotes(selectedProject.id);
      setSelectedNoteIds([]);
      await onSelectNote(created.id);
      setOpenedResearchNoteId(created.id);
      setNoteNotice(pendingNoteFiles.length > 0 ? "Research note created and files uploaded." : "Research note created.");
    } catch (err) {
      setError((err as Error).message);
    }
  };

    const onSelectNote = async (noteId: string) => {
      try {
        const detail = await getResearchNote(noteId);
        const noteDefaults: NoteTemplateOverrides = {
          authorMemberId: defaultNoteAuthorMemberId,
          writtenDate: todayIso,
          reviewerMemberId: defaultNoteReviewerMemberId,
          reviewedDate: todayIso,
        };
        setSelectedNote(detail);
        setApprovalComment("");
        setApprovalEvents(await listResearchNoteApprovalEvents(noteId));
        setNoteTitle(detail.title);
        setNoteOwnerMemberId(detail.owner_member_id ?? defaultNoteAuthorMemberId);
        setNoteWrittenDate(detail.written_date ?? todayIso);
        setNoteReviewerMemberId(detail.reviewer_member_id ?? defaultNoteReviewerMemberId);
        setNoteReviewedDate(detail.reviewed_date ?? todayIso);
        const files = await refreshNoteFiles(noteId);
        if (files.length > 0) {
          setSelectedFile(files[0]);
          const pages = await loadNotePagesForFiles(files);
          const hasDocument = await refreshNoteDocuments(noteId, noteDefaults);
          if (!hasDocument && pages.length > 0 && EDITABLE_NOTE_STATUSES.has(detail.status)) {
            const draft = buildDefaultNoteDocument(detail, pages[0], buildNoteTemplateContext(noteDefaults));
            const saved = await createResearchNoteDocument({
              note_id: detail.id,
              title: draft.title,
              source_file_id: draft.meta.sourceFileId ?? null,
              source_page_id: draft.meta.sourcePageId ?? null,
              document: draft,
            });
            setActiveNoteDocument(saved);
            await refreshNoteDocuments(noteId, noteDefaults);
          }
        } else {
          setSelectedFile(null);
          setNotePages([]);
          await refreshNoteDocuments(noteId, noteDefaults);
        }
      } catch (err) {
        setError((err as Error).message);
      }
    };

  const onSaveNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedNote || !selectedProject) return;
    if (selectedNoteIsLocked) {
      setError("Submitted or approved research notes cannot be changed.");
      return;
    }

    try {
      const updated = await updateResearchNote(selectedNote.id, {
          title: noteTitle,
          content: undefined,
          owner_member_id: noteOwnerMemberId === "" ? undefined : noteOwnerMemberId,
          written_date: noteWrittenDate || undefined,
          reviewer_member_id: noteReviewerMemberId === "" ? undefined : noteReviewerMemberId,
        reviewed_date: noteReviewedDate || undefined,
        last_updated_by: currentUser.id,
      });
      setSelectedNote(updated);
      setShowNoteModal(false);
      await refreshNotes(selectedProject.id);
      setSelectedNoteIds((current) => current.filter((id) => id !== selectedNote.id || notes.some((note) => note.id === id)));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const openCreateNoteModal = (files: File[] = []) => {
      setNoteModalMode("create");
      setNoteTitle("");
      setNoteOwnerMemberId(defaultNoteAuthorMemberId);
      setNoteWrittenDate(todayIso);
      setNoteReviewerMemberId(defaultNoteReviewerMemberId);
      setNoteReviewedDate(todayIso);
      setPendingNoteFiles(files);
      setShowNoteModal(true);
    };

  const openEditNoteModal = () => {
      if (!selectedNote) return;
      if (selectedNoteIsLocked) {
        setError("Submitted or approved research notes cannot be changed.");
        return;
      }
      setNoteModalMode("edit");
      setNoteTitle(selectedNote.title);
      setNoteOwnerMemberId(selectedNote.owner_member_id ?? defaultNoteAuthorMemberId);
      setNoteWrittenDate(selectedNote.written_date ?? todayIso);
      setNoteReviewerMemberId(selectedNote.reviewer_member_id ?? defaultNoteReviewerMemberId);
      setNoteReviewedDate(selectedNote.reviewed_date ?? todayIso);
      setPendingNoteFiles([]);
      setShowNoteModal(true);
    };

  const queueResearchFilesForNewNote = (files: File[]) => {
    if (files.length === 0) return;
    setError(null);
    openCreateNoteModal(files);
  };

  const onResearchFileDrop = async (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsNoteFileDragging(false);
    queueResearchFilesForNewNote(Array.from(event.dataTransfer.files ?? []));
  };

  const onSelectFile = async (file: NoteFile) => {
    setSelectedFile(file);
    try {
      const pages = await listNotePages(file.id);
      setNotePages(pages);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onLoadNoteDocument = async (documentId: string) => {
    if (!documentId) return;
    try {
      const document = await getResearchNoteDocument(documentId);
      if (!selectedNote) {
        setActiveNoteDocument(document);
        return;
      }
      setActiveNoteDocument({
        ...document,
        document: ensureResearchNoteDocumentFrame(document.document, selectedNote, buildNoteTemplateContext()),
      });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onCreateNoteDocument = async () => {
    if (!selectedNote) return;
    if (selectedNoteIsLocked) {
      setError("Submitted or approved research notes cannot be changed.");
      return;
    }
    try {
      const draft = buildDefaultNoteDocument(selectedNote, notePages[0] ?? null, buildNoteTemplateContext());
      const saved = await createResearchNoteDocument({
        note_id: selectedNote.id,
        title: draft.title,
        source_file_id: draft.meta.sourceFileId ?? null,
        source_page_id: draft.meta.sourcePageId ?? null,
        document: draft,
      });
      setActiveNoteDocument(saved);
      await refreshNoteDocuments(selectedNote.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onSaveNoteDocument = async (document: DocumentSchema): Promise<ResearchNoteDocument> => {
    if (!selectedNote) {
      throw new Error("Select a research note first");
    }
    if (selectedNoteIsLocked) {
      throw new Error("Submitted or approved research notes cannot be changed.");
    }
    try {
      const normalizedDocument = ensureResearchNoteDocumentFrame(document, selectedNote, buildNoteTemplateContext());
      const saved = activeNoteDocument
        ? await updateResearchNoteDocument(activeNoteDocument.id, {
            note_id: selectedNote.id,
            title: normalizedDocument.title,
            source_file_id: normalizedDocument.meta.sourceFileId ?? null,
            source_page_id: normalizedDocument.meta.sourcePageId ?? null,
            document: normalizedDocument,
          })
        : await createResearchNoteDocument({
            note_id: selectedNote.id,
            title: normalizedDocument.title,
            source_file_id: normalizedDocument.meta.sourceFileId ?? null,
            source_page_id: normalizedDocument.meta.sourcePageId ?? null,
            document: normalizedDocument,
          });
      setActiveNoteDocument(saved);
      await refreshNoteDocuments(selectedNote.id);
      setNoteLayoutStatus((current) => ({ ...current, [selectedNote.id]: true }));
      return saved;
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  };

  const onUploadFilesToSelectedNote = async (files: File[]) => {
    if (!selectedNote || files.length === 0) return;
    if (selectedNoteIsLocked) {
      setError("Submitted or approved research notes cannot be changed.");
      return;
    }
    try {
      setError(null);
      for (const file of files) {
        await uploadNoteFile(selectedNote.id, selectedNote.owner_member_id, file);
      }
      const refreshedFiles = await refreshNoteFiles(selectedNote.id);
      const refreshedPages = await loadNotePagesForFiles(refreshedFiles);
      if (refreshedFiles.length > 0) {
        const newestFile = refreshedFiles[refreshedFiles.length - 1];
        setSelectedFile(newestFile);
      }
      if (!activeNoteDocument && refreshedPages.length > 0) {
        await onCreateNoteDocument();
      }
      setNoteNotice(
        `${files.length} file${files.length > 1 ? "s were" : " was"} added to ${selectedNote.title}.`
      );
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onReplaceNotePageAsset = async (pageId: number, file: File): Promise<NotePage> => {
    if (!selectedNote) {
      throw new Error("Select a research note first");
    }
    if (selectedNoteIsLocked) {
      throw new Error("Submitted or approved research notes cannot be changed.");
    }
    try {
      setError(null);
      const updatedPage = await replaceNotePageAsset(pageId, file, "Replaced from document editor");
      setNotePages((current) => current.map((page) => (page.id === updatedPage.id ? updatedPage : page)));
      if (selectedNote) {
        const files = await refreshNoteFiles(selectedNote.id);
        await loadNotePagesForFiles(files);
      }
      setNoteNotice("Research note page image replaced.");
      return updatedPage;
    } catch (err) {
      setError((err as Error).message);
      throw err;
    }
  };

  const refreshSelectedNoteWorkflow = async (noteId: string) => {
    const [detail, events] = await Promise.all([
      getResearchNote(noteId),
      listResearchNoteApprovalEvents(noteId),
    ]);
    setSelectedNote(detail);
    setNotes((current) => current.map((note) => (note.id === detail.id ? detail : note)));
    setApprovalEvents(events);
    await refreshNoteDocuments(noteId);
    if (selectedProject) {
      await refreshNotes(selectedProject.id);
    }
  };

  const runSelectedNoteApprovalAction = async (action: "submit" | "approve" | "reject" | "reopen") => {
    if (!selectedNote) return;
    const comment = approvalComment.trim();
    if ((action === "reject" || action === "reopen") && comment.length === 0) {
      setError(action === "reject" ? "Rejection comment is required." : "Reopen reason is required.");
      return;
    }

    try {
      setError(null);
      if (action === "submit") {
        await submitResearchNote(selectedNote.id, comment || undefined);
      } else if (action === "approve") {
        await approveResearchNote(selectedNote.id, comment || undefined);
      } else if (action === "reject") {
        await rejectResearchNote(selectedNote.id, comment);
      } else {
        await reopenResearchNote(selectedNote.id, comment);
      }
      await refreshSelectedNoteWorkflow(selectedNote.id);
      setApprovalComment("");
      setNoteNotice(approvalNoticeByAction[action]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onSaveProjectCover = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProject) return;

    try {
      const resolvedForSave = resolveCoverTemplate(
        coverTemplate,
        selectedProject,
        getCompanyMemberName(selectedProject?.owner_member_id),
        researcherManagement?.company.name ?? "LABNOTE"
      );
      const coverImageDataUrl = coverPreviewImageUrl ?? (await generateCoverImageDataUrl(resolvedForSave, selectedProject));
      const saved = await upsertProjectCover(selectedProject.id, {
        cover_image_data_url: coverImageDataUrl,
        template_payload: JSON.stringify(coverTemplate, null, 2),
        show_business_name: coverTemplate.showOrganization,
        show_title: coverTemplate.showProjectTitle,
        show_code: coverTemplate.showCode,
        show_org: coverTemplate.showOrganization,
        show_manager: coverTemplate.showPrincipalInvestigator,
        show_period: coverTemplate.showProjectPeriod,
      });
      hydrateCoverDrafts(saved);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const persistSignature = async (dataUrl: string | null) => {
    setIsSavingSignature(true);
    setError(null);
    setProfileNotice(null);
    try {
      const updatedUser = await updateMySignature(dataUrl);
      onCurrentUserChange(updatedUser);
      setSignaturePreview(updatedUser.signature_data_url);
      setProfileNotice(dataUrl ? "Signature updated." : "Signature removed.");
      await Promise.all([refreshSignatures(), refreshCompanyMembers()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSavingSignature(false);
    }
  };

  const readSignatureFile = async (file: File) =>
    await new Promise<string>((resolve, reject) => {
      if (!file.type.startsWith("image/")) {
        reject(new Error("Only image files can be used as a signature."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Failed to read the signature image."));
      reader.readAsDataURL(file);
    });

  const onSignatureFileChange = async (file: File | null) => {
    if (!file) return;
    setIsSavingSignature(true);
    setError(null);
    setProfileNotice(null);
    try {
      const dataUrl = await readSignatureFile(file);
      await createMySignature(file);
      onCurrentUserChange({ ...currentUser, signature_data_url: dataUrl });
      setSignaturePreview(dataUrl);
      setProfileNotice("Signature uploaded.");
      await Promise.all([refreshSignatures(), refreshCompanyMembers()]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSavingSignature(false);
    }
  };

  const onRevokeSignature = async (signatureId: number) => {
    const signature = signatureVersions.find((item) => item.id === signatureId);
    try {
      setError(null);
      await revokeMySignature(signatureId);
      if (signature?.status === "active") {
        onCurrentUserChange({ ...currentUser, signature_data_url: null });
        setSignaturePreview(null);
      }
      setProfileNotice("Signature removed.");
      await Promise.all([refreshSignatures(), refreshCompanyMembers()]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onSignatureDrop = async (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setIsSignatureDragging(false);
    await onSignatureFileChange(event.dataTransfer.files?.[0] ?? null);
  };

  const onOpenResearchNote = async (noteId: string) => {
    await onSelectNote(noteId);
    setOpenedResearchNoteId(noteId);
  };

  const onToggleNoteSelection = (noteId: string) => {
    setSelectedNoteIds((current) =>
      current.includes(noteId) ? current.filter((id) => id !== noteId) : [...current, noteId]
    );
  };

  const notesPerPage = 10;
  const totalNotePages = Math.max(1, Math.ceil(notes.length / notesPerPage));
  const paginatedNotes = notes.slice((notesPage - 1) * notesPerPage, notesPage * notesPerPage);

  const onToggleAllNoteSelections = () => {
    const pageNoteIds = paginatedNotes.map((note) => note.id);
    setSelectedNoteIds((current) => {
      const allSelected = pageNoteIds.every((id) => current.includes(id));
      if (allSelected) {
        return current.filter((id) => !pageNoteIds.includes(id));
      }
      return Array.from(new Set([...current, ...pageNoteIds]));
    });
  };

  const onDownloadSelectedNotes = async () => {
    if (!isNoteSelectionMode) {
      setIsNoteSelectionMode(true);
      setSelectedNoteIds([]);
      setNoteNotice("Select research notes to include, then click Download Selected again.");
      return;
    }

    if (selectedNoteIds.length === 0) {
      setNoteNotice("Select at least one research note before downloading.");
      return;
    }

    try {
      setIsBatchDownloading(true);
      setBatchDownloadProgress(0);
      await downloadSelectedResearchNotesPdf(selectedNoteIds, (progress) => {
        setBatchDownloadProgress(progress.percent);
      });
      setNoteNotice(`${selectedNoteIds.length} research note PDF${selectedNoteIds.length > 1 ? "s were" : " was"} downloaded.`);
      setIsNoteSelectionMode(false);
      setSelectedNoteIds([]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsBatchDownloading(false);
      window.setTimeout(() => setBatchDownloadProgress(null), 400);
    }
  };

  const onBackToResearchNoteList = () => {
    setOpenedResearchNoteId(null);
    setSelectedFile(null);
    setNotePages([]);
    setApprovalComment("");
    setApprovalEvents([]);
  };

  const onDeleteResearchNote = async (noteId: string) => {
    if (!selectedProject) return;
    try {
      setError(null);
      await deleteResearchNote(noteId);
      if (selectedNote?.id === noteId) {
        setSelectedNote(null);
        setOpenedResearchNoteId(null);
        setActiveNoteDocument(null);
        setSelectedFile(null);
        setNoteFiles([]);
        setNotePages([]);
        setApprovalComment("");
        setApprovalEvents([]);
      }
      setSelectedNoteIds((current) => current.filter((id) => id !== noteId));
      await refreshNotes(selectedProject.id);
      setNoteNotice("Research note and attached files were deleted.");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onRequestCompanyAccess = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const result = await requestMyCompanyAccess({
        organization_name: companyAccessName,
        organization_code: companyAccessCode,
      });
      setCompanyAccessRequest(result.request);
      setCompanyAccessNotice(result.message);
      onCurrentUserChange(result.user);
      if (result.request) {
        setCompanyAccessName(result.request.company_name);
        setCompanyAccessCode(result.request.company_code);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onCreateGitHubIntegration = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentUser.organization_id) return;
    try {
      setError(null);
      await createGitHubIntegration({
        company_id: currentUser.organization_id,
        repo_owner: githubRepoOwner,
        repo_name: githubRepoName,
        repository_url: githubRepoUrl || undefined,
        default_branch: githubDefaultBranch || "main",
        status: "active",
        notes: githubNotes || undefined,
      });
      setGithubRepoOwner("");
      setGithubRepoName("");
      setGithubRepoUrl("");
      setGithubDefaultBranch("main");
      setGithubNotes("");
      await refreshGitHubIntegrations();
      setShowGitHubRepositoryModal(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onToggleGitHubIntegrationStatus = async (integration: GitHubRepositoryIntegration) => {
    try {
      setError(null);
      await updateGitHubIntegration(integration.id, {
        status: integration.status === "active" ? "paused" : "active",
      });
      await refreshGitHubIntegrations();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onDeleteGitHubIntegration = async (integrationId: number) => {
    try {
      setError(null);
      await deleteGitHubIntegration(integrationId);
      await refreshGitHubIntegrations();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onRotateGitHubWebhookSecret = async (integrationId: number) => {
    try {
      setError(null);
      const result = await rotateGitHubWebhookSecret(integrationId);
      setGithubWebhookSecretNotice(`Webhook URL: ${result.webhook_url} / Secret: ${result.webhook_secret}`);
      await refreshGitHubIntegrations();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onCreateGitHubProjectMapping = async (event: FormEvent) => {
    event.preventDefault();
    if (!githubMappingIntegrationId || !githubMappingProjectId) return;
    try {
      setError(null);
      await createGitHubProjectMapping(Number(githubMappingIntegrationId), {
        project_id: githubMappingProjectId,
        branch_pattern: githubMappingBranchPattern || "*",
        note_creation_mode: githubMappingMode,
        default_author_member_id: githubMappingAuthorMemberId === "" ? null : githubMappingAuthorMemberId,
        default_reviewer_member_id: githubMappingReviewerMemberId === "" ? null : githubMappingReviewerMemberId,
        is_active: true,
      });
      setGithubMappingProjectId("");
      setGithubMappingBranchPattern("main");
      setGithubMappingMode("pr_merge");
      setGithubMappingAuthorMemberId("");
      setGithubMappingReviewerMemberId("");
      await refreshGitHubIntegrations();
      setShowGitHubMappingModal(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onToggleGitHubProjectMapping = async (mapping: GitHubProjectMapping) => {
    try {
      setError(null);
      await updateGitHubProjectMapping(mapping.id, { is_active: !mapping.is_active });
      await refreshGitHubIntegrations();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onDeleteGitHubProjectMapping = async (mappingId: number) => {
    try {
      setError(null);
      await deleteGitHubProjectMapping(mappingId);
      await refreshGitHubIntegrations();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onGenerateNoteFromGitHubEvent = async (eventId: number) => {
    try {
      setError(null);
      await generateResearchNoteFromGitHubEvent(eventId);
      await refreshGitHubIntegrations();
      if (selectedProject) {
        await refreshNotes(selectedProject.id);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onInviteResearcher = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await createResearcherInvitation(inviteEmail);
      setInviteEmail("");
      await Promise.all([refreshResearcherManagement(), refreshCompanyMembers()]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onRemoveCompanyResearcher = async (companyMemberId: number) => {
    try {
      await removeResearcherMember(companyMemberId);
      await Promise.all([refreshResearcherManagement(), refreshCompanyMembers()]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const renderHome = () => {
    const recentProjects = projects.slice(0, 3);
    const recentActivity = [
      {
        title: "Research workspace ready",
        body: selectedProject
          ? `${selectedProject.name} project workspace is available for dashboard, members, notes, and cover management.`
          : "Open Project Management to enter a dedicated research note workspace.",
        time: "Now",
      },
      {
        title: "Researcher roster synced",
        body: `${companyMembers.length} company members are available for company and project assignment flows.`,
        time: "Today",
      },
      {
        title: "Research note package export",
        body: "Cover, table of contents, and selected note pages can be merged into a single PDF package.",
        time: "Today",
      },
      {
        title: "Profile signature ready",
        body: currentUser.signature_data_url
          ? "Your saved signature can be reused inside research note approval fields."
          : "Add a signature from the profile menu to populate author approval fields automatically.",
        time: "Profile",
      },
    ];

    return (
      <div className="user-stack">
        <section className="hero-panel">
          <div className="hero-panel-left">
            <p className="eyebrow">Workspace Overview</p>
            <h2>Home</h2>
            <p className="hero-copy">Check workspace status and move into each management area.</p>
          </div>
          <div className="hero-panel-right">
            <span className="hero-metric-label">Notes created this month</span>
            <strong className="hero-metric-value">{notes.length}</strong>
            <span className="hero-metric-copy">Cover, table of contents, PDF pages, and merged export flows included.</span>
          </div>
        </section>

        <section className="stats-grid">
          <article className="stat-panel">
            <span className="stat-label">Projects</span>
            <strong className="stat-value">{projects.length}</strong>
            <span className="stat-copy">
              {projects.length > 0 ? `${projects.filter((project) => project.status === "active").length} active projects` : "No projects yet"}
            </span>
          </article>
          <article className="stat-panel">
            <span className="stat-label">Company Members</span>
            <strong className="stat-value">{companyMembers.length}</strong>
            <span className="stat-copy">Company-wide researcher directory and owner access roster.</span>
          </article>
          <article className="stat-panel">
            <span className="stat-label">Selected Project Members</span>
            <strong className="stat-value">{selectedProject ? members.length : 0}</strong>
            <span className="stat-copy">{selectedProject ? `${selectedProject.name} workspace members` : "Select a project to inspect project members"}</span>
          </article>
          <article className="stat-panel">
            <span className="stat-label">Selected Project Notes</span>
            <strong className="stat-value">{selectedProject ? notes.length : 0}</strong>
            <span className="stat-copy">{selectedProject ? "Draft, review, and completed note packages" : "Project note counts appear after project selection"}</span>
          </article>
        </section>

        <section className="home-panels">
          <article className="card home-panel">
            <div className="section-head home-panel-head">
              <h3>Active Projects</h3>
              <span>Recent access order</span>
            </div>
            <div className="home-project-list">
              {recentProjects.length > 0 ? (
                recentProjects.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className="home-project-item"
                    onClick={() => void onOpenProjectPage(project)}
                  >
                    <div className="home-project-item-main">
                      <strong>{project.name}</strong>
                      <p>{project.description || "Open the project workspace to manage notes, members, and cover templates."}</p>
                      <div className="home-project-tags">
                        <span className="home-tag">Project No. {project.code || "TBD"}</span>
                        <span className="home-tag">{formatProjectPeriod(project.start_date, project.end_date)}</span>
                      </div>
                    </div>
                    <div className="home-project-item-side">
                      <span className="home-status-pill">{project.status}</span>
                      <span>{getCompanyMemberName(project.owner_member_id)}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="empty-state-card">
                  <strong>No active projects yet</strong>
                  <span>Create a project to open research note workspaces and member assignment flows.</span>
                </div>
              )}
            </div>
          </article>

          <article className="card home-panel">
            <div className="section-head home-panel-head">
              <h3>Recent Activity</h3>
              <span>Today</span>
            </div>
            <div className="activity-feed">
              {recentActivity.map((item) => (
                <div key={item.title} className="activity-feed-item">
                  <div className="activity-feed-dot" />
                  <div className="activity-feed-body">
                    <strong>{item.title}</strong>
                    <p>{item.body}</p>
                    <span>{item.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>
      </div>
    );
  };

  const renderProjectDashboard = () => (
    <div className="project-dashboard-stack">
      {!canManageSelectedProject && (
        <section className="card inset-card">
          <p className="eyebrow">Read Only</p>
          <p className="context-copy">Only the company owner or current project lead can edit project settings.</p>
        </section>
      )}
      <section className="project-dashboard-hero card">
        <div className="project-dashboard-hero-main">
          <p className="eyebrow">Project Overview</p>
          <h2>{selectedProject?.name || "Untitled Project"}</h2>
          <p className="context-copy">
            {selectedProject?.description || "Track project status, participant coverage, and research note volume from one dashboard."}
          </p>
          <div className="project-dashboard-tags">
            <span className="project-dashboard-tag">
              <span className="project-dashboard-tag-label">Project Code</span>
              <span className="project-dashboard-tag-value">{selectedProject?.code || "-"}</span>
            </span>
            <span className="project-dashboard-tag">
              <span className="project-dashboard-tag-label">Period</span>
              <span className="project-dashboard-tag-value">
                {formatProjectPeriod(selectedProject?.start_date ?? null, selectedProject?.end_date ?? null)}
              </span>
            </span>
            <span className="project-dashboard-tag">
              <span className="project-dashboard-tag-label">Lead</span>
              <span className="project-dashboard-tag-value">{getCompanyMemberName(selectedProject?.owner_member_id)}</span>
            </span>
          </div>
        </div>
        <div className="project-dashboard-hero-side">
          <div className="hero-metric-label">Current Status</div>
          <div className="hero-metric-value project-status-value">{selectedProject?.status || "-"}</div>
          <div className="hero-metric-copy">This project workspace reflects only participants and notes assigned to this project.</div>
          {canManageSelectedProject && (
            <button type="button" className="compact-button" onClick={() => setShowProjectEditModal(true)}>
              Edit Project
            </button>
          )}
        </div>
      </section>

      <section className="project-dashboard-kpis">
        <article className="project-kpi-card">
          <span className="project-kpi-label">Participants</span>
          <strong className="project-kpi-value">{members.length}</strong>
          <p className="project-kpi-copy">Assigned members</p>
        </article>
        <article className="project-kpi-card">
          <span className="project-kpi-label">Research Notes</span>
          <strong className="project-kpi-value">{notes.length}</strong>
          <p className="project-kpi-copy">Created notes</p>
        </article>
        <article className="project-kpi-card">
          <span className="project-kpi-label">GitHub Integrations</span>
          <strong className="project-kpi-value">{githubIntegrations.length}</strong>
          <p className="project-kpi-copy">Company repository connections</p>
        </article>
        <article className="project-kpi-card">
          <span className="project-kpi-label">LLM Integration</span>
          <strong className="project-kpi-value">Not Connected</strong>
          <p className="project-kpi-copy">Model workflow connection placeholder</p>
        </article>
        <article className="project-kpi-card">
          <span className="project-kpi-label">Collaboration Tools</span>
          <strong className="project-kpi-value">0</strong>
          <p className="project-kpi-copy">External collaboration apps connected</p>
        </article>
        <article className="project-kpi-card">
          <span className="project-kpi-label">Monthly Goal</span>
          <strong className="project-kpi-value">
            {projectMonthlyGoal > 0 ? `${notesThisMonth} / ${projectMonthlyGoal}` : notesThisMonth}
          </strong>
          <p className="project-kpi-copy">
            {projectMonthlyGoal > 0 ? `${monthlyGoalProgress}% of this month's note target` : "Set a monthly note target to track progress"}
          </p>
        </article>
      </section>

      <section className="project-dashboard-grid">
        <article className="card">
          <div className="section-head note-section-head">
            <h4>Project Metrics</h4>
            <span>Visual summary</span>
          </div>
          <div className="project-chart-grid">
            <div className="project-chart-card">
              <div className="project-chart-ring">
                <div className="project-chart-ring-inner">
                  <strong>{members.length}</strong>
                  <span>Members</span>
                </div>
              </div>
              <div className="project-chart-copy">
                <strong>Participant Coverage</strong>
                <span>Researchers currently assigned to this project workspace.</span>
              </div>
            </div>
            <div className="project-chart-card">
              <div className="project-chart-ring notes">
                <div className="project-chart-ring-inner">
                  <strong>{notes.length}</strong>
                  <span>Notes</span>
                </div>
              </div>
              <div className="project-chart-copy">
                <strong>Note Volume</strong>
                <span>Research note count currently recorded under this project.</span>
              </div>
            </div>
            <div className="project-chart-card project-chart-wide">
              <div className="project-mini-chart-row">
                <div className="project-mini-chart-head">
                  <strong>Project Duration</strong>
                  <span>{formatProjectPeriod(selectedProject?.start_date ?? null, selectedProject?.end_date ?? null)}</span>
                </div>
                <div className="project-mini-chart-track">
                  <div className="project-mini-chart-fill duration" style={{ width: "100%" }} />
                </div>
              </div>
            </div>
          </div>
        </article>

        <article className="card">
          <div className="section-head note-section-head">
            <h4>Researcher Activity Alerts</h4>
            <span>{inactiveProjectResearchers.length} inactive</span>
          </div>
          <div className="project-mini-chart">
            <div className="project-mini-chart-row">
              <div className="project-mini-chart-head">
                <strong>Monthly Goal Progress</strong>
                <span>{projectMonthlyGoal > 0 ? `${monthlyGoalProgress}%` : "No target"}</span>
              </div>
              <div className="project-mini-chart-track">
                <div
                  className="project-mini-chart-fill notes"
                  style={{ width: `${projectMonthlyGoal > 0 ? Math.max(10, monthlyGoalProgress) : 18}%` }}
                />
              </div>
            </div>
            <div className="researcher-activity-list">
              {inactiveProjectResearchers.length === 0 ? (
                <div className="empty-state-card compact-empty-state">
                  <strong>No inactivity alerts</strong>
                  <span>All assigned researchers have recent note activity within the last 7 days.</span>
                </div>
              ) : (
                inactiveProjectResearchers.map((entry) => (
                  <div key={entry.member.company_member_id} className="researcher-activity-item">
                    <div>
                      <strong>{entry.member.name}</strong>
                      <span>
                        {entry.lastActivity
                          ? `Last update ${new Date(entry.lastActivity).toLocaleDateString()} / ${entry.noteCount} note${entry.noteCount === 1 ? "" : "s"}`
                          : "No note activity yet"}
                      </span>
                    </div>
                    <span className="home-status-pill muted">Needs update</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </article>
      </section>

      {showProjectEditModal && (
        <div className="modal-backdrop" onClick={() => setShowProjectEditModal(false)}>
          <section className="card note-modal project-edit-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <h3>Edit Project</h3>
              <button type="button" className="secondary-button compact-button" onClick={() => setShowProjectEditModal(false)}>
                Close
              </button>
            </div>
            <form
              onSubmit={async (event) => {
                await onSaveProjectDashboard(event);
                setShowProjectEditModal(false);
              }}
              className="project-dashboard-form"
            >
              <label>
                Project Name
                <input value={projectNameDraft} onChange={(e) => setProjectNameDraft(e.target.value)} required disabled={!canManageSelectedProject} />
              </label>
              <label>
                Project Code
                <input value={projectCodeDraft} onChange={(e) => setProjectCodeDraft(e.target.value)} required disabled={!canManageSelectedProject} />
              </label>
              <label>
                Lead Member
                <select
                  value={projectOwnerDraft}
                  onChange={(e) => setProjectOwnerDraft(e.target.value ? Number(e.target.value) : "")}
                  disabled={!canManageSelectedProject}
                >
                  <option value="">Select a member</option>
                  {companyMembers.map((member) => (
                    <option key={member.company_member_id} value={member.company_member_id}>
                      {member.name} ({member.role})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select value={projectStatusDraft} onChange={(e) => setProjectStatusDraft(e.target.value)} disabled={!canManageSelectedProject}>
                  {projectStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Start Date
                <input type="date" value={projectStartDateDraft} onChange={(e) => setProjectStartDateDraft(e.target.value)} disabled={!canManageSelectedProject} />
              </label>
              <label>
                End Date
                <input type="date" value={projectEndDateDraft} onChange={(e) => setProjectEndDateDraft(e.target.value)} disabled={!canManageSelectedProject} />
              </label>
              <label>
                Monthly Note Target
                <input
                  type="number"
                  min="0"
                  value={projectMonthlyTargetDraft}
                  onChange={(e) => setProjectMonthlyTargetDraft(e.target.value)}
                  disabled={!canManageSelectedProject}
                />
              </label>
              <label className="project-dashboard-wide">
                Description
                <textarea
                  rows={5}
                  value={projectDescriptionDraft}
                  onChange={(e) => setProjectDescriptionDraft(e.target.value)}
                  disabled={!canManageSelectedProject}
                />
              </label>
              <div className="project-dashboard-actions">
                <button type="submit" className="compact-button" disabled={!canManageSelectedProject}>
                  Save Project
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );

  const renderProjectMembers = () => (
    <div className="user-stack">
      {!canManageSelectedProject && (
        <section className="card page-intro">
          <p className="eyebrow">Read Only</p>
          <p className="context-copy">
            You can view the assigned project researchers, but only the company owner or current project lead can change participation.
          </p>
        </section>
      )}

      <section className="card">
        <div className="section-head note-section-head">
          <h4>Add Project Researcher</h4>
          <span>{availableProjectResearchers.length} available</span>
        </div>
        <form onSubmit={onAssignMember} className="form-inline">
          <select
            value={memberId}
            onChange={(e) => setMemberId(e.target.value ? Number(e.target.value) : "")}
            disabled={!canManageSelectedProject}
          >
            <option value="">Select a company researcher</option>
            {availableProjectResearchers.map((member) => (
              <option key={member.company_member_id} value={member.company_member_id}>
                {member.name} ({member.role})
              </option>
            ))}
          </select>
          <input
            value={memberRole}
            onChange={(e) => setMemberRole(e.target.value)}
            placeholder="project role"
            disabled={!canManageSelectedProject}
          />
          <button type="submit" className="compact-button" disabled={!canManageSelectedProject || memberId === ""}>
            Add Researcher
          </button>
        </form>
      </section>

      <section className="card">
        <div className="section-head note-section-head">
          <h4>Current Project Researchers</h4>
          <span>{projectResearchers.length}</span>
        </div>
        <ul className="list">
          {projectResearchers.map((member) => {
            const isLead = selectedProject?.owner_member_id === member.company_member_id;
            return (
              <li key={member.id} className="plain-list-item researcher-row">
                <div>
                  <strong>{member.name}</strong>
                  <span>
                    {member.email} / project role: {isLead ? "lead" : member.role} / {member.is_active ? "active" : "inactive"}
                  </span>
                </div>
                {isLead ? (
                  <span className="project-pill">Lead</span>
                ) : (
                  canManageSelectedProject && (
                    <button
                      type="button"
                      className="secondary-button compact-button"
                      onClick={() => void onRemoveAssignedMember(member.company_member_id)}
                    >
                      Remove
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );

  const renderProjectNotes = () => {
    const filteredFiles = noteFiles.filter((file) => {
      const matchesQuery =
        noteFileQuery.trim().length === 0 ||
        file.original_name.toLowerCase().includes(noteFileQuery.trim().toLowerCase());
      const matchesType = noteFileTypeFilter === "all" || file.file_type === noteFileTypeFilter;
      return matchesQuery && matchesType;
    });
    return (
      <div className="note-management-shell">
        {isBatchDownloading && (
          <section className="card page-intro">
            <p className="eyebrow">Download Progress</p>
            <div className="download-progress">
              <div className="download-progress-head">
                <strong>Merging selected research notes</strong>
                <span>{batchDownloadProgress == null ? "Preparing..." : `${batchDownloadProgress}%`}</span>
              </div>
              <div className="download-progress-bar">
                <div
                  className={`download-progress-fill${batchDownloadProgress == null ? " indeterminate" : ""}`}
                  style={batchDownloadProgress == null ? undefined : { width: `${batchDownloadProgress}%` }}
                />
              </div>
            </div>
          </section>
        )}

        {noteNotice && (
          <section className="card page-intro">
            <p className="eyebrow">Notice</p>
            <p>{noteNotice}</p>
          </section>
        )}

        <section className="card note-files-panel">
          <div className="section-head note-section-head">
            <div>
              <h4>Research File Dropzone</h4>
              <p className="context-copy">
                Every uploaded PDF or image starts a new research note with the selected files already attached.
              </p>
            </div>
          </div>

          <input
            ref={noteUploadInputRef}
            type="file"
            accept="application/pdf,image/*"
            multiple
            className="hidden-input"
            onChange={(e) => queueResearchFilesForNewNote(Array.from(e.target.files ?? []))}
          />

          <button
            type="button"
            className={`note-upload-dropzone${isNoteFileDragging ? " dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsNoteFileDragging(true);
            }}
            onDragLeave={() => setIsNoteFileDragging(false)}
            onDrop={(event) => void onResearchFileDrop(event)}
            onClick={() => noteUploadInputRef.current?.click()}
          >
              <strong>Drag files here to create a new research note from the uploaded files.</strong>
            <span>Supported: PDF and image files.</span>
          </button>
        </section>

        <section className="card">
          <div className="section-head note-section-head">
            <h4>Research Note List</h4>
            <span>
              {notes.length}
              {totalNotePages > 1 ? ` / Page ${notesPage} of ${totalNotePages}` : ""}
            </span>
          </div>
          <div className="table-shell">
            <table className="admin-table note-file-table">
              <thead>
                <tr>
                  {isNoteSelectionMode && (
                    <th>
                      <input
                        type="checkbox"
                        checked={paginatedNotes.length > 0 && paginatedNotes.every((note) => selectedNoteIds.includes(note.id))}
                        onChange={onToggleAllNoteSelections}
                        aria-label="Select all research notes on this page"
                      />
                    </th>
                  )}
                  <th>Title</th>
                  <th>Has Layout</th>
                  <th>Status</th>
                  <th>Author</th>
                  <th>Written Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {notes.length === 0 && (
                  <tr>
                    <td colSpan={isNoteSelectionMode ? 7 : 6}>No research notes yet.</td>
                  </tr>
                )}
                {paginatedNotes.map((note) => (
                  <tr
                    key={note.id}
                    onClick={() => {
                      if (isNoteSelectionMode) {
                        onToggleNoteSelection(note.id);
                        return;
                      }
                      void onOpenResearchNote(note.id);
                    }}
                  >
                    {isNoteSelectionMode && (
                      <td onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedNoteIds.includes(note.id)}
                          onChange={() => onToggleNoteSelection(note.id)}
                          aria-label={`Select ${note.title}`}
                        />
                      </td>
                    )}
                    <td>{note.title}</td>
                    <td>{noteLayoutStatus[note.id] ? "Saved" : "Auto"}</td>
                    <td>
                      <span className={`note-status-badge status-${note.status}`}>
                        {noteStatusLabels[note.status] ?? note.status}
                      </span>
                    </td>
                    <td>{getCompanyMemberName(note.owner_member_id)}</td>
                    <td>{note.written_date ? new Date(note.written_date).toLocaleDateString() : "-"}</td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => void onDeleteResearchNote(note.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalNotePages > 1 && (
            <div className="table-pagination">
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => setNotesPage((current) => Math.max(1, current - 1))}
                disabled={notesPage === 1}
              >
                Previous
              </button>
              <div className="table-pagination-pages">
                {Array.from({ length: totalNotePages }, (_, index) => index + 1).map((page) => (
                  <button
                    key={page}
                    type="button"
                    className={`table-page-button${page === notesPage ? " active" : ""}`}
                    onClick={() => setNotesPage(page)}
                  >
                    {page}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => setNotesPage((current) => Math.min(totalNotePages, current + 1))}
                disabled={notesPage === totalNotePages}
              >
                Next
              </button>
            </div>
          )}
        </section>

        {openedResearchNoteId && selectedNote && (
          <div className="modal-backdrop" onClick={onBackToResearchNoteList}>
            <section className="card note-workspace-modal" onClick={(event) => event.stopPropagation()}>
              <div className="section-head">
                <div>
                  <p className="eyebrow">Research Note Workspace</p>
                  <h3>{selectedNote.title}</h3>
                </div>
                <div className="note-file-actions">
                  <button type="button" className="secondary-button compact-button" onClick={onBackToResearchNoteList}>
                    Close
                  </button>
                  <button type="button" className="compact-button" onClick={openEditNoteModal} disabled={selectedNoteIsLocked}>
                    Edit Note
                  </button>
                </div>
              </div>

              <div className="note-main-stack">
                <section className="note-approval-panel">
                  <div className="note-approval-summary">
                    <div>
                      <p className="eyebrow">Approval Workflow</p>
                      <h4>
                        <span className={`note-status-badge status-${selectedNote.status}`}>
                          {selectedNoteStatusLabel}
                        </span>
                      </h4>
                    </div>
                    <div className="note-approval-meta">
                      <span>Author: {getCompanyMemberName(selectedNote.owner_member_id)}</span>
                      <span>Reviewer: {getCompanyMemberName(selectedNote.reviewer_member_id)}</span>
                      <span>Revision: {activeNoteDocument?.current_revision_no ?? "-"}</span>
                    </div>
                  </div>

                  <div className="note-approval-actions">
                    <label className="note-approval-comment">
                      Comment
                      <textarea
                        value={approvalComment}
                        onChange={(event) => setApprovalComment(event.target.value)}
                        rows={3}
                        placeholder="Optional for submit/approve. Required for reject/reopen."
                      />
                    </label>
                    <div className="note-approval-button-row">
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => void runSelectedNoteApprovalAction("submit")}
                        disabled={!canSubmitSelectedNote}
                      >
                        Submit
                      </button>
                      <button
                        type="button"
                        className="compact-button"
                        onClick={() => void runSelectedNoteApprovalAction("approve")}
                        disabled={!canReviewSelectedNote}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => void runSelectedNoteApprovalAction("reject")}
                        disabled={!canReviewSelectedNote}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => void runSelectedNoteApprovalAction("reopen")}
                        disabled={!canReopenSelectedNote}
                      >
                        Reopen
                      </button>
                    </div>
                  </div>

                  <div className="note-approval-events">
                    {approvalEvents.length === 0 ? (
                      <span>No approval events yet.</span>
                    ) : (
                      approvalEvents.map((event) => (
                        <div key={event.id} className="note-approval-event">
                          <strong>{approvalEventLabels[event.event_type] ?? event.event_type}</strong>
                          <span>
                            {getCompanyMemberName(event.actor_member_id)} / {new Date(event.created_at).toLocaleString()}
                          </span>
                          {event.comment && <p>{event.comment}</p>}
                        </div>
                      ))
                    )}
                  </div>
                </section>

                <DocumentEditor
                  noteId={selectedNote.id}
                  document={activeNoteDocument?.document ?? null}
                  documentSummaries={noteDocuments}
                  activeDocumentId={activeNoteDocument?.id ?? null}
                  referencePages={notePages}
                  onSelectDocument={onLoadNoteDocument}
                  onCreateDocument={onCreateNoteDocument}
                  onSaveDocument={onSaveNoteDocument}
                  onUploadNoteFiles={onUploadFilesToSelectedNote}
                  onReplaceReferencePage={onReplaceNotePageAsset}
                  isLocked={selectedNoteIsLocked}
                  lockMessage={`${selectedNoteStatusLabel} research notes are locked for editing.`}
                />
              </div>
            </section>
          </div>
        )}

        {showNoteModal && (
          <div className="modal-backdrop" onClick={() => setShowNoteModal(false)}>
            <section className="card note-modal" onClick={(event) => event.stopPropagation()}>
              <div className="section-head">
                <h3>{noteModalMode === "edit" ? "Edit Research Note" : "Create Research Note"}</h3>
                <button type="button" className="secondary-button compact-button" onClick={() => setShowNoteModal(false)}>
                  Close
                </button>
              </div>
              <form onSubmit={noteModalMode === "edit" ? onSaveNote : onCreateNote} className="form-stack">
                <label>
                  Title
                  <input value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} required />
                </label>
                <label>
                  Author
                  <select
                    value={noteOwnerMemberId}
                    onChange={(e) => setNoteOwnerMemberId(e.target.value ? Number(e.target.value) : "")}
                  >
                    <option value="">Select a member</option>
                    {companyMembers.map((member) => (
                      <option key={member.company_member_id} value={member.company_member_id}>
                        {member.name} ({member.role})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Written Date
                  <input type="date" value={noteWrittenDate} onChange={(e) => setNoteWrittenDate(e.target.value)} />
                </label>
                <label>
                  Reviewer
                  <select
                    value={noteReviewerMemberId}
                    onChange={(e) => setNoteReviewerMemberId(e.target.value ? Number(e.target.value) : "")}
                  >
                    <option value="">Select a member</option>
                    {companyMembers.map((member) => (
                      <option key={member.company_member_id} value={member.company_member_id}>
                        {member.name} ({member.role})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Reviewed Date
                  <input type="date" value={noteReviewedDate} onChange={(e) => setNoteReviewedDate(e.target.value)} />
                </label>
                  {noteModalMode === "create" && (
                  <>
                    <div className="section-head">
                      <h4>Attach File</h4>
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => noteCreateUploadInputRef.current?.click()}
                      >
                        Choose File
                      </button>
                    </div>
                    <input
                      ref={noteCreateUploadInputRef}
                      type="file"
                      accept="application/pdf,image/*"
                      multiple
                      className="hidden-input"
                      onChange={(e) => setPendingNoteFiles(Array.from(e.target.files ?? []))}
                    />
                    <button
                      type="button"
                      className={`note-upload-dropzone${isNoteFileDragging ? " dragging" : ""}`}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setIsNoteFileDragging(true);
                      }}
                      onDragLeave={() => setIsNoteFileDragging(false)}
                      onDrop={(event) => {
                        event.preventDefault();
                        setIsNoteFileDragging(false);
                        setPendingNoteFiles(Array.from(event.dataTransfer.files ?? []));
                      }}
                      onClick={() => noteCreateUploadInputRef.current?.click()}
                    >
                      <strong>
                        {pendingNoteFiles.length > 0
                          ? `${pendingNoteFiles.length} file(s) ready to attach`
                          : "Drop files here to attach them to the new research note."}
                      </strong>
                      <span>
                        {pendingNoteFiles.length > 0
                          ? pendingNoteFiles.map((file) => file.name).join(", ")
                          : "You can drag and drop files here or choose them manually."}
                      </span>
                    </button>
                  </>
                )}
                <button type="submit">{noteModalMode === "edit" ? "Save Note" : "Create Note"}</button>
              </form>
            </section>
          </div>
        )}
      </div>
    );
  };

  const renderProjectCover = () => {
    const resolvedCoverTemplate = resolveCoverTemplate(
      coverTemplate,
      selectedProject,
      getCompanyMemberName(selectedProject?.owner_member_id),
      researcherManagement?.company.name ?? "LABNOTE"
    );
    return (
        <>
          <div className="section-head project-tab-actions">
            <div />
            <button type="button" className="secondary-button compact-button" onClick={() => setProjectView("notes")}>
              Back to Research Note
            </button>
          </div>
            <form onSubmit={onSaveProjectCover} className="project-dashboard-form">
              <div className="cover-preview a4-preview project-dashboard-wide cover-preview-stack">
                <div className="a4-sheet a4-sheet-simple cover-sheet-canvas">
                  {coverPreviewImageUrl ? (
                  <img src={coverPreviewImageUrl} alt="Cover preview" className="cover-sheet-image" />
                ) : (
                  <div className="cover-sheet-placeholder">Preparing cover preview...</div>
                )}
              </div>

                <div className="a4-sheet a4-sheet-simple cover-sheet-canvas">
                  {tocPreviewImageUrl ? (
                    <img src={tocPreviewImageUrl} alt="Table of contents preview" className="cover-sheet-image" />
                  ) : (
                    <div className="cover-sheet-placeholder">Preparing table of contents preview...</div>
                  )}
                </div>
              </div>
              <div className="project-dashboard-wide cover-settings-card">
                <div className="section-head note-section-head">
                  <h4>Cover Fields</h4>
                  <span>Use project defaults unless a field needs a stored override.</span>
                </div>
                <div className="table-shell cover-settings-shell">
                  <table className="admin-table cover-settings-table">
                    <thead>
                      <tr>
                        <th>Field</th>
                        <th>Project Default</th>
                        <th>Override</th>
                        <th>Custom Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Research Organization</td>
                        <td>{buildDefaultCoverTemplate(selectedProject, getCompanyMemberName(selectedProject?.owner_member_id), researcherManagement?.company.name ?? "LABNOTE").organization}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={coverTemplate.overrideOrganization}
                            onChange={(e) => setCoverTemplate((current) => ({ ...current, overrideOrganization: e.target.checked }))}
                          />
                        </td>
                        <td>
                          <input
                            value={coverTemplate.organization}
                            onChange={(e) => setCoverTemplate((current) => ({ ...current, organization: e.target.value }))}
                            disabled={!coverTemplate.overrideOrganization}
                          />
                        </td>
                      </tr>
                      <tr>
                        <td>Project Title</td>
                        <td>{buildDefaultCoverTemplate(selectedProject, getCompanyMemberName(selectedProject?.owner_member_id), researcherManagement?.company.name ?? "LABNOTE").projectTitle}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={coverTemplate.overrideProjectTitle}
                            onChange={(e) => setCoverTemplate((current) => ({ ...current, overrideProjectTitle: e.target.checked }))}
                          />
                        </td>
                        <td>
                          <input
                            value={coverTemplate.projectTitle}
                            onChange={(e) => setCoverTemplate((current) => ({ ...current, projectTitle: e.target.value }))}
                            disabled={!coverTemplate.overrideProjectTitle}
                          />
                        </td>
                      </tr>
                      <tr>
                        <td>Principal Investigator</td>
                        <td>{buildDefaultCoverTemplate(selectedProject, getCompanyMemberName(selectedProject?.owner_member_id), researcherManagement?.company.name ?? "LABNOTE").principalInvestigator}</td>
                        <td>
                          <input
                            type="checkbox"
                            checked={coverTemplate.overridePrincipalInvestigator}
                            onChange={(e) =>
                              setCoverTemplate((current) => ({ ...current, overridePrincipalInvestigator: e.target.checked }))
                            }
                          />
                        </td>
                        <td>
                          <input
                            value={coverTemplate.principalInvestigator}
                            onChange={(e) => setCoverTemplate((current) => ({ ...current, principalInvestigator: e.target.value }))}
                            disabled={!coverTemplate.overridePrincipalInvestigator}
                          />
                        </td>
                      </tr>
                      <tr>
                        <td>Project Code</td>
                        <td>{selectedProject?.code || "-"}</td>
                        <td>-</td>
                        <td>Uses project data</td>
                      </tr>
                      <tr>
                        <td>Period</td>
                        <td>{selectedProject ? `${selectedProject.start_date ?? "TBD"} - ${selectedProject.end_date ?? "TBD"}` : "-"}</td>
                        <td>-</td>
                        <td>Uses project data</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="project-dashboard-actions">
                <button type="submit" className="compact-button">Save Cover</button>
              </div>
            </form>
          </>
      );
  };

  const renderProjects = () => (
    <div className="user-stack">
      {showCreateProjectForm && (
        <section className="card project-create-panel">
          <div className="section-head">
            <h3>Create Project</h3>
            <span>Projects are created inside the current organization automatically.</span>
          </div>
          <form onSubmit={onCreateProject} className="project-create-form">
            <label>
              Project Name
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              Lead Member
              <select value={ownerMemberId} onChange={(e) => setOwnerMemberId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">Select a member</option>
                {companyMembers.map((member) => (
                  <option key={member.company_member_id} value={member.company_member_id}>
                    {member.name} ({member.role})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Project Number
              <input value={code} onChange={(e) => setCode(e.target.value)} required />
            </label>
            <label>
              Start Date
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label>
              End Date
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
            <label>
              Monthly Note Target
              <input type="number" min="0" value={monthlyNoteTarget} onChange={(e) => setMonthlyNoteTarget(e.target.value)} />
            </label>
            <label className="project-create-wide">
              Description
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
            </label>
            <div className="project-create-actions">
              <button type="submit" className="compact-button">
                Save Project
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card">
        <div className="section-head">
          <h3>All Projects</h3>
          <div className="table-actions">
            <span className="section-count">{projects.length} projects</span>
            <button type="button" className="compact-button" onClick={() => setShowCreateProjectForm((open) => !open)}>
              {showCreateProjectForm ? "Close Create" : "Create Project"}
            </button>
          </div>
        </div>
        <div className="project-card-grid">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className={`project-card${selectedProject?.id === project.id ? " selected" : ""}`}
              onClick={() => void onOpenProjectPage(project)}
            >
              <div className="project-card-top">
                <span className="project-icon">N</span>
                <span className="project-star">{selectedProject?.id === project.id ? "*" : "+"}</span>
              </div>
              <strong>{project.name}</strong>
              <div className="project-meta">
                <span>Lead</span>
                <strong>{getCompanyMemberName(project.owner_member_id)}</strong>
                <span>Project No.</span>
                <strong>{project.code}</strong>
                <span>Period</span>
                <strong>{formatProjectPeriod(project.start_date, project.end_date)}</strong>
              </div>
              <div className="project-card-footer">
                <span className="project-pill">company</span>
                <span className="project-pill muted">{project.status}</span>
                <span className="project-count">{project.description ? "described" : "no description"}</span>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );

  const renderGitHubIntegration = () => (
    <div className="user-stack github-workspace">
      <section className="github-action-strip">
        <article className="card github-action-card">
          <span className="section-count">{githubIntegrations.length} repositories</span>
          <h3>Connected Repositories</h3>
          <p className="context-copy">Register GitHub repositories and manage webhook access.</p>
          <button
            type="button"
            className="compact-button"
            onClick={() => setShowGitHubRepositoryModal(true)}
            disabled={!canManageGitHubIntegrations || !currentUser.organization_id}
          >
            Add Repository
          </button>
        </article>

        <article className="card github-action-card">
          <span className="section-count">{githubProjectMappings.length} mappings</span>
          <h3>Project Mapping</h3>
          <p className="context-copy">Connect a repository branch flow to a LabNote project.</p>
          <button
            type="button"
            className="compact-button"
            onClick={() => setShowGitHubMappingModal(true)}
            disabled={!canManageGitHubIntegrations || githubIntegrations.length === 0 || projects.length === 0}
          >
            Create Mapping
          </button>
        </article>

        <article className="card github-action-card">
          <span className="section-count">{githubEvents.length} events</span>
          <h3>GitHub Events</h3>
          <p className="context-copy">Review incoming repository events and generate research notes.</p>
          <button type="button" className="secondary-button compact-button" onClick={() => void refreshGitHubIntegrations()}>
            Refresh
          </button>
        </article>
      </section>

      <section className="github-integration-grid github-management-grid">
        <article className="card">
          <div className="section-head">
            <h3>Connected Repositories</h3>
            <div className="table-actions">
              <span className="section-count">{githubIntegrations.length} repositories</span>
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => setShowGitHubRepositoryModal(true)}
                disabled={!canManageGitHubIntegrations || !currentUser.organization_id}
              >
                Add
              </button>
            </div>
          </div>
          <div className="github-integration-list">
            {githubIntegrations.length === 0 ? (
              <div className="plain-list-item">
                <strong>No repositories connected</strong>
                <span>Add a repository connection to make it available for collaboration workflows.</span>
              </div>
            ) : (
              githubIntegrations.map((integration) => (
                <div key={integration.id} className="github-integration-item">
                  <div>
                    <strong>
                      {integration.repo_owner}/{integration.repo_name}
                    </strong>
                    <span>{integration.repository_url ?? "No repository URL"}</span>
                    <span>Branch: {integration.default_branch ?? "main"}</span>
                    {integration.webhook_url && <span>Webhook: {integration.webhook_url}</span>}
                    {integration.notes && <p>{integration.notes}</p>}
                  </div>
                  <span className={`note-status-badge status-${integration.status}`}>
                    {integration.status}
                  </span>
                  <div className="github-integration-actions">
                    <button
                      type="button"
                      className="secondary-button compact-button"
                      onClick={() => void onRotateGitHubWebhookSecret(integration.id)}
                      disabled={!canManageGitHubIntegrations}
                    >
                      Secret
                    </button>
                    <button
                      type="button"
                      className="secondary-button compact-button"
                      onClick={() => void onToggleGitHubIntegrationStatus(integration)}
                      disabled={!canManageGitHubIntegrations}
                    >
                      {integration.status === "active" ? "Pause" : "Activate"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button compact-button"
                      onClick={() => void onDeleteGitHubIntegration(integration.id)}
                      disabled={!canManageGitHubIntegrations}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          {githubWebhookSecretNotice && <p className="profile-notice">{githubWebhookSecretNotice}</p>}
        </article>

        <article className="card">
          <div className="section-head">
            <h3>Active Mappings</h3>
            <div className="table-actions">
              <span className="section-count">{githubProjectMappings.length} mappings</span>
              <button
                type="button"
                className="secondary-button compact-button"
                onClick={() => setShowGitHubMappingModal(true)}
                disabled={!canManageGitHubIntegrations || githubIntegrations.length === 0 || projects.length === 0}
              >
                Add
              </button>
            </div>
          </div>
          <div className="github-integration-list">
            {githubProjectMappings.length === 0 ? (
              <div className="plain-list-item">
                <strong>No project mappings</strong>
                <span>Map a repository to a project before webhook events can create research notes.</span>
              </div>
            ) : (
              githubProjectMappings.map((mapping) => {
                const integration = githubIntegrations.find((item) => item.id === mapping.integration_id);
                const project = projects.find((item) => item.id === mapping.project_id);
                return (
                  <div key={mapping.id} className="github-integration-item">
                    <div>
                      <strong>
                        {integration ? `${integration.repo_owner}/${integration.repo_name}` : `Repository #${mapping.integration_id}`}
                      </strong>
                      <span>Project: {project?.name ?? mapping.project_id}</span>
                      <span>Branch: {mapping.branch_pattern ?? "*"}</span>
                      <span>Mode: {mapping.note_creation_mode}</span>
                    </div>
                    <span className={`note-status-badge status-${mapping.is_active ? "approved" : "paused"}`}>
                      {mapping.is_active ? "active" : "paused"}
                    </span>
                    <div className="github-integration-actions">
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => void onToggleGitHubProjectMapping(mapping)}
                        disabled={!canManageGitHubIntegrations}
                      >
                        {mapping.is_active ? "Pause" : "Activate"}
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => void onDeleteGitHubProjectMapping(mapping.id)}
                        disabled={!canManageGitHubIntegrations}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </article>
      </section>

      <section className="card github-events-card">
        <div className="section-head">
          <h3>GitHub Events</h3>
          <div className="table-actions">
            <span className="section-count">{githubEvents.length} events</span>
            <button type="button" className="secondary-button compact-button" onClick={() => void refreshGitHubIntegrations()}>
              Refresh
            </button>
          </div>
        </div>
        <div className="table-shell">
          <table className="admin-table note-file-table">
            <thead>
              <tr>
                <th>Event</th>
                <th>Status</th>
                <th>Project</th>
                <th>Source</th>
                <th>Generated Note</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {githubEvents.length === 0 && (
                <tr>
                  <td colSpan={6}>No GitHub events yet.</td>
                </tr>
              )}
              {githubEvents.map((event) => {
                const project = projects.find((item) => item.id === event.project_id);
                return (
                  <tr key={event.id}>
                    <td>
                      {event.event_type}
                      {event.action ? ` / ${event.action}` : ""}
                    </td>
                    <td>
                      <span className={`note-status-badge status-${event.status}`}>
                        {event.status}
                      </span>
                    </td>
                    <td>{project?.name ?? event.project_id ?? "-"}</td>
                    <td>{event.source_url ? <a href={event.source_url} target="_blank" rel="noreferrer">Open</a> : "-"}</td>
                    <td>{event.generated_note_id ?? "-"}</td>
                    <td>
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => void onGenerateNoteFromGitHubEvent(event.id)}
                        disabled={Boolean(event.generated_note_id) || !event.project_mapping_id}
                      >
                        Generate Note
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {showGitHubRepositoryModal && (
        <div className="modal-backdrop" onClick={() => setShowGitHubRepositoryModal(false)}>
          <section className="card note-modal github-config-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <div>
                <h3>Add Repository</h3>
                <span>{canManageGitHubIntegrations ? "Owner access" : "Read only"}</span>
              </div>
              <button type="button" className="secondary-button compact-button" onClick={() => setShowGitHubRepositoryModal(false)}>
                Close
              </button>
            </div>
            <form onSubmit={onCreateGitHubIntegration} className="form-stack github-modal-form">
              <label>
                Owner
                <input
                  value={githubRepoOwner}
                  onChange={(event) => setGithubRepoOwner(event.target.value)}
                  placeholder="openai"
                  required
                  disabled={!canManageGitHubIntegrations}
                />
              </label>
              <label>
                Repository
                <input
                  value={githubRepoName}
                  onChange={(event) => setGithubRepoName(event.target.value)}
                  placeholder="labnote"
                  required
                  disabled={!canManageGitHubIntegrations}
                />
              </label>
              <label>
                Repository URL
                <input
                  value={githubRepoUrl}
                  onChange={(event) => setGithubRepoUrl(event.target.value)}
                  placeholder="https://github.com/openai/labnote"
                  disabled={!canManageGitHubIntegrations}
                />
              </label>
              <label>
                Default Branch
                <input
                  value={githubDefaultBranch}
                  onChange={(event) => setGithubDefaultBranch(event.target.value)}
                  disabled={!canManageGitHubIntegrations}
                />
              </label>
              <label className="github-modal-wide">
                Notes
                <textarea
                  value={githubNotes}
                  onChange={(event) => setGithubNotes(event.target.value)}
                  rows={4}
                  disabled={!canManageGitHubIntegrations}
                />
              </label>
              <div className="github-modal-actions">
                <button type="submit" className="compact-button" disabled={!canManageGitHubIntegrations || !currentUser.organization_id}>
                  Connect Repository
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {showGitHubMappingModal && (
        <div className="modal-backdrop" onClick={() => setShowGitHubMappingModal(false)}>
          <section className="card note-modal github-config-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <div>
                <h3>Project Mapping</h3>
                <span>Repository event to project workflow</span>
              </div>
              <button type="button" className="secondary-button compact-button" onClick={() => setShowGitHubMappingModal(false)}>
                Close
              </button>
            </div>
            <form onSubmit={onCreateGitHubProjectMapping} className="form-stack github-modal-form">
              <label>
                Repository
                <select
                  value={githubMappingIntegrationId}
                  onChange={(event) => setGithubMappingIntegrationId(event.target.value ? Number(event.target.value) : "")}
                  disabled={!canManageGitHubIntegrations}
                >
                  <option value="">Select a repository</option>
                  {githubIntegrations.map((integration) => (
                    <option key={integration.id} value={integration.id}>
                      {integration.repo_owner}/{integration.repo_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Project
                <select
                  value={githubMappingProjectId}
                  onChange={(event) => setGithubMappingProjectId(event.target.value)}
                  disabled={!canManageGitHubIntegrations}
                >
                  <option value="">Select a project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Branch Pattern
                <input
                  value={githubMappingBranchPattern}
                  onChange={(event) => setGithubMappingBranchPattern(event.target.value)}
                  placeholder="main or release/*"
                  disabled={!canManageGitHubIntegrations}
                />
              </label>
              <label>
                Note Creation Mode
                <select
                  value={githubMappingMode}
                  onChange={(event) => setGithubMappingMode(event.target.value)}
                  disabled={!canManageGitHubIntegrations}
                >
                  <option value="pr_merge">PR merge only</option>
                  <option value="manual">Manual from event</option>
                  <option value="every_push">Every push</option>
                </select>
              </label>
              <label>
                Default Author
                <select
                  value={githubMappingAuthorMemberId}
                  onChange={(event) => setGithubMappingAuthorMemberId(event.target.value ? Number(event.target.value) : "")}
                  disabled={!canManageGitHubIntegrations}
                >
                  <option value="">Project lead</option>
                  {companyMembers.map((member) => (
                    <option key={member.company_member_id} value={member.company_member_id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Default Reviewer
                <select
                  value={githubMappingReviewerMemberId}
                  onChange={(event) => setGithubMappingReviewerMemberId(event.target.value ? Number(event.target.value) : "")}
                  disabled={!canManageGitHubIntegrations}
                >
                  <option value="">Project lead</option>
                  {companyMembers.map((member) => (
                    <option key={member.company_member_id} value={member.company_member_id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="github-modal-actions">
                <button type="submit" className="compact-button" disabled={!canManageGitHubIntegrations || !githubMappingIntegrationId || !githubMappingProjectId}>
                  Save Mapping
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );

  const renderProfile = () => (
    <div className="user-stack">
      <section className="card feature-card">
        <p className="eyebrow">Profile</p>
        <h2>Personal Information</h2>
        <p className="context-copy">Manage your account details and keep your signature ready for note workflows.</p>
      </section>

      <section className="profile-grid">
        <article className="card">
          <div className="section-head">
            <h3>Account</h3>
          </div>
          <div className="feature-list profile-summary">
            <div>
              <strong>Name</strong>
              <span>{currentUser.name}</span>
            </div>
            <div>
              <strong>Username</strong>
              <span>{currentUser.username}</span>
            </div>
            <div>
              <strong>Email</strong>
              <span>{currentUser.email}</span>
            </div>
            <div>
              <strong>Status</strong>
              <span>{currentUser.approval_status}</span>
            </div>
          </div>
        </article>

        <article className="card">
          <div className="section-head">
            <h3>Signature</h3>
            <button
              type="button"
              className="secondary-button compact-button"
              onClick={() => signatureInputRef.current?.click()}
              disabled={isSavingSignature}
            >
              Choose Image
            </button>
          </div>

          <input
            ref={signatureInputRef}
            type="file"
            accept="image/*"
            className="hidden-input"
            onChange={(e) => void onSignatureFileChange(e.target.files?.[0] ?? null)}
          />

          <button
            type="button"
            className={`signature-dropzone${isSignatureDragging ? " dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsSignatureDragging(true);
            }}
            onDragLeave={() => setIsSignatureDragging(false)}
            onDrop={(event) => void onSignatureDrop(event)}
            onClick={() => signatureInputRef.current?.click()}
          >
            {signaturePreview ? (
              <img src={signaturePreview} alt="Signature preview" className="signature-preview-image" />
            ) : (
              <div className="signature-dropzone-copy">
                <strong>Drop signature image here</strong>
                <span>Drag and drop or click to upload your signature image.</span>
              </div>
            )}
          </button>

          <div className="profile-actions">
            <button
              type="button"
              className="secondary-button compact-button"
              onClick={() => void persistSignature(null)}
              disabled={!signaturePreview || isSavingSignature}
            >
              Remove Signature
            </button>
          </div>

          <div className="signature-version-list">
            {signatureVersions.length === 0 ? (
              <div className="plain-list-item">
                <strong>No saved signatures</strong>
                <span>Upload a signature image to make it available for approval snapshots.</span>
              </div>
            ) : (
              signatureVersions.map((signature) => (
                <div key={signature.id} className="signature-version-item">
                  <img
                    src={getBackendAssetUrl(`/storage/${signature.image_storage_key}`)}
                    alt={`Signature ${signature.id}`}
                  />
                  <div>
                    <strong>
                      Signature #{signature.id}
                      {signature.status === "active" && <span className="signature-active-badge">Active</span>}
                    </strong>
                    <span>
                      {new Date(signature.created_at).toLocaleString()}
                      {signature.revoked_at ? ` / revoked ${new Date(signature.revoked_at).toLocaleString()}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    onClick={() => void onRevokeSignature(signature.id)}
                    disabled={signature.status === "revoked"}
                  >
                    Revoke
                  </button>
                </div>
              ))
            )}
          </div>

          {profileNotice && <p className="profile-notice">{profileNotice}</p>}
        </article>
      </section>
    </div>
  );

  const renderResearcherManagement = () => {
    if (!currentUser.is_org_owner) {
      return renderPlaceholder(
        "Researcher Management",
        "Only organization owners can invite company researchers."
      );
    }
    const hasResearcherCompany = Boolean(currentUser.organization_id && researcherManagement);

    return (
      <div className="user-stack">
        {!hasResearcherCompany && (
          <section className="card page-intro">
            <p className="eyebrow">Notice</p>
            <p className="error">
              This owner account is not connected to an active company yet. Finish owner signup approval or sign in with the approved company owner account first.
            </p>
          </section>
        )}

        <section className="card">
          <div className="section-head">
            <h3>Invite by Email</h3>
            <span>
              Company: {researcherManagement?.company.name ?? "-"} / Code: {researcherManagement?.company.code ?? "-"}
            </span>
          </div>
          <form onSubmit={onInviteResearcher} className="form-inline">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="researcher@example.com"
              required
              disabled={!hasResearcherCompany}
            />
            <button type="submit" className="compact-button" disabled={!hasResearcherCompany}>Invite</button>
          </form>
        </section>

        <section className="card">
          <div className="section-head">
            <h3>Current Researchers</h3>
            <span>{organizationResearchers.length}</span>
          </div>
          <ul className="list">
            {organizationResearchers.map((member) => (
              <li key={member.company_member_id} className="plain-list-item researcher-row">
                <div>
                  <strong>{member.name}</strong>
                  <span>
                    {member.email} / {member.role} / {member.is_active ? "active" : "inactive"}
                  </span>
                </div>
                {member.role === "owner" ? (
                  <span className="project-pill">Owner</span>
                ) : (
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    onClick={() => void onRemoveCompanyResearcher(member.company_member_id)}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  };

  const renderProjectDetailPage = () => (
    <div className="portal-app">
        <aside className="portal-sidebar">
          <div className="project-context-card">
            <span className="project-context-label">Project Space</span>
            <strong>{selectedProject?.name}</strong>
            <p>{selectedProject?.code || "No project code"}</p>
            <button type="button" className="sidebar-back-button" onClick={onBackToProjects}>
              ← Back to Projects
            </button>
          </div>
          <nav className="user-nav project-nav">
          <button
            type="button"
            className={`user-nav-item${projectView === "dashboard" ? " active" : ""}`}
            onClick={() => setProjectView("dashboard")}
          >
            <SidebarIcon name="dashboard" />
            <strong>Project Dashboard</strong>
          </button>
          <button
            type="button"
            className={`user-nav-item${projectView === "members" ? " active" : ""}`}
            onClick={() => setProjectView("members")}
          >
            <SidebarIcon name="members" />
            <strong>Researcher Management</strong>
          </button>
          <button
            type="button"
            className={`user-nav-item${projectView === "notes" ? " active" : ""}`}
            onClick={() => setProjectView("notes")}
          >
            <SidebarIcon name="notes" />
            <strong>Research Note</strong>
          </button>
          <button
            type="button"
            className={`user-nav-item${projectView === "cover" ? " active" : ""}`}
            onClick={() => setProjectView("cover")}
          >
            <SidebarIcon name="cover" />
            <strong>Cover Template</strong>
          </button>
        </nav>
      </aside>

        <main className="portal-main">
          <div className="user-content user-content-full">
            <section className="card project-workspace-content project-workspace-content-standalone">
              {projectView !== "dashboard" && (
                <div className="section-head project-section-head">
                  <div>
                    <p className="eyebrow">Project Workspace</p>
                    <h3>{projectViewMeta[projectView].title}</h3>
                    <p className="context-copy">{projectViewMeta[projectView].description}</p>
                  </div>
                  {projectView === "notes" && (
                    <div className="note-file-actions">
                      <button type="button" className="compact-button" onClick={() => openCreateNoteModal()}>
                        Add Note
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => void onDownloadSelectedNotes()}
                        disabled={isBatchDownloading || notes.length === 0}
                      >
                        {isBatchDownloading
                          ? "Downloading..."
                          : isNoteSelectionMode
                            ? `Download Selected${selectedNoteIds.length > 0 ? ` (${selectedNoteIds.length})` : ""}`
                            : "Select Notes to Download"}
                      </button>
                      {isNoteSelectionMode && (
                        <button
                          type="button"
                          className="secondary-button compact-button"
                          onClick={() => {
                            setIsNoteSelectionMode(false);
                            setSelectedNoteIds([]);
                          }}
                          disabled={isBatchDownloading}
                        >
                          Cancel Selection
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {projectView === "dashboard" && renderProjectDashboard()}
              {projectView === "members" && renderProjectMembers()}
              {projectView === "notes" && renderProjectNotes()}
              {projectView === "cover" && renderProjectCover()}
            </section>
          </div>
      </main>
    </div>
  );

  const renderPlaceholder = (title: string, copy: string) => (
    <section className="card feature-card">
      <p className="eyebrow">Workspace Module</p>
      <h2>Coming Soon</h2>
      <p>{copy}</p>
    </section>
  );

  const renderCompanyAccessGate = () => (
    <section className="auth-shell">
      <div className="auth-card">
        <p className="eyebrow">Company Access</p>
        <h2>Request company access</h2>
        <p className="auth-copy">
          This account is not connected to a company yet. Until you are invited or approved, only this request screen is available.
        </p>

        <form onSubmit={onRequestCompanyAccess} className="form-stack">
          <label>
            Company name
            <input
              value={companyAccessName}
              onChange={(e) => setCompanyAccessName(e.target.value)}
              required
              disabled={companyAccessRequest !== null}
            />
          </label>
          <label>
            Company code
            <input
              value={companyAccessCode}
              onChange={(e) => setCompanyAccessCode(e.target.value.toUpperCase())}
              required
              disabled={companyAccessRequest !== null}
            />
          </label>
          <button type="submit" disabled={companyAccessRequest !== null}>Request Access</button>
        </form>

        {companyAccessRequest && (
          <section className="card inset-card">
            <p className="eyebrow">Pending Request</p>
            <h3>{companyAccessRequest.company_name}</h3>
            <p className="context-copy">
              Code: {companyAccessRequest.company_code} / Status: {companyAccessRequest.status}
            </p>
          </section>
        )}

        {companyAccessNotice && <p>{companyAccessNotice}</p>}
        {error && <p className="error">Error: {error}</p>}
      </div>
    </section>
  );

  const activeMeta = sectionMeta.find((section) => section.id === activeSection) ?? sectionMeta[0];
  const showPageIntro = activeSection !== "home";

  if (activeSection === "projects" && openedProjectId && selectedProject) {
    return renderProjectDetailPage();
  }

  if (!currentUser.is_org_owner && !currentUser.organization_id) {
    return renderCompanyAccessGate();
  }

  return (
    <div className="portal-app">
      <aside className="portal-sidebar">
        <nav className="user-nav">
          {sectionMeta.map((section) => {
            if (section.id === "projects") {
              return (
                <button
                  key={section.id}
                  className={`user-nav-item${activeSection === section.id ? " active" : ""}`}
                  onClick={() => setActiveSection("projects")}
                  type="button"
                >
                  <SidebarIcon name={section.id} />
                  <strong>{section.title}</strong>
                </button>
              );
            }

            return (
              <button
                key={section.id}
                className={`user-nav-item${activeSection === section.id ? " active" : ""}`}
                onClick={() => setActiveSection(section.id)}
                type="button"
              >
                <SidebarIcon name={section.id} />
                <strong>{section.title}</strong>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="portal-main">
        <div className="user-content">
        {showPageIntro && (
          <section className="card page-intro">
            <p className="eyebrow">{activeMeta.title}</p>
            <p>{activeMeta.description}</p>
            {error && <p className="error">Error: {error}</p>}
          </section>
        )}
        {!showPageIntro && error && (
          <section className="card page-intro">
            <p className="eyebrow">Notice</p>
            <p className="error">Error: {error}</p>
          </section>
        )}

        {activeSection === "home" && renderHome()}
        {activeSection === "projects" && renderProjects()}
        {activeSection === "researchers" && renderResearcherManagement()}
        {activeSection === "github" && renderGitHubIntegration()}
        {activeSection === "platforms" &&
          renderPlaceholder("Platform Integration", "Manage company-level storage, service, and platform connections here.")}
        {activeSection === "profile" && renderProfile()}
        </div>
      </main>
    </div>
  );
}
