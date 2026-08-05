import crypto from 'node:crypto';
import { clean, friendlyDatabaseError, getSupabase, json, safeEqual } from '../../lib/friendship-run.js';

function adminAccess(req){
  const key=req.headers['x-admin-key'];
  if(!process.env.ADMIN_KEY||!safeEqual(key,process.env.ADMIN_KEY)) throw new Error('UNAUTHORIZED');
}
const intInRange=(value,fallback,min=1000,max=120000)=>{const parsed=Number(value);return Number.isInteger(parsed)&&parsed>=min&&parsed<=max?parsed:fallback};

async function uploadAnnouncementImage(supabase,dataUrl){
  const match=/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(String(dataUrl||''));
  if(!match) throw new Error('INVALID_ANNOUNCEMENT_IMAGE');
  const buffer=Buffer.from(match[2],'base64');
  if(buffer.length>3*1024*1024) throw new Error('ANNOUNCEMENT_IMAGE_TOO_LARGE');
  const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[match[1]];
  const path=`${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.${ext}`;
  const upload=await supabase.storage.from('friendship-run-announcements').upload(path,buffer,{contentType:match[1],upsert:false});
  if(upload.error) throw upload.error;
  const imageUrl=supabase.storage.from('friendship-run-announcements').getPublicUrl(path).data.publicUrl;
  return {image_path:path,image_url:imageUrl};
}

function paymentTotals(payments){
  const boothPayments=payments.filter(p=>p.attempt_type==='official'&&p.eligibility_source==='booth_payment');
  const sum=rows=>rows.reduce((total,row)=>total+Number(row.amount_collected||0),0);
  const station=id=>{
    const rows=payments.filter(p=>Number(p.booth_id||1)===id);
    const paid=rows.filter(p=>p.attempt_type==='official'&&p.eligibility_source==='booth_payment');
    return {records:rows.length,funds:sum(paid),cash:sum(paid.filter(p=>p.payment_method==='cash')),digital:sum(paid.filter(p=>p.payment_method==='digital')),run_signups:rows.filter(p=>p.eligibility_source==='run_signup').length,free_trials:rows.filter(p=>p.attempt_type==='trial').length,redeemed:rows.filter(p=>p.status==='redeemed').length,unused:rows.filter(p=>p.status==='unused').length};
  };
  const operators=new Map();
  payments.forEach(p=>{
    const key=p.operator_username||'unknown';
    const row=operators.get(key)||{username:key,name:p.operator_name||'Unknown staff',records:0,funds:0,cash:0,digital:0,run_signups:0,free_trials:0};
    row.records+=1; row.funds+=Number(p.amount_collected||0);
    if(p.payment_method==='cash') row.cash+=Number(p.amount_collected||0);
    if(p.payment_method==='digital') row.digital+=Number(p.amount_collected||0);
    if(p.eligibility_source==='run_signup') row.run_signups+=1;
    if(p.attempt_type==='trial') row.free_trials+=1;
    operators.set(key,row);
  });
  return {
    booth_funds:sum(boothPayments),cash_funds:sum(boothPayments.filter(p=>p.payment_method==='cash')),digital_funds:sum(boothPayments.filter(p=>p.payment_method==='digital')),
    booth_attempts:boothPayments.length,run_signup_attempts:payments.filter(p=>p.attempt_type==='official'&&p.eligibility_source==='run_signup').length,
    free_trials:payments.filter(p=>p.attempt_type==='trial').length,redeemed_codes:payments.filter(p=>p.status==='redeemed').length,
    unused_codes:payments.filter(p=>p.status==='unused').length,revoked_codes:payments.filter(p=>p.status==='revoked').length,expired_codes:payments.filter(p=>p.status==='expired').length,total_records:payments.length,
    by_booth:{1:station(1),2:station(2)},by_operator:[...operators.values()].sort((a,b)=>b.records-a.records)
  };
}

