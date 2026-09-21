const { createClient } = supabase;
const db = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

const state = {
  user: null, profile: null, services: [], selectedServices: new Set(),
  selectedDate: "", selectedTime: "", totalMinutes: 0, totalPrice: 0,
  hours: [], blocks: []
};

const $ = id => document.getElementById(id);
const money = v => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v||0));
const dateBR = d => new Date(d+"T12:00:00").toLocaleDateString("pt-BR");
function toast(msg){$("toast").textContent=msg;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),3000)}
function escapeHtml(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function today(){return new Date().toISOString().slice(0,10)}
function timeToMin(t){const [h,m]=t.split(":").map(Number);return h*60+m}
function minToTime(n){return String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0")}

async function init(){
  $("appointment-date").min=today(); $("appointment-date").value=today();
  $("admin-date").value=today();
  bindEvents();
  const {data:{session}}=await db.auth.getSession();
  if(session) await enterApp(session.user); else showAuth();
  db.auth.onAuthStateChange(async (_event, session)=>{ if(session) await enterApp(session.user); else showAuth(); });
}
function showAuth(){$("auth-view").classList.remove("hidden");$("app-view").classList.add("hidden")}
async function enterApp(user){
  state.user=user;
  const {data:profile,error}=await db.from("profiles").select("*").eq("id",user.id).single();
  if(error){toast(error.message);return}
  state.profile=profile;
  $("auth-view").classList.add("hidden");$("app-view").classList.remove("hidden");
  $("welcome").textContent=`Olá, ${profile.nome_completo}`;
  $("admin-nav").classList.toggle("hidden",profile.role!=="admin");
  await loadClient();
}
function bindEvents(){
  document.querySelectorAll("[data-auth-tab]").forEach(b=>b.onclick=()=>switchAuth(b.dataset.authTab));
  $("login-form").onsubmit=login;
  $("register-form").onsubmit=register;
  $("logout-btn").onclick=()=>db.auth.signOut();
  $("client-nav").onclick=showClient;
  $("admin-nav").onclick=showAdmin;
  $("appointment-date").onchange=async e=>{state.selectedDate=e.target.value;state.selectedTime="";await loadSlots()};
  $("book-btn").onclick=book;
  $("admin-refresh").onclick=loadAdminAppointments;
  $("new-service-btn").onclick=()=>serviceModal();
  $("new-block-btn").onclick=()=>blockModal();
  $("save-hours").onclick=saveHours;
  $("admin-new-appointment").onclick=adminAppointmentModal;
  document.querySelectorAll("[data-admin-tab]").forEach(b=>b.onclick=()=>switchAdminTab(b.dataset.adminTab));
  $("modal-close").onclick=closeModal;
}
function switchAuth(type){
  document.querySelectorAll("[data-auth-tab]").forEach(x=>x.classList.toggle("active",x.dataset.authTab===type));
  $("login-form").classList.toggle("hidden",type!=="login");$("register-form").classList.toggle("hidden",type!=="register");
}
async function login(e){
  e.preventDefault();
  const {error}=await db.auth.signInWithPassword({email:$("login-email").value,password:$("login-password").value});
  if(error) toast(error.message);
}
async function register(e){
  e.preventDefault();
  const name=$("register-name").value.trim(), phone=$("register-phone").value.trim();
  const {data,error}=await db.auth.signUp({email:$("register-email").value,password:$("register-password").value,
    options:{data:{nome_completo:name,telefone:phone}}});
  if(error){toast(error.message);return}
  if(data.user) toast("Conta criada. Se a confirmação de email estiver ativa, confirme seu email.");
}
async function loadClient(){
  showClient();
  await loadServices();
  await loadMyAppointments();
  state.selectedDate=$("appointment-date").value;
  await loadSlots();
}
function showClient(){
  $("client-view").classList.remove("hidden");$("admin-view").classList.add("hidden");
}
async function showAdmin(){
  if(state.profile?.role!=="admin") return;
  $("client-view").classList.add("hidden");$("admin-view").classList.remove("hidden");
  await loadAdminAppointments(); await loadAdminServices(); await loadHours(); await loadBlocks();
}
async function loadServices(){
  const {data,error}=await db.from("services").select("*").eq("ativo",true).order("nome");
  if(error){toast(error.message);return}
  state.services=data||[];renderServices();
}
function renderServices(){
  $("services-list").innerHTML=state.services.length?state.services.map(s=>`
    <div class="service-item">
      <label><input type="checkbox" data-service="${s.id}" ${state.selectedServices.has(s.id)?"checked":""}> <span>${escapeHtml(s.nome)}</span></label>
      <div class="service-meta">${s.duracao_minutos} min<br>${money(s.preco)}</div>
    </div>`).join(""):`<div class="empty">Nenhum serviço disponível.</div>`;
  document.querySelectorAll("[data-service]").forEach(x=>x.onchange=()=>{x.checked?state.selectedServices.add(x.dataset.service):state.selectedServices.delete(x.dataset.service);calculateTotals();loadSlots()});
  calculateTotals();
}
function calculateTotals(){
  state.totalMinutes=0;state.totalPrice=0;
  state.selectedServices.forEach(id=>{const s=state.services.find(x=>x.id===id);if(s){state.totalMinutes+=s.duracao_minutos;state.totalPrice+=Number(s.preco||0)}});
  $("total-duration").textContent=state.totalMinutes+" min";$("total-price").textContent=money(state.totalPrice);
  $("book-btn").disabled=!(state.selectedServices.size&&state.selectedTime&&state.selectedDate);
}
async function loadSlots(){
  const wrap=$("slots");
  if(!state.selectedDate){wrap.innerHTML="";return}
  if(!state.selectedServices.size){wrap.innerHTML='<div class="empty">Selecione ao menos um serviço.</div>';calculateTotals();return}
  const day=new Date(state.selectedDate+"T12:00:00").getDay();
  const hours=state.hours.length?state.hours:await getHours();
  const h=hours.find(x=>x.dia_semana===day&&x.ativo);
  if(!h){wrap.innerHTML='<div class="empty">Não atendemos neste dia.</div>';return}
  const {data:appointments}=await db.from("appointments").select("hora_inicio,hora_fim").eq("data",state.selectedDate).eq("status","agendado");
  const {data:blocks}=await db.from("blocked_periods").select("hora_inicio,hora_fim").eq("data",state.selectedDate);
  const now=new Date(), sameDay=state.selectedDate===today();
  const slots=[]; const step=15; const start=timeToMin(h.hora_inicio), end=timeToMin(h.hora_fim);
  for(let t=start;t+state.totalMinutes<=end;t+=step){
    const tEnd=t+state.totalMinutes;
    const conflict=(appointments||[]).some(a=>t<timeToMin(a.hora_fim)&&tEnd>timeToMin(a.hora_inicio))||(blocks||[]).some(a=>t<timeToMin(a.hora_fim)&&tEnd>timeToMin(a.hora_inicio));
    let past=false;if(sameDay){const n=now.getHours()*60+now.getMinutes();past=t<=n}
    const disabled=conflict||past;
    slots.push(`<button class="slot ${disabled?"disabled":""} ${state.selectedTime===minToTime(t)?"selected":""}" ${disabled?"disabled":""} data-slot="${minToTime(t)}">${minToTime(t)}</button>`);
  }
  wrap.innerHTML=slots.join("")||'<div class="empty">Não há horários disponíveis.</div>';
  document.querySelectorAll("[data-slot]").forEach(x=>x.onclick=()=>{state.selectedTime=x.dataset.slot;loadSlots();calculateTotals()});
}
async function getHours(){
  const {data}=await db.from("business_hours").select("*").order("dia_semana");state.hours=data||[];return state.hours;
}
async function book(){
  if(!state.selectedServices.size||!state.selectedTime)return;
  const ids=[...state.selectedServices];
  const {data,error}=await db.rpc("create_appointment",{p_date:state.selectedDate,p_start:state.selectedTime,p_service_ids:ids});
  if(error){toast(error.message);await loadSlots();return}
  toast("Agendamento confirmado!");
  await loadMyAppointments();state.selectedTime="";await loadSlots();
  if (data?.[0]?.appointment_id) {
  notifyWhatsApp(data[0].appointment_id, "confirmation");
}
async function loadMyAppointments(){
  const {data,error}=await db.from("appointments").select(`*, appointment_services(*, services(nome,duracao_minutos,preco))`).eq("cliente_id",state.user.id).order("data",{ascending:false}).order("hora_inicio",{ascending:false});
  if(error){toast(error.message);return}
  $("my-appointments").innerHTML=data?.length?data.map(a=>appointmentHtml(a,true)).join(""):'<div class="empty">Você ainda não possui agendamentos.</div>';
  document.querySelectorAll("[data-cancel-client]").forEach(b=>b.onclick=()=>cancelAppointment(b.dataset.cancelClient,false));
}
function appointmentHtml(a,client=false){
  const services=(a.appointment_services||[]).map(x=>x.services?.nome).filter(Boolean).join(", ");
  return `<div class="appointment"><div><strong>${dateBR(a.data)} às ${a.hora_inicio}</strong><br>${escapeHtml(services)}<br><small>Duração: ${a.duracao_total} min · ${money(a.valor_total)}</small></div><div class="actions"><span class="status">${a.status}</span>${a.status==="agendado"?`<button class="btn danger" ${client?`data-cancel-client="${a.id}"`:`data-cancel-admin="${a.id}"`}>Cancelar</button>`:""}</div></div>`;
}
async function cancelAppointment(id,admin=false){
  if(!confirm("Cancelar este agendamento?"))return;
  const {error}=await db.from("appointments").update({status:"cancelado"}).eq("id",id);
  if(error){toast(error.message);return}
  toast("Agendamento cancelado.");
  admin?loadAdminAppointments():loadMyAppointments();
  notifyWhatsApp(id,"cancellation");
}
async function loadAdminAppointments(){
  const date=$("admin-date").value||today();
  const {data,error}=await db.from("appointments").select(`*, profiles(nome_completo,telefone), appointment_services(*, services(nome))`).eq("data",date).order("hora_inicio");
  if(error){toast(error.message);return}
  $("admin-appointments-list").innerHTML=data?.length?`<div class="card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Horário</th><th>Cliente</th><th>Serviços</th><th>Status</th><th>Ações</th></tr></thead><tbody>${data.map(a=>`<tr><td>${a.hora_inicio}–${a.hora_fim}</td><td>${escapeHtml(a.profiles?.nome_completo||"")}<br><small>${escapeHtml(a.profiles?.telefone||"")}</small></td><td>${(a.appointment_services||[]).map(x=>escapeHtml(x.services?.nome||"")).join(", ")}</td><td>${a.status}</td><td><div class="actions">${a.status==="agendado"?`<button class="btn danger" data-cancel-admin="${a.id}">Cancelar</button>`:""}<button class="btn secondary" data-edit-admin="${a.id}">Editar</button></div></td></tr>`).join("")}</tbody></table></div></div>`:'<div class="empty">Nenhum agendamento nesta data.</div>';
  document.querySelectorAll("[data-cancel-admin]").forEach(b=>b.onclick=()=>cancelAppointment(b.dataset.cancelAdmin,true));
  document.querySelectorAll("[data-edit-admin]").forEach(b=>b.onclick=()=>adminAppointmentModal(b.dataset.editAdmin));
}
async function loadAdminServices(){
  const {data}=await db.from("services").select("*").order("nome");
  $("admin-services-list").innerHTML=`<div class="card"><div class="table-wrap"><table class="data-table"><thead><tr><th>Serviço</th><th>Duração</th><th>Preço</th><th>Ativo</th><th></th></tr></thead><tbody>${(data||[]).map(s=>`<tr><td>${escapeHtml(s.nome)}</td><td>${s.duracao_minutos} min</td><td>${money(s.preco)}</td><td>${s.ativo?"Sim":"Não"}</td><td><button class="btn secondary" data-edit-service="${s.id}">Editar</button></td></tr>`).join("")}</tbody></table></div></div>`;
  document.querySelectorAll("[data-edit-service]").forEach(b=>b.onclick=()=>serviceModal(b.dataset.editService));
}
async function serviceModal(id=null){
  let s={nome:"",descricao:"",duracao_minutos:30,preco:0,ativo:true};
  if(id){const {data}=await db.from("services").select("*").eq("id",id).single();s=data}
  openModal(`<h3>${id?"Editar":"Novo"} serviço</h3><form id="service-form" class="form-grid">
  <label>Nome<input id="s-name" value="${escapeHtml(s.nome)}" required></label>
  <label>Descrição<input id="s-desc" value="${escapeHtml(s.descricao||"")}"></label>
  <label>Duração (minutos)<input id="s-duration" type="number" min="5" step="5" value="${s.duracao_minutos}" required></label>
  <label>Preço<input id="s-price" type="number" min="0" step="0.01" value="${s.preco}" required></label>
  <label>Ativo<select id="s-active"><option value="true" ${s.ativo?"selected":""}>Sim</option><option value="false" ${!s.ativo?"selected":""}>Não</option></select></label>
  <button class="btn primary">Salvar</button></form>`);
  $("service-form").onsubmit=async e=>{e.preventDefault();const payload={nome:$("s-name").value.trim(),descricao:$("s-desc").value.trim(),duracao_minutos:Number($("s-duration").value),preco:Number($("s-price").value),ativo:$("s-active").value==="true"};let q=id?db.from("services").update(payload).eq("id",id):db.from("services").insert(payload);const {error}=await q;if(error){toast(error.message);return}closeModal();toast("Serviço salvo.");loadAdminServices();loadServices()}
}
async function loadHours(){
  const {data}=await db.from("business_hours").select("*").order("dia_semana");state.hours=data||[];
  const names=["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
  $("business-hours-list").innerHTML=names.map((n,i)=>{const h=state.hours.find(x=>x.dia_semana===i)||{hora_inicio:"08:00",hora_fim:"18:00",ativo:i>0&&i<6};return `<div class="day-row"><strong>${n}</strong><input type="time" data-h-start="${i}" value="${h.hora_inicio}"><input type="time" data-h-end="${i}" value="${h.hora_fim}"><label><input type="checkbox" data-h-active="${i}" ${h.ativo?"checked":""}> Ativo</label></div>`}).join("");
}
async function saveHours(){
  const rows=[];for(let i=0;i<7;i++)rows.push({dia_semana:i,hora_inicio:document.querySelector(`[data-h-start="${i}"]`).value,hora_fim:document.querySelector(`[data-h-end="${i}"]`).value,ativo:document.querySelector(`[data-h-active="${i}"]`).checked});
  for(const r of rows){const {error}=await db.from("business_hours").upsert(r,{onConflict:"dia_semana"});if(error){toast(error.message);return}}
  toast("Horários salvos.");await loadHours();await loadSlots();
}
async function loadBlocks(){
  const {data}=await db.from("blocked_periods").select("*").order("data").order("hora_inicio");
  $("blocks-list").innerHTML=(data||[]).length?`<div class="card"><table class="data-table"><thead><tr><th>Data</th><th>Período</th><th>Motivo</th><th></th></tr></thead><tbody>${data.map(b=>`<tr><td>${dateBR(b.data)}</td><td>${b.hora_inicio}–${b.hora_fim}</td><td>${escapeHtml(b.motivo||"")}</td><td><button class="btn danger" data-delete-block="${b.id}">Excluir</button></td></tr>`).join("")}</tbody></table></div>`:'<div class="empty">Nenhum bloqueio.</div>';
  document.querySelectorAll("[data-delete-block]").forEach(b=>b.onclick=async()=>{if(!confirm("Excluir bloqueio?"))return;await db.from("blocked_periods").delete().eq("id",b.dataset.deleteBlock);loadBlocks()});
}
function blockModal(){
  openModal(`<h3>Novo bloqueio</h3><form id="block-form" class="form-grid">
  <label>Data<input id="b-date" type="date" value="${today()}" required></label>
  <label>Início<input id="b-start" type="time" value="08:00" required></label>
  <label>Fim<input id="b-end" type="time" value="18:00" required></label>
  <label>Motivo<input id="b-reason" placeholder="Folga, feriado..."></label>
  <button class="btn primary">Salvar</button></form>`);
  $("block-form").onsubmit=async e=>{e.preventDefault();const {error}=await db.from("blocked_periods").insert({data:$("b-date").value,hora_inicio:$("b-start").value,hora_fim:$("b-end").value,motivo:$("b-reason").value});if(error){toast(error.message);return}closeModal();loadBlocks();toast("Bloqueio criado.")};
}
async function adminAppointmentModal(id=null){
  const {data:clients}=await db.from("profiles").select("id,nome_completo,telefone").eq("role","cliente").order("nome_completo");
  await loadServices();
  let a=null;
  if(id){const {data}=await db.from("appointments").select("*,appointment_services(service_id)").eq("id",id).single();a=data}
  const selected=new Set((a?.appointment_services||[]).map(x=>x.service_id));
  openModal(`<h3>${id?"Editar":"Novo"} agendamento</h3><form id="admin-appt-form" class="form-grid">
  <label>Cliente<select id="a-client">${(clients||[]).map(c=>`<option value="${c.id}" ${a?.cliente_id===c.id?"selected":""}>${escapeHtml(c.nome_completo)} — ${escapeHtml(c.telefone||"")}</option>`).join("")}</select></label>
  <label>Data<input id="a-date" type="date" value="${a?.data||today()}" required></label>
  <label>Horário<input id="a-time" type="time" value="${a?.hora_inicio||"08:00"} required></label>
  <div><strong>Serviços</strong>${state.services.map(s=>`<label style="display:flex;align-items:center;margin:8px 0"><input type="checkbox" data-a-service="${s.id}" ${selected.has(s.id)?"checked":""}> ${escapeHtml(s.nome)} — ${s.duracao_minutos} min</label>`).join("")}</div>
  <button class="btn primary">Salvar</button></form>`);
  $("admin-appt-form").onsubmit=async e=>{e.preventDefault();const ids=[...document.querySelectorAll("[data-a-service]:checked")].map(x=>x.dataset.aService);const payload={p_date:$("a-date").value,p_start:$("a-time").value,p_service_ids:ids,p_client_id:$("a-client").value,p_existing_id:id||null};const {data,error}=await db.rpc("admin_upsert_appointment",payload);if(error){toast(error.message);return}closeModal();toast("Agendamento salvo.");loadAdminAppointments();};
}
function switchAdminTab(name){
  document.querySelectorAll("[data-admin-tab]").forEach(b=>b.classList.toggle("active",b.dataset.adminTab===name));
  ["appointments","services","settings","blocks"].forEach(x=>$("admin-"+x).classList.toggle("hidden",x!==name));
}
function openModal(html){$("modal-content").innerHTML=html;$("modal").classList.remove("hidden")}
function closeModal(){$("modal").classList.add("hidden")}
async function notifyWhatsApp(id,type){
  try{
    await fetch(`${window.SUPABASE_URL}/functions/v1/whatsapp-notify`,{method:"POST",headers:{Authorization:`Bearer ${window.SUPABASE_ANON_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({appointment_id:id,type})});
  }catch(e){console.warn("WhatsApp:",e)}
}
init();
