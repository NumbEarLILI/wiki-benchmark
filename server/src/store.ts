import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Connector, Dataset, Run, Settings } from './types.js';

export interface DB {
  connectors: Connector[];
  datasets: Dataset[];
  runs: Run[];
  settings: Settings;
}

export const defaultSettings: Settings = {
  judge: { enabled: false, baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' },
  agent: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' },
  weights: { retrieval: 0.4, answer: 0.4, performance: 0.2 },
  latencyTargetMs: 1500,
  latencyMaxMs: 15000,
  hfEndpoint: 'https://huggingface.co',
  hfToken: '',
};

export const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

export function now() {
  return new Date().toISOString();
}

function load(): DB | null {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as DB;
    raw.settings = { ...defaultSettings, ...raw.settings, judge: { ...defaultSettings.judge, ...raw.settings?.judge }, agent: { ...defaultSettings.agent, ...raw.settings?.agent } };
    return raw;
  } catch {
    return null;
  }
}

let timer: NodeJS.Timeout | null = null;

export const db: DB = load() ?? { connectors: [], datasets: [], runs: [], settings: structuredClone(defaultSettings) };
export const isFreshDb = !fs.existsSync(DB_FILE);

function flush() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}

/** 合并短时间内的多次写入，避免评测过程中频繁写盘 */
export function save(immediate = false) {
  if (immediate) {
    if (timer) clearTimeout(timer);
    timer = null;
    flush();
    return;
  }
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flush();
  }, 300);
}
