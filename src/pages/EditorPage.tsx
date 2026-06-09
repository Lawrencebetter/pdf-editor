import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Header } from '@/components/Header';
import { Toolbar } from '@/components/Toolbar';
import { PDFViewer } from '@/components/PDFViewer';
import { ExportModal } from '@/components/ExportModal';
import { downloadFile } from '@/utils/fileUtils';
import { exportPDFAsText, addPageToPDF, removePageFromPDF, getPDFPageCount } from '@/utils/pdfUtils';
import type { ExportFormat } from '@/types';
import { Loader2, AlertCircle } from 'lucide-react';

const TEMP_FILE_KEY = 'temp_pdf_data';

interface EditorState {
  currentPage: number;
  zoom: number;
  isEditing: boolean;
}

export function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [editorState, setEditorState] = useState<EditorState>({
    currentPage: 1,
    zoom: 100,
    isEditing: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingPage, setIsAddingPage] = useState(false);
  const [isDeletingPage, setIsDeletingPage] = useState(false);

  useEffect(() => {
    if (!id) {
      navigate('/');
      return;
    }

    const stored = sessionStorage.getItem(TEMP_FILE_KEY);
    if (!stored) {
      navigate('/');
      return;
    }

    try {
      const tempData = JSON.parse(stored);
      if (tempData.id !== id) {
        navigate('/');
        return;
      }

      const binary = atob(tempData.data);
      const data = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      setPdfData(data);
      setPageCount(tempData.pageCount);
      setFileName(tempData.name);
    } catch {
      navigate('/');
    } finally {
      setIsLoading(false);
    }
  }, [id, navigate]);

  const handleExport = useCallback(async (format: ExportFormat, filename: string) => {
    if (!pdfData) return;
    
    try {
      switch (format) {
        case 'pdf':
          downloadFile(pdfData, filename, 'application/pdf');
          break;
        case 'text':
          const text = await exportPDFAsText(pdfData);
          const textBytes = new TextEncoder().encode(text);
          downloadFile(textBytes, filename.replace('.pdf', '.txt'), 'text/plain');
          break;
        case 'image':
          break;
      }
    } catch (error) {
      console.error('Export failed:', error);
    }
  }, [pdfData]);

  const handleSave = useCallback(async () => {
    if (!pdfData || !id) return;
    
    setIsSaving(true);
    try {
      const pageCount = await getPDFPageCount(pdfData);
      const base64Data = btoa(String.fromCharCode(...pdfData));
      const tempData = {
        id,
        name: fileName,
        size: pdfData.length,
        pageCount,
        data: base64Data,
      };
      sessionStorage.setItem(TEMP_FILE_KEY, JSON.stringify(tempData));
      alert('保存成功');
    } catch (error) {
      console.error('Save failed:', error);
      alert('保存失败');
    } finally {
      setIsSaving(false);
    }
  }, [pdfData, id, fileName]);

  const handleAddPage = useCallback(async () => {
    if (!pdfData) return;
    
    setIsAddingPage(true);
    try {
      const newData = await addPageToPDF(pdfData);
      setPdfData(newData);
      const count = await getPDFPageCount(newData);
      setPageCount(count);
      
      const base64Data = btoa(String.fromCharCode(...newData));
      const tempData = {
        id: id!,
        name: fileName,
        size: newData.length,
        pageCount: count,
        data: base64Data,
      };
      sessionStorage.setItem(TEMP_FILE_KEY, JSON.stringify(tempData));
    } catch (error) {
      console.error('Add page failed:', error);
    } finally {
      setIsAddingPage(false);
    }
  }, [pdfData, id, fileName]);

  const handleDeletePage = useCallback(async () => {
    if (!pdfData || pageCount <= 1) return;
    
    if (!confirm('确定要删除当前页面吗？')) return;
    
    setIsDeletingPage(true);
    try {
      const pageIndex = editorState.currentPage - 1;
      const newData = await removePageFromPDF(pdfData, pageIndex);
      setPdfData(newData);
      const count = await getPDFPageCount(newData);
      setPageCount(count);
      
      if (editorState.currentPage > count) {
        setEditorState((prev) => ({ ...prev, currentPage: count }));
      }
      
      const base64Data = btoa(String.fromCharCode(...newData));
      const tempData = {
        id: id!,
        name: fileName,
        size: newData.length,
        pageCount: count,
        data: base64Data,
      };
      sessionStorage.setItem(TEMP_FILE_KEY, JSON.stringify(tempData));
    } catch (error) {
      console.error('Delete page failed:', error);
    } finally {
      setIsDeletingPage(false);
    }
  }, [pdfData, pageCount, editorState.currentPage, id, fileName]);

  const handleBack = useCallback(() => {
    navigate('/');
  }, [navigate]);

  const zoomIn = useCallback(() => {
    setEditorState((prev) => ({ ...prev, zoom: Math.min(200, prev.zoom + 10) }));
  }, []);

  const zoomOut = useCallback(() => {
    setEditorState((prev) => ({ ...prev, zoom: Math.max(50, prev.zoom - 10) }));
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="PDF编辑器" showBack onBack={handleBack} />
        <main className="flex items-center justify-center h-[calc(100vh-64px)]">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 text-accent-600 animate-spin" />
            <p className="text-gray-500">加载PDF中...</p>
          </div>
        </main>
      </div>
    );
  }

  if (!pdfData) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title="PDF编辑器" showBack onBack={handleBack} />
        <main className="flex items-center justify-center h-[calc(100vh-64px)]">
          <div className="text-center">
            <AlertCircle className="w-16 h-16 mx-auto mb-4 text-yellow-500" />
            <p className="text-gray-600">文件不存在</p>
            <button onClick={handleBack} className="mt-4 px-6 py-2 bg-accent-600 text-white rounded-lg hover:bg-accent-700 transition-colors">
              返回首页
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header title={fileName} showBack onBack={handleBack} />
      
      <Toolbar
        selectedTool="select"
        onToolSelect={() => {}}
        zoom={editorState.zoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        isEditing={editorState.isEditing}
        onToggleEditing={toggleEditing}
        onSave={handleSave}
        onExport={() => setIsExportModalOpen(true)}
        onAddPage={handleAddPage}
        onDeletePage={handleDeletePage}
      />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <PDFViewer
          pdfData={pdfData}
          currentPage={editorState.currentPage}
          pageCount={pageCount}
          zoom={editorState.zoom}
          onNextPage={nextPage}
          onPrevPage={prevPage}
          isLoading={isAddingPage || isDeletingPage}
          error={error}
        />
      </div>

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        onExport={handleExport}
        defaultFilename={fileName}
      />

      {isSaving && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 flex items-center gap-4">
            <Loader2 className="w-6 h-6 text-accent-600 animate-spin" />
            <span className="text-gray-700">保存中...</span>
          </div>
        </div>
      )}
    </div>
  );
}
