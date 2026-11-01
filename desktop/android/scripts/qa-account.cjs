const fs=require('fs'), crypto=require('crypto');
const {execFileSync}=require('child_process');
const email=process.argv[2], action=process.argv[3];
if(!/^android-qa-[a-f0-9]{32}@example\.test$/.test(email)) throw Error('Exact disposable identity required');
const pm2='/www/server/nvm/versions/node/v24.15.0/bin/pm2';
const runtime=JSON.parse(execFileSync(pm2,['jlist'],{encoding:'utf8'})).find(p=>p.name==='miningqwqlogin').pm2_env;
const envText=fs.readFileSync(runtime.pm_cwd+'/.env','utf8');
const database=envText.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g,'');
if(database!=='file:/www/wwwroot/miningqwqlogin/prisma/dev.db') throw Error('Unexpected database');
process.env.DATABASE_URL=database;
const {PrismaClient}=require(runtime.pm_cwd+'/node_modules/@prisma/client');
const db=new PrismaClient();
(async()=>{
 try{
  const user=await db.user.findUnique({where:{email}});
  if(!user && action==='cleanup') { console.log('QA_ACCOUNT_ABSENT'); return; }
  if(!user||user.nickname!=='Android Session QA') throw Error('QA identity missing');
  if(action==='cleanup') {
    const result=await db.user.deleteMany({where:{id:user.id,email,nickname:'Android Session QA'}});
    if(result.count!==1) throw Error('Cleanup failed');
    console.log('QA_ACCOUNT_REMOVED');return;
  }
  if(action!=='probe') throw Error('Unknown action');
  const authorization={status:'active',source:'manual',membershipKind:'timed',expiresAt:new Date(Date.now()+3600000)};
  await db.playbackAuthorization.upsert({where:{userId:user.id},create:{userId:user.id,...authorization},update:authorization});
  const token=crypto.randomBytes(48).toString('base64url');
  const probeSession=await db.userSession.create({data:{userId:user.id,refreshTokenHash:crypto.createHash('sha256').update(token).digest('hex'),expiresAt:new Date(Date.now()+300000),userAgent:'Android QA one-time probe'}});
  try{
    for(const id of ['186016','347230']) {
      const r=await fetch('https://echo.miningqwq.cn/api/music/track/'+id+'/play-url?level=standard',{headers:{cookie:'mqm_refresh_token='+token},signal:AbortSignal.timeout(25000)});
      const p=await r.json(), original=p.data?.url?new URL(p.data.url):null;
      let httpsStatus,httpsType;
      if(original) {
        const secured=new URL(original);secured.protocol='https:';
        try {const media=await fetch(secured,{headers:{Range:'bytes=0-31'},signal:AbortSignal.timeout(15000)});httpsStatus=media.status;httpsType=media.headers.get('content-type');await media.body?.cancel();}catch(e){httpsStatus=e.name;}
      }
      console.log(JSON.stringify({publicTrack:id,status:r.status,code:p.code,authorizationScope:p.data?.authorizationScope,originalProtocol:original?.protocol,host:original?.host,httpsStatus,httpsType}));
    }
  }finally{await db.userSession.delete({where:{id:probeSession.id}});}
 }finally{await db.$disconnect();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
