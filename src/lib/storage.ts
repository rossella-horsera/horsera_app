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
  rides.unshift(ride);
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
