import { useEffect, useSyncExternalStore } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  writeBatch,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { firebaseDb, ensureFirebaseUser, isFirebaseConfigured } from '@/integrations/firebase/client';
import { createVideoReadUrl } from './poseApi';
import { safeStorage } from './safeStorage';

export interface StoredKeyframe {
  time: number;
  frame: Array<{ x: number; y: number; score: number }>;
}

export interface StoredRide {
  id: string;
  date: string;
  horse: string;
  type: 'training' | 'lesson' | 'hack' | 'mock-test';
  duration: number;
  videoFileName: string;
  videoUrl?: string;
  videoUrlExpiresAt?: number;
  videoObjectPath?: string;
  poseJobId?: string;
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
  keyframes?: StoredKeyframe[];
  name?: string;
  notes?: string;
  schemaVersion: number;
}

interface StoredRideDoc {
  schemaVersion: number;
  date: string;
  horse: string;
  type: StoredRide['type'];
  duration: number;
  videoFileName: string;
  videoObjectPath?: string;
  poseJobId?: string;
  biometrics: StoredRide['biometrics'];
  ridingQuality?: StoredRide['ridingQuality'];
  overallScore: number;
  insights: string[];
  name?: string;
  notes?: string;
  legacyVideoUrl?: string;
  keyframeChunkCount: number;
  updatedAt: number;
  createdAt: number;
}

interface KeyframeChunkDoc {
  index: number;
  frames: StoredKeyframe[];
}

const STORAGE_KEY = 'horsera_rides';
const FIRESTORE_CUTOVER_KEY = 'horsera_firestore_cutover_v1';
const SCHEMA_VERSION = 2;
const KEYFRAME_CHUNK_SIZE = 100;
const READ_URL_REFRESH_BUFFER_MS = 60_000;

let ridesCache: StoredRide[] = loadCachedRides();
let storeReady = !isFirebaseConfigured;
let initializePromise: Promise<void> | null = null;
let firestoreUnsubscribe: (() => void) | null = null;
let boundUid: string | null = null;
const listeners = new Set<() => void>();

function emitChange(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function persistCache(rides: StoredRide[]): void {
  const cached = rides.map((ride) => ({
    ...ride,
    keyframes: undefined,
  }));
  safeStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
}

function loadCachedRides(): StoredRide[] {
  try {
    const raw = safeStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as StoredRide[] : [];
    return parsed.map((ride) => normalizeRide(ride));
  } catch {
    return [];
  }
}

function sanitizeVideoUrl(videoUrl?: string): string | undefined {
  if (!videoUrl) return undefined;
  const trimmed = videoUrl.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) return undefined;
  return trimmed;
}

function normalizeRide(ride: Partial<StoredRide> & { id: string }): StoredRide {
  const sanitizedVideoUrl = sanitizeVideoUrl(ride.videoUrl);
  return {
    id: ride.id,
    date: String(ride.date ?? ''),
    horse: String(ride.horse ?? ''),
    type: (ride.type ?? 'training') as StoredRide['type'],
    duration: Number(ride.duration ?? 0),
    videoFileName: String(ride.videoFileName ?? ''),
    videoUrl: sanitizedVideoUrl,
    videoUrlExpiresAt: typeof ride.videoUrlExpiresAt === 'number' ? ride.videoUrlExpiresAt : undefined,
    videoObjectPath: ride.videoObjectPath || undefined,
    poseJobId: ride.poseJobId || undefined,
    biometrics: {
      lowerLegStability: Number(ride.biometrics?.lowerLegStability ?? 0),
      reinSteadiness: Number(ride.biometrics?.reinSteadiness ?? 0),
      reinSymmetry: Number(ride.biometrics?.reinSymmetry ?? 0),
      coreStability: Number(ride.biometrics?.coreStability ?? 0),
      upperBodyAlignment: Number(ride.biometrics?.upperBodyAlignment ?? 0),
      pelvisStability: Number(ride.biometrics?.pelvisStability ?? 0),
    },
    ridingQuality: ride.ridingQuality ? {
      rhythm: Number(ride.ridingQuality.rhythm ?? 0),
      relaxation: Number(ride.ridingQuality.relaxation ?? 0),
      contact: Number(ride.ridingQuality.contact ?? 0),
      impulsion: Number(ride.ridingQuality.impulsion ?? 0),
      straightness: Number(ride.ridingQuality.straightness ?? 0),
      balance: Number(ride.ridingQuality.balance ?? 0),
    } : undefined,
    overallScore: Number(ride.overallScore ?? 0),
    insights: Array.isArray(ride.insights) ? ride.insights.map(String) : [],
    keyframes: Array.isArray(ride.keyframes) ? ride.keyframes : undefined,
    name: ride.name?.trim() || undefined,
    notes: ride.notes?.trim() || undefined,
    schemaVersion: Number(ride.schemaVersion ?? SCHEMA_VERSION),
  };
}

