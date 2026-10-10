export interface Language {
  code: string;
  name: string;
}

export interface QuarterlySummary {
  id: string;
  title: string;
  human_date?: string;
  start_date?: string;
  end_date?: string;
  description?: string;
  cover?: string;
  splash?: string;
  color_primary?: string;
  color_primary_dark?: string;
  lang?: string;
  index?: string;
  path?: string;
  full_path?: string;
}

export interface LessonSummary {
  id: string;
  title: string;
  start_date?: string;
  end_date?: string;
  pdfOnly?: boolean;
  cover?: string;
  index?: string;
  path?: string;
  full_path?: string;
}

export interface PdfItem {
  id: string;
  src: string;
  title: string;
  target?: string;
  start_date?: string;
  end_date?: string;
}

export interface LessonDay {
  id: string;
  title: string;
  date: string;
  index: string;
  path: string;
  full_path: string;
  read?: boolean;
}

export interface LessonDetailResponse {
  lesson: LessonSummary;
  pdfs?: PdfItem[];
  days?: LessonDay[];
  error?: string;
}

export interface QuarterlyDetailResponse {
  quarterly: QuarterlySummary;
  lessons: LessonSummary[];
  _base?: string;
  _id?: string;
  _jsonShown?: boolean;
}

export interface DownloadItem {
  pdf: PdfItem;
  lessonId: string;
  fileName: string;
}

export type LogLevel = 'info' | 'success' | 'error';

export interface LogEntry {
  id: string;
  time: string;
  message: string;
  level: LogLevel;
}
