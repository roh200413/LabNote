import { DragEvent, useEffect, useRef, useState } from "react";

import {
  createDataFolder,
  deleteDataItems,
  fetchDataFile,
  listDataFolder,
  uploadDataItems,
  type DataFile,
  type DataFolderListing,
} from "../api/projectData";
import { collectDroppedItems, itemsFromFileList, type UploadItem } from "../lib/folderUpload";

type Props = {
  projectId: string;
  /** Opens the bulk upload page with these files (folder paths kept, so folders become notes). */
  onMakeNotes: (items: UploadItem[]) => void;
  /** Opens AI 생성 in document mode with these files. */
  onSendToAi: (files: File[]) => void;
};

const NOTE_TYPES = /\.(pdf|png|jpe?g|gif|webp|bmp|tiff?)$/i;
const AI_TYPES = /\.(pdf|docx|txt|md)$/i;

function sizeLabel(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function kindLabel(file: DataFile) {
  if (file.mime_type.startsWith("image/")) return "이미지";
  if (/pdf/.test(file.mime_type)) return "PDF";
  if (/sheet|csv|excel/.test(file.mime_type) || /\.(csv|xlsx?)$/i.test(file.name)) return "표";
  if (/word|text|markdown/.test(file.mime_type) || /\.(docx?|txt|md)$/i.test(file.name)) return "문서";
  return file.name.split(".").pop()?.toUpperCase() ?? "파일";
}

/** NAS-like storage for raw data; pick files later and turn them into notes or AI inputs. */
export function DataStorage({ projectId, onMakeNotes, onSendToAi }: Props) {
  const [folder, setFolder] = useState("");
  const [listing, setListing] = useState<DataFolderListing | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const load = async (target = folder) => {
    try {
      setListing(await listDataFolder(projectId, target));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    setSelected([]);
    void load(folder);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, folder]);

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const upload = (items: UploadItem[]) =>
    items.length > 0 &&
    run("upload", async () => {
      const count = await uploadDataItems(projectId, folder, items, (done, total) => setBusy(`upload:${done}/${total}`));
      setNotice(`${count}개 파일을 올렸습니다.`);
      await load();
    });

  const onDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void upload(await collectDroppedItems(event.dataTransfer));
  };

  const files = listing?.files ?? [];
  const selectedFiles = files.filter((file) => selected.includes(file.id));
  const noteReady = selectedFiles.filter((file) => NOTE_TYPES.test(file.name));
  const aiReady = selectedFiles.filter((file) => AI_TYPES.test(file.name));

  // Every file under a folder (recursively), with paths relative to that folder's parent.
  const collectFolder = async (path: string): Promise<DataFile[]> => {
    const result = await listDataFolder(projectId, path);
    const nested = await Promise.all(result.folders.map((child) => collectFolder(child.path)));
    return [...result.files, ...nested.flat()];
  };

  const toItems = async (picked: DataFile[], base: string) => {
    const items: UploadItem[] = [];
    for (const file of picked) {
      // Folder of the file relative to `base` (the top-level folder keeps its own name so it becomes the note title).
      const relativeFolder = !base
        ? file.folder
        : file.folder === base
          ? ""
          : file.folder.startsWith(`${base}/`)
            ? file.folder.slice(base.length + 1)
            : file.folder;
      items.push({ file: await fetchDataFile(file), path: relativeFolder ? `${relativeFolder}/${file.name}` : file.name });
    }
    return items;
  };

  const makeNotesFromSelection = () =>
    run("notes", async () => {
      onMakeNotes(await toItems(noteReady, folder));
    });

  const makeNotesFromFolder = (path: string) =>
    run("notes", async () => {
      const all = (await collectFolder(path)).filter((file) => NOTE_TYPES.test(file.name));
      if (all.length === 0) throw new Error("이 폴더에는 연구노트로 만들 PDF·이미지가 없습니다");
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      onMakeNotes(await toItems(all, parent));
    });

  const sendToAi = () =>
    run("ai", async () => {
      onSendToAi(await Promise.all(aiReady.map(fetchDataFile)));
    });

  const download = (file: DataFile) =>
    run("download", async () => {
      const blob = await fetchDataFile(file);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    });

  const remove = (payload: { file_ids?: number[]; folder?: string }, label: string) => {
    if (!window.confirm(`${label}을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return;
    void run("delete", async () => {
      const result = await deleteDataItems(projectId, payload);
      setSelected([]);
      setNotice(`${result.deleted}개 파일을 삭제했습니다.`);
      await load();
    });
  };

  const newFolder = () => {
    const name = window.prompt("새 폴더 이름");
    if (!name?.trim()) return;
    void run("folder", async () => {
      await createDataFolder(projectId, folder ? `${folder}/${name.trim()}` : name.trim());
      await load();
    });
  };

  const allSelected = files.length > 0 && files.every((file) => selected.includes(file.id));

  return (
    <div
      className={`data-storage${dragging ? " dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => void onDrop(event)}
    >
      <div className="data-storage-toolbar">
        <div className="data-storage-crumbs">
          <button type="button" className="link-button" onClick={() => setFolder("")}>
            전체
          </button>
          {listing?.breadcrumbs.map((crumb) => (
            <span key={crumb.path}>
              <span className="data-crumb-sep">/</span>
              <button type="button" className="link-button" onClick={() => setFolder(crumb.path)}>
                {crumb.name}
              </button>
            </span>
          ))}
        </div>
        <div className="data-storage-actions">
          <button type="button" className="secondary-button compact-button" onClick={newFolder} disabled={busy !== null}>
            새 폴더
          </button>
          <button type="button" className="secondary-button compact-button" onClick={() => folderRef.current?.click()} disabled={busy !== null}>
            폴더 올리기
          </button>
          <button type="button" className="compact-button" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
            파일 올리기
          </button>
          <input ref={fileRef} type="file" multiple className="hidden-input" onChange={(event) => { void upload(itemsFromFileList(event.target.files ?? [])); event.target.value = ""; }} />
          <input
            ref={folderRef}
            type="file"
            multiple
            className="hidden-input"
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            onChange={(event) => {
              void upload(itemsFromFileList(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </div>
      </div>

      <p className="field-hint data-storage-hint">
        실험 원본 데이터(이미지, PDF, 엑셀, 코드 등)를 형식 상관없이 올려 두는 곳입니다. 나중에 파일이나 폴더를 골라
        <b> 연구노트로 만들기</b>(PDF·이미지)나 <b>AI에게 보내기</b>(PDF·Word·텍스트)를 할 수 있습니다. 여기에 끌어다 놓아도 올라갑니다.
        {listing && ` · 전체 ${listing.total_files}개, ${sizeLabel(listing.total_size)}`}
      </p>

      {busy?.startsWith("upload") && <p className="data-storage-progress">올리는 중... {busy.split(":")[1] ?? ""}</p>}
      {busy === "notes" && <p className="data-storage-progress">파일을 가져오는 중...</p>}
      {error && <p className="error">오류: {error}</p>}
      {notice && <p className="success-copy">{notice}</p>}

      {selected.length > 0 && (
        <div className="data-selection-bar">
          <span>{selected.length}개 선택</span>
          <button type="button" className="compact-button" onClick={() => void makeNotesFromSelection()} disabled={busy !== null || noteReady.length === 0}
            title={noteReady.length === 0 ? "PDF나 이미지 파일을 고르세요" : undefined}>
            연구노트로 만들기{noteReady.length !== selected.length && noteReady.length > 0 ? ` (${noteReady.length}개)` : ""}
          </button>
          <button type="button" className="secondary-button compact-button" onClick={() => void sendToAi()} disabled={busy !== null || aiReady.length === 0}
            title={aiReady.length === 0 ? "PDF, Word(.docx), 텍스트 파일을 고르세요" : undefined}>
            AI에게 보내기{aiReady.length !== selected.length && aiReady.length > 0 ? ` (${aiReady.length}개)` : ""}
          </button>
          <button type="button" className="secondary-button compact-button danger-text" onClick={() => remove({ file_ids: selected }, `파일 ${selected.length}개`)} disabled={busy !== null}>
            삭제
          </button>
          <button type="button" className="link-button" onClick={() => setSelected([])}>
            선택 해제
          </button>
        </div>
      )}

      <div className="table-shell">
        <table className="admin-table data-storage-table">
          <thead>
            <tr>
              <th className="data-check">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? [] : files.map((file) => file.id))}
                  aria-label="이 폴더 파일 모두 선택"
                  disabled={files.length === 0}
                />
              </th>
              <th>이름</th>
              <th>종류</th>
              <th>크기</th>
              <th>올린 날짜</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {folder && (
              <tr className="data-folder-row">
                <td />
                <td colSpan={5}>
                  <button type="button" className="link-button" onClick={() => setFolder(folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "")}>
                    ↩ 상위 폴더로
                  </button>
                </td>
              </tr>
            )}
            {listing?.folders.map((child) => (
              <tr key={child.path} className="data-folder-row">
                <td />
                <td>
                  <button type="button" className="data-folder-link" onClick={() => setFolder(child.path)}>
                    <span className="data-folder-icon" aria-hidden>
                      ▸
                    </span>
                    {child.name}
                  </button>
                </td>
                <td>폴더</td>
                <td>{child.file_count ? `${child.file_count}개 · ${sizeLabel(child.size)}` : "비어 있음"}</td>
                <td />
                <td className="data-row-actions">
                  <button type="button" className="link-button" onClick={() => void makeNotesFromFolder(child.path)} disabled={busy !== null}>
                    연구노트로 만들기
                  </button>
                  <button type="button" className="link-button danger-text" onClick={() => remove({ folder: child.path }, `'${child.name}' 폴더와 안의 파일`)} disabled={busy !== null}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {files.map((file) => (
              <tr key={file.id} className={selected.includes(file.id) ? "selected" : ""}>
                <td className="data-check">
                  <input
                    type="checkbox"
                    checked={selected.includes(file.id)}
                    onChange={(event) =>
                      setSelected((current) => (event.target.checked ? [...current, file.id] : current.filter((id) => id !== file.id)))
                    }
                    aria-label={`${file.name} 선택`}
                  />
                </td>
                <td className="data-file-name">{file.name}</td>
                <td>{kindLabel(file)}</td>
                <td>{sizeLabel(file.size)}</td>
                <td>{file.created_at?.slice(0, 10) ?? "-"}</td>
                <td className="data-row-actions">
                  <button type="button" className="link-button" onClick={() => void download(file)} disabled={busy !== null}>
                    받기
                  </button>
                </td>
              </tr>
            ))}
            {listing && listing.folders.length === 0 && files.length === 0 && (
              <tr>
                <td colSpan={6} className="data-empty">
                  {folder ? "빈 폴더입니다." : "아직 올린 데이터가 없습니다. 파일이나 폴더를 끌어다 놓으세요."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
