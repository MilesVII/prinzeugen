# Prinz Eugen

Grabs posts from gelbooru, stores references, lets you moderate them in a dashboard and publishes them to Telegram.

```
core/        elysia server on bun: /api/* routes, /resize (media downscaler), /proxie/ (gelbooru passthrough), static frontend
frontend/    static/ (html, css, assets) + src/ (typescript) -> built into frontend/dist by build.ts
db/          sql migrations, applied by `bun run db:migrate`
deploy/      ubuntu provisioning, systemd units, nginx site, backup script
scripts/     dev runner
```

One `bun install` at the repository root installs everything (bun workspaces). npm is not used.

## Development

```bash
cp .env.example .env      # fill DB_CONNECTION at least
bun install
bun run db:migrate
bun run user create me --admin
bun run dev               # frontend watcher + server with reload on http://localhost:7780
```

Other scripts:

| command | what it does |
| --- | --- |
| `bun run build` | copy `frontend/static` to `frontend/dist`, bundle `frontend/src/main.ts` |
| `bun run start` | start the server (expects a build) |
| `bun run typecheck` | `tsc --noEmit` for both packages |
| `bun run db:migrate` | apply pending files from `db/migrations` |
| `bun run user ...` | manage accounts, see below |
| `bun run proxy` | local gelbooru preview proxy used by the moderation "upscale" button |

## Production (Ubuntu)

```bash
git clone <repo> ~/prinzeugen && cd ~/prinzeugen
cp .env.example .env && nano .env
./deploy/bootstrap.sh --domain dash.example.com [--with-tor]
bun run user create <name> --admin
sudo certbot --nginx -d dash.example.com
```

`bootstrap.sh` installs postgres, nginx, ffmpeg and bun, creates the role and database named in `DB_CONNECTION`, builds, migrates, and installs:

- `prinzeugen.service`: the bun server, restarted on failure, `.env` loaded from the working directory
- `prinzeugen-backup.timer`: weekly `pg_dump | gzip` sent to `TG_TARGET_ME` through the `TG_TOKEN` bot, failures are reported the same way. Set `BACKUP_DIR` in `.env` to keep local copies too.

Later releases: `./deploy/deploy.sh` (pull, install, build, migrate, restart).

If you wire things up by hand instead, remember `bun run build`: the server serves `frontend/dist`, which is not committed. Without it every page answers 503 "Frontend is not built".

Set `OUTBOUND_PROXY=socks5://127.0.0.1:9050` in `.env` if gelbooru media should be fetched through tor.

## Auth

There is no self-registration. Accounts are created by the CLI or by users allowed to invite.

- Login with name or numeric id plus password. Passwords are argon2id hashes. Hashes from the old dashboard are accepted once and upgraded on first login.
- A successful login returns a session token, stored in the browser, sent as `Authorization: Bearer <token>`. Sessions expire after 30 days without use.
- API tokens (settings, "api tokens") are long-lived bearer tokens for scripts and cron. They can be revoked individually.
- Roles: `admin` can create users, grant `can_invite` or admin, and list users. Users with `can_invite` can create plain users.
- Five failed logins for the same identifier lock it for 30 seconds, doubling per further failure.

CLI:

```bash
bun run user list
bun run user create <name> [--admin] [--invite] [--password <pw>]   # random password printed when omitted
bun run user passwd <id|name> [--password <pw>]                      # also revokes browser sessions
bun run user grant <id|name> [--admin|--no-admin] [--invite|--no-invite]
bun run user revoke-sessions <id|name>
```

### API

The server is an [Elysia](https://elysiajs.com) app (`core/src/app.ts`). Each route declares its body, query and params with `t.*` schemas, which are validated at runtime and are the source of the handler's types. Bad input gets a 422 with a `summary`. Everything except `/api/login` and `/api/debug` needs `Authorization: Bearer <token>`.

| method | path | body / query | notes |
| --- | --- | --- | --- |
| POST | `/api/login` | `{ identifier, password }` | returns `{ token, user, moderables, stats }` |
| GET | `/api/me` | | same bundle without the token |
| POST | `/api/logout` | | |
| POST | `/api/password` | `{ currentPassword, newPassword }` | signs out other browser sessions |
| PATCH | `/api/settings` | `{ tgToken?, additional? }` | |
| GET / POST | `/api/tokens` | `{ name }` | api tokens, shown once |
| DELETE | `/api/tokens/:id` | | |
| GET / POST | `/api/users` | `{ name, password, admin?, canInvite? }` | GET admin only, POST needs `can_invite` |
| GET / PUT | `/api/grabbers` | PUT: array of grabber configs | |
| POST | `/api/grab` | `{ id?, batchLimit? }` | returns `{ added }` |
| GET | `/api/moderables` | | |
| POST | `/api/moderate` | `{ decisions: [{ id, approved }] }` | returns remaining moderables |
| GET | `/api/pool` | `?page=&stride=` | rows carry `total` |
| DELETE | `/api/pool` | | wipe |
| DELETE | `/api/pool/:id` | | unschedule |
| POST | `/api/pool/:id/unfail` | | |
| POST | `/api/publish` | `{ target, id?, flags?, count?, extras? }` | returns `{ published, failed }` |

```bash
curl -X POST https://dash.example.com/api/publish \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"target":"@channel","count":1,"flags":["doubletap"]}'
```

Adding a route: pick a group in `core/src/api/`, write `.post("/thing", handler, { auth: "user", body: t.Object({...}) })`. `auth` is a macro from `core/src/api/authorized.ts` that resolves the bearer token into `auth.user` / `auth.session` and rejects with 401/403.

## Upgrading an existing deployment

1. Pull, `bun install`, `bun run build`, `bun run db:migrate`. The migrations only add columns and tables.
2. Existing users log in with their old password once and get upgraded to argon2id. Users whose `access_token` was `null` can no longer log in with anything; set a password with `bun run user passwd <id>`.
3. Promote yourself: `bun run user grant <id> --admin`.
4. External scripts that posted `{ action: "publish", user, userToken, ... }` to `/api` must switch to `POST /api/publish` with an API token created in settings.
5. Remove the nginx `/proxie/` location if you had one, the bun server handles it now. Set `PUBLIC_URL` in `.env`, it replaced the hardcoded domain for the `/resize` proxy URLs.
