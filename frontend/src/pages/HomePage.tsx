import { FormEvent, useEffect, useState } from "react";

import {
  assignProjectMember,
  createProject,
  getProjectMembers,
  listProjects,
  type Project,
  type ProjectMember,
} from "../api/project";
import {
  createResearchNote,
  getResearchNote,
  listResearchNotes,
  updateResearchNote,
  type ResearchNote,
} from "../api/researchNote";

export function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [members, setMembers] = useState<ProjectMember[]>([]);

  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [selectedNote, setSelectedNote] = useState<ResearchNote | null>(null);

  const [error, setError] = useState<string | null>(null);

  const [companyId, setCompanyId] = useState(1);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");

  const [memberId, setMemberId] = useState(1);
  const [memberRole, setMemberRole] = useState("member");

  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteOwnerMemberId, setNoteOwnerMemberId] = useState(1);

  const refreshProjects = async () => {
    try {
      const data = await listProjects();
      setProjects(data);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const refreshNotes = async (projectId: string) => {
    try {
      const data = await listResearchNotes(projectId);
      setNotes(data);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    void refreshProjects();
  }, []);

  const onCreateProject = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      await createProject({
        company_id: companyId,
        name,
        code,
        description,
      });
      setName("");
      setCode("");
      setDescription("");
      await refreshProjects();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onSelectProject = async (project: Project) => {
    setSelectedProject(project);
    setSelectedNote(null);
    try {
      const [memberData] = await Promise.all([getProjectMembers(project.id), refreshNotes(project.id)]);
      setMembers(memberData);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onAssignMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProject) return;

    try {
      await assignProjectMember(selectedProject.id, memberId, memberRole);
      const data = await getProjectMembers(selectedProject.id);
      setMembers(data);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onCreateNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProject) return;

    try {
      await createResearchNote({
        project_id: selectedProject.id,
        title: noteTitle,
        content: noteContent,
        owner_member_id: noteOwnerMemberId,
        last_updated_by: noteOwnerMemberId,
      });
      setNoteTitle("");
      setNoteContent("");
      await refreshNotes(selectedProject.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onSelectNote = async (noteId: string) => {
    try {
      const detail = await getResearchNote(noteId);
      setSelectedNote(detail);
      setNoteTitle(detail.title);
      setNoteContent(detail.content ?? "");
      setNoteOwnerMemberId(detail.owner_member_id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const onSaveNote = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedNote || !selectedProject) return;

    try {
      const updated = await updateResearchNote(selectedNote.id, {
        title: noteTitle,
        content: noteContent,
        last_updated_by: noteOwnerMemberId,
      });
      setSelectedNote(updated);
      await refreshNotes(selectedProject.id);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="grid-2">
      <section className="card">
        <h2>프로젝트 생성</h2>
        <form onSubmit={onCreateProject} className="form-stack">
          <label>
            Company ID
            <input type="number" value={companyId} onChange={(e) => setCompanyId(Number(e.target.value))} />
          </label>
          <label>
            프로젝트명
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            프로젝트 코드
            <input value={code} onChange={(e) => setCode(e.target.value)} required />
          </label>
          <label>
            설명
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <button type="submit">생성</button>
        </form>

        <h2>프로젝트 목록</h2>
        <ul className="list">
          {projects.map((project) => (
            <li key={project.id}>
              <button className="list-item" onClick={() => void onSelectProject(project)}>
                <strong>{project.name}</strong>
                <span>{project.code}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>연구노트 관리</h2>
        {!selectedProject && <p>프로젝트를 선택하면 연구노트를 관리할 수 있습니다.</p>}
        {selectedProject && (
          <>
            <p>
              현재 프로젝트: <strong>{selectedProject.name}</strong>
            </p>

            <div className="split">
              <div>
                <h3>연구노트 목록</h3>
                <ul className="list">
                  {notes.map((note) => (
                    <li key={note.id}>
                      <button className="list-item" onClick={() => void onSelectNote(note.id)}>
                        <strong>{note.title}</strong>
                        <span>{note.status}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3>{selectedNote ? "연구노트 상세/수정" : "연구노트 생성"}</h3>
                <form onSubmit={selectedNote ? onSaveNote : onCreateNote} className="form-stack">
                  <label>
                    제목
                    <input value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} required />
                  </label>
                  <label>
                    작성자 멤버 ID
                    <input
                      type="number"
                      value={noteOwnerMemberId}
                      onChange={(e) => setNoteOwnerMemberId(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    본문
                    <textarea
                      rows={10}
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      placeholder="연구노트 본문을 입력하세요"
                    />
                  </label>
                  <button type="submit">{selectedNote ? "저장" : "생성"}</button>
                </form>
              </div>
            </div>

            <h3>프로젝트 멤버</h3>
            <form onSubmit={onAssignMember} className="form-inline">
              <input type="number" value={memberId} onChange={(e) => setMemberId(Number(e.target.value))} />
              <input value={memberRole} onChange={(e) => setMemberRole(e.target.value)} />
              <button type="submit">추가/변경</button>
            </form>
            <ul className="list">
              {members.map((member) => (
                <li key={member.id}>
                  #{member.company_member_id} - {member.role}
                </li>
              ))}
            </ul>
          </>
        )}
        {error && <p className="error">오류: {error}</p>}
      </section>
    </div>
  );
}
