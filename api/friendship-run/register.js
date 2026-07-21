import crypto from 'node:crypto';
import { access, clean, json, safeEqual, sign, supabase } from './_lib.js';
export default async function handler(req,res){
  if(req.method!=='POST') return json(res,405,{error:'Method not allowed.'});
  try{access(req);}catch{return json(res,401,{error:'Your access session expired.'});}
  const name=clean(req.body?.name,70), studentId=clean(req.body?.student_id,40);
  if(name.length<2||studentId.length<3) return json(res,400,{error:'Enter a valid name and student ID.'});
  if(req.body?.consent!==true) return json(res,400,{error:'Scoreboard consent is required.'});
  if(!process.env.FRIENDSHIP_RUN_STAFF_PIN || !safeEqual(req.body?.staff_pin,process.env.FRIENDSHIP_RUN_STAFF_PIN)) return json(res,403,{error:'The staff payment PIN is incorrect.'});
  const normalized=studentId.toUpperCase().replace(/\s+/g,'');
  const {data:existing}=await supabase.from('friendship_run_players').select('id,name,best_score,attempt_used,photo_url').eq('student_id_normalized',normalized).maybeSingle();
  if(existing?.attempt_used) return json(res,409,{error:'This student ID has already used its official attempt.'});
  let photoUrl=existing?.photo_url||null;
  const photo=req.body?.photo_data;
  if(photo){
    const match=/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(photo);
    if(!match) return json(res,400,{error:'Invalid profile picture.'});
    const buffer=Buffer.from(match[2],'base64');
    if(buffer.length>400*1024) return json(res,400,{error:'Profile picture is too large.'});
    const ext={"image/jpeg":'jpg',"image/png":'png',"image/webp":'webp'}[match[1]];
    const path=`${crypto.randomUUID()}.${ext}`;
    const upload=await supabase.storage.from('friendship-run-photos').upload(path,buffer,{contentType:match[1],upsert:false});
    if(upload.error) return json(res,500,{error:'Could not upload the profile picture.'});
    photoUrl=supabase.storage.from('friendship-run-photos').getPublicUrl(path).data.publicUrl;
  }
  let player=existing;
  if(existing){
    const updated=await supabase.from('friendship_run_players').update({name,photo_url:photoUrl,payment_confirmed:true,attempt_started_at:new Date().toISOString()}).eq('id',existing.id).select().single();
    if(updated.error) throw updated.error; player=updated.data;
  }else{
    const inserted=await supabase.from('friendship_run_players').insert({name,student_id:studentId,student_id_normalized:normalized,photo_url:photoUrl,payment_confirmed:true,attempt_started_at:new Date().toISOString()}).select().single();
    if(inserted.error) throw inserted.error; player=inserted.data;
  }
  const attemptToken=sign({type:'friendship-run-attempt',player_id:player.id,nonce:crypto.randomUUID(),started_at:Date.now()},60*30);
  return json(res,200,{player:{id:player.id,name:player.name,photo_url:player.photo_url},best_score:player.best_score||0,attempt_token:attemptToken});
}
