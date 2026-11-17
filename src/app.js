/* سبيدي مندوب — تسجيل بدء/إنهاء الفترة وإرسال الموقع أثناء الفترة فقط */
import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { CONFIG as C } from './config.js';

const BG = registerPlugin('BackgroundGeolocation');
const NATIVE = Capacitor.isNativePlatform();

/* ========== helpers ========== */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = ds => { const [y, m, d] = ds.split('-').map(Number); return new Date(y, m - 1, d) };
const addDays = (ds, n) => { const d = parseD(ds); d.setDate(d.getDate() + n); return ymd(d) };
const todayStr = () => ymd(new Date());
const hm = ms => { if (!ms) return '—'; const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}` };
const toMin = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0) };
const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const dayLabel = ds => { const d = parseD(ds); return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}` };
const SH = { m: 'الصباحية', e: 'المسائية' };
const ago = ms => { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? `${s} ث` : s < 3600 ? `${Math.floor(s / 60)} د` : `${Math.floor(s / 3600)} س` };
const fmtDist = m => m == null ? '—' : m < 1000 ? `${Math.round(m)} م` : `${(m / 1000).toFixed(1)} كم`;
function haversine(a, b) { const R = 6371000, r = x => x * Math.PI / 180; const dLa = r(b.lat - a.lat), dLo = r(b.lng - a.lng); const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)) }
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), 3000) }
const LS = { get: (k, d = null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch (e) { return d } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { } }, del: k => { try { localStorage.removeItem(k) } catch (e) { } } };

/* ========== auth (Firebase REST — works in background through native HTTP) ========== */
let session = LS.get('session');
async function signIn(loginId, password) {
  const email = `${String(loginId).trim().toLowerCase()}@${C.driverDomain}`;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${C.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const j = await r.json();
  if (!r.ok) { const m = (j.error && j.error.message) || ''; throw new Error(m) }
  session = { email: j.email || email, uid: j.localId, idToken: j.idToken, refreshToken: j.refreshToken, exp: Date.now() + (+j.expiresIn || 3600) * 1000 };
  LS.set('session', session); return session;
}
async function token() {
  if (!session) throw new Error('NO_SESSION');
  if (Date.now() < session.exp - 120000) return session.idToken;
  const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${C.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(session.refreshToken)}` });
  const j = await r.json();
  if (!r.ok) { const m = (j.error && j.error.message) || 'REFRESH_FAILED'; if (/TOKEN_EXPIRED|USER_DISABLED|USER_NOT_FOUND|INVALID_REFRESH_TOKEN/.test(m)) { logoutLocal(); render() } throw new Error(m) }
  session = { ...session, idToken: j.id_token, refreshToken: j.refresh_token, exp: Date.now() + (+j.expires_in || 3600) * 1000 };
  LS.set('session', session); return session.idToken;
}

/* ========== Firestore REST ========== */
const FS = `https://firestore.googleapis.com/v1/projects/${C.projectId}/databases/(default)/documents`;
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, enc(x)])) } };
}
function dec(v) {
  if (!v) return null;
  if ('nullValue' in v) return null; if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue); if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue; if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return decF(v.mapValue.fields || {}); return null;
}
const decF = f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, dec(v)]));
const docPath = p => p.split('/').map(encodeURIComponent).join('/');
async function fsGet(path) {
  const r = await fetch(`${FS}/${docPath(path)}`, { headers: { Authorization: 'Bearer ' + await token() } });
  if (r.status === 404) return null;
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j.error && j.error.status) || 'HTTP_' + r.status) }
  const j = await r.json(); return decF(j.fields || {});
}
async function fsPatch(path, data, mask) {
  const qs = mask.map(m => 'updateMask.fieldPaths=' + encodeURIComponent(m)).join('&');
  const r = await fetch(`${FS}/${docPath(path)}?${qs}`, { method: 'PATCH', headers: { Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: enc(data).mapValue.fields }) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j.error && j.error.status) || 'HTTP_' + r.status) }
}

