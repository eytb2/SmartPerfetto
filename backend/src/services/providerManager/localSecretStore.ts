// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024-2026 Gracker (Chris)
// This file is part of SmartPerfetto. See LICENSE for details.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const SECRET_STORE_DIR_ENV = 'SMARTPERFETTO_SECRET_STORE_DIR';
export const SECRET_STORE_MASTER_KEY_ENV = 'SMARTPERFETTO_SECRET_STORE_MASTER_KEY';

interface EncryptedSecretEntry {
  version: number;
  algorithm: 'aes-256-gcm';
  iv: string;
  tag: string;
  ciphertext: string;
  updatedAt: number;
}

interface EncryptedSecretFile {
  version: 1;
  entries: Record<string, EncryptedSecretEntry>;
}

function resolveSecretStoreDir(): string {
  const configured = process.env[SECRET_STORE_DIR_ENV];
  return path.resolve(configured && configured.trim().length > 0
    ? configured
    : path.join(process.cwd(), 'data', 'secrets'));
}

function decodeMasterKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  try {
    const decoded = Buffer.from(trimmed, 'base64');
    if (decoded.length === 32) return decoded;
  } catch {
    // Fall through to passphrase hashing.
  }
  return crypto.createHash('sha256').update(trimmed, 'utf8').digest();
}

function readOrCreateLocalMasterKey(dir: string): Buffer {
  const keyPath = path.join(dir, '.master-key');
  if (fs.existsSync(keyPath)) {
    return decodeMasterKey(fs.readFileSync(keyPath, 'utf-8'));
  }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(keyPath, key.toString('base64'), { mode: 0o600 });
  try { fs.chmodSync(keyPath, 0o600); } catch { /* Windows */ }
  return key;
}

function resolveMasterKey(dir: string): Buffer {
  const configured = process.env[SECRET_STORE_MASTER_KEY_ENV];
  if (configured && configured.trim().length > 0) {
    return decodeMasterKey(configured);
  }
  return readOrCreateLocalMasterKey(dir);
}

function emptySecretFile(): EncryptedSecretFile {
  return { version: 1, entries: {} };
}

export class LocalEncryptedSecretStore {
  private readonly dir: string;
  private readonly filePath: string;
  private readonly key: Buffer;

  constructor(dir: string = resolveSecretStoreDir()) {
    this.dir = dir;
    this.filePath = path.join(dir, 'provider-secrets.enc.json');
    this.key = resolveMasterKey(dir);
  }

  get(ref: string): Record<string, string> {
    const file = this.readFile();
    const entry = file.entries[ref];
    if (!entry) return {};
    try {
      const decipher = crypto.createDecipheriv(
        entry.algorithm,
        this.key,
        Buffer.from(entry.iv, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(entry.ciphertext, 'base64')),
        decipher.final(),
      ]).toString('utf-8');
      const parsed = JSON.parse(plaintext);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, string>
        : {};
    } catch (err) {
      console.warn('[LocalSecretStore] Failed to decrypt secret:', (err as Error).message);
      return {};
    }
  }

  put(ref: string, value: Record<string, string>): number {
    const file = this.readFile();
    const previous = file.entries[ref];
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), 'utf-8'),
      cipher.final(),
    ]);
    const version = (previous?.version ?? 0) + 1;
    file.entries[ref] = {
      version,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      updatedAt: Date.now(),
    };
    this.writeFile(file);
    return version;
  }

  delete(ref: string): boolean {
    const file = this.readFile();
    const existed = Object.prototype.hasOwnProperty.call(file.entries, ref);
    if (!existed) return false;
    delete file.entries[ref];
    this.writeFile(file);
    return true;
  }

  private readFile(): EncryptedSecretFile {
    if (!fs.existsSync(this.filePath)) return emptySecretFile();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      return parsed && parsed.version === 1 && parsed.entries && typeof parsed.entries === 'object'
        ? parsed as EncryptedSecretFile
        : emptySecretFile();
    } catch {
      return emptySecretFile();
    }
  }

  private writeFile(file: EncryptedSecretFile): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
    try { fs.chmodSync(this.filePath, 0o600); } catch { /* Windows */ }
  }
}
