-- Server-side media cache for moderation previews and publish fallbacks.
-- cache_file is relative to CACHE_DIR; cache_variant is "sample" or "original".

alter table pool add column if not exists cache_file text;
alter table pool add column if not exists cache_variant text;
alter table pool add column if not exists cache_attempts integer not null default 0;
alter table pool add column if not exists cache_error text;

-- the worker's queue: pending moderation, not cached yet
create index if not exists pool_cache_queue_idx on pool (id) where approved is null and cache_file is null;

-- small server-wide key/value store (worker on/off survives restarts)
create table if not exists app_settings (
	key text primary key,
	value jsonb not null,
	updated_at timestamptz not null default now()
);
