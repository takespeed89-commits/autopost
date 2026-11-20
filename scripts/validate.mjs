// queue/ の投稿を push 前に確かめる。問題があれば一覧を出して終了コード1。
//   node scripts/validate.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, POSTED, readJson, listQueue, parseAt, xWeightedLength, findUrls, weekKey } from './lib.mjs';

const accounts = readJson(path.join(ROOT, 'accounts.json'));
const rules = readJson(path.join(ROOT, 'brands', 'rules.json'));
const C = rules.common;
const errors = [];
const warns = [];
const linkWeeks = {}; // account|week -> 件数（X でURLを含む投稿）

function hashtags(t) {
  return (t.match(/[#＃][^\s#＃]+/g) || []).length;
}

function checkBanned(name, account, text) {
  const list = [...C.banned, ...(rules[account]?.banned || [])];
  for (const w of list) if (text.includes(w)) errors.push(`${name}: 使わない言葉「${w}」`);
  // 金額を書くなら税別と税込を両方（ラウンド）
  if (rules[account]?.requireTaxBoth && /[0-9０-９,，]+円/.test(text) && !(text.includes('税別') && text.includes('税込')))
    errors.push(`${name}: 金額を書くときは税別と税込を両方書く`);
}

function checkImages(name, list) {
  for (const img of list) {
    const p = path.join(ROOT, img);
    if (!fs.existsSync(p)) errors.push(`${name}: 画像がない ${img}`);
    else if (!/\.jpe?g$/i.test(img)) errors.push(`${name}: 画像は JPEG にする ${img}`);
    else if (fs.statSync(p).size > 8 * 1024 * 1024) errors.push(`${name}: 画像が8MBを超える ${img}`);
  }
}

// すでに投稿済みのリンク投稿も週の回数に数える
for (const dir of [POSTED]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const p = readJson(path.join(dir, f));
    const at = parseAt(p.at);
    if (at && p.x?.text && findUrls(p.x.text).length && p.result?.x?.id) {
      const k = `${p.account}|${weekKey(at)}`;
      linkWeeks[k] = (linkWeeks[k] || 0) + 1;
    }
  }
}

const seenTimes = {};
const files = listQueue();
for (const file of files) {
  const name = path.basename(file);
  let p;
  try {
    p = readJson(file);
  } catch (e) {
    errors.push(`${name}: JSON が壊れている ${e.message}`);
    continue;
  }
  if (!accounts[p.account]) errors.push(`${name}: account「${p.account}」は accounts.json にない`);
  const at = parseAt(p.at);
  if (!at) errors.push(`${name}: at はタイムゾーンつきの時刻にする（例 2026-11-23T20:30:00+09:00）`);
  if (!p.x && !p.instagram) errors.push(`${name}: x も instagram もない`);
  if (at) {
    const k = `${p.account}|${p.at}`;
    if (seenTimes[k]) warns.push(`${name}: ${seenTimes[k]} と同じ時刻`);
    seenTimes[k] = name;
  }

  if (p.x) {
    const t = p.x.text || '';
    if (!t.trim()) errors.push(`${name}: X の本文が空`);
    const len = xWeightedLength(t);
    if (len > C.xMaxWeighted) errors.push(`${name}: X の本文が長い（${len}/${C.xMaxWeighted}、日本語は1字=2）`);
    if (hashtags(t) > C.xMaxHashtags) errors.push(`${name}: X のハッシュタグは${C.xMaxHashtags}個まで`);
    checkBanned(name, p.account, t);
    checkImages(name, p.x.images || (p.x.image ? [p.x.image] : []));
    if (findUrls(t).length && at) {
      const k = `${p.account}|${weekKey(at)}`;
      linkWeeks[k] = (linkWeeks[k] || 0) + 1;
      if (linkWeeks[k] > C.xMaxLinkPostsPerWeek)
        errors.push(`${name}: X のリンク入り投稿は1週に${C.xMaxLinkPostsPerWeek}回まで（1回0.2ドルかかる）`);
    }
  }
  if (p.instagram) {
    const t = p.instagram.caption || '';
    if (!t.trim()) errors.push(`${name}: Instagram のキャプションが空`);
    if ([...t].length > C.igMaxCaption) errors.push(`${name}: Instagram のキャプションが長い`);
    if (hashtags(t) > C.igMaxHashtags) errors.push(`${name}: Instagram のハッシュタグは${C.igMaxHashtags}個まで`);
    checkBanned(name, p.account, t);
    const imgs = p.instagram.images || (p.instagram.image ? [p.instagram.image] : []);
    if (!imgs.length) errors.push(`${name}: Instagram は画像が必須`);
    if (imgs.length > 10) errors.push(`${name}: Instagram の画像は10枚まで`);
    checkImages(name, imgs);
  }
}

for (const w of warns) console.log('注意:', w);
if (errors.length) {
  for (const e of errors) console.log('×', e);
  console.log(`\n${files.length} 件中、問題 ${errors.length} 件`);
  process.exit(1);
}
console.log(`OK: ${files.length} 件すべて問題なし`);
