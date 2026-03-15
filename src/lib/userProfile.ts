import { safeStorage } from './safeStorage';

export interface UserProfile {
  firstName: string;
  horseName: string;
  discipline: 'usdf' | 'pony-club' | 'hunter-jumper' | 'a-bit-of-everything';
  level: string;
  isOnboarded: boolean;
}

const PROFILE_KEY = 'horsera_user_profile';
const DEFAULT_PROFILE: UserProfile = {
  firstName: '',
  horseName: '',
  discipline: 'usdf',
  level: 'training',
  isOnboarded: false,
};

export function getUserProfile(): UserProfile {
  const raw = safeStorage.getItem(PROFILE_KEY);
  if (raw) {
    try { return { ...DEFAULT_PROFILE, ...JSON.parse(raw) }; }
    catch { return DEFAULT_PROFILE; }
  }
  return DEFAULT_PROFILE;
}

export function saveUserProfile(profile: Partial<UserProfile>): UserProfile {
  const current = getUserProfile();
  const updated = { ...current, ...profile };
  safeStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
  return updated;
}

export function isProfileComplete(): boolean {
  const p = getUserProfile();
  return p.isOnboarded && p.firstName.length > 0;
}

/** Returns the horse name from the user's profile, with a fallback. */
export function getHorseName(fallback = 'your horse'): string {
  const p = getUserProfile();
  return p.horseName?.trim() || fallback;
}
