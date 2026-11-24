import { useCallback, useState } from 'react';
import {
  changeAdminCredential,
  createAdminCredential,
  hasAdminCredential,
  isAdminUnlocked,
  lockAdminSession,
  resetAdminCredential,
  unlockAdminSession,
  verifyAdminPassphrase,
} from '../utils/adminAuth';

export interface AdminAuthApi {
  hasCredential: boolean;
  unlocked: boolean;
  setup: (passphrase: string) => Promise<void>;
  login: (passphrase: string) => Promise<void>;
  lock: () => void;
  resetCredential: () => void;
  changePassphrase: (currentPassphrase: string, nextPassphrase: string) => Promise<void>;
}

export function useAdminAuth(): AdminAuthApi {
  const [hasCredential, setHasCredential] = useState(hasAdminCredential);
  const [unlocked, setUnlocked] = useState(isAdminUnlocked);

  const setup = useCallback(async (passphrase: string) => {
    await createAdminCredential(passphrase);
    setHasCredential(true);
    setUnlocked(true);
  }, []);

  const login = useCallback(async (passphrase: string) => {
    const valid = await verifyAdminPassphrase(passphrase);
    if (!valid) throw new Error('管理口令不正确。');
    unlockAdminSession();
    setUnlocked(true);
  }, []);

  const lock = useCallback(() => {
    lockAdminSession();
    setUnlocked(false);
  }, []);

  const resetCredential = useCallback(() => {
    resetAdminCredential();
    setHasCredential(false);
    setUnlocked(false);
  }, []);

  const changePassphrase = useCallback(async (currentPassphrase: string, nextPassphrase: string) => {
    await changeAdminCredential(currentPassphrase, nextPassphrase);
    setUnlocked(true);
  }, []);

  return { hasCredential, unlocked, setup, login, lock, resetCredential, changePassphrase };
}