export default async function handler(req,res){
  try{adminAccess(req);}catch{return json(res,401,{error:'The admin key is incorrect.'});}
  try{
    const supabase=getSupabase();
    const type=clean(req.query?.type,30)||'player';
    const id=clean(req.query?.id,80);

    if(req.method==='GET'){
      const [playersResult,paymentsResult,auditResult,settingsResult,announcementsResult]=await Promise.all([
        supabase.from('friendship_run_players').select('*').order('updated_at',{ascending:false}),
        supabase.from('friendship_run_payments').select('*').order('created_at',{ascending:false}).limit(2000),
        supabase.from('friendship_run_audit_log').select('*').order('created_at',{ascending:false}).limit(3000),
        supabase.from('friendship_run_display_settings').select('*').eq('id',1).maybeSingle(),
        supabase.from('friendship_run_announcements').select('*').order('sort_order',{ascending:true}).order('created_at',{ascending:true})
      ]);
      for(const result of [playersResult,paymentsResult,auditResult,settingsResult,announcementsResult]) if(result.error) throw result.error;
      const players=playersResult.data||[];
      const playerByStudentId=new Map(players.map(player=>[
        String(player.student_id_normalized||player.student_id||'').toUpperCase().replace(/\s+/g,''),
        player
      ]));
      const payments=await Promise.all((paymentsResult.data||[]).map(async payment=>{
        const normalized=String(payment.student_id_normalized||payment.student_id||'').toUpperCase().replace(/\s+/g,'');
        const player=playerByStudentId.get(normalized);
        let proofUrl=null;
        if(payment.proof_path){
          const signed=await supabase.storage.from('friendship-run-payment-proofs').createSignedUrl(payment.proof_path,60*20);
          proofUrl=signed.data?.signedUrl||null;
        }
        return {
          ...payment,
          proof_url:proofUrl,
          player_name:player?.name||null,
          player_programme:player?.programme||null,
          player_id:player?.id||payment.player_id||null
        };
      }));
      return json(res,200,{entries:players,payments,audit:auditResult.data||[],totals:paymentTotals(payments),display_settings:settingsResult.data||null,announcements:announcementsResult.data||[]});
    }

    if(type==='display-settings'){
      if(req.method!=='PATCH') return json(res,405,{error:'Method not allowed.'});
      const body=req.body||{};
      const allowedModes=['cycle','logo','leaderboard','map','announcement'];
      const update={id:1,display_mode:allowedModes.includes(body.display_mode)?body.display_mode:'cycle',logo_duration_ms:intInRange(body.logo_duration_ms,3200),leaderboard_duration_ms:intInRange(body.leaderboard_duration_ms,12000),map_duration_ms:intInRange(body.map_duration_ms,9000),announcement_duration_ms:intInRange(body.announcement_duration_ms,9000),live_game_booth_1_enabled:body.live_game_booth_1_enabled!==false,live_game_booth_2_enabled:body.live_game_booth_2_enabled!==false,updated_at:new Date().toISOString()};
      const changed=await supabase.from('friendship_run_display_settings').upsert(update,{onConflict:'id'}).select().single();
      if(changed.error) throw changed.error;
      await supabase.from('friendship_run_audit_log').insert({event_type:'admin_display_settings_updated',metadata:update});
      return json(res,200,{settings:changed.data});
    }

    if(type==='announcement'){
      const body=req.body||{};
      if(req.method==='POST'){
        const title=clean(body.title,100),announcementBody=clean(body.body,500);
        if(!title||!announcementBody) return json(res,400,{error:'Announcement title and message are required.'});
        let image={image_path:null,image_url:null};
        if(body.image_data){
          try{image=await uploadAnnouncementImage(supabase,body.image_data)}catch(error){
            if(error.message==='INVALID_ANNOUNCEMENT_IMAGE') return json(res,400,{error:'Choose a valid JPG, PNG or WebP image.'});
            if(error.message==='ANNOUNCEMENT_IMAGE_TOO_LARGE') return json(res,400,{error:'Announcement image must be 3 MB or smaller.'});
            throw error;
          }
        }
        const insert={eyebrow:clean(body.eyebrow,50)||'EVENT UPDATE',title,body:announcementBody,is_active:body.is_active!==false,sort_order:Number.isInteger(Number(body.sort_order))?Number(body.sort_order):0,duration_ms:body.duration_ms?intInRange(body.duration_ms,9000):null,image_alt:clean(body.image_alt,120)||title,...image,updated_at:new Date().toISOString()};
        const created=await supabase.from('friendship_run_announcements').insert(insert).select().single();
        if(created.error) throw created.error;
        await supabase.from('friendship_run_audit_log').insert({event_type:'admin_announcement_created',metadata:{announcement_id:created.data.id,title,has_image:Boolean(image.image_path)}});
        return json(res,201,{announcement:created.data});
      }
      if(!id) return json(res,400,{error:'Announcement ID is required.'});
      if(req.method==='PATCH'){
        const existing=await supabase.from('friendship_run_announcements').select('*').eq('id',id).single();
        if(existing.error) throw existing.error;
        const update={updated_at:new Date().toISOString()};
        if('eyebrow'in body) update.eyebrow=clean(body.eyebrow,50)||'EVENT UPDATE';
        if('title'in body) update.title=clean(body.title,100);
        if('body'in body) update.body=clean(body.body,500);
        if('is_active'in body) update.is_active=Boolean(body.is_active);
        if('sort_order'in body) update.sort_order=Number.isInteger(Number(body.sort_order))?Number(body.sort_order):0;
        if('duration_ms'in body) update.duration_ms=body.duration_ms?intInRange(body.duration_ms,9000):null;
        if('image_alt'in body) update.image_alt=clean(body.image_alt,120);
        if(body.remove_image===true){
          if(existing.data.image_path) await supabase.storage.from('friendship-run-announcements').remove([existing.data.image_path]);
          update.image_path=null;update.image_url=null;
        }else if(body.image_data){
          const image=await uploadAnnouncementImage(supabase,body.image_data);
          if(existing.data.image_path) await supabase.storage.from('friendship-run-announcements').remove([existing.data.image_path]);
          Object.assign(update,image);
        }
        const changed=await supabase.from('friendship_run_announcements').update(update).eq('id',id).select().single();
        if(changed.error) throw changed.error;
        await supabase.from('friendship_run_audit_log').insert({event_type:'admin_announcement_updated',metadata:{announcement_id:id,fields:Object.keys(update)}});
        return json(res,200,{announcement:changed.data});
      }
      if(req.method==='DELETE'){
        const existing=await supabase.from('friendship_run_announcements').select('image_path').eq('id',id).maybeSingle();
        const removed=await supabase.from('friendship_run_announcements').delete().eq('id',id);
        if(removed.error) throw removed.error;
        if(existing.data?.image_path) await supabase.storage.from('friendship-run-announcements').remove([existing.data.image_path]);
        await supabase.from('friendship_run_audit_log').insert({event_type:'admin_announcement_deleted',metadata:{announcement_id:id}});
        return json(res,200,{ok:true});
      }
      return json(res,405,{error:'Method not allowed.'});
    }

    if(!id) return json(res,400,{error:'Record ID is required.'});
    if(type==='payment'){
      if(req.method==='DELETE') return json(res,405,{error:'Payment evidence is retained for audit. Revoke the record instead of deleting it.'});
      if(req.method==='PATCH'){
        const body=req.body||{},update={updated_at:new Date().toISOString()};
        if('status'in body&&['unused','redeemed','expired','revoked'].includes(body.status)) update.status=body.status;
        if('audit_note'in body) update.audit_note=clean(body.audit_note,240);
        if('booth_id'in body&&[1,2].includes(Number(body.booth_id))) update.booth_id=Number(body.booth_id);
        if('student_id'in body){update.student_id=clean(body.student_id,40);update.student_id_normalized=update.student_id.toUpperCase().replace(/\s+/g,'')}
        if(body.regenerate_code===true){
          let generated=null;
          for(let i=0;i<12;i+=1){const code=String(Math.floor(100000+Math.random()*900000));const test=await supabase.from('friendship_run_payments').select('id').eq('play_code',code).in('status',['unused','redeemed']).maybeSingle();if(!test.data){generated=code;break}}
          if(!generated) return json(res,500,{error:'Could not generate a unique code.'});
          Object.assign(update,{play_code:generated,status:'unused',redeemed_at:null,player_id:null,expires_at:new Date(Date.now()+30*60*1000).toISOString()});
        }
        const changed=await supabase.from('friendship_run_payments').update(update).eq('id',id).select().single();
        if(changed.error) throw changed.error;
        await supabase.from('friendship_run_audit_log').insert({event_type:'admin_payment_updated',payment_id:id,metadata:update});
        return json(res,200,{payment:changed.data});
      }
      return json(res,405,{error:'Method not allowed.'});
    }

    if(req.method==='DELETE'){
      const {error}=await supabase.from('friendship_run_players').delete().eq('id',id);if(error) throw error;return json(res,200,{ok:true});
    }
    if(req.method==='PATCH'){
      const body=req.body||{},update={updated_at:new Date().toISOString()};
      if('name'in body) update.name=clean(body.name,70);if('programme'in body) update.programme=clean(body.programme,60);if('message'in body) update.message=clean(body.message,180);
      if('student_id'in body){update.student_id=clean(body.student_id,40);update.student_id_normalized=update.student_id.toUpperCase().replace(/\s+/g,'')}
      if('best_score'in body){const score=Number(body.best_score);if(!Number.isInteger(score)||score<0||score>9999)return json(res,400,{error:'Enter a valid score.'});update.best_score=score;update.score=score}
      if('attempt_used'in body) update.attempt_used=Boolean(body.attempt_used);
      if(body.reset_attempt===true) Object.assign(update,{score:null,best_score:0,duration_ms:null,attempt_used:false,attempt_started_at:null,attempt_finished_at:null,current_attempt_nonce:null,current_payment_id:null,current_attempt_completed:true});
      const {data,error}=await supabase.from('friendship_run_players').update(update).eq('id',id).select().single();if(error) throw error;
      await supabase.from('friendship_run_audit_log').insert({event_type:'admin_player_updated',player_id:id,student_id_normalized:data.student_id_normalized,metadata:update});
      return json(res,200,{entry:data});
    }
    return json(res,405,{error:'Method not allowed.'});
  }catch(error){
    console.error('Friendship Run admin error:',error);
    if(error.message==='INVALID_ANNOUNCEMENT_IMAGE') return json(res,400,{error:'Choose a valid announcement image.'});
    if(error.message==='ANNOUNCEMENT_IMAGE_TOO_LARGE') return json(res,400,{error:'Announcement image must be 3 MB or smaller.'});
    return json(res,500,{error:friendlyDatabaseError(error)});
  }
}
