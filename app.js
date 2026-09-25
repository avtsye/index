const CFG = window.APP_CONFIG || { githubUser: 'avtsye', cacheMinutes: 20, hiddenTopics: ['hide-homepage'], featuredTopic: 'featured' };
const USER = CFG.githubUser;
const API = 'https://api.github.com';
const TTL = Math.max(1, Number(CFG.cacheMinutes) || 20) * 60000;
const $ = selector => document.querySelector(selector);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const niceDate = value => new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value));
const daysAgo = value => { const diff = Math.max(0, Date.now() - new Date(value).getTime()); if (diff < 3600000) return 'בשעה האחרונה'; if (diff < 86400000) return `לפני ${Math.floor(diff / 3600000)} שעות`; if (diff < 604800000) return `לפני ${Math.floor(diff / 86400000)} ימים`; return niceDate(value); };
const validURL = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; } catch { return null; } };
const state = { profile: null, repos: [], events: [], visible: 12, loadedAt: null, stale: false, loading: false, loadId: 0, controller: null };
let toastTimer;
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3300); }
function highlight(value, query) { const source = String(value ?? ''); if (!query) return escapeHTML(source); const at = source.toLocaleLowerCase().indexOf(query); return at < 0 ? escapeHTML(source) : escapeHTML(source.slice(0, at)) + '<mark>' + escapeHTML(source.slice(at, at + query.length)) + '</mark>' + escapeHTML(source.slice(at + query.length)); }
function cached(key, allowExpired = false) { try { const item = JSON.parse(localStorage.getItem('home:' + key)); return item && (allowExpired || Date.now() - item.time < TTL) ? item : null; } catch { return null; } }
function cache(key, value) { try { localStorage.setItem('home:' + key, JSON.stringify({ time: Date.now(), value })); } catch { /* Private browsing may disable storage. */ } }
async function request(path, { refresh = false, optional = false } = {}) {
  const hit = !refresh && cached(path);
  if (hit) return hit.value;
  try {
    const response = await fetch(API + path, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.any([state.controller?.signal || new AbortController().signal, AbortSignal.timeout(18000)]) });
    if (!response.ok) { if (response.status === 403 || response.status === 429) throw Error('rate_limit'); if (optional && response.status === 404) return null; throw Error('http_' + response.status); }
    const value = await response.json(); cache(path, value); return value;
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    const backup = cached(path, true);
    if (backup) { state.stale = true; return backup.value; }
    if (optional) return null;
    throw error;
  }
}
async function allRepositories(refresh) {
  const result = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await request(`/users/${encodeURIComponent(USER)}/repos?per_page=100&sort=updated&type=owner&page=${page}`, { refresh });
    if (!Array.isArray(batch)) throw Error('invalid_data');
    result.push(...batch);
    if (batch.length < 100) break;
  }
  return result;
}
function visibleRepos() { const hidden = CFG.hiddenTopics || []; return state.repos.filter(repo => !repo.archived && !hidden.some(topic => (repo.topics || []).includes(topic))); }
function getFilters() { return { q: $('#q').value.trim().toLocaleLowerCase(), topic: $('#topic').value, lang: $('#lang').value, sort: $('#sort').value, siteOnly: $('#siteOnly').checked }; }
function restoreFilters() { const p = new URLSearchParams(location.search); $('#q').value = p.get('search') || ''; $('#topic').dataset.requested = p.get('topic') || ''; $('#lang').dataset.requested = p.get('language') || ''; $('#sort').value = ['updated', 'stars', 'name', 'activity'].includes(p.get('sort')) ? p.get('sort') : 'updated'; $('#siteOnly').checked = p.get('site') === '1'; }
function syncURL() { const f = getFilters(), p = new URLSearchParams(); if (f.q) p.set('search', $('#q').value.trim()); if (f.topic) p.set('topic', f.topic); if (f.lang) p.set('language', f.lang); if (f.sort !== 'updated') p.set('sort', f.sort); if (f.siteOnly) p.set('site', '1'); history.replaceState({}, '', location.pathname + (p.size ? '?' + p : '') + location.hash); }
function applyTheme() { let saved = null; try { saved = localStorage.getItem('home:theme'); } catch {} const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; document.documentElement.dataset.theme = dark ? 'dark' : 'light'; $('#theme').textContent = dark ? '☀' : '☾'; }
function safeStorageTheme(value) { try { localStorage.setItem('home:theme', value); } catch {} applyTheme(); }
function filterOptions() {
  const repos = visibleRepos(), topicCounts = new Map(), languages = new Set();
  repos.forEach(repo => { if (repo.language) languages.add(repo.language); (repo.topics || []).filter(topic => ![CFG.featuredTopic, ...(CFG.hiddenTopics || [])].includes(topic)).forEach(topic => topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1)); });
  const topics = [...topicCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  $('#topic').innerHTML = '<option value="">כל הנושאים</option>' + topics.map(([topic, count]) => `<option value="${escapeHTML(topic)}">${escapeHTML(topic)} (${count})</option>`).join('');
  $('#lang').innerHTML = '<option value="">כל השפות</option>' + [...languages].sort().map(lang => `<option value="${escapeHTML(lang)}">${escapeHTML(lang)}</option>`).join('');
  $('#topic').value = $('#topic').dataset.requested || ''; $('#lang').value = $('#lang').dataset.requested || '';
  $('#topicChips').innerHTML = topics.slice(0, 7).map(([topic]) => `<button class="chip" type="button" data-topic="${escapeHTML(topic)}">${escapeHTML(topic)}</button>`).join('');
}
function card(repo) {
  const featured = (repo.topics || []).includes(CFG.featuredTopic), site = validURL(repo.homepage), updated = daysAgo(repo.pushed_at), topics = (repo.topics || []).filter(topic => ![CFG.featuredTopic, ...(CFG.hiddenTopics || [])].includes(topic)).slice(0, 3);
  return `<article class="card ${featured ? 'featured' : ''}"><div class="card-top"><span class="repoicon" aria-hidden="true">${featured ? '★' : '⌘'}</span>${featured ? '<span class="featured-tag">פרויקט נבחר</span>' : ''}</div><h3 dir="auto">${highlight(repo.name, getFilters().q)}</h3><p>${highlight(repo.description || 'צפו בפרטי הפרויקט ובקוד המקור.', getFilters().q)}</p><div class="card-tags">${repo.language ? `<span>${escapeHTML(repo.language)}</span>` : ''}${topics.map(topic => `<span>${escapeHTML(topic)}</span>`).join('')}</div><div class="card-actions">${site ? `<a class="primary small" href="${escapeHTML(site)}" target="_blank" rel="noopener noreferrer">פתיחת האתר ↗</a>` : `<a class="primary small" href="${escapeHTML(repo.html_url)}" target="_blank" rel="noopener noreferrer">פתיחה ב־GitHub ↗</a>`}<button type="button" class="secondary small" data-action="details" data-repo="${escapeHTML(repo.name)}">פרטים</button><button type="button" class="quiet small" data-action="share" data-repo="${escapeHTML(repo.name)}" aria-label="שיתוף ${escapeHTML(repo.name)}">שיתוף</button></div><div class="card-foot"><time datetime="${escapeHTML(repo.pushed_at)}" title="${niceDate(repo.pushed_at)}">עודכן ${updated}</time><span aria-label="${repo.stargazers_count} כוכבים">★ ${repo.stargazers_count}</span></div></article>`;
}
function renderRepos() {
  const f = getFilters(); let rows = visibleRepos().filter(repo => {
    const haystack = [repo.name, repo.description || '', ...(repo.topics || [])].join(' ').toLocaleLowerCase();
    return haystack.includes(f.q) && (!f.topic || (repo.topics || []).includes(f.topic)) && (!f.lang || repo.language === f.lang) && (!f.siteOnly || !!validURL(repo.homepage));
  });
  const activityCount = repo => state.events.filter(event => event.type === 'PushEvent' && event.repo.name === repo.full_name && Date.now() - new Date(event.created_at) < 30 * 86400000).length;
  rows.sort((a, b) => f.sort === 'stars' ? b.stargazers_count - a.stargazers_count : f.sort === 'name' ? a.name.localeCompare(b.name, 'he') : f.sort === 'activity' ? activityCount(b) - activityCount(a) || new Date(b.pushed_at) - new Date(a.pushed_at) : new Date(b.pushed_at) - new Date(a.pushed_at));
  $('#resultCount').textContent = `${rows.length} פרויקטים${state.stale ? ' · מוצגים נתונים שמורים' : ''}`;
  $('#clearFilters').hidden = !(f.q || f.topic || f.lang || f.siteOnly || f.sort !== 'updated');
  document.querySelectorAll('.chip').forEach(button => button.classList.toggle('active', button.dataset.topic === f.topic));
  $('#repos').innerHTML = rows.slice(0, state.visible).map(card).join('') || '<div class="empty">לא נמצאו פרויקטים מתאימים. אפשר לשנות את החיפוש או לנקות את הסינון.<br><button type="button" class="secondary" data-action="clear">ניקוי סינון</button></div>';
  $('#more').hidden = rows.length <= state.visible;
  syncURL();
}
function renderProfile() {
  const user = state.profile; if (!user) return;
  const display = user.name || user.login;
  document.title = `${display} — פרויקטים`;
  $('#heroTitle').innerHTML = `פרויקטים וכלים<br><span>של ${escapeHTML(display)}</span>`;
  $('#name').textContent = display; $('#navName').textContent = display; $('#login').textContent = '@' + user.login;
  $('#bio').textContent = user.bio || 'פרויקטים וכלים שמתעדכנים ישירות מהפרופיל שלי ב־GitHub.';
  $('#aboutText').textContent = user.bio || 'כאן אפשר למצוא את הפרויקטים, הכלים והקוד שאני מפרסם ב־GitHub.';
  ['avatar', 'navAvatar'].forEach(id => { const image = $('#' + id); image.src = user.avatar_url; image.alt = id === 'avatar' ? `תמונת הפרופיל של ${display}` : ''; });
  $('#repoCount').textContent = user.public_repos; $('#followers').textContent = user.followers;
  $('#updatedThisWeek').textContent = state.repos.filter(repo => Date.now() - new Date(repo.pushed_at) < 7 * 86400000).length;
  ['profileLink', 'aboutGitHub', 'footerGh'].forEach(id => $('#' + id).href = user.html_url);
}
const eventNames = { PushEvent: 'עדכון קוד', CreateEvent: 'יצירת פרויקט או ענף', ReleaseEvent: 'פרסום גרסה', IssuesEvent: 'עדכון פנייה', PullRequestEvent: 'עדכון בקשת שינוי', ForkEvent: 'יצירת עותק', WatchEvent: 'סימון בכוכב', IssueCommentEvent: 'תגובה לפנייה' };
function renderActivity() {
  const days = Number($('#activityRange').value); const events = state.events.filter(event => Date.now() - new Date(event.created_at) < days * 86400000 && eventNames[event.type]).slice(0, 18);
  const repos = visibleRepos(); $('#dashStats').innerHTML = `<div><b>${repos.filter(repo => Date.now() - new Date(repo.pushed_at) < days * 86400000).length}</b><span>מאגרים שעודכנו</span></div><div><b>${repos.reduce((total, repo) => total + repo.stargazers_count, 0)}</b><span>כוכבים</span></div><div><b>${repos.reduce((total, repo) => total + repo.open_issues_count, 0)}</b><span>פניות פתוחות</span></div>`;
  $('#activity').innerHTML = events.map(event => `<div class="event"><div><b>${escapeHTML(eventNames[event.type])}</b><span dir="auto">${escapeHTML(event.repo.name.replace(USER + '/', ''))}</span></div><time datetime="${escapeHTML(event.created_at)}" title="${niceDate(event.created_at)}">${daysAgo(event.created_at)}</time></div>`).join('') || '<div class="empty">אין פעילות ציבורית להצגה בטווח שנבחר.</div>';
}
async function load(refresh = false) {
  if (state.loading && !refresh) return; if (state.loading) state.controller?.abort();
  const loadId = ++state.loadId; state.controller = new AbortController(); state.loading = true; state.stale = false; $('#refresh').disabled = true; $('#refresh').textContent = 'מרענן…';
  try {
    const [profile, repos, events] = await Promise.all([request(`/users/${encodeURIComponent(USER)}`, { refresh }), allRepositories(refresh), request(`/users/${encodeURIComponent(USER)}/events/public?per_page=100`, { refresh, optional: true })]);
    if (loadId !== state.loadId) return;
    state.profile = profile; state.repos = repos; state.events = Array.isArray(events) ? events : [];
    if (!state.stale) { state.loadedAt = Date.now(); cache('last-good-load', state.loadedAt); }
    else { state.loadedAt = cached('last-good-load', true)?.value || null; }
    filterOptions(); renderProfile(); renderRepos(); renderActivity();
    $('#updated').textContent = state.loadedAt ? (state.stale ? 'נתונים שמורים מ־' : 'עודכן ב־') + new Intl.DateTimeFormat('he-IL', { dateStyle: state.stale ? 'short' : undefined, timeStyle: 'short' }).format(state.loadedAt) : 'אין זמן עדכון ידוע';
    $('#dataState').textContent = state.stale ? 'מוצגים נתונים שמורים; ניתן לנסות לרענן' : 'הנתונים עדכניים';
    const direct = new URLSearchParams(location.search).get('project'); if (direct) openRepo(direct, false);
  } catch (error) {
    if (loadId !== state.loadId || error.name === 'AbortError') return;
    const message = error.message === 'rate_limit' ? 'GitHub מגביל כרגע את מספר הבקשות. נסו שוב מאוחר יותר.' : 'לא ניתן לטעון כעת נתונים מ־GitHub. בדקו את החיבור ונסו שוב.';
    $('#repos').innerHTML = `<div class="empty">${message}<br><button type="button" class="secondary" data-action="retry">ניסיון חוזר</button></div>`;
    $('#resultCount').textContent = 'הטעינה נכשלה'; $('#dataState').textContent = 'לא ניתן לטעון נתונים';
  } finally { if (loadId === state.loadId) { state.loading = false; $('#refresh').disabled = false; $('#refresh').textContent = 'רענון'; } }
}
function openDialog(dialog) { dialog.showModal(); }
async function openRepo(name, updateURL = true) {
  const repo = state.repos.find(item => item.name === name); if (!repo) return;
  const dialog = $('#details'); $('#detailsTitle').textContent = repo.name; document.title = `${repo.name} — ${state.profile?.name || USER}`;
  document.querySelector('meta[name=description]').content = repo.description || 'פרויקט ב־GitHub';
  $('#detailsBody').innerHTML = `<p>${escapeHTML(repo.description || 'אין תיאור לפרויקט זה.')}</p><p class="loading">טוען פרטים נוספים…</p>`;
  if (!dialog.open) openDialog(dialog);
  if (updateURL) { const url = new URL(location.href); url.searchParams.set('project', name); history.pushState({}, '', url); }
  const base = `/repos/${encodeURIComponent(USER)}/${encodeURIComponent(name)}`;
  const [release, languages, readme, runs] = await Promise.all([request(base + '/releases/latest', { optional: true }), request(base + '/languages', { optional: true }), request(base + '/readme', { optional: true }), request(base + '/actions/runs?per_page=1', { optional: true })]);
  if (!dialog.open || $('#detailsTitle').textContent !== name) return;
  const site = validURL(repo.homepage), run = runs?.workflow_runs?.[0];
  $('#detailsBody').innerHTML = `<p>${escapeHTML(repo.description || 'אין תיאור לפרויקט זה.')}</p><div class="detailgrid"><div><b>שפות</b><span>${escapeHTML(Object.keys(languages || {}).slice(0, 6).join(', ') || 'לא ידוע')}</span></div><div><b>גרסה אחרונה</b><span>${escapeHTML(release?.tag_name || 'לא פורסמה')}</span></div><div><b>בדיקת קוד אחרונה</b><span>${escapeHTML(run?.conclusion || run?.status || 'אין מידע')}</span></div><div><b>ענף ראשי</b><span>${escapeHTML(repo.default_branch)}</span></div></div><div class="detail-actions">${site ? `<a class="primary" href="${escapeHTML(site)}" target="_blank" rel="noopener noreferrer">פתיחת האתר ↗</a>` : ''}<a class="secondary" href="${escapeHTML(repo.html_url)}" target="_blank" rel="noopener noreferrer">GitHub ↗</a>${readme?.html_url ? `<a class="secondary" href="${escapeHTML(readme.html_url)}" target="_blank" rel="noopener noreferrer">תיעוד ↗</a>` : ''}${release?.html_url ? `<a class="secondary" href="${escapeHTML(release.html_url)}" target="_blank" rel="noopener noreferrer">הגרסה האחרונה ↗</a>` : ''}</div>`;
}
async function shareRepo(name) {
  const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('project', name);
  try { await navigator.clipboard.writeText(url.href); toast('הקישור לפרויקט הועתק'); }
  catch { openDialog($('#palette')); $('#cmd').value = url.href; $('#cmd').select(); $('#cmdResults').innerHTML = '<p>העתקה אוטומטית אינה זמינה. אפשר להעתיק את הכתובת מהשדה למעלה.</p>'; }
}
function clearFilters() { $('#q').value = ''; $('#topic').value = ''; $('#lang').value = ''; $('#sort').value = 'updated'; $('#siteOnly').checked = false; state.visible = 12; renderRepos(); }
function searchQuick() { const q = $('#cmd').value.toLocaleLowerCase(); const matches = visibleRepos().filter(repo => [repo.name, repo.description || ''].join(' ').toLocaleLowerCase().includes(q)).slice(0, 8); $('#cmdResults').innerHTML = matches.map(repo => `<button type="button" data-repo="${escapeHTML(repo.name)}"><b>${escapeHTML(repo.name)}</b><small>${escapeHTML(repo.description || 'פרויקט ב־GitHub')}</small></button>`).join('') || '<p>לא נמצאו פרויקטים.</p>'; }
function contactError(error) { if (error.message === 'rate_limit') return 'נשלחו יותר מדי פניות. נסו שוב מאוחר יותר.'; if (error.name === 'TimeoutError') return 'שרת הפניות אינו מגיב כעת. נסו שוב בעוד כמה דקות.'; if (error instanceof TypeError) return 'אין חיבור לשרת הפניות כרגע. בדקו את החיבור ונסו שוב.'; return 'השליחה נכשלה. נסו שוב מאוחר יותר.'; }
async function submitContact(event) {
  event.preventDefault(); const form = event.currentTarget, button = $('#contactSubmit'), status = $('#contactStatus');
  if (!form.reportValidity()) return; button.disabled = true; status.textContent = 'שולח…';
  try {
    if (!CFG.contactApi) throw Error('missing_endpoint');
    const response = await fetch(CFG.contactApi + '/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))), signal: AbortSignal.timeout(25000) });
    const body = await response.json().catch(() => ({})); if (!response.ok || !body.ok) throw Error(body.error || 'server');
    form.reset(); status.textContent = 'הפנייה נשלחה בהצלחה.'; toast('הפנייה נשלחה');
  } catch (error) { status.textContent = contactError(error); }
  finally { button.disabled = false; }
}
function init() {
  restoreFilters(); applyTheme();
  $('#theme').addEventListener('click', () => safeStorageTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('#refresh').addEventListener('click', () => load(true));
  ['q', 'topic', 'lang', 'sort', 'siteOnly'].forEach(id => $('#' + id).addEventListener(id === 'q' ? 'input' : 'change', () => { state.visible = 12; renderRepos(); }));
  $('#more').addEventListener('click', () => { state.visible += 12; renderRepos(); }); $('#clearFilters').addEventListener('click', clearFilters);
  $('#topicChips').addEventListener('click', event => { const button = event.target.closest('[data-topic]'); if (button) { $('#topic').value = $('#topic').value === button.dataset.topic ? '' : button.dataset.topic; state.visible = 12; renderRepos(); } });
  $('#repos').addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (!button) return; if (button.dataset.action === 'details') openRepo(button.dataset.repo); if (button.dataset.action === 'share') shareRepo(button.dataset.repo); if (button.dataset.action === 'clear') clearFilters(); if (button.dataset.action === 'retry') load(true); });
  $('#activityRange').addEventListener('change', renderActivity);
  $('#contact').addEventListener('click', () => { if (location.hostname.endsWith('.chatgpt.site')) { location.href = 'https://avtsye.github.io/index/?contact=1'; return; } openDialog($('#contactModal')); }); $('#contactForm').addEventListener('submit', submitContact);
  $('#quickSearch').addEventListener('click', () => { openDialog($('#palette')); $('#cmd').value = ''; searchQuick(); $('#cmd').focus(); });
  $('#cmd').addEventListener('input', searchQuick); $('#cmdResults').addEventListener('click', event => { const button = event.target.closest('[data-repo]'); if (button) { $('#palette').close(); openRepo(button.dataset.repo); } });
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $('#' + button.dataset.close).close()));
  document.querySelectorAll('dialog').forEach(dialog => { dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }); });
  $('#details').addEventListener('close', () => { document.title = `${state.profile?.name || USER} — פרויקטים`; document.querySelector('meta[name=description]').content = 'הפרויקטים, הכלים והפעילות של avtsye — מידע שמתעדכן ישירות מ־GitHub.'; const url = new URL(location.href); if (url.searchParams.has('project')) { url.searchParams.delete('project'); history.replaceState({}, '', url); } });
  document.addEventListener('keydown', event => { const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable; if (event.key === '/' && !editing) { event.preventDefault(); $('#q').focus(); } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (!$('#palette').open) { openDialog($('#palette')); searchQuick(); } $('#cmd').focus(); } if (event.key.toLowerCase() === 'd' && !editing && !event.ctrlKey && !event.metaKey) $('#theme').click(); });
  window.addEventListener('offline', () => toast('אין חיבור כרגע. פרויקטים שמורים יוצגו אם הם זמינים.'));
  window.addEventListener('online', () => toast('החיבור חזר. אפשר לרענן את הפרויקטים.'));
  window.addEventListener('popstate', () => { const name = new URLSearchParams(location.search).get('project'); if (name) openRepo(name, false); else if ($('#details').open) $('#details').close(); });
  if (location.hostname.endsWith('.chatgpt.site')) { const robots = document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex'; document.head.append(robots); }
  if (new URLSearchParams(location.search).get('contact') === '1' && !location.hostname.endsWith('.chatgpt.site')) { openDialog($('#contactModal')); const url = new URL(location.href); url.searchParams.delete('contact'); history.replaceState({}, '', url); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  load();
}
init();
