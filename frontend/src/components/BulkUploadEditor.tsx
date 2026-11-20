import { useEffect, useMemo, useRef, useState } from "react";

import { uploadNoteFile } from "../api/file";
import { createResearchNote } from "../api/researchNote";
import { folderOf, hasFolders, itemsFromFileList, type UploadItem } from "../lib/folderUpload";

type Member = { id: number; name: string };

type FileItem = {
  key: string;
  file: File;
  /** Folder path inside the upload ("실험A/day1"), empty for loose files. */
  folder: string;
  uploaded: boolean;
};

type NoteGroup = {
  key: string;
  title: string;
  writtenDate: string;
  authorId: number | "";
  reviewerId: number | "";
  files: FileItem[];
  noteId: string | null;
  status: "ready" | "working" | "done" | "failed";
  progress: string;
  error: string | null;
};

type Props = {
  projectId: string;
  initialItems: UploadItem[];
  members: Member[];
  defaultAuthorId: number | "";
  defaultReviewerId: number | "";
  currentUserId: number;
  onClose: (createdAny: boolean) => void;
};

const ACCEPTED = /\.(pdf|png|jpe?g|gif|webp|bmp|tiff?)$/i;
// System files that folders often carry; skipped without listing them.
const IGNORED = /^(\.|thumbs\.db$|desktop\.ini$)/i;

function isoDate(value: number | Date) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function titleFrom(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim() || name;
}

function sizeLabel(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

let counter = 0;
const nextKey = () => `k${Date.now().toString(36)}${(counter += 1)}`;

function toItem(item: UploadItem): FileItem {
  return { key: nextKey(), file: item.file, folder: folderOf(item.path), uploaded: false };
}

function folderTitle(folder: string) {
  return folder.split("/").filter(Boolean).pop() ?? folder;
}

/** Image thumbnail whose object URL lives exactly as long as the element. */
function Thumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url ? <img src={url} alt="" className="bulk-thumb" /> : <span className="bulk-thumb bulk-thumb-pdf">PDF</span>;
}

