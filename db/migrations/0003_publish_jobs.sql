-- In-process scheduled publishing. One row per cron job, params mirror POST /api/publish.

create table if not exists publish_jobs (
	id serial primary key,
	user_id bigint not null references users(id) on delete cascade,
	name text not null default '',
	cron text not null,
	timezone text not null default 'UTC',
	enabled boolean not null default true,
	params jsonb not null,
	last_run_at timestamptz,
	last_result text,
	created_at timestamptz not null default now()
);
create index if not exists publish_jobs_user_idx on publish_jobs (user_id);
