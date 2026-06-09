import { useState } from 'react';
import { X, FileText, FileImage, FileDown } from 'lucide-react';
import type { ExportFormat } from '@/types';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (format: ExportFormat, filename: string) => void;
  defaultFilename: string;
}

const formats: { id: ExportFormat; icon: typeof FileText; label: string; description: string }[] = [
  { id: 'pdf', icon: FileDown, label: 'PDF', description: '保存为PDF格式' },
  { id: 'image', icon: FileImage, label: '图片', description: '导出为图片格式' },
  { id: 'text', icon: FileText, label: '文本', description: '提取文本内容' },
];

export function ExportModal({ isOpen, onClose, onExport, defaultFilename }: ExportModalProps) {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('pdf');
  const [filename, setFilename] = useState(defaultFilename);

  const handleExport = () => {
    onExport(selectedFormat, filename);
    onClose();
  };

  if (!isOpen) return null;

  const getFileExtension = () => {
    switch (selectedFormat) {
      case 'pdf': return '.pdf';
      case 'image': return '.png';
      case 'text': return '.txt';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">导出文件</h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              选择格式
            </label>
            <div className="grid grid-cols-3 gap-3">
              {formats.map((format) => (
                <button
                  key={format.id}
                  onClick={() => setSelectedFormat(format.id)}
                  className={`
                    flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200
                    ${selectedFormat === format.id
                      ? 'border-accent-500 bg-accent-50'
                      : 'border-gray-200 hover:border-gray-300'
                    }
                  `}
                >
                  <format.icon className={`w-8 h-8 ${selectedFormat === format.id ? 'text-accent-600' : 'text-gray-400'}`} />
                  <span className={`text-sm font-medium ${selectedFormat === format.id ? 'text-accent-700' : 'text-gray-700'}`}>
                    {format.label}
                  </span>
                  <span className="text-xs text-gray-500">{format.description}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              文件名
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={filename.replace(/\.[^/.]+$/, '')}
                onChange={(e) => setFilename(e.target.value + getFileExtension())}
                className="flex-1 input-field"
              />
              <span className="text-sm text-gray-400">{getFileExtension()}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="flex-1 btn-secondary"
            >
              取消
            </button>
            <button
              onClick={handleExport}
              className="flex-1 btn-accent"
            >
              导出
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}