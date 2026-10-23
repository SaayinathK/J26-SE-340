'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {googleOrigin}=require('../../src/services/googleOrigin');
test('Google sign-in origin accepts only an explicitly allowed frontend root origin',()=>{
  const previous={GOOGLE_SIGNIN_ORIGIN:process.env.GOOGLE_SIGNIN_ORIGIN,CLIENT_ORIGINS:process.env.CLIENT_ORIGINS};
  try{
    process.env.CLIENT_ORIGINS='http://localhost:5173,http://127.0.0.1:5173';
    delete process.env.GOOGLE_SIGNIN_ORIGIN;assert.equal(googleOrigin(),'');
    process.env.GOOGLE_SIGNIN_ORIGIN='http://localhost:5173/';assert.equal(googleOrigin(),'http://localhost:5173');
    for(const value of ['https://other.example','http://localhost:5173/path','http://localhost:5173?next=bad','http://user@localhost:5173','javascript:alert(1)']){process.env.GOOGLE_SIGNIN_ORIGIN=value;assert.throws(googleOrigin);}
  }finally{for(const[key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
