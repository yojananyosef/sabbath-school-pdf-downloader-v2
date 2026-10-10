import type { PdfItem } from '../types/adventech';

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c] || c));
}

export function stripHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '?';
  if (bytes >= 1048576) {
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }
  return `${Math.round(bytes / 1024)} KB`;
}

export function slugify(text: string): string {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 70);
}

export function getPdfFileName(quarterId: string, lang: string, lessonId: string, pdf: PdfItem): string {
  const slugTitle = slugify(pdf.title) || pdf.id.slice(0, 8);
  return `${quarterId}_${lang}_L${lessonId}_${slugTitle}.pdf`;
}

export function getQuarterZipFileName(quarterId: string, lang: string): string {
  return `${quarterId}_${lang}_completo.zip`;
}

export function getLessonZipFileName(quarterId: string, lang: string, lessonId: string): string {
  return `${quarterId}_${lang}_L${lessonId}.zip`;
}
