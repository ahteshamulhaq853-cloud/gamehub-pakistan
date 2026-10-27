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


## Manual payment request API (not a live-money wallet)

The Cloudflare Worker implementation supports authenticated request submission and admin review:
- `POST /api/payment-requests` — signed-in user; `{ "type":"deposit", "provider":"Easypaisa", "amount":100, "transactionReference":"..." }`
- For withdrawals, use `type:"withdrawal"`, `provider`, `amount`, `accountNumber`, and `accountName`.
- `GET /api/payment-requests` — signed-in user's own requests.
- `GET /api/admin/payment-requests` — requires `x-admin-key` header.
- `PATCH /api/admin/payment-requests/:id` — requires `x-admin-key`; status is `reviewed`, `approved`, or `rejected`, with optional `note`.

### Apply the Worker database migration and secret

Run from the repository root with Wrangler authenticated to the correct Cloudflare account:
```sh
npx wrangler d1 execute gamehub-db --remote --file=backend/schema.sql
npx wrangler secret put ADMIN_API_KEY
npx wrangler deploy
```
When prompted for `ADMIN_API_KEY`, enter a long random secret of at least 32 characters. Do not put it in frontend code, GitHub files, or chat. The admin page asks for this key at runtime and sends it to the Worker over HTTPS.

**Important:** These endpoints only record requests and update review status. They do not verify Easypaisa/JazzCash transfers, move funds, credit/debit a wallet, or pay winnings. Do not treat an uploaded reference as proof of payment. Use only after legal review and explicit written approval from the payment provider for the intended activity. A secure real-money ledger, payment reconciliation, fraud controls, access controls, audit logs and independent security review would be required before any real-money use.