function upsertRideInCache(ride: StoredRide): void {
  const normalized = normalizeRide(ride);
  const existingIndex = ridesCache.findIndex((entry) => entry.id === normalized.id);
  if (existingIndex >= 0) {
    ridesCache = [
      ...ridesCache.slice(0, existingIndex),
      { ...ridesCache[existingIndex], ...normalized },
      ...ridesCache.slice(existingIndex + 1),
    ];
  } else {
    ridesCache = [normalized, ...ridesCache];
  }
  ridesCache = [...ridesCache].sort((a, b) => b.date.localeCompare(a.date));
  persistCache(ridesCache);
  emitChange();
}

function replaceCache(rides: StoredRide[]): void {
  ridesCache = rides.sort((a, b) => b.date.localeCompare(a.date));
  persistCache(ridesCache);
  emitChange();
}

function buildRideDoc(ride: StoredRide, existing?: StoredRide): StoredRideDoc {
  return {
    schemaVersion: SCHEMA_VERSION,
    date: ride.date,
    horse: ride.horse,
    type: ride.type,
    duration: ride.duration,
    videoFileName: ride.videoFileName,
    videoObjectPath: ride.videoObjectPath,
    poseJobId: ride.poseJobId,
    biometrics: ride.biometrics,
    ridingQuality: ride.ridingQuality,
    overallScore: ride.overallScore,
    insights: ride.insights,
    name: ride.name,
    notes: ride.notes,
    legacyVideoUrl: !ride.videoObjectPath ? sanitizeVideoUrl(ride.videoUrl) : undefined,
    keyframeChunkCount: splitKeyframesIntoChunks(ride.keyframes ?? []).length,
    updatedAt: Date.now(),
    createdAt: existing?.schemaVersion ? Date.now() : Date.now(),
  };
}

function mapRideDoc(snapshot: QueryDocumentSnapshot, current?: StoredRide): StoredRide {
  const data = snapshot.data() as StoredRideDoc;
  return normalizeRide({
    id: snapshot.id,
    date: data.date,
    horse: data.horse,
    type: data.type,
    duration: data.duration,
    videoFileName: data.videoFileName,
    videoObjectPath: data.videoObjectPath,
    poseJobId: data.poseJobId,
    videoUrl: current?.videoUrl ?? data.legacyVideoUrl,
    videoUrlExpiresAt: current?.videoUrlExpiresAt,
    biometrics: data.biometrics,
    ridingQuality: data.ridingQuality,
    overallScore: data.overallScore,
    insights: data.insights,
    keyframes: current?.keyframes,
    name: data.name,
    notes: data.notes,
    schemaVersion: data.schemaVersion ?? SCHEMA_VERSION,
  });
}

function userRidesCollection(uid: string) {
  if (!firebaseDb) throw new Error('Firebase is not configured');
  return collection(firebaseDb, 'users', uid, 'rides');
}

function rideDocRef(uid: string, rideId: string) {
  if (!firebaseDb) throw new Error('Firebase is not configured');
  return doc(firebaseDb, 'users', uid, 'rides', rideId);
}

