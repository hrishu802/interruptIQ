import { randomUUID } from 'crypto';
import { cacheService } from './cache.service';

export interface DistributedLock {
  key: string;
  token: string;
  ttlMs: number;
}

export class LockService {
  /**
   * Acquires a distributed lock.
   * @param key The unique string identifying the lock.
   * @param ttlMs Time to live in milliseconds.
   * @returns A DistributedLock object if acquired, null if already held.
   * @throws Error if validation fails or Redis encounters a connection/command error.
   */
  async acquire(key: string, ttlMs: number): Promise<DistributedLock | null> {
    if (ttlMs <= 0 || !isFinite(ttlMs)) {
      throw new Error('TTL must be a finite positive number');
    }
    
    if (!key || key.trim() === '') {
      throw new Error('Lock key must be non-empty');
    }

    const client = cacheService.getRedisClient();
    if (!client) {
      throw new Error('Redis client unavailable, cannot acquire lock securely');
    }

    const token = randomUUID();

    // Use atomic SET with NX (only if not exists) and PX (expire time in ms)
    const result = await client.set(key, token, 'NX', 'PX', ttlMs);
    
    if (result === 'OK') {
      return { key, token, ttlMs };
    }
    
    // Redis confirmed the key already exists
    return null;
  }

  /**
   * Releases a distributed lock if and only if the current token matches.
   * @param lock The lock object to release.
   * @returns true if released, false if the lock was already released or held by a different process.
   * @throws Error if the lock object is invalid or Redis encounters an error.
   */
  async release(lock: DistributedLock): Promise<boolean> {
    if (!lock || !lock.key || !lock.token) {
      throw new Error('Invalid lock object');
    }

    const client = cacheService.getRedisClient();
    if (!client) {
      throw new Error('Redis client unavailable, cannot release lock securely');
    }

    // Atomic compare-and-delete Lua script
    const luaScript = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
      else
          return 0
      end
    `;

    // eval(script, numkeys, key, arg)
    const result = await client.eval(luaScript, 1, lock.key, lock.token);
    
    return result === 1;
  }
}

export const lockService = new LockService();
