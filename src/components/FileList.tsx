import { FileText, Trash2, Eye, Clock } from 'lucide-react';
import type { FileMetadata } from '@/types';
import { formatFileSize, formatDate } from '@/utils/fileUtils';

interface FileListProps {
  files: FileMetadata[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

export function FileList({ files, onOpen, onDelete }: FileListProps) {
  if (files.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
          <FileText className="w-8 h-8 text-gray-400" />
        </div>
        <p className="text-gray-500">暂无PDF文件</p>
        <p className="text-sm text-gray-400 mt-1">上传您的第一个PDF文件开始编辑</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {files.map((file) => (
        <div
          key={file.id}
          className="card hover:shadow-md transition-shadow cursor-pointer group"
          onClick={() => onOpen(file.id)}
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <FileText className="w-6 h-6 text-primary-600" />
            </div>
            
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-gray-900 truncate">
                {file.name}
              </h3>
              <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                <span>{formatFileSize(file.size)}</span>
                <span>{file.pageCount} 页</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {formatDate(file.uploadTime)}
                </span>
              </div>
            </div>
            
            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(file.id);
                }}
                className="p-2 text-gray-400 hover:text-accent-600 hover:bg-accent-50 rounded-lg transition-colors"
                title="打开文件"
              >
                <Eye className="w-5 h-5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(file.id);
                }}
                className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                title="删除文件"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}