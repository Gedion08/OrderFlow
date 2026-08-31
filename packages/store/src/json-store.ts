/**
 * JSON-file strategy store (development fallback).
 *
 * Reads/writes strategies to disk as JSON. Not safe for concurrent
 * writers or horizontal scaling — use PostgresStrategyStore in production.
 */

import fs from 'fs';
import path from 'path';
import { DcaStrategy } from '@orderflow/core';

export class JsonStrategyStore {
  private readonly file: string;
  private cache: DcaStrategy[] | null = null;

  constructor(file: string) {
    this.file = file;
  }

  private load(): DcaStrategy[] {
    if (this.cache) return this.cache;
    let loaded: DcaStrategy[];
    if (!fs.existsSync(this.file)) {
      loaded = [];
    } else {
      try {
        loaded = JSON.parse(fs.readFileSync(this.file, 'utf8')) as DcaStrategy[];
      } catch {
        loaded = [];
      }
    }
    this.cache = loaded;
    return loaded;
  }

  private persist() {
    if (!this.cache) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.cache, null, 2));
  }

  list(): DcaStrategy[] {
    return this.load();
  }

  byId(id: string): DcaStrategy | undefined {
    return this.load().find((s) => s.strategyId === id);
  }

  byPool(pool: string): DcaStrategy[] {
    return this.load().filter((s) => s.pool === pool);
  }

  byOwner(wallet: string): DcaStrategy[] {
    return this.load().filter(
      (s) => s.owner.toLowerCase() === wallet.toLowerCase(),
    );
  }

  upsert(s: DcaStrategy) {
    const all = this.load();
    const idx = all.findIndex((x) => x.strategyId === s.strategyId);
    if (idx >= 0) all[idx] = s;
    else all.push(s);
    this.persist();
  }

  remove(id: string) {
    this.cache = (this.load() || []).filter((s) => s.strategyId !== id);
    this.persist();
  }

  cancel(id: string) {
    const s = this.byId(id);
    if (s && s.status !== 'cancelled') {
      s.status = 'cancelled';
      s.updatedAt = Date.now();
      this.upsert(s);
    }
  }
}
