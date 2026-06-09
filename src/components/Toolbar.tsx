import { 
  MousePointer2, 
  Type, 
  Image, 
  Hand, 
  ZoomIn, 
  ZoomOut, 
  Save, 
  Download,
  Plus,
  Trash2,
  Edit3
} from 'lucide-react';
import type { ToolType } from '@/types';

interface ToolbarProps {
  selectedTool: ToolType;
  onToolSelect: (tool: ToolType) => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  isEditing: boolean;
  onToggleEditing: () => void;
  onSave: () => void;
  onExport: () => void;
  onAddPage: () => void;
  onDeletePage: () => void;
}

const tools: { id: ToolType; icon: typeof MousePointer2; label: string }[] = [
  { id: 'select', icon: MousePointer2, label: '选择' },
  { id: 'text', icon: Type, label: '文本' },
  { id: 'image', icon: Image, label: '图片' },
  { id: 'hand', icon: Hand, label: '手型' },
  { id: 'zoom', icon: ZoomIn, label: '缩放' },
];

export function Toolbar({
  selectedTool,
  onToolSelect,
  zoom,
  onZoomIn,
  onZoomOut,
  isEditing,
  onToggleEditing,
  onSave,
  onExport,
  onAddPage,
  onDeletePage,
}: ToolbarProps) {
  return (
    <div className="bg-white border-b border-gray-200 px-4 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {tools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => onToolSelect(tool.id)}
              className={`
                p-2 rounded-lg transition-all duration-200
                ${selectedTool === tool.id
                  ? 'bg-accent-100 text-accent-700 shadow-sm'
                  : 'text-gray-500 hover:bg-gray-100'
                }
              `}
              title={tool.label}
            >
              <tool.icon className="w-5 h-5" />
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={onZoomOut}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
              title="缩小"
            >
              <ZoomOut className="w-5 h-5" />
            </button>
            <span className="text-sm font-medium text-gray-700 w-16 text-center">
              {zoom}%
            </span>
            <button
              onClick={onZoomIn}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
              title="放大"
            >
              <ZoomIn className="w-5 h-5" />
            </button>
          </div>

          <div className="h-6 w-px bg-gray-200" />

          <div className="flex items-center gap-2">
            <button
              onClick={onAddPage}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
              title="添加页面"
            >
              <Plus className="w-5 h-5" />
            </button>
            <button
              onClick={onDeletePage}
              className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              title="删除页面"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>

          <div className="h-6 w-px bg-gray-200" />

          <button
            onClick={onToggleEditing}
            className={`
              flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200
              ${isEditing
                ? 'bg-accent-100 text-accent-700'
                : 'text-gray-600 hover:bg-gray-100'
              }
            `}
          >
            <Edit3 className="w-4 h-4" />
            <span className="text-sm font-medium">{isEditing ? '退出编辑' : '编辑模式'}</span>
          </button>

          <button
            onClick={onSave}
            className="btn-primary flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            <span>保存</span>
          </button>

          <button
            onClick={onExport}
            className="btn-accent flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            <span>导出</span>
          </button>
        </div>
      </div>
    </div>
  );
}