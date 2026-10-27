const PERIODS = [30, 60, 180, 300];
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
const corsHeaders = origin => ({ "access-control-allow-origin": origin || "*", "access-control-allow-methods": "GET,POST,PATCH,OPTIONS", "access-control-allow-headers": "content-type,authorization,x-admin-key", "vary": "Origin" });
function colorFor(n) { return n === 0 || n === 5 ? "Violet" : ([1,3,7,9].includes(n) ? "Green" : "Red"); }
function base64url(bytes) { return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_"); }
function enc(s) { return new TextEncoder().encode(s); }
async function hmac(secret, data) { const key = await crypto.subtle.importKey("raw", enc(secret), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]); return base64url(await crypto.subtle.sign("HMAC", key, enc(data))); }
async function tokenFor(id, secret) { const head = base64url(enc(JSON.stringify({alg:"HS256",typ:"JWT"}))); const body = base64url(enc(JSON.stringify({sub:String(id),exp:Math.floor(Date.now()/1000)+604800}))); const input = head+"."+body; return input+"."+await hmac(secret,input); }
async function userFromToken(req, env) { const t=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,""); const p=t.split("."); if(p.length!==3)return null; const sig=await hmac(env.JWT_SECRET,p[0]+"."+p[1]); if(sig!==p[2])return null; try { const x=JSON.parse(atob(p[1].replace(/-/g,"+").replace(/_/g,"/"))); return x.exp>Date.now()/1000?Number(x.sub):null; } catch { return null; } }
async function passwordHash(password, salt = crypto.getRandomValues(new Uint8Array(16))) { const key=await crypto.subtle.importKey("raw",enc(password),"PBKDF2",false,["deriveBits"]); const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations:210000,hash:"SHA-256"},key,256); return "pbkdf2$210000$"+base64url(salt)+"$"+base64url(bits); }
async function verifyPassword(password, stored) { try { const p=stored.split("$"); if(p.length!==4||p[0]!=="pbkdf2")return false; const salt=Uint8Array.from(atob(p[2].replace(/-/g,"+").replace(/_/g,"/")+"===".slice((p[2].length+3)%4)),c=>c.charCodeAt(0)); return await passwordHash(password,salt)===stored; } catch { return false; } }
async function currentRound(db, period) {
 let r=await db.prepare("SELECT * FROM rounds WHERE period_seconds=? AND status='open' ORDER BY round_no DESC LIMIT 1").bind(period).first();
 const now=Math.floor(Date.now()/1000);
 if(r && now<r.ends_at)return r;
 if(r) await settle(db,r,now);
 const latest=await db.prepare("SELECT MAX(round_no) n FROM rounds WHERE period_seconds=?").bind(period).first();
 const no=(latest?.n||0)+1;
 await db.prepare("INSERT OR IGNORE INTO rounds(period_seconds,round_no,starts_at,ends_at,status) VALUES(?,?,?,?, 'open')").bind(period,no,now,now+period).run();
 return await db.prepare("SELECT * FROM rounds WHERE period_seconds=? AND status='open' ORDER BY round_no DESC LIMIT 1").bind(period).first();
}
async function settle(db,r,now=Math.floor(Date.now()/1000)) {
 if(!r||r.status!=="open"||now<r.ends_at)return;
 const n=crypto.getRandomValues(new Uint32Array(1))[0]%10, color=colorFor(n), size=n>=5?"Big":"Small";
 const bets=await db.prepare("SELECT * FROM bets WHERE round_id=? AND status='pending'").bind(r.id).all();
 const stmts=[db.prepare("UPDATE rounds SET status='settled',result_number=?,result_color=? WHERE id=? AND status='open'").bind(n,color,r.id)];
 for(const b of (bets.results||[])){ const wins=b.choice===String(n)||b.choice===color||b.choice===size; const payout=wins?b.stake*(b.choice===String(n)?9:b.choice===color?(color==="Violet"?4:2):2):0; if(payout)stmts.push(db.prepare("UPDATE users SET points=points+? WHERE id=?").bind(payout,b.user_id)); stmts.push(db.prepare("UPDATE bets SET status=?,payout=? WHERE id=? AND status='pending'").bind(wins?"won":"lost",payout,b.id)); }
 await db.batch(stmts);
}
export default {
 async fetch(req, env) {
  const origin=req.headers.get("origin")||"*";
  const headers=corsHeaders(origin);
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
  const url=new URL(req.url), path=url.pathname;
  if(path==="/api/health"&&req.method==="GET")return json({ok:true,mode:"virtual-points-only",diagnostics:{dbBinding:!!env.DB,jwtSecretPresent:typeof env.JWT_SECRET==="string"&&env.JWT_SECRET.length>0,jwtSecretLengthOk:typeof env.JWT_SECRET==="string"&&env.JWT_SECRET.length>=32}},200,headers);
  if(!env.DB||!env.JWT_SECRET||env.JWT_SECRET.length<32)return json({error:"Server setup incomplete: configure D1 binding DB and JWT_SECRET (32+ characters)."},503,headers);
  try {
   if(path==="/api/register"&&req.method==="POST"){
    const {username,password}=await req.json();
    if(typeof username!=="string"||!/^[a-zA-Z0-9_]{3,24}$/.test(username)||typeof password!=="string"||password.length<10||password.length>72)return json({error:"Username must be 3–24 letters/numbers/underscores; password must be 10–72 characters."},400,headers);
    const hash=await passwordHash(password);
    try{const r=await env.DB.prepare("INSERT INTO users(username,password_hash,points) VALUES(?,?,?)").bind(username,hash,1000).run();const id=Number(r.meta.last_row_id);return json({token:await tokenFor(id,env.JWT_SECRET),user:{username,points:1000},notice:"Virtual points only. No cash value."},201,headers)}catch(e){return json({error:"Registration database error: "+String(e?.message||e).slice(0,240)},500,headers)}
   }
   if(path==="/api/login"&&req.method==="POST"){
    const {username,password}=await req.json(); const u=await env.DB.prepare("SELECT * FROM users WHERE username=?").bind(username).first();
    if(!u||typeof password!=="string"||!(await verifyPassword(password,u.password_hash)))return json({error:"Invalid username or password."},401,headers);
    return json({token:await tokenFor(u.id,env.JWT_SECRET),user:{username:u.username,points:u.points}},200,headers);
   }
   if(path==="/api/me"&&req.method==="GET"){
    const id=await userFromToken(req,env);if(!id)return json({error:"Please log in again."},401,headers);
    const u=await env.DB.prepare("SELECT username,points,created_at FROM users WHERE id=?").bind(id).first();return u?json({user:u,notice:"Points are virtual and have no cash value."},200,headers):json({error:"Account not found."},404,headers);
   }
   if(path==="/api/rounds"&&req.method==="GET"){
    const rounds=[];for(const p of PERIODS){const r=await currentRound(env.DB,p);const old=await env.DB.prepare("SELECT round_no,result_number,result_color FROM rounds WHERE period_seconds=? AND status='settled' ORDER BY round_no DESC LIMIT 1").bind(p).first();rounds.push({id:r.id,periodSeconds:r.period_seconds,roundNo:r.round_no,startsAt:r.starts_at,endsAt:r.ends_at,remaining:Math.max(0,r.ends_at-Math.floor(Date.now()/1000)),status:r.status,lastResult:old?{roundNo:old.round_no,number:old.result_number,color:old.result_color,size:old.result_number>=5?"Big":"Small"}:null})}return json({rounds},200,headers);
   }
   if(path==="/api/bets"&&req.method==="POST"){
    const id=await userFromToken(req,env);if(!id)return json({error:"Please log in again."},401,headers);
    const {periodSeconds,choice,stake}=await req.json();if(!PERIODS.includes(Number(periodSeconds)))return json({error:"Invalid round period."},400,headers);
    if(!Number.isInteger(stake)||stake<1||stake>10000)return json({error:"Stake must be 1–10000 virtual points."},400,headers);
    if(typeof choice!=="string"||!(/^[0-9]$/.test(choice)||["Green","Violet","Red","Big","Small"].includes(choice)))return json({error:"Invalid choice."},400,headers);
    const r=await currentRound(env.DB,Number(periodSeconds));if(Math.floor(Date.now()/1000)>=r.ends_at-3)return json({error:"Betting is closed for this round. Wait for the next round."},409,headers);
    const u=await env.DB.prepare("SELECT points FROM users WHERE id=?").bind(id).first();if(!u||u.points<stake)return json({error:"Not enough virtual points."},400,headers);
    await env.DB.batch([env.DB.prepare("UPDATE users SET points=points-? WHERE id=? AND points>=?").bind(stake,id,stake),env.DB.prepare("INSERT INTO bets(user_id,round_id,choice,stake) VALUES(?,?,?,?)").bind(id,r.id,choice,stake)]);
    const fresh=await env.DB.prepare("SELECT username,points FROM users WHERE id=?").bind(id).first();return json({ok:true,message:"Virtual-points bet placed.",round:{roundNo:r.round_no,periodSeconds:r.period_seconds},user:fresh},201,headers);
   }
   if(path==="/api/payment-requests"&&req.method==="POST"){
    const id=await userFromToken(req,env);if(!id)return json({error:"Login required to submit a request."},401,headers);
    const body=await req.json();const type=body.type,provider=body.provider,amount=body.amount;
    if(!["deposit","withdrawal"].includes(type)||!["Easypaisa","JazzCash"].includes(provider)||!Number.isInteger(amount)||amount<1||amount>100000)return json({error:"Invalid request details."},400,headers);
    const txn=typeof body.transactionReference==="string"?body.transactionReference.trim().slice(0,80):"";
    const account=typeof body.accountNumber==="string"?body.accountNumber.trim().replace(/[^0-9+ -]/g,"").slice(0,20):"";
    const accountName=typeof body.accountName==="string"?body.accountName.trim().slice(0,80):"";
    if(type==="deposit"&&!txn)return json({error:"Transaction reference is required."},400,headers);
    if(type==="withdrawal"&&(!account||!accountName))return json({error:"Withdrawal account details are required."},400,headers);
    const u=await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(id).first();if(!u)return json({error:"Account not found."},404,headers);
    const result=await env.DB.prepare("INSERT INTO payment_requests(user_id,type,provider,amount,transaction_reference,account_number,account_name,status) VALUES(?,?,?,?,?,?,?,'pending')").bind(id,type,provider,amount,txn||null,account||null,accountName||null).run();
    return json({ok:true,request:{id:Number(result.meta.last_row_id),type,provider,amount,status:"pending"},message:"Request submitted for manual review. No wallet balance was changed."},201,headers);
   }
   if(path==="/api/payment-requests"&&req.method==="GET"){
    const id=await userFromToken(req,env);if(!id)return json({error:"Login required."},401,headers);
    const rows=await env.DB.prepare("SELECT id,type,provider,amount,transaction_reference,account_number,account_name,status,admin_note,created_at,updated_at FROM payment_requests WHERE user_id=? ORDER BY id DESC LIMIT 100").bind(id).all();
    return json({requests:rows.results||[]},200,headers);
   }
   if(path==="/api/admin/payment-requests"&&req.method==="GET"){
    const supplied=req.headers.get("x-admin-key")||"";
    if(!env.ADMIN_API_KEY||env.ADMIN_API_KEY.length<32||supplied.length!==env.ADMIN_API_KEY.length||!await crypto.subtle.digest("SHA-256",enc(supplied)).then(async a=>{const b=await crypto.subtle.digest("SHA-256",enc(env.ADMIN_API_KEY));return base64url(a)===base64url(b)}))return json({error:"Admin authorization failed."},401,headers);
    const status=url.searchParams.get("status");const rows=status?await env.DB.prepare("SELECT id,user_id,type,provider,amount,transaction_reference,account_number,account_name,status,admin_note,created_at,updated_at FROM payment_requests WHERE status=? ORDER BY id DESC LIMIT 200").bind(status).all():await env.DB.prepare("SELECT id,user_id,type,provider,amount,transaction_reference,account_number,account_name,status,admin_note,created_at,updated_at FROM payment_requests ORDER BY id DESC LIMIT 200").all();
    return json({requests:rows.results||[]},200,headers);
   }
   if(path.startsWith("/api/admin/payment-requests/")&&req.method==="PATCH"){
    const supplied=req.headers.get("x-admin-key")||"";
    if(!env.ADMIN_API_KEY||env.ADMIN_API_KEY.length<32||supplied.length!==env.ADMIN_API_KEY.length||!await crypto.subtle.digest("SHA-256",enc(supplied)).then(async a=>{const b=await crypto.subtle.digest("SHA-256",enc(env.ADMIN_API_KEY));return base64url(a)===base64url(b)}))return json({error:"Admin authorization failed."},401,headers);
    const requestId=Number(path.split("/").pop());if(!Number.isSafeInteger(requestId)||requestId<1)return json({error:"Invalid request ID."},400,headers);
    const body=await req.json();if(!["reviewed","approved","rejected"].includes(body.status))return json({error:"Status must be reviewed, approved, or rejected."},400,headers);
    const note=typeof body.note==="string"?body.note.trim().slice(0,300):"";
    const result=await env.DB.prepare("UPDATE payment_requests SET status=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(body.status,note||null,requestId).run();
    if(!result.meta.changes)return json({error:"Request not found or it is no longer pending."},409,headers);
    return json({ok:true,message:"Request status updated. This does not transfer money or change a wallet balance."},200,headers);
   }
   if(path==="/api/history"&&req.method==="GET"){
    const id=await userFromToken(req,env);if(!id)return json({error:"Please log in again."},401,headers);
    const rows=await env.DB.prepare("SELECT b.id,b.choice,b.stake,b.status,b.payout,r.period_seconds,r.round_no,r.result_number,r.result_color FROM bets b JOIN rounds r ON r.id=b.round_id WHERE b.user_id=? ORDER BY b.id DESC LIMIT 50").bind(id).all();return json({history:rows.results||[]},200,headers);
   }
   return json({error:"Not found."},404,headers);
  }catch(e){return json({error:"Server error: "+String(e?.message||e).slice(0,240)},500,headers)}
 }
};