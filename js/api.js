// Tiny Supabase REST client (no SDK = less to download) with an automatic local fallback.
// The publishable key is safe in the browser: Row Level Security limits every user to their own rows.
(function (g) {
  const URL = 'https://wvmascchbxuemouyrnvh.supabase.co';
  const KEY = 'sb_publishable_P57EUtCWhyJ8DvnjOWX-nw_0AQx6CL6';
  const SKEY = 'rewind-session';
  const safe = { get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }, del: k => { try { localStorage.removeItem(k); } catch (e) {} } };
  let session = safe.get(SKEY);
  let mode = 'cloud'; // becomes 'local' if the backend can't be reached

  async function req(path, opts = {}, auth = true) {
    const headers = { apikey: KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (auth && session) headers.Authorization = 'Bearer ' + session.access_token;
    const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 9000);
    try {
      const r = await fetch(URL + path, { ...opts, headers, signal: ctrl.signal });
      const text = await r.text(); const body = text ? JSON.parse(text) : null;
      if (!r.ok) throw Object.assign(new Error((body && (body.msg || body.message || body.error_description || body.error)) || ('HTTP ' + r.status)), { status: r.status });
      return body;
    } finally { clearTimeout(tm); }
  }
  function keep(s) { session = { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: Date.now() + (s.expires_in || 3600) * 1000, user: s.user }; safe.set(SKEY, session); }
  async function fresh() {
    if (!session || mode === 'local') return;
    if (Date.now() < session.expires_at - 60000) return;
    try { keep(await req('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: session.refresh_token }) }, false)); }
    catch (e) { if (e.status) { session = null; safe.del(SKEY); } }
  }
  // Local accounts (fallback only): stored on this device, clearly labelled in the UI.
  const localUsers = () => safe.get('rewind-local-users') || {};
  const hash = s => sha256('rewind:' + s);

  const API = {
    get mode() { return mode; },
    get user() { return session && session.user; },
    async signIn(email, password) {
      email = String(email).trim().toLowerCase();
      try { keep(await req('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) }, false)); mode = 'cloud'; return session.user; }
      catch (e) {
        if (e.status) throw new Error(e.status === 400 ? 'Email or password is wrong.' : e.message);
        mode = 'local'; // network problem: fall back so the demo never dies
        const u = localUsers()[email] || ((email === 'judge@returnease.demo' || email === 'judge@rewind.demo') && password === 'Impactx@2026' ? { id: 'local-judge', email, name: 'Judge', pw: hash(password) } : null);
        if (!u || u.pw !== hash(password)) throw new Error('Offline mode: email or password is wrong.');
        session = { local: true, user: { id: u.id, email, user_metadata: { name: u.name } }, expires_at: Infinity }; safe.set(SKEY, session); return session.user;
      }
    },
    async signUp(name, email, password) {
      email = String(email).trim().toLowerCase();
      try { await req('/rest/v1/rpc/create_account', { method: 'POST', body: JSON.stringify({ p_email: email, p_password: password, p_name: name }) }, false); return API.signIn(email, password); }
      catch (e) {
        if (e.status) throw new Error(e.message);
        mode = 'local';
        if (password.length < 6) throw new Error('Password must be at least 6 characters');
        const all = localUsers(); if (all[email]) throw new Error('Account exists. Please sign in.');
        all[email] = { id: 'local-' + hash(email).slice(0, 12), email, name, pw: hash(password) }; safe.set('rewind-local-users', all);
        return API.signIn(email, password);
      }
    },
    signOut() { session = null; safe.del(SKEY); },
    async restore() {
      // Coming back from Google sign-in: tokens arrive in the URL fragment.
      const h = new URLSearchParams(location.hash.replace(/^#/, ''));
      if (h.get('access_token')) {
        try { const user = await req('/auth/v1/user', { headers: { Authorization: 'Bearer ' + h.get('access_token') } }, false); keep({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_in: +h.get('expires_in') || 3600, user }); } catch (e) {}
        history.replaceState(null, '', location.pathname + '#/home');
      }
      if (session && session.local) mode = 'local'; await fresh(); return session && session.user;
    },
    async google() {
      let on = false;
      try { const s = await req('/auth/v1/settings', {}, false); on = !!(s.external && s.external.google); } catch (e) { throw new Error('Can’t reach the sign-in server right now. Use email for now.'); }
      if (!on) throw new Error('Google sign-in isn’t switched on for this prototype yet. Please use email or the demo account.');
      location.href = URL + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(location.origin + location.pathname);
    },
    async report(r) {
      const row = { user_id: session.user.id, ...r };
      const key = 'rewind-reports-' + session.user.id;
      if (mode === 'local' || session.local) { const all = safe.get(key) || []; all.unshift({ ...row, created_at: new Date().toISOString() }); safe.set(key, all); return; }
      await req('/rest/v1/fraud_reports', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
    },
    async reports() {
      const key = 'rewind-reports-' + session.user.id;
      if (mode === 'local' || session.local) return safe.get(key) || [];
      try { return await req(`/rest/v1/fraud_reports?user_id=eq.${session.user.id}&order=created_at.desc&select=*`); } catch (e) { return safe.get(key) || []; }
    },
    // ----- data
    async loadState() {
      const uid = session.user.id;
      if (mode === 'local' || session.local) return safe.get('rewind-state-' + uid);
      await fresh();
      try { const rows = await req(`/rest/v1/app_state?user_id=eq.${uid}&select=state`); return rows[0] ? rows[0].state : null; }
      catch (e) { mode = 'local'; return safe.get('rewind-state-' + uid); }
    },
    async saveState(state) {
      const uid = session.user.id; safe.set('rewind-state-' + uid, state);
      if (mode === 'local' || session.local) return 'local';
      await fresh();
      try { await req('/rest/v1/app_state?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: uid, state, updated_at: new Date().toISOString() }) }); return 'cloud'; }
      catch (e) { return 'local'; }
    },
    async profile() {
      const meta = session.user.user_metadata || {};
      if (mode === 'local' || session.local) return { name: meta.name || 'Customer' };
      try { const r = await req(`/rest/v1/profiles?id=eq.${session.user.id}&select=name,city,lang,theme`); return r[0] || { name: meta.name || 'Customer' }; }
      catch (e) { return { name: meta.name || 'Customer' }; }
    },
    async savePrefs(p) {
      if (mode === 'local' || session.local) return;
      try { await req(`/rest/v1/profiles?id=eq.${session.user.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(p) }); } catch (e) {}
    },
    async addReview(r) {
      const row = { user_id: session.user.id, ...r };
      const key = 'rewind-reviews-' + session.user.id;
      if (mode === 'local' || session.local) { const all = safe.get(key) || []; all.unshift({ ...row, created_at: new Date().toISOString() }); safe.set(key, all); return; }
      await req('/rest/v1/reviews', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
    },
    async reviews() {
      const key = 'rewind-reviews-' + session.user.id;
      if (mode === 'local' || session.local) return safe.get(key) || [];
      try { return await req(`/rest/v1/reviews?user_id=eq.${session.user.id}&order=created_at.desc&select=*`); } catch (e) { return safe.get(key) || []; }
    },
    async logChat(role, text) {
      if (mode === 'local' || session.local) return;
      try { await req('/rest/v1/chat_messages', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ user_id: session.user.id, role, text: String(text).slice(0, 1000) }) }); } catch (e) {}
    },
  };
  g.API = API;
})(window);
