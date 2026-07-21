import { access, friendlyDatabaseError, getSupabase, json, verify } from './_lib.js';

export default async function handler(req,res){
  if(req.method!=='POST') return json(res,405,{error:'Method not allowed.'});
  try{access(req);}catch{return json(res,401,{error:'Your access session expired.'});}

  let attempt;
  try{attempt=verify(req.body?.attempt_token);}catch{return json(res,401,{error:'This attempt is no longer valid.'});}
  if(attempt.type!=='friendship-run-attempt') return json(res,401,{error:'Invalid attempt.'});

  const score=Number(req.body?.score);
  const duration=Number(req.body?.duration_ms);
  if(!Number.isInteger(score)||score<0||score>896||!Number.isFinite(duration)||duration<1000) return json(res,400,{error:'Invalid score data.'});
  const elapsed=Math.max(duration,Date.now()-attempt.started_at-5000);
  const theoreticalMax=Math.floor(elapsed/52)+4;
  if(score>theoreticalMax) return json(res,400,{error:'The score could not be verified.'});

  try{
    const supabase=getSupabase();
    const {data:player,error:readError}=await supabase.from('friendship_run_players').select('*').eq('id',attempt.player_id).single();
    if(readError||!player) return json(res,404,{error:'Player entry not found.'});
    if(player.current_attempt_nonce!==attempt.nonce) return json(res,409,{error:'A newer paid attempt has already been registered for this student ID.'});
    if(player.attempt_used) return json(res,409,{error:'This attempt has already been submitted.'});

    const update=await supabase.from('friendship_run_players').update({
      score,
      best_score:score,
      attempt_used:true,
      attempt_finished_at:new Date().toISOString(),
      duration_ms:Math.round(duration),
      updated_at:new Date().toISOString()
    }).eq('id',player.id).eq('attempt_used',false).eq('current_attempt_nonce',attempt.nonce).select().single();
    if(update.error) throw update.error;

    const {count,error:rankError}=await supabase
      .from('friendship_run_players')
      .select('*',{count:'exact',head:true})
      .eq('attempt_used',true)
      .gt('best_score',score);
    if(rankError) throw rankError;

    if(attempt.payment_id){
      const paymentUpdate=await supabase.from('friendship_run_payments').update({score,duration_ms:Math.round(duration),completed_at:new Date().toISOString()}).eq('id',attempt.payment_id);
      if(paymentUpdate.error) throw paymentUpdate.error;
    }

    return json(res,200,{ok:true,rank:(count||0)+1});
  }catch(error){
    console.error('Friendship Run score error:',error);
    return json(res,500,{error:friendlyDatabaseError(error)});
  }
}
