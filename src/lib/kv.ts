/**
 * Durable key-value store for domain data.
 * Redis when REDIS_URL is set (production); in-memory otherwise (dev / tests).
 * Never SCAN/KEYS the keyspace — callers keep explicit index records.
 */

import { resetIds } from "./ids.js";

export interface Kv {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
}

class MemoryKv implements Kv {
  private readonly map = new Map<string, string>();

  async get<T>(key: string): Promise<T | undefined> {
    const raw = this.map.get(key);
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.map.set(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

class RedisKv implements Kv {
  constructor(
    private readonly client: {
      get(key: string): Promise<string | null>;
      set(key: string, value: string): Promise<unknown>;
      del(key: string): Promise<unknown>;
    },
    private readonly prefix = "store:",
  ) {}

  private k(key: string): string {
    return this.prefix + key;
  }

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.client.get(this.k(key));
    if (raw == null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.client.set(this.k(key), JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    await this.client.del(this.k(key));
  }
}

const memory = new MemoryKv();
let backend: Kv = memory;
let redisInit: Promise<void> | null = null;

function tryInitRedis(): void {
  if (redisInit) return;
  if (typeof process === "undefined" || !process.env?.REDIS_URL) return;
  const url = process.env.REDIS_URL;
  redisInit = (async () => {
    try {
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ioredis: any = require("ioredis");
      const Redis = ioredis.default ?? ioredis.Redis ?? ioredis;
      const client = new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
      backend = new RedisKv(client);
    } catch {
      backend = memory;
    }
  })();
}

tryInitRedis();

async function ready(): Promise<Kv> {
  if (redisInit) await redisInit;
  return backend;
}

export const kv: Kv = {
  async get<T>(key: string): Promise<T | undefined> {
    return (await ready()).get<T>(key);
  },
  async set<T>(key: string, value: T): Promise<void> {
    return (await ready()).set(key, value);
  },
  async delete(key: string): Promise<void> {
    return (await ready()).delete(key);
  },
};

/** Clears the in-memory backend. Used between dialog specs for isolation. */
export function resetDurableStore(): void {
  memory.clear();
  if (backend === memory || !(backend instanceof RedisKv)) {
    backend = memory;
  }
  // Keep order/notif ids deterministic across isolated specs.
  resetIds();
}
