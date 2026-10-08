import Redis from 'ioredis';

/**
 * Resilient Redis Store with automatic in-memory fallback.
 * Allows multiple concurrent technicians/sessions and approval management across processes.
 * If Redis is absent or unreachable, seamlessly falls back to local in-memory storage without errors.
 */
class RedisStore {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.memoryApprovals = new Map();
    this.memorySessions = new Map();

    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    const enableRedis = process.env.ENABLE_REDIS !== 'false';

    if (enableRedis) {
      try {
        this.client = new Redis(redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          retryStrategy: (times) => {
            if (times > 3) {
              return null; // Stop reconnecting after 3 attempts
            }
            return Math.min(times * 1000, 3000);
          },
          reconnectOnError: () => false
        });

        this.client.on('connect', () => {
          this.isConnected = true;
          console.log('✅ Connected to Redis store for sessions & approvals.');
        });

        this.client.on('error', (err) => {
          if (this.isConnected) {
            console.warn('⚠️ Redis connection lost, falling back to in-memory store:', err.message);
          }
          this.isConnected = false;
        });

        // Attempt initial non-blocking connection
        this.client.connect().catch((err) => {
          console.log('ℹ️ Redis not detected at ' + redisUrl + ' — using in-memory cache fallback.');
          this.isConnected = false;
        });
      } catch (e) {
        this.isConnected = false;
      }
    }
  }

  // --- APPROVALS (HITL) ---
  async getApproval(actionId) {
    if (this.isConnected && this.client) {
      try {
        const val = await this.client.get(`maximo:approval:${actionId}`);
        return val ? JSON.parse(val) : null;
      } catch (err) {
        console.warn('Redis getApproval error, reading memory:', err.message);
      }
    }
    return this.memoryApprovals.get(actionId) || null;
  }

  async setApproval(actionId, data, ttlSeconds = 900) {
    this.memoryApprovals.set(actionId, data);
    if (this.isConnected && this.client) {
      try {
        await this.client.set(`maximo:approval:${actionId}`, JSON.stringify(data), 'EX', ttlSeconds);
      } catch (err) {
        console.warn('Redis setApproval error:', err.message);
      }
    }
  }

  async deleteApproval(actionId) {
    this.memoryApprovals.delete(actionId);
    if (this.isConnected && this.client) {
      try {
        await this.client.del(`maximo:approval:${actionId}`);
      } catch (err) {
        console.warn('Redis deleteApproval error:', err.message);
      }
    }
  }

  // --- SESSION WORKING CONTEXT ---
  async getSessionContext(sessionId) {
    if (this.isConnected && this.client) {
      try {
        const val = await this.client.get(`maximo:session:${sessionId}`);
        if (val) return JSON.parse(val);
      } catch (err) {
        console.warn('Redis getSessionContext error:', err.message);
      }
    }
    return this.memorySessions.get(sessionId) || null;
  }

  async setSessionContext(sessionId, contextData, ttlSeconds = 86400) {
    this.memorySessions.set(sessionId, contextData);
    if (this.isConnected && this.client) {
      try {
        await this.client.set(`maximo:session:${sessionId}`, JSON.stringify(contextData), 'EX', ttlSeconds);
      } catch (err) {
        console.warn('Redis setSessionContext error:', err.message);
      }
    }
  }
}

export const redisStore = new RedisStore();