/* ========== Realtime Database REST ========== */
async function rtdbPatch(updates) {
  const r = await fetch(`${C.databaseURL}/.json?auth=${await token()}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
  if (!r.ok) throw new Error('RTDB_' + r.status);
}

/* ========== profile & settings ========== */
let P = LS.get('profile');        // {driverId, name, code, shift}
let S = LS.get('settings') || {}; // shifts, office
const DEF = { m: { start: '10:00', end: '17:00' }, e: { start: '17:00', end: '24:00' } };
const shiftCfg = sh => ({ ...DEF[sh], ...((S.shifts || {})[sh] || {}) });
function bounds(ds, sh) { const d = parseD(ds), c = shiftCfg(sh); const s = toMin(c.start); let e = toMin(c.end); if (e <= s) e += 1440; const mk = m => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, m).getTime(); return { start: mk(s), end: mk(e) } }
function suggestShift() {
  const n = new Date(), now = n.getHours() * 60 + n.getMinutes(), eS = toMin(shiftCfg('e').start); let eE = toMin(shiftCfg('e').end); if (eE <= eS) eE += 1440;
  if (now < Math.max(240, eE - 1440 + 120)) return { date: addDays(todayStr(), -1), shift: 'e' };
  if (P && (P.shift === 'm' || P.shift === 'e')) return { date: todayStr(), shift: P.shift };
  return { date: todayStr(), shift: now < eS ? 'm' : 'e' };
}
const office = () => (S.office && isFinite(S.office.lat) && isFinite(S.office.lng)) ? S.office : null;
async function loadProfile() {
  const acc = await fsGet(`driverAccounts/${session.email}`);
  if (!acc || !acc.driverId) throw new Error('NOT_LINKED');
  const d = await fsGet(`drivers/${acc.driverId}`) || {};
  P = { driverId: acc.driverId, name: d.name || acc.name || '', code: d.code || '', shift: d.shift || 'm' }; LS.set('profile', P);
  try { const st = await fsGet('config/settings'); if (st) { S = { shifts: st.shifts || {}, office: st.office || null }; LS.set('settings', S) } } catch (e) { }
}

/* ========== tracking state ========== */
let T = LS.get('track');   // {active, date, shift, startedAt, sent, lastSentAt, lastFix}
let watcherId = null, webWatch = null, lastLoc = null, hb = null;
const QKEY = 'queue';
function saveT() { LS.set('track', T) }

async function startWatcher(onFirst) {
  const handle = loc => {
    lastLoc = { lat: loc.latitude, lng: loc.longitude, acc: Math.round(loc.accuracy || 0), spd: loc.speed == null ? null : Math.round(loc.speed * 10) / 10, hdg: loc.bearing == null ? null : Math.round(loc.bearing), t: loc.time || Date.now(), mock: !!loc.simulated };
    if (onFirst) { const f = onFirst; onFirst = null; f(lastLoc); return }
    onLocation(lastLoc);
  };
  if (NATIVE) {
    watcherId = await BG.addWatcher({ backgroundTitle: 'سبيدي — الفترة جارية', backgroundMessage: 'يُرسَل موقعك لسبيدي أثناء الفترة فقط. اضغط لفتح التطبيق.', requestPermissions: true, stale: false, distanceFilter: 20 },
      (loc, err) => { if (err) { if (err.code === 'NOT_AUTHORIZED') permissionHelp(); return } if (loc) handle(loc) });
  } else if (navigator.geolocation) {
    webWatch = navigator.geolocation.watchPosition(p => handle({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed, bearing: p.coords.heading, time: p.timestamp }), e => { if (e && e.code === 1) permissionHelp() }, { enableHighAccuracy: true });
  }
  clearInterval(hb); hb = setInterval(heartbeat, 20000);
}
async function stopWatcher() {
  clearInterval(hb); hb = null;
  if (watcherId != null) { try { await BG.removeWatcher({ id: watcherId }) } catch (e) { } watcherId = null }
  if (webWatch != null) { navigator.geolocation.clearWatch(webWatch); webWatch = null }
}
function permissionHelp() {
  modal(`<h3>صلاحية الموقع مطلوبة</h3><div class="mu">التطبيق يحتاج صلاحية الموقع ليعمل أثناء الفترة. افتح إعدادات التطبيق ← الأذونات ← الموقع ← <b>السماح طوال الوقت</b> أو <b>أثناء استخدام التطبيق</b>.</div>
  <div class="row"><button class="btn p" data-act="openSettings">فتح الإعدادات</button><button class="btn" data-act="close">إغلاق</button></div>`);
}

function liveDoc(loc, extra = {}) {
  return { lat: loc.lat, lng: loc.lng, acc: loc.acc, spd: loc.spd, hdg: loc.hdg, t: loc.t, mock: loc.mock || false, at: { '.sv': 'timestamp' }, active: true, date: T.date, shift: T.shift, name: P.name, code: P.code, startedAt: T.startedAt, ...extra };
}
async function send(loc, withPoint) {
  const did = P.driverId, up = { [`live/${did}`]: liveDoc(loc) };
  const q = LS.get(QKEY, []);
  if (withPoint) q.push({ k: `tracks/${did}/${T.date}/${loc.t}`, v: { lat: loc.lat, lng: loc.lng, acc: loc.acc, spd: loc.spd, t: loc.t, ...(loc.mock ? { mock: true } : {}) } });
  q.slice(-300).forEach(x => up[x.k] = x.v);
  try {
    await rtdbPatch(up);
    LS.set(QKEY, q.slice(0, -300));
    if (withPoint) { T.sent = (T.sent || 0) + 1; T.lastPointAt = Date.now() }
    T.lastSentAt = Date.now(); T.lastFix = loc; T.err = null; saveT();
  } catch (e) { LS.set(QKEY, q.slice(-3000)); T.err = String(e.message || e); saveT() }
  paint();
}
function onLocation(loc) {
  if (!T || !T.active) return;
  if (autoStopIfLate()) return;
  if (loc.acc > 150 && T.lastSentAt && Date.now() - T.lastSentAt < 180000) return;
  if (!T.lastSentAt || Date.now() - T.lastSentAt >= (C.sendEverySec - 5) * 1000) send(loc, true);
  else paint();
}
function heartbeat() {
  if (!T || !T.active) return;
  if (autoStopIfLate()) return;
  if (lastLoc && (!T.lastSentAt || Date.now() - T.lastSentAt >= C.sendEverySec * 1000)) send(lastLoc, Date.now() - (T.lastPointAt || 0) > 300000);
  paint();
}
function autoStopIfLate() {
  const b = bounds(T.date, T.shift);
  if (Date.now() > b.end + C.autoStopHoursAfterShift * 3600000) { endShift(true); return true }
  return false;
}

/* ========== start / end shift ========== */
const recKey = sh => `${sh}_${P.driverId}`;
async function startShift(sh, ds) {
  if (busy) return; busy = true; paint();
  try {
    if (NATIVE) { try { await LocalNotifications.requestPermissions() } catch (e) { } }
    status('جاري تحديد موقعك…');
    const loc = await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error('GPS_TIMEOUT')), 45000); startWatcher(l => { clearTimeout(to); res(l) }).catch(rej) });
    const off = office(); const dist = off ? Math.round(haversine(loc, off)) : null;
    if (off && dist > (off.radius || 200)) {
      const ok = await confirmBox(`أنت على بعد <b>${fmtDist(dist)}</b> من المكتب. سيُسجَّل ذلك مع حضورك. هل تريد بدء الفترة؟`);
      if (!ok) { await stopWatcher(); busy = false; status(''); return paint() }
    }
    status('جاري تسجيل الحضور…');
    const day = await fsGet(`days/${ds}`).catch(() => null);
    const ex = day && day.recs && day.recs[recKey(sh)];
    const now = Date.now();
    const rec = {
      driverId: P.driverId, shift: sh, status: 'present',
      checkIn: ex && ex.status === 'present' && ex.checkIn ? ex.checkIn : now, checkOut: null,
      note: (ex && ex.note) || '', source: 'app', inLat: loc.lat, inLng: loc.lng, inAcc: loc.acc, inDist: dist,
      updatedBy: session.email, updatedAt: now
    };
    await fsPatch(`days/${ds}`, { recs: { [recKey(sh)]: rec } }, [`recs.\`${recKey(sh)}\``]);
    T = { active: true, date: ds, shift: sh, startedAt: now, sent: 0, lastSentAt: 0 }; saveT();
    lastLoc = loc; await send(loc, true);
    toast(`بدأت الفترة ${SH[sh]} — ${hm(rec.checkIn)}`);
  } catch (e) {
    await stopWatcher();
    const m = String(e.message || e);
    toast(m === 'GPS_TIMEOUT' ? 'تعذر تحديد الموقع — تأكد أن GPS مفعّل وأنك في مكان مكشوف' : m.includes('PERMISSION') ? 'لا تملك صلاحية — راجع المدير' : /fetch|network|Failed/i.test(m) ? 'لا يوجد اتصال بالإنترنت' : 'تعذر بدء الفترة: ' + m);
  }
  busy = false; status(''); paint();
}
async function endShift(auto = false) {
  if (!T || !T.active) return;
  busy = true; paint();
  const loc = lastLoc || T.lastFix, now = Date.now(), ds = T.date, sh = T.shift;
  try {
    if (!auto) {
      const day = await fsGet(`days/${ds}`).catch(() => null);
      const ex = (day && day.recs && day.recs[recKey(sh)]) || { driverId: P.driverId, shift: sh, status: 'present', checkIn: T.startedAt, note: '' };
      const off = office(), dist = off && loc ? Math.round(haversine(loc, off)) : null;
      const rec = { ...ex, driverId: P.driverId, shift: sh, status: ex.status || 'present', checkOut: now, outLat: loc ? loc.lat : null, outLng: loc ? loc.lng : null, outDist: dist, updatedBy: session.email, updatedAt: now };
      await fsPatch(`days/${ds}`, { recs: { [recKey(sh)]: rec } }, [`recs.\`${recKey(sh)}\``]);
    }
    if (loc) await rtdbPatch({ [`live/${P.driverId}`]: { ...liveDoc(loc), active: false, endedAt: now, autoStopped: auto } }).catch(() => { });
  } catch (e) {
    busy = false; paint();
    return toast(/fetch|network|Failed/i.test(String(e.message)) ? 'لا يوجد اتصال — أعد المحاولة عند توفر الإنترنت' : 'تعذر تسجيل الخروج: ' + e.message);
  }
  await stopWatcher();
  T = null; LS.del('track'); busy = false;
  toast(auto ? 'أُوقف التتبع تلقائياً لانتهاء وقت الفترة' : `انتهت الفترة — ${hm(now)}`); paint();
}

