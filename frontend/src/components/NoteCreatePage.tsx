import { DragEvent, FormEvent, useRef, useState } from "react";

import { uploadNoteFile } from "../api/file";
import { createResearchNote, splitPdfIntoNotes } from "../api/researchNote";

type Member = { id: number; name: string; role?: string };

type Props = {
  projectId: string;
  projectName: string;
  members: Member[];
  defaultAuthorId: number | "";
  defaultReviewerId: number | "";
  today: string;
  initialFiles?: File[];
  currentUserId: number;
  onCancel: () => void;
  /** Called after the note(s) exist; the parent opens the note, or just the list when several were made. */
  onCreated: (noteId: string | null, message: string) => void;
};

const ACCEPTED = /\.(pdf|png|jpe?g|webp)$/i;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** Full-page "new research note" form: details on the left, attachments on the right. */
export function NoteCreatePage({
  projectId,
  projectName,
  members,
  defaultAuthorId,
  defaultReviewerId,
  today,
  initialFiles = [],
  currentUserId,
  onCancel,
  onCreated,
}: Props) {
  const [title, setTitle] = useState(() =>
    initialFiles.length === 1 ? initialFiles[0].name.replace(/\.[^.]+$/, "") : ""
  );
  const [authorId, setAuthorId] = useState<number | "">(defaultAuthorId);
  const [writtenDate, setWrittenDate] = useState(today);
  const [reviewerId, setReviewerId] = useState<number | "">(defaultReviewerId);
  const [reviewedDate, setReviewedDate] = useState(today);
  const [files, setFiles] = useState<File[]>(initialFiles);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Splitting applies when exactly one PDF is attached: "one" keeps it in a single note.
  const [splitMode, setSplitMode] = useState<"one" | "each" | "group">("one");
  const [pagesPerNote, setPagesPerNote] = useState(2);
  const singlePdf = files.length === 1 && (/\.pdf$/i.test(files[0].name) || files[0].type === "application/pdf") ? files[0] : null;
  const splitting = Boolean(singlePdf) && splitMode !== "one";

  const addFiles = (incoming: File[]) => {
    const ok = incoming.filter((file) => ACCEPTED.test(file.name) || /^(image\/|application\/pdf)/.test(file.type));
    setSkipped(incoming.filter((file) => !ok.includes(file)).map((file) => file.name));
    setFiles((current) => {
      const known = new Set(current.map((file) => `${file.name}:${file.size}`));
      return [...current, ...ok.filter((file) => !known.has(`${file.name}:${file.size}`))];
    });
    if (!title.trim() && ok.length === 1) setTitle(ok[0].name.replace(/\.[^.]+$/, ""));
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files ?? []));
  };

  const missing = !title.trim() ? "제목을 입력하세요." : authorId === "" ? "작성자를 고르세요." : null;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (missing) {
      setError(missing);
      return;
    }
    setBusy(true);
    setError(null);
    let noteId: string | null = null;
    if (splitting && singlePdf) {
      try {
        setProgress("PDF를 나눠 연구노트를 만드는 중... 페이지가 많으면 조금 걸립니다.");
        const result = await splitPdfIntoNotes({
          projectId,
          file: singlePdf,
          pagesPerNote: splitMode === "each" ? 1 : Math.max(1, pagesPerNote),
          title: title.trim(),
          ownerMemberId: authorId as number,
          reviewerMemberId: reviewerId === "" ? null : reviewerId,
          writtenDate: writtenDate || undefined,
          reviewedDate: reviewedDate || undefined,
        });
        const count = result.notes.length;
        onCreated(count === 1 ? result.notes[0].id : null, `PDF를 나눠 연구노트 ${count}개를 만들었습니다.`);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
        setProgress(null);
      }
      return;
    }
    try {
      setProgress("연구노트를 만드는 중...");
      const created = await createResearchNote({
        project_id: projectId,
        title: title.trim(),
        owner_member_id: authorId as number,
        written_date: writtenDate || undefined,
        reviewer_member_id: reviewerId === "" ? undefined : reviewerId,
        reviewed_date: reviewedDate || undefined,
        last_updated_by: currentUserId,
      });
      noteId = created.id;
      const failed: string[] = [];
      for (const [index, file] of files.entries()) {
        setProgress(`파일 올리는 중 (${index + 1}/${files.length}) ${file.name}`);
        try {
          await uploadNoteFile(created.id, authorId as number, file);
        } catch (err) {
          failed.push(`${file.name}: ${(err as Error).message}`);
        }
      }
      if (failed.length > 0) {
        // The note exists; say which files did not make it instead of hiding the note.
        onCreated(created.id, `연구노트를 만들었지만 파일 ${failed.length}개는 올리지 못했습니다. ${failed.join(" / ")}`);
        return;
      }
      onCreated(created.id, files.length > 0 ? `연구노트를 만들고 파일 ${files.length}개를 올렸습니다.` : "연구노트를 만들었습니다.");
    } catch (err) {
      setError(noteId ? (err as Error).message : `연구노트를 만들지 못했습니다: ${(err as Error).message}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <form className="note-create-page" onSubmit={onSubmit}>
      <header className="note-create-head">
        <div>
          <button type="button" className="note-create-back" onClick={onCancel} disabled={busy}>
            ← 연구노트 목록
          </button>
          <h3>새 연구노트</h3>
          <p>{projectName} 프로젝트에 연구노트를 만듭니다. 파일을 첨부하면 페이지가 노트에 바로 들어갑니다.</p>
        </div>
      </header>

      <div className="note-create-grid">
        <section className="card note-create-fields">
          <h4>노트 정보</h4>
          <label className="note-create-title">
            제목 <span className="required-mark">*</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: PCR 조건 비교 실험" maxLength={255} autoFocus disabled={busy} />
          </label>
          <div className="note-create-row">
            <label>
              작성자 <span className="required-mark">*</span>
              <select value={authorId} onChange={(e) => setAuthorId(e.target.value ? Number(e.target.value) : "")} disabled={busy}>
                <option value="">연구원 선택</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              작성일
              <input type="date" value={writtenDate} onChange={(e) => setWrittenDate(e.target.value)} disabled={busy} />
            </label>
          </div>
          <div className="note-create-row">
            <label>
              검토자
              <select value={reviewerId} onChange={(e) => setReviewerId(e.target.value ? Number(e.target.value) : "")} disabled={busy}>
                <option value="">지정 안 함</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              검토일
              <input type="date" value={reviewedDate} onChange={(e) => setReviewedDate(e.target.value)} disabled={busy} />
            </label>
          </div>
        </section>

        <section className="card note-create-files">
          <div className="note-create-files-head">
            <h4>첨부 파일</h4>
            <button type="button" className="secondary-button compact-button" onClick={() => inputRef.current?.click()} disabled={busy}>
              파일 선택
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/*"
            multiple
            className="hidden-input"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <div
            className={`note-create-drop${dragging ? " dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => !busy && inputRef.current?.click()}
            role="button"
            tabIndex={0}
          >
            <strong>PDF나 이미지를 여기에 끌어다 놓으세요</strong>
            <span>PDF는 페이지마다 나뉘어 들어갑니다. 첨부 없이 만들어도 됩니다.</span>
          </div>
          {skipped.length > 0 && <p className="field-hint">PDF·이미지가 아니라서 뺀 파일: {skipped.join(", ")}</p>}
          {singlePdf && (
            <fieldset className="note-create-split" disabled={busy}>
              <legend>PDF를 여러 노트로 나누기</legend>
              <label>
                <input type="radio" name="split" checked={splitMode === "one"} onChange={() => setSplitMode("one")} />
                나누지 않고 노트 하나로
              </label>
              <label>
                <input type="radio" name="split" checked={splitMode === "each"} onChange={() => setSplitMode("each")} />
                페이지마다 노트 하나씩
              </label>
              <label className="note-create-split-group">
                <input type="radio" name="split" checked={splitMode === "group"} onChange={() => setSplitMode("group")} />
                <span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={pagesPerNote}
                    onChange={(e) => {
                      setPagesPerNote(Math.max(1, Number(e.target.value) || 1));
                      setSplitMode("group");
                    }}
                    aria-label="노트당 페이지 수"
                  />
                  페이지씩 묶어서
                </span>
              </label>
              {splitting && (
                <p className="field-hint">
                  노트 제목은 "{title.trim() || singlePdf.name.replace(/\.[^.]+$/, "")} (1p)", "(2p)"…처럼 페이지 범위가 붙습니다. 작성자·날짜는 모든 노트에 같게 들어갑니다.
                </p>
              )}
            </fieldset>
          )}
          {files.length > 0 && (
            <ul className="note-create-file-list">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`}>
                  <span className="note-create-file-type">{/\.pdf$/i.test(file.name) ? "PDF" : "IMG"}</span>
                  <span className="note-create-file-name">{file.name}</span>
                  <span className="note-create-file-size">{formatSize(file.size)}</span>
                  <button
                    type="button"
                    className="note-create-file-remove"
                    onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                    disabled={busy}
                    aria-label={`${file.name} 빼기`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <footer className="note-create-actions">
        {error && <p className="error">{error}</p>}
        {progress && <p className="field-hint">{progress}</p>}
        <div>
          <button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>
            취소
          </button>
          <button type="submit" disabled={busy}>
            {busy
              ? "만드는 중..."
              : splitting
                ? splitMode === "each"
                  ? "페이지마다 노트 만들기"
                  : `${pagesPerNote}페이지씩 노트 만들기`
                : files.length > 0
                  ? `노트 만들기 (파일 ${files.length}개)`
                  : "노트 만들기"}
          </button>
        </div>
      </footer>
    </form>
  );
}
