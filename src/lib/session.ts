import type { CloudUser } from './CloudClient';

const KEY = 'drivergo_user';

export function saveSession(user: CloudUser): void {
  localStorage.setItem(KEY, JSON.stringify(user));
}

export function loadSession(): CloudUser | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CloudUser) : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}