function openPreview(file: File) {
  const url = URL.createObjectURL(file);
  window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Lets the user arrange many uploaded files into notes (title, date, people, grouping) before creating them all. */
export function BulkUploadEditor({
  projectId,
  initialItems,
  members,
  defaultAuthorId,
  defaultReviewerId,
  currentUserId,
  onClose,
}: Props) {
  const makeGroup = (items: FileItem[], title?: string): NoteGroup => ({
    key: nextKey(),
    title: title ?? titleFrom(items[0]?.file.name ?? "새 연구노트"),
    // The earliest file date in the note is the most likely day of the work.
    writtenDate: isoDate(Math.min(...items.map((item) => item.file.lastModified || Date.now()), Date.now())),
    authorId: defaultAuthorId,
    reviewerId: defaultReviewerId,
    files: items,
    noteId: null,
    status: "ready",
    progress: "",
    error: null,
  });

  // One note per folder (folder name as title); loose files get a note each.
  const groupItems = (items: FileItem[], byFolder: boolean): NoteGroup[] => {
    if (!byFolder) return items.map((item) => makeGroup([item]));
    const result: NoteGroup[] = [];
    const byPath = new Map<string, FileItem[]>();
    for (const item of items) {
      if (!item.folder) {
        result.push(makeGroup([item]));
        continue;
      }
      if (!byPath.has(item.folder)) byPath.set(item.folder, []);
      byPath.get(item.folder)!.push(item);
    }
    for (const [folder, folderItems] of byPath) result.push(makeGroup(folderItems, folderTitle(folder)));
    return result;
  };

  const usable = (item: UploadItem) => !IGNORED.test(item.file.name);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [groups, setGroups] = useState<NoteGroup[]>(() =>
    groupItems(
      initialItems.filter((item) => usable(item) && ACCEPTED.test(item.file.name)).map(toItem),
      hasFolders(initialItems)
    )
  );
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [bulkDate, setBulkDate] = useState("");
  const [bulkAuthor, setBulkAuthor] = useState<number | "">("");
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSkipped(initialItems.filter((item) => usable(item) && !ACCEPTED.test(item.file.name)).map((item) => item.path));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialItems]);

  const anyFolders = groups.some((group) => group.files.some((item) => item.folder));

  const fileCount = useMemo(() => groups.reduce((sum, group) => sum + group.files.length, 0), [groups]);
  const pending = groups.filter((group) => group.status !== "done");
  const doneCount = groups.filter((group) => group.status === "done").length;
  const locked = running || finished;
  const invalid = groups.some((group) => group.status !== "done" && (!group.title.trim() || group.authorId === "" || group.files.length === 0));

  const patchGroup = (key: string, patch: Partial<NoteGroup>) =>
    setGroups((current) => current.map((group) => (group.key === key ? { ...group, ...patch } : group)));

  const addItems = (items: UploadItem[]) => {
    const kept = items.filter(usable);
    const accepted = kept.filter((item) => ACCEPTED.test(item.file.name));
    const rejected = kept.filter((item) => !ACCEPTED.test(item.file.name)).map((item) => item.path);
    if (rejected.length) setSkipped((current) => [...current, ...rejected]);
    setGroups((current) => [...current, ...groupItems(accepted.map(toItem), hasFolders(accepted))]);
  };

  const regroupByFolder = () =>
    setGroups((current) => {
      const done = current.filter((group) => group.status === "done");
      const items = current.filter((group) => group.status !== "done").flatMap((group) => group.files);
      return [...done, ...groupItems(items, true)];
    });

  const moveGroup = (index: number, delta: number) =>
    setGroups((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const mergeIntoPrevious = (index: number) =>
    setGroups((current) => {
      if (index === 0) return current;
      const next = [...current];
      next[index - 1] = { ...next[index - 1], files: [...next[index - 1].files, ...next[index].files] };
      next.splice(index, 1);
      return next;
    });

  const splitFile = (groupIndex: number, fileKey: string) =>
    setGroups((current) => {
      const group = current[groupIndex];
      if (group.files.length < 2) return current;
      const item = group.files.find((file) => file.key === fileKey)!;
      const next = [...current];
      next[groupIndex] = { ...group, files: group.files.filter((file) => file.key !== fileKey) };
      next.splice(groupIndex + 1, 0, { ...makeGroup([item]), authorId: group.authorId, reviewerId: group.reviewerId });
      return next;
    });

  const moveFile = (groupIndex: number, fileIndex: number, delta: number) =>
    setGroups((current) => {
      const files = [...current[groupIndex].files];
      const target = fileIndex + delta;
      if (target < 0 || target >= files.length) return current;
      [files[fileIndex], files[target]] = [files[target], files[fileIndex]];
      return current.map((group, index) => (index === groupIndex ? { ...group, files } : group));
    });

  const removeFile = (groupIndex: number, fileKey: string) =>
    setGroups((current) =>
      current
        .map((group, index) => (index === groupIndex ? { ...group, files: group.files.filter((file) => file.key !== fileKey) } : group))
        .filter((group) => group.files.length > 0)
    );

  const onePerFile = () =>
    setGroups((current) =>
      current.flatMap((group) =>
        group.files.map((item, index) =>
          index === 0 ? { ...group, files: [item] } : { ...makeGroup([item]), authorId: group.authorId, reviewerId: group.reviewerId }
        )
      )
    );

  const allInOne = () =>
    setGroups((current) => (current.length < 2 ? current : [{ ...current[0], files: current.flatMap((group) => group.files) }]));

  const sortByDate = () =>
    setGroups((current) => [...current].sort((left, right) => left.writtenDate.localeCompare(right.writtenDate)));

  const applyBulk = () =>
    setGroups((current) =>
      current.map((group) => ({
        ...group,
        writtenDate: bulkDate || group.writtenDate,
        authorId: bulkAuthor === "" ? group.authorId : bulkAuthor,
      }))
    );

  const runUpload = async () => {
    setRunning(true);
    // Work on a snapshot; progress is written back per group so a retry continues where it stopped.
    for (const snapshot of groups) {
      if (snapshot.status === "done") continue;
      let noteId = snapshot.noteId;
      try {
        patchGroup(snapshot.key, { status: "working", error: null, progress: noteId ? "파일 올리는 중" : "노트 만드는 중" });
        if (!noteId) {
          const created = await createResearchNote({
            project_id: projectId,
            title: snapshot.title.trim(),
            owner_member_id: Number(snapshot.authorId),
            written_date: snapshot.writtenDate || undefined,
            reviewer_member_id: snapshot.reviewerId === "" ? undefined : Number(snapshot.reviewerId),
            last_updated_by: currentUserId,
          });
          noteId = created.id;
          patchGroup(snapshot.key, { noteId });
        }
        const files = [...snapshot.files];
        for (let index = 0; index < files.length; index += 1) {
          if (files[index].uploaded) continue;
          patchGroup(snapshot.key, { progress: `파일 ${index + 1}/${files.length} 올리는 중` });
          await uploadNoteFile(noteId, Number(snapshot.authorId), files[index].file);
          files[index] = { ...files[index], uploaded: true };
          patchGroup(snapshot.key, { files: [...files] });
        }
        patchGroup(snapshot.key, { status: "done", progress: "완료" });
      } catch (err) {
        patchGroup(snapshot.key, { status: "failed", progress: "", error: (err as Error).message });
      }
    }
    setRunning(false);
    setFinished(true);
  };

  const failedCount = groups.filter((group) => group.status === "failed").length;

  // Leaving the browser page mid-upload would stop the remaining uploads.
  useEffect(() => {
    if (!running) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  return (
    <section className="card bulk-upload" aria-label="여러 파일 한 번에 올리기">
        <div className="bulk-upload-head">
          <div>
            <button type="button" className="link-button bulk-back" onClick={() => onClose(doneCount > 0)} disabled={running}>
              ← 연구노트 목록으로
            </button>
            <h3>
              여러 파일 한 번에 올리기 · 노트 {groups.length}개 · 파일 {fileCount}개
            </h3>
            <p className="field-hint">
              폴더는 폴더 하나가 노트 하나(폴더 이름이 제목)로, 낱개 파일은 파일마다 노트 하나로 만들어집니다. 제목·작성일·작성자를 고치고,
              같은 실험 파일은 "위 노트에 합치기"로 묶은 뒤 한 번에 올리세요. 작성일은 파일의 수정 날짜로 미리 채웠습니다.
            </p>
          </div>
          {!finished && (
            <button type="button" className="secondary-button compact-button" onClick={() => onClose(false)} disabled={running}>
              취소
            </button>
          )}
        </div>

        {!locked && (
          <div className="bulk-toolbar">
            <div className="bulk-toolbar-group">
              <button type="button" className="secondary-button compact-button" onClick={onePerFile}>
                파일마다 노트 1개
              </button>
              <button type="button" className="secondary-button compact-button" onClick={allInOne} disabled={groups.length < 2}>
                모두 노트 1개로
              </button>
              <button type="button" className="secondary-button compact-button" onClick={sortByDate}>
                작성일 순 정렬
              </button>
              {anyFolders && (
                <button type="button" className="secondary-button compact-button" onClick={regroupByFolder}>
                  폴더별로 묶기
                </button>
              )}
              <button type="button" className="secondary-button compact-button" onClick={() => fileRef.current?.click()}>
                + 파일 추가
              </button>
              <button type="button" className="secondary-button compact-button" onClick={() => folderRef.current?.click()}>
                + 폴더 추가
              </button>
              <input
                ref={folderRef}
                type="file"
                multiple
                className="hidden-input"
                {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                onChange={(event) => {
                  addItems(itemsFromFileList(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="application/pdf,image/*"
                className="hidden-input"
                onChange={(event) => {
                  addItems(itemsFromFileList(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
            </div>
            <div className="bulk-toolbar-group">
              <span className="bulk-toolbar-label">한꺼번에 바꾸기</span>
              <input type="date" value={bulkDate} onChange={(event) => setBulkDate(event.target.value)} aria-label="모든 노트 작성일" />
              <select value={bulkAuthor} onChange={(event) => setBulkAuthor(event.target.value ? Number(event.target.value) : "")} aria-label="모든 노트 작성자">
                <option value="">작성자 그대로</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
              <button type="button" className="secondary-button compact-button" onClick={applyBulk} disabled={!bulkDate && bulkAuthor === ""}>
                적용
              </button>
            </div>
          </div>
        )}

        {skipped.length > 0 && (
          <p className="bulk-skipped">PDF·이미지가 아니라서 뺀 파일: {skipped.join(", ")}</p>
        )}

        <ol className="bulk-groups">
          {groups.map((group, groupIndex) => (
            <li key={group.key} className={`bulk-group status-${group.status}`}>
              <div className="bulk-group-head">
                <span className="bulk-group-no">{groupIndex + 1}</span>
                <label className="bulk-field bulk-title">
                  제목
                  <input
                    value={group.title}
                    onChange={(event) => patchGroup(group.key, { title: event.target.value })}
                    disabled={locked && group.status !== "failed"}
                    maxLength={255}
                  />
                </label>
                <label className="bulk-field">
                  작성일
                  <input
                    type="date"
                    value={group.writtenDate}
                    onChange={(event) => patchGroup(group.key, { writtenDate: event.target.value })}
                    disabled={locked && group.status !== "failed"}
                  />
                </label>
                <label className="bulk-field">
                  작성자
                  <select
                    value={group.authorId}
                    onChange={(event) => patchGroup(group.key, { authorId: event.target.value ? Number(event.target.value) : "" })}
                    disabled={(locked && group.status !== "failed") || Boolean(group.noteId)}
                  >
                    <option value="">선택</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="bulk-field">
                  검토자
                  <select
                    value={group.reviewerId}
                    onChange={(event) => patchGroup(group.key, { reviewerId: event.target.value ? Number(event.target.value) : "" })}
                    disabled={(locked && group.status !== "failed") || Boolean(group.noteId)}
                  >
                    <option value="">지정 안 함</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
                {!locked && (
                  <div className="bulk-group-actions">
                    <button type="button" className="fmt-icon-button" onClick={() => moveGroup(groupIndex, -1)} disabled={groupIndex === 0} aria-label="노트 위로">
                      ↑
                    </button>
                    <button
                      type="button"
                      className="fmt-icon-button"
                      onClick={() => moveGroup(groupIndex, 1)}
                      disabled={groupIndex === groups.length - 1}
                      aria-label="노트 아래로"
                    >
                      ↓
                    </button>
                    {groupIndex > 0 && (
                      <button type="button" className="link-button" onClick={() => mergeIntoPrevious(groupIndex)}>
                        위 노트에 합치기
                      </button>
                    )}
                  </div>
                )}
                {group.status !== "ready" && (
                  <span className={`bulk-status ${group.status}`}>
                    {group.status === "done" ? "완료" : group.status === "failed" ? "실패" : group.progress}
                  </span>
                )}
              </div>
              {group.error && <p className="error bulk-error">{group.error}</p>}
              <ul className="bulk-files">
                {group.files.map((item, fileIndex) => (
                  <li key={item.key} className={item.uploaded ? "uploaded" : ""}>
                    <Thumb file={item.file} />
                    <button
                      type="button"
                      className="link-button bulk-file-name"
                      onClick={() => openPreview(item.file)}
                      title="새 탭에서 미리보기"
                    >
                      {item.file.name}
                    </button>
                    <em>
                      {item.folder ? `${item.folder}/ · ` : ""}
                      {sizeLabel(item.file.size)}
                      {item.uploaded ? " · 올림" : ""}
                    </em>
                    {!locked && (
                      <span className="bulk-file-actions">
                        {group.files.length > 1 && (
                          <>
                            <button type="button" className="fmt-icon-button" onClick={() => moveFile(groupIndex, fileIndex, -1)} disabled={fileIndex === 0} aria-label="파일 위로">
                              ↑
                            </button>
                            <button
                              type="button"
                              className="fmt-icon-button"
                              onClick={() => moveFile(groupIndex, fileIndex, 1)}
                              disabled={fileIndex === group.files.length - 1}
                              aria-label="파일 아래로"
                            >
                              ↓
                            </button>
                            <button type="button" className="link-button" onClick={() => splitFile(groupIndex, item.key)}>
                              따로 노트로
                            </button>
                          </>
                        )}
                        <button type="button" className="link-button danger-text" onClick={() => removeFile(groupIndex, item.key)}>
                          빼기
                        </button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>

        {groups.length === 0 && <div className="github-empty">올릴 파일이 없습니다. '+ 파일 추가'로 PDF나 이미지를 고르세요.</div>}

        <div className="bulk-footer">
          {finished ? (
            <>
              <span>
                노트 {doneCount}개를 만들었습니다{failedCount ? ` · 실패 ${failedCount}개` : ""}.
              </span>
              {failedCount > 0 && (
                <button type="button" onClick={() => void runUpload()} disabled={running || invalid}>
                  실패한 것만 다시 올리기
                </button>
              )}
              <button type="button" className={failedCount ? "secondary-button" : ""} onClick={() => onClose(doneCount > 0)} disabled={running}>
                노트 목록 보기
              </button>
            </>
          ) : (
            <>
              <span>{invalid ? "제목과 작성자를 모두 채워 주세요." : `노트 ${pending.length}개를 만들고 파일 ${fileCount}개를 올립니다.`}</span>
              <button type="button" onClick={() => void runUpload()} disabled={running || invalid || groups.length === 0}>
                {running ? "올리는 중..." : `노트 ${groups.length}개 한 번에 올리기`}
              </button>
            </>
          )}
        </div>
    </section>
  );
}
