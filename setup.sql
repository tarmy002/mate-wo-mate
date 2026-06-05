-- ============================================================
-- mate wo mate セットアップSQL
-- Supabase の SQL Editor に貼り付けて実行してください
-- ※ 写真はCloudflare R2に保存します（Supabase Storageは使いません）
-- ============================================================

-- 1. ギャラリーテーブル
create table if not exists galleries (
  id          text        primary key,
  client_name text        not null,
  shoot_type  text,
  shoot_date  date,
  expires_at  date        not null,
  message     text,
  photo_count integer     default 0,
  quality     text        default 'compress', -- 'compress' or 'original'
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- 2. 写真テーブル
create table if not exists photos (
  id           text        primary key,
  gallery_id   text        not null references galleries(id) on delete cascade,
  storage_path text        not null,  -- R2のパス例: {gallery_id}/{photo_id}.jpg
  file_name    text,
  content_type text        default 'image/jpeg',
  sort_order   integer     default 0,
  created_at   timestamptz default now()
);

create index if not exists photos_gallery_id_idx on photos(gallery_id);

-- 3. RLSポリシー（読み取りは誰でもOK、書き込みはログイン必須）
alter table galleries enable row level security;
alter table photos     enable row level security;

create policy "公開読み取り"        on galleries for select using (true);
create policy "ログイン時書き込み"  on galleries for insert with check (auth.uid() is not null);
create policy "ログイン時更新"      on galleries for update using (auth.uid() is not null);
create policy "ログイン時削除"      on galleries for delete using (auth.uid() is not null);

create policy "公開読み取り"        on photos for select using (true);
create policy "ログイン時書き込み"  on photos for insert with check (auth.uid() is not null);
create policy "ログイン時削除"      on photos for delete using (auth.uid() is not null);

-- ============================================================
-- ※ この後、以下の作業も行ってください:
--
-- 【Supabase】
--   Authentication → Users → 管理者アカウントを招待
--   （Storageのバケットは不要です）
--
-- 【Cloudflare R2】
--   1. R2 → バケットを作成（名前: gallery-photos）
--   2. バケット設定 → Public Access → Enable
--      → r2.dev の公開URLをメモ（client.html に記入）
--   3. CORS Policy を設定（バケット設定 → CORS）:
--      [{"AllowedOrigins":["*"],"AllowedMethods":["GET","PUT","DELETE","HEAD"],"AllowedHeaders":["*"],"MaxAgeSeconds":3000}]
--   4. R2 API トークンを発行:
--      Cloudflare ダッシュボード → R2 → API Tokens → Create API Token
--      → Permissions: Object Read & Write
--      → Access Key ID と Secret Access Key をメモ（admin.html に記入）
--   5. アカウントID をメモ（右上のアカウントメニューで確認）
-- ============================================================
