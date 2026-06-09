import { useState, useCallback, DragEvent } from 'react';
import { Upload, FileImage } from 'lucide-react';
import { isValidPDF } from '@/utils/fileUtils';

interface UploadAreaProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
}

export function UploadArea({ onFileSelect, disabled = false }: UploadAreaProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      setError(null);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        const file = files[0];
        if (isValidPDF(file)) {
          onFileSelect(file);
        } else {
          setError('请选择PDF格式的文件');
        }
      }
    },
    [onFileSelect]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        const file = files[0];
        if (isValidPDF(file)) {
          setError(null);
          onFileSelect(file);
        } else {
          setError('请选择PDF格式的文件');
        }
      }
    },
    [onFileSelect]
  );

  return (
    <div
      className={`
        relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-200
        ${isDragging 
          ? 'border-accent-500 bg-accent-50' 
          : 'border-gray-300 hover:border-accent-400 hover:bg-gray-50'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
      onDragOver={disabled ? undefined : handleDragOver}
      onDragLeave={disabled ? undefined : handleDragLeave}
      onDrop={disabled ? undefined : handleDrop}
      onClick={() => !disabled && document.getElementById('file-input')?.click()}
    >
      <input
        id="file-input"
        type="file"
        accept=".pdf"
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled}
      />
      
      <div className="flex flex-col items-center gap-4">
        <div className={`
          w-16 h-16 rounded-full flex items-center justify-center
          ${isDragging ? 'bg-accent-100' : 'bg-gray-100'}
        `}>
          {isDragging ? (
            <FileImage className="w-8 h-8 text-accent-600" />
          ) : (
            <Upload className="w-8 h-8 text-gray-400" />
          )}
        </div>
        
        <div>
          <p className={`
            text-lg font-semibold mb-1
            ${isDragging ? 'text-accent-700' : 'text-gray-700'}
          `}>
            {isDragging ? '释放以上传文件' : '拖拽PDF文件到此处'}
          </p>
          <p className="text-sm text-gray-500">
            或点击选择文件
          </p>
        </div>
        
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="px-2 py-1 bg-gray-100 rounded">PDF</span>
          <span>最大 50MB</span>
        </div>
      </div>
      
      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}