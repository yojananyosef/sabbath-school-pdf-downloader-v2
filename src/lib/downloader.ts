import JSZip from 'jszip';
import type { DownloadItem, LogLevel } from '../types/adventech';
import { formatBytes } from './formatters';

export interface DownloadProgress {
  current: number;
  total: number;
  percentage: number;
  currentFileName?: string;
  bytesReceived?: number;
  totalBytes?: number;
}

export type ProgressCallback = (progress: DownloadProgress) => void;
export type LogCallback = (message: string, level: LogLevel) => void;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

/**
 * Downloads a single PDF file, tracking byte-level progress if Content-Length is provided.
 */
export async function downloadSinglePdf(
  item: DownloadItem,
  onProgress?: (percentage: number) => void,
  onLog?: LogCallback,
  signal?: AbortSignal
): Promise<void> {
  const { fileName, pdf } = item;
  onLog?.(`Iniciando descarga: ${fileName}`, 'info');

  const response = await fetch(pdf.src, { signal });
  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status} (${response.statusText})`);
  }

  const contentLength = Number(response.headers.get('content-length')) || 0;
  let blob: Blob;

  if (response.body && contentLength > 0) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    while (true) {
      if (signal?.aborted) {
        await reader.cancel();
        throw new DOMException('Descarga cancelada por el usuario', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      received += value.length;
      const pct = Math.round((received / contentLength) * 100);
      onProgress?.(pct);
    }
    blob = new Blob(chunks, { type: 'application/pdf' });
  } else {
    blob = await response.blob();
    onProgress?.(100);
  }

  triggerBrowserDownload(blob, fileName);
  onLog?.(`✓ Descargado con éxito: ${fileName} (${formatBytes(blob.size)})`, 'success');
}

/**
 * Downloads a batch of PDFs sequentially with a pause between each download
 * to avoid browser popup/download blocker triggers.
 */
export async function downloadBatchSequential(
  items: DownloadItem[],
  onProgress?: ProgressCallback,
  onLog?: LogCallback,
  signal?: AbortSignal,
  delayMs = 600
): Promise<{ successful: number; failed: number }> {
  let successful = 0;
  let failed = 0;
  const total = items.length;
  const startTime = performance.now();

  onLog?.(`Iniciando descarga secuencial de ${total} archivos...`, 'info');

  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) {
      onLog?.('Descarga por lotes detenida por el usuario.', 'error');
      break;
    }

    const item = items[i];
    const currentIndex = i + 1;

    onProgress?.({
      current: currentIndex,
      total,
      percentage: Math.round(((currentIndex - 1) / total) * 100),
      currentFileName: item.fileName
    });

    onLog?.(`[${currentIndex}/${total}] Descargando: ${item.fileName}`, 'info');

    try {
      const response = await fetch(item.pdf.src, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();

      triggerBrowserDownload(blob, item.fileName);
      successful++;
      onLog?.(`✓ [${currentIndex}/${total}] Completado: ${item.fileName} (${formatBytes(blob.size)})`, 'success');
    } catch (err: any) {
      if (err.name === 'AbortError') {
        onLog?.('Operación cancelada.', 'error');
        break;
      }
      failed++;
      onLog?.(`✗ Error en ${item.fileName}: ${err.message}`, 'error');
    }

    onProgress?.({
      current: currentIndex,
      total,
      percentage: Math.round((currentIndex / total) * 100),
      currentFileName: item.fileName
    });

    if (i < items.length - 1 && !signal?.aborted) {
      await sleep(delayMs);
    }
  }

  const elapsedSeconds = ((performance.now() - startTime) / 1000).toFixed(1);
  onLog?.(
    `Lote finalizado en ${elapsedSeconds}s — ${successful} correctos, ${failed} fallidos.`,
    failed > 0 ? 'error' : 'success'
  );

  return { successful, failed };
}

/**
 * Downloads all PDFs and bundles them into a single .zip file.
 * Concurrent download pooling (3 parallel requests) for blazing speed.
 */
export async function downloadAsZip(
  items: DownloadItem[],
  zipFileName: string,
  onProgress?: ProgressCallback,
  onLog?: LogCallback,
  signal?: AbortSignal,
  concurrency = 3
): Promise<void> {
  const total = items.length;
  if (total === 0) return;

  const zip = new JSZip();
  const startTime = performance.now();
  onLog?.(`Preparando archivo ZIP con ${total} PDFs...`, 'info');

  let completedDownloads = 0;
  const queue = [...items];

  // Parallel download pool
  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (queue.length > 0) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const item = queue.shift();
      if (!item) break;

      try {
        const response = await fetch(item.pdf.src, { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();

        zip.file(item.fileName, arrayBuffer);
        completedDownloads++;

        const pct = Math.round((completedDownloads / total) * 80); // 0-80% for download
        onProgress?.({
          current: completedDownloads,
          total,
          percentage: pct,
          currentFileName: item.fileName
        });

        onLog?.(`✓ Añadido al ZIP: ${item.fileName} (${formatBytes(arrayBuffer.byteLength)})`, 'info');
      } catch (err: any) {
        if (err.name === 'AbortError') throw err;
        onLog?.(`⚠ No se pudo incluir ${item.fileName}: ${err.message}`, 'error');
      }
    }
  });

  await Promise.all(workers);

  if (signal?.aborted) {
    onLog?.('Generación de ZIP cancelada.', 'error');
    return;
  }

  onLog?.('Comprimiendo archivos en ZIP...', 'info');
  onProgress?.({
    current: total,
    total,
    percentage: 85,
    currentFileName: 'Comprimiendo ZIP...'
  });

  const zipBlob = await zip.generateAsync(
    {
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    },
    metadata => {
      const compressionPct = Math.round(85 + (metadata.percent * 0.15));
      onProgress?.({
        current: total,
        total,
        percentage: compressionPct,
        currentFileName: `Comprimiendo: ${metadata.percent.toFixed(0)}%`
      });
    }
  );

  triggerBrowserDownload(zipBlob, zipFileName);

  const elapsedSeconds = ((performance.now() - startTime) / 1000).toFixed(1);
  onLog?.(
    `✓ ¡ZIP descargado con éxito! ${zipFileName} (${formatBytes(zipBlob.size)}) en ${elapsedSeconds}s`,
    'success'
  );

  onProgress?.({
    current: total,
    total,
    percentage: 100,
    currentFileName: 'Completado'
  });
}