function keyframeChunksCollection(uid: string, rideId: string) {
  if (!firebaseDb) throw new Error('Firebase is not configured');
  return collection(firebaseDb, 'users', uid, 'rides', rideId, 'keyframeChunks');
}

async function persistRideRemote(uid: string, ride: StoredRide): Promise<void> {
  if (!firebaseDb) return;
  const existing = ridesCache.find((entry) => entry.id === ride.id);
  const normalized = normalizeRide(ride);
  const rideRef = rideDocRef(uid, normalized.id);
  const batch = writeBatch(firebaseDb);
  batch.set(rideRef, buildRideDoc(normalized, existing), { merge: true });

  const existingChunks = await getDocs(keyframeChunksCollection(uid, normalized.id));
  existingChunks.docs.forEach((chunkDoc) => batch.delete(chunkDoc.ref));

  splitKeyframesIntoChunks(normalized.keyframes ?? []).forEach((chunk, index) => {
    const chunkRef = doc(firebaseDb!, 'users', uid, 'rides', normalized.id, 'keyframeChunks', `chunk-${String(index).padStart(4, '0')}`);
    batch.set(chunkRef, { index, frames: chunk });
  });

  await batch.commit();
}

async function deleteRideRemote(uid: string, rideId: string): Promise<void> {
  if (!firebaseDb) return;
  const chunks = await getDocs(keyframeChunksCollection(uid, rideId));
  const batch = writeBatch(firebaseDb);
  chunks.docs.forEach((chunkDoc) => batch.delete(chunkDoc.ref));
  batch.delete(rideDocRef(uid, rideId));
  await batch.commit();
}

async function bindFirestoreSnapshot(uid: string): Promise<void> {
  if (!firebaseDb) {
    storeReady = true;
    emitChange();
    return;
  }
  if (firestoreUnsubscribe && boundUid === uid) return;

  firestoreUnsubscribe?.();
  boundUid = uid;

  const ridesQuery = query(userRidesCollection(uid), orderBy('date', 'desc'));
  firestoreUnsubscribe = onSnapshot(ridesQuery, (snapshot) => {
    const currentById = new Map(ridesCache.map((ride) => [ride.id, ride]));
    const next = snapshot.docs.map((docSnap) => mapRideDoc(docSnap, currentById.get(docSnap.id)));
    replaceCache(next);
    storeReady = true;
  }, (error) => {
    console.warn('[Horsera] Firestore ride sync failed; using local cache.', error);
    storeReady = true;
    emitChange();
  });
}

async function maybeBackfillLocalRides(uid: string): Promise<void> {
  if (!firebaseDb) return;
  if (safeStorage.getItem(FIRESTORE_CUTOVER_KEY) === '1') return;

  let legacyRides: StoredRide[] = [];
  try {
    const raw = safeStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as StoredRide[] : [];
    legacyRides = parsed.map((ride) => normalizeRide(ride));
  } catch {
    legacyRides = [];
  }

  if (legacyRides.length === 0) {
    safeStorage.setItem(FIRESTORE_CUTOVER_KEY, '1');
    return;
  }

  for (const ride of legacyRides) {
    await persistRideRemote(uid, ride);
  }

  safeStorage.setItem(FIRESTORE_CUTOVER_KEY, '1');
}

export async function initializeRideStore(): Promise<void> {
  if (initializePromise) return initializePromise;

  initializePromise = (async () => {
    if (!isFirebaseConfigured) {
      storeReady = true;
      emitChange();
      return;
    }

    const user = await ensureFirebaseUser();
    if (!user) {
      storeReady = true;
      emitChange();
      return;
    }

    await maybeBackfillLocalRides(user.uid);
    await bindFirestoreSnapshot(user.uid);
  })();

  return initializePromise;
}

export function getRides(): StoredRide[] {
  return ridesCache;
}

