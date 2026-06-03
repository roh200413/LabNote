export type BlockType = "text" | "image";

export type TextStyle = {
  fontSize?: number;
  fontWeight?: "normal" | "bold";
  textAlign?: "left" | "center" | "right";
};

export type BaseBlock = {
  id: string;
  type: BlockType;
  x: number;
  y: number;
  w: number;
  h: number;
  locked?: boolean;
};

export type TextBlock = BaseBlock & {
  type: "text";
  content: string;
  style?: TextStyle;
};

export type ImageBlock = BaseBlock & {
  type: "image";
  src: string;
};

export type DocumentBlock = TextBlock | ImageBlock;

export type DocumentSchema = {
  schemaVersion: number;
  id: string;
  title: string;
  page: {
    width: number;
    height: number;
    background: string;
    backgroundImage?: string | null;
  };
  meta: {
    noteId: string;
    sourceFileId?: number | null;
    sourcePageId?: number | null;
  };
  blocks: DocumentBlock[];
};

export type ResearchNoteDocumentSummary = {
  id: string;
  note_id: string;
  title: string;
  status: string;
  schema_version: number;
  current_revision_id: number | null;
  source_file_id: number | null;
  source_page_id: number | null;
  created_at: string;
  updated_at: string;
};

export type ResearchNoteDocument = {
  id: string;
  note_id: string;
  title: string;
  status: string;
  schema_version: number;
  current_revision_id: number | null;
  current_revision_no: number | null;
  source_file_id: number | null;
  source_page_id: number | null;
  document: DocumentSchema;
  created_at: string;
  updated_at: string;
};
