const fs = require('fs');
const crypto = require('crypto');
const origin = process.argv[2];
const accountRoot = process.argv[3];
if (!origin || !accountRoot?.startsWith('/www/wwwroot/miningqwqlogin-releases/')) throw Error('Explicit QA target required');
const email = 'codex-deploy-' + crypto.randomBytes(8).toString('hex') + '@example.invalid';
const password = 'Aa1!' + crypto.randomBytes(24).toString('base64url');
const cookies = new Map();
let token = null;
let createdId = null;
const checks=[];

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
      const envText=fs.readFileSync(accountRoot+'/.env','utf8');
      const match=envText.match(/^DATABASE_URL=(.*)$/m);
      if(!match) throw Error('Cannot locate account database for QA cleanup');
      process.env.DATABASE_URL=match[1].trim().replace(/^['"]|['"]$/g,'');
      const {PrismaClient}=require(accountRoot+'/node_modules/@prisma/client');
      const prisma=new PrismaClient();
      try { const deleted=await prisma.user.deleteMany({where:{id:createdId,email}}); if(deleted.count!==1) throw Error('QA account cleanup failed'); console.log('Disposable QA account and related data removed'); }
      finally {await prisma.$disconnect();}
    }
  }
})().catch(error=>{console.error(error.message);process.exitCode=1});
