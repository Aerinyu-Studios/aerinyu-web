import { createHmac } from 'node:crypto';
import { access, friendlyDatabaseError, getSupabase, json } from '../../lib/friendship-run.js';

const fallbackSettings = {
  id:1, display_mode:'cycle', logo_duration_ms:3200, leaderboard_duration_ms:12000,
  map_duration_ms:9000, announcement_duration_ms:9000,
  live_game_booth_1_enabled:true, live_trial_booth_1_enabled:true, live_game_booth_2_enabled:true, live_trial_booth_2_enabled:true
};

export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return json(res,405,{error:'Method not allowed.'});
  try{access(req);}catch{return json(res,401,{error:'Your access session expired.'});}

  try{
    const supabase=getSupabase();

    if(String(req.query?.realtime||'')==='1'){
      const boothId=[1,2].includes(Number(req.query?.booth))?Number(req.query.booth):1;
      const supabaseUrl=String(process.env.NEXT_PUBLIC_SUPABASE_URL||process.env.SUPABASE_URL||'').trim();
      const publishableKey=String(
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||
        process.env.SUPABASE_PUBLISHABLE_KEY||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||
        process.env.SUPABASE_ANON_KEY||''
      ).trim();
      if(!supabaseUrl||!publishableKey){
        return json(res,503,{error:'Realtime is not configured. Add a public Supabase URL and publishable key in Vercel.'});
      }
      const secret=String(process.env.FRIENDSHIP_RUN_TOKEN_SECRET||'friendship-run').trim();
      const suffix=createHmac('sha256',secret).update(`realtime-booth-${boothId}`).digest('hex').slice(0,24);

      const iceServers=[
        {urls:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']}
      ];
      const turnUrls=String(process.env.FRIENDSHIP_RUN_TURN_URLS||process.env.FRIENDSHIP_RUN_TURN_URL||'')
        .split(',').map(value=>value.trim()).filter(Boolean);
      if(turnUrls.length){
        iceServers.push({
          urls:turnUrls,
          username:String(process.env.FRIENDSHIP_RUN_TURN_USERNAME||'').trim(),
          credential:String(process.env.FRIENDSHIP_RUN_TURN_CREDENTIAL||'').trim()
        });
      }

      return json(res,200,{
        supabase_url:supabaseUrl,
        supabase_publishable_key:publishableKey,
        topic:`friendship-run-live-${boothId}-${suffix}`,
        booth_id:boothId,
        ice_servers:iceServers
      });
    }
    if(String(req.query?.display||'')==='1'){
      const [settingsResult,announcementsResult]=await Promise.all([
        supabase.from('friendship_run_display_settings').select('*').eq('id',1).maybeSingle(),
        supabase.from('friendship_run_announcements').select('*').eq('is_active',true).order('sort_order',{ascending:true}).order('created_at',{ascending:true})
      ]);
      if(settingsResult.error) throw settingsResult.error;
      if(announcementsResult.error) throw announcementsResult.error;
      return json(res,200,{settings:settingsResult.data||fallbackSettings,announcements:announcementsResult.data||[]});
    }

    if(String(req.query?.live||'')==='1'){
      const boothId=[1,2].includes(Number(req.query?.booth))?Number(req.query.booth):1;
      const [settingsResult,liveResult]=await Promise.all([
        supabase.from('friendship_run_display_settings').select('live_game_booth_1_enabled,live_trial_booth_1_enabled,live_game_booth_2_enabled,live_trial_booth_2_enabled').eq('id',1).maybeSingle(),
        supabase.from('friendship_run_live_games').select('*').eq('booth_id',boothId).maybeSingle()
      ]);
      if(settingsResult.error) throw settingsResult.error;
      if(liveResult.error) throw liveResult.error;
      const enabled=boothId===1?settingsResult.data?.live_game_booth_1_enabled!==false:settingsResult.data?.live_game_booth_2_enabled!==false;
      const trialEnabled=boothId===1?settingsResult.data?.live_trial_booth_1_enabled!==false:settingsResult.data?.live_trial_booth_2_enabled!==false;
      const row=liveResult.data;
      const fresh=row?.updated_at&&Date.now()-new Date(row.updated_at).getTime()<10000;
      const attemptAllowed=row?.attempt_type==='trial'?trialEnabled:enabled;
      if(row?.active&&(!fresh||!attemptAllowed)) await supabase.from('friendship_run_live_games').update({active:false}).eq('booth_id',boothId);
      return json(res,200,{booth_id:boothId,enabled,trial_enabled:trialEnabled,live_game:attemptAllowed&&row?.active&&fresh?row:null});
    }

    const {data,error}=await supabase.from('friendship_run_players')
      .select('name,programme,message,photo_url,best_score,attempt_finished_at')
      .eq('attempt_used',true).order('best_score',{ascending:false}).order('attempt_finished_at',{ascending:true}).limit(50);
    if(error) throw error;
    return json(res,200,{entries:(data||[]).map(row=>({name:row.name,programme:row.programme||'',message:row.message||'',photo_url:row.photo_url,score:row.best_score||0}))});
  }catch(error){
    console.error('Friendship Run leaderboard error:',error);
    return json(res,500,{error:friendlyDatabaseError(error)});
  }
}
