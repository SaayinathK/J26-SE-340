'use strict';
// Loaded only by the isolated browser harness; never included in runtime images.
if(!/^c4_flow_verify_[a-f0-9]{12}$/.test(process.env.DB_NAME || '') || !process.env.CIFTRON_GOOGLE_FIXTURE_SECRET)throw new Error('Google fixture requires an isolated test database and signing secret.');
const path=require('node:path');
const gateway=path.resolve(__dirname,'../../../services/gateway');
const jwt=require(path.join(gateway,'node_modules/jsonwebtoken'));
const {OAuth2Client}=require(path.join(gateway,'node_modules/google-auth-library'));
OAuth2Client.prototype.verifyIdToken=async function({idToken,audience}){
  const payload=jwt.verify(idToken,process.env.CIFTRON_GOOGLE_FIXTURE_SECRET,{algorithms:['HS256'],audience,issuer:'isolated-google-provider'});
  return {getPayload:()=>payload};
};
