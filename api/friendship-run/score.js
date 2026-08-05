import { access, friendlyDatabaseError, getSupabase, json, verify } from '../../lib/friendship-run.js';

function validPoint(value, cells){
  const x=Number(value?.x), y=Number(value?.y);
  return Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<cells&&y<cells?{x,y}:null;
}

async function deactivateLiveGame(supabase, attempt){
  if(![1,2].includes(Number(attempt.booth_id))) return;
  await supabase.from('friendship_run_live_games').update({active:false,updated_at:new Date().toISOString()})
    .eq('booth_id',Number(attempt.booth_id)).eq('attempt_nonce',attempt.nonce);
}

export default async function handler(req,res){
  if(req.method!=='POST') return json(res,405,{error:'Method not allowed.'});
  try{access(req);}catch{return json(res,401,{error:'Your access session expired.'});}

  let attempt;
  try{attempt=verify(req.body?.attempt_token);}catch{return json(res,401,{error:'This attempt is no longer valid.'});}
  if(attempt.type!=='friendship-run-attempt') return json(res,401,{error:'Invalid attempt.'});

  try{
    const supabase=getSupabase();
    const action=String(req.body?.action||'submit');

    if(action==='live-update'){
      if(attempt.live_display!==true) return json(res,200,{ok:true,ignored:true});
      const boothId=Number(attempt.booth_id);
      if(![1,2].includes(boothId)) return json(res,400,{error:'Invalid booth display.'});

      const {data:player,error:playerError}=await supabase.from('friendship_run_players').select('id,name,programme,current_attempt_nonce,current_attempt_completed').eq('id',attempt.player_id).single();
      if(playerError||!player) return json(res,404,{error:'Player entry not found.'});
      if(player.current_attempt_nonce!==attempt.nonce||player.current_attempt_completed) return json(res,409,{error:'This attempt is no longer active.'});

      const settings=await supabase.from('friendship_run_display_settings').select('live_game_booth_1_enabled,live_game_booth_2_enabled').eq('id',1).maybeSingle();
      if(settings.error) throw settings.error;
      const enabled=boothId===1?settings.data?.live_game_booth_1_enabled!==false:settings.data?.live_game_booth_2_enabled!==false;
      if(!enabled){
        await deactivateLiveGame(supabase,attempt);
        return json(res,200,{ok:true,disabled:true});
      }

      const cells=Number(req.body?.cells);
      const score=Number(req.body?.score);
      const active=req.body?.active!==false;
      if(!Number.isInteger(cells)||cells<10||cells>40||!Number.isInteger(score)||score<0||score>896) return json(res,400,{error:'Invalid live game data.'});
      const rawSnake=Array.isArray(req.body?.snake)?req.body.snake:[];
      const snake=rawSnake.slice(0,cells*cells).map(point=>validPoint(point,cells)).filter(Boolean);
      const food=validPoint(req.body?.food,cells);
      if(active&&(!snake.length||!food)) return json(res,400,{error:'Incomplete live game data.'});

      const now=new Date().toISOString();
      const row={
        booth_id:boothId,player_id:player.id,attempt_nonce:attempt.nonce,player_name:player.name,
        programme:player.programme||'',score,cells,snake,food:food||{},active,
        started_at:new Date(attempt.started_at).toISOString(),updated_at:now
      };
      const upsert=await supabase.from('friendship_run_live_games').upsert(row,{onConflict:'booth_id'});
      if(upsert.error) throw upsert.error;
      return json(res,200,{ok:true,active});
    }

    const score=Number(req.body?.score);
    const duration=Number(req.body?.duration_ms);
    if(!Number.isInteger(score)||score<0||score>896||!Number.isFinite(duration)||duration<1000) return json(res,400,{error:'Invalid score data.'});
    const elapsed=Math.max(duration,Date.now()-attempt.started_at-5000);
    const theoreticalMax=Math.floor(elapsed/52)+4;
    if(score>theoreticalMax) return json(res,400,{error:'The score could not be verified.'});

    const {data:player,error:readError}=await supabase.from('friendship_run_players').select('*').eq('id',attempt.player_id).single();
    if(readError||!player) return json(res,404,{error:'Player entry not found.'});
    if(player.current_attempt_nonce!==attempt.nonce) return json(res,409,{error:'A newer attempt has already been registered for this student ID.'});
    if(player.current_attempt_completed) return json(res,409,{error:'This attempt has already been submitted.'});

    const finishedAt=new Date().toISOString();
    const common={current_attempt_completed:true,attempt_finished_at:finishedAt,duration_ms:Math.round(duration),updated_at:finishedAt};
    await deactivateLiveGame(supabase,attempt);

    if(attempt.attempt_type==='trial'){
      const update=await supabase.from('friendship_run_players').update(common).eq('id',player.id).eq('current_attempt_nonce',attempt.nonce).eq('current_attempt_completed',false).select().single();
      if(update.error) throw update.error;
      if(attempt.payment_id){
        const paymentUpdate=await supabase.from('friendship_run_payments').update({score,duration_ms:Math.round(duration),completed_at:finishedAt}).eq('id',attempt.payment_id);
        if(paymentUpdate.error) throw paymentUpdate.error;
      }
      await supabase.from('friendship_run_audit_log').insert({event_type:'trial_completed',payment_id:attempt.payment_id,player_id:player.id,student_id_normalized:player.student_id_normalized,metadata:{booth_id:attempt.booth_id,score,duration_ms:Math.round(duration),live_display:attempt.live_display===true}});
      return json(res,200,{ok:true,trial:true,rank:null});
    }

    const update=await supabase.from('friendship_run_players').update({...common,score,best_score:score,attempt_used:true}).eq('id',player.id).eq('current_attempt_nonce',attempt.nonce).eq('current_attempt_completed',false).select().single();
    if(update.error) throw update.error;
    const {count,error:rankError}=await supabase.from('friendship_run_players').select('*',{count:'exact',head:true}).eq('attempt_used',true).gt('best_score',score);
    if(rankError) throw rankError;
    if(attempt.payment_id){
      const paymentUpdate=await supabase.from('friendship_run_payments').update({score,duration_ms:Math.round(duration),completed_at:finishedAt}).eq('id',attempt.payment_id);
      if(paymentUpdate.error) throw paymentUpdate.error;
    }
    await supabase.from('friendship_run_audit_log').insert({event_type:'official_attempt_completed',payment_id:attempt.payment_id,player_id:player.id,student_id_normalized:player.student_id_normalized,metadata:{booth_id:attempt.booth_id,score,duration_ms:Math.round(duration),rank:(count||0)+1,live_display:attempt.live_display===true}});
    return json(res,200,{ok:true,trial:false,rank:(count||0)+1});
  }catch(error){
    console.error('Friendship Run score error:',error);
    return json(res,500,{error:friendlyDatabaseError(error)});
  }
}
