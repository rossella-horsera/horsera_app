// Persistence for rides and analysis results
// Uses safeStorage (localStorage with in-memory fallback)

import { safeStorage } from './safeStorage';

export interface StoredRide {
  id: string;
  date: string;
  horse: string;
  type: 'training' | 'lesson' | 'hack' | 'mock-test';
  duration: number;
  videoFileName: string;
  videoUrl?: string;       // Supabase Storage public URL (set when uploaded)
  biometrics: {
    lowerLegStability: number;
    reinSteadiness: number;
    reinSymmetry: number;
    coreStability: number;
    upperBodyAlignment: number;
    pelvisStability: number;
  };
  ridingQuality?: {
    rhythm: number;
    relaxation: number;
    contact: number;
    impulsion: number;
    straightness: number;
    balance: number;
  };
  overallScore: number;
  insights: string[];
  keyframes?: Array<{ time: number; frame: Array<{ x: number; y: number; score: number }> }>;
}

const STORAGE_KEY = 'horsera_rides';

export function saveRide(ride: StoredRide): void {
  const rides = getRides();
  const existingIdx = rides.findIndex(r => r.id === ride.id);
  if (existingIdx >= 0) {
    rides[existingIdx] = ride;  // upsert by id
  } else {
    rides.unshift(ride);  // new ride, prepend
  }
  safeStorage.setItem(STORAGE_KEY, JSON.stringify(rides));
}

export function getRides(): StoredRide[] {
  try {
    const raw = safeStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function deleteRide(id: string): void {
  const rides = getRides().filter(r => r.id !== id);
  safeStorage.setItem(STORAGE_KEY, JSON.stringify(rides));
}

export function updateRide(id: string, updates: Partial<StoredRide>): void {
  const rides = getRides().map(r =>
    r.id === id ? { ...r, ...updates } : r
  );
  safeStorage.setItem(STORAGE_KEY, JSON.stringify(rides));
}
