// 投稿スクリプトと検査スクリプトで共通に使う関数
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const QUEUE = path.join(ROOT, 'queue');
export const POSTED = path.join(ROOT, 'posted');

export function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

export function listQueue() {
  if (!fs.existsSync(QUEUE)) return [];
  return fs
    .readdirSync(QUEUE)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => path.join(QUEUE, f));
}

const URL_RE = /https?:\/\/[^\s　]+/g;

export function findUrls(text) {
  return text.match(URL_RE) || [];
}

// X の文字数（twitter-text の重み付け）。日本語は1文字=2、URLは23文字扱い。上限280
export function xWeightedLength(text) {
  let t = text.normalize('NFC');
  let len = 0;
  for (const u of findUrls(t)) {
    len += 23;
    t = t.replace(u, '');
  }
  for (const ch of t) {
    const cp = ch.codePointAt(0);
    const light =
      (cp >= 0 && cp <= 4351) ||
      (cp >= 8192 && cp <= 8205) ||
      (cp >= 8208 && cp <= 8223) ||
      (cp >= 8242 && cp <= 8247);
    len += light ? 1 : 2;
  }
  return len;
}

// 2026-11-23T20:30:00+09:00 のような時刻を必須にする（タイムゾーンなしは不可）
export function parseAt(at) {
  if (typeof at !== 'string' || !/[+-]\d{2}:\d{2}$|Z$/.test(at)) return null;
  const d = new Date(at);
  return isNaN(d) ? null : d;
}

// ISO週（月曜はじまり）のキー。リンク投稿の回数を週ごとに数えるのに使う
export function weekKey(date) {
  const jst = new Date(date.getTime() + 9 * 3600 * 1000);
  const day = (jst.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}
