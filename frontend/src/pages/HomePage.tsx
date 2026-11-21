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
  listAllResearchNotes,
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
  getNoteGenerationStatus,
  getResearchNoteDocument,
  listResearchNoteDocuments,
  updateResearchNoteDocument,
  type NoteGenerationStatus,
} from "../api/documentEditor";
import { DocumentEditor } from "../components/DocumentEditor";
import { NoteFormatSettings } from "../components/NoteFormatSettings";
import { LlmConnectionSettings } from "../components/LlmConnectionSettings";
import { BatchNoteGenerator } from "../components/BatchNoteGenerator";
import { ResearcherRegistration } from "../components/ResearcherRegistration";
import { PasswordChangeCard } from "../components/PasswordChangeCard";
import { GitHubAccountSettings, hasGitHubCallback } from "../components/GitHubAccountSettings";
import { buildPath, currentPath, parseRoute, writePath, type AppRoute } from "../lib/routes";
import { ProjectGitHubPanel } from "../components/ProjectGitHubPanel";
import { ProjectAiGenerator } from "../components/ProjectAiGenerator";
import { BulkUploadEditor } from "../components/BulkUploadEditor";
import { NoteCreatePage } from "../components/NoteCreatePage";
import { HomeQuickStart, HomeStats } from "../components/HomeDashboard";
import { AiReviewBanner, type AiReviewState } from "../components/AiReviewBanner";
import { collectDroppedItems, hasFolders, itemsFromFileList, type UploadItem } from "../lib/folderUpload";
import { CoverTemplateSettings } from "../components/CoverTemplateSettings";
import { NoteActivityPanel } from "../components/NoteActivityPanel";
import { NoteAuditLog } from "../components/NoteAuditLog";
import { DataStorage } from "../components/DataStorage";
import { ImageLab } from "../components/ImageLab";
import { SidebarUploadButton } from "../components/SidebarUploadButton";
import { NoteReviewPage } from "../components/NoteReviewPage";
import { ALL_BUNDLES, NoteBundleBar, filterNotesByBundle, type BundleFilter } from "../components/NoteBundleBar";
import { listNoteBundles, moveNotesToBundle, type NoteBundle } from "../api/noteBundle";
import type { SearchNavigation } from "../api/search";
import { deleteNoteFormat, getNoteFormat, saveNoteFormat, type NoteFormatInfo } from "../api/noteFormat";
import {
  DEFAULT_NOTE_FORMAT,
  buildPageTemplateSvg,
  buildSectionBlocks,
  formatImageRect,
  formatTemplateBlockIds,
  type NoteFormat,
} from "../lib/noteFormat";
import { getBackendAssetUrl } from "../api/client";
import {
  listGitHubIntegrations,
  listGitHubProjectMappings,
  type GitHubProjectMapping,
} from "../api/githubIntegration";
import type { DocumentSchema, ResearchNoteDocument, ResearchNoteDocumentSummary, TextBlock, ImageBlock } from "../types/document";
import coverLayoutData from "../../../shared/cover_layout.json";

type UserSection = "home" | "projects" | "researchers" | "format" | "github" | "platforms" | "profile";
type ProjectWorkspaceView = "dashboard" | "members" | "notes" | "review" | "data" | "imaging" | "ai" | "github" | "cover";
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
  overrideProjectCode: boolean;
  overrideProjectPeriod: boolean;
  showOrganization: boolean;
  showProjectTitle: boolean;
  showCoverTitle: boolean;
  showCode: boolean;
  showPrincipalInvestigator: boolean;
  showProjectPeriod: boolean;
  /** Small label above the title; its text is `coverTitle`. */
  showTopLabel: boolean;
  /** Line at the bottom of the cover; its text is `footerNote`. */
  showFooter: boolean;
};

const DEFAULT_COVER_FOOTER = "연구 기록은 등록된 과제 정보에 따라 관리됩니다.";
// Saved before the footer was editable; it was never printed, so treat it as "use the default".
const LEGACY_COVER_FOOTER = "이 표지 템플릿은 연구노트 묶음에 사용됩니다.";

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
  searchRequest?: { token: number; target: SearchNavigation } | null;
};

const sectionMeta: Array<{ id: UserSection; title: string; description: string }> = [
  { id: "home", title: "홈", description: "작업 공간 현황을 확인하고 각 관리 화면으로 이동합니다." },
  { id: "projects", title: "프로젝트 관리", description: "기관 프로젝트를 관리하고 프로젝트 작업 공간을 엽니다." },
  { id: "researchers", title: "연구원 관리", description: "연구원 계정과 참여 현황을 관리합니다." },
  { id: "format", title: "노트 포맷", description: "기관 전체 연구노트의 구성을 정합니다." },
  { id: "github", title: "GitHub 연동", description: "기관 GitHub 계정을 연결합니다. 저장소는 각 프로젝트의 GitHub 탭에서 연결합니다." },
  { id: "platforms", title: "플랫폼 연동", description: "외부 플랫폼과 저장소 연결을 관리합니다." },
];

const projectViewMeta: Record<ProjectWorkspaceView, { title: string; description: string }> = {
  review: {
    title: "노트 검토",
    description: "결재를 기다리는 노트, AI가 쓴 내용, 반려된 노트, 자동 점검에 걸린 노트를 한곳에서 확인합니다.",
  },
  dashboard: {
    title: "프로젝트 대시보드",
    description: "개요, 기간, 책임자, 프로젝트 상태를 확인합니다.",
  },
  members: {
    title: "연구원 관리",
    description: "이 프로젝트에만 참여하는 연구원을 배정하고 관리합니다.",
  },
  notes: {
    title: "연구노트",
    description: "노트를 보고, 파일을 올리고, 노트 묶음을 내려받습니다.",
  },
  data: {
    title: "데이터 보관함",
    description: "실험 원본 데이터를 형식 상관없이 올려 두고, 나중에 골라서 연구노트로 만들거나 AI에게 보냅니다.",
  },
  imaging: {
    title: "이미지 처리",
    description: "연구노트에 넣을 이미지를 자르고, 조정하고, 측정합니다. (준비 중)",
  },
  ai: {
    title: "AI 생성",
    description: "기존 노트나 새 문서를 근거로, AI와 장수를 정한 뒤 연구노트 초안을 여러 장 만듭니다.",
  },
  github: {
    title: "GitHub",
    description: "이 프로젝트에 GitHub 저장소를 연결하고, 커밋·PR로 연구노트를 만듭니다.",
  },
  cover: {
    title: "표지 템플릿",
    description: "묶음 내보내기에 쓰는 연구노트 표지를 관리합니다.",
  },
};

// Inside the footer "서명" cells (x 250-510; rows 955-1026 / 1026-1098), below the label.
// Mirrored in backend document_editor.py SIGNATURE_RECTS.
const SIGNATURE_RECTS = {
  author: { x: 256, y: 975, w: 248, h: 47 },
  reviewer: { x: 256, y: 1046, w: 248, h: 48 },
};

const SIDEBAR_COLLAPSED_KEY = "labnote.sidebarCollapsed";

function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function SidebarToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const label = collapsed ? "사이드바 펼치기" : "사이드바 접기";
  return (
    <button
      type="button"
      className="sidebar-toggle"
      onClick={onToggle}
      title={`${label} (Ctrl+\\)`}
      aria-label={label}
      aria-expanded={!collapsed}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
        <path d={collapsed ? "m13 10 2 2-2 2" : "m16 10-2 2 2 2"} />
      </svg>
    </button>
  );
}

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
    case "format":
      return (
        <svg {...commonProps}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M9 7h6" />
          <path d="M9 11h6" />
          <path d="M9 15h3" />
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
    case "data":
      return (
        <svg {...commonProps}>
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
          <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
        </svg>
      );
    case "review":
      return (
        <svg {...commonProps}>
          <path d="M9 11l3 3 8-8" />
          <path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
        </svg>
      );
    case "imaging":
      return (
        <svg {...commonProps}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="2" />
          <path d="m21 16-5-5-8 9" />
        </svg>
      );
    case "ai":
      return (
        <svg {...commonProps}>
          <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
          <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
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
  draft: "초안",
  reopened: "재개됨",
  submitted: "제출됨",
  approved: "승인됨",
  rejected: "반려됨",
};

const approvalEventLabels: Record<string, string> = {
  submitted: "제출됨",
  approved: "승인됨",
  rejected: "반려됨",
  reopened: "재개됨",
};

const approvalNoticeByAction: Record<"submit" | "approve" | "reject" | "reopen", string> = {
  submit: "연구노트를 승인 요청했습니다.",
  approve: "연구노트가 승인되어 잠겼습니다.",
  reject: "연구노트가 반려되었습니다.",
  reopen: "승인된 연구노트를 수정을 위해 다시 열었습니다.",
};

const projectStatusOptions = [
  { value: "active", label: "활성" },
  { value: "planned", label: "계획" },
  { value: "on_hold", label: "보류" },
  { value: "completed", label: "완료" },
];

const projectStatusText: Record<string, string> = Object.fromEntries(
  projectStatusOptions.map((option) => [option.value, option.label])
);
const roleText: Record<string, string> = {
  owner: "관리자",
  admin: "관리자",
  lead: "책임자",
  member: "연구원",
  reviewer: "검토자",
  co_researcher: "공동연구원",
  student: "학생연구원",
};
// Roles a project member can have (the lead is set separately with "책임자로 지정").
const PROJECT_ROLE_OPTIONS = [
  { value: "member", label: "연구원" },
  { value: "co_researcher", label: "공동연구원" },
  { value: "student", label: "학생연구원" },
  { value: "reviewer", label: "검토자" },
];
const mappingModeText: Record<string, string> = { pr_merge: "PR 병합 시에만", manual: "이벤트에서 수동 생성", every_push: "모든 푸시" };
const githubEventStatusText: Record<string, string> = {
  received: "수신됨",
  pending: "대기",
  processed: "처리됨",
  generated: "노트 생성됨",
  ignored: "무시됨",
  skipped: "건너뜀",
  failed: "실패",
};

function projectStatusLabel(status: string) {
  return projectStatusText[status] ?? status;
}

function roleLabel(role: string) {
  return roleText[role] ?? role;
}

function mappingModeLabel(mode: string) {
  return mappingModeText[mode] ?? mode;
}

function githubEventStatusLabel(status: string) {
  return githubEventStatusText[status] ?? status;
}

function formatProjectPeriod(startDate: string | null, endDate: string | null) {
  const start = startDate ?? "미정";
  const end = endDate ?? "미정";
  return `${start} - ${end}`;
}

function buildDefaultCoverTemplate(project: Project | null, managerName = "", organizationName = "LABNOTE"): CoverTemplate {
  return {
    organization: organizationName,
    projectTitle: project?.name ?? "연구노트",
    coverTitle: "연구노트",
    projectCode: project?.code ?? "",
    principalInvestigator: managerName,
    projectPeriod: formatProjectPeriod(project?.start_date ?? null, project?.end_date ?? null),
    footerNote: DEFAULT_COVER_FOOTER,
    overrideOrganization: false,
    overrideProjectTitle: false,
    overridePrincipalInvestigator: false,
    overrideProjectCode: false,
    overrideProjectPeriod: false,
    showOrganization: true,
    showProjectTitle: true,
    showCoverTitle: false,
    showCode: true,
    showPrincipalInvestigator: true,
    showProjectPeriod: true,
    showTopLabel: true,
    showFooter: true,
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
      footerNote:
        !parsed.footerNote || parsed.footerNote === LEGACY_COVER_FOOTER ? DEFAULT_COVER_FOOTER : (parsed.footerNote as string),
      overrideOrganization: (parsed.overrideOrganization as boolean) ?? false,
      overrideProjectTitle: (parsed.overrideProjectTitle as boolean) ?? false,
      overridePrincipalInvestigator: (parsed.overridePrincipalInvestigator as boolean) ?? false,
      overrideProjectCode: (parsed.overrideProjectCode as boolean) ?? false,
      overrideProjectPeriod: (parsed.overrideProjectPeriod as boolean) ?? false,
      showTopLabel: (parsed.showTopLabel as boolean) ?? true,
      showFooter: (parsed.showFooter as boolean) ?? true,
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
    projectCode: template.overrideProjectCode ? template.projectCode : defaults.projectCode,
    projectPeriod: template.overrideProjectPeriod ? template.projectPeriod : defaults.projectPeriod,
    coverTitle: template.coverTitle?.trim() ? template.coverTitle : defaults.coverTitle,
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
  if (!ctx) throw new Error("표지 이미지를 준비하지 못했습니다");

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
      label: "연구 기간",
      value: template.showProjectPeriod
        ? template.projectPeriod || formatProjectPeriod(project?.start_date ?? null, project?.end_date ?? null)
        : "",
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
  if (template.showTopLabel) {
    ctx.fillText(template.coverTitle || "연구노트", canvas.width / 2, topLabel.top + topLabel.height / 2);
  }

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
  if (template.showFooter) {
    ctx.fillText(template.footerNote, footer.x + footer.width / 2, footer.y + footer.height / 2);
  }

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
  if (!ctx) throw new Error("목차 이미지를 준비하지 못했습니다");

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
    { label: "번호", x: tableX, w: indexW },
    { label: "제목", x: tableX + indexW, w: titleW },
    { label: "작성일", x: tableX + indexW + titleW, w: dateW },
    { label: "페이지", x: tableX + indexW + titleW + dateW, w: pageW },
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

function buildNoteTemplateBlocks(
  note: ResearchNote,
  context: NoteTemplateContext,
  format: NoteFormat = DEFAULT_NOTE_FORMAT
): Array<TextBlock | ImageBlock> {
  const allowed = formatTemplateBlockIds(format);
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
      ...SIGNATURE_RECTS.author,
      src: context.authorSignatureUrl,
      locked: true,
    });
  }

  if (context.reviewerSignatureUrl) {
    blocks.push({
      id: "reviewer-signature",
      type: "image",
      ...SIGNATURE_RECTS.reviewer,
      src: context.reviewerSignatureUrl,
      locked: true,
    });
  }

  return blocks.filter((block) => allowed.has(block.id));
}

