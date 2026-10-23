'use strict';
require('dotenv').config({path:require('node:path').resolve(__dirname,'../.env'),quiet:true});
require('../src/services/invitationMail').verify().then(()=>console.log('SMTP connection and authentication verified. No email was sent.')).catch(error=>{console.error('SMTP verification failed:',error.code || error.message);process.exitCode=1;});
