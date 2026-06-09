import { useState, useCallback, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { Header } from '@/components/Header';
import { UploadArea } from '@/components/UploadArea';
import { readFileAsArrayBuffer, isValidPDF } from '@/utils/fileUtils';
import { getPDFPageCount, exportPDFAsText } from '@/utils/pdfUtils';
import { AlertCircle, CheckCircle, ZoomIn, ZoomOut, Download, Plus, Trash2, ChevronLeft, ChevronRight, Loader2, FileText, Lock, Clock, Shield, XCircle } from 'lucide-react';
import { PDFDocument as PDFLibDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { useLanguage } from './i18n';

// ============================================================
//  🔐 访问控制配置（部署前请修改这些值）
// ============================================================
const ACCESS_CONFIG = {
  // ─── 超级管理员口令（永久权限，可生成口令）───
  masterPassword: 'admin888',

  // ─── 默认访问口令（普通用户使用）───
  password: 'pdf2026',

  // ─── 普通用户会话保持时长（小时）───
  // 设为 0 表示每次都需要输入
  validHours: 24,

  // ─── 普通用户最大使用时长（小时）───
  // 从首次登录开始计算，设为 0 表示不限制
  maxUsageHours: 2160,  // 3个月（90天 × 24小时）
};

// LocalStorage 键名
const AUTH_STORAGE_KEY = 'pdf_editor_auth';
const GENERATED_CODES_KEY = 'pdf_editor_generated_codes';

// 生成的口令类型
interface GeneratedCode {
  code: string;           // 口令内容
  label: string;          // 备注/标签（如"张三-3天"）
  validHours: number;     // 有效时长（小时）
  maxUsageHours: number;  // 总可用时长（小时），0=不限
  createdAt: number;      // 创建时间戳
  usedCount: number;      // 已被使用次数
}

// ============================================================

if (typeof window !== 'undefined') {
  const scriptUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url);
  pdfjsLib.GlobalWorkerOptions.workerSrc = scriptUrl.href;
}

function App() {
  const { t } = useLanguage();

  // ──────────────────────────────────────────────
  // 🔐 口令认证状态
  // ──────────────────────────────────────────────
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);           // 是否超级管理员
  const [authInput, setAuthInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [authExpiryInfo, setAuthExpiryInfo] = useState<string | null>(null);

  // ── 管理员面板状态 ──
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [generatedCodes, setGeneratedCodes] = useState<GeneratedCode[]>([]);
  const [newCodeLabel, setNewCodeLabel] = useState('');
  const [newCodeValidHours, setNewCodeValidHours] = useState(24);
  const [newCodeMaxHours, setNewCodeMaxHours] = useState(72);
  const [lastGeneratedCode, setLastGeneratedCode] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  // ✅ 加载已生成的口令列表
  useEffect(() => {
    try {
      const stored = localStorage.getItem(GENERATED_CODES_KEY);
      if (stored) setGeneratedCodes(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  // ✅ 不自动恢复登录状态 — 每次刷新页面都需要重新输入口令
  // （localStorage 仅用于存储生成口令列表等持久数据）

  // ✅ 验证口令（支持三种：管理员 / 默认口令 / 生成口令）
  const handleAuthSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    const input = authInput.trim();
    const now = Date.now();

    // ── 1. 超级管理员 ──
    if (input === ACCESS_CONFIG.masterPassword) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
        loginTime: now, firstLoginTime: now, isAdmin: true,
      }));
      flushSync(() => { setIsAuthenticated(true); setIsAdmin(true); });
      setAuthExpiryInfo('👑 管理员 · 永久权限');
      return;
    }

    // ── 2. 默认口令 ──
    if (input === ACCESS_CONFIG.password) {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      let firstLoginTime = now;
      if (stored) {
        try { firstLoginTime = JSON.parse(stored).firstLoginTime || now; } catch { /* ignore */ }
      }
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
        loginTime: now, firstLoginTime,
        codeConfig: { validHours: ACCESS_CONFIG.validHours, maxUsageHours: ACCESS_CONFIG.maxUsageHours },
      }));
      flushSync(() => setIsAuthenticated(true));
      if (ACCESS_CONFIG.maxUsageHours > 0) setAuthExpiryInfo(`剩余 ${ACCESS_CONFIG.maxUsageHours} 小时`);
      return;
    }

    // ── 3. 生成的口令 ──
    const codeEntry = generatedCodes.find(c => c.code === input);
    if (codeEntry) {
      // 更新使用次数
      const updated = generatedCodes.map(c =>
        c.code === input ? { ...c, usedCount: c.usedCount + 1 } : c
      );
      setGeneratedCodes(updated);
      localStorage.setItem(GENERATED_CODES_KEY, JSON.stringify(updated));

      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      let firstLoginTime = now;
      if (stored) {
        try { firstLoginTime = JSON.parse(stored).firstLoginTime || now; } catch { /* ignore */ }
      }
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
        loginTime: now, firstLoginTime,
        codeConfig: { validHours: codeEntry.validHours, maxUsageHours: codeEntry.maxUsageHours },
      }));
      flushSync(() => setIsAuthenticated(true));
      if (codeEntry.maxUsageHours > 0) setAuthExpiryInfo(`剩余 ${codeEntry.maxUsageHours} 小时`);
      return;
    }

    setAuthError('❌ 口令错误，请重新输入');
  }, [authInput, generatedCodes]);

  // ── 管理员：生成新口令 ──
  const handleGenerateCode = useCallback(() => {
    if (!newCodeLabel.trim()) return;

    // 生成随机6位口令（字母+数字）
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉易混淆字符
    let code = '';
    for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));

    const newCode: GeneratedCode = {
      code,
      label: newCodeLabel.trim(),
      validHours: newCodeValidHours,
      maxUsageHours: newCodeMaxHours,
      createdAt: Date.now(),
      usedCount: 0,
    };

    const updated = [...generatedCodes, newCode];
    setGeneratedCodes(updated);
    localStorage.setItem(GENERATED_CODES_KEY, JSON.stringify(updated));
    setLastGeneratedCode(code);
    setNewCodeLabel('');
    setCopySuccess(false);
  }, [newCodeLabel, newCodeValidHours, newCodeMaxHours, generatedCodes]);

  // ── 管理员：复制口令到剪贴板 ──
  const handleCopyCode = useCallback(async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch { /* ignore */ }
  }, []);

  // ── 管理员：删除生成的口令 ──
  const handleDeleteCode = useCallback((codeToDelete: string) => {
    const updated = generatedCodes.filter(c => c.code !== codeToDelete);
    setGeneratedCodes(updated);
    localStorage.setItem(GENERATED_CODES_KEY, JSON.stringify(updated));
  }, [generatedCodes]);

  // ──────────────────────────────────────────────
  // 原有状态
  // ──────────────────────────────────────────────
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [uploadMessage, setUploadMessage] = useState('');
  
  const [pdfData, setPdfData] = useState<Uint8Array | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [pdfUrl, setPdfUrl] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [textContent, setTextContent] = useState('');
  const [fontColor, setFontColor] = useState('#333333');
  const [textColor, setTextColor] = useState('#333333');
  const [fontSize, setFontSize] = useState(16);
  const [fontFamily, setFontFamily] = useState('Arial');
  const [fontBold, setFontBold] = useState(false);
  const [fontItalic, setFontItalic] = useState(false);
  const [fontUnderline, setFontUnderline] = useState(false);
  const [fontDoubleUnderline, setFontDoubleUnderline] = useState(false);
  const [fontStrikethrough, setFontStrikethrough] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showTextColorPicker, setShowTextColorPicker] = useState(false);
  const [editTool, setEditTool] = useState<'select' | 'shape-select' | 'brush' | 'eraser' | 'rectangle' | 'text' | 'image' | 'circle' | 'line' | 'arrow'>('brush');
  const [brushSize, setBrushSize] = useState(3);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [history, setHistory] = useState<string[]>([]);
  const [textHistory, setTextHistory] = useState<TextItem[][]>([]);
  const [redoHistory, setRedoHistory] = useState<string[]>([]);
  const [redoTextHistory, setRedoTextHistory] = useState<TextItem[][]>([]);
  const [imageHistory, setImageHistory] = useState<ImageItem[][]>([]);
  const [redoImageHistory, setRedoImageHistory] = useState<ImageItem[][]>([]);
  
  interface TextItem {
    id: string;
    text: string;
    x: number;
    y: number;
    color: string;
    fontSize: number;
    fontFamily: string;
    fontBold: boolean;
    fontItalic: boolean;
    fontUnderline: boolean;
    fontDoubleUnderline: boolean;
    fontStrikethrough: boolean;
  }

  interface ImageItem {
    id: string;
    src: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }

  interface ShapeItem {
    id: string;
    type: 'rectangle' | 'circle' | 'line' | 'arrow';
    x: number;
    y: number;
    width: number;
    height: number;
    endX: number;
    endY: number;
    color: string;
    lineWidth: number;
    rotation?: number;
  }

  const [textItems, setTextItems] = useState<TextItem[]>([]);
  const [imageItems, setImageItems] = useState<ImageItem[]>([]);
  const [shapeItems, setShapeItems] = useState<ShapeItem[]>([]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [dragImageOffset, setDragImageOffset] = useState({ x: 0, y: 0 });
  const [isResizingImage, setIsResizingImage] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const [imageCursor, setImageCursor] = useState<string>('default');
  const [isDraggingShape, setIsDraggingShape] = useState(false);
  const [isRotatingShape, setIsRotatingShape] = useState(false);
  const [dragShapeOffset, setDragShapeOffset] = useState({ x: 0, y: 0 });
  const [showFindReplace, setShowFindReplace] = useState(false);
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [showPageSorter, setShowPageSorter] = useState(false);
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [draggedPageIndex, setDraggedPageIndex] = useState<number | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const shapeSnapshotRef = useRef<ImageData | null>(null);

  // ✅ 每页独立的编辑内容存储
  const pageEditDataRef = useRef<Map<number, {
    textItems: TextItem[];
    imageItems: ImageItem[];
    shapeItems: ShapeItem[];
    drawHistory: string[];
    textHistoryList: TextItem[][];
  }>>(new Map());

  // ✅ 存储完整编辑后的PDF数据（所有页面合并）
  const savedEditedPdfRef = useRef<Uint8Array | null>(null);

  const standardColors = [
    '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff',
    '#ffff00', '#ff00ff', '#00ffff', '#808080', '#800000',
    '#808000', '#008000', '#800080', '#008080', '#000080',
    '#ff6347', '#ffa500', '#ffc0cb', '#87ceeb', '#98fb98',
    '#da70d6', '#ffd700', '#cd5c5c', '#40e0d0', '#9370db'
  ];

  // ✅ 字体分类列表（含中英文、系统字体、装饰字体）
  const fontCategories = [
    {
      label: '🔤 无衬线体 (Sans-serif)',
      fonts: [
        { name: 'Arial', value: 'Arial' },
        { name: 'Arial Black', value: 'Arial Black' },
        { name: 'Helvetica Neue', value: '"Helvetica Neue", Helvetica' },
        { name: 'Verdana', value: 'Verdana' },
        { name: 'Tahoma', value: 'Tahoma' },
        { name: 'Trebuchet MS', value: '"Trebuchet MS"' },
        { name: 'Impact', value: 'Impact' },
        { name: 'Comic Sans MS', value: '"Comic Sans MS"' },
        { name: 'Segoe UI', value: '"Segoe UI"' },
        { name: 'Calibri', value: 'Calibri' },
        { name: 'Candara', value: 'Candara' },
        { name: 'Corbel', value: 'Corbel' },
        { name: 'Futura', value: 'Futura, "Futura PT"' },
        { name: 'Optima', value: 'Optima' },
        { name: 'Lucida Grande', value: '"Lucida Grande"' },
      ],
    },
    {
      label: '📖 衬线体 (Serif)',
      fonts: [
        { name: 'Times New Roman', value: '"Times New Roman"' },
        { name: 'Georgia', value: 'Georgia' },
        { name: 'Palatino', value: '"Palatino Linotype", "Book Antiqua", Palatino' },
        { name: 'Garamond', value: 'Garamond, "EB Garamond"' },
        { name: 'Bookman', value: '"Bookman Old Style", Bookman' },
        { name: 'Cambria', value: 'Cambria' },
        { name: 'Constantia', value: 'Constantia' },
        { name: 'Baskerville', value: 'Baskerville, "Baskerville Old Face"' },
        { name: 'Didot', value: 'Didot' },
        { name: 'Hoefler Text', value: '"Hoefler Text"' },
        { name: 'Times', value: 'Times' },
        { name: 'American Typewriter', value: '"American Typewriter"' },
        { name: 'Rockwell', value: 'Rockwell, "Courier Bold"' },
      ],
    },
    {
      label: '⌨️ 等宽字体 (Monospace)',
      fonts: [
        { name: 'Courier New', value: '"Courier New"' },
        { name: 'Consolas', value: 'Consolas' },
        { name: 'Monaco', value: 'Monaco' },
        { name: 'Menlo', value: 'Menlo' },
        { name: 'Lucida Console', value: '"Lucida Console"' },
        { name: '"Source Code Pro"', value: '"Source Code Pro", monospace' },
        { name: '"Fira Code"', value: '"Fira Code", monospace' },
      ],
    },
    {
      label: '🇨🇳 中文字体',
      fonts: [
        { name: '宋体 SimSun', value: 'SimSun, "STSong", serif' },
        { name: '黑体 SimHei', value: 'SimHei, sans-serif' },
        { name: '微软雅黑 YaHei', value: '"Microsoft YaHei", "PingFang SC", sans-serif' },
        { name: '微软正黑 JhengHei', value: '"Microsoft JhengHei", "PingFang TC", sans-serif' },
        { name: '苹方 PingFang SC', value: '"PingFang SC", "Hiragino Sans GB", sans-serif' },
        { name: '冬青黑体 Hiragino', value: '"Hiragino Sans GB", "PingFang SC", sans-serif' },
        { name: '华文宋体 STSong', value: '"STSong", SimSun, serif' },
        { name: '华文黑体 STHeiti', value: '"STHeiti", SimHei, sans-serif' },
        { name: '华文楷体 STKaiti', value: '"STKaiti", KaiTi, serif' },
        { name: '华文仿宋 STFangsong', value: '"STFangsong", FangSong, serif' },
        { name: '仿宋 FangSong', value: 'FangSong, "STFangsong", serif' },
        { name: '楷体 KaiTi', value: 'KaiTi, "STKaiti", serif' },
        { name: '隶书 LiSu', value: 'LiSu, cursive' },
        { name: '幼圆 YouYuan', value: 'YouYuan, sans-serif' },
        { name: '华文行楷 STXingkai', value: '"STXingkai", cursive' },
        { name: '行楷 Xingkai', value: 'Xingkai SC, "STXingkai", cursive' },
        { name: '方正舒体', value: '"FZShuTi", cursive' },
        { name: '方正姚体', value: '"FZYaoti", cursive' },
      ],
    },
    {
      label: '🎨 装饰/手写体 (Display)',
      fonts: [
        { name: 'Papyrus', value: 'Papyrus' },
        { name: 'Copperplate', value: 'Copperplate, "Copperplate Gothic Light"' },
        { name: 'Brush Script MT', value: '"Brush Script MT", cursive' },
        { name: 'Bradley Hand', value: '"Bradley Hand", cursive' },
        { name: 'Chalkboard', value: 'Chalkboard, "Chalkboard SE"' },
        { name: 'Snell Roundhand', value: '"Snell Roundhand", cursive' },
        { name: 'Zapfino', value: 'Zapfino, cursive' },
        { name: 'Marker Felt', value: '"Marker Felt", cursive' },
        { name: 'Party LET', value: '"Party LET", cursive' },
        { name: 'Noteworthy', value: 'Noteworthy, cursive' },
        { name: 'SignPainter', value: '"SignPainter", "Herculanum", cursive' },
        { name: 'Savoye LET', value: '"Savoye LET", cursive' },
        { name: 'Apple Chancery', value: '"Apple Chancery", cursive' },
        { name: 'Bodoni Ornaments', value: '"Bodoni Ornaments"' },
        { name: 'Rosewood', value: 'Rosewood, "Fantasy"' },
      ],
    },
  ];

  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const editCanvasRef = useRef<HTMLCanvasElement>(null);
  const textCanvasRef = useRef<HTMLCanvasElement>(null);
  const shapeCanvasRef = useRef<HTMLCanvasElement>(null);
  // ✅ 保存每页的实际渲染信息（用于坐标校正）
  const pdfRenderInfoRef = useRef<{
    scale: number;
    offsetX: number;
    offsetY: number;
    renderWidth: number;   // 实际渲染宽度
    renderHeight: number;  // 实际渲染高度
  } | null>(null);

  // ✅ HiDPI (Retina) 高清渲染常量与辅助函数
  const CANVAS_BASE_WIDTH = 800;
  const CANVAS_BASE_HEIGHT = 1056;

  const setupHiDPICanvas = useCallback((canvas: HTMLCanvasElement) => {
    // ✅ 强制最小2倍分辨率，避免Mac缩放导致DPR<1反而更模糊
    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    canvas.width = CANVAS_BASE_WIDTH * dpr;
    canvas.height = CANVAS_BASE_HEIGHT * dpr;
    return dpr;
  }, []);

  const renderPDFToBackground = useCallback(async () => {
    if (!pdfData || !pdfCanvasRef.current) return;

    const canvas = pdfCanvasRef.current;
    const dpr = setupHiDPICanvas(canvas);

    console.log(`[PDF_BG] Starting render for page ${currentPage}`);
    console.log(`[PDF_BG] pdfData size: ${pdfData.length} bytes`);

    try {
      const dataCopy = Uint8Array.from(pdfData);
      console.log('[PDF_BG] Creating PDF document...');
      const pdf = await pdfjsLib.getDocument({
        data: dataCopy,
        cMapUrl: 'https://unpkg.com/pdfjs-dist@4.10.38/cmaps/',
        cMapPacked: true,
        useSystemFonts: true,
      }).promise;

      console.log(`[PDF_BG] PDF loaded, pages: ${pdf.numPages}`);
      const page = await pdf.getPage(currentPage);

      const baseViewport = page.getViewport({ scale: 1.0 });
      console.log(`[PDF_BG] Base viewport: ${baseViewport.width} x ${baseViewport.height}`);

      const scaleX = 800 / baseViewport.width;
      const scaleY = 1056 / baseViewport.height;
      const scale = Math.min(scaleX, scaleY);
      const viewport = page.getViewport({ scale });

      pdfRenderInfoRef.current = {
        scale,
        offsetX: 0,
        offsetY: 0,
        renderWidth: viewport.width,
        renderHeight: viewport.height,
      };

      console.log(`[PDF_BG] Final scale: ${scale.toFixed(4)}, Viewport: ${viewport.width.toFixed(1)} x ${viewport.height.toFixed(1)}`);

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.error('[PDF_BG] Cannot get 2d context');
        return;
      }

      // ✅ HiDPI: 缩放context使绘制坐标保持逻辑分辨率
      ctx.scale(dpr, dpr);

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, CANVAS_BASE_WIDTH, CANVAS_BASE_HEIGHT);

      console.log(`[PDF_BG] 🔍 HiDPI诊断: DPR=${dpr}, Canvas=${canvas.width}x${canvas.height}, CSS=800x1056`);
      console.log('[PDF_BG] Rendering page to canvas...');
      const renderTask = page.render({
        canvasContext: ctx,
        viewport,
        intent: 'print',
      });

      await renderTask.promise;

      console.log('[PDF_BG] ✅ Render completed successfully!');
      console.log(`[PDF_BG] Canvas size: ${canvas.width} x ${canvas.height}`);

    } catch (err) {
      console.error('[PDF_BG] ❌ Render failed with error:', err);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, CANVAS_BASE_WIDTH, CANVAS_BASE_HEIGHT);
        ctx.fillStyle = '#cc0000';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('PDF渲染失败', CANVAS_BASE_WIDTH / 2, CANVAS_BASE_HEIGHT / 2);
        ctx.font = '12px Arial';
        ctx.fillText(String(err), CANVAS_BASE_WIDTH / 2, CANVAS_BASE_HEIGHT / 2 + 22);
      }
    }
  }, [pdfData, currentPage]);

  // ✅ 使用ref存储最新渲染函数（避免callback ref因依赖变化而重建）
  const renderPDFToBackgroundRef = useRef(renderPDFToBackground);
  renderPDFToBackgroundRef.current = renderPDFToBackground;

  // ✅ 用ref存储最新编辑状态（避免闭包陷阱）
  const textItemsRef = useRef(textItems);
  textItemsRef.current = textItems;
  const historyRef = useRef(history);
  historyRef.current = history;
  const textHistoryRef = useRef(textHistory);
  textHistoryRef.current = textHistory;
  const imageItemsRef = useRef(imageItems);
  imageItemsRef.current = imageItems;
  const shapeItemsRef = useRef(shapeItems);
  shapeItemsRef.current = shapeItems;
  const selectedShapeIdRef = useRef(selectedShapeId);
  selectedShapeIdRef.current = selectedShapeId;
  const selectedTextIdRef = useRef(selectedTextId);
  selectedTextIdRef.current = selectedTextId;
  const selectedImageIdRef = useRef(selectedImageId);
  selectedImageIdRef.current = selectedImageId;

  // ✅ 稳定的callback ref（不依赖变化的函数）
  const pdfCanvasCallbackRef = useCallback((node: HTMLCanvasElement | null) => {
    (pdfCanvasRef as React.MutableRefObject<HTMLCanvasElement | null>).current = node;

    if (node && pdfData) {
      console.log('[CANVAS_CALLBACK] ✅ PDF canvas mounted! Triggering render...');
      setTimeout(() => {
        if (pdfCanvasRef.current) {
          console.log('[CANVAS_CALLBACK] Executing delayed render...');
          renderPDFToBackgroundRef.current();  // 使用ref调用最新函数
        }
      }, 100);
    }
  }, [pdfData]);  // ✅ 只依赖pdfData，不再依赖renderPDFToBackground

  const handleFileSelect = useCallback(async (file: File) => {
    if (!isValidPDF(file)) {
      setUploadStatus('error');
      setUploadMessage(t('upload.selectPdf'));
      setTimeout(() => {
        setUploadStatus('idle');
        setUploadMessage('');
      }, 3000);
      return;
    }
    
    setIsUploading(true);
    setUploadStatus('idle');
    setError(null);
    
    try {
      const data = await readFileAsArrayBuffer(file);
      const count = await getPDFPageCount(data);
      
      setPdfData(data);
      setPageCount(count);
      setCurrentPage(1);
      setZoom(100);
      setFileName(file.name);
      
      const blob = new Blob([data as unknown as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);

      setUploadStatus('success');
      setUploadMessage('文件上传成功！');
      setTimeout(() => {
        setUploadStatus('idle');
        setUploadMessage('');
      }, 3000);
      
      // 延迟渲染PDF，确保Canvas已挂载到DOM
      setTimeout(async () => {
        console.log('[DELAYED_RENDER] Triggering render after file upload...');
        if (pdfCanvasRef.current) {
          console.log('[DELAYED_RENDER] Canvas found, rendering...');
          await renderPDFToBackground();
        } else {
          console.error('[DELAYED_RENDER] Canvas still not available!');
          // 如果还没好，再等一下
          setTimeout(async () => {
            console.log('[DELAYED_RENDER] Second attempt...');
            if (pdfCanvasRef.current) {
              await renderPDFToBackground();
            } else {
              console.error('[DELAYED_RENDER] Canvas still not available after second attempt!');
            }
          }, 200);
        }
      }, 500);
      
    } catch (err) {
      console.error('Failed to upload file:', err);
      setUploadStatus('error');
      setUploadMessage(err instanceof Error ? err.message : '上传失败，请重试');
      setTimeout(() => {
        setUploadStatus('idle');
        setUploadMessage('');
      }, 3000);
    } finally {
      setIsUploading(false);
    }
  }, [renderPDFToBackground]);

  // ✅ 翻页后恢复目标页数据（保存已在翻页按钮中完成）
  useEffect(() => {
    if (!pdfData) return;  // 即使不在编辑模式也执行，以便准备好数据

    console.log(`[PAGE_RESTORE] Restoring page ${currentPage} data...`);

    const savedData = pageEditDataRef.current.get(currentPage);

    if (savedData) {
      // 恢复该页的编辑数据
      setTextItems(savedData.textItems);
      setHistory(savedData.drawHistory);
      setTextHistory(savedData.textHistoryList);
      setImageItems(savedData.imageItems || []);
      setShapeItems(savedData.shapeItems || []);
      setSelectedTextId(null);
      setSelectedImageId(null);
      setSelectedShapeId(null);
      setIsDrawing(false);

      // ✅ 延迟恢复绘制层Canvas（确保其他初始化effect先执行完）
      const restoreCanvas = () => {
        if (!editCanvasRef.current) {
          console.warn('[PAGE_RESTORE] Edit canvas not ready, retrying in 50ms...');
          setTimeout(restoreCanvas, 50);
          return;
        }

        const ctx = editCanvasRef.current.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, CANVAS_BASE_WIDTH, CANVAS_BASE_HEIGHT);

        if (savedData.drawHistory.length > 0) {
          // 使用最后一条历史记录恢复canvas（HiDPI快照需指定目标尺寸）
          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, 0, 0, CANVAS_BASE_WIDTH, CANVAS_BASE_HEIGHT);
            console.log(`[PAGE_RESTORE] ✅ Page ${currentPage} drawing restored (${savedData.drawHistory.length} history items)`);
          };
          img.src = savedData.drawHistory[savedData.drawHistory.length - 1];
        }

        console.log(`[PAGE_RESTORE] ✅ Page ${currentPage} restored: ${savedData.textItems.length} texts, ${savedData.imageItems?.length || 0} images`);
      };

      // ✅ 使用requestAnimationFrame确保在当前渲染周期之后执行
      requestAnimationFrame(() => {
        setTimeout(restoreCanvas, 100);  // 额外延迟确保所有useEffect完成
      });

    } else {
      // 该页首次访问，清除所有编辑层
      setTextItems([]);
      setHistory([]);
      setTextHistory([]);
      setImageItems([]);
      setShapeItems([]);
      setSelectedTextId(null);
      setSelectedImageId(null);
      setSelectedShapeId(null);
      setIsDrawing(false);

      // ✅ 延迟清空（避免和初始化effect冲突）
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (editCanvasRef.current) {
            const ctx = editCanvasRef.current.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, 800, 1056);
          }
          if (textCanvasRef.current) {
            const ctx = textCanvasRef.current.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, 800, 1056);
          }
        }, 100);
      });

      console.log(`[PAGE_RESTORE] ✅ Page ${currentPage} initialized (first visit)`);
    }
  }, [currentPage]);

  // ✅ PDF渲染（Canvas始终存在，无需retry）
  useEffect(() => {
    if (!pdfData || !pdfCanvasRef.current) return;

    console.log(`[PDF_RENDER] Triggered for page ${currentPage}`);

    const render = async () => {
      setIsLoading(true);
      try {
        await renderPDFToBackground();
        console.log(`[PDF_RENDER] ✅ Page ${currentPage} rendered successfully`);
      } catch (err) {
        console.error('[PDF_RENDER] ❌ Render failed:', err);
      } finally {
        setIsLoading(false);
      }
    };

    // 短暂延迟确保DOM更新完成
    const timer = setTimeout(render, 50);
    return () => clearTimeout(timer);
  }, [pdfData, currentPage]);  // ✅ 移除renderPDFToBackground依赖（通过ref调用）

  const buildFontString = (item: TextItem) => {
    let style = '';
    if (item.fontBold) style += 'bold ';
    if (item.fontItalic) style += 'italic ';
    return `${style}${item.fontSize}px ${item.fontFamily}`;
  };

  const drawTextDecorations = (ctx: CanvasRenderingContext2D, item: TextItem) => {
    if (!item.fontUnderline && !item.fontDoubleUnderline && !item.fontStrikethrough) return;

    ctx.strokeStyle = item.color;
    ctx.lineWidth = Math.max(1, item.fontSize / 16);
    ctx.lineCap = 'round';

    // ✅ 多行文本：为每行绘制装饰
    const lines = item.text.split('\n');
    const lineHeight = item.fontSize * 1.4;

    lines.forEach((line, i) => {
      const metrics = ctx.measureText(line);
      const textWidth = metrics.width;
      const x = item.x;
      const y = item.y + i * lineHeight;

      if (item.fontUnderline || item.fontDoubleUnderline) {
        const gap = item.fontSize * 0.12;
        ctx.beginPath();
        ctx.moveTo(x, y + gap);
        ctx.lineTo(x + textWidth, y + gap);
        ctx.stroke();

        if (item.fontDoubleUnderline) {
          ctx.beginPath();
          ctx.moveTo(x, y + gap * 2.3);
          ctx.lineTo(x + textWidth, y + gap * 2.3);
          ctx.stroke();
        }
      }

      if (item.fontStrikethrough) {
        const midY = y - item.fontSize * 0.35;
        ctx.beginPath();
        ctx.moveTo(x, midY);
        ctx.lineTo(x + textWidth, midY);
        ctx.stroke();
      }
    });
  };

  // ✅ 多行文本绘制函数（支持 \n 换行）
  const drawMultiLineText = (ctx: CanvasRenderingContext2D, item: TextItem, offsetX?: number, offsetY?: number) => {
    const x = offsetX ?? item.x;
    const y = offsetY ?? item.y;
    const lines = item.text.split('\n');
    const lineHeight = item.fontSize * 1.4;
    let maxWidth = 0;

    lines.forEach((line, i) => {
      ctx.fillText(line, x, y + i * lineHeight);
      const metrics = ctx.measureText(line);
      if (metrics.width > maxWidth) maxWidth = metrics.width;
    });

    return { width: maxWidth, height: lines.length * lineHeight };
  };

  const drawAllText = () => {
    const canvas = textCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_BASE_WIDTH, CANVAS_BASE_HEIGHT);

    imageItems.forEach(item => {
      const img = new window.Image();
      img.onload = () => {
        ctx.drawImage(img, item.x, item.y, item.width, item.height);

        if (selectedImageId === item.id) {
          ctx.strokeStyle='#00ff00';
          ctx.lineWidth=2;
          ctx.setLineDash([5, 5]);
          ctx.strokeRect(item.x - 2, item.y - 2, item.width + 4, item.height + 4);
          ctx.setLineDash([]);

          ctx.fillStyle='#00ff00';
          const handleSize=12;

          ctx.fillRect(item.x - handleSize/2, item.y - handleSize/2, handleSize, handleSize);
          ctx.fillRect(item.x + item.width/2 - handleSize/2, item.y - handleSize/2, handleSize, handleSize);
          ctx.fillRect(item.x + item.width - handleSize/2, item.y - handleSize/2, handleSize, handleSize);
          ctx.fillRect(item.x - handleSize/2, item.y + item.height/2 - handleSize/2, handleSize, handleSize);
          ctx.fillRect(item.x + item.width - handleSize/2, item.y + item.height/2 - handleSize/2, handleSize, handleSize);
          ctx.fillRect(item.x - handleSize/2, item.y + item.height - handleSize/2, handleSize, handleSize);
          ctx.fillRect(item.x + item.width/2 - handleSize/2, item.y + item.height - handleSize/2, handleSize, handleSize);
          ctx.fillRect(item.x + item.width - handleSize/2, item.y + item.height - handleSize/2, handleSize, handleSize);
        }
      };
      img.src=item.src;
    });

    textItems.forEach(item => {
      ctx.fillStyle = item.color;
      ctx.font = buildFontString(item);
      drawMultiLineText(ctx, item);
      drawTextDecorations(ctx, item);

      if (selectedTextId === item.id) {
        const dims = { width: 0, height: 0 };
        // Measure text dimensions for selection box
        const tl = item.text.split('\n');
        let mw = 0;
        tl.forEach(l => { const m = ctx.measureText(l); if (m.width > mw) mw = m.width; });
        dims.width = mw;
        dims.height = tl.length * item.fontSize * 1.4;
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 1;
        ctx.strokeRect(item.x - 2, item.y - item.fontSize - 2, dims.width + 4, dims.height + 4);
      }
    });
  };

  const redrawAllShapes = useCallback(() => {
    console.log('[REDRAW_SHAPES] Called! shapeItems count:', shapeItems.length,
                'selectedShapeId:', selectedShapeIdRef.current?.substring(0,8));
    const canvas = shapeCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_BASE_WIDTH, CANVAS_BASE_HEIGHT);

    shapeItems.forEach(shape => {
          ctx.strokeStyle = shape.color;
          ctx.lineWidth = shape.lineWidth;

          if (shape.type === 'rectangle') {
            ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
          } else if (shape.type === 'circle') {
            const radiusX = shape.width / 2;
            const radiusY = shape.height / 2;
            const centerX = shape.x + radiusX;
            const centerY = shape.y + radiusY;
            ctx.beginPath();
            ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
            ctx.stroke();
          } else if (shape.type === 'line') {
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(shape.x, shape.y);
            ctx.lineTo(shape.endX, shape.endY);
            ctx.stroke();
          } else if (shape.type === 'arrow') {
            ctx.fillStyle = shape.color;
            ctx.lineCap = 'round';

            const headlen = 15;
            const angle = Math.atan2(shape.endY - shape.y, shape.endX - shape.x);

            ctx.beginPath();
            ctx.moveTo(shape.x, shape.y);
            ctx.lineTo(shape.endX, shape.endY);
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(shape.endX, shape.endY);
            ctx.lineTo(shape.endX - headlen * Math.cos(angle - Math.PI / 6), shape.endY - headlen * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(shape.endX - headlen * Math.cos(angle + Math.PI / 6), shape.endY - headlen * Math.sin(angle + Math.PI / 6));
            ctx.closePath();
            ctx.fill();
          }

          if (selectedShapeIdRef.current === shape.id) {
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);

            if (shape.type === 'line' || shape.type === 'arrow') {
              const padding = 8;
              const minX = Math.min(shape.x, shape.endX) - padding;
              const minY = Math.min(shape.y, shape.endY) - padding;
              const maxX = Math.max(shape.x, shape.endX) + padding;
              const maxY = Math.max(shape.y, shape.endY) + padding;
              ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);

              if (shape.type === 'line' || shape.type === 'arrow') {
                const centerX = (shape.x + shape.endX) / 2;
                const centerY = (shape.y + shape.endY) / 2;
                ctx.setLineDash([]);
                ctx.fillStyle = '#00ff00';
                ctx.beginPath();
                ctx.arc(centerX, centerY + 25, 6, 0, 2 * Math.PI);
                ctx.fill();
              }
            } else {
              ctx.strokeRect(shape.x - 3, shape.y - 3, shape.width + 6, shape.height + 6);
            }
            ctx.setLineDash([]);
          }
        });
  }, [shapeItems, selectedShapeIdRef, isEditing]);

  useEffect(() => {
    if (!isEditing) return;
    drawAllText();
  }, [textItems, imageItems, selectedTextId, selectedImageId, isEditing]);

  useEffect(() => {
    console.log('[SHAPE_EFFECT] Triggered! shapeItems count:', shapeItems.length,
                'selectedShapeId:', selectedShapeId?.substring(0,8),
                'isEditing:', isEditing);
    if (!isEditing) return;
    console.log('[SHAPE_EFFECT] Calling redrawAllShapes...');
    redrawAllShapes();
  }, [shapeItems, selectedShapeId, isEditing]);

  useEffect(() => {
    if (selectedTextId) {
      const item = textItems.find(t => t.id === selectedTextId);
      if (item) {
        setTextContent(item.text);
        setTextColor(item.color);
        setFontSize(item.fontSize);
        setFontFamily(item.fontFamily);
        setFontBold(item.fontBold);
        setFontItalic(item.fontItalic);
        setFontUnderline(item.fontUnderline);
        setFontDoubleUnderline(item.fontDoubleUnderline);
        setFontStrikethrough(item.fontStrikethrough);
      }
    }
  }, [selectedTextId, textItems]);

  const updateSelectedText = useCallback((updates: Partial<TextItem>) => {
    if (!selectedTextId) return;
    setTextHistory(prev => [...prev, textItems.map(t => ({ ...t }))]);
    setTextItems(prev => prev.map(item =>
      item.id === selectedTextId ? { ...item, ...updates } : item
    ));
  }, [selectedTextId, textItems]);

  const handleTextColorChange = useCallback((color: string) => {
    setTextColor(color);
    updateSelectedText({ color });
  }, [updateSelectedText]);

  const handleFontSizeChange = useCallback((size: number) => {
    setFontSize(size);
    updateSelectedText({ fontSize: size });
  }, [updateSelectedText]);

  const handleFontFamilyChange = useCallback((family: string) => {
    setFontFamily(family);
    updateSelectedText({ fontFamily: family });
  }, [updateSelectedText]);

  const handleTextContentChange = useCallback((content: string) => {
    setTextContent(content);
    updateSelectedText({ text: content });
  }, [updateSelectedText]);

  const handleFontBoldChange = useCallback((bold: boolean) => {
    setFontBold(bold);
    updateSelectedText({ fontBold: bold });
  }, [updateSelectedText]);

  const handleFontItalicChange = useCallback((italic: boolean) => {
    setFontItalic(italic);
    updateSelectedText({ fontItalic: italic });
  }, [updateSelectedText]);

  const handleFontUnderlineChange = useCallback((underline: boolean) => {
    setFontUnderline(underline);
    if (underline) setFontDoubleUnderline(false);
    updateSelectedText({ fontUnderline: underline, fontDoubleUnderline: false });
  }, [updateSelectedText]);

  const handleFontDoubleUnderlineChange = useCallback((doubleUnderline: boolean) => {
    setFontDoubleUnderline(doubleUnderline);
    if (doubleUnderline) setFontUnderline(false);
    updateSelectedText({ fontDoubleUnderline: doubleUnderline, fontUnderline: false });
  }, [updateSelectedText]);

  const handleFontStrikethroughChange = useCallback((strikethrough: boolean) => {
    setFontStrikethrough(strikethrough);
    updateSelectedText({ fontStrikethrough: strikethrough });
  }, [updateSelectedText]);

  // ✅ 编辑层Canvas初始化（已在下方带保护标志的版本中实现）
  // 注意：不要在这里重复初始化，避免翻页时意外清空

  // ✅ 文本层Canvas初始化（仅在首次进入编辑模式时）
  const textCanvasInitializedRef = useRef(false);
  useEffect(() => {
    if (!isEditing || !textCanvasRef.current) return;

    const canvas = textCanvasRef.current;

    // ✅ 如果已经初始化过且尺寸正确，跳过
    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    if (textCanvasInitializedRef.current &&
        canvas.width === CANVAS_BASE_WIDTH * dpr &&
        canvas.height === CANVAS_BASE_HEIGHT * dpr) {
      console.log('[EDIT] Text canvas already initialized, skipping...');
      return;
    }

    canvas.width = CANVAS_BASE_WIDTH * dpr;
    canvas.height = CANVAS_BASE_HEIGHT * dpr;

    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);

    textCanvasInitializedRef.current = true;
    console.log('[EDIT] Text canvas initialized:', canvas.width, 'x', canvas.height);
    drawAllText();
  }, [isEditing]);

  // ✅ 形状层Canvas初始化（仅在首次进入编辑模式时）
  const shapeCanvasInitializedRef = useRef(false);
  useEffect(() => {
    if (!isEditing || !shapeCanvasRef.current) return;

    const canvas = shapeCanvasRef.current;

    // ✅ 如果已经初始化过且尺寸正确，跳过
    if (shapeCanvasInitializedRef.current &&
        canvas.width === CANVAS_BASE_WIDTH * Math.max(window.devicePixelRatio || 1, 2) &&
        canvas.height === CANVAS_BASE_HEIGHT * Math.max(window.devicePixelRatio || 1, 2)) {
      console.log('[EDIT] Shape canvas already initialized, skipping...');
      return;
    }

    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    canvas.width = CANVAS_BASE_WIDTH * dpr;
    canvas.height = CANVAS_BASE_HEIGHT * dpr;

    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);

    shapeCanvasInitializedRef.current = true;
    console.log('[EDIT] Shape canvas initialized:', canvas.width, 'x', canvas.height);
  }, [isEditing]);

  const handleExportPDF = useCallback(async () => {
    if (!pdfData) return;

    setIsLoading(true);
    try {
      // ✅ 关键修复：导出前始终重新生成PDF，确保包含所有最新编辑
      console.log('[EXPORT] Regenerating PDF before export...');
      
      // 先取消选中状态避免UI元素
      if (selectedShapeIdRef.current) {
        setSelectedShapeId(null);
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // 保存当前页数据
      pageEditDataRef.current.set(currentPage, {
        textItems: [...textItemsRef.current],
        imageItems: [...imageItemsRef.current],
        shapeItems: [...shapeItemsRef.current],
        drawHistory: [...historyRef.current],
        textHistoryList: [...textHistoryRef.current],
      });

      // 重新生成完整PDF（与handleSaveEdit相同逻辑）
      const totalPages = (await pdfjsLib.getDocument({
        data: Uint8Array.from(pdfData),
        cMapUrl: 'https://unpkg.com/pdfjs-dist@4.10.38/cmaps/',
        cMapPacked: true,
        useSystemFonts: true,
      }).promise).numPages;

      const newPdfDoc = await PDFLibDocument.create();

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const newPage = newPdfDoc.addPage([800, 1056]);

        // ✅ HiDPI导出：临时Canvas用2倍分辨率保证清晰度
        const exportDpr = Math.max(window.devicePixelRatio || 1, 2);
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = CANVAS_BASE_WIDTH * exportDpr;
        tempCanvas.height = CANVAS_BASE_HEIGHT * exportDpr;
        const tempCtx = tempCanvas.getContext('2d')!;
        tempCtx.scale(exportDpr, exportDpr);

        try {
          tempCtx.fillStyle = '#ffffff';
          tempCtx.fillRect(0, 0, CANVAS_BASE_WIDTH, CANVAS_BASE_HEIGHT);

          const dataCopy = Uint8Array.from(pdfData);
          const pdfjsDoc = await pdfjsLib.getDocument({
            data: dataCopy,
            cMapUrl: 'https://unpkg.com/pdfjs-dist@4.10.38/cmaps/',
            cMapPacked: true,
            useSystemFonts: true,
          }).promise;

          const page = await pdfjsDoc.getPage(pageNum);
          const baseViewport = page.getViewport({ scale: 1.0 });
          const scaleX = CANVAS_BASE_WIDTH / baseViewport.width;
          const scaleY = CANVAS_BASE_HEIGHT / baseViewport.height;
          const scale = Math.min(scaleX, scaleY);
          const viewport = page.getViewport({ scale });

          // ✅ 使用 print intent 提升渲染质量
          await page.render({
            canvasContext: tempCtx,
            viewport,
            intent: 'print',
          }).promise;
        } catch (err) {
          console.warn(`[EXPORT] Page ${pageNum} background render failed:`, err);
        }

        // 合成编辑层
        const pageData = pageEditDataRef.current.get(pageNum);
        if (pageData && (pageData.drawHistory.length > 0 || pageData.textItems.length > 0 || (pageData.imageItems && pageData.imageItems.length > 0) || (pageData.shapeItems && pageData.shapeItems.length > 0))) {

          // 绘制画笔/橡皮擦层
          if (pageData.drawHistory.length > 0) {
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = reject;
              img.src = pageData.drawHistory[pageData.drawHistory.length - 1];
            });
            tempCtx.drawImage(img, 0, 0, CANVAS_BASE_WIDTH, CANVAS_BASE_HEIGHT);
          }

          // 绘制图片层
          if (pageData.imageItems && pageData.imageItems.length > 0) {
            for (const imageItem of pageData.imageItems) {
              const img = new Image();
              await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = reject;
                img.src = imageItem.src;
              });
              tempCtx.drawImage(img, imageItem.x, imageItem.y, imageItem.width, imageItem.height);
            }
          }

          // 绘制形状层（从数据重绘，无UI）
          if (pageData.shapeItems && pageData.shapeItems.length > 0) {
            for (const shape of pageData.shapeItems) {
              tempCtx.strokeStyle = shape.color;
              tempCtx.lineWidth = shape.lineWidth;

              if (shape.type === 'rectangle') {
                tempCtx.strokeRect(shape.x, shape.y, shape.width, shape.height);
              } else if (shape.type === 'circle') {
                const radiusX = shape.width / 2;
                const radiusY = shape.height / 2;
                const centerX = shape.x + radiusX;
                const centerY = shape.y + radiusY;
                tempCtx.beginPath();
                tempCtx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
                tempCtx.stroke();
              } else if (shape.type === 'line') {
                tempCtx.lineCap = 'round';
                tempCtx.beginPath();
                tempCtx.moveTo(shape.x, shape.y);
                tempCtx.lineTo(shape.endX, shape.endY);
                tempCtx.stroke();
              } else if (shape.type === 'arrow') {
                tempCtx.fillStyle = shape.color;
                tempCtx.lineCap = 'round';
                const headlen = 15;
                const angle = Math.atan2(shape.endY - shape.y, shape.endX - shape.x);
                tempCtx.beginPath();
                tempCtx.moveTo(shape.x, shape.y);
                tempCtx.lineTo(shape.endX, shape.endY);
                tempCtx.stroke();
                tempCtx.beginPath();
                tempCtx.moveTo(shape.endX, shape.endY);
                tempCtx.lineTo(shape.endX - headlen * Math.cos(angle - Math.PI / 6), shape.endY - headlen * Math.sin(angle - Math.PI / 6));
                tempCtx.lineTo(shape.endX - headlen * Math.cos(angle + Math.PI / 6), shape.endY - headlen * Math.sin(angle + Math.PI / 6));
                tempCtx.closePath();
                tempCtx.fill();
              }
            }
          }

          // 绘制文字层
          if (pageData.textItems.length > 0) {
            pageData.textItems.forEach(item => {
              tempCtx.fillStyle = item.color;
              tempCtx.font = buildFontString(item);
              drawMultiLineText(tempCtx, item);
              drawTextDecorations(tempCtx, item);
            });
          }
        }

        // 添加到新PDF
        const pngImage = await newPdfDoc.embedPng(tempCanvas.toDataURL('image/png'));
        newPage.drawImage(pngImage, { x: 0, y: 0, width: 800, height: 1056 });
      }

      // 保存并下载
      const editedPdfBytes = await newPdfDoc.save();
      savedEditedPdfRef.current = editedPdfBytes;

      const blob = new Blob([editedPdfBytes as unknown as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.replace('.pdf', '_edited.pdf');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log('[EXPORT] ✅ Edited PDF downloaded (regenerated)');
    } catch (err) {
      console.error('[EXPORT] Export failed:', err);
      alert(t('msg.exportFailed') || '导出失败');
    } finally {
      setIsLoading(false);
    }
  }, [pdfData, fileName, currentPage]);

  const handleExportText = useCallback(async () => {
    if (!pdfData) return;
    
    try {
      const text = await exportPDFAsText(pdfData);
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.replace('.pdf', '.txt');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      alert(t('msg.exportFailed'));
    }
  }, [pdfData, fileName]);

  const toggleEditMode = useCallback(async () => {
    if (isEditing) {
      setIsEditing(false);
      setEditTool('select');
      return;
    }
    
    setIsEditing(true);
  }, [isEditing]);

  // ✅ 编辑层Canvas初始化（仅在首次进入编辑模式或Canvas尺寸变化时）
  const editCanvasInitializedRef = useRef(false);
  useEffect(() => {
    if (!isEditing || !editCanvasRef.current) return;

    const canvas = editCanvasRef.current;

    // ✅ 如果已经初始化过且尺寸正确，跳过（避免翻页时意外清空）
    if (editCanvasInitializedRef.current &&
        canvas.width === CANVAS_BASE_WIDTH * Math.max(window.devicePixelRatio || 1, 2) &&
        canvas.height === CANVAS_BASE_HEIGHT * Math.max(window.devicePixelRatio || 1, 2)) {
      console.log('[EDIT] Canvas already initialized, skipping...');
      return;
    }

    const dpr = Math.max(window.devicePixelRatio || 1, 2);
    canvas.width = CANVAS_BASE_WIDTH * dpr;
    canvas.height = CANVAS_BASE_HEIGHT * dpr;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, CANVAS_BASE_WIDTH, CANVAS_BASE_HEIGHT);
      ctx.globalCompositeOperation = 'source-over';
    }

    editCanvasInitializedRef.current = true;
    console.log('[EDIT] Canvas initialized:', canvas.width, 'x', canvas.height);
  }, [isEditing]);

  const handleSaveEdit = useCallback(async () => {
    if (!pdfData) return;

    setIsLoading(true);
    try {
      console.log('[SAVE_ALL] Starting full PDF save...');

      // ✅ 第0步：导出前先取消所有选中状态，避免UI元素被导出
      if (selectedShapeIdRef.current) {
        setSelectedShapeId(null);
        // 等待React更新
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // ✅ 第1步：先保存当前页的最新编辑数据（此时无选中状态）
      pageEditDataRef.current.set(currentPage, {
        textItems: [...textItemsRef.current],
        imageItems: [...imageItemsRef.current],
        shapeItems: [...shapeItemsRef.current],
        drawHistory: [...historyRef.current],
        textHistoryList: [...textHistoryRef.current],
      });

      // ✅ 第2步：加载原始PDF获取总页数
      const originalPdf = await PDFLibDocument.load(pdfData);
      const totalPages = originalPdf.getPageCount();
      console.log(`[SAVE_ALL] Total pages: ${totalPages}`);

      // ✅ 第3步：创建新的完整PDF文档
      const newPdfDoc = await PDFLibDocument.create();

      // ✅ 第4步：使用临时canvas合成每一页
      // ✅ HiDPI导出：临时Canvas用2倍分辨率保证清晰度
      const exportDpr = Math.max(window.devicePixelRatio || 1, 2);
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = CANVAS_BASE_WIDTH * exportDpr;
      tempCanvas.height = CANVAS_BASE_HEIGHT * exportDpr;
      const tempCtx = tempCanvas.getContext('2d')!;
      tempCtx.scale(exportDpr, exportDpr);

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        console.log(`[SAVE_ALL] Processing page ${pageNum}/${totalPages}...`);

        // 清空临时canvas
        tempCtx.fillStyle = '#ffffff';
        tempCtx.fillRect(0, 0, CANVAS_BASE_WIDTH, CANVAS_BASE_HEIGHT);

        // 渲染该页的原始PDF背景
        try {
          const dataCopy = Uint8Array.from(pdfData);
          const pdfjsDoc = await pdfjsLib.getDocument({
            data: dataCopy,
            cMapUrl: 'https://unpkg.com/pdfjs-dist@4.10.38/cmaps/',
            cMapPacked: true,
            useSystemFonts: true,
          }).promise;

          const page = await pdfjsDoc.getPage(pageNum);
          const baseViewport = page.getViewport({ scale: 1.0 });
          const scaleX = CANVAS_BASE_WIDTH / baseViewport.width;
          const scaleY = CANVAS_BASE_HEIGHT / baseViewport.height;
          const scale = Math.min(scaleX, scaleY);
          const viewport = page.getViewport({ scale });

          await page.render({
            canvasContext: tempCtx,
            viewport,
            intent: 'print',
          }).promise;

          console.log(`[SAVE_ALL] Page ${pageNum} background rendered`);
        } catch (err) {
          console.warn(`[SAVE_ALL] Page ${pageNum} background render failed:`, err);
        }

        // 合成该页的编辑层（如果有）
        const pageData = pageEditDataRef.current.get(pageNum);
        if (pageData && (pageData.drawHistory.length > 0 || pageData.textItems.length > 0 || (pageData.imageItems && pageData.imageItems.length > 0) || (pageData.shapeItems && pageData.shapeItems.length > 0))) {
          console.log(`[SAVE_ALL] Page ${pageNum} has edits: ${pageData.drawHistory.length} draws, ${pageData.textItems.length} texts, ${pageData.imageItems?.length || 0} images, ${pageData.shapeItems?.length || 0} shapes`);

          // ✅ 始终使用editCanvas快照（现在只包含画笔/橡皮擦，是干净的）
          if (pageData.drawHistory.length > 0) {
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
              img.onload = () => resolve();
              img.onerror = reject;
              img.src = pageData.drawHistory[pageData.drawHistory.length - 1];
            });
            tempCtx.drawImage(img, 0, 0, CANVAS_BASE_WIDTH, CANVAS_BASE_HEIGHT);
          }

          // 绘制图片层（拼图）
          if (pageData.imageItems && pageData.imageItems.length > 0) {
            for (const imageItem of pageData.imageItems) {
              const img = new Image();
              await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = reject;
                img.src = imageItem.src;
              });
              tempCtx.drawImage(img, imageItem.x, imageItem.y, imageItem.width, imageItem.height);
            }
            console.log(`[SAVE_ALL] Page ${pageNum} rendered ${pageData.imageItems.length} images`);
          }

          // 绘制形状层
          if (pageData.shapeItems && pageData.shapeItems.length > 0) {
            for (const shape of pageData.shapeItems) {
              tempCtx.strokeStyle = shape.color;
              tempCtx.lineWidth = shape.lineWidth;

              if (shape.type === 'rectangle') {
                tempCtx.strokeRect(shape.x, shape.y, shape.width, shape.height);
              } else if (shape.type === 'circle') {
                const radiusX = shape.width / 2;
                const radiusY = shape.height / 2;
                const centerX = shape.x + radiusX;
                const centerY = shape.y + radiusY;
                tempCtx.beginPath();
                tempCtx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
                tempCtx.stroke();
              } else if (shape.type === 'line') {
                tempCtx.lineCap = 'round';
                tempCtx.beginPath();
                tempCtx.moveTo(shape.x, shape.y);
                tempCtx.lineTo(shape.endX, shape.endY);
                tempCtx.stroke();
              } else if (shape.type === 'arrow') {
                tempCtx.fillStyle = shape.color;
                tempCtx.lineCap = 'round';

                const headlen = 15;
                const angle = Math.atan2(shape.endY - shape.y, shape.endX - shape.x);

                tempCtx.beginPath();
                tempCtx.moveTo(shape.x, shape.y);
                tempCtx.lineTo(shape.endX, shape.endY);
                tempCtx.stroke();

                tempCtx.beginPath();
                tempCtx.moveTo(shape.endX, shape.endY);
                tempCtx.lineTo(shape.endX - headlen * Math.cos(angle - Math.PI / 6), shape.endY - headlen * Math.sin(angle - Math.PI / 6));
                tempCtx.lineTo(shape.endX - headlen * Math.cos(angle + Math.PI / 6), shape.endY - headlen * Math.sin(angle + Math.PI / 6));
                tempCtx.closePath();
                tempCtx.fill();
              }
            }
            console.log(`[SAVE_ALL] Page ${pageNum} rendered ${pageData.shapeItems.length} shapes`);
          }

          // 绘制文字层
          if (pageData.textItems.length > 0) {
            pageData.textItems.forEach(item => {
              tempCtx.fillStyle = item.color;
              tempCtx.font = buildFontString(item);
              drawMultiLineText(tempCtx, item);
              drawTextDecorations(tempCtx, item);
            });
          }

          console.log(`[SAVE_ALL] Page ${pageNum} edits composited`);
        }

        // 将合成的页面添加到新PDF
        const pngImage = await newPdfDoc.embedPng(tempCanvas.toDataURL('image/png'));
        const newPage = newPdfDoc.addPage([800, 1056]);
        newPage.drawImage(pngImage, {
          x: 0,
          y: 0,
          width: 800,
          height: 1056,
        });
      }

      // ✅ 第5步：保存完整的编辑后PDF到内存
      const editedPdfBytes = await newPdfDoc.save();
      savedEditedPdfRef.current = editedPdfBytes;

      console.log(`[SAVE_ALL] ✅ All ${totalPages} pages saved successfully! Size: ${editedPdfBytes.length} bytes`);

      // ✅ 不退出编辑模式，保持编辑状态让用户继续工作
      alert(t('save.success') || `✅ 编辑已成功保存！\n\n共${totalPages}页全部处理完成。\n\n您可以继续编辑，或者点击"导出PDF"按钮下载包含所有编辑内容的完整文件。`);

    } catch (err) {
      console.error('[SAVE_ALL] Save failed:', err);
      alert((t('save.failed') || '保存失败: ') + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setIsLoading(false);
    }
  }, [pdfData, currentPage]);

  const handleAddPage = useCallback(async () => {
    if (!pdfData) return;
    
    setIsLoading(true);
    try {
      const pdfDoc = await PDFLibDocument.load(pdfData);
      const pageSize = pdfDoc.getPages()[0]?.getSize() || { width: 612, height: 792 };
      pdfDoc.addPage([pageSize.width, pageSize.height]);
      const newData = await pdfDoc.save();
      
      setPdfData(newData);
      setPageCount((prev) => prev + 1);
      
      } catch (err) {
      console.error('Add page failed:', err);
      alert(t('msg.addPageFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [pdfData]);

  const handleDeletePage = useCallback(async () => {
    if (!pdfData || pageCount <= 1) return;
    
    if (!confirm(t('toolbar.confirmDelete'))) return;
    
    setIsLoading(true);
    try {
      const pdfDoc = await PDFLibDocument.load(pdfData);
      pdfDoc.removePage(currentPage - 1);
      const newData = await pdfDoc.save();
      
      setPdfData(newData);
      setPageCount((prev) => prev - 1);
      
      if (currentPage > pageCount - 1) {
        setCurrentPage((prev) => prev - 1);
      }
    } catch (err) {
      console.error('Delete page failed:', err);
      alert(t('toolbar.deleteFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [pdfData, pageCount, currentPage]);

  const handleUndoText = useCallback(() => {
    if (textHistory.length === 0) return;

    const prevTextState = textHistory[textHistory.length - 1];
    setTextHistory(prev => prev.slice(0, -1));
    setRedoTextHistory(prev => [...prev, [...textItems]]);
    setTextItems(prevTextState);
    setSelectedTextId(null);
  }, [textHistory, textItems]);

  const handleDeleteText = useCallback(() => {
    console.log('[DELETE_TEXT] Called! selectedTextIdRef:', selectedTextIdRef.current);
    if (!selectedTextIdRef.current) {
      console.log('[DELETE_TEXT] ❌ No text selected (ref is null)');
      return;
    }

    const idToDelete = selectedTextIdRef.current;
    console.log('[DELETE_TEXT] ✅ Removing text:', idToDelete);

    // 计算过滤结果
    const currentTexts = [...textItemsRef.current];
    const filteredTexts = currentTexts.filter(item => item.id !== idToDelete);

    console.log('[DELETE_TEXT] Filter result:', currentTexts.length, '→', filteredTexts.length);

    // 使用 flushSync 强制同步更新
    flushSync(() => {
      setTextHistory(prev => [...prev, [...textItemsRef.current]]);
      setRedoTextHistory([]);
      setTextItems(filteredTexts);
      setSelectedTextId(null);
    });

    console.log('[DELETE_TEXT] ✅ Text deleted! (synchronous update complete)');
  }, []);

  const handleDeleteImage = useCallback(() => {
    console.log('[DELETE_IMAGE] Called! selectedImageIdRef:', selectedImageIdRef.current);
    if (!selectedImageIdRef.current) {
      console.log('[DELETE_IMAGE] ❌ No image selected (ref is null)');
      return;
    }

    const idToDelete = selectedImageIdRef.current;
    console.log('[DELETE_IMAGE] ✅ Removing image:', idToDelete);

    // 计算过滤结果
    const currentImages = [...imageItemsRef.current];
    const filteredImages = currentImages.filter(item => item.id !== idToDelete);

    console.log('[DELETE_IMAGE] Filter result:', currentImages.length, '→', filteredImages.length);

    // 使用 flushSync 强制同步更新
    flushSync(() => {
      setImageHistory(prev => [...prev, [...imageItemsRef.current]]);
      setRedoImageHistory([]);
      setImageItems(filteredImages);
      setSelectedImageId(null);
    });

    console.log('[DELETE_IMAGE] ✅ Image deleted! (synchronous update complete)');
  }, []);

  const handleDeleteShape = useCallback(() => {
    console.log('[DELETE_SHAPE] Called! selectedShapeIdRef:', selectedShapeIdRef.current);
    if (!selectedShapeIdRef.current) {
      console.log('[DELETE_SHAPE] ❌ No shape selected (ref is null)');
      return;
    }

    const idToDelete = selectedShapeIdRef.current;
    console.log('[DELETE_SHAPE] ✅ Removing shape:', idToDelete);

    // 计算过滤结果
    const currentShapes = [...shapeItemsRef.current];
    const filteredShapes = currentShapes.filter(item => item.id !== idToDelete);

    console.log('[DELETE_SHAPE] Filter result:', currentShapes.length, '→', filteredShapes.length);

    // ✨ 使用 flushSync 强制同步更新（React会立即完成render + 所有effects）
    flushSync(() => {
      setShapeItems(filteredShapes);
      setSelectedShapeId(null);
    });

    // 此时React已完成所有更新：
    // 1. shapeItems state 已更新为 filteredShapes（只删除了选中的那个）
    // 2. selectedShapeId state 已更新为 null
    // 3. [SHAPE_EFFECT] 已触发 → redrawAllShapes() 已用filteredShapes重绘canvas
    // 4. canvas上只显示剩余的形状 ✅

    console.log('[DELETE_SHAPE] ✅ Shape deleted! (synchronous update complete)');
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // ✅ 如果焦点在输入框（textarea/input）内，不拦截Delete/Backspace，让浏览器正常处理
    const target = e.target as HTMLElement;
    if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable) {
      return;
    }

    console.log('[KEY_DOWN] Event received:', e.key, 'isEditing:', isEditing);
    console.log('[KEY_DOWN] Refs - textId:', selectedTextIdRef.current?.substring(0,8),
                'imageId:', selectedImageIdRef.current?.substring(0,8),
                'shapeId:', selectedShapeIdRef.current?.substring(0,8));

    if ((e.key === 'Delete' || e.key === 'Backspace') && isEditing) {
      e.preventDefault();
      console.log('[KEY_DOWN] ✅ Delete/Backspace pressed in edit mode!');

      if (selectedTextIdRef.current) {
        console.log('[KEY_DOWN] → Deleting TEXT...');
        handleDeleteText();
      } else if (selectedImageIdRef.current) {
        console.log('[KEY_DOWN] → Deleting IMAGE...');
        handleDeleteImage();
      } else if (selectedShapeIdRef.current) {
        console.log('[KEY_DOWN] → Deleting SHAPE...');
        handleDeleteShape();
      } else {
        console.log('[KEY_DOWN] ⚠️ Nothing selected!');
      }
    }
  }, [isEditing, handleDeleteText, handleDeleteImage, handleDeleteShape]);

  useEffect(() => {
    console.log('[KEY_LISTENER] Setting up keydown listener, isEditing:', isEditing);
    if (!isEditing) {
      console.log('[KEY_LISTENER] ⚠️ Not in edit mode, skipping');
      return;
    }
    console.log('[KEY_LISTENER] ✅ Adding keydown event listener to document');
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      console.log('[KEY_LISTENER] Removing keydown event listener');
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isEditing, handleKeyDown]);

  const handleUndoDrawing = useCallback(() => {
    if (history.length === 0 || !editCanvasRef.current) return;

    const canvas = editCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const lastState = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));
    setRedoHistory(prev => [...prev, canvas.toDataURL()]);

    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, CANVAS_BASE_WIDTH, CANVAS_BASE_HEIGHT);
      ctx.drawImage(img, 0, 0, CANVAS_BASE_WIDTH, CANVAS_BASE_HEIGHT);
    };
    img.src = lastState;
  }, [history]);

  const handleRedoText = useCallback(() => {
    if (redoTextHistory.length === 0) return;

    const nextState = redoTextHistory[redoTextHistory.length - 1];
    setRedoTextHistory(prev => prev.slice(0, -1));
    setTextHistory(prev => [...prev, [...textItems]]);
    setTextItems(nextState);
    setSelectedTextId(null);
  }, [redoTextHistory, textItems]);

  const handleRedoDrawing = useCallback(() => {
    if (redoHistory.length === 0 || !editCanvasRef.current) return;

    const canvas = editCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const nextState = redoHistory[redoHistory.length - 1];
    setRedoHistory(prev => prev.slice(0, -1));
    setHistory(prev => [...prev, canvas.toDataURL()]);

    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, CANVAS_BASE_WIDTH, CANVAS_BASE_HEIGHT);
      ctx.drawImage(img, 0, 0, CANVAS_BASE_WIDTH, CANVAS_BASE_HEIGHT);
    };
    img.src = nextState;
  }, [redoHistory]);

  const handleUndoImage = useCallback(() => {
    if (imageHistory.length === 0) return;

    const prevState = imageHistory[imageHistory.length - 1];
    setImageHistory(prev => prev.slice(0, -1));
    setRedoImageHistory(prev => [...prev, [...imageItems]]);
    setImageItems(prevState);
    setSelectedImageId(null);
  }, [imageHistory, imageItems]);

  const handleRedoImage = useCallback(() => {
    if (redoImageHistory.length === 0) return;

    const nextState = redoImageHistory[redoImageHistory.length - 1];
    setRedoImageHistory(prev => prev.slice(0, -1));
    setImageHistory(prev => [...prev, [...imageItems]]);
    setImageItems(nextState);
    setSelectedImageId(null);
  }, [redoImageHistory, imageItems]);

  const getImageCursor = (mouseX: number, mouseY: number, image: ImageItem): string => {
    const handleSize = 16;
    const right = image.x + image.width;
    const bottom = image.y + image.height;
    const centerX = image.x + image.width / 2;
    const centerY = image.y + image.height / 2;

    if (mouseX >= centerX - handleSize/2 && mouseX <= centerX + handleSize/2 &&
        mouseY >= image.y - handleSize/2 && mouseY <= image.y + handleSize/2) {
      return 'n-resize';
    }
    if (mouseX >= image.x - handleSize/2 && mouseX <= image.x + handleSize/2 &&
        mouseY >= centerY - handleSize/2 && mouseY <= centerY + handleSize/2) {
      return 'w-resize';
    }
    if (mouseX >= right - handleSize/2 && mouseX <= right + handleSize/2 &&
        mouseY >= centerY - handleSize/2 && mouseY <= centerY + handleSize/2) {
      return 'e-resize';
    }
    if (mouseX >= centerX - handleSize/2 && mouseX <= centerX + handleSize/2 &&
        mouseY >= bottom - handleSize/2 && mouseY <= bottom + handleSize/2) {
      return 's-resize';
    }
    if (mouseX >= right - handleSize/2 && mouseX <= right + handleSize/2 &&
        mouseY >= bottom - handleSize/2 && mouseY <= bottom + handleSize/2) {
      return 'se-resize';
    }

    return 'move';
  };

  const handleClearCanvas = useCallback(() => {
    if (!editCanvasRef.current) return;

    const canvas = editCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setHistory(prev => [...prev, canvas.toDataURL()]);
    setTextHistory(prev => [...prev, [...textItems]]);
    ctx.clearRect(0, 0, CANVAS_BASE_WIDTH, CANVAS_BASE_HEIGHT);
    setImageItems([]);
    setShapeItems([]);
    setSelectedTextId(null);
    setSelectedImageId(null);
    setSelectedShapeId(null);
  }, [textItems]);

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string;
      const img = new window.Image();
      img.onload = () => {
        const maxWidth = 400;
        const maxHeight = 300;
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height *= (maxWidth / width);
          width = maxWidth;
        }
        if (height > maxHeight) {
          width *= (maxHeight / height);
          height = maxHeight;
        }

        const newImage: ImageItem = {
          id: `img-${Date.now()}`,
          src,
          x: 100,
          y: 100,
          width,
          height,
        };

        setImageHistory(prev => [...prev, [...imageItems]]);
        setRedoImageHistory([]);
        setImageItems(prev => [...prev, newImage]);
        setEditTool('select');
      };
      img.src = src;
    };
    reader.readAsDataURL(file);

    e.target.value = '';
  }, [textItems]);

  const handlePasteImage = useCallback((e: React.ClipboardEvent) => {
    if (!isEditing) return;

    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (!file) continue;

        const reader = new FileReader();
        reader.onload = (event) => {
          const src = event.target?.result as string;
          const img = new window.Image();
          img.onload = () => {
            const maxWidth = 400;
            const maxHeight = 300;
            let width = img.width;
            let height = img.height;

            if (width > maxWidth) {
              height *= (maxWidth / width);
              width = maxWidth;
            }
            if (height > maxHeight) {
              width *= (maxHeight / height);
              height = maxHeight;
            }

            const newImage: ImageItem = {
              id: `img-paste-${Date.now()}`,
              src,
              x: 100,
              y: 100,
              width,
              height,
            };

            setImageHistory(prev => [...prev, [...imageItems]]);
            setRedoImageHistory([]);
            setImageItems(prev => [...prev, newImage]);
          };
          img.src = src;
        };
        reader.readAsDataURL(file);
        break;
      }
    }
  }, [isEditing, textItems]);

  const handleFind = useCallback(() => {
    if (!findText.trim()) return;

    const found = textItems.find(item =>
      item.text.toLowerCase().includes(findText.toLowerCase())
    );

    if (found) {
      setSelectedTextId(found.id);
      alert(t('msg.foundMatch', { text: found.text }));
    } else {
      alert(t('msg.notFound'));
      setSelectedTextId(null);
    }
  }, [findText, textItems]);

  const handleReplace = useCallback(() => {
    if (!findText.trim() || !textItems.length) return;

    const hasMatch = textItems.some(item =>
      item.text.toLowerCase().includes(findText.toLowerCase())
    );

    if (!hasMatch) {
      alert(t('msg.noReplaceMatch'));
      return;
    }

    setTextHistory(prev => [...prev, [...textItems]]);
    setTextItems(prev =>
      prev.map(item => ({
        ...item,
        text: item.text.replace(new RegExp(findText, 'gi'), replaceText)
      }))
    );
  }, [findText, replaceText, textItems]);

  const handleReplaceAll = useCallback(() => {
    if (!findText.trim() || !textItems.length) return;

    const matchCount = textItems.reduce((count, item) => {
      const matches = item.text.match(new RegExp(findText, 'gi'));
      return count + (matches ? matches.length : 0);
    }, 0);

    if (matchCount === 0) {
      alert(t('msg.noReplaceMatch'));
      return;
    }

    setTextHistory(prev => [...prev, [...textItems]]);
    setTextItems(prev =>
      prev.map(item => ({
        ...item,
        text: item.text.replace(new RegExp(findText, 'gi'), replaceText)
      }))
    );

    alert(t('msg.replacedCount', { count: matchCount }));
  }, [findText, replaceText, textItems]);

  const handleOpenPageSorter = useCallback(() => {
    setPageOrder(Array.from({ length: pageCount }, (_, i) => i + 1));
    setShowPageSorter(true);
  }, [pageCount]);

  const handleDragStart = useCallback((index: number) => {
    setDraggedPageIndex(index);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedPageIndex === null || draggedPageIndex === index) return;

    const newOrder = [...pageOrder];
    const draggedItem = newOrder[draggedPageIndex];
    newOrder.splice(draggedPageIndex, 1);
    newOrder.splice(index, 0, draggedItem);

    setPageOrder(newOrder);
    setDraggedPageIndex(index);
  }, [draggedPageIndex, pageOrder]);

  const handleDragEnd = useCallback(() => {
    setDraggedPageIndex(null);
  }, []);

  const applyPageOrder = useCallback(async () => {
    if (!pdfData) return;

    setIsLoading(true);
    try {
      const sourceDoc = await PDFLibDocument.load(pdfData);

      const newPdfDoc = await PDFLibDocument.create();

      for (const pageNum of pageOrder) {
        const [copiedPage] = await newPdfDoc.copyPages(sourceDoc, [pageNum - 1]);
        newPdfDoc.addPage(copiedPage);
      }

      const newData = await newPdfDoc.save();

      setPdfData(newData);
      setCurrentPage(1);

      const blob = new Blob([newData as unknown as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);

      setShowPageSorter(false);
      alert(t('msg.pageSorted'));
    } catch (err) {
      console.error('Page sort failed:', err);
      alert(t('msg.pageSortFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [pdfData, pageOrder]);

  const zoomIn = useCallback(() => {
    setZoom((prev) => Math.min(200, prev + 10));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((prev) => Math.max(50, prev - 10));
  }, []);

  const nextPage = useCallback(() => {
    if (currentPage < pageCount) {
      // ✅ 使用ref获取最新状态，避免闭包陷阱

      console.log(`[NEXT_PAGE] Saving page ${currentPage} before navigating...`);
      
      // ✅ 关键修复：保存前先取消选中状态，避免UI元素（虚线框）被保存到快照
      if (selectedShapeIdRef.current) {
        setSelectedShapeId(null);
      }
      
      // 使用ref获取最新状态（此时selectedShapeId已被清空）
      const saveTexts = textItemsRef.current;
      const saveDraws = historyRef.current;
      const saveTextHistories = textHistoryRef.current;
      
      pageEditDataRef.current.set(currentPage, {
        textItems: [...saveTexts],
        imageItems: [...imageItemsRef.current],
        shapeItems: [...shapeItemsRef.current],
        drawHistory: [...saveDraws],
        textHistoryList: [...saveTextHistories],
      });
      console.log(`[NEXT_PAGE] Page ${currentPage} saved: ${saveTexts.length} texts, ${saveDraws.length} draws`);

      // ✅ 关键修复：始终捕获当前Canvas最新状态并追加到history
      if (editCanvasRef.current) {
        const latestSnapshot = editCanvasRef.current.toDataURL();
        const saved = pageEditDataRef.current.get(currentPage);
        if (saved) {
          // 追加最新快照，确保包含所有已绘制内容
          saved.drawHistory = [...saved.drawHistory, latestSnapshot];
          console.log(`[NEXT_PAGE] ✅ Canvas snapshot appended, total: ${saved.drawHistory.length}`);
        }
      }

      setCurrentPage((prev) => prev + 1);
    }
  }, [currentPage, pageCount]);  // ✅ 不再依赖textItems, history, textHistory

  const prevPage = useCallback(() => {
    if (currentPage > 1) {
      // ✅ 使用ref获取最新状态，避免闭包陷阱

      console.log(`[PREV_PAGE] Saving page ${currentPage} before navigating...`);
      
      // ✅ 关键修复：保存前先取消选中状态，避免UI元素（虚线框）被保存到快照
      if (selectedShapeIdRef.current) {
        setSelectedShapeId(null);
      }
      
      // 使用ref获取最新状态（此时selectedShapeId已被清空）
      const saveTexts = textItemsRef.current;
      const saveDraws = historyRef.current;
      const saveTextHistories = textHistoryRef.current;
      
      pageEditDataRef.current.set(currentPage, {
        textItems: [...saveTexts],
        imageItems: [...imageItemsRef.current],
        shapeItems: [...shapeItemsRef.current],
        drawHistory: [...saveDraws],
        textHistoryList: [...saveTextHistories],
      });
      console.log(`[PREV_PAGE] Page ${currentPage} saved: ${saveTexts.length} texts, ${saveDraws.length} draws`);

      // ✅ 关键修复：始终捕获当前Canvas最新状态并追加到history
      if (editCanvasRef.current) {
        const latestSnapshot = editCanvasRef.current.toDataURL();
        const saved = pageEditDataRef.current.get(currentPage);
        if (saved) {
          saved.drawHistory = [...saved.drawHistory, latestSnapshot];
          console.log(`[PREV_PAGE] ✅ Canvas snapshot appended, total: ${saved.drawHistory.length}`);
        }
      }

      setCurrentPage((prev) => prev - 1);
    }
  }, [currentPage]);  // ✅ 不再依赖textItems, history, textHistory

  if (!pdfData) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header title={t('app.title')} />
        
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">{t('upload.title')}</h2>
            <p className="text-gray-600 mb-4">{t('upload.subtitle')}</p>
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
            <h3 className="text-lg font-semibold text-gray-900 mb-3">{t('upload.guide')}</h3>
            <ul className="space-y-2 text-gray-600">
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-500 mt-2 flex-shrink-0" />
                <span>{t('upload.guide1')}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-500 mt-2 flex-shrink-0" />
                <span>{t('upload.guide2')}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-500 mt-2 flex-shrink-0" />
                <span>{t('upload.guide3')}</span>
              </li>
            </ul>
          </div>
        </main>
      </div>
    );
  }

  // ──────────────────────────────────────────────
  // 🔐 未认证时显示登录界面
  // ──────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Logo / 标题区域 */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl shadow-lg mb-4">
              <Lock className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">PDF 编辑器</h1>
            <p className="text-sm text-gray-500 mt-2">请输入访问口令以继续使用</p>
          </div>

          {/* 登录卡片 */}
          <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-8">
            <form onSubmit={handleAuthSubmit}>
              {/* 口令输入框 */}
              <div className="relative mb-4">
                <input
                  type="password"
                  value={authInput}
                  onChange={(e) => { setAuthInput(e.target.value); setAuthError(''); }}
                  placeholder="请输入访问口令"
                  className={`w-full h-12 px-4 pr-12 border-2 rounded-xl text-base outline-none transition-all
                    ${authError ? 'border-red-300 bg-red-50 focus:border-red-500' : 'border-gray-200 bg-gray-50 focus:border-blue-500 focus:bg-white'}
                    placeholder:text-gray-400`}
                  autoFocus
                  autoComplete="off"
                />
                <Shield className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
              </div>

              {/* 错误提示 */}
              {authError && (
                <div className="flex items-center gap-2 text-red-500 text-sm mb-4 animate-pulse">
                  <XCircle className="w-4 h-4 shrink-0" />
                  <span>{authError}</span>
                </div>
              )}

              {/* 提交按钮 */}
              <button
                type="submit"
                className="w-full h-12 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-medium rounded-xl transition-all shadow-md hover:shadow-lg active:scale-[0.98]"
              >
                验证并进入
              </button>
            </form>

            {/* 提示信息 */}
            <div className="mt-6 text-center space-y-2">
              {ACCESS_CONFIG.maxUsageHours > 0 && (
                <p className="flex items-center justify-center gap-2 text-xs text-gray-400">
                  <Clock className="w-3.5 h-3.5" />
                  默认口令有效期为 {ACCESS_CONFIG.maxUsageHours} 小时
                </p>
              )}
              {ACCESS_CONFIG.validHours > 0 && ACCESS_CONFIG.validHours !== ACCESS_CONFIG.maxUsageHours && (
                <p className="flex items-center justify-center gap-2 text-xs text-gray-400">
                  <Clock className="w-3.5 h-3.5" />
                  连续使用 {ACCESS_CONFIG.validHours} 小时内无需重新输入
                </p>
              )}
              <p className="text-xs text-gray-300">
                如无口令请联系管理员获取
              </p>
            </div>
          </div>

          {/* 底部信息 */}
          <p className="text-center text-xs text-gray-400 mt-6">
            受保护的内容 · 需要授权访问
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <Header title={fileName} showBack onBack={() => {
        setPdfData(null);
        setFileName('');
      }} />

      {/* 👑 管理员入口按钮 — 始终可见 */}
      {isAdmin && (
        <div className="bg-gradient-to-r from-purple-500 to-indigo-600 px-4 py-1.5 flex items-center justify-between">
          <span className="text-white text-xs font-medium">👑 管理员模式</span>
          <button
            onClick={() => setShowAdminPanel(true)}
            className="px-3 py-1 bg-white/20 hover:bg-white/30 text-white text-xs font-medium rounded-lg transition-colors"
          >
            打开管理面板
          </button>
        </div>
      )}

      <div className="bg-white border-b border-gray-200 px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={zoomOut}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
              title={t('toolbar.zoomOut')}
            >
              <ZoomOut className="w-5 h-5" />
            </button>
            <span className="text-sm font-medium text-gray-700 w-16 text-center">
              {zoom}%
            </span>
            <button
              onClick={zoomIn}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
              title={t('toolbar.zoomIn')}
            >
              <ZoomIn className="w-5 h-5" />
            </button>

            <div className="h-6 w-px bg-gray-200" />

            <button
              onClick={toggleEditMode}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                isEditing
                  ? 'bg-blue-600 text-white'
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              }`}
              title={isEditing ? t('toolbar.editModeOff') : t('toolbar.editModeOn')}
            >
              {isEditing ? t('toolbar.exitEdit') : t('toolbar.editPdf')}
            </button>

            <button
              onClick={handleAddPage}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
              title={t('toolbar.addPage')}
            >
              <Plus className="w-5 h-5" />
            </button>
            <button
              onClick={handleDeletePage}
              disabled={pageCount <= 1}
              className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title={t('toolbar.deletePage')}
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportText}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
            >
              {t('toolbar.exportText')}
            </button>
            <button
              onClick={handleExportPDF}
              className="flex items-center gap-2 px-4 py-2 bg-accent-600 text-white rounded-lg hover:bg-accent-700 transition-colors text-sm font-medium"
            >
              <Download className="w-4 h-4" />
              {t('toolbar.exportPdf')}
            </button>
          </div>
        </div>

        {/* ✅ 新增：编辑模式下的第二行工具栏（多行显示，支持i18n） */}
        {isEditing && pdfData && (
          <div className="mt-2 pt-2 border-t border-gray-200 space-y-2">
            {/* 第一行：文本操作工具 */}
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm font-semibold px-3 py-1 bg-blue-50 text-blue-700 rounded-lg">{t('toolbar.textOps')}</span>

              {/* 文字工具组：选择、添加文本、撤销/重做、删除、查找 */}
              <div className="flex items-center gap-1 px-3 py-2 bg-teal-50 border border-teal-200 rounded-lg">
                <span className="text-xs font-medium text-teal-600 mr-1">📝</span>
                <button onClick={() => setEditTool('select')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${editTool === 'select' ? 'bg-blue-500 text-white' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'}`}>
                  ✦ {t('toolbar.selectBtn')}
                </button>
                <button onClick={() => setEditTool('text')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${editTool === 'text' ? 'bg-blue-500 text-white' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'}`}>
                  T {t('toolbar.addTextBtn')}
                </button>
                <div className="h-5 w-px bg-teal-200 mx-1" />
                <button onClick={handleUndoText} disabled={textHistory.length === 0} className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${textHistory.length === 0 ? 'bg-gray-50 text-gray-300 cursor-not-allowed border border-gray-200' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'}`}>
                  ↩ {t('toolbar.undoTextBtn')}
                </button>
                <button onClick={handleRedoText} disabled={redoTextHistory.length === 0} className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${redoTextHistory.length === 0 ? 'bg-gray-50 text-gray-300 cursor-not-allowed border border-gray-200' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'}`}>
                  ↪ {t('toolbar.redoTextBtn')}
                </button>
                <div className="h-5 w-px bg-teal-200 mx-1" />
                <button onClick={handleDeleteText} disabled={!selectedTextId} className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${!selectedTextId ? 'bg-gray-50 text-gray-300 cursor-not-allowed border border-gray-200' : 'bg-white hover:bg-red-50 hover:text-red-600 text-gray-700 border border-gray-200'}`}>
                  🗑
                </button>
                <button onClick={() => setShowFindReplace(true)} className="px-2 py-1.5 rounded-lg text-xs font-medium bg-white hover:bg-purple-50 text-purple-600 border border-gray-200 transition-colors">
                  🔍
                </button>
              </div>

              {/* 图片工具组：添加图片、撤销/重做 */}
              <div className="flex items-center gap-1 px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg">
                <span className="text-xs font-medium text-orange-600 mr-1">🖼</span>
                <label className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${editTool === 'image' ? 'bg-blue-500 text-white' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'}`}>
                  + {t('toolbar.addImageBtn')}
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                </label>
                <div className="h-5 w-px bg-orange-200 mx-1" />
                <button onClick={handleUndoImage} disabled={imageHistory.length === 0} className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${imageHistory.length === 0 ? 'bg-gray-50 text-gray-300 cursor-not-allowed border border-gray-200' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'}`}>
                  ↩ {t('toolbar.undoImageBtn')}
                </button>
                <button onClick={handleRedoImage} disabled={redoImageHistory.length === 0} className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${redoImageHistory.length === 0 ? 'bg-gray-50 text-gray-300 cursor-not-allowed border border-gray-200' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'}`}>
                  ↪ {t('toolbar.redoImageBtn')}
                </button>
              </div>

              <div className="h-6 w-px bg-gray-200" />

              <span className="text-xs text-gray-500">{t('toolbar.colorLabel')}</span>
              <div className="relative">
                <button onClick={() => setShowTextColorPicker(!showTextColorPicker)} className="w-8 h-8 rounded-lg border-2 border-gray-300 flex items-center justify-center hover:border-blue-400 transition-colors" style={{ backgroundColor: textColor }}>
                  <span className="text-sm font-bold" style={{ color: textColor === '#ffffff' || textColor === '#ffff00' || textColor === '#00ffff' || textColor === '#98fb98' || textColor === '#ffc0cb' || textColor === '#87ceeb' || textColor === '#40e0d0' || textColor === '#da70d6' ? '#000000' : '#ffffff' }}>A</span>
                </button>
                {showTextColorPicker && (
                  <div className="absolute top-full left-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-xl p-3 z-50 w-[280px]">
                    <div className="grid grid-cols-10 gap-1 mb-2">
                      {standardColors.map((color) => (
                        <button key={'t'+color} onClick={() => { handleTextColorChange(color); setShowTextColorPicker(false); }} className="w-6 h-6 rounded-md border border-gray-200 hover:scale-110 hover:shadow transition-transform" style={{ backgroundColor: color }} />
                      ))}
                    </div>
                    <input type="color" value={textColor} onChange={(e) => handleTextColorChange(e.target.value)} className="w-full h-9 cursor-pointer rounded" />
                  </div>
                )}
              </div>

              <span className="text-xs text-gray-500">{t('toolbar.sizeLabel')}</span>
              <input type="range" min="8" max="72" value={fontSize} onChange={(e) => handleFontSizeChange(Number(e.target.value))} className="w-24" />
              <span className="text-xs font-medium text-gray-600 w-8">{fontSize}px</span>

              <span className="text-xs text-gray-500">{t('toolbar.fontLabel')}</span>
              <select value={fontFamily} onChange={(e) => handleFontFamilyChange(e.target.value)} className="h-8 border border-gray-300 rounded-lg px-2 text-xs bg-white cursor-pointer w-44">
                {fontCategories.map((cat) => (
                  <optgroup key={cat.label} label={cat.label}>
                    {cat.fonts.map((font) => (
                      <option key={font.value} value={font.value} style={{ fontFamily: font.value }}>{font.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>

              <span className="text-xs text-gray-500">{t('toolbar.styleLabel')}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => handleFontBoldChange(!fontBold)} className={`w-8 h-8 text-sm font-bold rounded-lg ${fontBold ? 'bg-blue-500 text-white' : 'border border-gray-300 hover:bg-gray-100 text-gray-600'}`} title={t('style.bold')}>B</button>
                <button onClick={() => handleFontItalicChange(!fontItalic)} className={`w-8 h-8 text-sm italic rounded-lg ${fontItalic ? 'bg-blue-500 text-white' : 'border border-gray-300 hover:bg-gray-100 text-gray-600'}`} title={t('style.italic')}>I</button>
                <button onClick={() => handleFontUnderlineChange(!fontUnderline)} className={`w-8 h-8 text-sm underline rounded-lg ${fontUnderline ? 'bg-blue-500 text-white' : 'border border-gray-300 hover:bg-gray-100 text-gray-600'}`} title={t('style.underline')}>U</button>
                <button onClick={() => handleFontDoubleUnderlineChange(!fontDoubleUnderline)} className={`w-8 h-8 text-xs rounded-lg ${fontDoubleUnderline ? 'bg-blue-500 text-white' : 'border border-gray-300 hover:bg-gray-100 text-gray-600'}`} style={{ textDecoration: 'underline', textDecorationStyle: 'double', textUnderlineOffset: '2px' }} title={t('style.doubleUnderline')}>UU</button>
                <button onClick={() => handleFontStrikethroughChange(!fontStrikethrough)} className={`w-8 h-8 text-sm line-through rounded-lg ${fontStrikethrough ? 'bg-blue-500 text-white' : 'border border-gray-300 hover:bg-gray-100 text-gray-600'}`} title={t('style.strikethrough')}>S</button>
              </div>
            </div>

            {/* 第二行：绘图操作工具 */}
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm font-semibold px-3 py-1 bg-green-50 text-green-700 rounded-lg">{t('toolbar.drawOps')}</span>

              {/* 绘图工具组：画笔、橡皮擦、撤销、重做 */}
              <div className="flex items-center gap-1 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
                <span className="text-xs font-medium text-blue-600 mr-1">✏️</span>
                <button onClick={() => setEditTool('brush')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${editTool === 'brush' ? 'bg-green-500 text-white' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'}`}>
                  {t('toolbar.brushBtn')}
                </button>
                <button onClick={() => setEditTool('eraser')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${editTool === 'eraser' ? 'bg-green-500 text-white' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'}`}>
                  {t('toolbar.eraserBtn')}
                </button>
                <div className="h-5 w-px bg-blue-200 mx-1" />
                <button onClick={handleUndoDrawing} disabled={history.length === 0} className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${history.length === 0 ? 'bg-gray-50 text-gray-300 cursor-not-allowed border border-gray-200' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'}`}>
                  ↩ {t('toolbar.undoDrawBtn')}
                </button>
                <button onClick={handleRedoDrawing} disabled={redoHistory.length === 0} className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${redoHistory.length === 0 ? 'bg-gray-50 text-gray-300 cursor-not-allowed border border-gray-200' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'}`}>
                  ↪ {t('toolbar.redoDrawBtn')}
                </button>
              </div>

              {/* 图形工具组：选择、矩形、圆形、直线、箭头 */}
              <div className="flex items-center gap-1 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg">
                <span className="text-xs font-medium text-purple-600 mr-1">📐</span>
                <button onClick={() => setEditTool('shape-select')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${editTool === 'shape-select' ? 'bg-blue-500 text-white' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'}`}>
                  👆 {t('toolbar.shapeSelectBtn') || '选择'}
                </button>
                <button onClick={() => setEditTool('rectangle')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${editTool === 'rectangle' ? 'bg-green-500 text-white' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'}`}>
                  ⬜
                </button>
                <button onClick={() => setEditTool('circle')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${editTool === 'circle' ? 'bg-green-500 text-white' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'}`}>
                  ⭕
                </button>
                <button onClick={() => setEditTool('line')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${editTool === 'line' ? 'bg-green-500 text-white' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'}`}>
                  📏
                </button>
                <button onClick={() => setEditTool('arrow')} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${editTool === 'arrow' ? 'bg-green-500 text-white' : 'bg-white hover:bg-gray-100 text-gray-700 border border-gray-200'}`}>
                  ➡️
                </button>
              </div>

              {/* 清除全部：独立危险操作按钮 */}
              <button onClick={handleClearCanvas} className="px-4 py-2 rounded-lg text-xs font-medium bg-red-50 hover:bg-red-100 border border-red-300 text-red-600 transition-colors shadow-sm">
                🗑 {t('toolbar.clearAllBtn')}
              </button>

              {/* 口令剩余时间 */}
              {authExpiryInfo && (
                <div className="flex items-center gap-1 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{authExpiryInfo}</span>
                </div>
              )}

              <div className="h-6 w-px bg-gray-200" />

              <span className="text-xs text-gray-500">{t('toolbar.colorLabel')}</span>
              <div className="relative">
                <button onClick={() => setShowColorPicker(!showColorPicker)} className="w-8 h-8 rounded-lg border-2 border-gray-300 flex items-center justify-center hover:border-green-400 transition-colors" style={{ backgroundColor: fontColor }}>
                  <span className="text-sm font-bold" style={{ color: fontColor === '#ffffff' || fontColor === '#ffff00' || fontColor === '#00ffff' || fontColor === '#98fb98' || fontColor === '#ffc0cb' || fontColor === '#87ceeb' || fontColor === '#40e0d0' || fontColor === '#da70d6' ? '#000000' : '#ffffff' }}>A</span>
                </button>
                {showColorPicker && (
                  <div className="absolute top-full left-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-xl p-3 z-50 w-[280px]">
                    <div className="grid grid-cols-10 gap-1 mb-2">
                      {standardColors.map((color) => (
                        <button key={color} onClick={() => { setFontColor(color); setShowColorPicker(false); }} className="w-6 h-6 rounded-md border border-gray-200 hover:scale-110 hover:shadow transition-transform" style={{ backgroundColor: color }} />
                      ))}
                    </div>
                    <input type="color" value={fontColor} onChange={(e) => setFontColor(e.target.value)} className="w-full h-9 cursor-pointer rounded" />
                  </div>
                )}
              </div>

              <span className="text-xs text-gray-500">{t('toolbar.thicknessLabel')}</span>
              <input type="range" min="1" max="20" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-20" />
              <span className="text-xs font-medium text-gray-600 w-7">{brushSize}px</span>

              <div className="h-6 w-px bg-gray-200" />

              <span className="text-xs text-gray-500">{t('toolbar.inputTextLabel')}</span>
              <textarea
                value={textContent}
                onChange={(e) => handleTextContentChange(e.target.value)}
                className="h-16 w-52 resize-none border border-gray-300 rounded-lg px-2 py-1.5 text-xs"
                placeholder={selectedTextId ? t('toolbar.textInputPlaceholderEdit') : t('toolbar.textInputPlaceholder')}
              />

              <button
                onClick={handleSaveEdit}
                disabled={isLoading}
                className="px-5 py-2 bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white rounded-lg transition-all text-sm font-semibold shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? t('toolbar.savingBtn') : `💾 ${t('toolbar.saveEditBtn')}`}
              </button>
            </div>
          </div>
        )}

        {showFindReplace && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-96 max-w-[90vw]">
              <h3 className="text-lg font-bold mb-4">{t('toolbar.findReplaceTitle')}</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('dialog.findLabel')}</label>
                  <input
                    type="text"
                    value={findText}
                    onChange={(e) => setFindText(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder={t('dialog.findPlaceholder')}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('dialog.replaceLabel')}</label>
                  <input
                    type="text"
                    value={replaceText}
                    onChange={(e) => setReplaceText(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    placeholder={t('dialog.replacePlaceholder')}
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={handleFind}
                    disabled={!findText.trim()}
                    className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {t('dialog.findBtn')}
                  </button>
                  <button
                    onClick={handleReplace}
                    disabled={!findText.trim()}
                    className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {t('dialog.replaceBtn')}
                  </button>
                  <button
                    onClick={handleReplaceAll}
                    disabled={!findText.trim()}
                    className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {t('dialog.replaceAllBtn')}
                  </button>
                </div>
              </div>

              <button
                onClick={() => setShowFindReplace(false)}
                className="mt-4 w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                {t('dialog.closeBtn')}
              </button>
            </div>
          </div>
        )}

        {showPageSorter && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-[600px] max-w-[90vw] max-h-[80vh] overflow-auto">
              <h3 className="text-lg font-bold mb-4">{t('dialog.pageSortTitle')}</h3>

              <div className="grid grid-cols-4 gap-4 mb-6">
                {pageOrder.map((pageNum, index) => (
                  <div
                    key={pageNum}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`
                      relative aspect-[3/4] bg-gray-100 rounded-lg border-2 cursor-move
                      flex items-center justify-center text-sm font-bold
                      ${draggedPageIndex === index ? 'border-indigo-500 bg-indigo-50 scale-105' : 'border-gray-300 hover:border-indigo-300'}
                      transition-all
                    `}
                  >
                    <span>{t('dialog.pageLabel', { page: pageNum })}</span>
                    <span className="absolute top-1 left-1 text-xs text-gray-500">#{index + 1}</span>
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowPageSorter(false)}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  {t('dialog.cancelBtn')}
                </button>
                <button
                  onClick={applyPageOrder}
                  className="flex-1 px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors"
                >
                  {t('dialog.applyBtn')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      
      <div className="flex-1 bg-white overflow-auto relative">
        {/* ✅ Loading/Error Overlay（覆盖在Canvas上方，不销毁DOM） */}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-50">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="w-8 h-8 text-accent-600 animate-spin" />
              <p className="text-gray-500">{t('toolbar.loading')}</p>
            </div>
          </div>
        )}
        {error && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white z-50">
            <div className="text-center">
              <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-500" />
              <p className="text-red-600">{error}</p>
            </div>
          </div>
        )}

        {/* ✅ Canvas容器始终存在，不受isLoading/error影响 */}
        <div className="flex flex-col items-center py-4">
          <div className="mb-4">
            <button
              onClick={prevPage}
              disabled={currentPage <= 1}
              className="p-2 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </button>
            <span className="mx-4 px-4 py-2 bg-gray-100 rounded-full text-sm font-medium text-gray-700">
              {currentPage} / {pageCount}
            </span>
            <button
              onClick={nextPage}
              disabled={currentPage >= pageCount}
              className="p-2 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-5 h-5 text-gray-600" />
            </button>
            <button
              onClick={handleOpenPageSorter}
              disabled={!pdfData || pageCount <= 1}
              className="ml-4 px-3 py-2 rounded-lg bg-indigo-100 hover:bg-indigo-200 text-indigo-700 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              📑 {t('toolbar.pageSortBtn')}
            </button>
          </div>

          <div className="flex-1 flex overflow-auto w-full" style={{ backgroundColor: '#f0f0f0', minHeight: 'calc(100vh - 140px)' }}>
            <div className="flex-1 flex justify-center items-start overflow-auto" style={{ minHeight: 'calc(100vh - 140px)' }}>
              {/* ✅ Canvas始终存在于DOM中，不受条件渲染影响 */}
              <div
                className="relative"
                style={{
                  transform: `scale(${zoom / 100})`,
                  transformOrigin: 'top left',
                  width: '800px',
                  visibility: (pdfData && pdfUrl) ? 'visible' : 'hidden',
                }}
              >
                {/* ✅ 所有Canvas在同一容器内，确保坐标一致 */}
                <div
                  className="relative w-[800px] h-[1056px]"
                  tabIndex={isEditing ? 0 : -1}
                  onPaste={handlePasteImage}
                >
                    <canvas
                      ref={pdfCanvasCallbackRef}
                      className="absolute top-0 left-0"
                      style={{ width: '800px', height: '1056px' }}
                    />
                    {/* ✅ 编辑层始终存在（避免翻页时卸载重挂载） */}
                    <canvas
                      ref={editCanvasRef}
                      className="absolute top-0 left-0"
                      style={{
                        backgroundColor: 'transparent',
                        zIndex: 10,
                        width: '800px',
                        height: '1056px',
                        visibility: isEditing ? 'visible' : 'hidden',
                        pointerEvents: isEditing ? 'auto' : 'none',
                      }}
                    />
                    <canvas
                      ref={textCanvasRef}
                      className="absolute top-0 left-0"
                      style={{
                        backgroundColor: 'transparent',
                        cursor: editTool === 'select' ? (imageCursor !== 'default' ? imageCursor : 'default') :
                                 editTool === 'shape-select' ? 'move' :
                                 editTool === 'eraser' ? 'cell' :
                                 editTool === 'text' ? 'text' : 'crosshair',
                        zIndex: 20,
                        width: '800px',
                        height: '1056px',
                        visibility: isEditing ? 'visible' : 'hidden',
                        pointerEvents: isEditing ? 'auto' : 'none',
                      }}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();

                          const rect = e.currentTarget.getBoundingClientRect();
                          // ✅ 坐标计算：考虑CSS transform缩放
                          const scaleX = 800 / rect.width;
                          const scaleY = 1056 / rect.height;
                          const x = (e.clientX - rect.left) * scaleX;
                          const y = (e.clientY - rect.top) * scaleY;

                          // ✅ 调试：显示当前页的PDF渲染信息
                          const renderInfo = pdfRenderInfoRef.current;
                          console.log(`[MOUSE_DOWN] Client:(${e.clientX},${e.clientY}) → Canvas:(${x.toFixed(1)},${y.toFixed(1)})`);
                          console.log(`[MOUSE_DOWN] Scale:(${scaleX.toFixed(3)},${scaleY.toFixed(3)}) Rect:${rect.width.toFixed(0)}x${rect.height.toFixed(0)}`);
                          if (renderInfo) {
                            console.log(`[MOUSE_DOWN] PDF Render: ${renderInfo.renderWidth.toFixed(1)}x${renderInfo.renderHeight.toFixed(1)} Scale:${renderInfo.scale.toFixed(4)}`);
                            // 检查坐标是否在PDF渲染范围内
                            if (x > renderInfo.renderWidth || y > renderInfo.renderHeight) {
                              console.warn(`[MOUSE_DOWN] ⚠️ Coordinate outside PDF area! (${x.toFixed(1)}>${renderInfo.renderWidth.toFixed(1)} or ${y.toFixed(1)}>${renderInfo.renderHeight.toFixed(1)})`);
                            }
                          }

                          setStartPos({ x, y });

                          if (editTool === 'rectangle' || editTool === 'circle' || editTool === 'line' || editTool === 'arrow') {
                            const shapeCanvas = editCanvasRef.current;
                            if (shapeCanvas) {
                              const shapeCtx = shapeCanvas.getContext('2d', { willReadFrequently: true });
                              if (shapeCtx) {
                                shapeSnapshotRef.current = shapeCtx.getImageData(0, 0, shapeCanvas.width, shapeCanvas.height);
                              }
                            }
                          }

                          if (editTool === 'select' || editTool === 'shape-select') {
                            const clickPadding = 5;
                            const clickedImage = imageItemsRef.current.find(item =>
                              x >= item.x - clickPadding && x <= item.x + item.width + clickPadding &&
                              y >= item.y - clickPadding && y <= item.y + item.height + clickPadding
                            );

                            if (clickedImage) {
                              setSelectedImageId(clickedImage.id);
                              setSelectedTextId(null);

                              const handleSize = 8;
                              const right = clickedImage.x + clickedImage.width;
                              const bottom = clickedImage.y + clickedImage.height;
                              const centerX = clickedImage.x + clickedImage.width / 2;
                              const centerY = clickedImage.y + clickedImage.height / 2;

                              if (x >= centerX - handleSize/2 && x <= centerX + handleSize/2 &&
                                  y >= clickedImage.y - handleSize/2 && y <= clickedImage.y + handleSize/2) {
                                setIsResizingImage(true);
                                setResizeHandle('n');
                              } else if (x >= clickedImage.x - handleSize/2 && x <= clickedImage.x + handleSize/2 &&
                                        y >= centerY - handleSize/2 && y <= centerY + handleSize/2) {
                                setIsResizingImage(true);
                                setResizeHandle('w');
                              } else if (x >= right - handleSize/2 && x <= right + handleSize/2 &&
                                        y >= centerY - handleSize/2 && y <= centerY + handleSize/2) {
                                setIsResizingImage(true);
                                setResizeHandle('e');
                              } else if (x >= centerX - handleSize/2 && x <= centerX + handleSize/2 &&
                                        y >= bottom - handleSize/2 && y <= bottom + handleSize/2) {
                                setIsResizingImage(true);
                                setResizeHandle('s');
                              } else if (x >= right - handleSize/2 && x <= right + handleSize/2 &&
                                        y >= bottom - handleSize/2 && y <= bottom + handleSize/2) {
                                setIsResizingImage(true);
                                setResizeHandle('se');
                              } else {
                                setIsDraggingImage(true);
                                setDragImageOffset({ x: x - clickedImage.x, y: y - clickedImage.y });
                              }

                              setIsDrawing(true);
                              return;
                            }

                            const clickedShape = shapeItemsRef.current.find(shape => {
                              const padding = 5;
                              if (shape.type === 'line' || shape.type === 'arrow') {
                                const minX = Math.min(shape.x, shape.endX) - padding;
                                const minY = Math.min(shape.y, shape.endY) - padding;
                                const maxX = Math.max(shape.x, shape.endX) + padding;
                                const maxY = Math.max(shape.y, shape.endY) + padding;
                                return x >= minX && x <= maxX && y >= minY && y <= maxY;
                              } else {
                                return x >= shape.x - padding && x <= shape.x + shape.width + padding &&
                                       y >= shape.y - padding && y <= shape.y + shape.height + padding;
                              }
                            });

                            if (clickedShape) {
                              console.log('[SHAPE_SELECT] ✅ Shape clicked! ID:', clickedShape.id, 'Type:', clickedShape.type);
                              setSelectedShapeId(clickedShape.id);
                              console.log('[SHAPE_SELECT] setSelectedShapeId called, ref will update on next render');
                              setSelectedTextId(null);
                              setSelectedImageId(null);
                              setIsDrawing(true);

                              if ((clickedShape.type === 'line' || clickedShape.type === 'arrow')) {
                                const centerX = (clickedShape.x + clickedShape.endX) / 2;
                                const centerY = (clickedShape.y + clickedShape.endY) / 2;
                                const rotateHandleY = centerY + 25;

                                if (Math.abs(x - centerX) < 10 && Math.abs(y - rotateHandleY) < 10) {
                                  setIsRotatingShape(true);
                                  setDragShapeOffset({ x: x, y: y });
                                } else {
                                  setIsDraggingShape(true);
                                  setDragShapeOffset({ x: x - clickedShape.x, y: y - clickedShape.y });
                                }
                              } else {
                                setIsDraggingShape(true);
                                setDragShapeOffset({ x: x - clickedShape.x, y: y - clickedShape.y });
                              }
                              return;
                            }

                            const clickedText = textItemsRef.current.find(item => {
                              const canvas = document.createElement('canvas');
                              const ctx = canvas.getContext('2d');
                              if (!ctx) return false;
                              ctx.font = buildFontString(item);
                              const metrics = ctx.measureText(item.text);
                              return x >= item.x && x <= item.x + metrics.width &&
                                     y >= item.y - item.fontSize && y <= item.y;
                            });

                            if (clickedText) {
                              setSelectedTextId(clickedText.id);
                              setSelectedImageId(null);
                              setIsDrawing(true);
                              dragOffsetRef.current = {
                                x: x - clickedText.x,
                                y: y - clickedText.y
                              };
                            } else {
                              setSelectedTextId(null);
                              setSelectedImageId(null);
                              setSelectedShapeId(null);
                            }
                            return;
                          }
                          setIsDrawing(true);
                          
                          if (editTool === 'brush' || editTool === 'eraser') {
                            const drawCanvas = editCanvasRef.current;
                            if (drawCanvas) {
                              setHistory(prev => [...prev, drawCanvas.toDataURL()]);
                            }
                          }
                        }}
                        onMouseMove={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const scaleX = 800 / rect.width;
                          const scaleY = 1056 / rect.height;
                          const x = (e.clientX - rect.left) * scaleX;
                          const y = (e.clientY - rect.top) * scaleY;

                          if (editTool === 'select' && !isDrawing) {
                            const hoveredImage = imageItems.find(item =>
                              x >= item.x && x <= item.x + item.width &&
                              y >= item.y && y <= item.y + item.height
                            );

                            if (hoveredImage) {
                              setImageCursor(getImageCursor(x, y, hoveredImage));
                            } else {
                              setImageCursor('default');
                            }
                          }

                          if (!isDrawing) return;
                          
                          if (editTool === 'select' && selectedImageId) {
                            const canvas = textCanvasRef.current;
                            if (!canvas) return;

                            const ctx = canvas.getContext('2d');
                            if (!ctx) return;

                            const selectedImage = imageItems.find(item => item.id === selectedImageId);
                            if (!selectedImage) return;

                            if (isDraggingImage) {
                              const newX = x - dragImageOffset.x;
                              const newY = y - dragImageOffset.y;
                              setImageItems(prev => prev.map(item =>
                                item.id === selectedImageId
                                  ? { ...item, x: Math.max(0, newX), y: Math.max(0, newY) }
                                  : item
                              ));
                            } else if (isResizingImage && resizeHandle) {
                              const minSize = 50;
                              let newX = selectedImage.x;
                              let newY = selectedImage.y;
                              let newWidth = selectedImage.width;
                              let newHeight = selectedImage.height;

                              switch (resizeHandle) {
                                case 'n':
                                  const nHeight = Math.max(minSize, selectedImage.y + selectedImage.height - y);
                                  newY = selectedImage.y + selectedImage.height - nHeight;
                                  newHeight = nHeight;
                                  break;

                                case 'w':
                                  const wWidth = Math.max(minSize, selectedImage.x + selectedImage.width - x);
                                  newX = selectedImage.x + selectedImage.width - wWidth;
                                  newWidth = wWidth;
                                  break;

                                case 'e':
                                  newWidth = Math.max(minSize, x - selectedImage.x);
                                  break;

                                case 's':
                                  newHeight = Math.max(minSize, y - selectedImage.y);
                                  break;

                                case 'se':
                                  const aspectRatio = selectedImage.width / selectedImage.height;
                                  let seWidth = x - selectedImage.x;
                                  let seHeight = seWidth / aspectRatio;
                                  if (seHeight < minSize) {
                                    seHeight = minSize;
                                    seWidth = seHeight * aspectRatio;
                                  }
                                  newWidth = seWidth;
                                  newHeight = seHeight;
                                  break;
                              }

                              setImageItems(prev => prev.map(item =>
                                item.id === selectedImageId
                                  ? { ...item, x: newX, y: newY, width: newWidth, height: newHeight }
                                  : item
                              ));
                            }

                            return;
                          }

                          if ((editTool === 'select' || editTool === 'shape-select') && selectedShapeIdRef.current) {
                            const selectedShape = shapeItemsRef.current.find(item => item.id === selectedShapeIdRef.current);
                            if (!selectedShape) return;

                            if (isDraggingShape) {
                              const newX = x - dragShapeOffset.x;
                              const newY = y - dragShapeOffset.y;
                              const dx = newX - selectedShape.x;
                              const dy = newY - selectedShape.y;

                              setShapeItems(prev => prev.map(item =>
                                item.id === selectedShapeIdRef.current
                                  ? {
                                      ...item,
                                      x: item.x + dx,
                                      y: item.y + dy,
                                      endX: item.endX + dx,
                                      endY: item.endY + dy,
                                    }
                                  : item
                              ));
                            } else if (isRotatingShape) {
                              const centerX = (selectedShape.x + selectedShape.endX) / 2;
                              const centerY = (selectedShape.y + selectedShape.endY) / 2;

                              const startAngle = Math.atan2(dragShapeOffset.y - centerY, dragShapeOffset.x - centerX);
                              const currentAngle = Math.atan2(y - centerY, x - centerX);
                              const angleDiff = currentAngle - startAngle;

                              const cos = Math.cos(angleDiff);
                              const sin = Math.sin(angleDiff);

                              const rotatePoint = (px: number, py: number) => {
                                const rx = px - centerX;
                                const ry = py - centerY;
                                return {
                                  x: rx * cos - ry * sin + centerX,
                                  y: rx * sin + ry * cos + centerY
                                };
                              };

                              const newStart = rotatePoint(selectedShape.x, selectedShape.y);
                              const newEnd = rotatePoint(selectedShape.endX, selectedShape.endY);

                              setShapeItems(prev => prev.map(item =>
                                item.id === selectedShapeIdRef.current
                                  ? {
                                      ...item,
                                      x: newStart.x,
                                      y: newStart.y,
                                      endX: newEnd.x,
                                      endY: newEnd.y,
                                    }
                                  : item
                              ));
                            }

                            return;
                          }

                          if (editTool === 'select' && selectedTextId) {
                            const canvas = textCanvasRef.current;
                            if (!canvas) return;
                            
                            const ctx = canvas.getContext('2d');
                            if (!ctx) return;
                            
                            const selectedItem = textItems.find(item => item.id === selectedTextId);
                            if (!selectedItem) return;
                            
                            const newX = x - dragOffsetRef.current.x;
                            const newY = y - dragOffsetRef.current.y;
                            
                            ctx.clearRect(0, 0, CANVAS_BASE_WIDTH, CANVAS_BASE_HEIGHT);
                            
                            textItems.forEach(item => {
                              const drawX = item.id === selectedTextId ? newX : item.x;
                              const drawY = item.id === selectedTextId ? newY : item.y;
                              const displayItem = item.id === selectedTextId ? { ...item, x: drawX, y: drawY } : item;
                              
                              ctx.fillStyle = item.color;
                              ctx.font = buildFontString(item);
                              drawMultiLineText(ctx, item, drawX, drawY);
                              drawTextDecorations(ctx, displayItem);

                              if (item.id === selectedTextId) {
                                const tl = item.text.split('\n');
                                let mw = 0;
                                tl.forEach(l => { const m = ctx.measureText(l); if (m.width > mw) mw = m.width; });
                                const tw = mw;
                                const th = tl.length * item.fontSize * 1.4;
                                ctx.strokeStyle = '#00ff00';
                                ctx.lineWidth = 1;
                                ctx.strokeRect(drawX - 2, drawY - item.fontSize - 2, tw + 4, th + 4);
                              }
                            });
                            
                            return;
                          }
                          
                          let canvas: HTMLCanvasElement | null;
                          if (editTool === 'rectangle' || editTool === 'circle' || editTool === 'line' || editTool === 'arrow') {
                            canvas = shapeCanvasRef.current;
                          } else {
                            canvas = editCanvasRef.current;
                          }
                          if (!canvas) return;

                          const ctx = canvas.getContext('2d', { willReadFrequently: true });
                          if (!ctx) return;

                          if (editTool === 'brush') {
                            ctx.beginPath();
                            ctx.strokeStyle = fontColor;
                            ctx.lineWidth = brushSize;
                            ctx.lineCap = 'round';
                            ctx.lineTo(startPos.x, startPos.y);
                            ctx.lineTo(x, y);
                            ctx.stroke();
                            setStartPos({ x, y });
                          } else if (editTool === 'eraser') {
                            ctx.beginPath();
                            ctx.strokeStyle = '#ffffff';
                            ctx.lineWidth = brushSize * 3;
                            ctx.lineCap = 'round';
                            ctx.lineTo(startPos.x, startPos.y);
                            ctx.lineTo(x, y);
                            ctx.stroke();
                            setStartPos({ x, y });
                          } else if (editTool === 'rectangle') {
                            if (shapeSnapshotRef.current) {
                              ctx.putImageData(shapeSnapshotRef.current, 0, 0);
                            }
                            ctx.strokeStyle = fontColor;
                            ctx.lineWidth = brushSize;
                            ctx.strokeRect(startPos.x, startPos.y, x - startPos.x, y - startPos.y);
                          } else if (editTool === 'circle') {
                            if (shapeSnapshotRef.current) {
                              ctx.putImageData(shapeSnapshotRef.current, 0, 0);
                            }
                            ctx.strokeStyle = fontColor;
                            ctx.lineWidth = brushSize;
                            const radiusX = Math.abs(x - startPos.x) / 2;
                            const radiusY = Math.abs(y - startPos.y) / 2;
                            const centerX = startPos.x + (x - startPos.x) / 2;
                            const centerY = startPos.y + (y - startPos.y) / 2;
                            ctx.beginPath();
                            ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
                            ctx.stroke();
                          } else if (editTool === 'line') {
                            if (shapeSnapshotRef.current) {
                              ctx.putImageData(shapeSnapshotRef.current, 0, 0);
                            }
                            ctx.strokeStyle = fontColor;
                            ctx.lineWidth = brushSize;
                            ctx.lineCap = 'round';
                            ctx.beginPath();
                            ctx.moveTo(startPos.x, startPos.y);
                            ctx.lineTo(x, y);
                            ctx.stroke();
                          } else if (editTool === 'arrow') {
                            if (shapeSnapshotRef.current) {
                              ctx.putImageData(shapeSnapshotRef.current, 0, 0);
                            }
                            ctx.strokeStyle = fontColor;
                            ctx.fillStyle = fontColor;
                            ctx.lineWidth = brushSize;

                            const headlen = 15;
                            const angle = Math.atan2(y - startPos.y, x - startPos.x);

                            ctx.beginPath();
                            ctx.moveTo(startPos.x, startPos.y);
                            ctx.lineTo(x, y);
                            ctx.stroke();

                            ctx.beginPath();
                            ctx.moveTo(x, y);
                            ctx.lineTo(x - headlen * Math.cos(angle - Math.PI / 6), y - headlen * Math.sin(angle - Math.PI / 6));
                            ctx.lineTo(x - headlen * Math.cos(angle + Math.PI / 6), y - headlen * Math.sin(angle + Math.PI / 6));
                            ctx.closePath();
                            ctx.fill();
                          }
                        }}
                        onMouseUp={(e) => {
                          if (!isDrawing) {
                            setIsDrawing(false);
                            return;
                          }

                          const rect = e.currentTarget.getBoundingClientRect();
                          // ✅ 使用相同的坐标计算方式
                          const scaleX = 800 / rect.width;
                          const scaleY = 1056 / rect.height;
                          const x = (e.clientX - rect.left) * scaleX;
                          const y = (e.clientY - rect.top) * scaleY;

                          if (editTool === 'select' && selectedImageId) {
                            if (isDraggingImage || isResizingImage) {
                              setImageHistory(prev => [...prev, [...imageItems]]);
                              setRedoImageHistory([]);
                            }
                            setIsDraggingImage(false);
                            setIsResizingImage(false);
                            setResizeHandle(null);
                            setIsDrawing(false);
                            return;
                          }

                          if ((editTool === 'select' || editTool === 'shape-select') && selectedShapeId) {
                            setIsDraggingShape(false);
                            setIsRotatingShape(false);
                            setIsDrawing(false);
                            return;
                          }

                          if (editTool === 'select' && selectedTextId) {
                            setTextHistory(prev => [...prev, [...textItems]]);
                            const finalX = x - dragOffsetRef.current.x;
                            const finalY = y - dragOffsetRef.current.y;
                            
                            setTextItems(prev => prev.map(item => {
                              if (item.id === selectedTextId) {
                                return { ...item, x: finalX, y: finalY };
                              }
                              return item;
                            }));
                            setIsDrawing(false);
                            return;
                          }
                          
                          const canvas = editCanvasRef.current;
                          if (!canvas) {
                            setIsDrawing(false);
                            return;
                          }
                          
                          const ctx = canvas.getContext('2d');
                          if (!ctx) {
                            setIsDrawing(false);
                            return;
                          }
                          
                          if (editTool === 'rectangle' || editTool === 'circle' || editTool === 'line' || editTool === 'arrow') {
                            const newShape: ShapeItem = {
                              id: Date.now().toString(),
                              type: editTool as ShapeItem['type'],
                              x: Math.min(startPos.x, x),
                              y: Math.min(startPos.y, y),
                              width: Math.abs(x - startPos.x),
                              height: Math.abs(y - startPos.y),
                              endX: x,
                              endY: y,
                              color: fontColor,
                              lineWidth: brushSize,
                            };
                            setShapeItems(prev => [...prev, newShape]);
                          } else if (editTool === 'text') {
                            setTextHistory(prev => [...prev, [...textItems]]);
                            const newText: TextItem = {
                              id: Date.now().toString(),
                              text: textContent || 'Text',
                              x: startPos.x,
                              y: startPos.y,
                              color: textColor,
                              fontSize: fontSize,
                              fontFamily: fontFamily,
                              fontBold: fontBold,
                              fontItalic: fontItalic,
                              fontUnderline: fontUnderline,
                              fontDoubleUnderline: fontDoubleUnderline,
                              fontStrikethrough: fontStrikethrough
                            };
                            setTextItems(prev => [...prev, newText]);
                            drawAllText();
                          }
                          
                          if (editTool === 'brush' || editTool === 'eraser') {
                            const drawCanvas = editCanvasRef.current;
                            if (drawCanvas) {
                              setHistory(prev => [...prev, drawCanvas.toDataURL()]);
                            }
                          }
                          
                          shapeSnapshotRef.current = null;
                          setIsDrawing(false);
                        }}
                        onMouseLeave={() => {
                          setIsDrawing(false);
                          shapeSnapshotRef.current = null;
                        }}
                      />
                    <canvas
                      ref={shapeCanvasRef}
                      className="absolute top-0 left-0"
                      style={{
                        backgroundColor: 'transparent',
                        zIndex: 15,
                        width: '800px',
                        height: '1056px',
                        visibility: isEditing ? 'visible' : 'hidden',
                        pointerEvents: 'none',
                      }}
                    />
                  </div>
                </div>
                {!pdfData && (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <FileText className="w-16 h-16 mb-4 opacity-50" />
                    <p>{t('sidebar.uploadHint')}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
      </div>

      {/* ──────────────────────────────────────── */}
      {/* 👑 管理员面板（弹窗） */}
      {/* ──────────────────────────────────────── */}
      {showAdminPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setShowAdminPanel(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            {/* 面板头部 */}
            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-purple-500 to-indigo-600 text-white">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                <h2 className="text-lg font-bold">管理面板</h2>
              </div>
              <button onClick={() => setShowAdminPanel(false)} className="p-1 hover:bg-white/20 rounded-lg transition-colors">
                ✕
              </button>
            </div>

            {/* 面板内容（可滚动） */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">

              {/* ── 生成新口令 ── */}
              <section>
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1">
                  🔑 生成新口令
                </h3>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={newCodeLabel}
                    onChange={e => setNewCodeLabel(e.target.value)}
                    placeholder="备注标签（如：张三、客户A、临时用户）"
                    className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm outline-none focus:border-purple-400"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">会话保持（小时）</label>
                      <select
                        value={newCodeValidHours}
                        onChange={e => setNewCodeValidHours(Number(e.target.value))}
                        className="w-full h-9 border border-gray-200 rounded-lg text-sm px-2 bg-white"
                      >
                        {[0, 4, 8, 12, 24, 48].map(h => (
                          <option key={h} value={h}>{h === 0 ? '每次需输入' : `${h}小时`}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">总可用时长（小时）</label>
                      <select
                        value={newCodeMaxHours}
                        onChange={e => setNewCodeMaxHours(Number(e.target.value))}
                        className="w-full h-9 border border-gray-200 rounded-lg text-sm px-2 bg-white"
                      >
                        {[0, 24, 48, 72, 168, 720].map(h => (
                          <option key={h} value={h}>{h === 0 ? '不限' : `${h}小时`}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <button
                    onClick={handleGenerateCode}
                    disabled={!newCodeLabel.trim()}
                    className={`w-full h-10 rounded-lg font-medium text-sm transition-all ${
                      newCodeLabel.trim()
                        ? 'bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 text-white shadow-md'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    生成口令并发放
                  </button>

                  {/* 新生成的口令显示 */}
                  {lastGeneratedCode && (
                    <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-xs text-green-600 mb-1">✅ 口令已生成！请复制给使用者：</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-lg font-mono font-bold text-green-800 tracking-widest text-center py-1">
                          {lastGeneratedCode}
                        </code>
                        <button
                          onClick={() => handleCopyCode(lastGeneratedCode)}
                          className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg transition-colors"
                        >
                          {copySuccess ? '已复制!' : '复制'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* 分割线 */}
              <hr className="border-gray-100" />

              {/* ── 已生成的口令列表 ── */}
              <section>
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1">
                  📋 已生成的口令 ({generatedCodes.length})
                </h3>
                {generatedCodes.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">暂无生成的口令</p>
                ) : (
                  <div className="space-y-2">
                    {generatedCodes.map(code => {
                      const isExpired = code.maxUsageHours > 0 && (Date.now() - code.createdAt) > code.maxUsageHours * 60 * 60 * 1000;
                      return (
                        <div key={code.code} className={`flex items-center justify-between p-3 rounded-lg border ${
                          isExpired ? 'bg-gray-50 border-gray-200 opacity-60' : 'bg-white border-gray-200'
                        }`}>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <code className="font-mono font-bold text-sm text-purple-700">{code.code}</code>
                              {isExpired && <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded">已过期</span>}
                            </div>
                            <p className="text-xs text-gray-500 truncate">{code.label}</p>
                            <p className="text-[10px] text-gray-400">
                              有效{code.maxUsageHours === 0 ? '不限' : `${code.maxUsageHours}h`} · 会话{code.validHours === 0 ? '每次输入' : `${code.validHours}h`} · 使用{code.usedCount}次
                            </p>
                          </div>
                          <div className="flex items-center gap-1 ml-3 shrink-0">
                            <button
                              onClick={() => handleCopyCode(code.code)}
                              className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                            >
                              复制
                            </button>
                            <button
                              onClick={() => handleDeleteCode(code.code)}
                              className="px-2 py-1 text-xs bg-red-50 hover:bg-red-100 text-red-600 rounded transition-colors"
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

            </div>

            {/* 面板底部 */}
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-100 text-center">
              <p className="text-[10px] text-gray-400">
                提示：部署前请在代码中修改管理员口令和默认配置
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
