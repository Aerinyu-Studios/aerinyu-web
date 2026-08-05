const $ = selector => document.querySelector(selector);
let adminKey = sessionStorage.getItem('friendship_run_admin_key') || '';
let entries = [], payments = [], totals = {}, displaySettings = {}, announcements = [];
let announcementImageData = null;
let announcementRemoveImage = false;
const esc = (value='') => String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

async function api(path='',options={}){
  const response=await fetch(`/api/friendship-run/admin${path}`,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),'x-admin-key':adminKey,...(options.headers||{})}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||'Request failed.');
  return body;
}

async function displayApi(path='',options={}){
  const response=await fetch(`/api/friendship-run/admin${path}`,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),'x-admin-key':adminKey,...(options.headers||{})}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(body.error||'Display request failed.');
  return body;
}

function renderPlayers(){
  const query=$('#adminSearch').value.trim().toLowerCase();
  const filtered=entries.filter(e=>`${e.name} ${e.student_id}`.toLowerCase().includes(query));
  $('#adminEntries').innerHTML=filtered.length?filtered.map(entry=>`<article class="panel fr-admin-entry" data-id="${entry.id}">
    <div class="fr-admin-entry-main">${entry.photo_url?`<img class="admin-avatar" src="${esc(entry.photo_url)}" alt="">`:`<div class="admin-avatar fallback">${esc(entry.name?.[0]||'?')}</div>`}<div><strong>${esc(entry.name)}</strong><span>${esc(entry.student_id)}</span></div></div>
    <div class="fr-admin-meta"><span>Score <b>${entry.best_score??0}</b></span><span>${entry.attempt_used?'Submitted':'Open attempt'}</span></div>
    <div class="fr-admin-actions"><button class="button secondary" data-edit-player>Edit</button><button class="button secondary" data-reset-player>Reset attempt</button><button class="button danger" data-delete-player>Delete</button></div>
  </article>`).join(''):'<p class="empty-copy">No matching player entries.</p>';
  document.querySelectorAll('[data-edit-player]').forEach(b=>b.onclick=editPlayer);
  document.querySelectorAll('[data-reset-player]').forEach(b=>b.onclick=resetPlayer);
  document.querySelectorAll('[data-delete-player]').forEach(b=>b.onclick=deletePlayer);
}

function renderPayments(){
  const query=$('#adminSearch').value.trim().toLowerCase();
  const filtered=payments.filter(p=>`${p.student_id} ${p.play_code} ${p.status} ${p.operator_name||''}`.toLowerCase().includes(query));
  $('#adminPayments').innerHTML=filtered.length?filtered.slice(0,160).map(p=>`<article class="panel payment-entry" data-payment-id="${p.id}">
    <a class="payment-proof" href="${esc(p.proof_url||'#')}" target="_blank" rel="noopener">${p.proof_url?`<img src="${esc(p.proof_url)}" alt="Payment proof">`:'No proof required'}</a>
    <div class="payment-info"><strong>${esc(p.student_id)}</strong><span>Code <b>${esc(p.play_code)}</b> · Booth ${Number(p.booth_id||1)}</span><small>${new Date(p.created_at).toLocaleString()} · ${esc(p.operator_name||'Unknown staff')}</small></div>
    <div class="fr-admin-meta"><span>${esc(p.status)}</span><span>${esc(p.attempt_type==='trial'?'Free trial':p.eligibility_source==='run_signup'?'Run signup':p.payment_method||'Payment')}</span><span>MYR ${Number(p.amount_collected||0).toFixed(0)}</span></div>
    <div class="fr-admin-actions"><button class="button secondary" data-regenerate>New code</button><button class="button secondary" data-revoke>${p.status==='revoked'?'Restore':'Revoke'}</button></div>
  </article>`).join(''):'<p class="empty-copy">No matching payment records.</p>';
  document.querySelectorAll('[data-regenerate]').forEach(b=>b.onclick=regeneratePayment);
  document.querySelectorAll('[data-revoke]').forEach(b=>b.onclick=togglePayment);
}

