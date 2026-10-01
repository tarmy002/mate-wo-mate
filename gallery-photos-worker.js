/**
 * gallery-photos-worker
 * ---------------------------------------------------------------
 * 納品ギャラリーの写真を R2 に読み書きするための Cloudflare Worker。
 *
 *  GET / HEAD  … 誰でも可（お客様がギャラリーを見るため）
 *  PUT / DELETE … 管理者のみ。Supabase のログイントークンを検証する
 *
 * これにより、R2のアクセスキー／シークレットキーをブラウザ側（admin.html）に
 * 置く必要がなくなる。キーは Cloudflare が Worker と R2 の間で自動的に扱うため、
 * そもそもコードのどこにも書かない。
 *
 * ── Cloudflare ダッシュボードでの設定 ──────────────────────
 *  Settings → Bindings → R2 バケット
 *     変数名 : BUCKET            バケット : gallery-photos
 *  Settings → Variables and Secrets
 *     SUPABASE_URL      (Text)   https://gfywkysbinveawgpcbpg.supabase.co
 *     SUPABASE_ANON_KEY (Text)   eyJhbGciOi... （公開前提のanonキー。secretでも可）
 *     ADMIN_EMAILS      (Secret) 管理者のメールアドレス。複数ならカンマ区切り
 * ---------------------------------------------------------------
 */

const CORS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
  'Access-Control-Max-Age'      : '86400',
};

// トークン検証の結果を短時間だけ憶えておく（毎回Supabaseに問い合わせない）
const authCache = new Map(); // token -> { ok:boolean, exp:number }
const AUTH_TTL_MS = 5 * 60 * 1000;

async function isAdmin(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return false;

  const now    = Date.now();
  const cached = authCache.get(token);
  if (cached && cached.exp > now) return cached.ok;

  let ok = false;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': env.SUPABASE_ANON_KEY },
    });
    if (res.ok) {
      const user   = await res.json();
      const email  = (user?.email || '').toLowerCase();
      const allow  = (env.ADMIN_EMAILS || '')
        .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      // ADMIN_EMAILS 未設定なら「ログインできていれば管理者」として扱う
      ok = !!email && (allow.length === 0 || allow.includes(email));
    }
  } catch (e) {
    ok = false;
  }

  // 失敗も短くキャッシュして総当たりを鈍らせる
  authCache.set(token, { ok, exp: now + (ok ? AUTH_TTL_MS : 30_000) });
  if (authCache.size > 500) authCache.clear();
  return ok;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (!key) {
      return json(404, { error: 'not found' });
    }

    // ── 読み出し：誰でも可 ────────────────────────────────
    if (request.method === 'GET' || request.method === 'HEAD') {
      const obj = await env.BUCKET.get(key);
      if (!obj) return json(404, { error: 'not found' });

      const headers = new Headers(CORS);
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      // 写真はIDで一意なので上書きされない＝長期キャッシュしてよい
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');

      return new Response(request.method === 'HEAD' ? null : obj.body, { headers });
    }

    // ── 書き込み・削除：管理者のみ ─────────────────────────
    if (request.method === 'PUT' || request.method === 'DELETE') {
      if (!(await isAdmin(request, env))) {
        return json(401, { error: 'unauthorized' });
      }

      if (request.method === 'PUT') {
        await env.BUCKET.put(key, request.body, {
          httpMetadata: {
            contentType: request.headers.get('Content-Type') || 'application/octet-stream',
          },
        });
        return json(200, { ok: true, key });
      }

      await env.BUCKET.delete(key);
      return json(200, { ok: true, key });
    }

    return json(405, { error: 'method not allowed' });
  },
};
