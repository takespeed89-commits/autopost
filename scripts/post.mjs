// 予約投稿の実行。queue/ の中で時刻が来たものを X と Instagram に投稿し、
// 終わったものを posted/ に移す。GitHub Actions から1日数回呼ばれる。
//
//   node scripts/post.mjs            本番
//   node scripts/post.mjs --dry-run  投稿せずに、何を投稿するかだけ表示
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, QUEUE, POSTED, readJson, writeJson, listQueue, parseAt } from './lib.mjs';

const DRY = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';
const EARLY_MS = 15 * 60 * 1000; // 予定の15分前から投稿してよい（Actions の起動の遅れを吸収）
const LATE_MS = 36 * 3600 * 1000; // 36時間以上遅れたものは古いので投稿しない
const IG_VERSION = process.env.IG_API_VERSION || 'v24.0';
const MEDIA_BASE =
  process.env.MEDIA_BASE_URL ||
  (process.env.GITHUB_REPOSITORY
    ? `https://raw.githubusercontent.com/${process.env.GITHUB_REPOSITORY}/main/`
    : '');

const accounts = readJson(path.join(ROOT, 'accounts.json'));
const env = process.env;

function log(...a) {
  console.log(...a);
}

// ---------- X（OAuth 1.0a ユーザー認証）----------
function pct(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function oauthHeader(method, url, creds, extraParams = {}) {
  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  };
  const u = new URL(url);
  const all = { ...extraParams, ...oauth };
  for (const [k, v] of u.searchParams) all[k] = v;
  const paramStr = Object.keys(all)
    .sort()
    .map((k) => `${pct(k)}=${pct(all[k])}`)
    .join('&');
  const base = [method.toUpperCase(), pct(u.origin + u.pathname), pct(paramStr)].join('&');
  const key = `${pct(creds.apiSecret)}&${pct(creds.accessSecret)}`;
  oauth.oauth_signature = crypto.createHmac('sha1', key).update(base).digest('base64');
  return (
    'OAuth ' +
    Object.keys(oauth)
      .sort()
      .map((k) => `${pct(k)}="${pct(oauth[k])}"`)
      .join(', ')
  );
}

function xCreds(prefix) {
  const c = {
    apiKey: env[`${prefix}_API_KEY`],
    apiSecret: env[`${prefix}_API_SECRET`],
    accessToken: env[`${prefix}_ACCESS_TOKEN`],
    accessSecret: env[`${prefix}_ACCESS_SECRET`],
  };
  return Object.values(c).every(Boolean) ? c : null;
}

async function xUploadImage(creds, file) {
  const url = 'https://api.x.com/2/media/upload';
  const form = new FormData();
  form.append('media', new Blob([fs.readFileSync(path.join(ROOT, file))], { type: 'image/jpeg' }), path.basename(file));
  form.append('media_category', 'tweet_image');
  const res = await fetch(url, { method: 'POST', headers: { Authorization: oauthHeader('POST', url, creds) }, body: form });
  const body = await res.json().catch(() => ({}));
  const id = body?.data?.id || body?.media_id_string;
  if (!res.ok || !id) throw new Error(`X 画像アップロード失敗 ${res.status} ${JSON.stringify(body)}`);
  return id;
}

async function postToX(prefix, item) {
  const creds = xCreds(prefix);
  if (!creds) return { skip: `鍵（${prefix}_*）が未設定` };
  const images = item.images || (item.image ? [item.image] : []);
  if (DRY) return { dry: true, text: item.text, images };
  const mediaIds = [];
  for (const img of images.slice(0, 4)) mediaIds.push(await xUploadImage(creds, img));
  const url = 'https://api.x.com/2/tweets';
  const payload = { text: item.text };
  if (mediaIds.length) payload.media = { media_ids: mediaIds };
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: oauthHeader('POST', url, creds), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.data?.id) throw new Error(`X 投稿失敗 ${res.status} ${JSON.stringify(body)}`);
  return { id: body.data.id, postedAt: new Date().toISOString() };
}

// ---------- Instagram（Instagram ログインの API）----------
async function igFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`Instagram ${res.status} ${JSON.stringify(body.error || body)}`);
  return body;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function igWaitReady(host, token, id) {
  for (let i = 0; i < 30; i++) {
    const s = await igFetch(`${host}/${IG_VERSION}/${id}?fields=status_code&access_token=${token}`);
    if (s.status_code === 'FINISHED') return;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new Error(`Instagram 準備失敗 ${s.status_code}`);
    await sleep(3000);
  }
  throw new Error('Instagram 準備がタイムアウト');
}

async function igCreate(host, token, userId, params) {
  const body = new URLSearchParams({ ...params, access_token: token });
  const r = await igFetch(`${host}/${IG_VERSION}/${userId}/media`, { method: 'POST', body });
  return r.id;
}

