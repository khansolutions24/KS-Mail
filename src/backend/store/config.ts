// Settings, accounts and secrets persisted as JSON files in the data directory.

import fs from 'node:fs';
import path from 'node:path';
import type { Account, Settings } from '@shared/types';
import { defaultSettings } from '@shared/defaults';
import { deepMerge } from '@shared/util';
import { platform } from '../platform';

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export interface Secret {
  password?: string;
  smtpPassword?: string;
  refreshToken?: string;
}

export class ConfigStore {
  private settingsFile: string;
  private accountsFile: string;
  private secretsFile: string;
  private settings: Settings;
  private accounts: Account[];
  private secrets: Record<string, string>;

  constructor(dir: string) {
    this.settingsFile = path.join(dir, 'settings.json');
    this.accountsFile = path.join(dir, 'accounts.json');
    this.secretsFile = path.join(dir, 'secrets.json');
    this.settings = deepMerge(defaultSettings(), readJson<Partial<Settings>>(this.settingsFile, {}));
    this.accounts = readJson<Account[]>(this.accountsFile, []);
    this.secrets = readJson<Record<string, string>>(this.secretsFile, {});
  }

  getSettings(): Settings {
    return this.settings;
  }

  updateSettings(patch: Partial<Settings>): Settings {
    // arrays (rules, signatures, …) are replaced, objects merged
    this.settings = deepMerge(this.settings, patch);
    writeJson(this.settingsFile, this.settings);
    return this.settings;
  }

  replaceSettings(s: Settings): void {
    this.settings = deepMerge(defaultSettings(), s);
    writeJson(this.settingsFile, this.settings);
  }

  listAccounts(): Account[] {
    return [...this.accounts].sort((a, b) => a.sortOrder - b.sortOrder).map((a) => ({ ...a, hasSecret: !!this.secrets[a.id] }));
  }

  getAccount(id: string): Account | undefined {
    const a = this.accounts.find((x) => x.id === id);
    return a ? { ...a, hasSecret: !!this.secrets[a.id] } : undefined;
  }

  saveAccount(a: Account): Account {
    const clean: Account = { ...a, imap: { ...a.imap }, smtp: { ...a.smtp } };
    const secret = this.getSecret(a.id);
    if (a.imap.password !== undefined && a.imap.password !== '') secret.password = a.imap.password;
    if (a.smtp.password !== undefined && a.smtp.password !== '') secret.smtpPassword = a.smtp.password;
    delete clean.imap.password;
    delete clean.smtp.password;
    delete clean.hasSecret;
    if (secret.password || secret.refreshToken || secret.smtpPassword) this.setSecret(a.id, secret);
    const idx = this.accounts.findIndex((x) => x.id === a.id);
    if (idx >= 0) this.accounts[idx] = clean;
    else {
      clean.sortOrder = this.accounts.length;
      this.accounts.push(clean);
    }
    writeJson(this.accountsFile, this.accounts);
    return this.getAccount(a.id)!;
  }

  removeAccount(id: string): void {
    this.accounts = this.accounts.filter((a) => a.id !== id);
    delete this.secrets[id];
    writeJson(this.accountsFile, this.accounts);
    writeJson(this.secretsFile, this.secrets);
  }

  reorder(ids: string[]): void {
    for (const a of this.accounts) {
      const i = ids.indexOf(a.id);
      a.sortOrder = i >= 0 ? i : ids.length + a.sortOrder;
    }
    writeJson(this.accountsFile, this.accounts);
  }

  getSecret(id: string): Secret {
    const stored = this.secrets[id];
    if (!stored) return {};
    try {
      return JSON.parse(platform().decrypt(stored)) as Secret;
    } catch {
      return {};
    }
  }

  setSecret(id: string, s: Secret): void {
    this.secrets[id] = platform().encrypt(JSON.stringify(s));
    writeJson(this.secretsFile, this.secrets);
  }
}