function setText(selector,value){const el=$(selector);if(el)el.textContent=value;}
function renderStats(){
  const money=v=>`MYR ${Number(v||0).toFixed(0)}`;
  setText('#adminBoothFunds',money(totals.booth_funds));
  setText('#adminCashFunds',money(totals.cash_funds));
  setText('#adminDigitalFunds',money(totals.digital_funds));
  setText('#adminRunSignups',totals.run_signup_attempts||0);
  setText('#adminFreeTrials',totals.free_trials||0);
  setText('#adminCodes',totals.total_records||0);
  setText('#adminCashCount',`${payments.filter(p=>p.attempt_type==='official'&&p.eligibility_source==='booth_payment'&&p.payment_method==='cash').length} official attempts`);
  setText('#adminDigitalCount',`${payments.filter(p=>p.attempt_type==='official'&&p.eligibility_source==='booth_payment'&&p.payment_method==='digital').length} official attempts`);
  setText('#adminCodesDetail',`${totals.unused_codes||0} unused · ${totals.redeemed_codes||0} redeemed`);
}

function renderDisplaySettings(){
  const settings=displaySettings||{};
  $('#displayMode').value=settings.display_mode||'cycle';
  $('#logoDuration').value=Math.round(Number(settings.logo_duration_ms||3200)/1000);
  $('#leaderboardDuration').value=Math.round(Number(settings.leaderboard_duration_ms||12000)/1000);
  $('#mapDuration').value=Math.round(Number(settings.map_duration_ms||9000)/1000);
  $('#announcementDuration').value=Math.round(Number(settings.announcement_duration_ms||9000)/1000);
  $('#liveGameBooth1').checked=settings.live_game_booth_1_enabled!==false;
  $('#liveGameBooth2').checked=settings.live_game_booth_2_enabled!==false;
}

function renderAnnouncements(){
  setText('#announcementCount',announcements.length);
  $('#adminAnnouncements').innerHTML=announcements.length?announcements.map(item=>`<article class="admin-announcement-card ${item.is_active?'is-active':'is-paused'}" data-announcement-id="${item.id}">
    ${item.image_url?`<img class="admin-announcement-thumb" src="${esc(item.image_url)}" alt="">`:''}
    <div class="admin-announcement-status"><i></i><span>${item.is_active?'Live':'Hidden'}</span></div>
    <small>${esc(item.eyebrow||'EVENT UPDATE')}</small>
    <h4>${esc(item.title)}</h4>
    <p>${esc(item.body)}</p>
    <div class="admin-announcement-meta"><span>Order ${Number(item.sort_order||0)}</span><span>${item.duration_ms?`${Math.round(item.duration_ms/1000)} sec`:'Default time'}</span></div>
    <div class="admin-announcement-actions"><button class="button secondary" data-edit-announcement>Edit</button><button class="button ghost" data-toggle-announcement>${item.is_active?'Hide':'Show'}</button><button class="button danger" data-delete-announcement>Delete</button></div>
  </article>`).join(''):'<div class="announcement-empty"><strong>No announcements yet</strong><p>Add a message to include it in the automatic TV cycle.</p></div>';
  document.querySelectorAll('[data-edit-announcement]').forEach(button=>button.onclick=editAnnouncement);
  document.querySelectorAll('[data-toggle-announcement]').forEach(button=>button.onclick=toggleAnnouncement);
  document.querySelectorAll('[data-delete-announcement]').forEach(button=>button.onclick=deleteAnnouncement);
}

function render(){renderStats();renderDisplaySettings();renderAnnouncements();renderPlayers();renderPayments();}
async function load(){
  const data = await api();
  entries=data.entries||[];payments=data.payments||[];totals=data.totals||{};
  displaySettings=data.display_settings||{};announcements=data.announcements||[];
  render();
}

