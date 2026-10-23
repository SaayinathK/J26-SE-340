'use strict';
const nodemailer=require('nodemailer');
const roleNames={agency_admin:'Administrator',marketer:'Marketer',viewer:'Viewer'};
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function configuration(env=process.env){
  if(env.INVITATION_MAIL_DISABLED==='true')return null;
  if(!env.SMTP_HOST || !env.SMTP_FROM)return null;
  if(!/^[^\s<>;,"@]+@[^\s<>;,"@]+\.[^\s<>;,"@]+$/.test(env.SMTP_FROM) || (!!env.SMTP_USER !== !!env.SMTP_PASS))throw new Error('Incomplete invitation SMTP settings.');
  const port=Number(env.SMTP_PORT || 587);
  if(!Number.isInteger(port) || port<1 || port>65535)throw new Error('Invalid invitation SMTP port.');
  const secure=env.SMTP_SECURE ? env.SMTP_SECURE==='true' : port===465;
  return {host:env.SMTP_HOST,port,secure,requireTLS:env.SMTP_REQUIRE_TLS!=='false' && !secure,auth:env.SMTP_USER?{user:env.SMTP_USER,pass:env.SMTP_PASS}:undefined,connectionTimeout:5000,greetingTimeout:5000,socketTimeout:10000,dnsTimeout:5000,disableFileAccess:true,disableUrlAccess:true};
}
function configured(){try{return !!configuration();}catch{return false;}}
function message({email,workspace_name,role,invitation_url,expires_at},env=process.env){
  const label=roleNames[role];
  const expiry=new Date(expires_at).toUTCString();
  return {from:{name:env.SMTP_FROM_NAME || 'Ciftron',address:env.SMTP_FROM},to:{address:email},subject:`Join ${workspace_name} on Ciftron`,text:`You have been invited to join ${workspace_name} on Ciftron as ${label}.\n\nAccept your invitation: ${invitation_url}\n\nUse ${email} to create your account. This single-use invitation expires ${expiry}.\n\nIf you were not expecting this invitation, you can ignore this email.`,html:`<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f4f8f8;font-family:Arial,sans-serif;color:#19292a"><main style="max-width:560px;margin:auto;background:#fff;border:1px solid #dfe8e8;border-radius:16px;padding:36px"><div style="font-size:26px;font-weight:bold">ciftron<span style="color:#00ae9e">.</span></div><h1 style="font-size:24px;margin:32px 0 16px">Your team is ready for you.</h1><p style="line-height:1.7">You have been invited to join <strong>${escape(workspace_name)}</strong> as ${escape(label)}.</p><p style="line-height:1.7">Create your account using <strong>${escape(email)}</strong>.</p><a href="${escape(invitation_url)}" style="display:inline-block;background:#00b6a5;color:#052a28;padding:15px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">Join workspace</a><p style="font-size:12px;line-height:1.7;color:#657779">This single-use invitation expires ${escape(expiry)}. If the button does not work, copy this link:</p><p style="font-size:12px;overflow-wrap:anywhere">${escape(invitation_url)}</p><p style="font-size:12px;line-height:1.7;color:#657779">If you were not expecting this invitation, you can ignore this email.</p></main></body></html>`,disableFileAccess:true,disableUrlAccess:true};
}
async function sendInvitation(invitation){
  let transport;
  try{
    const options=configuration();
    if(!options)return {status:'not_configured',message:'Email delivery is not connected. Share the invitation link directly.'};
    transport=nodemailer.createTransport(options);
    const result=await transport.sendMail(message(invitation));
    if(!result.accepted?.length || result.rejected?.length)throw new Error('Recipient was not accepted.');
    return {status:'sent',message:'Invitation email accepted by the mail server.',message_id:result.messageId};
  }catch(error){console.error('Invitation email delivery failed:',error.code || 'SMTP_SEND_FAILED');return {status:'failed',message:'The invitation email could not be sent. Your link is still valid; share it directly or create a new invitation to retry.'};}
  finally{transport?.close();}
}
async function verify(){const options=configuration();if(!options)throw new Error('Configure invitation SMTP settings first.');const transport=nodemailer.createTransport(options);try{await transport.verify();return {configured:true,verified:true};}finally{transport.close();}}
module.exports={configured,configuration,message,sendInvitation,verify};
