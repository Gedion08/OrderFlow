/**
 * Order-signer persistence layer.
 *
 * Stores per-order signer keypairs encrypted to disk so keeper restarts
 * do not lose the ability to claim fees or cancel orders.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100_000;

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}

export interface OrderSignerRecord {
  publicKey: string;
  secretKey: string;
  createdAt: number;
}

export class OrderSignerStore {
  private readonly file: string;
  private readonly password: string;
  private cache: Map<string, Keypair> | null = null;

  constructor(file: string, password: string) {
    this.file = file;
    this.password = password;
  }

  private encrypt(plaintext: string): Buffer {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = deriveKey(this.password, salt);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([salt, iv, authTag, encrypted]);
  }

  private decrypt(data: Buffer): string {
    const salt = data.subarray(0, SALT_LENGTH);
    const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = data.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = data.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    const key = deriveKey(this.password, salt);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }

  private loadRecords(): OrderSignerRecord[] {
    if (!fs.existsSync(this.file)) return [];
    try {
      const raw = fs.readFileSync(this.file);
      return JSON.parse(this.decrypt(raw)) as OrderSignerRecord[];
    } catch {
      return [];
    }
  }

  private persistRecords(records: OrderSignerRecord[]) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const json = JSON.stringify(records);
    fs.writeFileSync(this.file, this.encrypt(json));
  }

  get(publicKey: string): Keypair | undefined {
    const records = this.loadRecords();
    const rec = records.find((r) => r.publicKey === publicKey);
    if (!rec) return undefined;
    try {
      return Keypair.fromSecretKey(bs58.decode(rec.secretKey));
    } catch {
      return undefined;
    }
  }

  set(publicKey: string, keypair: Keypair): void {
    const records = this.loadRecords();
    const existing = records.findIndex((r) => r.publicKey === publicKey);
    const rec: OrderSignerRecord = {
      publicKey,
      secretKey: bs58.encode(keypair.secretKey),
      createdAt: Date.now(),
    };
    if (existing >= 0) records[existing] = rec;
    else records.push(rec);
    this.persistRecords(records);
  }

  remove(publicKey: string): void {
    const records = this.loadRecords().filter((r) => r.publicKey !== publicKey);
    this.persistRecords(records);
  }

  all(): Map<string, Keypair> {
    const records = this.loadRecords();
    const map = new Map<string, Keypair>();
    for (const r of records) {
      try {
        map.set(r.publicKey, Keypair.fromSecretKey(bs58.decode(r.secretKey)));
      } catch {
        // skip corrupted entries
      }
    }
    return map;
  }
}
