import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously, type Auth, type User } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.authDomain &&
  firebaseConfig.projectId &&
  firebaseConfig.appId,
);

export const firebaseApp: FirebaseApp | null = isFirebaseConfigured
  ? (getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null;

export const firebaseAuth: Auth | null = firebaseApp ? getAuth(firebaseApp) : null;
export const firebaseDb: Firestore | null = firebaseApp ? getFirestore(firebaseApp) : null;

let initialAuthStatePromise: Promise<void> | null = null;
let ensureUserPromise: Promise<User | null> | null = null;

async function waitForInitialAuthState(): Promise<void> {
  if (!firebaseAuth) return;
  if (firebaseAuth.currentUser) return;
  if (!initialAuthStatePromise) {
    initialAuthStatePromise = new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(firebaseAuth, () => {
        unsubscribe();
        resolve();
      });
    });
  }
  await initialAuthStatePromise;
}

export async function ensureFirebaseUser(): Promise<User | null> {
  if (!firebaseAuth) {
    if (typeof window !== 'undefined') {
      console.warn('[Horsera] Firebase env vars are missing; ride sync will stay local-only.');
    }
    return null;
  }

  if (firebaseAuth.currentUser) return firebaseAuth.currentUser;

  if (!ensureUserPromise) {
    ensureUserPromise = (async () => {
      await waitForInitialAuthState();
      if (firebaseAuth.currentUser) return firebaseAuth.currentUser;
      try {
        const cred = await signInAnonymously(firebaseAuth);
        return cred.user;
      } catch (error) {
        console.warn('[Horsera] Anonymous Firebase auth failed; ride sync will stay local-only.', error);
        return null;
      }
    })();
  }

  return ensureUserPromise;
}
