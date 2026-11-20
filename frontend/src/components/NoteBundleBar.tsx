import { useState, type FormEvent } from "react";

import { createNoteBundle, deleteNoteBundle, renameNoteBundle, type NoteBundle } from "../api/noteBundle";

/** "all", "none" (notes in no bundle) or a bundle id. */
export type BundleFilter = string;
export const ALL_BUNDLES = "all";
export const NO_BUNDLE = "none";

export function filterNotesByBundle<T extends { bundle_id?: string | null }>(notes: T[], filter: BundleFilter): T[] {
  if (filter === ALL_BUNDLES) return notes;
  if (filter === NO_BUNDLE) return notes.filter((note) => !note.bundle_id);
  return notes.filter((note) => note.bundle_id === filter);
}

type Props = {
  projectId: string;
  bundles: NoteBundle[];
  notes: { bundle_id?: string | null }[];
  active: BundleFilter;
  onSelect: (filter: BundleFilter) => void;
  /** Reload bundles and notes after a change; the new active filter is passed when it should change. */
  onChanged: (nextFilter?: BundleFilter) => void;
};

export function NoteBundleBar({ projectId, bundles, notes, active, onSelect, onChanged }: Props) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const countOf = (filter: BundleFilter) => filterNotesByBundle(notes, filter).length;
  const activeBundle = bundles.find((bundle) => bundle.id === active) ?? null;
  const looseCount = countOf(NO_BUNDLE);

  const run = async (work: () => Promise<BundleFilter | undefined>) => {
    setBusy(true);
    setError("");
    try {
      onChanged(await work());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    void run(async () => {
      const bundle = await createNoteBundle(projectId, name.trim());
      setName("");
      setCreating(false);
      return bundle.id;
    });
  };

  const onRename = () => {
    if (!activeBundle) return;
    const next = window.prompt("묶음 이름", activeBundle.name);
    if (!next || !next.trim() || next.trim() === activeBundle.name) return;
    void run(async () => {
      await renameNoteBundle(activeBundle.id, next.trim());
      return undefined;
    });
  };

  const onDelete = () => {
    if (!activeBundle) return;
    const count = countOf(activeBundle.id);
    const message = count
      ? `'${activeBundle.name}' 묶음을 삭제할까요? 안에 있는 노트 ${count}개는 지워지지 않고 '묶음 없음'으로 옮겨집니다.`
      : `'${activeBundle.name}' 묶음을 삭제할까요?`;
    if (!window.confirm(message)) return;
    void run(async () => {
      await deleteNoteBundle(activeBundle.id);
      return ALL_BUNDLES;
    });
  };

  const chip = (filter: BundleFilter, label: string) => (
    <button
      key={filter}
      type="button"
      className={`note-bundle-chip${active === filter ? " active" : ""}`}
      onClick={() => onSelect(filter)}
      aria-pressed={active === filter}
    >
      <span>{label}</span>
      <span className="note-bundle-count">{countOf(filter)}</span>
    </button>
  );

  return (
    <div className="note-bundle-bar">
      <div className="note-bundle-chips" role="toolbar" aria-label="노트 묶음">
        {chip(ALL_BUNDLES, "전체")}
        {bundles.map((bundle) => chip(bundle.id, bundle.name))}
        {bundles.length > 0 && looseCount > 0 && chip(NO_BUNDLE, "묶음 없음")}
        {creating ? (
          <form className="note-bundle-create" onSubmit={onCreate}>
            <input
              autoFocus
              value={name}
              maxLength={100}
              placeholder="묶음 이름 (예: 실험 A, GitHub)"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setCreating(false);
              }}
              disabled={busy}
            />
            <button type="submit" className="compact-button" disabled={busy || !name.trim()}>
              만들기
            </button>
            <button type="button" className="secondary-button compact-button" onClick={() => setCreating(false)} disabled={busy}>
              취소
            </button>
          </form>
        ) : (
          <button type="button" className="note-bundle-chip note-bundle-add" onClick={() => setCreating(true)}>
            + 새 묶음
          </button>
        )}
      </div>
      {activeBundle && (
        <div className="note-bundle-actions">
          <button type="button" className="link-button" onClick={onRename} disabled={busy}>
            이름 바꾸기
          </button>
          <button type="button" className="link-button danger-text" onClick={onDelete} disabled={busy}>
            묶음 삭제
          </button>
        </div>
      )}
      {error && <p className="error">오류: {error}</p>}
    </div>
  );
}
