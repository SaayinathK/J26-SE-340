const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const db = require('../config/db');
const token = id => jwt.sign({ clientId: id }, process.env.JWT_SECRET, { expiresIn: '24h', algorithm: 'HS256' });
function credentials(body) {
  return typeof body.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) && typeof body.password === 'string' && Buffer.byteLength(body.password) >= 8 && Buffer.byteLength(body.password) <= 72;
}
async function register(req,res,next) {
  if (!credentials(req.body) || typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.length > 255 || req.body.email.length > 255) return res.status(400).json({ success:false,error:'Provide name, valid email and password of 8–72 bytes' });
  try {
    const id = randomUUID(), email = req.body.email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(req.body.password,12);
    await db.transaction(id, async run => {
      await run('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',[email]);
      const found = await run('SELECT id FROM clients WHERE lower(email) = $1',[email]);
      if (found.rows.length) throw Object.assign(new Error('Email already registered'),{ status:409 });
      await run(`INSERT INTO clients (id,name,email,password_hash,plan,generations_used,generations_limit,is_active)
        VALUES ($1,$2,$3,$4,'free',0,50,true)`,[id,req.body.name.trim(),email,passwordHash]);
    });
    res.status(201).json({ success:true,token:token(id),client:{ id,name:req.body.name.trim(),email } });
  } catch(error) { if(error.code === '23505') error.status=409; next(error); }
}
async function login(req,res,next) {
  if (!credentials(req.body)) return res.status(400).json({ success:false,error:'Valid email and password required' });
  try {
    const { rows } = await db.query('SELECT id,password_hash,is_active FROM clients WHERE lower(email) = $1',[req.body.email.trim().toLowerCase()]);
    const client = rows[0];
    if (!client?.is_active || !await bcrypt.compare(req.body.password,client.password_hash)) return res.status(401).json({ success:false,error:'Invalid credentials' });
    res.json({ success:true,token:token(client.id) });
  } catch(error) { next(error); }
}
async function getMe(req,res,next) {
  try {
    const { rows } = await db.query('SELECT id,name,email,plan,generations_used,generations_limit,is_active FROM clients WHERE id = $1',[req.tenant_id],req.tenant_id);
    res.json({ success:true,client:rows[0] });
  } catch(error) { next(error); }
}
module.exports = { register,login,getMe };
