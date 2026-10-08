import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isSupabaseConfigured, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config.js';
import { greeting, localDate, localDateTime, reportCounts, ROLE_DOMAINS, schoolRoleForEmail, STATUSES } from './logic.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
});

const STAGES = STATUSES;
const ROLE_LABEL = { student: 'Student', facility_admin: 'Facilities Admin', security_guard: 'Security Guard' };
const CATS = ['Broken Air Conditioner', 'Damaged Chair', 'Electrical Problem', 'Locked Classroom', 'Missing Equipment', 'Damaged Facility', 'Safety / Security', 'Other'];
const GUARD_CATS = ['Safety / Security', 'Locked Classroom', 'Electrical Problem'];
const BLDG = ['Main Building', 'Annex Building', 'Engineering Building', 'Library', 'Gymnasium', 'Cafeteria'];
const PROGS = {
  'College of Computing and Information Technologies': ['BS Computer Science', 'BS Information Technology', 'BS Information Systems', 'BS Entertainment and Multimedia Computing'],
  'College of Engineering': ['BS Civil Engineering', 'BS Computer Engineering', 'BS Electrical Engineering', 'BS Electronics Engineering', 'BS Industrial Engineering', 'BS Mechanical Engineering'],
  'College of Architecture': ['BS Architecture'],
  'College of Business, Accountancy and Management': ['BS Accountancy', 'BS Management Accounting', 'BS Business Administration - Marketing', 'BS Business Administration - Financial Management', 'BS Business Administration - Human Resource Management', 'BS Hospitality Management', 'BS Tourism Management'],
  'College of Arts, Sciences and Education': ['BS Psychology', 'BS Biology', 'BA Communication', 'BA Political Science', 'Bachelor of Secondary Education', 'Bachelor of Elementary Education'],
  'College of Allied Health': ['BS Nursing', 'BS Medical Technology', 'BS Pharmacy', 'BS Physical Therapy'],
  'Senior High School': ['STEM', 'ABM', 'HUMSS', 'GAS', 'ICT'],
};
const CAMPUSES = ['Manila', 'Baliwag', 'Clark', 'Dasmariñas', 'Laguna', 'Lipa', 'Fairview'];
const state = {
  view: 'login', user: null, profile: null, reports: [], notifications: [], staffProfiles: [],
  pendingProfiles: [], viewError: '', err: {}, reg: { step: 1, role: 'student' }, draft: {},
  selected: null, menu: false, drawer: false, modal: false, toast: '', busy: false,
  search: '', reportSearch: '', filter: 'Open', photoPreview: '', resetEmail: '',
};

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const value = (id) => ($('#' + id)?.value || '').trim();
const photoBucket = 'report-photos';
const isStaff = () => ['facility_admin', 'security_guard'].includes(state.profile?.role);
const isAdmin = () => state.profile?.role === 'facility_admin';
const initials = () => state.profile?.full_name?.charAt(0) || state.user?.email?.charAt(0) || '?';
const fullName = () => state.profile?.full_name || state.user?.email || 'NU Buddy user';
const errorText = (error) => {
  const message = error?.message || 'Something went wrong. Please try again.';
  if (/invalid login credentials/i.test(message)) return 'Email or password is incorrect.';
  if (/email not confirmed/i.test(message)) return 'Verify your school email before logging in.';
  if (/user already registered/i.test(message)) return 'An account with this email already exists.';
  if (/row-level security|not authorized|permission denied/i.test(message)) return 'Your account does not have permission to do that.';
  return message;
};
const badge = (status) => `<span class="badge s${STAGES.indexOf(status)}">${escapeHtml(status)}</span>`;
const fieldError = (key) => state.err[key] ? `<div class="err" role="alert">${escapeHtml(state.err[key])}</div>` : '';
function input(id, label, options = {}) {
  const type = options.type || 'text';
  const el = `<input id="${id}" name="${id}" type="${type}" value="${escapeHtml(options.value || '')}" ${options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : ''} autocomplete="${options.autocomplete || 'off'}" ${options.max ? `maxlength="${options.max}"` : ''} ${options.required ? 'required' : ''}>`;
  return `<label for="${id}">${label}</label>${type === 'password' ? `<div class="pw">${el}<button type="button" class="eye" data-act="eye" data-for="${id}" aria-label="Show or hide password">Show</button></div>` : el}${fieldError(id)}`;
}
function select(id, label, options, selected = '', placeholder = 'Select…') {
  return `<label for="${id}">${label}</label><select id="${id}" name="${id}"><option value="">${placeholder}</option>${options.map((option) => `<option value="${escapeHtml(option)}" ${option === selected ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select>${fieldError(id)}`;
}
function showToast(message) {
  state.toast = message;
  render();
  window.setTimeout(() => {
    if (state.toast === message) { state.toast = ''; render(); }
  }, 3000);
}
function profileName(profile) {
  return profile?.full_name || 'Student';
}
function stageIndex(status) { return STAGES.indexOf(status); }
function mapReport(row) {
  const history = (row.report_history || []).slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const statusHistory = new Map();
  history.forEach((entry) => {
    const stage = stageIndex(entry.new_status);
    const previous = statusHistory.get(stage);
    const note = entry.note ? `${localDateTime(entry.created_at)}: ${entry.note}` : '';
    statusHistory.set(stage, {
      stage,
      at: entry.created_at,
      note: [previous?.note, note].filter(Boolean).join(' | '),
    });
  });
  return {
    id: row.id, reportNumber: row.report_number, owner: row.owner_id, cat: row.category,
    title: row.title, desc: row.description, bldg: row.building, floor: row.floor,
    room: row.room, photoPath: row.photo_path, photo: '', stage: stageIndex(row.status),
    status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
    history: [...statusHistory.values()],
  };
}
async function refreshData() {
  if (!state.user || !state.profile || state.profile.account_status !== 'approved') return;
  state.viewError = '';
  const [reportResult, notificationResult] = await Promise.all([
    supabase.from('reports').select('*, report_history(*)').order('created_at', { ascending: false }),
    supabase.from('notifications').select('id, report_id, message, is_read, created_at').order('created_at', { ascending: false }),
  ]);
  if (reportResult.error) throw reportResult.error;
  if (notificationResult.error) throw notificationResult.error;
  const reports = reportResult.data || [];
  const ownerIds = [...new Set(reports.map((report) => report.owner_id))];
  let ownerProfiles = [];
  if (ownerIds.length) {
    const { data, error } = await supabase.from('profiles').select('user_id, full_name, user_identifier, role').in('user_id', ownerIds);
    if (error) throw error;
    ownerProfiles = data || [];
  }
  if (isStaff()) {
    const { data, error } = await supabase.from('profiles').select('user_id, full_name, user_identifier, school_email, role, campus, created_at').in('role', ['facility_admin', 'security_guard']);
    if (error) throw error;
    state.staffProfiles = [...new Map([...(ownerProfiles || []), ...(data || [])].map((profile) => [profile.user_id, profile])).values()];
  } else state.staffProfiles = ownerProfiles;
  state.reports = await Promise.all(reports.map(async (row) => {
    const report = mapReport(row);
    if (report.photoPath) {
      const { data } = await supabase.storage.from(photoBucket).createSignedUrl(report.photoPath, 3600);
      report.photo = data?.signedUrl || '';
    }
    return report;
  }));
  state.notifications = notificationResult.data || [];
  state.pendingProfiles = [];
  if (isAdmin()) {
    const { data, error } = await supabase.from('profiles').select('user_id, full_name, school_email, user_identifier, role, campus, created_at').in('role', ['facility_admin', 'security_guard']).eq('account_status', 'pending').order('created_at');
    if (error) throw error;
    state.pendingProfiles = data || [];
  }
}
async function loadProfile(session, eventName = '') {
  if (!session?.user) {
    state.user = null;
    state.profile = null;
    state.reports = [];
    state.notifications = [];
    state.staffProfiles = [];
    state.pendingProfiles = [];
    state.view = 'login';
    state.modal = false;
    render();
    return;
  }
  if (state.user?.id === session.user.id && state.profile && eventName !== 'PASSWORD_RECOVERY') return;
  state.user = session.user;
  try {
    const { data, error } = await supabase.from('profiles').select('*').eq('user_id', session.user.id).single();
    if (error) throw error;
    state.profile = data;
    if (!session.user.email_confirmed_at) {
      state.view = 'verify-required';
    } else if (data.account_status !== 'approved') {
      state.view = 'pending';
    } else if (eventName === 'PASSWORD_RECOVERY') {
      state.view = 'reset';
    } else if (['login', 'register', 'forgot', 'pending'].includes(state.view)) {
      state.view = isStaff() ? 'staff' : 'dash';
    }
  if (state.view === 'reset') { app.innerHTML = resetPassword(); return; }
  if (state.view === 'verify-required') page = verificationRequired();
  } catch (error) {
    state.viewError = errorText(error);
    state.view = 'profile-error';
  }
  render();
}

function authFrame(content) {
  return `<div class="auth"><div class="card"><div class="brand" style="color:var(--blue)"><span class="logo">NU</span>NU Buddy</div>${content}</div></div>`;
}
function configScreen() {
  return authFrame(`<h1 style="margin-top:1rem">Connect Supabase</h1><p class="mut">Add your Supabase project URL and publishable key in <b>js/config.js</b>, then reload this page. This app does not contain a live database configuration yet.</p><p class="sm mut">Use the publishable (formerly anon) key only. Never put a service-role key in browser code.</p>`);
}
function login() {
  return authFrame(`<h1 style="margin-top:1rem">Welcome, Bulldog</h1><p class="mut">Log in to report facility issues and track their progress.</p>${input('lid', 'School email', { type: 'email', placeholder: 'name@students.nu.edu.ph', autocomplete: 'username', value: state.loginEmail || '' })}${input('lpw', 'Password', { type: 'password', autocomplete: 'current-password' })}${fieldError('login')}<button class="btn block" style="margin-top:1rem" data-act="login" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Logging in…' : 'Log In'}</button><button class="btn ghost block" style="margin-top:.6rem" data-act="register">Create Account</button><p class="sm" style="margin-top:1rem;display:flex;justify-content:space-between;gap:.5rem;flex-wrap:wrap"><a href="#" data-act="forgot">Forgot password?</a><a href="#" data-act="verify-help">School email help</a></p>`);
}
function registration() {
  const form = state.reg;
  const role = form.role || 'student';
  const student = role === 'student';
  const roleOptions = [['student', 'I’m a student'], ['facility_admin', 'Facilities admin'], ['security_guard', 'Security guard']];
  let body = '';
  if (form.step === 1) {
    body = `<div style="display:flex;gap:.5rem;margin:1rem 0;flex-wrap:wrap">${roleOptions.map(([key, label]) => `<button class="btn ${role === key ? '' : 'ghost'}" style="flex:1" data-act="reg-role" data-v="${key}">${label}</button>`).join('')}</div><h2>Account information</h2><div class="grid g2"><div>${input('rname', 'Full name', { value: form.fullName, autocomplete: 'name', max: 120 })}</div><div>${input('rid', student ? 'Student ID' : 'Employee / guard ID', { value: form.identifier, max: 40 })}</div><div>${select('rcampus', 'Campus', CAMPUSES, form.campus)}</div>${student ? `<div>${select('rcol', 'College / School', Object.keys(PROGS), form.college)}</div>` : ''}</div>${student ? select('rpg', 'Program / Course', form.college ? (PROGS[form.college] || []).concat('Other (not listed)') : [], form.program, form.college ? 'Select your program…' : 'Select a college first') : ''}${student && form.program === 'Other (not listed)' ? input('rpo', 'Your program name', { value: form.otherProgram, max: 120 }) : ''}${input('rem', 'School email', { type: 'email', placeholder: `name@${ROLE_DOMAINS[role]}`, value: form.email, autocomplete: 'email', max: 254 })}<p class="sm mut">Your role is determined by your verified school email domain. Staff and guard accounts require administrator approval.</p>${fieldError('register')}<button class="btn block" style="margin-top:1rem" data-act="register-next">Continue</button>`;
  } else if (form.step === 2) {
    body = `<h2 style="margin-top:1rem">Create your password</h2><p class="mut">Use at least 8 characters, including an uppercase letter and a number.</p>${input('pw1', 'Password', { type: 'password', autocomplete: 'new-password' })}${input('pw2', 'Confirm password', { type: 'password', autocomplete: 'new-password' })}${fieldError('password')}<div style="display:flex;gap:.6rem;margin-top:1rem"><button class="btn ghost" data-act="register-back">Back</button><button class="btn" style="flex:1" data-act="register-submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Creating account…' : 'Create account'}</button></div>`;
  } else {
    body = `<div style="text-align:center;margin-top:1.2rem"><h2>Check your school email</h2><p class="mut">We sent a verification link to <b>${escapeHtml(form.email)}</b>. Open it to verify your address before logging in.${student ? '' : ' Your account will then wait for administrator approval.'}</p><button class="btn block" data-act="to-login">Back to log in</button></div>`;
  }
  return authFrame(`<h1 style="margin-top:1rem">Create account</h1><div class="steps">${[1, 2, 3].map((step) => `<i class="${step <= form.step ? 'on' : ''}"></i>`).join('')}</div>${body}<p class="sm" style="margin:1rem 0 0"><a href="#" data-act="to-login">Back to log in</a></p>`);
}
function forgot() {
  return authFrame(`<h1 style="margin-top:1rem">Reset your password</h1><p class="mut">We’ll send a password recovery link to your school email.</p>${input('reset-email', 'School email', { type: 'email', placeholder: 'name@students.nu.edu.ph', value: state.resetEmail, autocomplete: 'email' })}${fieldError('reset')}<button class="btn block" style="margin-top:1rem" data-act="send-reset" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Sending…' : 'Send recovery link'}</button><p class="sm" style="margin-top:1rem"><a href="#" data-act="to-login">Back to log in</a></p>`);
}
function resetPassword() {
  return authFrame(`<h1 style="margin-top:1rem">Choose a new password</h1>${input('new-password', 'New password', { type: 'password', autocomplete: 'new-password' })}${input('confirm-password', 'Confirm password', { type: 'password', autocomplete: 'new-password' })}${fieldError('reset')}<button class="btn block" style="margin-top:1rem" data-act="save-reset" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Saving…' : 'Save password'}</button>`);
}
function pending() {
  const rejected = state.profile?.account_status === 'rejected';
  return authFrame(`<h1 style="margin-top:1rem">${rejected ? 'Account not approved' : 'Account awaiting approval'}</h1><p class="mut">${rejected ? 'This staff account was not approved. Contact the campus Facilities office for help.' : 'Your school email is verified. A NU Buddy administrator must approve this staff account before you can use the portal.'}</p><p class="sm">${escapeHtml(state.profile?.school_email || '')}</p><button class="btn block" data-act="logout">Log out</button>`);
}
function verificationRequired() {
  return authFrame(`<h1 style="margin-top:1rem">Verify your school email</h1><p class="mut">Open the verification link sent to ${escapeHtml(state.profile?.school_email || state.user?.email || 'your school email')}. NU Buddy will unlock your account after the address is verified.</p><button class="btn block" data-act="logout">Log out</button>`);
}
function navButton(item, current, unread) {
  return `<button class="nav ${current === item[0] ? 'on' : ''}" data-act="nav" data-v="${item[0]}"><span aria-hidden="true">${item[1]}</span>${item[2]}${item[0] === 'notifs' && unread ? `<span class="n">${unread}</span>` : ''}</button>`;
}
const NAV = [['dash', '▦', 'Dashboard'], ['report', '＋', 'Facility Report'], ['reports', '☰', 'My Reports'], ['status', '◔', 'Report Status'], ['notifs', '🔔', 'Notifications'], ['profile', '☺', 'Profile'], ['settings', '⚙', 'Account Settings'], ['help', '?', 'Help / Support']];
function shell(body) {
  const unread = state.notifications.filter((notice) => !notice.is_read).length;
  const current = state.view === 'detail' ? 'status' : state.view;
  return `<div class="shell"><aside class="side ${state.drawer ? 'open' : ''}" aria-label="Main navigation"><div class="brand"><span class="logo">NU</span>NU Buddy</div>${NAV.map((item) => navButton(item, current, unread)).join('')}<button class="nav" style="margin-top:auto;color:#ffd3cf" data-act="askout"><span aria-hidden="true">⎋</span>Log Out</button></aside><div class="scrim ${state.drawer ? 'open' : ''}" data-act="drawer"></div><div class="main"><header class="top"><button class="btn ghost burger" data-act="drawer" aria-label="Open menu">☰</button><b>${NAV.find((item) => item[0] === current)?.[2] || 'Report details'}</b><span class="sp"></span><button class="btn gold" data-act="nav" data-v="report" style="min-height:40px;padding:.4rem .9rem">Report an issue</button><div class="pm"><button class="pmb" data-act="pm" aria-expanded="${state.menu}"><span class="av">${escapeHtml(initials())}</span><span class="nm">${escapeHtml(fullName())} ▾</span></button>${state.menu ? `<div class="dd" role="menu"><button data-act="nav" data-v="profile">My Profile</button><button data-act="nav" data-v="settings">Account Settings</button><button data-act="nav" data-v="notifs">Notifications</button><button data-act="nav" data-v="help">Help</button><button class="lo" data-act="askout">Log Out</button></div>` : ''}</div></header><main class="pad">${body}</main></div></div><button class="btn gold fab" data-act="nav" data-v="report">＋ Report an issue</button>`;
}
function visibleReports() { return state.reports; }
function statCard(number, label) { return `<div class="card stat"><b>${number}</b>${label}</div>`; }
function dashboard() {
  const reports = visibleReports();
  const counts = reportCounts(reports);
  const staff = isStaff();
  const profile = state.profile;
  return `<h1>Good ${greeting()}, ${escapeHtml(fullName())}!</h1><p class="mut">${escapeHtml(profile.user_identifier || ROLE_LABEL[profile.role])} · ${escapeHtml(profile.academic_program || ROLE_LABEL[profile.role])} · ${escapeHtml(profile.campus)} Campus</p>${staff ? '' : `<div class="cta"><div><h2>Report a facility issue</h2><p>Found a broken chair, damaged equipment, electrical problem, or another facility issue?</p></div><button class="btn gold" data-act="nav" data-v="report">Report an Issue</button></div>`}<h2 style="margin-top:1.4rem">Report summary</h2><div class="grid g4">${statCard(counts.total, 'Total reports')}${statCard(counts.open, 'Open')}${statCard(counts.pending, 'Pending')}${statCard(counts.active, 'Active')}${statCard(counts.progress, 'In progress')}${statCard(counts.resolved, 'Resolved')}</div><h2 style="margin-top:1.4rem">${staff ? 'Latest report' : 'Quick actions'}</h2>${staff ? (reports[0] ? latestReport(reports[0]) : '<div class="card mut">No reports have been submitted yet.</div>') : `<div class="grid g4">${[['report', '＋', 'Report Facility Issue'], ['reports', '☰', 'My Reports'], ['notifs', '🔔', 'Notifications'], ['profile', '☺', 'Profile']].map((item) => `<button class="qa" data-act="nav" data-v="${item[0]}"><span class="av">${item[1]}</span>${item[2]}</button>`).join('')}</div><h2 style="margin-top:1.4rem">Latest report</h2>${reports[0] ? latestReport(reports[0]) : '<div class="card mut">No reports yet. Use “Report an Issue” to send your first one.</div>'}`}`;
}
function latestReport(report) {
  return `<div class="card"><div style="display:flex;justify-content:space-between;gap:.5rem;flex-wrap:wrap"><b>${escapeHtml(report.title)}</b>${badge(report.status)}</div><p class="mut sm">${escapeHtml(report.reportNumber)} · ${escapeHtml(report.room)}</p><button class="btn ghost" data-act="open-report" data-id="${report.id}">Track status</button></div>`;
}
function reportForm() {
  const draft = state.draft;
  return `<h1>Report a facility issue</h1><p class="mut">Fields marked required help staff find and fix the problem faster.</p><div class="card"><h2>Location</h2><div class="grid g2"><div>${select('bldg', 'Building (required)', BLDG, draft.bldg)}</div><div>${select('floor', 'Floor (required)', ['Ground', '1', '2', '3', '4', '5', '6'], draft.floor)}</div></div>${input('room', 'Room / Area (required)', { placeholder: 'e.g. Room 204', value: draft.room, max: 120 })}<h2 style="margin-top:1.2rem">Issue information</h2>${select('cat', 'Issue category (required)', CATS, draft.cat)}${input('title', 'Report title (required)', { placeholder: 'Short summary of the problem', value: draft.title, max: 120 })}<label for="desc">Description (required)</label><textarea id="desc" name="desc" maxlength="3000" placeholder="What is wrong? When did you notice it?">${escapeHtml(draft.desc || '')}</textarea>${fieldError('desc')}<h2 style="margin-top:1.2rem">Upload photo evidence</h2><p class="mut sm">JPG, PNG or WebP, up to 5 MB.</p><div class="drop">${draft.photo ? `<img src="${escapeHtml(state.photoPreview)}" alt="Preview of uploaded photo"><div style="display:flex;gap:.6rem;justify-content:center;flex-wrap:wrap"><label class="btn ghost" style="margin:0" for="ph">Replace photo</label><button class="btn ghost" data-act="remove-photo">Remove photo</button></div>` : '<label class="btn" style="margin:0" for="ph">+ Upload Photo</label>'}<input id="ph" type="file" accept="image/jpeg,image/png,image/webp" style="display:none"></div>${fieldError('photo')}${fieldError('submit')}<button class="btn gold block" style="margin-top:1.4rem" data-act="submit-report" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Submitting…' : 'Submit report'}</button></div>`;
}
function reportList(title) {
  const query = state.reportSearch.toLowerCase();
  const reports = visibleReports().filter((report) => (!query || `${report.title} ${report.reportNumber} ${report.room} ${report.category}`.toLowerCase().includes(query)) && matchesFilter(report, state.filter));
  return `<h1>${title}</h1><p class="mut">${isStaff() ? 'Reports visible to your approved staff account.' : 'Only reports you submitted are shown here.'}</p><input id="report-search" type="search" aria-label="Search reports" placeholder="Search reports" value="${escapeHtml(state.reportSearch)}"><div style="display:flex;gap:.5rem;flex-wrap:wrap;margin:.8rem 0">${['All', 'Open', 'Pending', 'Active', 'In Progress', 'Resolved'].map((filter) => `<button class="btn ${state.filter === filter ? '' : 'ghost'}" data-act="report-filter" data-v="${filter}" style="min-height:36px;padding:.3rem .8rem">${filter}</button>`).join('')}</div>${reports.length ? `<div class="card tw"><table><thead><tr><th>Report</th><th>Location</th><th>Date</th><th>Status</th></tr></thead><tbody>${reports.map((report) => `<tr class="row" tabindex="0" data-act="open-report" data-id="${report.id}"><td><b>${escapeHtml(report.title)}</b><br><span class="sm mut">${escapeHtml(report.reportNumber)} · ${escapeHtml(report.category)}</span></td><td>${escapeHtml(report.building || report.bldg)}, ${escapeHtml(report.floor)}<br>${escapeHtml(report.room)}</td><td>${localDate(report.createdAt)}</td><td>${badge(report.status)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="card" style="text-align:center"><p class="mut">${query || state.filter !== 'All' ? 'No reports match your search or filter.' : 'No reports have been submitted yet.'}</p>${isStaff() ? '' : '<button class="btn gold" data-act="nav" data-v="report">Report an Issue</button>'}</div>`}`;
}
function matchesFilter(report, filter) {
  if (filter === 'All') return true;
  if (filter === 'Open') return report.status !== 'Resolved';
  if (filter === 'Pending') return report.status === 'Submitted';
  if (filter === 'Active') return ['Under Review', 'In Progress'].includes(report.status);
  return report.status === filter;
}
function reportDetail() {
  const report = state.reports.find((item) => item.id === state.selected);
  if (!report) return reportList('My Reports');
  var canManage = isAdmin() || (state.profile.role === 'security_guard' && GUARD_CATS.includes(report.category));
  var owner = state.staffProfiles.find((profile) => profile.user_id === report.owner);
  return `<button class="btn ghost" data-act="nav" data-v="${isStaff() ? 'staff' : 'reports'}" style="margin-bottom:1rem">← Back to reports</button><div class="grid g2" style="align-items:start"><div class="card"><div style="display:flex;justify-content:space-between;gap:.5rem;flex-wrap:wrap"><h2>${escapeHtml(report.title)}</h2>${badge(report.status)}</div><p class="mut sm">${escapeHtml(report.reportNumber)} · ${escapeHtml(report.category)}</p><p>${escapeHtml(report.desc)}</p><p class="sm"><b>Location:</b> ${escapeHtml(report.building || report.bldg)}, floor ${escapeHtml(report.floor)}, ${escapeHtml(report.room)}</p>${isStaff() ? `<p class="sm"><b>Requester:</b> ${escapeHtml(profileName(owner))}${owner?.user_identifier ? ` (${escapeHtml(owner.user_identifier)})` : ''}</p>` : ''}${report.photo ? `<img src="${escapeHtml(report.photo)}" alt="Photo evidence" style="max-width:100%;border-radius:12px">` : '<p class="sm mut">No photo attached.</p>'}<p class="sm mut">Submitted ${localDateTime(report.createdAt)}</p></div><div class="card"><h2>Progress</h2><ol class="tl">${STAGES.map((stage, index) => { const entry = report.history.find((item) => item.stage === index); const cls = index < report.stage || (index === report.stage && index === 3) ? 'done' : index === report.stage ? 'cur' : ''; return `<li class="${cls}"><span class="dot">${cls === 'done' ? '✓' : cls === 'cur' ? '●' : ''}</span><b>${stage}</b><br><span class="sm mut">${entry ? localDateTime(entry.at) : 'Waiting'}</span>${entry?.note ? `<br><span class="sm">${escapeHtml(entry.note)}</span>` : ''}</li>`; }).join('')}</ol>${canManage ? `<hr style="border:0;border-top:1px solid var(--line);margin:1rem 0">${select('new-status', 'Change status', STAGES, report.status)}<label for="update-note">Update note for the student</label><textarea id="update-note" maxlength="2000" style="min-height:70px"></textarea>${fieldError('status')}<button class="btn" style="margin-top:.8rem" data-act="save-status" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Saving…' : 'Save update'}</button>` : isStaff() ? '<p class="sm mut">This report is outside your status-update permissions.</p>' : ''}</div></div>`;
  if (!report) return reportList('My Reports');
  var canManage = isAdmin() || (state.profile.role === 'security_guard' && GUARD_CATS.includes(report.category));
  var owner = state.staffProfiles.find((profile) => profile.user_id === report.owner);
  return `<button class="btn ghost" data-act="nav" data-v="${isStaff() ? 'staff' : 'reports'}" style="margin-bottom:1rem">← Back to reports</button><div class="grid g2" style="align-items:start"><div class="card"><div style="display:flex;justify-content:space-between;gap:.5rem;flex-wrap:wrap"><h2>${escapeHtml(report.title)}</h2>${badge(report.status)}</div><p class="mut sm">${escapeHtml(report.reportNumber)} · ${escapeHtml(report.category)}</p><p>${escapeHtml(report.desc)}</p><p class="sm"><b>Location:</b> ${escapeHtml(report.building || report.bldg)}, floor ${escapeHtml(report.floor)}, ${escapeHtml(report.room)}</p>${isStaff() ? `<p class="sm"><b>Requester:</b> ${escapeHtml(profileName(owner))}${owner?.user_identifier ? ` (${escapeHtml(owner.user_identifier)})` : ''}</p>` : ''}${report.photo ? `<img src="${escapeHtml(report.photo)}" alt="Photo evidence" style="max-width:100%;border-radius:12px">` : '<p class="sm mut">No photo attached.</p>'}<p class="sm mut">Submitted ${localDateTime(report.createdAt)}</p></div><div class="card"><h2>Progress</h2><ol class="tl">${STAGES.map((stage, index) => { const entry = report.history.find((item) => item.stage === index); const cls = index < report.stage || (index === report.stage && index === 3) ? 'done' : index === report.stage ? 'cur' : ''; return `<li class="${cls}"><span class="dot">${cls === 'done' ? '✓' : cls === 'cur' ? '●' : ''}</span><b>${stage}</b><br><span class="sm mut">${entry ? localDateTime(entry.at) : 'Waiting'}</span>${entry?.note ? `<br><span class="sm">${escapeHtml(entry.note)}</span>` : ''}</li>`; }).join('')}</ol>${canManage ? `<hr style="border:0;border-top:1px solid var(--line);margin:1rem 0">${select('new-status', 'Change status', STAGES, report.status)}<label for="update-note">Update note for the student</label><textarea id="update-note" maxlength="2000" style="min-height:70px"></textarea>${fieldError('status')}<button class="btn" style="margin-top:.8rem" data-act="save-status" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Saving…' : 'Save update'}</button>` : isStaff() ? '<p class="sm mut">This report is outside your status-update permissions.</p>' : ''}</div></div>`;
}
function notificationsView() {
  const notices = state.notifications;
  return `<div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap"><h1>Notifications</h1>${notices.some((notice) => !notice.is_read) ? '<button class="btn ghost" data-act="read-all">Mark all as read</button>' : ''}</div><div class="card">${notices.length ? notices.map((notice) => `<div class="nf ${notice.is_read ? '' : 'un'}" tabindex="0" data-act="open-notification" data-id="${notice.id}"><span class="${notice.is_read ? '' : 'pt'}" style="${notice.is_read ? 'width:10px' : ''}"></span><div>${escapeHtml(notice.message)}<br><span class="sm mut">${localDateTime(notice.created_at)}</span></div></div>`).join('') : '<p class="mut">No notifications yet. You will be notified when a report changes status.</p>'}</div>`;
}
function profileView() {
  const profile = state.profile;
  return `<h1>My Profile</h1><div class="card" style="max-width:560px"><div style="display:flex;gap:1rem;align-items:center"><span class="av" style="width:64px;height:64px;font-size:1.6rem">${escapeHtml(initials())}</span><div><h2 style="margin:0">${escapeHtml(fullName())}</h2><span class="badge s3">${ROLE_LABEL[profile.role]}</span></div></div><hr style="border:0;border-top:1px solid var(--line);margin:1rem 0">${[['ID', profile.user_identifier || 'Not provided'], ['School email', profile.school_email], ['Program', profile.academic_program || 'Not applicable'], ['Campus', `${profile.campus} Campus`]].map(([label, item]) => `<p><span class="mut sm">${label}</span><br><b>${escapeHtml(item)}</b></p>`).join('')}<button class="btn ghost" data-act="nav" data-v="settings">Account settings</button></div>`;
}
function settingsView() {
  return `<h1>Account Settings</h1><div class="card" style="max-width:560px"><h2>Change password</h2>${input('np', 'New password', { type: 'password', autocomplete: 'new-password' })}${input('np2', 'Confirm new password', { type: 'password', autocomplete: 'new-password' })}${fieldError('password')}<button class="btn" style="margin-top:1rem" data-act="change-password" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Saving…' : 'Save password'}</button><hr style="border:0;border-top:1px solid var(--line);margin:1.2rem 0"><h2>Appearance</h2><div style="display:flex;gap:.6rem;flex-wrap:wrap"><button class="btn ghost" data-act="theme" data-v="light">Light</button><button class="btn ghost" data-act="theme" data-v="dark">Dark</button><button class="btn ghost" data-act="theme" data-v="">Match device</button></div></div>`;
}
function helpView() {
  const entries = [['How do I report a problem?', 'Select “Report an Issue”, fill in the location and details, add a photo, then submit.'], ['What do the statuses mean?', 'Submitted: received. Under Review: staff are checking it. In Progress: work has started. Resolved: the issue is fixed.'], ['Why do I need a NU email?', 'Use the email domain assigned to your school account and verify the mailbox before logging in.'], ['Who can see my reports?', 'Students can see only their own reports. Approved Facilities staff can review reports; guard status updates are limited to safety, locked classroom, and electrical reports.'], ['Still need help?', 'Contact the Facilities office at your campus.']];
  return `<h1>Help / Support</h1><div class="grid" style="max-width:700px">${entries.map(([question, answer]) => `<details class="card"><summary style="cursor:pointer;font-weight:700">${question}</summary><p class="mut" style="margin:.6rem 0 0">${answer}</p></details>`).join('')}</div>`;
}
function reportDone() {
  const report = state.reports.find((item) => item.id === state.selected) || state.createdReport;
  if (!report) return `<div class="card"><h1>Report submitted</h1><button class="btn" data-act="nav" data-v="reports">View My Reports</button></div>`;
  return `<div class="card" style="text-align:center;max-width:560px"><div class="logo" style="margin:0 auto 1rem;width:64px;height:64px;font-size:1.8rem;background:var(--ok);color:#fff">✓</div><h1>Report submitted successfully!</h1><p class="mut">Your facility report has been received and is now being processed.</p><div style="text-align:left;background:var(--bg);border-radius:14px;padding:1rem;margin:1rem 0"><p><b>Report ID:</b> ${escapeHtml(report.reportNumber)}</p><p><b>Date submitted:</b> ${localDateTime(report.createdAt)}</p><p><b>Location:</b> ${escapeHtml(report.bldg || report.building)}, floor ${escapeHtml(report.floor)}, ${escapeHtml(report.room)}</p><p><b>Issue:</b> ${escapeHtml(report.cat || report.category)}: ${escapeHtml(report.title)}</p><p style="margin:0"><b>Status:</b> ${badge('Submitted')}</p></div><div style="display:flex;gap:.6rem;flex-wrap:wrap;justify-content:center"><button class="btn" data-act="open-report" data-id="${report.id}">View Report Status</button><button class="btn ghost" data-act="nav" data-v="dash">Back to Dashboard</button></div></div>`;
}
function staffReports() {
  const query = state.search.toLowerCase();
  const filters = ['Open', 'All', 'Pending', 'Active', 'In Progress', 'Resolved', ...CATS];
  const reports = visibleReports().filter((report) => {
    const byStatus = ['All', 'Open', 'Pending', 'Active', 'In Progress', 'Resolved'].includes(state.filter)
      ? matchesFilter(report, state.filter) : report.category === state.filter;
    return byStatus && (!query || `${report.title} ${report.reportNumber} ${report.room} ${report.category}`.toLowerCase().includes(query));
  });
  return reports.length ? reports.map((report) => {
    var owner = state.staffProfiles.find((profile) => profile.user_id === report.owner);
    return `<tr class="row" tabindex="0" data-act="select-report" data-id="${report.id}"><td><b>${escapeHtml(report.title)}</b><br><span class="sm mut">${escapeHtml(report.reportNumber)} · ${escapeHtml(report.category)}</span></td><td class="sm">${escapeHtml(report.building || report.bldg)}<br>${escapeHtml(report.room)}</td><td class="sm">${escapeHtml(profileName(owner))}</td><td class="sm">${localDate(report.createdAt)}</td><td>${badge(report.status)}</td></tr>`;
  }).join('') : '<tr><td colspan="5" class="mut">No reports match. Clear the search or choose another filter.</td></tr>';
}
function staffDashboard() {
  const reports = visibleReports();
  const counts = reportCounts(reports);
  const selected = reports.find((report) => report.id === state.selected);
  const filters = ['Open', 'All', 'Pending', 'Active', 'In Progress', 'Resolved', ...CATS];
  const owner = selected && state.staffProfiles.find((profile) => profile.user_id === selected.owner);
  const canManage = selected && (isAdmin() || (state.profile.role === 'security_guard' && GUARD_CATS.includes(selected.category)));
  return `<div style="background:var(--sb);color:#fff;padding:.8rem 1.2rem;display:flex;align-items:center;gap:1rem;flex-wrap:wrap"><div class="brand"><span class="logo">NU</span>NU Buddy ${state.profile.role === 'security_guard' ? 'Security' : 'Facilities'}</div><span style="flex:1"></span><span class="sm">${escapeHtml(fullName())} · ${ROLE_LABEL[state.profile.role]}</span><button class="btn gold" data-act="askout" style="min-height:40px">Log Out</button></div><div class="pad" style="max-width:1200px"><h1>Good ${greeting()}, ${escapeHtml(fullName())}.</h1><p class="mut">Review reports and follow their status through resolution.</p><div class="grid g4" style="margin-bottom:1rem">${[['All', 'Total reports', counts.total], ['Open', 'Open', counts.open], ['Pending', 'Pending', counts.pending], ['Active', 'Active', counts.active], ['In Progress', 'In Progress', counts.progress], ['Resolved', 'Resolved', counts.resolved]].map(([filter, label, count]) => `<button class="card stat stb ${state.filter === filter ? 'on' : ''}" data-act="staff-filter" data-v="${filter}" aria-pressed="${state.filter === filter}"><b>${count}</b>${label}</button>`).join('')}</div><div class="qg"><div class="card" id="qlist"><h2>Recent reports</h2><div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.8rem">${filters.map((filter) => `<button class="btn ${state.filter === filter ? '' : 'ghost'}" data-act="staff-filter" data-v="${escapeHtml(filter)}" style="min-height:36px;padding:.3rem .8rem;font-size:.85rem">${escapeHtml(filter)}</button>`).join('')}</div><input id="sq" type="search" placeholder="Search reports" aria-label="Search reports" value="${escapeHtml(state.search)}"><div class="tw" style="margin-top:.6rem"><table><thead><tr><th>Request</th><th>Location</th><th>Requester</th><th>Received</th><th>Status</th></tr></thead><tbody id="qbody">${staffReports()}</tbody></table></div></div>${selected ? `<div class="card"><h2>${escapeHtml(selected.title)}</h2><p class="mut sm">${escapeHtml(selected.reportNumber)} · ${escapeHtml(selected.category)} · ${badge(selected.status)}</p><p>${escapeHtml(selected.desc)}</p><p class="sm"><b>Location:</b> ${escapeHtml(selected.building || selected.bldg)}, floor ${escapeHtml(selected.floor)}, ${escapeHtml(selected.room)}<br><b>Requester:</b> ${escapeHtml(profileName(owner))}${owner?.user_identifier ? ` (${escapeHtml(owner.user_identifier)})` : ''}</p>${selected.photo ? `<img src="${escapeHtml(selected.photo)}" alt="Uploaded evidence" style="max-width:100%;border-radius:12px">` : '<p class="sm mut">No photo attached.</p>'}${canManage ? `${select('ns', 'Change status', STAGES, selected.status)}<label for="nc">Update for the student</label><textarea id="nc" maxlength="2000" style="min-height:70px"></textarea>${fieldError('status')}<div style="display:flex;gap:.6rem;margin-top:.8rem;flex-wrap:wrap"><button class="btn" data-act="staff-update" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Saving…' : 'Save update'}</button></div>` : '<p class="sm mut">This report is outside your status-update permissions.</p>'}</div>` : '<div class="card mut">Select a report to see its photo and location, change its status, or add an update.</div>'}</div>${isAdmin() ? approvalsPanel() : ''}</div>`;
}
function approvalsPanel() {
  const staffAccounts = state.staffProfiles.filter((profile) => ['facility_admin', 'security_guard'].includes(profile.role));
  return `<div class="card" style="margin-top:1rem"><h2>Staff account approvals${state.pendingProfiles.length ? ` (${state.pendingProfiles.length})` : ''}</h2>${state.pendingProfiles.length ? state.pendingProfiles.map((profile) => `<div class="nf" style="align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:200px"><b>${escapeHtml(profile.full_name)}</b><br><span class="sm mut">${escapeHtml(profile.school_email)} · ${escapeHtml(profile.user_identifier)} · ${escapeHtml(profile.campus)} Campus · ${ROLE_LABEL[profile.role]}</span></div><button class="btn" data-act="approve-account" data-id="${profile.user_id}">Approve</button><button class="btn ghost" data-act="reject-account" data-id="${profile.user_id}">Reject</button></div>`).join('') : '<p class="mut">No staff accounts are waiting for approval.</p>'}<h2 style="margin-top:1rem">Staff accounts</h2><div class="tw"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>${staffAccounts.map((profile) => `<tr><td>${escapeHtml(profile.full_name)}</td><td class="sm">${escapeHtml(profile.school_email)}</td><td class="sm">${ROLE_LABEL[profile.role]}</td></tr>`).join('') || '<tr><td colspan="3" class="mut">No other staff accounts.</td></tr>'}</tbody></table></div><p class="sm mut">New staff accounts register and verify their own school email. Administrators approve access here; this browser never creates accounts or assigns roles.</p></div>`;
}
function render() {
  const app = $('#app');
  if (!app) return;
  if (!isSupabaseConfigured) { app.innerHTML = configScreen(); return; }
  let page;
  if (!state.user) {
    page = ({ login, register: registration, forgot, reset: resetPassword })[state.view] || login;
    app.innerHTML = page();
    return;
  }
  if (state.view === 'verify-required') page = verificationRequired();
  else if (state.view === 'pending') page = pending();
  else if (state.view === 'profile-error') page = authFrame(`<h1 style="margin-top:1rem">Could not load your profile</h1><p class="err">${escapeHtml(state.viewError)}</p><button class="btn block" data-act="logout">Log out</button>`);
  else {
    const protectedView = ({ dash: dashboard, report: reportForm, done: reportDone, reports: () => reportList('My Reports'), status: () => reportList('Report Status'), detail: reportDetail, notifs: notificationsView, profile: profileView, settings: settingsView, help: helpView, staff: staffDashboard })[state.view] || (isStaff() ? staffDashboard : dashboard);
    const refreshAlert = state.viewError ? `<div class="err" role="alert" style="margin:0 0 1rem">${escapeHtml(state.viewError)}</div>` : '';
    page = shell(`${refreshAlert}${protectedView()}`);
  }
  app.innerHTML = page + (state.modal ? '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="logout-heading"><div class="card"><h2 id="logout-heading">Log out of your account?</h2><p class="mut">Are you sure you want to end your session?</p><div style="display:flex;gap:.6rem;justify-content:flex-end"><button class="btn ghost" data-act="cancel">Cancel</button><button class="btn danger" data-act="logout">Log Out</button></div></div></div>' : '') + (state.toast ? `<div role="status" style="position:fixed;left:50%;bottom:5rem;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:.7rem 1.1rem;border-radius:12px;z-index:40">${escapeHtml(state.toast)}</div>` : '');
}
function persistReportDraft() {
  ['bldg', 'floor', 'room', 'cat', 'title', 'desc'].forEach((id) => { if ($('#' + id)) state.draft[id] = $('#' + id).value; });
}
function strongPassword(password) { return password.length >= 8 && /[A-Z]/.test(password) && /\d/.test(password); }
function passwordError(password) {
  const missing = [password.length < 8 && '8 or more characters', !/[A-Z]/.test(password) && 'an uppercase letter', !/\d/.test(password) && 'a number'].filter(Boolean);
  return missing.length ? `Password needs ${missing.join(', ')}.` : '';
}
function normalizeRegForm() {
  const form = state.reg;
  Object.assign(form, {
    fullName: value('rname'), identifier: value('rid'), campus: value('rcampus'),
    email: value('rem').toLowerCase(), college: value('rcol'), program: value('rpg'),
    otherProgram: value('rpo'),
  });
}
function validateRegistration() {
  const form = state.reg;
  const issues = {};
  const domain = ROLE_DOMAINS[form.role];
  if (!form.fullName || form.fullName.length > 120) issues.register = 'Enter your full name (up to 120 characters).';
  else if (!form.identifier || form.identifier.length > 40) issues.register = 'Enter your student or employee ID (up to 40 characters).';
  else if (!form.campus || !CAMPUSES.includes(form.campus)) issues.register = 'Select your campus.';
  else if (schoolRoleForEmail(form.email) !== form.role) issues.register = `Use your assigned ${domain} email address.`;
  else if (form.role === 'student' && (!form.college || !form.program || (form.program === 'Other (not listed)' && !form.otherProgram))) issues.register = 'Choose your college and program.';
  state.err = issues;
  return !Object.keys(issues).length;
}
async function go(view, selected) {
  if (!state.user || !state.profile || state.profile.account_status !== 'approved') { state.view = 'login'; render(); return; }
  if (isStaff() && view === 'report') { view = 'staff'; state.selected = null; }
  if (!isStaff() && view === 'staff') view = 'dash';
  state.view = view;
  if (selected !== undefined) state.selected = selected;
  state.menu = false; state.drawer = false; state.err = {}; state.viewError = '';
  if (view === 'report') { state.draft = {}; state.photoPreview = ''; }
  if (['dash', 'reports', 'status', 'detail', 'notifs', 'staff'].includes(view)) {
    try { await refreshData(); } catch (error) { state.viewError = errorText(error); }
  }
  render();
  window.scrollTo(0, 0);
}
async function submitRegistration() {
  const form = state.reg;
  const password = $('#pw1')?.value || '';
  const confirmation = $('#pw2')?.value || '';
  const issue = passwordError(password) || (password !== confirmation ? 'Passwords do not match.' : '');
  if (issue) { state.err = { password: issue }; render(); return; }
  state.busy = true; state.err = {}; render();
  const { error } = await supabase.auth.signUp({
    email: form.email,
    password,
    options: {
      emailRedirectTo: `${location.origin}${location.pathname}`,
      data: {
        full_name: form.fullName,
        user_identifier: form.identifier,
        campus: form.campus,
        academic_program: form.role === 'student' ? (form.program === 'Other (not listed)' ? form.otherProgram : form.program) : null,
      },
    },
  });
  state.busy = false;
  if (error) { state.err = { register: errorText(error) }; render(); return; }
  form.step = 3;
  render();
}
async function submitReport() {
  if (state.busy) return;
  persistReportDraft();
  const draft = state.draft;
  const issues = {};
  if (!draft.bldg) issues.bldg = 'Select a building.';
  if (!draft.floor) issues.floor = 'Select a floor.';
  if (!draft.room || draft.room.length > 120) issues.room = 'Enter a room or area (up to 120 characters).';
  if (!draft.cat) issues.cat = 'Select an issue category.';
  if (!draft.title || draft.title.length > 120) issues.title = 'Enter a short title (up to 120 characters).';
  if (!draft.desc || draft.desc.length > 3000) issues.desc = 'Describe the problem (up to 3,000 characters).';
  state.err = issues;
  if (Object.keys(issues).length) { render(); document.querySelector('.err')?.scrollIntoView({ block: 'center' }); return; }
  state.busy = true; render();
  let photoPath = null;
  try {
    if (draft.photo) {
      const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[draft.photo.type];
      if (!ext || draft.photo.size > 5 * 1024 * 1024) throw new Error('Choose a JPG, PNG, or WebP photo no larger than 5 MB.');
      photoPath = `${state.user.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(photoBucket).upload(photoPath, draft.photo, { contentType: draft.photo.type, upsert: false });
      if (error) throw error;
    }
    const { data, error } = await supabase.from('reports').insert({
      owner_id: state.user.id, title: draft.title, category: draft.cat, description: draft.desc,
      building: draft.bldg, floor: draft.floor, room: draft.room, photo_path: photoPath,
    }).select('id, report_number, created_at').single();
    if (error) throw error;
    state.draft = {}; state.photoPreview = ''; state.busy = false;
    state.selected = data.id; state.view = 'done';
    state.createdReport = { ...data, createdAt: data.created_at, bldg: draft.bldg, floor: draft.floor, room: draft.room, cat: draft.cat, title: draft.title };
    render(); window.scrollTo(0, 0);
    try { await refreshData(); render(); } catch (refreshError) { state.viewError = errorText(refreshError); }
  } catch (error) {
    if (photoPath) await supabase.storage.from(photoBucket).remove([photoPath]);
    state.busy = false; state.err = { submit: errorText(error) }; render();
  }
}
async function saveStatus(report) {
  const status = value('ns');
  const note = value('nc') || value('update-note');
  if (!STAGES.includes(status)) { state.err = { status: 'Choose a valid report status.' }; render(); return; }
  if (stageIndex(status) < report.stage) { state.err = { status: 'Report status cannot move backwards.' }; render(); return; }
  state.busy = true; state.err = {}; render();
  const { error } = await supabase.rpc('update_report_status', { p_report_id: report.id, p_status: status, p_note: note || null });
  state.busy = false;
  if (error) { state.err = { status: errorText(error) }; render(); return; }
  try { await refreshData(); } catch (refreshError) { state.viewError = errorText(refreshError); }
  render(); showToast('Report update saved.');
}
async function logout() {
  state.modal = false; state.busy = true; render();
  const { error } = await supabase.auth.signOut();
  state.busy = false;
  if (error) { state.err = { login: errorText(error) }; render(); return; }
  state.user = null; state.profile = null; state.reports = []; state.notifications = [];
  state.view = 'login'; render();
}

document.addEventListener('input', (event) => {
  if (state.view === 'report' && event.target.id !== 'ph') persistReportDraft();
  if (event.target.id === 'sq') { state.search = event.target.value; const body = $('#qbody'); if (body) body.innerHTML = staffReports(); }
  if (event.target.id === 'report-search') {
    state.reportSearch = event.target.value;
    if (['reports', 'status'].includes(state.view)) {
      const position = event.target.selectionStart;
      render();
      const search = $('#report-search');
      search?.focus();
      search?.setSelectionRange(position, position);
    }
  }
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'ph') {
    const file = event.target.files?.[0];
    if (!file) return;
    persistReportDraft();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { state.err = { photo: 'Choose a JPG, PNG or WebP image.' }; render(); return; }
    if (file.size > 5 * 1024 * 1024) { state.err = { photo: 'This image is larger than 5 MB. Choose a smaller photo.' }; render(); return; }
    state.err = {}; state.draft.photo = file; state.photoPreview = URL.createObjectURL(file); render();
  } else if (event.target.id === 'rcol') {
    normalizeRegForm(); state.reg.program = ''; render();
  } else if (state.view === 'report') persistReportDraft();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.matches('tr.row,.nf')) event.target.click();
  if (event.key === 'Escape' && state.modal) { state.modal = false; render(); }
});
document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-act]');
  if (!target) { if (state.menu) { state.menu = false; render(); } return; }
  const action = target.dataset.act;
  const id = target.dataset.id;
  const selectedValue = target.dataset.v;
  if (target.tagName === 'A') event.preventDefault();
  if (action !== 'pm' && state.menu && action !== 'nav' && action !== 'askout') state.menu = false;
  switch (action) {
    case 'eye': { const field = $('#' + target.dataset.for); if (field) { field.type = field.type === 'password' ? 'text' : 'password'; target.textContent = field.type === 'password' ? 'Show' : 'Hide'; } break; }
    case 'login': {
      const email = value('lid').toLowerCase(); state.loginEmail = email;
      if (!schoolRoleForEmail(email)) { state.err = { login: 'Use your assigned NU school email domain.' }; render(); break; }
      state.busy = true; state.err = {}; render();
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: $('#lpw')?.value || '' });
      state.busy = false;
      if (error) { state.err = { login: errorText(error) }; render(); }
      else await loadProfile(data.session);
      break;
    }
    case 'register': state.reg = { step: 1, role: 'student' }; state.err = {}; state.view = 'register'; render(); break;
    case 'reg-role': normalizeRegForm(); state.reg.role = selectedValue; state.err = {}; render(); break;
    case 'register-next':
      normalizeRegForm();
      if (validateRegistration()) { state.reg.step = 2; state.err = {}; render(); }
      break;
    case 'register-back': state.reg.step = 1; state.err = {}; render(); break;
    case 'register-submit': await submitRegistration(); break;
    case 'to-login': state.view = 'login'; state.err = {}; render(); break;
    case 'forgot': state.view = 'forgot'; state.err = {}; render(); break;
    case 'verify-help': state.err = { login: 'Students use @students.nu.edu.ph, Facilities staff use @staff.nu.edu.ph, and security guards use @guard.nu.edu.ph. Verify your mailbox before logging in.' }; render(); break;
    case 'send-reset': {
      state.resetEmail = value('reset-email').toLowerCase();
      if (!schoolRoleForEmail(state.resetEmail)) { state.err = { reset: 'Enter a valid NU school email address.' }; render(); break; }
      state.busy = true; state.err = {}; render();
      const { error } = await supabase.auth.resetPasswordForEmail(state.resetEmail, { redirectTo: `${location.origin}${location.pathname}` });
      state.busy = false;
      if (error) { state.err = { reset: errorText(error) }; render(); }
      else { state.view = 'login'; render(); showToast('If that account exists, a recovery email has been sent.'); }
      break;
    }
    case 'save-reset': {
      const password = $('#new-password')?.value || ''; const confirmation = $('#confirm-password')?.value || '';
      const issue = passwordError(password) || (password !== confirmation ? 'Passwords do not match.' : '');
      if (issue) { state.err = { reset: issue }; render(); break; }
      state.busy = true; render();
      const { error } = await supabase.auth.updateUser({ password }); state.busy = false;
      if (error) { state.err = { reset: errorText(error) }; render(); }
      else { state.view = isStaff() ? 'staff' : 'dash'; render(); showToast('Password updated.'); }
      break;
    }
    case 'nav': await go(selectedValue, selectedValue === 'report' ? null : undefined); break;
    case 'drawer': state.drawer = !state.drawer; render(); break;
    case 'pm': state.menu = !state.menu; render(); break;
    case 'askout': state.menu = false; state.drawer = false; state.modal = true; render(); break;
    case 'cancel': state.modal = false; render(); break;
    case 'logout': await logout(); break;
    case 'remove-photo': persistReportDraft(); state.draft.photo = null; state.photoPreview = ''; state.err = {}; render(); break;
    case 'submit-report': await submitReport(); break;
    case 'open-report': state.selected = id; await go(isStaff() ? 'detail' : 'detail', id); break;
    case 'open-notification': {
      const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', id).eq('recipient_id', state.user.id);
      if (error) { showToast(errorText(error)); break; }
      const notice = state.notifications.find((item) => item.id === id);
      if (notice) { state.selected = notice.report_id; await go('detail', notice.report_id); }
      break;
    }
    case 'read-all': {
      const { error } = await supabase.from('notifications').update({ is_read: true }).eq('recipient_id', state.user.id).eq('is_read', false);
      if (error) showToast(errorText(error)); else { await refreshData(); render(); }
      break;
    }
    case 'change-password': {
      const password = $('#np')?.value || ''; const confirmation = $('#np2')?.value || '';
      const issue = passwordError(password) || (password !== confirmation ? 'Passwords do not match.' : '');
      if (issue) { state.err = { password: issue }; render(); break; }
      state.busy = true; render(); const { error } = await supabase.auth.updateUser({ password }); state.busy = false;
      if (error) { state.err = { password: errorText(error) }; render(); } else { state.err = {}; render(); showToast('Password saved.'); }
      break;
    }
    case 'theme':
      if (selectedValue) { document.documentElement.dataset.theme = selectedValue; localStorage.setItem('nubuddy-theme', selectedValue); }
      else { delete document.documentElement.dataset.theme; localStorage.removeItem('nubuddy-theme'); }
      break;
    case 'select-report': state.selected = id; render(); break;
    case 'staff-filter': state.filter = selectedValue; render(); { const list = $('#qlist'); if (list && innerWidth <= 860) list.scrollIntoView({ block: 'start' }); } break;
    case 'report-filter': state.filter = selectedValue; render(); break;
    case 'staff-update': {
      const report = state.reports.find((item) => item.id === state.selected); if (report) await saveStatus(report); break;
    }
    case 'save-status': {
      const report = state.reports.find((item) => item.id === state.selected); if (report) await saveStatus(report); break;
    }
    case 'approve-account':
    case 'reject-account': {
      if (!isAdmin()) break;
      state.busy = true; render();
      const { error } = await supabase.rpc('review_staff_account', { p_user_id: id, p_approve: action === 'approve-account' });
      state.busy = false;
      if (error) showToast(errorText(error)); else { await refreshData(); render(); showToast(action === 'approve-account' ? 'Account approved.' : 'Account rejected.'); }
      break;
    }
  }
});

const savedTheme = localStorage.getItem('nubuddy-theme');
if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.dataset.theme = savedTheme;
if (isSupabaseConfigured) {
  supabase.auth.onAuthStateChange((eventName, session) => {
    window.setTimeout(() => { void loadProfile(session, eventName); }, 0);
  });
  supabase.auth.getSession().then(({ data, error }) => {
    if (error) { state.viewError = errorText(error); render(); }
    else void loadProfile(data.session);
  });
}
window.setInterval(() => {
  if (['dash', 'staff'].includes(state.view)) render();
}, 30000);
render();