// 鍵は2種類に対応する。
//  ・<PREFIX>_USER_ID があるとき：ビジネス向け Facebook ログインのシステムユーザーの鍵（期限なし）。graph.facebook.com を使う
//  ・ないとき：Instagram ログインの鍵（60日）。graph.instagram.com を使う
function igHost(prefix) {
  return env[`${prefix}_USER_ID`] ? 'https://graph.facebook.com' : 'https://graph.instagram.com';
}

async function postToInstagram(prefix, item) {
  const token = env[`${prefix}_ACCESS_TOKEN`];
  if (!token) return { skip: `鍵（${prefix}_ACCESS_TOKEN）が未設定` };
  const host = igHost(prefix);
  const images = item.images || (item.image ? [item.image] : []);
  if (!images.length) throw new Error('Instagram は画像が必須');
  if (!MEDIA_BASE) throw new Error('画像の公開URL（MEDIA_BASE_URL）が決められない');
  const urls = images.map((f) => MEDIA_BASE + f.replace(/^\/+/, ''));
  if (DRY) return { dry: true, caption: item.caption, urls };
  let userId = env[`${prefix}_USER_ID`];
  if (!userId) {
    const me = await igFetch(`${host}/${IG_VERSION}/me?fields=user_id,username&access_token=${token}`);
    userId = me.user_id || me.id;
  }
  let creationId;
  if (urls.length === 1) {
    creationId = await igCreate(host, token, userId, { image_url: urls[0], caption: item.caption });
  } else {
    const children = [];
    for (const u of urls.slice(0, 10)) {
      const c = await igCreate(host, token, userId, { image_url: u, is_carousel_item: 'true' });
      await igWaitReady(host, token, c);
      children.push(c);
    }
    creationId = await igCreate(host, token, userId, { media_type: 'CAROUSEL', children: children.join(','), caption: item.caption });
  }
  await igWaitReady(host, token, creationId);
  const pub = await igFetch(`${host}/${IG_VERSION}/${userId}/media_publish`, {
    method: 'POST',
    body: new URLSearchParams({ creation_id: creationId, access_token: token }),
  });
  return { id: pub.id, postedAt: new Date().toISOString() };
}

// ---------- 本体 ----------
const PLATFORMS = {
  x: postToX,
  instagram: postToInstagram,
};

async function main() {
  const now = process.env.NOW ? Date.parse(process.env.NOW) : Date.now(); // NOW は試験用
  let failures = 0;
  let changed = 0;
  for (const file of listQueue()) {
    const name = path.basename(file);
    const post = readJson(file);
    const acct = accounts[post.account];
    const at = parseAt(post.at);
    if (!acct || !at) {
      log(`× ${name}: account か at が不正`);
      failures++;
      continue;
    }
    if (at.getTime() - EARLY_MS > now) continue; // まだ時刻前

    post.result = post.result || {};
    const late = now - at.getTime() > LATE_MS;
    for (const platform of Object.keys(PLATFORMS)) {
      if (!post[platform] || post.result[platform]?.id || post.result[platform]?.status) continue;
      const conf = acct[platform];
      if (!conf || conf.enabled === false) {
        post.result[platform] = { status: 'off', note: 'accounts.json で止めている' };
        continue;
      }
      if (late) {
        post.result[platform] = { status: 'late', note: '36時間以上遅れたので投稿しなかった' };
        log(`- ${name} ${platform}: 遅れすぎのため見送り`);
        continue;
      }
      try {
        const r = await PLATFORMS[platform](conf.secretPrefix, post[platform]);
        if (r.skip) {
          post.result[platform] = { status: 'no-key', note: r.skip };
          log(`- ${name} ${platform}: ${r.skip}`);
        } else if (r.dry) {
          log(`[試し] ${name} ${platform}:`, JSON.stringify(r));
        } else {
          post.result[platform] = r;
          log(`○ ${name} ${platform}: ${r.id}`);
        }
      } catch (e) {
        failures++;
        const tries = (post.result[platform]?.tries || 0) + 1;
        // 3回失敗したらあきらめて記録だけ残す（同じエラーで投稿を何度も試さない）
        post.result[platform] = tries >= 3 ? { status: 'failed', error: String(e.message).slice(0, 500), tries } : { tries, lastError: String(e.message).slice(0, 500) };
        log(`× ${name} ${platform}: ${e.message}`);
      }
    }
    if (DRY) continue;
    const done = Object.keys(PLATFORMS).every((p) => !post[p] || post.result[p]?.id || post.result[p]?.status);
    if (done) {
      fs.mkdirSync(POSTED, { recursive: true });
      writeJson(path.join(POSTED, name), post);
      fs.unlinkSync(file);
    } else {
      writeJson(file, post);
    }
    changed++;
  }
  log(`おわり: 更新 ${changed} 件、失敗 ${failures} 件${DRY ? '（試し）' : ''}`);
  if (failures) process.exitCode = 1; // 失敗があれば Actions を赤くして通知させる
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
