import { access, friendlyDatabaseError, getSupabase, json } from './_lib.js';
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET') return json(res,405,{error:'Method not allowed.'});
  try{access(req);}catch{return json(res,401,{error:'Your access session expired.'});}
  try {
    const supabase = getSupabase();
    const {data,error}=await supabase.from('friendship_run_players').select('name,photo_url,best_score,attempt_finished_at').eq('attempt_used',true).order('best_score',{ascending:false}).order('attempt_finished_at',{ascending:true}).limit(50);
    if(error) throw error;
    return json(res,200,{entries:(data||[]).map(row=>({name:row.name,photo_url:row.photo_url,score:row.best_score||0}))});
  } catch (error) {
    console.error('Friendship Run leaderboard error:', error);
    return json(res,500,{error:friendlyDatabaseError(error)});
  }
}
