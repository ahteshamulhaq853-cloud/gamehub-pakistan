'use strict';
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('Set JWT_SECRET to a random secret of at least 32 characters before starting.');
  process.exit(1);
}
const db = new Database(process.env.DB_PATH || 'gamehub.sqlite');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 points INTEGER NOT NULL DEFAULT 1000,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS rounds (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 period_seconds INTEGER NOT NULL,
 round_no INTEGER NOT NULL,
 starts_at INTEGER NOT NULL,
 ends_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'open',
 result_number INTEGER,
 result_color TEXT,
 UNIQUE(period_seconds, round_no)
);
CREATE TABLE IF NOT EXISTS bets (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id),
 round_id INTEGER NOT NULL REFERENCES rounds(id),
 choice TEXT NOT NULL,
 stake INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',
 payout INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS bets_round_idx ON bets(round_id);
`);
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || true }));
app.use(express.json({ limit: '10kb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

const periods = [30, 60, 180, 300];
const colorsFor = n => n === 0 || n === 5 ? 'Violet' : ([1,3,7,9].includes(n) ? 'Green' : 'Red');
function ensureRound(period) {
  const now = Math.floor(Date.now() / 1000);
  let r = db.prepare("SELECT * FROM rounds WHERE period_seconds=? AND status='open' ORDER BY round_no DESC LIMIT 1").get(period);
  if (r && now < r.ends_at) return r;
  if (r) settleRound(r, now);
  const latest = db.prepare('SELECT MAX(round_no) AS n FROM rounds WHERE period_seconds=?').get(period).n || 0;
  const start = now;
  const ins = db.prepare('INSERT INTO rounds(period_seconds,round_no,starts_at,ends_at,status) VALUES(?,?,?,?,?)');
  const info = ins.run(period, latest + 1, start, start + period, 'open');
  return db.prepare('SELECT * FROM rounds WHERE id=?').get(info.lastInsertRowid);
}
function settleRound(round, now = Math.floor(Date.now()/1000)) {
  if (!round || round.status !== 'open' || now < round.ends_at) return;
  const n = crypto.randomInt(0, 10), color = colorsFor(n), size = n >= 5 ? 'Big' : 'Small';
  const bets = db.prepare("SELECT * FROM bets WHERE round_id=? AND status='pending'").all(round.id);
  const tx = db.transaction(() => {
    db.prepare("UPDATE rounds SET status='settled', result_number=?, result_color=? WHERE id=? AND status='open'").run(n,color,round.id);
    for (const b of bets) {
      const wins = b.choice === String(n) || b.choice === color || b.choice === size;
      const payout = wins ? b.stake * (b.choice === String(n) ? 9 : b.choice === color ? (color === 'Violet' ? 4 : 2) : 2) : 0;
      if (payout) db.prepare('UPDATE users SET points=points+? WHERE id=?').run(payout,b.user_id);
      db.prepare('UPDATE bets SET status=?, payout=? WHERE id=?').run(wins ? 'won' : 'lost',payout,b.id);
    }
  });
  tx();
}
function currentRound(period) {
  const r = ensureRound(period);
  return { id:r.id, periodSeconds:r.period_seconds, roundNo:r.round_no, startsAt:r.starts_at, endsAt:r.ends_at, remaining:Math.max(0,r.ends_at-Math.floor(Date.now()/1000)), status:r.status };
}
function auth(req,res,next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i,'');
  try { const data = jwt.verify(token,JWT_SECRET); req.userId = data.sub; next(); }
  catch { res.status(401).json({ error:'Please log in again.' }); }
}
const usernameOk = s => typeof s === 'string' && /^[a-zA-Z0-9_]{3,24}$/.test(s);
app.get('/api/health', (_req,res) => res.json({ok:true, mode:'virtual-points-only'}));
app.post('/api/register', async (req,res) => {
  const {username,password} = req.body || {};
  if (!usernameOk(username) || typeof password !== 'string' || password.length < 10 || password.length > 72)
    return res.status(400).json({error:'Username must be 3–24 letters/numbers/underscores; password must be 10–72 characters.'});
  try {
    const hash = await bcrypt.hash(password,12);
    const info = db.prepare('INSERT INTO users(username,password_hash,points) VALUES(?,?,1000)').run(username,hash);
    const token = jwt.sign({sub:info.lastInsertRowid},JWT_SECRET,{expiresIn:'7d'});
    res.status(201).json({token,user:{username,points:1000},notice:'Virtual points only. No cash value.'});
  } catch(e) { res.status(409).json({error:'That username may already be in use.'}); }
});
app.post('/api/login', async (req,res) => {
  const {username,password} = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user || typeof password !== 'string' || !(await bcrypt.compare(password,user.password_hash)))
    return res.status(401).json({error:'Invalid username or password.'});
  const token = jwt.sign({sub:user.id},JWT_SECRET,{expiresIn:'7d'});
  res.json({token,user:{username:user.username,points:user.points}});
});
app.get('/api/me',auth,(req,res) => {
  const u = db.prepare('SELECT username,points,created_at FROM users WHERE id=?').get(req.userId);
  if (!u) return res.status(404).json({error:'Account not found.'});
  res.json({user:u,notice:'Points are virtual and have no cash value.'});
});
app.get('/api/rounds',(_req,res) => {
  const rounds = periods.map(p => currentRound(p));
  for (const r of rounds) {
    const old = db.prepare("SELECT round_no,result_number,result_color FROM rounds WHERE period_seconds=? AND status='settled' ORDER BY round_no DESC LIMIT 1").get(r.periodSeconds);
    r.lastResult = old ? {roundNo:old.round_no,number:old.result_number,color:old.result_color,size:old.result_number>=5?'Big':'Small'} : null;
  }
  res.json({rounds});
});
app.post('/api/bets',auth,(req,res) => {
  const {periodSeconds,choice,stake} = req.body || {};
  if (!periods.includes(Number(periodSeconds))) return res.status(400).json({error:'Invalid round period.'});
  if (!Number.isInteger(stake) || stake < 1 || stake > 10000) return res.status(400).json({error:'Stake must be 1–10000 virtual points.'});
  const validChoice = typeof choice === 'string' && (/^[0-9]$/.test(choice) || ['Green','Violet','Red','Big','Small'].includes(choice));
  if (!validChoice) return res.status(400).json({error:'Invalid choice.'});
  const r = ensureRound(Number(periodSeconds));
  const now = Math.floor(Date.now()/1000);
  if (now >= r.ends_at - 3) return res.status(409).json({error:'Betting is closed for this round. Wait for the next round.'});
  const tx = db.transaction(() => {
    const u = db.prepare('SELECT points FROM users WHERE id=?').get(req.userId);
    if (!u || u.points < stake) throw new Error('NOT_ENOUGH_POINTS');
    db.prepare('UPDATE users SET points=points-? WHERE id=?').run(stake,req.userId);
    db.prepare('INSERT INTO bets(user_id,round_id,choice,stake) VALUES(?,?,?,?)').run(req.userId,r.id,choice,stake);
  });
  try { tx(); } catch(e) { return res.status(400).json({error:e.message==='NOT_ENOUGH_POINTS'?'Not enough virtual points.':'Could not place bet.'}); }
  res.status(201).json({ok:true,message:'Virtual-points bet placed.',round:{roundNo:r.round_no,periodSeconds:r.period_seconds},user:db.prepare('SELECT username,points FROM users WHERE id=?').get(req.userId)});
});
app.get('/api/history',auth,(req,res) => {
  const rows = db.prepare(`SELECT b.id,b.choice,b.stake,b.status,b.payout,r.period_seconds,r.round_no,r.result_number,r.result_color
    FROM bets b JOIN rounds r ON r.id=b.round_id WHERE b.user_id=? ORDER BY b.id DESC LIMIT 50`).all(req.userId);
  res.json({history:rows});
});
app.use((_req,res) => res.status(404).json({error:'Not found.'}));
setInterval(() => {
  const now = Math.floor(Date.now()/1000);
  for (const p of periods) {
    const r = db.prepare("SELECT * FROM rounds WHERE period_seconds=? AND status='open' ORDER BY round_no DESC LIMIT 1").get(p);
    if (r && now >= r.ends_at) settleRound(r,now);
    ensureRound(p);
  }
},1000).unref();
for (const p of periods) ensureRound(p);
app.listen(PORT, () => console.log('GameHub virtual-points API listening on port '+PORT));
