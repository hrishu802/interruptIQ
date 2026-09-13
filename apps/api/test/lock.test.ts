import { describe, test, expect, vi, beforeEach } from 'vitest';
import { lockService } from '../src/services/lock.service';
import { cacheService } from '../src/services/cache.service';

describe('Distributed Lock Service', () => {
  let mockRedisClient: any;

  beforeEach(() => {
    mockRedisClient = {
      set: vi.fn(),
      eval: vi.fn(),
    };

    // Override the getRedisClient method to return our mock
    vi.spyOn(cacheService, 'getRedisClient').mockReturnValue(mockRedisClient);
  });

  test('successful acquisition', async () => {
    mockRedisClient.set.mockResolvedValue('OK');

    const lock = await lockService.acquire('test-lock', 10000);
    
    expect(lock).not.toBeNull();
    expect(lock?.key).toBe('test-lock');
    expect(lock?.token).toBeDefined();
    expect(lock?.ttlMs).toBe(10000);
    
    expect(mockRedisClient.set).toHaveBeenCalledWith(
      'test-lock',
      expect.any(String),
      'NX',
      'PX',
      10000
    );
  });

  test('duplicate acquisition failure', async () => {
    // Redis returns null when NX condition fails
    mockRedisClient.set.mockResolvedValue(null);

    const lock = await lockService.acquire('test-lock-2', 5000);
    
    expect(lock).toBeNull();
  });

  test('independent lock keys', async () => {
    mockRedisClient.set.mockResolvedValue('OK');

    const lock1 = await lockService.acquire('key-1', 1000);
    const lock2 = await lockService.acquire('key-2', 1000);

    expect(lock1?.token).not.toBe(lock2?.token);
    expect(mockRedisClient.set).toHaveBeenCalledTimes(2);
  });

  test('successful release', async () => {
    mockRedisClient.eval.mockResolvedValue(1); // 1 means key was deleted

    const lock = { key: 'release-key', token: 'token-123', ttlMs: 1000 };
    const result = await lockService.release(lock);

    expect(result).toBe(true);
    expect(mockRedisClient.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'release-key',
      'token-123'
    );
  });

  test('wrong ownership token cannot release', async () => {
    mockRedisClient.eval.mockResolvedValue(0); // 0 means token didn't match, key not deleted

    const lock = { key: 'release-key', token: 'wrong-token', ttlMs: 1000 };
    const result = await lockService.release(lock);

    expect(result).toBe(false);
  });

  test('Redis acquisition failure', async () => {
    mockRedisClient.set.mockRejectedValue(new Error('Connection lost'));

    await expect(lockService.acquire('error-key', 1000)).rejects.toThrow('Connection lost');
  });

  test('Redis release failure', async () => {
    mockRedisClient.eval.mockRejectedValue(new Error('Connection lost'));

    const lock = { key: 'error-key', token: 'token-123', ttlMs: 1000 };
    await expect(lockService.release(lock)).rejects.toThrow('Connection lost');
  });

  test('invalid key', async () => {
    await expect(lockService.acquire('', 1000)).rejects.toThrow('Lock key must be non-empty');
    await expect(lockService.acquire('   ', 1000)).rejects.toThrow('Lock key must be non-empty');
  });

  test('invalid TTL', async () => {
    await expect(lockService.acquire('key', 0)).rejects.toThrow('TTL must be a finite positive number');
    await expect(lockService.acquire('key', -500)).rejects.toThrow('TTL must be a finite positive number');
    await expect(lockService.acquire('key', Infinity)).rejects.toThrow('TTL must be a finite positive number');
  });

  test('fails if Redis client is not available', async () => {
    vi.spyOn(cacheService, 'getRedisClient').mockReturnValue(null);

    await expect(lockService.acquire('key', 1000)).rejects.toThrow('Redis client unavailable');
    
    const lock = { key: 'key', token: 'token', ttlMs: 1000 };
    await expect(lockService.release(lock)).rejects.toThrow('Redis client unavailable');
  });
});
