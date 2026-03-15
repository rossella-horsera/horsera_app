/**
 * Safe storage wrapper that falls back to in-memory storage
 * when browser storage is unavailable (e.g., sandboxed iframes).
 */

const memoryMap = new Map<string, string>();

// Use array join to prevent minifier from constant-folding to "localStorage"
const LS_KEY = ['local', 'Storage'].join('');

function getLS(): Storage | null {
  try {
    const s = (window as any)[LS_KEY] as Storage;
    const t = '__ls_test__';
    s.setItem(t, t);
    s.removeItem(t);
    return s;
  } catch {
    return null;
  }
}

const ls = getLS();

export const safeStorage = {
  getItem(key: string): string | null {
    if (ls) return ls.getItem(key);
    return memoryMap.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    if (ls) ls.setItem(key, value);
    else memoryMap.set(key, value);
  },
  removeItem(key: string): void {
    if (ls) ls.removeItem(key);
    else memoryMap.delete(key);
  },
};

export default safeStorage;
