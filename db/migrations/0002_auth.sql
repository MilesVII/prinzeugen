-- Session/API-token based auth, roles, invite permission.

alter table users add column if not exists role text not null default 'user';
alter table users add column if not exists can_invite boolean not null default false;
alter table users add column if not exists created_at timestamptz not null default now();

create table if not exists sessions (
	id serial primary key,
	user_id bigint not null references users(id) on delete cascade,
	token_hash text not null unique,
	kind text not null default 'session',
	name text,
	created_at timestamptz not null default now(),
	last_used_at timestamptz,
	expires_at timestamptz
);
create index if not exists sessions_user_idx on sessions (user_id);
