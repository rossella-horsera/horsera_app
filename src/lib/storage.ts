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
  name?: string;
  notes?: string;
}

const STORAGE_KEY = 'horsera_rides';
const SEED_VERSION_KEY = 'horsera_seed_version';

function sanitizeVideoUrl(videoUrl?: string): string | undefined {
  if (!videoUrl) return undefined;
  const trimmed = videoUrl.trim();
  if (!trimmed) return undefined;
  // blob:/data: URLs are session-local and break after reload/navigation.
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) return undefined;
  return trimmed;
}

function sanitizeRide(ride: StoredRide): StoredRide {
  const sanitizedVideoUrl = sanitizeVideoUrl(ride.videoUrl);
  if (sanitizedVideoUrl === ride.videoUrl) return ride;
  if (sanitizedVideoUrl) return { ...ride, videoUrl: sanitizedVideoUrl };
  const { videoUrl: _omit, ...rest } = ride;
  return rest;
}

// Auto-import seed rides from /seed-rides.json on first load.
// The batch upload script writes this file + commits to trigger a Vercel deploy.
// Each ride is upserted by date+horse+type so re-imports don't duplicate.
(async function importSeedRides() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}seed-rides.json?t=${Date.now()}`);
    if (!res.ok) return;
    const seed = await res.json() as { version: string; rides: StoredRide[] };
    const lastVersion = safeStorage.getItem(SEED_VERSION_KEY);
    if (seed.version === lastVersion) return; // already imported this version
    const existing = JSON.parse(safeStorage.getItem(STORAGE_KEY) || '[]') as StoredRide[];
    let added = 0;
    for (const ride of seed.rides) {
      const dup = existing.find(r => r.date === ride.date && r.horse === ride.horse && r.type === ride.type);
      if (dup) {
        Object.assign(dup, ride); // update
      } else {
        existing.unshift(ride);
        added++;
      }
    }
    safeStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    safeStorage.setItem(SEED_VERSION_KEY, seed.version);
    if (added > 0) console.info(`[Horsera] Imported ${added} seed rides (version ${seed.version})`);
  } catch { /* seed file not found or parse error — silent */ }
})();

export function saveRide(ride: StoredRide): void {
  const sanitizedRide = sanitizeRide(ride);
  const rides = getRides();
  const existingIdx = rides.findIndex(r => r.id === sanitizedRide.id);
  if (existingIdx >= 0) {
    rides[existingIdx] = sanitizedRide;  // upsert by id
  } else {
    rides.unshift(sanitizedRide);  // new ride, prepend
  }
  safeStorage.setItem(STORAGE_KEY, JSON.stringify(rides));
}

export function getRides(): StoredRide[] {
  try {
    const raw = safeStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as StoredRide[] : [];
    let mutated = false;
    const sanitized = parsed.map((ride) => {
      const clean = sanitizeRide(ride);
      if ((ride.videoUrl ?? '') !== (clean.videoUrl ?? '')) mutated = true;
      return clean;
    });
    if (mutated) {
      safeStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    }
    return sanitized;
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
