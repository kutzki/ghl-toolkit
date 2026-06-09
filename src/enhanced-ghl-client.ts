/**
 * Enhanced GHL API Client
 * 
 * Wraps the existing GHLApiClient with:
 * - Connection pooling (HTTP keep-alive)
 * - TTL cache for read-only responses
 * - Retry with exponential backoff (429/5xx)
 * - Rate limit header tracking
 * - Structured error responses
 */

import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import * as http from 'http';
import * as https from 'https';
import { GHLApiClient } from './clients/ghl-api-client.js';
import { GHLConfig, GHLApiResponse, GHLErrorResponse } from './types/ghl-types.js';

// ─── TTL Cache ──────────────────────────────────────────────

interface CacheEntry<T = any> {
  data: T;
  expires: number;
}

class TTLCache {
  private store = new Map<string, CacheEntry>();
  private defaultTTL: number;
  private maxSize: number;
  private hits = 0;
  private misses = 0;

  constructor(defaultTTLMs = 30_000, maxSize = 500) {
    this.defaultTTL = defaultTTLMs;
    this.maxSize = maxSize;

    // Periodic cleanup every 60s
    const interval = setInterval(() => this.cleanup(), 60_000);
    interval.unref();
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) { this.misses++; return undefined; }
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    // LRU: move to end by delete+re-insert
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits++;
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlMs?: number): void {
    // LRU: evict least-recently-used (first in Map = oldest access) if at capacity
    if (this.store.size >= this.maxSize) {
      const lru = this.store.keys().next().value;
      if (lru !== undefined) this.store.delete(lru);
    }
    this.store.set(key, {
      data,
      expires: Date.now() + (ttlMs ?? this.defaultTTL),
    });
  }

  invalidate(pattern?: string): void {
    if (!pattern) {
      this.store.clear();
      return;
    }
    for (const key of this.store.keys()) {
      if (key.includes(pattern)) this.store.delete(key);
    }
  }

  getStats() {
    return {
      size: this.store.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? `${Math.round((this.hits / (this.hits + this.misses)) * 100)}%`
        : '0%',
    };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expires) this.store.delete(key);
    }
  }
}

// ─── Rate Limit Tracker ─────────────────────────────────────

interface RateLimitState {
  remaining: number;
  limit: number;
  resetAt: number;
}

// ─── Enhanced Client ────────────────────────────────────────

export class EnhancedGHLClient extends GHLApiClient {
  private cache: TTLCache;
  private rateLimit: RateLimitState = { remaining: Infinity, limit: Infinity, resetAt: 0 };
  private enhancedAxios: AxiosInstance;

