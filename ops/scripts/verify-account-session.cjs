const fs = require('fs');
const crypto = require('crypto');
const origin = process.argv[2];
const accountRoot = process.argv[3];
if (!origin || !accountRoot?.startsWith('/www/wwwroot/miningqwqlogin-releases/')) throw Error('Explicit QA target required');
const email = 'codex-deploy-' + crypto.randomBytes(8).toString('hex') + '@example.test';
const password = 'Aa1!' + crypto.randomBytes(24).toString('base64url');
const cookies = new Map();
let token = null;
let createdId = null;
const checks=[];

function qaDatabase() {
  const envText=fs.readFileSync(accountRoot+'/.env','utf8');
  const match=envText.match(/^DATABASE_URL=(.*)$/m);
  if(!match) throw Error('Cannot locate account database for QA');
  process.env.DATABASE_URL=match[1].trim().replace(/^['"]|['"]$/g,'');
  const {PrismaClient}=require(accountRoot+'/node_modules/@prisma/client');
  return new PrismaClient();
}

async function api(path, method='GET', body, authenticated=true) {
  const headers = { 'content-type':'application/json', 'user-agent':'Echo deployment health check' };
  if(authenticated && token) headers.authorization='Bearer '+token;
  if(cookies.size) headers.cookie=[...cookies.entries()].map(([key,value])=>key+'='+value).join('; ');
  const response=await fetch(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  for(const cookie of response.headers.getSetCookie()) {
    const [pair]=cookie.split(';'); const at=pair.indexOf('='); cookies.set(pair.slice(0,at),pair.slice(at+1));
  }
  const payload=await response.json();
  if(!response.ok || payload.code!==0) throw Error(path+' failed HTTP '+response.status+' code '+payload.code);
  checks.push({path,method,status:response.status});
  return {data:payload.data,headers:response.headers};
}

(async()=>{
  try {
    const registered=await api('/api/account/auth/register','POST',{email,password,nickname:'Deployment QA'},false);
    createdId=registered.data.user.id; token=registered.data.accessToken;
    for (const [path, method] of [['/api/account/admin/mail', 'GET'], ['/api/account/admin/mail/verify', 'POST'],
      ['/api/account/admin/membership', 'GET'], ['/api/account/admin/membership/applications', 'GET'],
      ['/api/account/admin/membership/audit', 'GET'], ['/api/account/admin/membership/mail', 'GET']]) {
      const denied = await fetch(origin + path, { method, headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10000) });
      if (denied.status !== 403 || denied.headers.get('cache-control') !== 'no-store') throw Error('Mail administrator permission check failed');
      const anonymous = await fetch(origin + path, { method, signal: AbortSignal.timeout(10000) });
      if (anonymous.status !== 401) throw Error('Mail administrator endpoint accepts unauthenticated access');
    }
    console.log('MAIL_ADMINISTRATOR_BOUNDARY_REGRESSION_PASSED');
    const applicationState = await api('/api/account/membership/application');
    if (applicationState.data.emailVerifiedAt !== null || applicationState.data.application !== null) {
      throw Error('New account inherited verification/application state');
    }
    const loginConfig = await api('/api/account/auth/email', 'GET', undefined, false);
    if (loginConfig.data.codeLength !== 6 || loginConfig.data.expiresInSeconds !== 600) throw Error('Email login contract failed');
    const invalidOtp = await fetch(origin + '/api/account/auth/email/verify', {method: 'POST',
      headers: {'content-type':'application/json',origin}, body: JSON.stringify({challengeId:crypto.randomUUID(),code:'000000'}),
      signal:AbortSignal.timeout(10000)});
    if (invalidOtp.status !== 400 || invalidOtp.headers.get('set-cookie')) throw Error('Invalid OTP created a session');
    const crossSiteOtp = await fetch(origin + '/api/account/auth/email/verify', {method:'POST',
      headers:{'content-type':'application/json',origin:'https://other.example.test'},
      body:JSON.stringify({challengeId:crypto.randomUUID(),code:'000000'}),signal:AbortSignal.timeout(10000)});
    if (crossSiteOtp.status !== 403 || (await crossSiteOtp.json()).code !== 5207) throw Error('Cross-site OTP request accepted');
    console.log('MEMBERSHIP_APPLICATION_AND_EMAIL_LOGIN_BOUNDARIES_VERIFIED');
    if(!registered.headers.get('set-cookie')?.includes('HttpOnly')) throw Error('Refresh cookie is not HttpOnly');

    const originalCookie=[...cookies.entries()].map(([key,value])=>key+'='+value).join('; ');
    for(let i=0;i<3;i++){
      const probe=await fetch(origin+'/api/music/track/186016/quality-options',{headers:{cookie:originalCookie,authorization:'Bearer deliberately-expired'},signal:AbortSignal.timeout(30000)});
      if(probe.status!==200||probe.headers.get('set-cookie'))throw Error('Music permission probe changed or rejected the session');
    }
    const renewed=await api('/api/account/auth/refresh','POST',{},false); token=renewed.data.accessToken;
    const stale=await fetch(origin+'/api/account/auth/refresh',{method:'POST',headers:{cookie:originalCookie},signal:AbortSignal.timeout(15000)});
    if(stale.status!==401||stale.headers.get('set-cookie'))throw Error('Stale refresh erases newer cookie');
    const recovered=await api('/api/account/auth/refresh','POST',{},false); token=recovered.data.accessToken;
    console.log('COOKIE_CHAIN_REGRESSION_PASSED');
    const me=await api('/api/account/auth/me');
    if(me.data.user.id!==createdId) throw Error('Wrong account identity');
    const search=await api('/api/music/search?q=%E6%99%B4%E5%A4%A9&page=1&pageSize=1');
    const track=search.data.items[0];
    // Exercise the actual authorized playback path, not only the permission probe.
    // Use one recently successful track if available; never print listening history,
    // the returned signed URL, the disposable token or database configuration.
    let playbackTrackId=track.id;
    try {
      const fd=fs.openSync('/www/wwwlogs/www.echo.miningqwq.cn.log','r');
      let log;
      try {
        const size=fs.fstatSync(fd).size, length=Math.min(size,1000000), buffer=Buffer.alloc(length);
        fs.readSync(fd,buffer,0,length,size-length); log=buffer.toString('utf8');
      } finally { fs.closeSync(fd); }
      const recent=[...log.matchAll(/GET \/api\/music\/track\/([0-9]+)\/play-url[^ ]* HTTP\/[^\"]+" 200/g)];
      if(recent.length) playbackTrackId=recent[recent.length-1][1];
    } catch { /* A new installation can use the search result instead. */ }
    const membershipDb=qaDatabase();
    try {
      const disposable=await membershipDb.user.findFirst({where:{id:createdId,email}});
      if(!disposable) throw Error('Disposable playback QA identity missing');
      await membershipDb.playbackAuthorization.create({data:{userId:createdId,source:'manual',status:'active',membershipKind:'timed',
        memberNumber:1000000000+crypto.randomInt(100000000),expiresAt:new Date(Date.now()+300000)}});
      const started=Date.now();
      const playback=await api('/api/music/track/'+encodeURIComponent(playbackTrackId)+'/play-url?level=exhigh');
      if(!playback.data.url||playback.data.authorizationScope!=='authorized') throw Error('Authorized playback address missing');
      console.log('REAL_AUTHORIZED_PLAYBACK_PASSED',JSON.stringify({elapsedMs:Date.now()-started,preview:playback.data.preview}));
      const officialPath = '/api/music/track/1926623288/play-url?level=jymaster';
      const cold = (await api(officialPath)).data;
      if (!cold.url || cold.preview || cold.resolvedVia !== 'primary' || cold.level !== 'exhigh' || cold.requestedLevel !== 'jymaster') {
        throw Error('Complete official audio or immediate downgraded quality missing');
      }
      await api('/api/music/track/1926623288/quality-options');
      const warm = (await api(officialPath)).data;
      if (warm.level !== cold.level || warm.requestedLevel !== cold.requestedLevel || warm.resolvedVia !== 'primary') {
        throw Error('Opening the quality menu changed playback resolution');
      }
      const limited = (await api('/api/music/track/108485/play-url?level=exhigh')).data;
      if (!limited.url || limited.preview || limited.resolvedVia !== 'unblock') throw Error('Incomplete official audio did not recover through matching');
      if (limited.level !== 'exhigh' || limited.requestedLevel !== 'exhigh') throw Error('URL-only unblock quality was not filled from the requested tier');
      const jiangnan = (await api('/api/music/track/108914/play-url?level=hires')).data;
      if (!jiangnan.url || jiangnan.preview || !jiangnan.level || jiangnan.requestedLevel !== 'hires') throw Error('Jiangnan playback quality report is missing');
      if (jiangnan.resolvedVia === 'unblock' && jiangnan.level !== 'hires') throw Error('Jiangnan URL-only matching result did not preserve the requested tier');
      console.log('JIANGNAN_QUALITY_REPORT_VERIFIED', JSON.stringify({level:jiangnan.level,requestedLevel:jiangnan.requestedLevel,resolvedVia:jiangnan.resolvedVia}));
      console.log('OFFICIAL_FIRST_AND_IMMEDIATE_QUALITY_VERIFIED');
      await api('/api/music/search?q='+encodeURIComponent('播放验收')+'&page=1&pageSize=1');
      console.log('SEARCH_AFTER_PLAYBACK_PASSED');
    } finally { await membershipDb.$disconnect(); }
    await api('/api/account/library/favorites','POST',{track});
    const snapshot=await api('/api/account/library/snapshot');
    if(!snapshot.data.favorites[track.id]) throw Error('Favorite did not persist');
    if(snapshot.headers.get('cache-control')!=='no-store') throw Error('Private data lacks no-store');
    const refresh=await api('/api/account/auth/refresh','POST',{},false);
    token=refresh.data.accessToken;
    await api('/api/account/auth/me');
    await api('/api/account/library/favorites/'+encodeURIComponent(track.id),'DELETE');
    const after=await api('/api/account/library/snapshot');
    if(after.data.favorites[track.id]) throw Error('Favorite deletion did not persist');
    await api('/api/account/auth/logout','POST',{});
    token=null;
    const loggedIn=await api('/api/account/auth/login','POST',{email,password},false);
    token=loggedIn.data.accessToken;
    await api('/api/account/auth/me');
    await api('/api/account/auth/logout','POST',{});
    console.log(JSON.stringify({registration:true,login:true,cookieRefresh:true,cloudFavoriteRoundTrip:true,cacheIsolation:true,checks},null,2));
  } finally {
    if(createdId) {
      // Clean up only this run's disposable QA account and its cascading session/library rows.
      const prisma=qaDatabase();
      try { const deleted=await prisma.user.deleteMany({where:{id:createdId,email}}); if(deleted.count!==1) throw Error('QA account cleanup failed'); console.log('Disposable QA account and related data removed'); }
      finally {await prisma.$disconnect();}
    }
  }
})().catch(error=>{console.error(error.message);process.exitCode=1});
