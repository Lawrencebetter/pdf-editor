import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument as PDFLibDocument } from 'pdf-lib';

if (typeof window !== 'undefined') {
  const scriptUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url);
  pdfjsLib.GlobalWorkerOptions.workerSrc = scriptUrl.href;
}

export async function getPDFPageCount(pdfData: Uint8Array): Promise<number> {
  const dataCopy = Uint8Array.from(pdfData);
  const pdf = await pdfjsLib.getDocument({ data: dataCopy }).promise;
  return pdf.numPages;
}

export async function getPDFTextContent(pdfData: Uint8Array, pageNumber: number): Promise<string> {
  const dataCopy = Uint8Array.from(pdfData);
  const pdf = await pdfjsLib.getDocument({ data: dataCopy }).promise;
  const page = await pdf.getPage(pageNumber);
  const textContent = await page.getTextContent();
  return textContent.items.map((item) => (item as { str: string }).str).join(' ');
}

export async function renderPDFPage(
  pdfData: Uint8Array,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number = 2.0
): Promise<void> {
  console.log(`[pdfUtils] renderPDFPage - page: ${pageNumber}, scale: ${scale}`);
  
  const dataCopy = Uint8Array.from(pdfData);
  const pdf = await pdfjsLib.getDocument({ 
    data: dataCopy,
    verbosity: pdfjsLib.VerbosityLevel.INFOS,
    cMapUrl: 'https://unpkg.com/pdfjs-dist@4.10.38/cmaps/',
    cMapPacked: true,
  }).promise;
  console.log(`[pdfUtils] PDF loaded, pages: ${pdf.numPages}`);
  
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  
  console.log(`[pdfUtils] Viewport: ${viewport.width}x${viewport.height}`);
  
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.log('[pdfUtils] Failed to get canvas context');
    return;
  }
  
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  try {
    console.log('[pdfUtils] Starting render...');
    await page.render({
      canvasContext: ctx,
      viewport,
      intent: 'display',
    }).promise;
    console.log(`[pdfUtils] Page rendered successfully`);
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let hasContent = false;
    for (let i = 0; i < imageData.data.length; i += 4) {
      if (imageData.data[i] !== 255 || imageData.data[i+1] !== 255 || imageData.data[i+2] !== 255) {
        hasContent = true;
        break;
      }
    }
    console.log(`[pdfUtils] Canvas has content: ${hasContent}`);
    
  } catch (renderError) {
    console.error('[pdfUtils] Render error:', renderError);
    ctx.fillStyle = '#ff0000';
    ctx.font = '16px Arial';
    ctx.fillText('Render failed: ' + (renderError as Error).message, 20, 60);
  }
}

export async function modifyPDFText(
  pdfData: Uint8Array,
  pageIndex: number,
  _oldText: string,
  newText: string
): Promise<Uint8Array> {
  const pdfDoc = await PDFLibDocument.load(pdfData);
  const pages = pdfDoc.getPages();
  const page = pages[pageIndex];
  
  const { height } = page.getSize();
  
  page.drawText(newText, {
    x: 50,
    y: height - 50,
    size: 12,
  });
  
  return pdfDoc.save();
}

export async function addPageToPDF(pdfData: Uint8Array): Promise<Uint8Array> {
  const pdfDoc = await PDFLibDocument.load(pdfData);
  const pageSize = pdfDoc.getPages()[0]?.getSize() || { width: 612, height: 792 };
  pdfDoc.addPage([pageSize.width, pageSize.height]);
  return pdfDoc.save();
}

export async function removePageFromPDF(pdfData: Uint8Array, pageIndex: number): Promise<Uint8Array> {
  const pdfDoc = await PDFLibDocument.load(pdfData);
  pdfDoc.removePage(pageIndex);
  return pdfDoc.save();
}

export async function exportPDFAsText(pdfData: Uint8Array): Promise<string> {
  const dataCopy = Uint8Array.from(pdfData);
  const pdf = await pdfjsLib.getDocument({ data: dataCopy }).promise;
  const numPages = pdf.numPages;
  let text = '';
  
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    text += textContent.items.map((item) => (item as { str: string }).str).join(' ') + '\n\n';
  }
  
  return text;
}

export async function mergePDFs(pdfDataArray: Uint8Array[]): Promise<Uint8Array> {
  const mergedDoc = await PDFLibDocument.create();
  
  for (const pdfData of pdfDataArray) {
    const pdfDoc = await PDFLibDocument.load(pdfData);
    const pages = pdfDoc.getPages();
    const pageIndices = pages.map((_, index) => index);
    
    const copiedPages = await mergedDoc.copyPages(pdfDoc, pageIndices);
    copiedPages.forEach((page) => mergedDoc.addPage(page));
  }
  
  return mergedDoc.save();
}

export async function extractImagesFromPDF(_pdfData: Uint8Array): Promise<string[]> {
  return [];
}