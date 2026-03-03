// =============== STATE ===============
let currentLatLong = "";
let masterLocs = { asal: [], tujuan: [] };
let scanner;

function getUniqueId() {
  let id = localStorage.getItem('delivery_id');
  if (!id) {
    id = 'ID-' + Math.random().toString(36).substr(2, 9).toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
    localStorage.setItem('delivery_id', id);
  }
  return id;
}
const deviceId = getUniqueId();

// =============== API WRAPPER ===============
function qs(params){
  const url = new URL(BACKEND_BASE);
  Object.entries(params).forEach(([k,v])=>{ if(v!==undefined && v!==null) url.searchParams.set(k, v); });
  url.searchParams.set('t', Date.now());
  return url.toString();
}
async function apiGet(action, params={}){
  if(!BACKEND_BASE) throw new Error('BACKEND_BASE belum di-set di config.js');
  const res = await fetch(qs({action, ...params}), { method: 'GET', credentials: 'omit' });
  if(!res.ok) throw new Error('HTTP '+res.status);
  const ct = res.headers.get('content-type') || '';
  if(ct.includes('application/json')) return res.json();
  const txt = await res.text();
  try{ return JSON.parse(txt); }catch(e){ throw new Error('Respon tidak valid'); }
}

// =============== UTIL ===============
function haversine(lat1, lon1, lat2, lon2){
  if([lat1,lon1,lat2,lon2].some(v=>isNaN(v))) return Number.POSITIVE_INFINITY;
  const R = 6371e3; const toRad=x=>x*Math.PI/180; const dLat=toRad(lat2-lat1); const dLon=toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2; return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ======= ABSEN LOCK (per sesi di area) =======
function getAbsenLockKey(){ return `absen_lock_${NVDC_NAME}_${deviceId}`; }
function isAbsenLocked(){ return localStorage.getItem(getAbsenLockKey()) === '1'; }
function setAbsenLock(){ localStorage.setItem(getAbsenLockKey(), '1'); }
function clearAbsenLock(){ localStorage.removeItem(getAbsenLockKey()); }

// Ambil lokasi dari master berdasarkan nama
function getLocationByName(master, name){
  const nm = String(name).trim().toUpperCase();
  const a = (master.asal || []).find(it => String(it.nama).trim().toUpperCase() === nm);
  if (a) return a;
  const t = (master.tujuan || []).find(it => String(it.nama).trim().toUpperCase() === nm);
  return t || null;
}

// =============== GPS (status + hysteresis absen) ===============
function initGPS(){
  const el = document.getElementById('statusLoc');
  if(!navigator.geolocation){ el.innerText = "❌ GPS tidak didukung browser"; el.style.color = 'red'; return; }

  navigator.geolocation.watchPosition(p => {
    currentLatLong = p.coords.latitude + "," + p.coords.longitude;
    const accTxt = p.coords.accuracy ? ` (±${Math.round(p.coords.accuracy)}m)` : "";

    // Status GPS + nearest lokasi
    if (!masterLocs || (!masterLocs.asal?.length && !masterLocs.tujuan?.length)) {
      el.innerText = "✅ GPS Aktif" + accTxt; el.style.color = 'green';
    } else {
      const [lat, lng] = [p.coords.latitude, p.coords.longitude];
      // cari nearest untuk status (opsional: gabungan asal+tujuan)
      let nearestName = null, nearestDist = Infinity;
      for(const it of [...masterLocs.asal, ...masterLocs.tujuan]){
        if (isNaN(it.lat) || isNaN(it.lng)) continue;
        const d = haversine(lat, lng, it.lat, it.lng);
        if (d < nearestDist){ nearestDist = d; nearestName = it.nama; }
      }
      if (nearestName && nearestDist !== Infinity) {
        el.innerText = `✅ GPS Aktif${accTxt} – ${nearestName} (${Math.round(nearestDist)}m)`; el.style.color = 'green';
      } else {
        el.innerText = `✅ GPS Aktif${accTxt} – di luar lokasi yang terdaftar`; el.style.color = 'orange';
      }
    }

    // Hysteresis enable/disable tombol Absen
    const btnAbsen = document.getElementById('btn-absen');
    if (btnAbsen) {
      const nvdc = getLocationByName(masterLocs, NVDC_NAME);
      if (nvdc && currentLatLong) {
        const [lat, lng] = currentLatLong.split(',').map(Number);
        const dist = haversine(lat, lng, nvdc.lat, nvdc.lng);
        // keluar area => clear lock
        if (dist >= ABSEN_EXIT_RADIUS && isAbsenLocked()) { clearAbsenLock(); }
        // enable jika dalam ENTER dan belum lock
        const canAbsen = (dist <= ABSEN_ENTER_RADIUS) && !isAbsenLocked();
        btnAbsen.disabled = !canAbsen;
      } else {
        btnAbsen.disabled = true;
      }
    }
  }, err => {
    currentLatLong = ""; el.innerText = "❌ GPS Mati"; el.style.color = 'red';
  }, { enableHighAccuracy:true, timeout:10000, maximumAge:0 });
}

// =============== QR ===============
function startScan(){
  if(!currentLatLong) return alert('❌ GPS Belum Aktif!');
  const cont = document.getElementById('reader-container');
  cont.style.display = 'flex';
  scanner = new Html5Qrcode("reader");
  scanner.start({facingMode:{exact:"environment"}}, { fps: 15, qrbox: 250 }, (txt)=>{
    document.getElementById('sjkb').value = txt; stopScan(); submitProcess(txt);
  }).catch(()=>{ stopScan(); });
}
function stopScan(){
  const cont = document.getElementById('reader-container');
  if(scanner){ scanner.stop().then(()=>{ cont.style.display='none'; }).catch(()=>{ cont.style.display='none'; }); }
  else cont.style.display='none';
}

// =============== FLOW SUBMIT SJKB ===============
function manualSubmit(){
  const val = document.getElementById('sjkb').value.trim();
  if(!val) return alert('SJKB Kosong');
  submitProcess(val);
}
async function submitProcess(sjkb){
  const sjkbUp = sjkb.toUpperCase();
  if(!sjkbUp.startsWith('NVDCSTR')) return alert('❌ SJKB tidak sesuai!');
  if(sjkbUp.length !== 24) return alert('❌ SJKB tidak sesuai!');
  if(!currentLatLong) return alert('❌ Tunggu GPS Aktif!');

  document.getElementById('loading').style.display = 'flex';
  try{
    const history = await apiGet('getHistory', { deviceId });
    const dataLama = history.data.find(h=>h.sjkb === sjkbUp);
    if(dataLama && dataLama.status2 === 'Sampai'){
      document.getElementById('loading').style.display = 'none';
      return alert('❌ SJKB sudah berstatus SAMPAI.');
    }
    const [uLat, uLng] = currentLatLong.split(',').map(Number);
    let namaLokasi = null;
    const targetCheck = (dataLama && dataLama.status2 === 'Belum Sampai') ? masterLocs.tujuan : masterLocs.asal;
    for(const item of targetCheck){
      const d = haversine(uLat,uLng,item.lat,item.lng);
      if(d <= RADIUS_METERS){ namaLokasi = item.nama; break; }
    }
    if(!namaLokasi){ document.getElementById('loading').style.display = 'none'; return alert(`❌ Lokasi tidak terdaftar (Radius ${RADIUS_METERS}m)`); }

    const res = await apiGet('processForm', { sjkb: sjkbUp, latlong: currentLatLong, deviceId, namaLokasi });
    alert(res.message || 'OK');
    document.getElementById('sjkb').value = '';
    await loadHistory();
  }catch(e){ console.error(e); alert('Gagal submit data: '+e.message); }
  finally{ document.getElementById('loading').style.display = 'none'; }
}

// =============== HISTORY RENDER ===============
function renderHistory(data, targetId){
  let html='';
  data.forEach(item=>{
    const statusClass = item.status2 === 'Sampai' ? 'bg-done' : 'bg-wait';
    html += `
      <div class="history-card">
        <div class="history-row">
          <span><b>${item.sjkb}</b> (${item.namaDriver})</span>
          <span class="status-badge ${statusClass}">${item.status2}</span>
        </div>
        <div class="detail-box">
          <div class="detail-item"><b>BKT (${item.waktuBkt})</b> ${item.lokasiBkt}</div>
          <div class="detail-item"><b>SMP (${item.waktuSmp})</b> ${item.lokasiSmp}</div>
        </div>
      </div>`;
  });
  document.getElementById(targetId).innerHTML = html || '<center>Belum ada history</center>';
}
async function loadHistory(){
  try{ const res = await apiGet('getHistory', { deviceId }); renderHistory(res.data, 'historyList'); }
  catch(e){ document.getElementById('historyList').innerHTML = '<center>Gagal memuat history</center>'; alert('Gagal memuat history: '+e.message); }
}

// =============== ADMIN ===============
async function openAdmin(){
  const pin = prompt('PIN Admin:'); if(pin !== ADMIN_PIN) return;
  document.getElementById('adminPanel').style.display='block';
  try{
    const lp = await apiGet('getUniqueLP');
    const select = document.getElementById('lpFilter');
    select.innerHTML = '<option value="">-- SEMUA LP --</option>' + lp.data.map(v=>`<option value="${v}">${v}</option>`).join('');
    const hist = await apiGet('getHistory');
    renderHistory(hist.data, 'adminHistoryContent');
  }catch(e){ alert('Gagal memuat data admin: '+e.message); }
}
async function loadAdminHistory(){
  const val = document.getElementById('lpFilter').value; 
  try{ const res = await apiGet('getHistory', { lp: val || '' }); renderHistory(res.data, 'adminHistoryContent'); }
  catch(e){ alert('Gagal memuat history admin: '+e.message); }
}
function closeAdmin(){ document.getElementById('adminPanel').style.display='none'; }

// =============== ABSEN: modal & confirm ===============
async function onClickAbsen(){
  const modal = document.getElementById('absen-modal');
  const elDev  = document.getElementById('absen-device');
  const elNama = document.getElementById('absen-nama');
  const elHint = document.getElementById('absen-nama-hint');
  const btnOK  = document.getElementById('absen-ok');
  const lpRead = document.getElementById('absen-lp-ro');
  const lpDD   = document.getElementById('absen-lp-dd');
  const lpHint = document.getElementById('absen-lp-hint');

  elDev.value = deviceId;
  elNama.value = "";
  elNama.disabled = true;
  btnOK.disabled = true;
  elHint.textContent = "Memeriksa data driver...";

  lpRead.value = "";
  lpRead.style.display = 'block';
  lpDD.innerHTML = '<option value="">-- Pilih LP --</option>';
  lpDD.style.display = 'none';
  lpHint.style.display = 'none';

  modal.style.display = 'block';

  try{
    const prof = await apiGet('getDriverProfile', { deviceId });
    if (prof && prof.data && prof.data.exists){
      elNama.value = prof.data.namaDriver || "";
      elNama.disabled = true;
      lpRead.value = prof.data.lpCode || "";
      lpRead.style.display = 'block';
      lpDD.style.display = 'none';
      lpHint.style.display = 'none';
      elHint.textContent = "Data driver terdaftar.";
      btnOK.disabled = false;
    } else {
      elNama.disabled = false;
      elNama.placeholder = "Isi nama driver (wajib)";
      elHint.textContent = "Driver belum terdaftar. Isi nama & pilih LP.";

      try{
        const lpRes = await apiGet('getUniqueLP');
        const list = (lpRes && lpRes.data) ? lpRes.data : [];
        lpDD.innerHTML = '<option value="">-- Pilih LP --</option>' + list.map(v=>`<option value="${v}">${v}</option>`).join('');
      }catch(e){ lpDD.innerHTML = '<option value="">-- Pilih LP --</option>'; }

      lpRead.style.display = 'none';
      lpDD.style.display = 'block';
      lpHint.style.display = 'block';

      const syncOK = ()=>{ btnOK.disabled = !(elNama.value.trim().length>0 && lpDD.value.trim().length>0); };
      elNama.oninput = syncOK; lpDD.onchange = syncOK; syncOK();
    }
  }catch(e){ elHint.textContent = 'Gagal memeriksa data driver: '+e.message; }
}
function closeAbsenModal(){ document.getElementById('absen-modal').style.display='none'; }

async function confirmAbsen(){
  const btnOK  = document.getElementById('absen-ok');
  if (btnOK.disabled) return;
  const elNama = document.getElementById('absen-nama');
  const lpDD   = document.getElementById('absen-lp-dd');
  const isUnknownMode = (lpDD.style.display !== 'none');
  const driverName = isUnknownMode ? (elNama.value||"").trim() : '';
  const lpCode     = isUnknownMode ? (lpDD.value||"").trim()  : '';

  if (!currentLatLong) { alert('❌ GPS belum aktif.'); return; }
  const nvdc = getLocationByName(masterLocs, NVDC_NAME);
  if (!nvdc) { alert('❌ Lokasi NVDC tidak ditemukan di master.'); return; }

  try{
    document.getElementById('loading').style.display = 'flex';
    const res = await apiGet('markAbsen', { deviceId, latlong: currentLatLong, lokasi: NVDC_NAME, driverName, lpCode });
    alert(res.message || 'Absen OK');
    setAbsenLock();
    document.getElementById('btn-absen').disabled = true;
    closeAbsenModal();
  }catch(e){ alert('Gagal absen: '+e.message); }
  finally{ document.getElementById('loading').style.display = 'none'; }
}

// =============== INIT ===============
window.addEventListener('load', async ()=>{
  document.getElementById('btn-scan')?.addEventListener('click', startScan);
  document.getElementById('btn-cancel')?.addEventListener('click', stopScan);
  document.getElementById('btn-kirim')?.addEventListener('click', manualSubmit);
  document.getElementById('btn-admin')?.addEventListener('click', openAdmin);
  document.getElementById('btn-back')?.addEventListener('click', closeAdmin);
  document.getElementById('lpFilter')?.addEventListener('change', loadAdminHistory);

  document.getElementById('btn-absen')?.addEventListener('click', onClickAbsen);
  document.getElementById('absen-cancel')?.addEventListener('click', closeAbsenModal);
  document.getElementById('absen-ok')?.addEventListener('click', confirmAbsen);

  try{
    const res = await apiGet('getMasterLocations'); masterLocs = res.data || { asal: [], tujuan: [] };
  }catch(e){ alert('Gagal memuat master lokasi: '+e.message); }

  initGPS();
  loadHistory();

  // sinkron lock saat refresh
  if (isAbsenLocked()) { const btnAbsen = document.getElementById('btn-absen'); if (btnAbsen) btnAbsen.disabled = true; }
});