  constructor(config: GHLConfig, getToken?: () => Promise<string>) {
    super(config, getToken);

    // Create enhanced axios instance with connection pooling
    const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 10, keepAliveMsecs: 30_000 });
    const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10, keepAliveMsecs: 30_000 });

    this.enhancedAxios = axios.create({
      baseURL: config.baseUrl,
      headers: {
        'Authorization': `Bearer ${config.accessToken}`,
        'Version': config.version,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      timeout: 30_000,
      httpAgent,
      httpsAgent,
    });

    // Dynamic token refresh for the enhanced axios instance
    if (getToken) {
      this.enhancedAxios.interceptors.request.use(async (reqConfig) => {
        const token = await getToken();
        reqConfig.headers.Authorization = `Bearer ${token}`;
        return reqConfig;
      });
    }

    // Track rate limit headers
    this.enhancedAxios.interceptors.response.use(
      (response) => {
        this.trackRateLimit(response);
        return response;
      },
      (error) => {
        if (error.response) this.trackRateLimit(error.response);
        return Promise.reject(error);
      }
    );

    // Cache with 30s TTL, 500 entries max
    this.cache = new TTLCache(30_000, 500);
  }

  private trackRateLimit(response: AxiosResponse): void {
    const remaining = response.headers['x-ratelimit-remaining'];
    const limit = response.headers['x-ratelimit-limit'];
    const reset = response.headers['x-ratelimit-reset'];

    if (remaining !== undefined) this.rateLimit.remaining = parseInt(remaining, 10);
    if (limit !== undefined) this.rateLimit.limit = parseInt(limit, 10);
    if (reset !== undefined) this.rateLimit.resetAt = parseInt(reset, 10) * 1000;
  }

  /**
   * Enhanced makeRequest with caching and retry.
   * Routes through enhancedAxios (connection pooling + rate-limit tracking).
   */
  async makeRequest<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: Record<string, unknown>
  ): Promise<GHLApiResponse<T>> {
    // Cache GET requests; include locationId to prevent cross-tenant data leakage
    if (method === 'GET') {
      const cacheKey = `${this.getConfig().locationId}:${method}:${path}`;
      const cached = this.cache.get<GHLApiResponse<T>>(cacheKey);
      if (cached) return cached;

      const result = await this.makeRequestWithRetry<T>(method, path, body);
      if (result.success) {
        this.cache.set(cacheKey, result);
      }
      return result;
    }

    // Non-GET: execute and invalidate related caches
    const result = await this.makeRequestWithRetry<T>(method, path, body);

    // Invalidate cache for the resource path
    const basePath = path.split('?')[0].split('/').slice(0, 3).join('/');
    this.cache.invalidate(basePath);

    return result;
  }

  private async makeRequestWithRetry<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    attempt = 0
  ): Promise<GHLApiResponse<T>> {
    const MAX_RETRIES = 3;
    const BASE_DELAY = 1000;

    // Only safe idempotent methods are retried — never POST/PATCH (may create duplicates)
    const isRetryable = method === 'GET' || method === 'DELETE' || method === 'PUT';

    try {
      // Preemptive rate limit check
      if (this.rateLimit.remaining <= 1 && Date.now() < this.rateLimit.resetAt) {
        const waitMs = this.rateLimit.resetAt - Date.now();
        if (waitMs > 0 && waitMs < 60_000) {
          await new Promise(r => setTimeout(r, waitMs));
        }
      }

      // Use enhancedAxios (connection pooling + rate-limit header tracking)
      let response: AxiosResponse;
      switch (method) {
        case 'GET':    response = await this.enhancedAxios.get(path); break;
        case 'POST':   response = await this.enhancedAxios.post(path, body); break;
        case 'PUT':    response = await this.enhancedAxios.put(path, body); break;
        case 'PATCH':  response = await this.enhancedAxios.patch(path, body); break;
        case 'DELETE': response = await this.enhancedAxios.delete(path); break;
        default: throw new Error(`Unsupported method: ${method}`);
      }
      return { success: true, data: response.data as T };
    } catch (err: any) {
      const status = err.response?.status || (err.message?.match(/\((\d+)\)/)?.[1] && parseInt(err.message.match(/\((\d+)\)/)[1]));

      // Retry on 429 (rate limit) and 5xx (server errors), but only for idempotent methods
      if (isRetryable && attempt < MAX_RETRIES && (status === 429 || (status >= 500 && status < 600))) {
        const delay = BASE_DELAY * Math.pow(2, attempt) + Math.random() * 500;
        process.stderr.write(`[GHL] Retry ${attempt + 1}/${MAX_RETRIES} for ${method} ${path} (status ${status}, delay ${Math.round(delay)}ms)\n`);
        await new Promise(r => setTimeout(r, delay));
        return this.makeRequestWithRetry<T>(method, path, body, attempt + 1);
      }

      throw err;
    }
  }

  getCacheStats() {
    return {
      ...this.cache.getStats(),
      rateLimit: {
        remaining: this.rateLimit.remaining === Infinity ? 'unlimited' : this.rateLimit.remaining,
        limit: this.rateLimit.limit === Infinity ? 'unlimited' : this.rateLimit.limit,
      },
    };
  }
}
