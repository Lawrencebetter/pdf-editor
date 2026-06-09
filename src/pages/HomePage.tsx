import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from '@/components/Header';
import { UploadArea } from '@/components/UploadArea';
import { readFileAsArrayBuffer, isValidPDF } from '@/utils/fileUtils';
import { getPDFPageCount } from '@/utils/pdfUtils';
import { AlertCircle, CheckCircle } from 'lucide-react';

const TEMP_FILE_KEY = 'temp_pdf_data';

const checkStorageQuota = (dataSize: number): boolean => {
  try {
    const testKey = '__storage_test__';
    sessionStorage.setItem(testKey, 'test');
    const used = JSON.stringify(sessionStorage).length;
    sessionStorage.removeItem(testKey);
    
    const overhead = 200;
    const estimatedSize = used + dataSize * 6 + overhead;
    const maxQuota = 4.5 * 1024 * 1024;
    
    return estimatedSize < maxQuota;
  } catch {
    return false;
  }
};

export function HomePage() {
  const navigate = useNavigate();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [uploadMessage, setUploadMessage] = useState('');

  const handleFileSelect = async (file: File) => {
    if (!isValidPDF(file)) {
      setUploadStatus('error');
      setUploadMessage('请选择PDF格式的文件');
      setTimeout(() => {
        setUploadStatus('idle');
        setUploadMessage('');
      }, 3000);
      return;
    }
    
    setIsUploading(true);
    setUploadStatus('idle');
    
    try {
      const data = await readFileAsArrayBuffer(file);
      
      const maxStorageSize = 5 * 1024 * 1024;
      if (file.size > maxStorageSize) {
        throw new Error('文件大小超过5MB限制');
      }
      
      const pageCount = await getPDFPageCount(data);
      
      const base64Data = btoa(String.fromCharCode(...data));
      
      const tempData = {
        id: Date.now().toString(),
        name: file.name,
        size: file.size,
        pageCount,
        data: base64Data,
      };
      
      if (!checkStorageQuota(base64Data.length)) {
        throw new Error('文件过大或浏览器存储已满，请尝试使用较小的PDF文件');
      }
      
      try {
        sessionStorage.setItem(TEMP_FILE_KEY, JSON.stringify(tempData));
      } catch (storageError) {
        throw new Error('无法保存文件，请尝试清除浏览器缓存后重试');
      }
      
      setUploadStatus('success');
      setUploadMessage('文件上传成功！');
      
      setTimeout(() => {
        navigate(`/editor/${tempData.id}`);
      }, 500);
    } catch (error) {
      console.error('Failed to upload file:', error);
      setUploadStatus('error');
      setUploadMessage(error instanceof Error ? error.message : '上传失败，请重试');
    } finally {
      setIsUploading(false);
      setTimeout(() => {
        setUploadStatus('idle');
        setUploadMessage('');
      }, 3000);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header title="PDF编辑器" />
      
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">上传PDF文件</h2>
          <p className="text-gray-600 mb-4">拖拽或选择PDF文件进行编辑</p>
          <UploadArea onFileSelect={handleFileSelect} disabled={isUploading} />
          
          {uploadStatus !== 'idle' && (
            <div className={`
              mt-4 p-4 rounded-lg flex items-center gap-3 transition-all duration-200
              ${uploadStatus === 'success' 
                ? 'bg-green-50 border border-green-200 text-green-700' 
                : 'bg-red-50 border border-red-200 text-red-700'
              }
            `}>
              {uploadStatus === 'success' ? (
                <CheckCircle className="w-5 h-5 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
              )}
              <span>{uploadMessage}</span>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">使用说明</h3>
          <ul className="space-y-2 text-gray-600">
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-500 mt-2 flex-shrink-0" />
              <span>点击或拖拽PDF文件到上传区域</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-500 mt-2 flex-shrink-0" />
              <span>文件会自动解析并显示页数</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-500 mt-2 flex-shrink-0" />
              <span>支持导出为PDF和纯文本格式</span>
            </li>
          </ul>
        </div>
      </main>
    </div>
  );
}
