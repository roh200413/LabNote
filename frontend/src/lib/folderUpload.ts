/** A file plus where it sat in the uploaded folder ("실험A/day1/gel.png"); just the name for loose files. */
export type UploadItem = { file: File; path: string };

type FsEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (success: (file: File) => void, failure?: (error: unknown) => void) => void;
  createReader?: () => { readEntries: (success: (entries: FsEntry[]) => void, failure?: (error: unknown) => void) => void };
};

const MAX_FILES = 500;

function readAll(entry: FsEntry): Promise<FsEntry[]> {
  const reader = entry.createReader?.();
  if (!reader) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const collected: FsEntry[] = [];
    // readEntries returns results in batches (about 100 at a time) until an empty batch.
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(collected);
        else {
          collected.push(...batch);
          next();
        }
      }, reject);
    next();
  });
}

async function walk(entry: FsEntry, out: UploadItem[]): Promise<void> {
  if (out.length >= MAX_FILES) return;
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((resolve, reject) => entry.file!(resolve, reject));
    out.push({ file, path: entry.fullPath.replace(/^\//, "") || file.name });
    return;
  }
  if (entry.isDirectory) {
    const children = await readAll(entry);
    children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const child of children) await walk(child, out);
  }
}

/** Files from a drop, including everything inside dropped folders (with their folder paths). */
export async function collectDroppedItems(dataTransfer: DataTransfer): Promise<UploadItem[]> {
  const entries = Array.from(dataTransfer.items ?? [])
    .map((item) => (item.kind === "file" && "webkitGetAsEntry" in item ? (item.webkitGetAsEntry() as FsEntry | null) : null))
    .filter((entry): entry is FsEntry => Boolean(entry));
  if (entries.length === 0) {
    return Array.from(dataTransfer.files ?? []).map((file) => ({ file, path: file.name }));
  }
  const out: UploadItem[] = [];
  for (const entry of entries) await walk(entry, out);
  return out;
}

/** Files picked with <input webkitdirectory> keep their folder path in webkitRelativePath. */
export function itemsFromFileList(files: FileList | File[]): UploadItem[] {
  return Array.from(files)
    .slice(0, MAX_FILES)
    .map((file) => ({ file, path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

export function folderOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index > 0 ? path.slice(0, index) : "";
}

export function hasFolders(items: UploadItem[]): boolean {
  return items.some((item) => item.path.includes("/"));
}
