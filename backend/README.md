# GameHub WinGo API (virtual points only)

This is a separate Node.js backend for `gamehub-pakistan`. It is **not** hosted by GitHub Pages; Pages serves static files only.

## Safety / scope
- Virtual points only; no deposits, cash-out, money prizes, or real-money wagering.
- New accounts receive 1,000 non-redeemable virtual points.
- Results are generated on the server with Node's crypto API.
- Passwords are hashed with bcrypt; API sessions use signed JWTs.
- SQLite persists accounts, rounds, bets, and virtual balances.

## Run locally
Requires Node.js 20+ and a build toolchain compatible with `better-sqlite3`.

```sh
cd backend
npm install
# Use a long random secret (at least 32 characters) and keep it private.
export JWT_SECRET="$(node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))")"
export PORT=3000
npm start
```

Health check: `GET /api/health`

## Endpoints
- `POST /api/register` — JSON: `{"username":"player_01","password":"at-least-10-chars"}`
- `POST /api/login` — same fields; returns bearer token
- `GET /api/me` — bearer token required
- `GET /api/rounds` — current 30s/1m/3m/5m round state and last results
- `POST /api/bets` — bearer token; JSON: `{"periodSeconds":30,"choice":"Green","stake":10}`
- `GET /api/history` — bearer token

Valid choices: `Green`, `Violet`, `Red`, `Big`, `Small`, or digit `0` through `9`. Bet placement closes 3 seconds before a round ends.

## Before public deployment
Deploy this backend to a Node-capable host with persistent disk, set `JWT_SECRET`, configure `FRONTEND_ORIGIN` to the exact GitHub Pages origin, use HTTPS, and verify database backups and host policies. Do not expose the database or secret. This backend is a starter implementation and needs independent security testing before production. It does not implement any payment or withdrawal features.