function resetAnnouncementForm(){
  $('#announcementForm').reset();
  $('#announcementId').value='';
  $('#announcementEyebrow').value='EVENT UPDATE';
  $('#announcementOrder').value='0';
  $('#announcementActive').checked=true;
  $('#announcementFormTitle').textContent='Add announcement';
  $('#announcementMessage').textContent='';
  announcementImageData=null;announcementRemoveImage=false;
  $('#announcementImage').value='';$('#announcementImageAlt').value='';
  $('#announcementImagePreviewImg').hidden=true;$('#announcementImagePreviewImg').removeAttribute('src');
  $('#announcementImagePreview span').hidden=false;
}

function editAnnouncement(event){
  const id=event.target.closest('[data-announcement-id]').dataset.announcementId;
  const item=announcements.find(row=>row.id===id);if(!item)return;
  $('#announcementId').value=item.id;
  $('#announcementEyebrow').value=item.eyebrow||'EVENT UPDATE';
  $('#announcementTitle').value=item.title||'';
  $('#announcementBody').value=item.body||'';
  $('#announcementOrder').value=Number(item.sort_order||0);
  $('#announcementSeconds').value=item.duration_ms?Math.round(item.duration_ms/1000):'';
  $('#announcementActive').checked=Boolean(item.is_active);
  $('#announcementImageAlt').value=item.image_alt||'';
  announcementImageData=null;announcementRemoveImage=false;
  if(item.image_url){$('#announcementImagePreviewImg').src=item.image_url;$('#announcementImagePreviewImg').hidden=false;$('#announcementImagePreview span').hidden=true}else{$('#announcementImagePreviewImg').hidden=true;$('#announcementImagePreview span').hidden=false}
  $('#announcementFormTitle').textContent='Edit announcement';
  $('#announcementForm').scrollIntoView({behavior:'smooth',block:'center'});
}
async function toggleAnnouncement(event){
  const id=event.target.closest('[data-announcement-id]').dataset.announcementId;
  const item=announcements.find(row=>row.id===id);if(!item)return;
  await displayApi(`?type=announcement&id=${id}`,{method:'PATCH',body:JSON.stringify({is_active:!item.is_active})});await load();
}
async function deleteAnnouncement(event){
  const id=event.target.closest('[data-announcement-id]').dataset.announcementId;
  if(!confirm('Delete this announcement?'))return;
  await displayApi(`?type=announcement&id=${id}`,{method:'DELETE'});resetAnnouncementForm();await load();
}

async function editPlayer(e){const id=e.target.closest('[data-id]').dataset.id,entry=entries.find(x=>x.id===id);const name=prompt('Player name',entry.name);if(name===null)return;const student_id=prompt('Student ID',entry.student_id);if(student_id===null)return;const score=prompt('Score',String(entry.best_score??0));if(score===null)return;await api(`?id=${id}`,{method:'PATCH',body:JSON.stringify({name,student_id,best_score:Number(score),attempt_used:true})});await load()}
async function resetPlayer(e){const id=e.target.closest('[data-id]').dataset.id;if(!confirm('Reset this attempt and score?'))return;await api(`?id=${id}`,{method:'PATCH',body:JSON.stringify({reset_attempt:true})});await load()}
async function deletePlayer(e){const id=e.target.closest('[data-id]').dataset.id;if(!confirm('Delete this player entry? Payment records will remain.'))return;await api(`?id=${id}`,{method:'DELETE'});await load()}
async function regeneratePayment(e){const id=e.target.closest('[data-payment-id]').dataset.paymentId;if(!confirm('Generate a new six-digit code and extend validity by 30 minutes?'))return;await api(`?type=payment&id=${id}`,{method:'PATCH',body:JSON.stringify({regenerate_code:true})});await load()}
async function togglePayment(e){const card=e.target.closest('[data-payment-id]'),p=payments.find(x=>x.id===card.dataset.paymentId);const status=p.status==='revoked'?'unused':'revoked';await api(`?type=payment&id=${p.id}`,{method:'PATCH',body:JSON.stringify({status})});await load()}
async function deletePayment(e){const id=e.target.closest('[data-payment-id]').dataset.paymentId;if(!confirm('Permanently delete this payment record and proof image?'))return;await api(`?type=payment&id=${id}`,{method:'DELETE'});await load()}

