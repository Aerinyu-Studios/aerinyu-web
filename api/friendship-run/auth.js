import { access, json, safeEqual, sign } from './_lib.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method==='GET'){
    try{access(req);return json(res,200,{ok:true});}catch{return json(res,401,{error:'Please enter the event password again.'});}
  }
  if(req.method!=='POST') return json(res,405,{error:'Method not allowed.'});
  if(!process.env.FRIENDSHIP_RUN_PASSWORD) return json(res,500,{error:'Event password is not configured.'});
  if(!safeEqual(req.body?.password,process.env.FRIENDSHIP_RUN_PASSWORD)) return json(res,401,{error:'Incorrect event password.'});
  return json(res,200,{token:sign({type:'friendship-run-access'})});
}