function buildDefaultNoteDocument(
  note: ResearchNote,
  firstPage: NotePage | null,
  context: NoteTemplateContext,
  format: NoteFormat = DEFAULT_NOTE_FORMAT
): DocumentSchema {
  const blocks: Array<TextBlock | ImageBlock> = buildNoteTemplateBlocks(note, context, format);
  const imageRect = formatImageRect(format);
  if (firstPage && imageRect) {
    blocks.push({
      id: "content-image",
      type: "image",
      ...imageRect,
      src: getBackendAssetUrl(`/storage/${firstPage.image_storage_key}`),
      locked: false,
    });
  }
  // New notes start with the company's body sections laid out per the format.
  blocks.push(...buildSectionBlocks(format));

  return {
    schemaVersion: 1,
    id: `draft-${crypto.randomUUID()}`,
    title: `${note.title} 레이아웃`,
    page: {
      width: 794,
      height: 1123,
      background: "#ffffff",
      backgroundImage: buildPageTemplateSvg(format),
    },
    meta: {
      noteId: note.id,
      sourceFileId: firstPage?.file_id ?? null,
      sourcePageId: firstPage?.id ?? null,
    },
    blocks,
  };
}

function ensureResearchNoteDocumentFrame(
  document: DocumentSchema,
  note: ResearchNote,
  context: NoteTemplateContext,
  format: NoteFormat = DEFAULT_NOTE_FORMAT
): DocumentSchema {
  const templateBlocks = buildNoteTemplateBlocks(note, context, format);
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
      ? buildPageTemplateSvg(format)
      : document.page.backgroundImage;

  if (document.blocks.length === 0) {
    return {
      ...document,
      page: {
        ...document.page,
        backgroundImage: buildPageTemplateSvg(format),
      },
      blocks: templateBlocks,
    };
  }

  const nextBlocks = document.blocks
    // Keep images, template fields, and free text blocks (editor, AI and GitHub drafts).
    // Only stale copies of template-only ids are dropped.
    // Template fields the format hides (e.g. signature area turned off) are dropped.
    .filter((block) => (frameBlockIds.has(block.id) ? templateById.has(block.id) : true))
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
      && !(document.blocks.some((block) => block.id === "ai-batch-body") && templateBlock.id.startsWith("section-"))
  );

  const hasContentImage = nextBlocks.some((block) => block.id === "content-image");
  const recoveryRect = formatImageRect(format);
  const recoveredContentImage =
    !hasExistingFrame && sourcePageImage && !hasContentImage && recoveryRect
      ? [
          {
            id: "content-image",
            type: "image" as const,
            ...recoveryRect,
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

export function HomePage({ currentUser, onCurrentUserChange, openProfileToken, searchRequest }: Props) {
  const [activeSection, setActiveSection] = useState<UserSection>(() => (hasGitHubCallback() ? "github" : "home"));
  // A note picked from search; opened once its project's note list has loaded.
  const pendingSearchNoteId = useRef<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const toggleSidebar = () => setSidebarCollapsed((value) => !value);

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
    } catch {
      // Storage may be unavailable (private mode); the toggle still works for this visit.
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "\\") {
        event.preventDefault();
        setSidebarCollapsed((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const [projectView, setProjectView] = useState<ProjectWorkspaceView>("dashboard");
  const [showCreateProjectForm, setShowCreateProjectForm] = useState(false);
  const [showBatchGenerator, setShowBatchGenerator] = useState(false);
  const [openedProjectId, setOpenedProjectId] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsReady, setProjectsReady] = useState(false);
  const [companyMembers, setCompanyMembers] = useState<CompanyMemberDirectoryItem[]>([]);
  const [researcherManagement, setResearcherManagement] = useState<ResearcherManagementData | null>(null);
  const [llmStatus, setLlmStatus] = useState<NoteGenerationStatus | null>(null);
  const [noteFormatInfo, setNoteFormatInfo] = useState<NoteFormatInfo | null>(null);
  const [noteFormatError, setNoteFormatError] = useState<string | null>(null);
  const noteFormat = noteFormatInfo?.format ?? DEFAULT_NOTE_FORMAT;
  const [githubProjectMappings, setGithubProjectMappings] = useState<GitHubProjectMapping[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [projectCover, setProjectCover] = useState<ProjectNoteCover | null>(null);
  const [coverPreviewImageUrl, setCoverPreviewImageUrl] = useState<string | null>(null);
  const [tocPreviewImageUrl, setTocPreviewImageUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [noteBundles, setNoteBundles] = useState<NoteBundle[]>([]);
  const [bundleFilter, setBundleFilter] = useState<BundleFilter>(ALL_BUNDLES);
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

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [ownerMemberId, setOwnerMemberId] = useState<number | "">("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [monthlyNoteTarget, setMonthlyNoteTarget] = useState("");

  const [memberId, setMemberId] = useState<number | "">("");
  const [memberRole, setMemberRole] = useState("member");

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
  const noteFolderInputRef = useRef<HTMLInputElement | null>(null);
  const noteCreateUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [noteModalMode, setNoteModalMode] = useState<"create" | "edit">("create");
  const [openedResearchNoteId, setOpenedResearchNoteId] = useState<string | null>(null);
  const [pendingNoteFiles, setPendingNoteFiles] = useState<File[]>([]);
  const [bulkUploadFiles, setBulkUploadFiles] = useState<UploadItem[] | null>(null);
  const [noteWorkspaceTab, setNoteWorkspaceTab] = useState<"editor" | "history">("editor");
  useEffect(() => {
    setNoteWorkspaceTab("editor");
  }, [openedResearchNoteId]);
  // Files for the new-note page; null while the page is closed.
  const [noteCreateFiles, setNoteCreateFiles] = useState<File[] | null>(null);
  // All notes across the user's projects, for the home to-do lists.
  const [homeNotes, setHomeNotes] = useState<ResearchNote[]>([]);
  const [homeNotesStatus, setHomeNotesStatus] = useState<"loading" | "ready" | "error">("loading");
  const [homeNotesAttempt, setHomeNotesAttempt] = useState(0);
  // Documents handed from 데이터 보관함 to the AI 생성 tab.
  const [aiSeedDocuments, setAiSeedDocuments] = useState<{ files: File[]; token: number } | null>(null);
  const [signatureReminderHidden, setSignatureReminderHidden] = useState(() => {
    try {
      return window.sessionStorage.getItem("labnote.signatureReminderHidden") === "1";
    } catch {
      return false;
    }
  });
  // Shown to whoever assigns a project lead who has not registered a signature yet.
  const [leadSignatureNotice, setLeadSignatureNotice] = useState<string | null>(null);
  const [noteNotice, setNoteNotice] = useState<string | null>(null);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [isNoteSelectionMode, setIsNoteSelectionMode] = useState(false);
  const [notesPage, setNotesPage] = useState(1);
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [batchDownloadProgress, setBatchDownloadProgress] = useState<number | null>(null);
  const [noteLayoutStatus, setNoteLayoutStatus] = useState<Record<string, boolean>>({});

  const currentCompanyMember = companyMembers.find((member) => member.user_id === currentUser.id) ?? null;
  // Projects this user leads: approving their notes stamps the user's signature.
  const myLedProjects = currentCompanyMember
    ? projects.filter((project) => project.owner_member_id === currentCompanyMember.company_member_id)
    : [];
  const myReviewWaiting = currentCompanyMember
    ? homeNotes.filter((note) => note.status === "submitted" && note.reviewer_member_id === currentCompanyMember.company_member_id)
    : [];
  const needsOwnSignature = (myLedProjects.length > 0 || myReviewWaiting.length > 0) && !signaturePreview;
  const canManageSelectedProject = Boolean(
    selectedProject &&
      (currentUser.is_org_owner ||
        (currentCompanyMember && selectedProject.owner_member_id === currentCompanyMember.company_member_id))
  );
  const availableProjectResearchers = companyMembers.filter(
    (companyMember) => !members.some((member) => member.company_member_id === companyMember.company_member_id)
  );
  const organizationResearchers = [...(researcherManagement?.members ?? [])].sort((left, right) => {
      if (left.role === "owner" && right.role !== "owner") return -1;
      if (left.role !== "owner" && right.role === "owner") return 1;
      return left.name.localeCompare(right.name, "ko");
    });
  const todayIso = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
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
    setBundleFilter(ALL_BUNDLES);
  }, [selectedProject?.id]);

  useEffect(() => {
    setNotesPage(1);
  }, [bundleFilter]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(notes.length / 10));
    setNotesPage((current) => Math.min(current, totalPages));
  }, [notes]);

  useEffect(() => {
    let active = true;
    getNoteFormat()
      .then((info) => {
        if (!active) return;
        setNoteFormatInfo(info);
        setNoteFormatError(null);
      })
      .catch((formatError) => active && setNoteFormatError((formatError as Error).message));
    return () => {
      active = false;
    };
  }, []);

  const onSaveNoteFormat = async (format: NoteFormat) => {
    const saved = await saveNoteFormat(format);
    setNoteFormatInfo(saved);
  };

  const onDeleteNoteFormat = async () => {
    setNoteFormatInfo(await deleteNoteFormat());
  };

  useEffect(() => {
    let active = true;
    getNoteGenerationStatus()
      .then((status) => active && setLlmStatus(status))
      .catch(() => active && setLlmStatus(null));
    return () => {
      active = false;
    };
  }, []);

  const getCompanyMemberName = (companyMemberId: number | null | undefined) => {
    if (!companyMemberId) return "미지정";
    return companyMembers.find((member) => member.company_member_id === companyMemberId)?.name ?? `Member #${companyMemberId}`;
  };

  const getCompanyMember = (companyMemberId: number | null | undefined) =>
    companyMemberId ? companyMembers.find((member) => member.company_member_id === companyMemberId) ?? null : null;

  const [aiReview, setAiReview] = useState<AiReviewState | null>(null);
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
      (canManageSelectedProject || selectedNoteIsAuthor) &&
      !(aiReview?.required && !aiReview.reviewed)
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
        projectTitle: selectedProject?.name ?? "연구 과제",
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
        setProjectsReady(true);
        return;
      }
      const data = await listProjects(currentUser.organization_id);
      setProjects(data);
      setProjectsReady(true);
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

  // Only the repository links are needed here (project dashboard KPI); the GitHub screens load their own data.
  const refreshGitHubIntegrations = async () => {
    try {
      if (!currentUser.organization_id) {
        setGithubProjectMappings([]);
        return;
      }
      const data = await listGitHubIntegrations(currentUser.organization_id);
      const mappingGroups = await Promise.all(data.map((integration) => listGitHubProjectMappings(integration.id)));
      setGithubProjectMappings(mappingGroups.flat());
    } catch {
      setGithubProjectMappings([]);
    }
  };

  const refreshNotes = async (projectId: string) => {
    try {
      const [data, bundles] = await Promise.all([
        listResearchNotes(projectId),
        listNoteBundles(projectId).catch(() => [] as NoteBundle[]),
      ]);
      setNotes(data);
      setNoteBundles(bundles);
      setBundleFilter((current) =>
        current === ALL_BUNDLES || current === "none" || bundles.some((bundle) => bundle.id === current) ? current : ALL_BUNDLES
      );
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
          document: ensureResearchNoteDocumentFrame(fullDocument.document, targetNote, buildNoteTemplateContext(overrides), noteFormat),
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
    const pendingId = pendingSearchNoteId.current;
    if (pendingId && notes.some((note) => note.id === pendingId)) {
      pendingSearchNoteId.current = null;
      void (async () => {
        await onSelectNote(pendingId);
        setOpenedResearchNoteId(pendingId);
      })();
      return;
    }

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

    const fallbackTitle = selectedProject?.name ?? "연구노트";
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

  const warnIfLeadHasNoSignature = (memberId: number | "" | null | undefined, projectName: string) => {
    if (memberId === "" || memberId == null) return;
    const member = companyMembers.find((item) => item.company_member_id === Number(memberId));
    if (!member || member.user_id === currentUser.id || member.signature_data_url) return;
    setLeadSignatureNotice(
      `${member.name}님을 "${projectName}" 책임자로 지정했지만 아직 서명이 등록되지 않았습니다. ` +
        `${member.name}님이 로그인 후 프로필에서 서명을 등록해야 결재에 서명이 들어갑니다.`
    );
  };

  const onCreateProject = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      if (!currentUser.organization_id) {
        throw new Error("프로젝트를 만들려면 먼저 기관에 소속되어야 합니다.");
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
      warnIfLeadHasNoSignature(ownerMemberId, name);
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
    setNoteCreateFiles(null);
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

  const onOpenProjectPage = async (project: Project, view: ProjectWorkspaceView = "dashboard") => {
    const loaded = await onSelectProject(project);
    if (!loaded) return false;
    setOpenedProjectId(project.id);
    setProjectView(view);
    return true;
  };

  const onBackToProjects = () => {
    setOpenedProjectId(null);
  };

  useEffect(() => {
    if (projectView !== "notes" || activeSection !== "projects" || !openedProjectId) setBulkUploadFiles(null);
  }, [projectView, activeSection, openedProjectId]);

  useEffect(() => {
    if (activeSection !== "home" || openedProjectId) return;
    let live = true;
    setHomeNotesStatus("loading");
    listAllResearchNotes()
      .then((items) => {
        if (!live) return;
        setHomeNotes(items);
        setHomeNotesStatus("ready");
      })
      .catch(() => {
        if (!live) return;
        setHomeNotes([]);
        setHomeNotesStatus("error");
      });
    return () => {
      live = false;
    };
  }, [activeSection, openedProjectId, currentUser.id, currentUser.organization_id, homeNotesAttempt]);

  // ─── URL ⇄ screen ──────────────────────────────────────────────────────
  // The route from the address bar (on load, or after back/forward) waits here until projects are loaded.
  const pendingRoute = useRef<AppRoute | null>(hasGitHubCallback() ? null : parseRoute(window.location.pathname, window.location.search));
  // While a route is being restored, intermediate screens replace the URL instead of adding history entries.
  const restoringRoute = useRef(pendingRoute.current !== null);
  const [routeTick, setRouteTick] = useState(0);

  useEffect(() => {
    const onPop = () => {
      pendingRoute.current = parseRoute(window.location.pathname, window.location.search);
      restoringRoute.current = true;
      setRouteTick((value) => value + 1);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const route = pendingRoute.current;
    if (!route || !projectsReady) return;
    pendingRoute.current = null;
    void (async () => {
      try {
        if (route.kind === "section") {
          setOpenedProjectId(null);
          setOpenedResearchNoteId(null);
          setActiveSection(route.section);
          return;
        }
        const project = projects.find((item) => item.id === route.projectId);
        if (!project) {
          // Deleted, or not shared with this account: fall back to the project list.
          setOpenedProjectId(null);
          setActiveSection("projects");
          return;
        }
        if (openedProjectId !== project.id) {
          pendingSearchNoteId.current = route.noteId ?? null;
          const opened = await onOpenProjectPage(project, route.view);
          if (!opened) pendingSearchNoteId.current = null;
        } else {
          setProjectView(route.view);
          if (route.noteId && route.noteId !== openedResearchNoteId) await onOpenResearchNote(route.noteId);
          if (!route.noteId) setOpenedResearchNoteId(null);
        }
      } finally {
        // Let the restored screen render (and write its own URL) before normal history pushes resume.
        window.setTimeout(() => {
          restoringRoute.current = false;
        }, 300);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectsReady, routeTick]);

  useEffect(() => {
    // GitHub's sign-in code is still in the address bar; the GitHub page removes it itself.
    if (pendingRoute.current || hasGitHubCallback()) return;
    const route: AppRoute =
      activeSection === "projects" && openedProjectId
        ? {
            kind: "project",
            projectId: openedProjectId,
            view: projectView,
            noteId: projectView === "notes" && openedResearchNoteId ? openedResearchNoteId : undefined,
          }
        : { kind: "section", section: activeSection };
    const path = buildPath(route);
    if (path !== currentPath()) writePath(path, restoringRoute.current);
  }, [activeSection, openedProjectId, projectView, openedResearchNoteId]);

  const onSearchNavigate = (target: SearchNavigation) => {
    const project = projects.find((item) => item.id === target.projectId);
    if (!project) {
      setError("검색한 프로젝트를 찾을 수 없습니다. 새로고침 후 다시 시도하세요.");
      return;
    }
    pendingSearchNoteId.current = target.kind === "note" ? target.noteId : null;
    void (async () => {
      const opened = await onOpenProjectPage(project, target.kind === "note" ? "notes" : "dashboard");
      if (!opened) pendingSearchNoteId.current = null;
    })();
  };

  useEffect(() => {
    if (searchRequest) onSearchNavigate(searchRequest.target);
    // Only a new request token should trigger navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchRequest?.token]);

  const onAssignMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProject || memberId === "") return;

    try {
      await assignProjectMember(selectedProject.id, memberId, memberRole);
      if (/책임|관리|lead|manager|owner|\bpi\b/i.test(memberRole)) warnIfLeadHasNoSignature(memberId, selectedProject.name);
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
      if (updated.owner_member_id !== selectedProject.owner_member_id) {
        warnIfLeadHasNoSignature(updated.owner_member_id, updated.name);
      }
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
      setNoteNotice(pendingNoteFiles.length > 0 ? "연구노트를 만들고 파일을 업로드했습니다." : "연구노트를 만들었습니다.");
    } catch (err) {
      setError((err as Error).message);
    }
  };

    const onSelectNote = async (noteId: string) => {
      try {
        const detail = await getResearchNote(noteId);
        const noteDefaults: NoteTemplateOverrides = {
          authorMemberId: detail.owner_member_id ?? defaultNoteAuthorMemberId,
          writtenDate: detail.written_date ?? todayIso,
          reviewerMemberId: detail.reviewer_member_id ?? defaultNoteReviewerMemberId,
          reviewedDate: detail.reviewed_date ?? todayIso,
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
            const draft = buildDefaultNoteDocument(detail, pages[0], buildNoteTemplateContext(noteDefaults), noteFormat);
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
      setError("제출되었거나 승인된 연구노트는 수정할 수 없습니다.");
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

  // New notes are made on their own page (NoteCreatePage), not in the popup.
  const openCreateNoteModal = (files: File[] = []) => {
    setError(null);
    setNoteNotice(null);
    setBulkUploadFiles(null);
    setNoteCreateFiles(files);
  };

  const openEditNoteModal = () => {
      if (!selectedNote) return;
      if (selectedNoteIsLocked) {
        setError("제출되었거나 승인된 연구노트는 수정할 수 없습니다.");
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

  const queueResearchFilesForNewNote = (items: UploadItem[]) => {
    if (items.length === 0) return;
    setError(null);
    // Several files or a folder: arrange them into notes first (titles, dates, grouping), then upload all at once.
    if (items.length > 1 || hasFolders(items)) {
      setBulkUploadFiles(items);
      return;
    }
    openCreateNoteModal(items.map((item) => item.file));
  };

  const onResearchFileDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsNoteFileDragging(false);
    queueResearchFilesForNewNote(await collectDroppedItems(event.dataTransfer));
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
        document: ensureResearchNoteDocumentFrame(document.document, selectedNote, buildNoteTemplateContext(), noteFormat),
      });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onCreateNoteDocument = async () => {
    if (!selectedNote) return;
    if (selectedNoteIsLocked) {
      setError("제출되었거나 승인된 연구노트는 수정할 수 없습니다.");
      return;
    }
    try {
      const draft = buildDefaultNoteDocument(selectedNote, notePages[0] ?? null, buildNoteTemplateContext(), noteFormat);
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
      throw new Error("먼저 연구노트를 선택하세요");
    }
    if (selectedNoteIsLocked) {
      throw new Error("제출되었거나 승인된 연구노트는 수정할 수 없습니다.");
    }
    try {
      const normalizedDocument = ensureResearchNoteDocumentFrame(document, selectedNote, buildNoteTemplateContext(), noteFormat);
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
      setError("제출되었거나 승인된 연구노트는 수정할 수 없습니다.");
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
        `${selectedNote.title}에 파일 ${files.length}개를 추가했습니다.`
      );
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onReplaceNotePageAsset = async (pageId: number, file: File): Promise<NotePage> => {
    if (!selectedNote) {
      throw new Error("먼저 연구노트를 선택하세요");
    }
    if (selectedNoteIsLocked) {
      throw new Error("제출되었거나 승인된 연구노트는 수정할 수 없습니다.");
    }
    try {
      setError(null);
      const updatedPage = await replaceNotePageAsset(pageId, file, "문서 편집기에서 교체함");
      setNotePages((current) => current.map((page) => (page.id === updatedPage.id ? updatedPage : page)));
      if (selectedNote) {
        const files = await refreshNoteFiles(selectedNote.id);
        await loadNotePagesForFiles(files);
      }
      setNoteNotice("연구노트 페이지 이미지를 교체했습니다.");
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
      setError(action === "reject" ? "반려 사유를 입력하세요." : "재개 사유를 입력하세요.");
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

  const onSaveProjectCover = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!selectedProject) return;

    {
      const resolvedForSave = resolveCoverTemplate(
        coverTemplate,
        selectedProject,
        getCompanyMemberName(selectedProject?.owner_member_id),
        researcherManagement?.company.name ?? "LABNOTE"
      );
      const coverImageDataUrl = await generateCoverImageDataUrl(resolvedForSave, selectedProject);
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
      setProfileNotice(dataUrl ? "서명을 변경했습니다." : "서명을 삭제했습니다.");
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
        reject(new Error("서명에는 이미지 파일만 사용할 수 있습니다."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("서명 이미지를 읽지 못했습니다."));
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
      setProfileNotice("서명을 업로드했습니다.");
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
      setProfileNotice("서명을 삭제했습니다.");
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
  const visibleNotes = filterNotesByBundle(notes, bundleFilter);
  const totalNotePages = Math.max(1, Math.ceil(visibleNotes.length / notesPerPage));
  const paginatedNotes = visibleNotes.slice((notesPage - 1) * notesPerPage, notesPage * notesPerPage);

  const onMoveNotesToBundle = async (noteIds: string[], bundleId: string | null) => {
    if (!selectedProject || noteIds.length === 0) return;
    try {
      const { moved } = await moveNotesToBundle(selectedProject.id, noteIds, bundleId);
      const target = noteBundles.find((bundle) => bundle.id === bundleId);
      setNoteNotice(target ? `노트 ${moved}개를 '${target.name}' 묶음으로 옮겼습니다.` : `노트 ${moved}개를 묶음에서 뺐습니다.`);
      await refreshNotes(selectedProject.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

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
      setNoteNotice("포함할 연구노트를 선택한 뒤 다운로드를 다시 누르세요.");
      return;
    }

    if (selectedNoteIds.length === 0) {
      setNoteNotice("다운로드할 연구노트를 하나 이상 선택하세요.");
      return;
    }

    try {
      setIsBatchDownloading(true);
      setBatchDownloadProgress(0);
      await downloadSelectedResearchNotesPdf(selectedNoteIds, (progress) => {
        setBatchDownloadProgress(progress.percent);
      });
      setNoteNotice(`연구노트 PDF ${selectedNoteIds.length}개를 다운로드했습니다.`);
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
      setNoteNotice("연구노트와 첨부 파일을 삭제했습니다.");
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

  const onRemoveCompanyResearcher = async (companyMemberId: number) => {
    try {
      await removeResearcherMember(companyMemberId);
      await Promise.all([refreshResearcherManagement(), refreshCompanyMembers()]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const renderHome = () => {
    const myMemberIds = new Set(
      companyMembers.filter((member) => member.user_id === currentUser.id).map((member) => member.company_member_id)
    );
    const projectName = (projectId: string) => projects.find((project) => project.id === projectId)?.name ?? "";
    const toReview = homeNotes.filter((note) => note.status === "submitted" && note.reviewer_member_id != null && myMemberIds.has(note.reviewer_member_id));
    const myRejected = homeNotes.filter((note) => note.status === "rejected" && myMemberIds.has(note.owner_member_id));
    const myDrafts = homeNotes.filter((note) => ["draft", "reopened"].includes(note.status) && myMemberIds.has(note.owner_member_id));
    const today = new Date();
    const monthKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    const notesReady = homeNotesStatus === "ready";
    const todoGroups: Array<{ key: string; title: string; hint: string; tone: string; items: ResearchNote[] }> = [
      { key: "review", title: "내가 결재할 노트", hint: "검토자로 지정된 제출 노트", tone: "warn", items: toReview },
      { key: "rejected", title: "반려된 내 노트", hint: "고쳐서 다시 제출하세요", tone: "danger", items: myRejected },
      { key: "drafts", title: "제출 안 한 내 초안", hint: "작성을 마치면 제출하세요", tone: "", items: myDrafts },
    ];
    const todoCount = toReview.length + myRejected.length + myDrafts.length;
    const openNote = (note: ResearchNote) => onSearchNavigate({ kind: "note", projectId: note.project_id, noteId: note.id });

    return (
      <div className="user-stack home">
        <section className="home-greeting">
          <h2>{currentUser.name}님, 안녕하세요</h2>
          <span>
            {today.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" })}
            {notesReady && (todoCount ? ` · 확인할 노트 ${todoCount}건` : " · 처리할 노트가 없습니다")}
          </span>
        </section>

        <HomeStats
          notes={homeNotes}
          projects={projects}
          projectsReady={projectsReady}
          notesStatus={homeNotesStatus}
          myMemberIds={myMemberIds}
          organisationScope={Boolean(currentUser.is_org_owner)}
          onRetry={() => setHomeNotesAttempt((attempt) => attempt + 1)}
        />

        <HomeQuickStart
          notes={notesReady ? homeNotes : []}
          notesStatus={homeNotesStatus}
          projects={projects}
          myMemberIds={myMemberIds}
          projectName={projectName}
          onOpenNote={openNote}
          onNewNote={async (project) => {
            if (await onOpenProjectPage(project, "notes")) openCreateNoteModal();
          }}
          onAiNotes={async (project) => {
            await onOpenProjectPage(project, "ai");
          }}
          onManageProjects={() => setActiveSection("projects")}
        />

        {notesReady && <section className="home-todos" aria-label="내가 확인할 노트">
          {todoGroups.map((group) => (
            <article key={group.key} className={`card home-todo${group.items.length ? ` ${group.tone}` : " empty"}`}>
              <div className="home-todo-head">
                <h3>{group.title}</h3>
                <strong>{group.items.length}</strong>
              </div>
              <p className="home-todo-hint">{group.hint}</p>
              {group.items.length === 0 ? (
                <p className="home-todo-empty">없음</p>
              ) : (
                <ul>
                  {group.items.slice(0, 4).map((note) => (
                    <li key={note.id}>
                      <button type="button" onClick={() => openNote(note)}>
                        <strong>{note.title}</strong>
                        <span>
                          {projectName(note.project_id)} · {note.written_date ?? note.updated_at.slice(0, 10)}
                        </span>
                      </button>
                    </li>
                  ))}
                  {group.items.length > 4 && <li className="home-todo-more">외 {group.items.length - 4}건</li>}
                </ul>
              )}
            </article>
          ))}
        </section>}

        <section className="card home-projects">
          <div className="home-projects-head">
            <h3>내 프로젝트</h3>
            <button type="button" className="link-button" onClick={() => setActiveSection("projects")}>
              프로젝트 관리
            </button>
          </div>
          {projects.length === 0 ? (
            <p className="home-todo-empty">아직 참여한 프로젝트가 없습니다.</p>
          ) : (
            <div className="table-shell">
              <table className="admin-table home-project-table">
                <thead>
                  <tr>
                    <th>프로젝트</th>
                    <th>책임자</th>
                    <th>이번 달 노트</th>
                    <th>결재 대기</th>
                    <th>반려</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => {
                    const projectNotes = homeNotes.filter((note) => note.project_id === project.id);
                    const month = projectNotes.filter((note) => (note.written_date ?? note.created_at).slice(0, 7) === monthKey).length;
                    const waiting = projectNotes.filter((note) => note.status === "submitted").length;
                    const rejected = projectNotes.filter((note) => note.status === "rejected").length;
                    const target = project.monthly_note_target ?? 0;
                    return (
                      <tr key={project.id} onClick={() => void onOpenProjectPage(project)} className="home-project-row">
                        <td>
                          <button type="button" className="link-button" onClick={(event) => {
                            event.stopPropagation();
                            void onOpenProjectPage(project);
                          }}>{project.name}</button>
                          <span className={`pd-status status-${project.status}`}>{projectStatusLabel(project.status)}</span>
                        </td>
                        <td>{getCompanyMemberName(project.owner_member_id) || "-"}</td>
                        <td>
                          {notesReady ? month : "—"}
                          {notesReady && target > 0 && <span className="home-target"> / {target}</span>}
                        </td>
                        <td className={notesReady && waiting ? "home-cell-warn" : ""}>{notesReady ? waiting : "—"}</td>
                        <td className={notesReady && rejected ? "home-cell-danger" : ""}>{notesReady ? rejected : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    );
  };

  const renderProjectDashboard = () => {
    const today = new Date();
    const start = selectedProject?.start_date ? new Date(selectedProject.start_date) : null;
    const finish = selectedProject?.end_date ? new Date(selectedProject.end_date) : null;
    const dayMs = 24 * 60 * 60 * 1000;
    const totalDays = start && finish ? Math.max(1, Math.round((finish.getTime() - start.getTime()) / dayMs)) : null;
    const elapsed = start && totalDays ? Math.min(totalDays, Math.max(0, Math.round((today.getTime() - start.getTime()) / dayMs))) : null;
    const daysLeft = finish ? Math.ceil((finish.getTime() - today.getTime()) / dayMs) : null;
    const periodProgress = totalDays && elapsed != null ? Math.round((elapsed / totalDays) * 100) : null;
    const waiting = notes.filter((note) => note.status === "submitted");
    const rejected = notes.filter((note) => note.status === "rejected");
    const openNote = (noteId: string) => {
      setProjectView("notes");
      void onOpenResearchNote(noteId);
    };

    return (
    <div className="project-dashboard-stack pd">
      <section className="card pd-header">
        <div className="pd-header-main">
          <div className="pd-title">
            <h2>{selectedProject?.name || "제목 없는 프로젝트"}</h2>
            {selectedProject && <span className={`pd-status status-${selectedProject.status}`}>{projectStatusLabel(selectedProject.status)}</span>}
          </div>
          <p className="pd-meta">
            <span>{selectedProject?.code || "코드 없음"}</span>
            <span>책임자 {getCompanyMemberName(selectedProject?.owner_member_id) || "미지정"}</span>
            <span>{formatProjectPeriod(selectedProject?.start_date ?? null, selectedProject?.end_date ?? null)}</span>
            <span>참여 {members.length}명</span>
          </p>
        </div>
        {canManageSelectedProject && (
          <button type="button" className="secondary-button compact-button" onClick={() => setShowProjectEditModal(true)}>
            프로젝트 편집
          </button>
        )}
      </section>

      <section className="pd-kpis">
        <article className="pd-kpi">
          <span>이번 달 노트</span>
          <strong>
            {notesThisMonth}
            {projectMonthlyGoal > 0 && <small> / {projectMonthlyGoal}</small>}
          </strong>
          {projectMonthlyGoal > 0 ? (
            <div className="pd-bar"><div style={{ width: `${monthlyGoalProgress}%` }} /></div>
          ) : (
            <em>월 목표를 정하면 달성률이 보입니다</em>
          )}
        </article>
        <button type="button" className={`pd-kpi pd-kpi-action${waiting.length ? " warn" : ""}`} onClick={() => setProjectView("notes")}>
          <span>결재 대기</span>
          <strong>{waiting.length}</strong>
          <em>{waiting.length ? "승인이 필요한 노트" : "대기 중인 노트 없음"}</em>
        </button>
        <button type="button" className={`pd-kpi pd-kpi-action${rejected.length ? " danger" : ""}`} onClick={() => setProjectView("notes")}>
          <span>반려됨</span>
          <strong>{rejected.length}</strong>
          <em>{rejected.length ? "작성자가 고쳐야 하는 노트" : "반려된 노트 없음"}</em>
        </button>
        <article className="pd-kpi">
          <span>연구 기간</span>
          <strong>
            {daysLeft == null ? "-" : daysLeft >= 0 ? `D-${daysLeft}` : `종료 ${-daysLeft}일 지남`}
          </strong>
          {periodProgress != null ? (
            <div className="pd-bar period"><div style={{ width: `${periodProgress}%` }} /></div>
          ) : (
            <em>기간을 정하면 진행률이 보입니다</em>
          )}
        </article>
      </section>

      {waiting.length > 0 && (
        <section className="card pd-waiting">
          <div className="pd-section-head">
            <h4>결재 대기 노트</h4>
            {waiting.length > 5 && (
              <button type="button" className="link-button" onClick={() => setProjectView("notes")}>
                전체 {waiting.length}건 보기
              </button>
            )}
          </div>
          <ul>
            {waiting.slice(0, 5).map((note) => (
              <li key={note.id}>
                <button type="button" onClick={() => openNote(note.id)}>
                  <strong>{note.title}</strong>
                  <span>
                    {getCompanyMemberName(note.owner_member_id) || "작성자 미상"} · {note.written_date ?? note.created_at.slice(0, 10)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {selectedProject && <NoteActivityPanel projectId={selectedProject.id} refreshKey={notes.length} />}
      {selectedProject && canManageSelectedProject && (
        <NoteAuditLog projectId={selectedProject.id} refreshKey={notes.length} />
      )}

      {showProjectEditModal && (
        <div className="modal-backdrop" onClick={() => setShowProjectEditModal(false)}>
          <section className="card note-modal project-edit-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <h3>프로젝트 편집</h3>
              <button type="button" className="secondary-button compact-button" onClick={() => setShowProjectEditModal(false)}>
                닫기
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
                프로젝트명
                <input value={projectNameDraft} onChange={(e) => setProjectNameDraft(e.target.value)} required disabled={!canManageSelectedProject} />
              </label>
              <label>
                프로젝트 코드
                <input value={projectCodeDraft} onChange={(e) => setProjectCodeDraft(e.target.value)} required disabled={!canManageSelectedProject} />
              </label>
              <label>
                책임 연구원
                <select
                  value={projectOwnerDraft}
                  onChange={(e) => setProjectOwnerDraft(e.target.value ? Number(e.target.value) : "")}
                  disabled={!canManageSelectedProject}
                >
                  <option value="">연구원 선택</option>
                  {companyMembers.map((member) => (
                    <option key={member.company_member_id} value={member.company_member_id}>
                      {member.name} ({roleLabel(member.role)})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                상태
                <select value={projectStatusDraft} onChange={(e) => setProjectStatusDraft(e.target.value)} disabled={!canManageSelectedProject}>
                  {projectStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                시작일
                <input type="date" value={projectStartDateDraft} onChange={(e) => setProjectStartDateDraft(e.target.value)} disabled={!canManageSelectedProject} />
              </label>
              <label>
                종료일
                <input type="date" value={projectEndDateDraft} onChange={(e) => setProjectEndDateDraft(e.target.value)} disabled={!canManageSelectedProject} />
              </label>
              <label>
                월간 노트 목표
                <input
                  type="number"
                  min="0"
                  value={projectMonthlyTargetDraft}
                  onChange={(e) => setProjectMonthlyTargetDraft(e.target.value)}
                  disabled={!canManageSelectedProject}
                />
              </label>
              <label className="project-dashboard-wide">
                설명
                <textarea
                  rows={5}
                  value={projectDescriptionDraft}
                  onChange={(e) => setProjectDescriptionDraft(e.target.value)}
                  disabled={!canManageSelectedProject}
                />
              </label>
              <div className="project-dashboard-actions">
                <button type="submit" className="compact-button" disabled={!canManageSelectedProject}>
                  프로젝트 저장
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
    );
  };

  const renderProjectMembers = () => (
    <div className="user-stack">
      {!canManageSelectedProject && (
        <section className="card page-intro">
          <p className="eyebrow">읽기 전용</p>
          <p className="context-copy">
            배정된 연구원을 볼 수 있지만, 참여 변경은 기관 관리자나 프로젝트 책임자만 할 수 있습니다.
          </p>
        </section>
      )}

      {selectedProject && <NoteActivityPanel projectId={selectedProject.id} refreshKey={notes.length + members.length} />}

      <section className="card">
        <div className="section-head note-section-head">
          <h4>프로젝트 연구원 추가</h4>
          <span>추가 가능 {availableProjectResearchers.length}명</span>
        </div>
        <form onSubmit={onAssignMember} className="form-inline">
          <select
            value={memberId}
            onChange={(e) => setMemberId(e.target.value ? Number(e.target.value) : "")}
            disabled={!canManageSelectedProject}
          >
            <option value="">기관 연구원 선택</option>
            {availableProjectResearchers.map((member) => (
              <option key={member.company_member_id} value={member.company_member_id}>
                {member.name} ({roleLabel(member.role)})
              </option>
            ))}
          </select>
          <select value={memberRole} onChange={(e) => setMemberRole(e.target.value)} disabled={!canManageSelectedProject} aria-label="프로젝트 역할">
            {PROJECT_ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            {!PROJECT_ROLE_OPTIONS.some((option) => option.value === memberRole) && <option value={memberRole}>{memberRole}</option>}
          </select>
          <button type="submit" className="compact-button" disabled={!canManageSelectedProject || memberId === ""}>
            연구원 추가
          </button>
        </form>
      </section>

      <section className="card">
        <div className="section-head note-section-head">
          <h4>현재 프로젝트 연구원</h4>
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
                    {member.email} / 프로젝트 역할: {isLead ? "책임자" : roleLabel(member.role)} / {member.is_active ? "활성" : "비활성"}
                    {" / "}
                    {companyMembers.find((item) => item.company_member_id === member.company_member_id)?.signature_data_url ? (
                      <b className="member-sign ok">서명 등록됨</b>
                    ) : (
                      <b className="member-sign missing">서명 미등록</b>
                    )}
                  </span>
                </div>
                {isLead ? (
                  <span className="project-pill">책임자</span>
                ) : (
                  canManageSelectedProject && (
                    <span className="member-actions">
                      <select
                        value={member.role}
                        aria-label={`${member.name} 역할`}
                        onChange={(event) => {
                          if (!selectedProject) return;
                          void assignProjectMember(selectedProject.id, member.company_member_id, event.target.value)
                            .then(() => getProjectMembers(selectedProject.id))
                            .then(setMembers)
                            .catch((err: Error) => setError(err.message));
                        }}
                      >
                        {PROJECT_ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                        {!PROJECT_ROLE_OPTIONS.some((option) => option.value === member.role) && (
                          <option value={member.role}>{roleLabel(member.role)}</option>
                        )}
                      </select>
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => {
                          if (!selectedProject || !window.confirm(`${member.name}님을 이 프로젝트 책임자로 지정할까요?`)) return;
                          void updateProject(selectedProject.id, { owner_member_id: member.company_member_id })
                            .then((updated) => {
                              warnIfLeadHasNoSignature(member.company_member_id, updated.name);
                              setSelectedProject(updated);
                              setProjects((items) => items.map((item) => (item.id === updated.id ? updated : item)));
                              // The previous lead becomes a regular member on the server; reload to show it.
                              return getProjectMembers(updated.id).then(setMembers);
                            })
                            .catch((err: Error) => setError(err.message));
                        }}
                      >
                        책임자로 지정
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => void onRemoveAssignedMember(member.company_member_id)}
                      >
                        제외
                      </button>
                    </span>
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
    if (noteCreateFiles && selectedProject) {
      return (
        <NoteCreatePage
          key={selectedProject.id}
          projectId={selectedProject.id}
          projectName={selectedProject.name}
          members={companyMembers.map((member) => ({ id: member.company_member_id, name: `${member.name} (${roleLabel(member.role)})` }))}
          defaultAuthorId={defaultNoteAuthorMemberId}
          defaultReviewerId={defaultNoteReviewerMemberId}
          today={todayIso}
          initialFiles={noteCreateFiles}
          currentUserId={currentUser.id}
          onCancel={() => setNoteCreateFiles(null)}
          onCreated={(noteId, message) => {
            setNoteCreateFiles(null);
            setNoteNotice(message);
            setSelectedNoteIds([]);
            // Opens the new note once the refreshed list contains it (not when a PDF made several).
            pendingSearchNoteId.current = noteId;
            // A note made while a bundle is open goes into that bundle.
            const openBundle = noteBundles.find((bundle) => bundle.id === bundleFilter);
            const projectId = selectedProject.id;
            void (async () => {
              if (openBundle && noteId) {
                await moveNotesToBundle(projectId, [noteId], openBundle.id).catch(() => undefined);
              }
              await refreshNotes(projectId);
            })();
          }}
        />
      );
    }
    if (bulkUploadFiles && selectedProject) {
      return (
        <BulkUploadEditor
          key={selectedProject.id}
          projectId={selectedProject.id}
          initialItems={bulkUploadFiles}
          members={companyMembers.map((member) => ({ id: member.company_member_id, name: member.name }))}
          defaultAuthorId={defaultNoteAuthorMemberId}
          defaultReviewerId={defaultNoteReviewerMemberId}
          currentUserId={currentUser.id}
          onClose={(createdAny) => {
            setBulkUploadFiles(null);
            if (createdAny) {
              setNoteNotice("여러 파일로 연구노트를 만들었습니다.");
              void refreshNotes(selectedProject.id);
            }
          }}
        />
      );
    }
    return (
      <div className="note-management-shell">
        {showBatchGenerator && selectedProject && <BatchNoteGenerator
          key={selectedProject.id} projectId={selectedProject.id} companyId={selectedProject.company_id}
          userId={currentUser.id} notes={notes} onClose={() => setShowBatchGenerator(false)}
          onRefresh={() => void refreshNotes(selectedProject.id)}
          onOpenNote={(id) => { setShowBatchGenerator(false); void onOpenResearchNote(id); }}
        />}
        {isBatchDownloading && (
          <section className="card page-intro">
            <p className="eyebrow">다운로드 진행률</p>
            <div className="download-progress">
              <div className="download-progress-head">
                <strong>선택한 연구노트를 합치는 중</strong>
                <span>{batchDownloadProgress == null ? "준비 중..." : `${batchDownloadProgress}%`}</span>
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
            <p className="eyebrow">알림</p>
            <p>{noteNotice}</p>
          </section>
        )}

        <section
          className={`note-upload-strip${isNoteFileDragging ? " dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setIsNoteFileDragging(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsNoteFileDragging(false);
          }}
          onDrop={(event) => void onResearchFileDrop(event)}
        >
          <input
            ref={noteUploadInputRef}
            type="file"
            accept="application/pdf,image/*"
            multiple
            className="hidden-input"
            onChange={(e) => {
              queueResearchFilesForNewNote(itemsFromFileList(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <input
            ref={noteFolderInputRef}
            type="file"
            multiple
            className="hidden-input"
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            onChange={(e) => {
              queueResearchFilesForNewNote(itemsFromFileList(e.target.files ?? []));
              e.target.value = "";
            }}
          />

          <div className="note-upload-strip-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4" />
              <path d="m6 10 6-6 6 6" />
              <path d="M4 20h16" />
            </svg>
          </div>
          <div className="note-upload-strip-text">
            <strong>{isNoteFileDragging ? "여기에 놓으면 새 연구노트를 만듭니다" : "파일로 새 연구노트 만들기"}</strong>
            <span>PDF·이미지나 폴더를 끌어다 놓으세요. 여러 개는 한 번에 정리해서 올리고, PDF는 여러 노트로 나눌 수 있습니다.</span>
          </div>
          <div className="note-upload-strip-actions">
            <button type="button" className="secondary-button compact-button" onClick={() => noteUploadInputRef.current?.click()}>
              파일 고르기
            </button>
            <button type="button" className="secondary-button compact-button" onClick={() => noteFolderInputRef.current?.click()}>
              폴더 올리기
            </button>
          </div>
        </section>

        <section className="card">
          <div className="section-head note-section-head">
            <h4>연구노트 목록</h4>
            <span>
              {visibleNotes.length}
              {totalNotePages > 1 ? ` / ${notesPage} / ${totalNotePages}페이지` : ""}
            </span>
          </div>
          {selectedProject && (
            <NoteBundleBar
              projectId={selectedProject.id}
              bundles={noteBundles}
              notes={notes}
              active={bundleFilter}
              onSelect={setBundleFilter}
              onChanged={(next) => {
                if (next) setBundleFilter(next);
                void refreshNotes(selectedProject.id);
              }}
            />
          )}
          {isNoteSelectionMode && noteBundles.length > 0 && (
            <div className="note-bundle-move">
              <span>선택한 노트 {selectedNoteIds.length}개를</span>
              <select
                value=""
                disabled={selectedNoteIds.length === 0}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) return;
                  void onMoveNotesToBundle(selectedNoteIds, value === "__none" ? null : value);
                }}
                aria-label="선택한 노트를 옮길 묶음"
              >
                <option value="">묶음으로 옮기기…</option>
                {noteBundles.map((bundle) => (
                  <option key={bundle.id} value={bundle.id}>
                    {bundle.name}
                  </option>
                ))}
                <option value="__none">묶음에서 빼기</option>
              </select>
            </div>
          )}
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
                        aria-label="이 페이지의 연구노트 모두 선택"
                      />
                    </th>
                  )}
                  <th className="note-no-col">No.</th>
                  <th>제목</th>
                  {noteBundles.length > 0 && <th>묶음</th>}
                  <th>레이아웃</th>
                  <th>상태</th>
                  <th>작성자</th>
                  <th>작성일</th>
                  <th>작업</th>
                </tr>
              </thead>
              <tbody>
                {visibleNotes.length === 0 && (
                  <tr>
                    <td colSpan={(isNoteSelectionMode ? 8 : 7) + (noteBundles.length > 0 ? 1 : 0)}>
                      {notes.length === 0 ? "아직 연구노트가 없습니다." : "이 묶음에는 아직 노트가 없습니다."}
                    </td>
                  </tr>
                )}
                {paginatedNotes.map((note, index) => (
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
                          aria-label={`${note.title} 선택`}
                        />
                      </td>
                    )}
                    {/* Newest first, numbered from the oldest note (No. 1). */}
                    <td className="note-no-col">{visibleNotes.length - ((notesPage - 1) * notesPerPage + index)}</td>
                    <td>{note.title}</td>
                    {noteBundles.length > 0 && (
                      <td onClick={(event) => event.stopPropagation()}>
                        <select
                          className="note-bundle-select"
                          value={note.bundle_id ?? ""}
                          onChange={(event) => void onMoveNotesToBundle([note.id], event.target.value || null)}
                          aria-label={`${note.title} 묶음`}
                        >
                          <option value="">—</option>
                          {noteBundles.map((bundle) => (
                            <option key={bundle.id} value={bundle.id}>
                              {bundle.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    )}
                    <td>{noteLayoutStatus[note.id] ? "저장됨" : "자동"}</td>
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
                        삭제
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
                이전
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
                다음
              </button>
            </div>
          )}
        </section>

        {openedResearchNoteId && selectedNote && (
          <div className="modal-backdrop" onClick={onBackToResearchNoteList}>
            <section className="card note-workspace-modal" onClick={(event) => event.stopPropagation()}>
              <div className="nw-head">
                <div className="nw-title">
                  <p className="eyebrow">연구노트 작업 공간</p>
                  <h3>{selectedNote.title}</h3>
                  <div className="nw-meta">
                    <span className={`note-status-badge status-${selectedNote.status}`}>{selectedNoteStatusLabel}</span>
                    <span>작성자 {getCompanyMemberName(selectedNote.owner_member_id) || "-"}</span>
                    <span>검토자 {getCompanyMemberName(selectedNote.reviewer_member_id) || "미지정"}</span>
                    <span>리비전 {activeNoteDocument?.current_revision_no ?? "-"}</span>
                  </div>
                </div>
                <div className="note-file-actions">
                  <button type="button" className="secondary-button compact-button" onClick={onBackToResearchNoteList}>
                    닫기
                  </button>
                  <button type="button" className="compact-button" onClick={openEditNoteModal} disabled={selectedNoteIsLocked}>
                    노트 편집
                  </button>
                </div>
              </div>

              <div className="note-main-stack">
                <AiReviewBanner
                  noteId={selectedNote.id}
                  noteStatus={selectedNote.status}
                  canConfirm={canManageSelectedProject || selectedNoteIsAuthor}
                  onChange={setAiReview}
                />
                <section className="nw-approval" aria-label="결재">
                  <input
                    className="nw-comment"
                    value={approvalComment}
                    onChange={(event) => setApprovalComment(event.target.value)}
                    placeholder="의견 (반려·재개할 때는 꼭 적어 주세요)"
                    maxLength={500}
                  />
                  <div className="nw-buttons">
                    <button
                      type="button"
                      className="secondary-button compact-button"
                      onClick={() => void runSelectedNoteApprovalAction("submit")}
                      disabled={!canSubmitSelectedNote}
                      title={aiReview?.required && !aiReview.reviewed ? "AI 작성 내용을 검토 완료해야 제출할 수 있습니다" : undefined}
                    >
                      제출
                    </button>
                    <button type="button" className="compact-button" onClick={() => void runSelectedNoteApprovalAction("approve")} disabled={!canReviewSelectedNote}>
                      승인
                    </button>
                    <button type="button" className="secondary-button compact-button danger-text" onClick={() => void runSelectedNoteApprovalAction("reject")} disabled={!canReviewSelectedNote}>
                      반려
                    </button>
                    <button type="button" className="secondary-button compact-button" onClick={() => void runSelectedNoteApprovalAction("reopen")} disabled={!canReopenSelectedNote}>
                      재개
                    </button>
                  </div>
                </section>

                <div className="nw-tabs" role="tablist">
                  <button type="button" role="tab" aria-selected={noteWorkspaceTab === "editor"} className={noteWorkspaceTab === "editor" ? "active" : ""} onClick={() => setNoteWorkspaceTab("editor")}>
                    문서 편집기
                  </button>
                  <button type="button" role="tab" aria-selected={noteWorkspaceTab === "history"} className={noteWorkspaceTab === "history" ? "active" : ""} onClick={() => setNoteWorkspaceTab("history")}>
                    결재·변경 이력
                    {approvalEvents.length > 0 && <span className="nw-count">{approvalEvents.length}</span>}
                  </button>
                </div>

                {noteWorkspaceTab === "history" && (
                  <div className="nw-history">
                    <section className="nw-events">
                      <h4>결재 이력</h4>
                      {approvalEvents.length === 0 ? (
                        <p className="nw-empty">아직 결재 이력이 없습니다.</p>
                      ) : (
                        <ol>
                          {approvalEvents.map((event) => (
                            <li key={event.id}>
                              <strong>{approvalEventLabels[event.event_type] ?? event.event_type}</strong>
                              <span>
                                {getCompanyMemberName(event.actor_member_id)} · {new Date(event.created_at).toLocaleString()}
                              </span>
                              {event.comment && <p>{event.comment}</p>}
                            </li>
                          ))}
                        </ol>
                      )}
                    </section>
                    <NoteAuditLog noteId={selectedNote.id} refreshKey={`${selectedNote.updated_at ?? ""}${approvalEvents.length}`} />
                  </div>
                )}

                {/* Stays mounted (only hidden) so unsaved edits survive a visit to the history tab. */}
                <div hidden={noteWorkspaceTab !== "editor"}>
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
                  onEditNoteDetails={openEditNoteModal}
                  noteFormat={noteFormat}
                  isLocked={selectedNoteIsLocked}
                  lockMessage={`${selectedNoteStatusLabel} 상태의 연구노트는 편집할 수 없습니다.`}
                />
                </div>
              </div>
            </section>
          </div>
        )}

        {showNoteModal && (
          <div className="modal-backdrop" onClick={() => setShowNoteModal(false)}>
            <section className="card note-modal" onClick={(event) => event.stopPropagation()}>
              <div className="section-head">
                <h3>{noteModalMode === "edit" ? "연구노트 편집" : "연구노트 만들기"}</h3>
                <button type="button" className="secondary-button compact-button" onClick={() => setShowNoteModal(false)}>
                  닫기
                </button>
              </div>
              <form onSubmit={noteModalMode === "edit" ? onSaveNote : onCreateNote} className="form-stack">
                <label>
                  제목
                  <input value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} required />
                </label>
                <label>
                  작성자
                  <select
                    value={noteOwnerMemberId}
                    onChange={(e) => setNoteOwnerMemberId(e.target.value ? Number(e.target.value) : "")}
                  >
                    <option value="">연구원 선택</option>
                    {companyMembers.map((member) => (
                      <option key={member.company_member_id} value={member.company_member_id}>
                        {member.name} ({roleLabel(member.role)})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  작성일
                  <input type="date" value={noteWrittenDate} onChange={(e) => setNoteWrittenDate(e.target.value)} />
                </label>
                <label>
                  검토자
                  <select
                    value={noteReviewerMemberId}
                    onChange={(e) => setNoteReviewerMemberId(e.target.value ? Number(e.target.value) : "")}
                  >
                    <option value="">연구원 선택</option>
                    {companyMembers.map((member) => (
                      <option key={member.company_member_id} value={member.company_member_id}>
                        {member.name} ({roleLabel(member.role)})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  검토일
                  <input type="date" value={noteReviewedDate} onChange={(e) => setNoteReviewedDate(e.target.value)} />
                </label>
                  {noteModalMode === "create" && (
                  <>
                    <div className="section-head">
                      <h4>파일 첨부</h4>
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => noteCreateUploadInputRef.current?.click()}
                      >
                        파일 선택
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
                          ? `첨부할 파일 ${pendingNoteFiles.length}개`
                          : "새 연구노트에 첨부할 파일을 여기에 놓으세요."}
                      </strong>
                      <span>
                        {pendingNoteFiles.length > 0
                          ? pendingNoteFiles.map((file) => file.name).join(", ")
                          : "파일을 여기로 끌어다 놓거나 직접 선택하세요."}
                      </span>
                    </button>
                  </>
                )}
                <button type="submit">{noteModalMode === "edit" ? "노트 저장" : "노트 만들기"}</button>
              </form>
            </section>
          </div>
        )}
      </div>
    );
  };

  const renderProjectCover = () => {
    const managerName = getCompanyMemberName(selectedProject?.owner_member_id);
    const companyName = researcherManagement?.company.name ?? "LABNOTE";
    return (
      <CoverTemplateSettings
        template={coverTemplate}
        saved={parseCoverTemplate(projectCover?.template_payload ?? null, selectedProject, managerName, companyName)}
        defaults={buildDefaultCoverTemplate(selectedProject, managerName, companyName)}
        previewUrl={coverPreviewImageUrl}
        tocPreviewUrl={tocPreviewImageUrl}
        onChange={setCoverTemplate}
        onSave={() => onSaveProjectCover()}
      />
    );
  };

  const renderProjects = () => (
    <div className="user-stack">
      {showCreateProjectForm && (
        <section className="card project-create-panel">
          <div className="section-head">
            <h3>프로젝트 만들기</h3>
            <span>프로젝트는 현재 기관 안에 자동으로 만들어집니다.</span>
          </div>
          <form onSubmit={onCreateProject} className="project-create-form">
            <label>
              프로젝트명
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>
            <label>
              책임 연구원
              <select value={ownerMemberId} onChange={(e) => setOwnerMemberId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">연구원 선택</option>
                {companyMembers.map((member) => (
                  <option key={member.company_member_id} value={member.company_member_id}>
                    {member.name} ({roleLabel(member.role)})
                  </option>
                ))}
              </select>
            </label>
            <label>
              과제번호
              <input value={code} onChange={(e) => setCode(e.target.value)} required />
            </label>
            <label>
              시작일
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label>
              종료일
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
            <label>
              월간 노트 목표
              <input type="number" min="0" value={monthlyNoteTarget} onChange={(e) => setMonthlyNoteTarget(e.target.value)} />
            </label>
            <label className="project-create-wide">
              설명
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
            </label>
            <div className="project-create-actions">
              <button type="submit" className="compact-button">
                프로젝트 저장
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card project-list-card">
        <div className="section-head project-list-head">
          <h3>
            전체 프로젝트 <span className="project-list-count">{projects.length}</span>
          </h3>
          <button type="button" className="compact-button" onClick={() => setShowCreateProjectForm((open) => !open)}>
            {showCreateProjectForm ? "만들기 닫기" : "+ 프로젝트 만들기"}
          </button>
        </div>
        {projects.length === 0 ? (
          <div className="project-list-empty">아직 프로젝트가 없습니다. ‘프로젝트 만들기’로 첫 프로젝트를 만드세요.</div>
        ) : (
          <div className="project-card-grid">
            {projects.map((project) => (
              <button
                key={project.id}
                type="button"
                className={`project-card${selectedProject?.id === project.id ? " selected" : ""}`}
                onClick={() => void onOpenProjectPage(project)}
              >
                <div className="project-card-main">
                  <strong>{project.name}</strong>
                  <span className="project-card-desc">{project.description?.trim() || "설명 없음"}</span>
                </div>
                <dl className="project-meta">
                  <dt>책임자</dt>
                  <dd>{getCompanyMemberName(project.owner_member_id) || "-"}</dd>
                  <dt>과제번호</dt>
                  <dd>{project.code}</dd>
                  <dt>연구 기간</dt>
                  <dd>{formatProjectPeriod(project.start_date, project.end_date)}</dd>
                </dl>
                <div className="project-card-footer">
                  <span className={`project-status-pill status-${project.status}`}>{projectStatusLabel(project.status)}</span>
                  <span className="project-card-chevron" aria-hidden="true">
                    ›
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );

  const renderProfile = () => (
    <div className="user-stack">
      <section className="card feature-card">
        <p className="eyebrow">프로필</p>
        <h2>개인 정보</h2>
        <p className="context-copy">계정 정보를 관리하고 결재에 쓸 서명을 등록하세요.</p>
      </section>

      <section className="profile-grid">
        <article className="card">
          <div className="section-head">
            <h3>계정</h3>
          </div>
          <div className="feature-list profile-summary">
            <div>
              <strong>이름</strong>
              <span>{currentUser.name}</span>
            </div>
            <div>
              <strong>아이디</strong>
              <span>{currentUser.username}</span>
            </div>
            <div>
              <strong>이메일</strong>
              <span>{currentUser.email}</span>
            </div>
            <div>
              <strong>상태</strong>
              <span>{currentUser.approval_status}</span>
            </div>
          </div>
        </article>

        <article className="card">
          <div className="section-head">
            <h3>서명</h3>
            <button
              type="button"
              className="secondary-button compact-button"
              onClick={() => signatureInputRef.current?.click()}
              disabled={isSavingSignature}
            >
              이미지 선택
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
              <img src={signaturePreview} alt="서명 미리보기" className="signature-preview-image" />
            ) : (
              <div className="signature-dropzone-copy">
                <strong>서명 이미지를 여기에 놓으세요</strong>
                <span>서명 이미지를 끌어다 놓거나 클릭해서 업로드하세요.</span>
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
              서명 삭제
            </button>
          </div>

          <div className="signature-version-list">
            {signatureVersions.length === 0 ? (
              <div className="plain-list-item">
                <strong>저장된 서명 없음</strong>
                <span>서명 이미지를 올리면 결재에 사용할 수 있습니다.</span>
              </div>
            ) : (
              signatureVersions.map((signature) => (
                <div key={signature.id} className="signature-version-item">
                  <img
                    src={getBackendAssetUrl(`/storage/${signature.image_storage_key}`)}
                    alt={`서명 ${signature.id}`}
                  />
                  <div>
                    <strong>
                      Signature #{signature.id}
                      {signature.status === "active" && <span className="signature-active-badge">활성</span>}
                    </strong>
                    <span>
                      {new Date(signature.created_at).toLocaleString()}
                      {signature.revoked_at ? ` / 폐기 ${new Date(signature.revoked_at).toLocaleString()}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    onClick={() => void onRevokeSignature(signature.id)}
                    disabled={signature.status === "revoked"}
                  >
                    폐기
                  </button>
                </div>
              ))
            )}
          </div>

          {profileNotice && <p className="profile-notice">{profileNotice}</p>}
        </article>

        <PasswordChangeCard />
      </section>
    </div>
  );

  const renderResearcherManagement = () => {
    if (!currentUser.is_org_owner) {
      return renderPlaceholder(
        "연구원 관리",
        "기관 관리자만 연구원을 초대할 수 있습니다."
      );
    }
    const hasResearcherCompany = Boolean(currentUser.organization_id && researcherManagement);

    return (
      <div className="user-stack">
        {!hasResearcherCompany && (
          <section className="card page-intro">
            <p className="eyebrow">알림</p>
            <p className="error">
              이 관리자 계정은 아직 활성 기관에 연결되지 않았습니다. 관리자 가입 승인을 마치거나 승인된 기관 관리자 계정으로 로그인하세요.
            </p>
          </section>
        )}

        <ResearcherRegistration
          companyName={researcherManagement?.company.name ?? ""}
          companyCode={researcherManagement?.company.code ?? ""}
          pendingRequests={researcherManagement?.pending_requests ?? []}
          disabled={!hasResearcherCompany}
          onChanged={async () => {
            await Promise.all([refreshResearcherManagement(), refreshCompanyMembers()]);
          }}
        />

        <section className="card">
          <div className="section-head">
            <h3>현재 연구원</h3>
            <span>{organizationResearchers.length}</span>
          </div>
          <ul className="list">
            {organizationResearchers.map((member) => (
              <li key={member.company_member_id} className="plain-list-item researcher-row">
                <div>
                  <strong>{member.name}</strong>
                  <span>
                    {member.email} / {roleLabel(member.role)} / {member.is_active ? "활성" : "비활성"}
                  </span>
                </div>
                {member.role === "owner" ? (
                  <span className="project-pill">관리자</span>
                ) : (
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    onClick={() => void onRemoveCompanyResearcher(member.company_member_id)}
                  >
                    제외
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  };

  const renderSignatureAlerts = () => (
    <>
      {needsOwnSignature && !signatureReminderHidden && activeSection !== "profile" && (
        <section className="signature-alert" role="alert">
          <div>
            <strong>서명이 등록되지 않았습니다</strong>
            <p>
              {myLedProjects.length > 0
                ? `${myLedProjects[0].name}${myLedProjects.length > 1 ? ` 외 ${myLedProjects.length - 1}개` : ""} 프로젝트의 책임자로 지정되어 있습니다. `
                : ""}
              {myReviewWaiting.length > 0 ? `내 결재를 기다리는 노트가 ${myReviewWaiting.length}건 있습니다. ` : ""}
              연구노트를 승인하면 서명이 들어가니 먼저 서명을 등록하세요.
            </p>
          </div>
          <div className="signature-alert-actions">
            <button
              type="button"
              className="compact-button"
              onClick={() => {
                setOpenedProjectId(null);
                setActiveSection("profile");
              }}
            >
              서명 등록하러 가기
            </button>
            <button
              type="button"
              className="secondary-button compact-button"
              onClick={() => {
                setSignatureReminderHidden(true);
                try {
                  window.sessionStorage.setItem("labnote.signatureReminderHidden", "1");
                } catch {
                  // Without storage the reminder simply comes back on the next load.
                }
              }}
            >
              나중에
            </button>
          </div>
        </section>
      )}
      {leadSignatureNotice && (
        <section className="signature-alert info" role="status">
          <div>
            <strong>책임자 서명 확인 필요</strong>
            <p>{leadSignatureNotice}</p>
          </div>
          <div className="signature-alert-actions">
            <button type="button" className="secondary-button compact-button" onClick={() => setLeadSignatureNotice(null)}>
              확인
            </button>
          </div>
        </section>
      )}
    </>
  );

  const renderProjectDetailPage = () => (
    <div className={`portal-app${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
        <aside className="portal-sidebar">
          <div className="sidebar-toggle-row">
            <SidebarToggle collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
          </div>
          <div className="project-context-card">
            <span className="project-context-label">프로젝트</span>
            <strong>{selectedProject?.name}</strong>
            <p>{selectedProject?.code || "프로젝트 코드 없음"}</p>
            <button type="button" className="sidebar-back-button" onClick={onBackToProjects}>
              ← 프로젝트 목록
            </button>
          </div>
          <SidebarUploadButton
            collapsed={sidebarCollapsed}
            onItems={(items) => {
              if (items.length === 0) return;
              setProjectView("notes");
              queueResearchFilesForNewNote(items);
            }}
          />
          <nav className="user-nav project-nav">
          <button
            type="button"
            className="user-nav-item sidebar-back-icon"
            onClick={onBackToProjects}
            title="프로젝트 목록으로"
          >
            <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
            <strong>프로젝트 목록</strong>
          </button>
          {(
            [
              ["dashboard", "프로젝트 대시보드"],
              ["members", "연구원 관리"],
              ["notes", "연구노트"],
              ["review", "노트 검토"],
              ["data", "데이터 보관함"],
              ["imaging", "이미지 처리"],
              ["ai", "AI 생성"],
              ["github", "GitHub"],
              ["cover", "표지 템플릿"],
            ] as const
          ).map(([view, label]) => (
            <button
              key={view}
              type="button"
              className={`user-nav-item${projectView === view ? " active" : ""}${view === "review" ? " user-nav-sub" : ""}`}
              onClick={() => setProjectView(view)}
              title={sidebarCollapsed ? label : undefined}
            >
              <SidebarIcon name={view} />
              <strong>{label}</strong>
            </button>
          ))}
        </nav>
      </aside>

        <main className="portal-main">
          <div className="user-content user-content-full">
            {renderSignatureAlerts()}
            <section className="card project-workspace-content project-workspace-content-standalone">
              {projectView !== "dashboard" && (
                <div className="section-head project-section-head">
                  <div>
                    <p className="eyebrow">프로젝트 작업 공간</p>
                    <h3>{projectViewMeta[projectView].title}</h3>
                    <p className="context-copy">{projectViewMeta[projectView].description}</p>
                  </div>
                  {projectView === "notes" && !bulkUploadFiles && !noteCreateFiles && (
                    <div className="note-file-actions">
                      <button type="button" className="compact-button" onClick={() => openCreateNoteModal()}>
                        노트 추가
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => void onDownloadSelectedNotes()}
                        disabled={isBatchDownloading || notes.length === 0}
                      >
                        {isBatchDownloading
                          ? "다운로드 중..."
                          : isNoteSelectionMode
                            ? `선택 다운로드${selectedNoteIds.length > 0 ? ` (${selectedNoteIds.length})` : ""}`
                            : "다운로드할 노트 선택"}
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
                          선택 취소
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {projectView === "dashboard" && renderProjectDashboard()}
              {projectView === "members" && renderProjectMembers()}
              {projectView === "notes" && renderProjectNotes()}
              {projectView === "data" && selectedProject && (
                <DataStorage
                  key={selectedProject.id}
                  projectId={selectedProject.id}
                  onMakeNotes={(items) => {
                    setBulkUploadFiles(items);
                    setProjectView("notes");
                  }}
                  onSendToAi={(files) => {
                    setAiSeedDocuments({ files, token: Date.now() });
                    setProjectView("ai");
                  }}
                />
              )}
              {projectView === "review" && selectedProject && (
                <NoteReviewPage
                  key={selectedProject.id}
                  projectId={selectedProject.id}
                  onOpenNote={(noteId) => {
                    setProjectView("notes");
                    void onOpenResearchNote(noteId);
                  }}
                  onChanged={() => void refreshNotes(selectedProject.id)}
                />
              )}
              {projectView === "imaging" && <ImageLab />}
              {projectView === "ai" && selectedProject && (
                <ProjectAiGenerator
                  initialDocuments={aiSeedDocuments}
                  key={selectedProject.id}
                  projectId={selectedProject.id}
                  companyId={selectedProject.company_id}
                  notes={notes}
                  onOpenNote={(noteId) => {
                    setProjectView("notes");
                    pendingSearchNoteId.current = noteId;
                    void refreshNotes(selectedProject.id);
                  }}
                  onNotesChanged={() => void refreshNotes(selectedProject.id)}
                  onOpenManualBulk={() => {
                    setProjectView("notes");
                    setShowBatchGenerator(true);
                  }}
                />
              )}
              {projectView === "github" && selectedProject && (
                <ProjectGitHubPanel
                  projectId={selectedProject.id}
                  members={(members.length > 0 ? members : []).map((member) => ({ id: member.company_member_id, name: member.name }))}
                  defaultAuthorId={typeof defaultNoteAuthorMemberId === "number" ? defaultNoteAuthorMemberId : null}
                  defaultReviewerId={selectedProject.owner_member_id ?? null}
                  onOpenAccountSettings={() => {
                    setOpenedProjectId(null);
                    setActiveSection("github");
                  }}
                  onOpenNote={(noteId) => {
                    setProjectView("notes");
                    pendingSearchNoteId.current = noteId;
                    void refreshNotes(selectedProject.id);
                  }}
                  onNotesChanged={() => void refreshNotes(selectedProject.id)}
                />
              )}
              {projectView === "cover" && renderProjectCover()}
            </section>
          </div>
      </main>
    </div>
  );

  const renderPlaceholder = (title: string, copy: string) => (
    <section className="card feature-card">
      <p className="eyebrow">작업 공간 기능</p>
      <h2>준비 중</h2>
      <p>{copy}</p>
    </section>
  );

  const renderCompanyAccessGate = () => (
    <section className="auth-shell">
      <div className="auth-card">
        <p className="eyebrow">기관 가입</p>
        <h2>기관 가입 요청</h2>
        <p className="auth-copy">
          이 계정은 아직 기관에 연결되지 않았습니다. 초대나 승인을 받기 전까지는 가입 요청 화면만 쓸 수 있습니다.
        </p>

        <form onSubmit={onRequestCompanyAccess} className="form-stack">
          <label>
            기관명
            <input
              value={companyAccessName}
              onChange={(e) => setCompanyAccessName(e.target.value)}
              required
              disabled={companyAccessRequest !== null}
            />
          </label>
          <label>
            기관 코드
            <input
              value={companyAccessCode}
              onChange={(e) => setCompanyAccessCode(e.target.value.toUpperCase())}
              required
              disabled={companyAccessRequest !== null}
            />
          </label>
          <button type="submit" disabled={companyAccessRequest !== null}>가입 요청</button>
        </form>

        {companyAccessRequest && (
          <section className="card inset-card">
            <p className="eyebrow">대기 중인 요청</p>
            <h3>{companyAccessRequest.company_name}</h3>
            <p className="context-copy">
              기관 코드: {companyAccessRequest.company_code} / 상태: {({ pending: "대기", approved: "승인됨", rejected: "반려됨" } as Record<string, string>)[companyAccessRequest.status] ?? companyAccessRequest.status}
            </p>
          </section>
        )}

        {companyAccessNotice && <p>{companyAccessNotice}</p>}
        {error && <p className="error">오류: {error}</p>}
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
    <div className={`portal-app${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="portal-sidebar">
        <div className="sidebar-toggle-row">
          <SidebarToggle collapsed={sidebarCollapsed} onToggle={toggleSidebar} />
        </div>
        <nav className="user-nav">
          {sectionMeta.map((section) => {
            if (section.id === "projects") {
              return (
                <button
                  key={section.id}
                  className={`user-nav-item${activeSection === section.id ? " active" : ""}`}
                  onClick={() => setActiveSection("projects")}
                  type="button"
                  title={sidebarCollapsed ? section.title : undefined}
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
                title={sidebarCollapsed ? section.title : undefined}
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
        {renderSignatureAlerts()}
        {showPageIntro && (
          <section className="card page-intro">
            <p className="eyebrow">{activeMeta.title}</p>
            <p>{activeMeta.description}</p>
            {error && <p className="error">오류: {error}</p>}
          </section>
        )}
        {!showPageIntro && error && (
          <section className="card page-intro">
            <p className="eyebrow">알림</p>
            <p className="error">오류: {error}</p>
          </section>
        )}

        {activeSection === "home" && renderHome()}
        {activeSection === "projects" && renderProjects()}
        {activeSection === "researchers" && renderResearcherManagement()}
        {activeSection === "format" && (
          <NoteFormatSettings info={noteFormatInfo} loadError={noteFormatError} onSave={onSaveNoteFormat} onDelete={onDeleteNoteFormat} />
        )}
        {activeSection === "github" && (
          <GitHubAccountSettings
            onOpenProjectGitHub={(projectId) => {
              const project = projects.find((item) => item.id === projectId);
              if (!project) return;
              void (async () => {
                await onOpenProjectPage(project);
                setProjectView("github");
              })();
            }}
          />
        )}
        {activeSection === "platforms" && <LlmConnectionSettings
          companyId={currentUser.organization_id ?? undefined}
          onSaved={() => { void getNoteGenerationStatus().then(setLlmStatus).catch(() => setLlmStatus(null)); }}
        />}
        {activeSection === "profile" && renderProfile()}
        </div>
      </main>
    </div>
  );
}