$('#displaySettingsForm')?.addEventListener('submit',async event=>{
  event.preventDefault();const message=$('#displaySettingsMessage');message.textContent='Applying...';
  try{
    const payload={display_mode:$('#displayMode').value,logo_duration_ms:Number($('#logoDuration').value)*1000,leaderboard_duration_ms:Number($('#leaderboardDuration').value)*1000,map_duration_ms:Number($('#mapDuration').value)*1000,announcement_duration_ms:Number($('#announcementDuration').value)*1000,live_game_booth_1_enabled:$('#liveGameBooth1').checked,live_game_booth_2_enabled:$('#liveGameBooth2').checked};
    const data=await displayApi('?type=display-settings',{method:'PATCH',body:JSON.stringify(payload)});displaySettings=data.settings;renderDisplaySettings();message.textContent='TV display updated.';
  }catch(error){message.textContent=error.message}
});

$('#announcementForm')?.addEventListener('submit',async event=>{
  event.preventDefault();const id=$('#announcementId').value;const message=$('#announcementMessage');message.textContent='Saving...';
  const seconds=$('#announcementSeconds').value;
  const payload={eyebrow:$('#announcementEyebrow').value,title:$('#announcementTitle').value,body:$('#announcementBody').value,sort_order:Number($('#announcementOrder').value||0),duration_ms:seconds?Number(seconds)*1000:null,is_active:$('#announcementActive').checked,image_alt:$('#announcementImageAlt').value,image_data:announcementImageData,remove_image:announcementRemoveImage};
  try{await displayApi(id?`?type=announcement&id=${id}`:'?type=announcement',{method:id?'PATCH':'POST',body:JSON.stringify(payload)});resetAnnouncementForm();await load();}catch(error){message.textContent=error.message}
});
$('#announcementImage')?.addEventListener('change', event=>{
  const file=event.target.files?.[0];
  if(!file) return;
  if(file.size>3*1024*1024){$('#announcementMessage').textContent='Image must be 3 MB or smaller.';event.target.value='';return;}
  const reader=new FileReader();
  reader.onload=()=>{
    announcementImageData=String(reader.result||'');announcementRemoveImage=false;
    $('#announcementImagePreviewImg').src=announcementImageData;$('#announcementImagePreviewImg').hidden=false;$('#announcementImagePreview span').hidden=true;
  };
  reader.readAsDataURL(file);
});
$('#removeAnnouncementImage')?.addEventListener('click',()=>{
  announcementImageData=null;announcementRemoveImage=true;$('#announcementImage').value='';
  $('#announcementImagePreviewImg').hidden=true;$('#announcementImagePreviewImg').removeAttribute('src');$('#announcementImagePreview span').hidden=false;
});
$('#announcementReset')?.addEventListener('click',resetAnnouncementForm);

$('#adminAuthForm').addEventListener('submit',async e=>{e.preventDefault();adminKey=$('#adminKey').value;$('#adminAuthMessage').textContent='Checking...';try{await load();sessionStorage.setItem('friendship_run_admin_key',adminKey);$('#adminAuth').hidden=true;$('#adminPanel').hidden=false}catch(error){$('#adminAuthMessage').textContent=error.message}});
$('#adminSearch')?.addEventListener('input',()=>{renderPlayers();renderPayments()});
$('#adminRefresh')?.addEventListener('click',load);
if(adminKey)load().then(()=>{$('#adminAuth').hidden=true;$('#adminPanel').hidden=false}).catch(()=>sessionStorage.removeItem('friendship_run_admin_key'));
