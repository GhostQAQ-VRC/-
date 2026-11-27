const CREDENTIAL_KEY = 'hoshikuzu-admin-credential-v1';
const SESSION_KEY = 'hoshikuzu-admin-session-v1';
const SESSION_TTL = 8 * 60 * 60 * 1000;
const ITERATIONS = 160_000;
const MIN_LENGTH = 6;

interface StoredCredential {
  version: 1;
  salt: string;
  hash: string;
  createdAt: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function deriveHash(passphrase: string, salt: Uint8Array): Promise<string> {
  if (!window.crypto?.subtle) {
    throw new Error('当前浏览器不支持 Web Crypto，无法启用管理口令。');
  }
  const key = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await window.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    key,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

function readCredential(): StoredCredential | null {
  try {
    const raw = window.localStorage.getItem(CREDENTIAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredCredential>;
    if (
      parsed.version === 1 &&
      typeof parsed.salt === 'string' &&
      typeof parsed.hash === 'string'
    ) {
      return {
        version: 1,
        salt: parsed.salt,
        hash: parsed.hash,
        createdAt: parsed.createdAt ?? new Date().toISOString(),
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function hasAdminCredential(): boolean {
  return readCredential() !== null;
}

export function validatePassphrase(passphrase: string): string | null {
  if (passphrase.length < MIN_LENGTH) return `管理口令至少需要 ${MIN_LENGTH} 个字符。`;
  if (passphrase.length > 128) return '管理口令不能超过 128 个字符。';
  return null;
}

export async function createAdminCredential(passphrase: string): Promise<void> {
  const validation = validatePassphrase(passphrase);
  if (validation) throw new Error(validation);
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveHash(passphrase, salt);
  const payload: StoredCredential = {
    version: 1,
    salt: bytesToBase64(salt),
    hash,
    createdAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(CREDENTIAL_KEY, JSON.stringify(payload));
  } catch {
    throw new Error('无法写入本地存储，管理口令没有保存。');
  }
  unlockAdminSession();
}

/**
 * Constant-time equality so the passphrase check never leaks how many leading
 * bytes of the stored hash matched.
 */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) {
    // Compare against self to keep the loop count independent of the mismatch.
    let mismatch = left.length ^ right.length;
    for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ left[index];
    return mismatch === 0;
  }
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

export async function verifyAdminPassphrase(passphrase: string): Promise<boolean> {
  const credential = readCredential();
  if (!credential) return false;
  const hash = await deriveHash(passphrase, base64ToBytes(credential.salt));
  return timingSafeEqualStrings(hash, credential.hash);
}

export async function changeAdminCredential(
  currentPassphrase: string,
  nextPassphrase: string,
): Promise<void> {
  const valid = await verifyAdminPassphrase(currentPassphrase);
  if (!valid) throw new Error('当前管理口令不正确。');
  const validation = validatePassphrase(nextPassphrase);
  if (validation) throw new Error(validation);
  await createAdminCredential(nextPassphrase);
}

export function resetAdminCredential(): void {
  try {
    window.localStorage.removeItem(CREDENTIAL_KEY);
  } catch {
    // Ignore storage failures; the in-memory state resets anyway.
  }
  lockAdminSession();
}

export function isAdminUnlocked(): boolean {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { at?: number };
    if (typeof parsed.at !== 'number') return false;
    if (Date.now() - parsed.at > SESSION_TTL) {
      window.sessionStorage.removeItem(SESSION_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function unlockAdminSession(): void {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ at: Date.now() }));
  } catch {
    // Session storage can be unavailable in privacy modes; unlock stays in memory.
  }
}

export function lockAdminSession(): void {
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore.
  }
}

export { MIN_LENGTH as ADMIN_MIN_PASSPHRASE };
