import { useEffect, useRef } from 'react';
import { renderPDFPage } from '@/utils/pdfUtils';
import { ChevronLeft, ChevronRight, Loader2, AlertCircle } from 'lucide-react';

interface PDFViewerProps {
  pdfData: Uint8Array | null;
  currentPage: number;
  pageCount: number;
  zoom: number;
  onNextPage: () => void;
  onPrevPage: () => void;
  isLoading: boolean;
  error: string | null;
}

export function PDFViewer({
  pdfData,
  currentPage,
  pageCount,
  zoom,
  onNextPage,
  onPrevPage,
  isLoading,
  error,
}: PDFViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pdfData || !canvasRef.current) return;

    const doRender = async () => {
      try {
        await renderPDFPage(pdfData, currentPage, canvasRef.current!, zoom / 100);
      } catch (err) {
        console.error('Failed to render PDF page:', err);
      }
    };

    doRender();
  }, [pdfData, currentPage, zoom]);

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-accent-600 animate-spin" />
          <p className="text-gray-500">加载PDF中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4">
          <AlertCircle className="w-16 h-16 text-red-500" />
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 bg-white overflow-auto"
      onWheel={handleWheel}
    >
      <div className="flex flex-col items-center py-4">
        <div className="mb-4">
          <button
            onClick={onPrevPage}
            disabled={currentPage <= 1}
            className="p-2 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <span className="mx-4 px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">
            {currentPage} / {pageCount}
          </span>
          <button
            onClick={onNextPage}
            disabled={currentPage >= pageCount}
            className="p-2 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        <div
          className="overflow-auto"
          style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top center' }}
        >
          <canvas
            ref={canvasRef}
            className="border border-gray-200 rounded-lg shadow-sm"
          />
        </div>
      </div>
    </div>
  );
}
