import { useEffect, useSyncExternalStore } from 'react';
import { safeStorage } from './safeStorage';

export type PendingAnalysisStatus = 'processing' | 'preview-ready' | 'complete' | 'failed';

export interface PendingAnalysisSession {
  id: string;
  status: PendingAnalysisStatus;
  videoFileName: string;
  videoObjectPath: string;
  poseJobId: string;
  createdAt: number;
  previewUpdatedAt?: number;
  finalRideId?: string;
}

const STORAGE_KEY = 'horsera_pending_analysis_sessions';

let pendingCache: PendingAnalysisSession[] = loadPendingSessions();
const listeners = new Set<() => void>();

function emitChange(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function normalizePendingSession(session: Partial<PendingAnalysisSession> & { id: string }): PendingAnalysisSession {
  const poseJobId = String(session.poseJobId || session.id);
  return {
    id: String(session.id),
    status: session.status ?? 'processing',
    videoFileName: String(session.videoFileName ?? 'Ride video'),
    videoObjectPath: String(session.videoObjectPath ?? ''),
    poseJobId,
    createdAt: Number(session.createdAt || Date.now()),
    previewUpdatedAt: typeof session.previewUpdatedAt === 'number' ? session.previewUpdatedAt : undefined,
    finalRideId: session.finalRideId || undefined,
  };
}

function loadPendingSessions(): PendingAnalysisSession[] {
  try {
    const raw = safeStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as PendingAnalysisSession[] : [];
    return parsed.map((session) => normalizePendingSession(session)).sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

function persistPendingSessions(): void {
  safeStorage.setItem(STORAGE_KEY, JSON.stringify(pendingCache));
}

function replacePendingSessions(sessions: PendingAnalysisSession[]): void {
  pendingCache = sessions
    .map((session) => normalizePendingSession(session))
    .sort((a, b) => b.createdAt - a.createdAt);
  persistPendingSessions();
  emitChange();
}

export function getPendingAnalysisSessions(): PendingAnalysisSession[] {
  return pendingCache;
}

export function usePendingAnalysisSessions(): PendingAnalysisSession[] {
  useEffect(() => {
    pendingCache = loadPendingSessions();
  }, []);
  return useSyncExternalStore(subscribe, getPendingAnalysisSessions, getPendingAnalysisSessions);
}

export function upsertPendingAnalysisSession(session: PendingAnalysisSession): void {
  const normalized = normalizePendingSession(session);
  const existingIndex = pendingCache.findIndex((entry) => entry.id === normalized.id);
  if (existingIndex >= 0) {
    replacePendingSessions([
      ...pendingCache.slice(0, existingIndex),
      { ...pendingCache[existingIndex], ...normalized },
      ...pendingCache.slice(existingIndex + 1),
    ]);
  } else {
    replacePendingSessions([normalized, ...pendingCache]);
  }
}

export function updatePendingAnalysisSession(id: string, updates: Partial<PendingAnalysisSession>): void {
  const existing = pendingCache.find((session) => session.id === id);
  if (!existing) return;
  upsertPendingAnalysisSession(normalizePendingSession({ ...existing, ...updates, id }));
}

export function markPendingAnalysisComplete(id: string, finalRideId: string): void {
  updatePendingAnalysisSession(id, {
    status: 'complete',
    finalRideId,
  });
}

export function clearCompletedPendingAnalysisSessions(): void {
  replacePendingSessions(pendingCache.filter((session) => session.status !== 'complete'));
}

export function resetPendingAnalysisSessionsForTest(sessions: PendingAnalysisSession[] = []): void {
  replacePendingSessions(sessions);
}
