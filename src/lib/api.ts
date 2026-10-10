import type {
  Language,
  QuarterlySummary,
  QuarterlyDetailResponse,
  LessonDetailResponse
} from '../types/adventech';

const API_BASE = 'https://sabbath-school.adventech.io/api/v2';

// In-memory cache
const memoryCache = new Map<string, unknown>();

// Popular languages to place at top of selector
export const POPULAR_LANGUAGES: Language[] = [
  { code: 'es', name: 'Español' },
  { code: 'en', name: 'English' },
  { code: 'pt', name: 'Português' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'ro', name: 'Română' },
  { code: 'ru', name: 'Русский' },
  { code: 'uk', name: 'Українська' },
  { code: 'ko', name: '한국어' }
];

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const cacheKey = `ss_api_${path}`;

  // Check memory cache
  if (memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey) as T;
  }

  // Check sessionStorage
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      memoryCache.set(cacheKey, parsed);
      return parsed as T;
    }
  } catch {
    // sessionStorage not available or full
  }

  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} (${response.statusText}) al consultar ${path}`);
  }

  const data = (await response.json()) as T;
  memoryCache.set(cacheKey, data);

  try {
    sessionStorage.setItem(cacheKey, JSON.stringify(data));
  } catch {
    // Quota exceeded or private browsing
  }

  return data;
}

export async function getLanguages(signal?: AbortSignal): Promise<Language[]> {
  try {
    const list = await fetchJson<Language[]>('/languages/index.json', signal);
    // Sort placing popular languages on top, followed by the rest alphabetically
    const popularCodes = new Set(POPULAR_LANGUAGES.map(l => l.code));
    const rest = list.filter(l => !popularCodes.has(l.code)).sort((a, b) => a.name.localeCompare(b.name));
    return [...POPULAR_LANGUAGES, ...rest];
  } catch (err) {
    console.warn('No se pudo cargar la lista completa de idiomas, usando predeterminados:', err);
    return POPULAR_LANGUAGES;
  }
}

export async function getQuarterlies(lang: string, signal?: AbortSignal): Promise<QuarterlySummary[]> {
  return fetchJson<QuarterlySummary[]>(`/${lang}/quarterlies/index.json`, signal);
}

export async function getQuarterlyIndex(
  lang: string,
  quarterId: string,
  signal?: AbortSignal
): Promise<QuarterlyDetailResponse> {
  const data = await fetchJson<QuarterlyDetailResponse>(`/${lang}/quarterlies/${quarterId}/index.json`, signal);
  data._base = `/${lang}/quarterlies/${quarterId}`;
  data._id = quarterId;
  return data;
}

export async function getLessonDetail(
  lang: string,
  quarterId: string,
  lessonId: string,
  signal?: AbortSignal
): Promise<LessonDetailResponse> {
  return fetchJson<LessonDetailResponse>(
    `/${lang}/quarterlies/${quarterId}/lessons/${lessonId}/index.json`,
    signal
  );
}

/**
 * Loads all lessons for a quarterly in parallel batches with concurrency control and progress tracking.
 */
export async function loadAllLessons(
  lang: string,
  quarterId: string,
  lessonIds: string[],
  concurrency = 5,
  onProgress?: (loaded: number, total: number, lastLoaded?: LessonDetailResponse) => void,
  signal?: AbortSignal
): Promise<Record<string, LessonDetailResponse>> {
  const results: Record<string, LessonDetailResponse> = {};
  let loadedCount = 0;
  const total = lessonIds.length;

  const queue = [...lessonIds];
  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    while (queue.length > 0) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const lid = queue.shift();
      if (!lid) break;

      try {
        const detail = await getLessonDetail(lang, quarterId, lid, signal);
        results[lid] = detail;
        loadedCount++;
        onProgress?.(loadedCount, total, detail);
      } catch (err: any) {
        if (err.name === 'AbortError') throw err;
        results[lid] = {
          lesson: { id: lid, title: `Lección ${lid}` },
          error: err.message || 'Error cargando lección'
        };
        loadedCount++;
        onProgress?.(loadedCount, total, results[lid]);
      }
    }
  });

  await Promise.all(workers);
  return results;
}

export function clearApiCache(): void {
  memoryCache.clear();
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith('ss_api_')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => sessionStorage.removeItem(k));
  } catch {}
}