export function getRideStoreReady(): boolean {
  return storeReady;
}

export function useStoredRides(): StoredRide[] {
  useEffect(() => {
    void initializeRideStore();
  }, []);
  return useSyncExternalStore(subscribe, getRides, getRides);
}

export function useRideStoreReady(): boolean {
  useEffect(() => {
    void initializeRideStore();
  }, []);
  return useSyncExternalStore(subscribe, getRideStoreReady, getRideStoreReady);
}

export async function saveRide(ride: StoredRide): Promise<void> {
  const normalized = normalizeRide({ ...ride, schemaVersion: ride.schemaVersion ?? SCHEMA_VERSION });
  upsertRideInCache(normalized);

  const user = await ensureFirebaseUser();
  if (!user) return;

  try {
    await persistRideRemote(user.uid, normalized);
  } catch (error) {
    console.warn('[Horsera] Failed to persist ride to Firestore; local cache was kept.', error);
  }
}

export async function deleteRide(id: string): Promise<void> {
  ridesCache = ridesCache.filter((ride) => ride.id !== id);
  persistCache(ridesCache);
  emitChange();

  const user = await ensureFirebaseUser();
  if (!user) return;

  try {
    await deleteRideRemote(user.uid, id);
  } catch (error) {
    console.warn('[Horsera] Failed to delete ride from Firestore.', error);
  }
}

export async function updateRide(id: string, updates: Partial<StoredRide>): Promise<void> {
  const existing = ridesCache.find((ride) => ride.id === id);
  if (!existing) return;
  const next = normalizeRide({ ...existing, ...updates, id });
  await saveRide(next);
}

export async function hydrateRide(rideId: string): Promise<StoredRide | undefined> {
  const cached = ridesCache.find((ride) => ride.id === rideId);
  if (!cached) return undefined;
  if (cached.keyframes && cached.keyframes.length > 0) return cached;

  const user = await ensureFirebaseUser();
  if (!user || !firebaseDb) return cached;

  try {
    const snapshot = await getDocs(query(keyframeChunksCollection(user.uid, rideId), orderBy('index', 'asc')));
    const keyframes = mergeKeyframeChunks(snapshot.docs.map((chunkDoc) => {
      const data = chunkDoc.data() as KeyframeChunkDoc;
      return data.frames ?? [];
    }));
    const next = normalizeRide({ ...cached, keyframes });
    upsertRideInCache(next);
    return next;
  } catch (error) {
    console.warn('[Horsera] Failed to load ride keyframes from Firestore.', error);
    return cached;
  }
}

export async function resolveRidePlaybackUrl(ride: StoredRide): Promise<string | undefined> {
  const current = ridesCache.find((entry) => entry.id === ride.id) ?? ride;
  const cachedUrl = sanitizeVideoUrl(current.videoUrl);
  if (cachedUrl && (!current.videoUrlExpiresAt || current.videoUrlExpiresAt > Date.now() + READ_URL_REFRESH_BUFFER_MS)) {
    return cachedUrl;
  }

  if (!current.videoObjectPath) {
    return cachedUrl;
  }

  try {
    const { readUrl, expiresAt } = await createVideoReadUrl(current.videoObjectPath);
    upsertRideInCache({ ...current, videoUrl: readUrl, videoUrlExpiresAt: expiresAt });
    return readUrl;
  } catch (error) {
    console.warn('[Horsera] Failed to resolve ride playback URL.', error);
    return cachedUrl;
  }
}

export function splitKeyframesIntoChunks(keyframes: StoredKeyframe[]): StoredKeyframe[][] {
  const chunks: StoredKeyframe[][] = [];
  for (let index = 0; index < keyframes.length; index += KEYFRAME_CHUNK_SIZE) {
    chunks.push(keyframes.slice(index, index + KEYFRAME_CHUNK_SIZE));
  }
  return chunks;
}

export function mergeKeyframeChunks(chunks: StoredKeyframe[][]): StoredKeyframe[] {
  return chunks.flat();
}
