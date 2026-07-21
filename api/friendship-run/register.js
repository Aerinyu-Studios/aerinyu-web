import crypto from 'node:crypto';
import { access, clean, friendlyDatabaseError, getSupabase, json, safeEqual, sign } from './_lib.js';

export default async function handler(req,res){
  if(req.method!=='POST') return json(res,405,{error:'Method not allowed.'});
  try{access(req);}catch{return json(res,401,{error:'Your access session expired.'});}

  try{
    const supabase=getSupabase();
    const name=clean(req.body?.name,70);
    const studentId=clean(req.body?.student_id,40);
    if(name.length<2||studentId.length<3) return json(res,400,{error:'Enter a valid name and student ID.'});
    if(req.body?.consent!==true) return json(res,400,{error:'Scoreboard consent is required.'});
    if(!process.env.FRIENDSHIP_RUN_STAFF_PIN||!safeEqual(req.body?.staff_pin,process.env.FRIENDSHIP_RUN_STAFF_PIN)) return json(res,403,{error:'The staff payment PIN is incorrect.'});

    const normalized=studentId.toUpperCase().replace(/\s+/g,'');
    const {data:existing,error:existingError}=await supabase
      .from('friendship_run_players')
      .select('*')
      .eq('student_id_normalized',normalized)
      .maybeSingle();
    if(existingError) throw existingError;

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
      if(upload.error) throw upload.error;
      photoUrl=supabase.storage.from('friendship-run-photos').getPublicUrl(path).data.publicUrl;
    }

    const nonce=crypto.randomUUID();
    const attemptStartedAt=new Date().toISOString();
    const payload={
      name,
      student_id:studentId,
      student_id_normalized:normalized,
      photo_url:photoUrl,
      payment_confirmed:true,
      score:null,
      best_score:0,
      duration_ms:null,
      attempt_used:false,
      attempt_started_at:attemptStartedAt,
      attempt_finished_at:null,
      current_attempt_nonce:nonce,
      updated_at:new Date().toISOString()
    };

    let player;
    if(existing){
      const updated=await supabase.from('friendship_run_players').update(payload).eq('id',existing.id).select().single();
      if(updated.error) throw updated.error;
      player=updated.data;
    }else{
      const inserted=await supabase.from('friendship_run_players').insert(payload).select().single();
      if(inserted.error) throw inserted.error;
      player=inserted.data;
    }

    const top=await supabase
      .from('friendship_run_players')
      .select('best_score')
      .eq('attempt_used',true)
      .order('best_score',{ascending:false})
      .limit(1)
      .maybeSingle();
    if(top.error) throw top.error;

    const attemptToken=sign({type:'friendship-run-attempt',player_id:player.id,nonce,started_at:Date.now()},60*30);
    return json(res,200,{
      player:{id:player.id,name:player.name,photo_url:player.photo_url},
      top_score:top.data?.best_score||0,
      attempt_token:attemptToken
    });
  }catch(error){
    console.error('Friendship Run registration error:',error);
    return json(res,500,{error:friendlyDatabaseError(error)});
  }
}
