require('dotenv').config();
const express = require('express');
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit:'64kb' }));
const auth = require('./controllers/authController');
const { protect } = require('./middleware/auth');
app.post('/api/auth/register',auth.register);
app.post('/api/auth/login',auth.login);
app.get('/api/auth/me',protect,auth.getMe);
app.get('/health',(_req,res)=>res.json({ success:true,service:'content-agent' }));
app.use('/context',require('./routes/context'));
app.use('/content',require('./routes/content'));
app.use((_req,res)=>res.status(404).json({ success:false,error:'Route not found' }));
app.use((error,_req,res,_next)=>{
  const status = error.status || 500;
  if (status >= 500) console.error(error.message);
  res.status(status).json({ success:false,error:status === 500 ? 'Internal server error' : error.message });
});
if (require.main === module) {
  if (!process.env.JWT_SECRET || !process.env.DATABASE_URL) throw new Error('Set JWT_SECRET and DATABASE_URL in .env');
  if (process.env.NODE_ENV === 'production' && (process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET === 'ai-marketing-secret-key-2025')) throw new Error('Set a strong production JWT_SECRET');
  const server = app.listen(process.env.PORT || 5001,()=>console.log(`Server running on port ${process.env.PORT || 5001}`));
  const stop = () => server.close(()=>require('./config/db').pool.end().then(()=>process.exit(0)));
  process.on('SIGTERM',stop); process.on('SIGINT',stop);
}
module.exports = app;