/* ========== UI ========== */
let busy = false, statusText = '', pick = null;
function status(t) { statusText = t; paint() }
function modal(html) { $('#sheet').innerHTML = html; $('#modal').classList.remove('hidden') }
function closeModal() { $('#modal').classList.add('hidden'); $('#sheet').innerHTML = '' }
function confirmBox(html) {
  return new Promise(res => {
    modal(`<h3>تأكيد</h3><div class="mu" style="font-size:15px">${html}</div><div class="row"><button class="btn p" id="cy">نعم</button><button class="btn" id="cn">لا</button></div>`);
    $('#cy').onclick = () => { closeModal(); res(true) }; $('#cn').onclick = () => { closeModal(); res(false) };
  });
}
const header = () => `<div class="top"><img src="logo.png" alt=""><div><b>سبيدي</b><small>تطبيق المندوب</small></div>${P ? `<div class="r"><b style="font-size:15px">${esc(P.name)}</b><small>${esc(P.code)}</small></div>` : ''}</div>`;

function render() {
  const app = $('#app');
  if (!session) {
    app.innerHTML = header() + `<div class="card"><div style="font-size:19px;font-weight:800;margin-bottom:4px">تسجيل الدخول</div><div class="mu">أدخل رقم الدخول وكلمة المرور التي أعطاك إياها المدير.</div>
    <form id="lf"><label>رقم الدخول</label><input class="inp" name="id" inputmode="tel" autocomplete="username" dir="ltr" required>
    <label>كلمة المرور</label><input class="inp" name="pw" type="password" autocomplete="current-password" dir="ltr" required>
    <div class="err" id="lerr"></div><button class="btn p" type="submit">دخول</button></form></div><div class="foot">سبيدي.. طلبيتك في إيدي</div>`;
    $('#lf').onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.target), b = e.target.querySelector('button'); b.disabled = true; $('#lerr').textContent = '';
      try { await signIn(f.get('id'), f.get('pw')); await loadProfile(); render() }
      catch (err) {
        const m = String(err.message || err);
        $('#lerr').textContent = m === 'NOT_LINKED' ? 'هذا الحساب غير مربوط بمندوب — راجع المدير' : /INVALID|NOT_FOUND|PASSWORD|EMAIL/.test(m) ? 'رقم الدخول أو كلمة المرور غير صحيحة' : m.includes('DISABLED') ? 'الحساب موقوف — راجع المدير' : m.includes('TOO_MANY') ? 'محاولات كثيرة، انتظر قليلاً' : m.includes('PERMISSION') ? 'لا تملك صلاحية — راجع المدير' : 'لا يوجد اتصال بالإنترنت';
        if (m === 'NOT_LINKED' || m.includes('PERMISSION')) logoutLocal();
        b.disabled = false;
      }
    };
    return;
  }
  if (!P) { app.innerHTML = header() + '<div class="spin"></div>'; loadProfile().then(render).catch(e => { if (String(e.message) === 'NOT_LINKED') { logoutLocal(); render(); toast('الحساب غير مربوط بمندوب — راجع المدير') } else { app.innerHTML = header() + `<div class="card center"><div class="mu">تعذر تحميل البيانات. تحقق من الإنترنت.</div><button class="btn" style="margin-top:12px" data-act="retry">إعادة المحاولة</button></div>` } }); return }
  app.innerHTML = header() + '<div id="main"></div><div class="foot">سبيدي.. طلبيتك في إيدي</div>';
  paint();
}
function paint() {
  const m = $('#main'); if (!m) return;
  if (T && T.active) {
    const b = bounds(T.date, T.shift), q = LS.get(QKEY, []).length, f = T.lastFix;
    const off = office(), dist = off && f ? haversine(f, off) : null;
    m.innerHTML = `<div class="card center"><div class="row" style="justify-content:center"><span class="pulse"></span><b style="font-size:18px">الفترة ${SH[T.shift]} جارية</b></div>
      <div class="mu">${dayLabel(T.date)} · منذ ${hm(T.startedAt)} · تنتهي ${shiftCfg(T.shift).end === '24:00' ? '12:00 ليلاً' : shiftCfg(T.shift).end}</div>
      <button class="btn d big" data-act="end" ${busy ? 'disabled' : ''}>■ إنهاء الفترة<span>تسجيل الخروج</span></button>
      ${statusText ? `<div class="mu">${esc(statusText)}</div>` : ''}</div>
    <div class="stats">
      <div class="stat"><div class="l">آخر إرسال</div><div class="v">${T.lastSentAt ? 'منذ ' + ago(T.lastSentAt) : '—'}</div></div>
      <div class="stat"><div class="l">نقاط مُرسلة اليوم</div><div class="v">${T.sent || 0}</div></div>
      <div class="stat"><div class="l">دقة الموقع</div><div class="v">${f ? f.acc + ' م' : '—'}</div></div>
      <div class="stat"><div class="l">البعد عن المكتب</div><div class="v">${fmtDist(dist)}</div></div>
    </div>
    ${q ? `<div class="note">📶 ${q} نقطة بانتظار الإنترنت — ستُرسل تلقائياً.</div>` : ''}
    ${f && f.mock ? '<div class="note" style="border-color:rgba(239,83,80,.5);color:#ff9d9b">⚠️ تم اكتشاف موقع وهمي (Fake GPS). يظهر ذلك للمدير.</div>' : ''}
    <div class="note">🔋 لضمان استمرار التتبع: لا تغلق الإشعار، واستثنِ التطبيق من «توفير البطارية».${NATIVE ? ' <button class="btn sm" data-act="openSettings" style="margin-top:6px">إعدادات التطبيق</button>' : ''}</div>`;
    return;
  }
  const sug = suggestShift(); pick = pick || sug;
  const b = bounds(pick.date, pick.shift);
  m.innerHTML = `<div class="card center"><div class="mu">${dayLabel(pick.date)}</div>
    <div class="seg" style="margin:10px 0"><button class="${pick.shift === 'm' ? 'on' : ''}" data-act="pick" data-s="m">الصباحية</button><button class="${pick.shift === 'e' ? 'on' : ''}" data-act="pick" data-s="e">المسائية</button></div>
    <div class="mu">الفترة ${SH[pick.shift]}: ${shiftCfg(pick.shift).start} – ${shiftCfg(pick.shift).end === '24:00' ? '12:00 ليلاً' : shiftCfg(pick.shift).end}</div>
    <button class="btn p big" data-act="start" ${busy ? 'disabled' : ''}>▶ بدء الفترة<span>تسجيل الحضور</span></button>
    ${statusText ? `<div class="mu">${esc(statusText)}</div>` : ''}</div>
  <div class="note">📍 عند بدء الفترة يُسجَّل حضورك ويُرسَل موقعك لسبيدي كل دقيقة <b>حتى إنهاء الفترة فقط</b>. لا يُتتبَّع موقعك خارج الفترة.</div>
  <div class="row"><button class="btn sm" data-act="refresh">تحديث البيانات</button><button class="btn sm" data-act="logout" style="margin-inline-start:auto">تسجيل الخروج من التطبيق</button></div>`;
}
function logoutLocal() { session = null; P = null; LS.del('session'); LS.del('profile') }

