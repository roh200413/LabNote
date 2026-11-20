import { useEffect, useRef, useState } from "react";

import { collectDroppedItems, itemsFromFileList, type UploadItem } from "../lib/folderUpload";

type Props = {
  collapsed: boolean;
  /** Receives picked or dropped files (folder paths kept). */
  onItems: (items: UploadItem[]) => void;
};

/** Project sidebar shortcut: pick files or a folder (or drop them here) to start new research notes. */
export function SidebarUploadButton({ collapsed, onItems }: Props) {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const pick = (input: HTMLInputElement | null) => {
    setOpen(false);
    input?.click();
  };

  return (
    <div className={`sidebar-upload${collapsed ? " collapsed" : ""}`} ref={boxRef}>
      <button
        type="button"
        className={`sidebar-upload-button${dragging ? " dragging" : ""}`}
        onClick={() => setOpen((value) => !value)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={async (event) => {
          event.preventDefault();
          setDragging(false);
          onItems(await collectDroppedItems(event.dataTransfer));
        }}
        title="파일이나 폴더를 올려 새 연구노트 만들기 (여기에 끌어다 놓아도 됩니다)"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 16V4" />
          <path d="m6 10 6-6 6 6" />
          <path d="M4 20h16" />
        </svg>
        {!collapsed && <span>파일 올리기</span>}
      </button>
      {open && (
        <div className="sidebar-upload-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => pick(fileRef.current)}>
            파일 선택
            <em>PDF·이미지</em>
          </button>
          <button type="button" role="menuitem" onClick={() => pick(folderRef.current)}>
            폴더 선택
            <em>폴더 하나 = 노트 하나</em>
          </button>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="application/pdf,image/*"
        className="hidden-input"
        onChange={(event) => {
          onItems(itemsFromFileList(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <input
        ref={folderRef}
        type="file"
        multiple
        className="hidden-input"
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={(event) => {
          onItems(itemsFromFileList(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </div>
  );
}
