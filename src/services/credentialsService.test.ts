import { describe, it, expect, vi, beforeEach } from 'vitest';

// Cut the platform-bridge import chain.
vi.mock('../utils/logger', () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const secureMock = vi.hoisted(() => ({
  isSecureStorageAvailable: vi.fn(async () => false),
  saveCredentials: vi.fn(async () => true),
  getDecryptedPassword: vi.fn(async () => null as string | null),
  deleteCredentials: vi.fn(async () => true),
}));
vi.mock('./secureCredentialService', () => secureMock);

async function freshModule() {
  vi.resetModules();
  return import('./credentialsService');
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  secureMock.isSecureStorageAvailable.mockResolvedValue(false);
  secureMock.getDecryptedPassword.mockResolvedValue(null);
});

describe('credentialsService', () => {
  it('getCached() hydrates synchronously from localStorage at import', async () => {
    localStorage.setItem('serverUrl', 'https://s');
    localStorage.setItem('username', 'u');
    localStorage.setItem('password', 'p');
    const { credentialsService } = await freshModule();
    expect(credentialsService.getCached()).toEqual({
      serverUrl: 'https://s',
      username: 'u',
      password: 'p',
    });
  });

  it('getCached() returns empty strings when nothing is stored', async () => {
    const { credentialsService } = await freshModule();
    expect(credentialsService.getCached()).toEqual({ serverUrl: '', username: '', password: '' });
  });

  it('set() writes localStorage and updates the sync cache', async () => {
    const { credentialsService } = await freshModule();
    await credentialsService.set({ serverUrl: 'https://x', username: 'bob', password: 'pw' });
    expect(localStorage.getItem('serverUrl')).toBe('https://x');
    expect(localStorage.getItem('username')).toBe('bob');
    expect(credentialsService.getCached().password).toBe('pw');
  });

  it('set() persists to the encrypted backend when available', async () => {
    secureMock.isSecureStorageAvailable.mockResolvedValue(true);
    const { credentialsService } = await freshModule();
    await credentialsService.set({ serverUrl: 's', username: 'u', password: 'secret' });
    expect(secureMock.saveCredentials).toHaveBeenCalledWith('s', 'u', 'secret');
  });

  it('clear() wipes the password but keeps username (themes still load)', async () => {
    localStorage.setItem('serverUrl', 's');
    localStorage.setItem('username', 'u');
    localStorage.setItem('password', 'p');
    const { credentialsService } = await freshModule();
    await credentialsService.clear();
    expect(localStorage.getItem('password')).toBeNull();
    expect(localStorage.getItem('username')).toBe('u');
    expect(credentialsService.getCached().password).toBe('');
  });

  it('clear() deletes from the encrypted backend when available', async () => {
    localStorage.setItem('serverUrl', 's');
    localStorage.setItem('username', 'u');
    localStorage.setItem('password', 'p');
    secureMock.isSecureStorageAvailable.mockResolvedValue(true);
    const { credentialsService } = await freshModule();
    await credentialsService.clear();
    expect(secureMock.deleteCredentials).toHaveBeenCalledWith('s', 'u');
  });

  it('get() prefers the decrypted password from the secure backend', async () => {
    localStorage.setItem('serverUrl', 's');
    localStorage.setItem('username', 'u');
    localStorage.setItem('password', 'stale-plaintext');
    secureMock.isSecureStorageAvailable.mockResolvedValue(true);
    secureMock.getDecryptedPassword.mockResolvedValue('fresh-secret');
    const { credentialsService } = await freshModule();
    const creds = await credentialsService.get();
    expect(creds.password).toBe('fresh-secret');
    expect(credentialsService.getCached().password).toBe('fresh-secret');
  });

  it('get() falls back to the localStorage password when the backend has none', async () => {
    localStorage.setItem('serverUrl', 's');
    localStorage.setItem('username', 'u');
    localStorage.setItem('password', 'plain');
    secureMock.isSecureStorageAvailable.mockResolvedValue(true);
    secureMock.getDecryptedPassword.mockResolvedValue(null);
    const { credentialsService } = await freshModule();
    expect((await credentialsService.get()).password).toBe('plain');
  });
});
