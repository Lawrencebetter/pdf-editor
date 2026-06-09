import { useState, useCallback, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { EditorState, ToolType } from '@/types';
import { getPDFPageCount } from '@/utils/pdfUtils';

const initialEditorState: EditorState = {
  currentPage: 1,
  zoom: 100,
  selectedTool: 'select',
  isEditing: false,
};

export function usePDF() {
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [editorState, setEditorState] = useState<EditorState>(initialEditorState);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pdfRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);

  const loadPDF = useCallback(async (data: Uint8Array) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const count = await getPDFPageCount(data);
      setPdfData(data);
      setPageCount(count);
      setEditorState((prev) => ({ ...prev, currentPage: 1 }));
      
      const dataCopy = Uint8Array.from(data);
      const pdf = await pdfjsLib.getDocument({ data: dataCopy }).promise;
      pdfRef.current = pdf;
    } catch (err) {
      setError('无法加载PDF文件');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updatePDF = useCallback((newData: Uint8Array) => {
    setPdfData(newData);
    getPDFPageCount(newData).then(setPageCount);
  }, []);

  const setCurrentPage = useCallback((page: number) => {
    if (page >= 1 && page <= pageCount) {
      setEditorState((prev) => ({ ...prev, currentPage: page }));
    }
  }, [pageCount]);

  const setZoom = useCallback((zoom: number) => {
    const clampedZoom = Math.max(50, Math.min(200, zoom));
    setEditorState((prev) => ({ ...prev, zoom: clampedZoom }));
  }, []);

  const zoomIn = useCallback(() => {
    setEditorState((prev) => ({ ...prev, zoom: Math.min(200, prev.zoom + 10) }));
  }, []);

  const zoomOut = useCallback(() => {
    setEditorState((prev) => ({ ...prev, zoom: Math.max(50, prev.zoom - 10) }));
  }, []);

  const setTool = useCallback((tool: ToolType) => {
    setEditorState((prev) => ({ ...prev, selectedTool: tool }));
  }, []);

  const toggleEditing = useCallback(() => {
    setEditorState((prev) => ({ ...prev, isEditing: !prev.isEditing }));
  }, []);

  const nextPage = useCallback(() => {
    if (editorState.currentPage < pageCount) {
      setEditorState((prev) => ({ ...prev, currentPage: prev.currentPage + 1 }));
    }
  }, [editorState.currentPage, pageCount]);

  const prevPage = useCallback(() => {
    if (editorState.currentPage > 1) {
      setEditorState((prev) => ({ ...prev, currentPage: prev.currentPage - 1 }));
    }
  }, [editorState.currentPage]);

  const resetEditor = useCallback(() => {
    setEditorState(initialEditorState);
    setPdfData(null);
    setPageCount(0);
    pdfRef.current = null;
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      if (pdfRef.current) {
        pdfRef.current.destroy();
      }
    };
  }, []);

  return {
    pdfData,
    pageCount,
    editorState,
    isLoading,
    error,
    loadPDF,
    updatePDF,
    setCurrentPage,
    setZoom,
    zoomIn,
    zoomOut,
    setTool,
    toggleEditing,
    nextPage,
    prevPage,
    resetEditor,
  };
}