document.addEventListener('click', async e => {
  if (e.target.id === 'modal') return closeModal();
  const b = e.target.closest('[data-act]'); if (!b) return; const a = b.dataset.act;
  if (a === 'close') return closeModal();
  if (a === 'retry') return render();
  if (a === 'openSettings') { try { await BG.openSettings() } catch (err) { } return }
  if (a === 'pick') { pick = { ...(pick || suggestShift()), shift: b.dataset.s }; return paint() }
  if (a === 'start') { const p = pick || suggestShift(); return startShift(p.shift, p.date) }
  if (a === 'end') { if (await confirmBox('إنهاء الفترة وتسجيل الخروج الآن؟')) endShift(false); return }
  if (a === 'refresh') { try { await loadProfile(); toast('تم تحديث البيانات'); render() } catch (err) { toast('تعذر التحديث') } return }
  if (a === 'logout') { if (T && T.active) return toast('أنهِ الفترة أولاً'); if (await confirmBox('تسجيل الخروج من التطبيق؟')) { logoutLocal(); render() } return }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) { paint(); if (T && T.active && lastLoc) heartbeat() } });
setInterval(() => { if (!document.hidden) paint() }, 15000);

/* resume an active shift after the app was closed or the phone restarted */
(async function boot() {
  render();
  if (session && T && T.active) {
    try { await startWatcher(null); if (T.lastFix) lastLoc = T.lastFix } catch (e) { }
  }
})();
