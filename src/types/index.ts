export interface PDFDocument {
  id: string;
  name: string;
  size: number;
  uploadTime: Date;
  content: Uint8Array;
  pageCount: number;
}

export interface PDFPage {
  index: number;
  textContent: string;
  images: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

export interface EditAction {
  type: 'text' | 'image' | 'page';
  targetId: string;
  changes: Record<string, unknown>;
  timestamp: Date;
}

export interface TextAnnotation {
  id: string;
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

export type ExportFormat = 'pdf' | 'image' | 'text';

export interface FileMetadata {
  id: string;
  name: string;
  size: number;
  uploadTime: string;
  pageCount: number;
}

export interface EditorState {
  currentPage: number;
  zoom: number;
  selectedTool: ToolType;
  isEditing: boolean;
}

export type ToolType = 'select' | 'text' | 'image' | 'hand' | 'zoom';

export interface ToolbarItem {
  id: ToolType;
  icon: string;
  label: string;
}