require('dotenv').config();
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {pool}=require('../src/config/db');
(async()=>{
  try {
    for (const file of ['001_campaigns.sql','002_learning.sql','003_persona_research.sql','004_crm.sql','005_crm_leads.sql']) await pool.query(readFileSync(join(__dirname,'../migrations',file),'utf8'));
    console.log('Campaign storage is ready.');
  } finally { await pool.end(); }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
