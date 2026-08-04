import {
  isFirebaseConfigured,
  signInAdmin,
  signOutAdmin,
  watchAdminAuth,
  getAdminProfile,
  getAvailabilitySettings,
  saveAvailabilitySettings,
  saveDateBlocks,
  saveMonthAvailability,
  subscribeSlotLocks,
  subscribeAdminCollectionFlexible,
  subscribeAdminDocument,
  getAdminDocument,
  setAdminDocument,
  addAdminDocument,
  updateAdminDocument,
  publishFeedback,
  unpublishFeedback,
  archiveAdminRecord,
  restoreArchivedRecord,
  adminDeleteDocument,
  logAdminActivity,
  createManualBooking,
  getConfirmationSettings,
  saveConfirmationSettings
} from './firebase-service.js';

const config = window.FAB_CONFIG || {};
const $ = (query, root = document) => root.querySelector(query);
const $$ = (query, root = document) => [...root.querySelectorAll(query)];
const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const pad = value => String(value).padStart(2, '0');
const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseDate = value => value ? new Date(`${value}T12:00:00`) : null;
const money = value => Number.isFinite(Number(value)) ? `£${Number(value).toFixed(2)}` : '—';
const normalise = value => String(value ?? '').toLowerCase().trim();
const now = () => new Date();
const todayKey = () => dateKey(now());
const timestampMs = value => value?.toMillis?.() || (value?.seconds ? value.seconds * 1000 : Date.parse(value || 0) || 0);
const humanDate = value => {
  const date = typeof value === 'string' ? parseDate(value) : value;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
};
const humanDateTime = value => {
  const ms = timestampMs(value);
  return ms ? new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
};
const slug = value => normalise(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const state = {
  user: null,
  profile: null,
  signedIn: false,
  initialised: false,
  activeTab: 'overview',
  bookings: [],
  enquiries: [],
  applications: [],
  feedback: [],
  team: [],
  emailTemplates: [],
  emailHistory: [],
  activity: [],
  archives: [],
  admins: [],
  customers: [],
  locks: new Map(),
  availability: null,
  siteContent: null,
  serviceCatalog: null,
  automationSettings: null,
  securitySettings: null,
  confirmations: null,
  notificationsSeenAt: Number(localStorage.getItem('fab-admin-notifications-seen') || 0),
  adminRegion: 'greater-manchester',
  selectedAvailabilityDate: '',
  availabilityMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  scheduleDate: new Date(),
  scheduleView: 'month',
  scheduleCleaner: '',
  scheduleStatus: '',
  selectedEnquiryId: '',
  selectedBookings: new Set(),
  filters: {},
  slots: [...(config.timeSlots || [])],
  unsubscribers: [],
  inactivityTimer: null
};

const nodes = {
  login: $('[data-admin-login]'),
  dashboard: $('[data-admin-dashboard]'),
  loginForm: $('#admin-login-form'),
  loginStatus: $('[data-admin-login-status]'),
  user: $('[data-admin-user]'),
  role: $('[data-admin-role]'),
  sidebar: $('[data-admin-nav]'),
  modalBackdrop: $('[data-modal-backdrop]'),
  modalContent: $('[data-modal-content]'),
  toasts: $('[data-admin-toasts]')
};

function toast(message, type = '') {
  const item = document.createElement('div');
  item.className = `admin-toast ${type}`.trim();
  item.textContent = message;
  nodes.toasts?.append(item);
  setTimeout(() => item.remove(), 4200);
}

function showModal(html, onReady) {
  nodes.modalContent.innerHTML = html;
  nodes.modalBackdrop.hidden = false;
  document.body.style.overflow = 'hidden';
  onReady?.(nodes.modalContent);
}

function closeModal() {
  nodes.modalBackdrop.hidden = true;
  nodes.modalContent.innerHTML = '';
  document.body.style.overflow = '';
}

function confirmAction(title, message, confirmText = 'Continue') {
  return new Promise(resolve => {
    showModal(`
      <span class="admin-kicker">Please confirm</span>
      <h2 id="admin-modal-title">${esc(title)}</h2>
      <p>${esc(message)}</p>
      <div class="admin-form-actions">
        <button class="btn" data-confirm-yes>${esc(confirmText)}</button>
        <button class="btn btn-ghost" data-confirm-no>Cancel</button>
      </div>
    `, root => {
      $('[data-confirm-yes]', root).addEventListener('click', () => { closeModal(); resolve(true); });
      $('[data-confirm-no]', root).addEventListener('click', () => { closeModal(); resolve(false); });
    });
  });
}

function statusBadge(status) {
  const value = status || 'new';
  return `<span class="admin-status ${esc(slug(value))}">${esc(value.replaceAll('_', ' '))}</span>`;
}

function getBookingName(row) {
  return [row.first_name, row.last_name].filter(Boolean).join(' ') || row.customer_name || row.name || row.email || 'Customer';
}

function getBookingTotal(row) {
  return Number(row.finalPrice ?? row.total ?? row.estimate ?? row.estimated_total ?? 0) || 0;
}
function getReceivedAmount(row) {
  const deposit = row.depositStatus === 'paid' || row.paymentStatus === 'deposit_paid' ? Number(row.depositAmount || 25) : 0;
  if (row.balanceStatus === 'paid') return Number(row.finalPrice ?? row.total ?? row.estimate ?? deposit) || deposit;
  return deposit;
}

function getServiceName(serviceId) {
  const catalog = state.serviceCatalog?.services || [];
  return catalog.find(item => item.id === serviceId)?.name || config.rates?.[serviceId]?.name || serviceId || 'Service';
}

function bookingSort(a, b) {
  const dateA = Date.parse(`${a.date || '1970-01-01'}T${a.start || '12:00'}`) || timestampMs(a.createdAt);
  const dateB = Date.parse(`${b.date || '1970-01-01'}T${b.start || '12:00'}`) || timestampMs(b.createdAt);
  return dateB - dateA;
}

function resetInactivityTimer() {
  clearTimeout(state.inactivityTimer);
  if (!state.signedIn) return;
  const minutes = Number(state.securitySettings?.sessionMinutes || 60);
  state.inactivityTimer = setTimeout(async () => {
    toast('You were signed out after a period of inactivity.');
    await signOutAdmin().catch(() => {});
    showLogin();
  }, minutes * 60 * 1000);
}

['click', 'keydown', 'pointerdown'].forEach(name => document.addEventListener(name, resetInactivityTimer, { passive: true }));

function showDashboard(user) {
  state.user = user;
  state.signedIn = true;
  nodes.login.hidden = true;
  nodes.dashboard.hidden = false;
  nodes.user.textContent = user?.email || 'Admin';
  nodes.role.textContent = state.profile?.role || 'Admin';
  if (!state.initialised) initialiseDashboard();
  resetInactivityTimer();
}

function showLogin() {
  state.signedIn = false;
  nodes.dashboard.hidden = true;
  nodes.login.hidden = false;
  nodes.login.style.display = 'grid';
  clearTimeout(state.inactivityTimer);
}

nodes.loginForm?.addEventListener('submit', async event => {
  event.preventDefault();
  if (!nodes.loginForm.reportValidity()) return;
  const button = $('button[type="submit"]', nodes.loginForm);
  button.disabled = true;
  button.textContent = 'Signing in…';
  nodes.loginStatus.textContent = 'Checking your account…';
  nodes.loginStatus.className = 'form-status';
  try {
    if (!isFirebaseConfigured) throw new Error('FIREBASE_NOT_CONFIGURED');
    const user = await signInAdmin($('#admin-email').value, $('#admin-password').value);
    state.profile = await getAdminProfile(user.uid);
    showDashboard(user);
  } catch (error) {
    console.error(error);
    nodes.loginStatus.className = 'form-status error';
    nodes.loginStatus.textContent = error.message === 'ADMIN_REQUIRED' ? 'This account does not have active admin access.' : 'Sign-in failed. Check the email and password.';
  } finally {
    button.disabled = false;
    button.textContent = 'Sign in';
  }
});

$('[data-admin-signout]')?.addEventListener('click', async () => {
  await signOutAdmin().catch(console.error);
  showLogin();
});

$('[data-admin-menu]')?.addEventListener('click', event => {
  const open = nodes.sidebar.classList.toggle('open');
  event.currentTarget.setAttribute('aria-expanded', String(open));
});

$('[data-modal-close]')?.addEventListener('click', closeModal);
nodes.modalBackdrop?.addEventListener('click', event => { if (event.target === nodes.modalBackdrop) closeModal(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !nodes.modalBackdrop.hidden) closeModal(); });

function switchTab(tab) {
  state.activeTab = tab;
  $$('[data-admin-tab]').forEach(button => button.classList.toggle('active', button.dataset.adminTab === tab));
  $$('[data-admin-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.adminPanel === tab));
  $('[data-current-section]').textContent = $$('[data-admin-tab]').find(button => button.dataset.adminTab === tab)?.innerText.trim() || tab;
  nodes.sidebar.classList.remove('open');
  if (tab === 'reports') renderReports();
  if (tab === 'schedule') renderSchedule();
  if (tab === 'customers') renderCustomers();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$$('[data-admin-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.adminTab)));
$$('[data-go-tab]').forEach(button => button.addEventListener('click', () => switchTab(button.dataset.goTab)));

function buildCustomers() {
  const map = new Map();
  const ensure = (email, seed = {}) => {
    const key = normalise(email || seed.phone || seed.name);
    if (!key) return null;
    if (!map.has(key)) map.set(key, {
      id: key,
      name: seed.name || 'Customer',
      email: email || '',
      phone: seed.phone || '',
      addresses: new Set(),
      bookings: [],
      enquiries: [],
      reviews: [],
      totalSpend: 0,
      lastActivity: 0
    });
    return map.get(key);
  };
  state.bookings.forEach(row => {
    const customer = ensure(row.email, { name: getBookingName(row), phone: row.phone });
    if (!customer) return;
    customer.name = getBookingName(row) || customer.name;
    customer.phone = row.phone || customer.phone;
    if (row.address || row.postcode) customer.addresses.add([row.address, row.postcode].filter(Boolean).join(', '));
    customer.bookings.push(row);
    if (row.depositStatus === 'paid' || row.paymentStatus === 'deposit_paid' || row.balanceStatus === 'paid' || row.status === 'completed') customer.totalSpend += getReceivedAmount(row);
    customer.lastActivity = Math.max(customer.lastActivity, timestampMs(row.updatedAt) || timestampMs(row.createdAt));
  });
  state.enquiries.forEach(row => {
    const customer = ensure(row.email, { name: row.name, phone: row.phone });
    if (!customer) return;
    customer.enquiries.push(row);
    customer.lastActivity = Math.max(customer.lastActivity, timestampMs(row.updatedAt) || timestampMs(row.createdAt));
  });
  state.feedback.forEach(row => {
    const customer = ensure(row.email, { name: row.name, phone: row.phone });
    if (!customer) return;
    customer.reviews.push(row);
    customer.lastActivity = Math.max(customer.lastActivity, timestampMs(row.updatedAt) || timestampMs(row.createdAt));
  });
  state.customers = [...map.values()].map(item => ({ ...item, addresses: [...item.addresses] })).sort((a, b) => b.lastActivity - a.lastActivity);
}

function calculateNotifications() {
  const items = [];
  state.bookings.filter(row => ['deposit_paid', 'awaiting_confirmation'].includes(row.status)).forEach(row => items.push({ type: 'booking', icon: 'fa-list-check', title: `New booking from ${getBookingName(row)}`, detail: `${humanDate(row.date)} · ${getServiceName(row.service)}`, time: timestampMs(row.createdAt), tab: 'bookings', id: row.id }));
  state.enquiries.filter(row => row.status === 'new').forEach(row => items.push({ type: 'enquiry', icon: 'fa-message', title: `New enquiry from ${row.name || row.email}`, detail: row.topic || 'Contact form', time: timestampMs(row.createdAt), tab: 'enquiries', id: row.id }));
  state.applications.filter(row => row.status === 'new').forEach(row => items.push({ type: 'application', icon: 'fa-user-plus', title: `New application from ${row.name || 'Applicant'}`, detail: row.role || 'Job application', time: timestampMs(row.createdAt), tab: 'applications', id: row.id }));
  state.feedback.filter(row => row.status === 'pending').forEach(row => items.push({ type: 'review', icon: 'fa-star', title: `Review awaiting approval`, detail: `${row.name || 'Customer'} · ${row.rating || 0} stars`, time: timestampMs(row.createdAt), tab: 'feedback', id: row.id }));
  return items.sort((a, b) => b.time - a.time);
}

function renderNotifications() {
  const items = calculateNotifications();
  const unseen = items.filter(item => item.time > state.notificationsSeenAt);
  const count = $('[data-notification-count]');
  count.textContent = unseen.length;
  count.hidden = unseen.length === 0;
  const list = $('[data-notification-list]');
  list.innerHTML = items.length ? items.map(item => `
    <button class="admin-notification-item" data-notification-tab="${esc(item.tab)}" data-notification-id="${esc(item.id)}">
      <i class="fa-solid ${esc(item.icon)}"></i>
      <span><strong>${esc(item.title)}</strong><span>${esc(item.detail)} · ${humanDateTime(item.time)}</span></span>
    </button>
  `).join('') : '<div class="admin-empty-state"><i class="fa-regular fa-bell"></i><h3>All caught up</h3><p>There are no outstanding notifications.</p></div>';
  $$('[data-notification-tab]', list).forEach(button => button.addEventListener('click', () => {
    $('[data-notification-drawer]').hidden = true;
    switchTab(button.dataset.notificationTab);
    if (button.dataset.notificationTab === 'enquiries') { state.selectedEnquiryId = button.dataset.notificationId; renderEnquiries(); }
  }));
  setCount('bookings', state.bookings.filter(row => ['deposit_paid', 'awaiting_confirmation'].includes(row.status)).length);
  setCount('enquiries', state.enquiries.filter(row => row.status === 'new').length);
  setCount('applications', state.applications.filter(row => row.status === 'new').length);
  setCount('feedback', state.feedback.filter(row => row.status === 'pending').length);
}

function setCount(name, value) {
  const node = $(`[data-nav-count="${name}"]`);
  if (!node) return;
  node.textContent = value;
  node.hidden = !value;
}

$('[data-notification-toggle]')?.addEventListener('click', () => {
  const drawer = $('[data-notification-drawer]');
  drawer.hidden = !drawer.hidden;
});
$('[data-notification-close]')?.addEventListener('click', () => $('[data-notification-drawer]').hidden = true);
$('[data-mark-notifications]')?.addEventListener('click', () => {
  state.notificationsSeenAt = Date.now();
  localStorage.setItem('fab-admin-notifications-seen', String(state.notificationsSeenAt));
  renderNotifications();
});

function renderOverview() {
  const startMonth = new Date(now().getFullYear(), now().getMonth(), 1);
  const thisMonth = state.bookings.filter(row => parseDate(row.date) >= startMonth);
  const revenue = thisMonth.filter(row => row.depositStatus === 'paid' || row.paymentStatus === 'deposit_paid' || row.balanceStatus === 'paid' || row.status === 'completed').reduce((sum, row) => sum + getReceivedAmount(row), 0);
  const todayBookings = state.bookings.filter(row => row.date === todayKey() && !['cancelled', 'declined'].includes(row.status));
  const kpis = [
    ['New requests', state.bookings.filter(row => ['deposit_paid', 'awaiting_confirmation'].includes(row.status)).length, 'fa-list-check', 'Bookings requiring a decision'],
    ['Today', todayBookings.length, 'fa-calendar-day', todayBookings.length ? 'Appointments scheduled today' : 'No appointments today'],
    ['Pending inbox', state.enquiries.filter(row => row.status === 'new').length + state.feedback.filter(row => row.status === 'pending').length, 'fa-inbox', 'Enquiries and reviews'],
    ['Month revenue', money(revenue), 'fa-sterling-sign', `${thisMonth.length} bookings this month`]
  ];
  $('[data-kpi-grid]').innerHTML = kpis.map(([label, value, icon, note]) => `<article class="admin-kpi"><div class="admin-kpi-head"><span>${esc(label)}</span><i class="admin-kpi-icon fa-solid ${icon}"></i></div><strong>${esc(value)}</strong><small>${esc(note)}</small></article>`).join('');

  const upcoming = state.bookings.filter(row => row.date >= todayKey() && !['cancelled', 'declined'].includes(row.status)).sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 7);
  $('[data-upcoming-list]').innerHTML = upcoming.length ? upcoming.map(row => {
    const date = parseDate(row.date);
    return `<button class="admin-upcoming-item" data-open-booking="${esc(row.id)}"><span class="admin-date-chip"><strong>${date?.getDate() || ''}</strong><span>${date?.toLocaleDateString('en-GB', { month: 'short' }) || ''}</span></span><span class="admin-list-main"><strong>${esc(getBookingName(row))}</strong><span>${esc(getServiceName(row.service))} · ${esc(row.time_slot || row.start || '')}</span></span>${statusBadge(row.status)}</button>`;
  }).join('') : '<div class="admin-empty-state"><i class="fa-regular fa-calendar-check"></i><h3>No upcoming bookings</h3><p>Confirmed and requested bookings will appear here.</p></div>';
  $$('[data-open-booking]', $('[data-upcoming-list]')).forEach(button => button.addEventListener('click', () => openBooking(state.bookings.find(row => row.id === button.dataset.openBooking))));

  const activity = state.activity.slice(0, 8);
  $('[data-recent-activity]').innerHTML = activity.length ? activity.map(item => `<div class="admin-activity-item"><span class="admin-timeline-icon"><i class="fa-solid fa-clock-rotate-left"></i></span><span class="admin-list-main"><strong>${esc(item.description || item.action)}</strong><span>${esc(item.adminEmail || 'Admin')} · ${humanDateTime(item.createdAt)}</span></span></div>`).join('') : '<p>No logged admin activity yet.</p>';
  renderOverviewChart();
}

function monthlySeries(months = 6) {
  const series = [];
  const current = new Date(now().getFullYear(), now().getMonth(), 1);
  for (let index = months - 1; index >= 0; index -= 1) {
    const start = new Date(current.getFullYear(), current.getMonth() - index, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const rows = state.bookings.filter(row => { const date = parseDate(row.date); return date >= start && date < end; });
    series.push({ label: start.toLocaleDateString('en-GB', { month: 'short' }), bookings: rows.length, revenue: rows.filter(row => row.depositStatus === 'paid' || row.paymentStatus === 'deposit_paid' || row.balanceStatus === 'paid' || row.status === 'completed').reduce((sum, row) => sum + getReceivedAmount(row), 0) });
  }
  return series;
}

function renderBarChart(node, series, primaryKey = 'bookings', secondaryKey = 'revenue') {
  const maxPrimary = Math.max(1, ...series.map(item => Number(item[primaryKey]) || 0));
  const maxSecondary = Math.max(1, ...series.map(item => Number(item[secondaryKey]) || 0));
  node.innerHTML = series.map(item => `<div class="admin-chart-column"><div class="admin-chart-bars"><i class="admin-chart-bar" title="${esc(primaryKey)}: ${esc(item[primaryKey])}" style="height:${Math.max(3, (Number(item[primaryKey]) || 0) / maxPrimary * 100)}%"></i><i class="admin-chart-bar alt" title="${esc(secondaryKey)}: ${esc(item[secondaryKey])}" style="height:${Math.max(3, (Number(item[secondaryKey]) || 0) / maxSecondary * 100)}%"></i></div><span>${esc(item.label)}</span></div>`).join('');
}

function renderOverviewChart() {
  const months = Number($('[data-report-range]')?.value || 6);
  renderBarChart($('[data-overview-chart]'), monthlySeries(months));
}
$('[data-report-range]')?.addEventListener('change', renderOverviewChart);

function filteredBookings() {
  const query = normalise($('[data-filter="bookings"]')?.value);
  const status = $('[data-booking-status-filter]')?.value || '';
  const region = $('[data-booking-region-filter]')?.value || '';
  return state.bookings.filter(row => {
    const haystack = normalise([row.reference, getBookingName(row), row.email, row.phone, row.postcode, row.address, getServiceName(row.service)].join(' '));
    return (!query || haystack.includes(query)) && (!status || row.status === status) && (!region || row.region === region);
  }).sort(bookingSort);
}

function renderBookings() {
  const rows = filteredBookings();
  const body = $('[data-bookings-table]');
  body.innerHTML = rows.length ? rows.map(row => {
    const member = state.team.find(item => item.id === row.assignedCleanerId);
    return `<tr><td><input type="checkbox" data-booking-check="${esc(row.id)}" ${state.selectedBookings.has(row.id) ? 'checked' : ''}></td><td><strong>${esc(humanDate(row.date))}</strong><br><small>${esc(row.time_slot || row.start || '')}</small></td><td><strong>${esc(getBookingName(row))}</strong><br><small>${esc(row.reference || row.email || '')}</small></td><td>${esc(getServiceName(row.service))}</td><td>${esc(member?.name || row.assignedCleaner || 'Unassigned')}</td><td><strong>${esc(row.finalPrice != null ? money(row.finalPrice) : 'Price pending')}</strong><br><small>${esc(row.depositStatus === 'paid' || row.paymentStatus === 'deposit_paid' ? '£25 deposit paid' : 'Deposit pending')}</small></td><td>${statusBadge(row.status)}</td><td><button class="admin-row-action" data-open-booking="${esc(row.id)}">Manage</button></td></tr>`;
  }).join('') : '<tr><td colspan="8"><div class="admin-empty-state"><h3>No matching bookings</h3><p>Try changing the filters.</p></div></td></tr>';
  $$('[data-open-booking]', body).forEach(button => button.addEventListener('click', () => openBooking(state.bookings.find(row => row.id === button.dataset.openBooking))));
  $$('[data-booking-check]', body).forEach(input => input.addEventListener('change', () => {
    if (input.checked) state.selectedBookings.add(input.dataset.bookingCheck); else state.selectedBookings.delete(input.dataset.bookingCheck);
    renderBookingBulkBar();
  }));
  renderBookingBulkBar();
}

function renderBookingBulkBar() {
  const bar = $('[data-booking-bulk]');
  bar.hidden = state.selectedBookings.size === 0;
  $('[data-booking-selected-count]').textContent = state.selectedBookings.size;
}

function bookingForm(row = {}) {
  const cleanerOptions = ['<option value="">Unassigned</option>', ...state.team.filter(item => item.status !== 'inactive').map(item => `<option value="${esc(item.id)}" ${row.assignedCleanerId === item.id ? 'selected' : ''}>${esc(item.name)}</option>`)].join('');
  const statuses = ['awaiting_deposit', 'deposit_paid', 'awaiting_confirmation', 'confirmed', 'in_progress', 'completed', 'deposit_not_paid', 'cancelled', 'declined'];
  return `<form data-booking-form class="admin-form-stack"><span class="admin-kicker">${row.id ? 'Booking management' : 'Manual booking'}</span><h2 id="admin-modal-title">${row.id ? esc(row.reference || getBookingName(row)) : 'Add a booking'}</h2><div class="admin-modal-grid"><label>First name<input name="first_name" value="${esc(row.first_name || '')}" required></label><label>Last name<input name="last_name" value="${esc(row.last_name || '')}"></label><label>Email<input name="email" type="email" value="${esc(row.email || '')}" required></label><label>Phone<input name="phone" value="${esc(row.phone || '')}"></label><label class="full">Address<input name="address" value="${esc(row.address || '')}"></label><label>Postcode<input name="postcode" value="${esc(row.postcode || '')}"></label><label>Region<select name="region"><option value="greater-manchester" ${row.region === 'greater-manchester' ? 'selected' : ''}>Greater Manchester</option><option value="london-luton" ${row.region === 'london-luton' ? 'selected' : ''}>London & Luton</option></select></label><label>Service<select name="service">${serviceOptions(row.service)}</select></label><label>Date<input name="date" type="date" value="${esc(row.date || todayKey())}" required></label><label>Time / window<input name="time_slot" value="${esc(row.time_slot || '')}" required></label><label>Status<select name="status">${statuses.map(value => `<option value="${value}" ${row.status === value ? 'selected' : ''}>${value.replaceAll('_', ' ')}</option>`).join('')}</select></label><label>Assigned cleaner<select name="assignedCleanerId">${cleanerOptions}</select></label><label>Indicative estimate<input name="estimate" type="number" min="0" step="0.01" value="${esc(row.estimate ?? row.total ?? '')}"></label><label>Deposit paid<input value="${esc(row.depositStatus === 'paid' || row.paymentStatus === 'deposit_paid' ? '£25 paid' : 'Not paid')}" readonly></label><label>Actual price communicated<input name="finalPrice" type="number" min="0" step="0.01" value="${esc(row.finalPrice ?? '')}" placeholder="Enter after review"></label><label>Balance status<select name="balanceStatus"><option value="price_to_be_communicated" ${row.balanceStatus === 'price_to_be_communicated' ? 'selected' : ''}>Price to be communicated</option><option value="communicated" ${row.balanceStatus === 'communicated' ? 'selected' : ''}>Price communicated</option><option value="paid" ${row.balanceStatus === 'paid' ? 'selected' : ''}>Balance paid</option></select></label><label class="full">Customer notes<textarea name="notes" rows="3">${esc(row.notes || '')}</textarea></label><label class="full">Internal notes<textarea name="adminNotes" rows="4">${esc(row.adminNotes || '')}</textarea></label></div><div class="admin-form-actions"><button class="btn" type="submit">${row.id ? 'Save booking' : 'Create booking'}</button>${row.id ? '<button class="btn btn-ghost" data-email-booking type="button"><i class="fa-regular fa-envelope"></i> Email customer</button><button class="btn btn-ghost" data-print-booking type="button"><i class="fa-solid fa-print"></i> Print</button><button class="btn btn-danger" data-archive-booking type="button">Archive</button>' : ''}</div><p class="form-status" data-booking-form-status></p></form>`;
}

function serviceOptions(selected = '') {
  const services = state.serviceCatalog?.services || Object.entries(config.rates || {}).map(([id, item]) => ({ id, ...item }));
  return services.map(item => `<option value="${esc(item.id)}" ${item.id === selected ? 'selected' : ''}>${esc(item.name || item.id)}</option>`).join('');
}

function openBooking(row = null) {
  showModal(bookingForm(row || {}), root => {
    const form = $('[data-booking-form]', root);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const data = Object.fromEntries(new FormData(form));
      data.estimate = data.estimate === '' ? null : Number(data.estimate);
      data.finalPrice = data.finalPrice === '' ? null : Number(data.finalPrice);
      data.assignedCleaner = state.team.find(item => item.id === data.assignedCleanerId)?.name || '';
      const status = $('[data-booking-form-status]', root);
      status.textContent = 'Saving…';
      try {
        let id = row?.id;
        if (id) await updateAdminDocument(row._collection || 'bookingRequests', id, data);
        else {
          data.reference = `FAB-${Date.now().toString().slice(-8)}`;
          id = await createManualBooking(data);
        }
        await logAdminActivity(row?.id ? 'booking_updated' : 'booking_created', { type: 'booking', collection: 'bookingRequests', recordId: id, description: `${row?.id ? 'Updated' : 'Created'} booking for ${data.first_name} ${data.last_name}` });
        toast('Booking saved successfully.');
        closeModal();
      } catch (error) {
        console.error(error); status.className = 'form-status error'; status.textContent = 'Could not save the booking.';
      }
    });
    $('[data-email-booking]', root)?.addEventListener('click', () => {
      closeModal(); switchTab('email'); fillEmail({ to: row.email, subject: `Regarding your booking ${row.reference || ''}`, body: `Hello ${row.first_name || getBookingName(row)},\n\n` });
    });
    $('[data-print-booking]', root)?.addEventListener('click', () => printRecord(`Booking ${row.reference || ''}`, row));
    $('[data-archive-booking]', root)?.addEventListener('click', async () => {
      if (!await confirmAction('Archive booking?', 'The booking can be restored later from Archive & trash.', 'Archive')) return;
      await archiveAdminRecord(row._collection || 'bookingRequests', row.id, 'Archived from booking manager');
      await logAdminActivity('booking_archived', { type: 'booking', recordId: row.id, description: `Archived booking ${row.reference || row.id}` });
      closeModal(); toast('Booking archived.');
    });
  });
}

$$('[data-quick-booking]').forEach(button => button.addEventListener('click', () => openBooking()));
$('[data-apply-booking-bulk]')?.addEventListener('click', async () => {
  const status = $('[data-bulk-booking-status]').value;
  if (!status || !state.selectedBookings.size) return;
  await Promise.all([...state.selectedBookings].map(id => updateAdminDocument('bookingRequests', id, { status })));
  await logAdminActivity('bookings_bulk_updated', { type: 'booking', description: `Changed ${state.selectedBookings.size} bookings to ${status}` });
  state.selectedBookings.clear(); toast('Selected bookings updated.');
});
$('[data-select-all-bookings]')?.addEventListener('change', event => {
  state.selectedBookings.clear();
  if (event.target.checked) filteredBookings().forEach(row => state.selectedBookings.add(row.id));
  renderBookings();
});

function renderSchedule() {
  const title = $('[data-schedule-title]');
  const container = $('[data-schedule-grid]');
  const filtered = state.bookings.filter(row => !['cancelled', 'declined'].includes(row.status) && (!state.scheduleCleaner || row.assignedCleanerId === state.scheduleCleaner) && (!state.scheduleStatus || row.status === state.scheduleStatus));
  if (state.scheduleView === 'month') {
    const month = new Date(state.scheduleDate.getFullYear(), state.scheduleDate.getMonth(), 1);
    title.textContent = month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const leading = (first.getDay() + 6) % 7;
    const start = new Date(month); start.setDate(1 - leading);
    container.innerHTML = `<div class="schedule-month">${Array.from({ length: 42 }, (_, index) => {
      const date = new Date(start); date.setDate(start.getDate() + index);
      const key = dateKey(date);
      const events = filtered.filter(row => row.date === key).slice(0, 4);
      return `<div class="schedule-day ${date.getMonth() !== month.getMonth() ? 'outside' : ''}"><span class="schedule-day-number">${date.getDate()}</span>${events.map(row => `<button class="schedule-event" data-open-booking="${esc(row.id)}">${esc(row.time_slot || '')} ${esc(getBookingName(row))}</button>`).join('')}${filtered.filter(row => row.date === key).length > 4 ? `<small>+${filtered.filter(row => row.date === key).length - 4} more</small>` : ''}</div>`;
    }).join('')}</div>`;
  } else {
    const start = new Date(state.scheduleDate);
    if (state.scheduleView === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    title.textContent = state.scheduleView === 'day' ? start.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : `${humanDate(start)} – ${humanDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6))}`;
    const days = state.scheduleView === 'day' ? 1 : 7;
    container.innerHTML = `<div class="${state.scheduleView === 'day' ? 'schedule-day-view' : 'schedule-week'}">${Array.from({ length: 16 }, (_, hourIndex) => {
      const hour = 7 + hourIndex;
      return `<div class="schedule-time-row"><span class="schedule-time-label">${pad(hour)}:00</span>${Array.from({ length: days }, (_, dayIndex) => {
        const date = new Date(start); date.setDate(start.getDate() + dayIndex); const key = dateKey(date);
        const events = filtered.filter(row => row.date === key && Number(String(row.start || row.time_slot || '').match(/\d{1,2}/)?.[0] || 12) === hour);
        return `<div class="schedule-time-cell">${events.map(row => `<button class="schedule-event" data-open-booking="${esc(row.id)}">${esc(getBookingName(row))} · ${esc(getServiceName(row.service))}</button>`).join('')}</div>`;
      }).join('')}</div>`;
    }).join('')}</div>`;
  }
  $$('[data-open-booking]', container).forEach(button => button.addEventListener('click', () => openBooking(state.bookings.find(row => row.id === button.dataset.openBooking))));
}

$$('[data-schedule-view]').forEach(button => button.addEventListener('click', () => {
  state.scheduleView = button.dataset.scheduleView;
  $$('[data-schedule-view]').forEach(item => item.classList.toggle('active', item === button));
  renderSchedule();
}));
$('[data-schedule-prev]')?.addEventListener('click', () => { state.scheduleDate = new Date(state.scheduleDate.getFullYear(), state.scheduleDate.getMonth() + (state.scheduleView === 'month' ? -1 : 0), state.scheduleDate.getDate() + (state.scheduleView === 'week' ? -7 : state.scheduleView === 'day' ? -1 : 0)); renderSchedule(); });
$('[data-schedule-next]')?.addEventListener('click', () => { state.scheduleDate = new Date(state.scheduleDate.getFullYear(), state.scheduleDate.getMonth() + (state.scheduleView === 'month' ? 1 : 0), state.scheduleDate.getDate() + (state.scheduleView === 'week' ? 7 : state.scheduleView === 'day' ? 1 : 0)); renderSchedule(); });
$('[data-schedule-today]')?.addEventListener('click', () => { state.scheduleDate = new Date(); renderSchedule(); });
$('[data-schedule-cleaner]')?.addEventListener('change', event => { state.scheduleCleaner = event.target.value; renderSchedule(); });
$('[data-schedule-status]')?.addEventListener('change', event => { state.scheduleStatus = event.target.value; renderSchedule(); });
$('[data-print-schedule]')?.addEventListener('click', () => window.print());

function availabilityBounds() {
  const month = state.availabilityMonth;
  return { start: dateKey(new Date(month.getFullYear(), month.getMonth(), 1)), end: dateKey(new Date(month.getFullYear(), month.getMonth() + 1, 0)) };
}

async function loadAvailabilityLocks() {
  const { start, end } = availabilityBounds();
  if (state.availabilityUnsubscribe) state.availabilityUnsubscribe();
  state.availabilityUnsubscribe = await subscribeSlotLocks(start, end, locks => { state.locks = locks; renderAvailabilityCalendar(); renderAvailabilityEditor(); });
}

function renderDefaultSlots() {
  const node = $('[data-default-slots]');
  node.innerHTML = state.slots.map((slot, index) => `<div class="admin-slot-default" data-default-slot="${index}"><input data-slot-label value="${esc(slot.label)}" aria-label="Label"><input data-slot-start type="time" value="${esc(slot.start)}"><input data-slot-end type="time" value="${esc(slot.end)}"><button class="admin-icon-button" data-remove-slot title="Remove"><i class="fa-solid fa-trash"></i></button></div>`).join('');
  $$('[data-default-slot]', node).forEach(row => {
    const index = Number(row.dataset.defaultSlot);
    $('[data-slot-label]', row).addEventListener('input', event => state.slots[index].label = event.target.value);
    $('[data-slot-start]', row).addEventListener('input', event => state.slots[index].start = event.target.value);
    $('[data-slot-end]', row).addEventListener('input', event => state.slots[index].end = event.target.value);
    $('[data-remove-slot]', row).addEventListener('click', () => { state.slots.splice(index, 1); renderDefaultSlots(); });
  });
}

function renderAvailabilityCalendar() {
  const node = $('[data-admin-calendar]');
  const month = state.availabilityMonth;
  $('[data-admin-month]').textContent = month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const leading = (first.getDay() + 6) % 7;
  const cells = Array.from({ length: leading }, () => '<span class="outside"></span>');
  for (let day = 1; day <= last.getDate(); day += 1) {
    const date = new Date(month.getFullYear(), month.getMonth(), day);
    const key = dateKey(date);
    const open = state.slots.filter(slot => state.locks.get(`${state.adminRegion}_${key}_${slot.id}`)?.status === 'available').length;
    const occupied = state.slots.filter(slot => ['booked', 'paid', 'confirmed', 'requested', 'hold'].includes(state.locks.get(`${state.adminRegion}_${key}_${slot.id}`)?.status)).length;
    cells.push(`<button type="button" data-availability-date="${key}" class="${state.selectedAvailabilityDate === key ? 'selected' : ''} ${open ? 'has-space' : ''} ${occupied ? 'has-booking' : ''}" ${date < new Date(new Date().setHours(0, 0, 0, 0)) ? 'disabled' : ''}>${day}</button>`);
  }
  node.innerHTML = cells.join('');
  $$('[data-availability-date]', node).forEach(button => button.addEventListener('click', () => { state.selectedAvailabilityDate = button.dataset.availabilityDate; renderAvailabilityCalendar(); renderAvailabilityEditor(); }));
}

function renderAvailabilityEditor() {
  const selected = state.selectedAvailabilityDate;
  $('[data-admin-selected-date]').textContent = selected ? parseDate(selected).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Choose a date';
  $('[data-save-blocks]').disabled = !selected;
  const node = $('[data-admin-slot-toggles]');
  if (!selected) { node.innerHTML = ''; return; }
  node.innerHTML = state.slots.map(slot => {
    const lock = state.locks.get(`${state.adminRegion}_${selected}_${slot.id}`);
    const protectedStatus = lock && !['available', 'blocked'].includes(lock.status);
    return `<div class="admin-slot-editor"><label class="admin-check-row"><input type="checkbox" value="${esc(slot.id)}" ${lock?.status === 'available' ? 'checked' : ''} ${protectedStatus ? 'disabled' : ''}><span><strong>${esc(slot.label)}</strong>${protectedStatus ? ` · ${esc(lock.status)}` : ''}</span></label><input data-editor-start type="time" value="${esc(lock?.start || slot.start)}" ${protectedStatus ? 'disabled' : ''}><input data-editor-end type="time" value="${esc(lock?.end || slot.end)}" ${protectedStatus ? 'disabled' : ''}></div>`;
  }).join('');
  $('[data-block-day]').checked = state.slots.length > 0 && state.slots.every(slot => state.locks.get(`${state.adminRegion}_${selected}_${slot.id}`)?.status === 'available');
}

$('[data-add-slot]')?.addEventListener('click', () => { const id = `slot-${uid()}`; state.slots.push({ id, label: 'New window', start: '09:00', end: '12:00' }); renderDefaultSlots(); });
$('[data-admin-prev]')?.addEventListener('click', () => { state.availabilityMonth = new Date(state.availabilityMonth.getFullYear(), state.availabilityMonth.getMonth() - 1, 1); state.selectedAvailabilityDate = ''; loadAvailabilityLocks(); });
$('[data-admin-next]')?.addEventListener('click', () => { state.availabilityMonth = new Date(state.availabilityMonth.getFullYear(), state.availabilityMonth.getMonth() + 1, 1); state.selectedAvailabilityDate = ''; loadAvailabilityLocks(); });
$('[data-block-day]')?.addEventListener('change', event => $$('.admin-slot-editor input[type="checkbox"]:not(:disabled)').forEach(input => input.checked = event.target.checked));
$('[data-save-hours]')?.addEventListener('click', async () => {
  const data = { start: $('#admin-start').value, end: $('#admin-end').value, workingDays: $$('.admin-day-toggles input:checked').map(input => Number(input.value)), slots: state.slots };
  await saveAvailabilitySettings(data);
  state.availability = data;
  await logAdminActivity('availability_defaults_updated', { type: 'website', description: 'Updated default working hours and time windows' });
  toast('Default availability saved.');
});
$('[data-save-blocks]')?.addEventListener('click', async () => {
  const rows = $$('.admin-slot-editor');
  const selected = rows.filter(row => $('input[type="checkbox"]', row).checked).map(row => ({ id: $('input[type="checkbox"]', row).value, start: $('[data-editor-start]', row).value, end: $('[data-editor-end]', row).value }));
  if (selected.some(item => !item.start || !item.end || item.start >= item.end)) { $('[data-availability-status]').textContent = 'Every selected window needs a valid start and end time.'; $('[data-availability-status]').className = 'form-status error'; return; }
  await saveDateBlocks(state.selectedAvailabilityDate, selected, $('[data-block-day]').checked, state.slots, state.adminRegion);
  await logAdminActivity('availability_date_updated', { type: 'website', description: `Updated availability for ${state.selectedAvailabilityDate}` });
  $('[data-availability-status]').textContent = 'Available times saved.';
});

function updateMonthBulkButton() {
  const days = $('[data-select-month-days]')?.checked;
  const times = $('[data-select-month-times]')?.checked;
  const button = $('[data-apply-month-availability]');
  if (button) button.disabled = !(days && times);
}
$('[data-select-month-days]')?.addEventListener('change', updateMonthBulkButton);
$('[data-select-month-times]')?.addEventListener('change', updateMonthBulkButton);
$('[data-apply-month-availability]')?.addEventListener('click', async () => {
  const status = $('[data-month-availability-status]');
  const button = $('[data-apply-month-availability]');
  const month = state.availabilityMonth;
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const today = new Date(); today.setHours(0,0,0,0);
  const dates = Array.from({length:last}, (_,index)=>new Date(month.getFullYear(),month.getMonth(),index+1))
    .filter(date=>date>=today)
    .map(dateKey);
  if (!dates.length || !state.slots.length) return;
  button.disabled = true;
  status.className = 'form-status';
  status.textContent = 'Opening the selected month…';
  try {
    const count = await saveMonthAvailability(dates, state.slots.map(slot=>slot.id), state.slots, state.adminRegion);
    await logAdminActivity('availability_month_opened', { type:'website', description:`Opened ${count} availability windows for ${month.toLocaleDateString('en-GB',{month:'long',year:'numeric'})}` });
    status.textContent = `${count} available time windows saved. Existing bookings and paid deposits were not changed.`;
    await loadAvailabilityLocks();
  } catch (error) {
    console.error(error);
    status.className = 'form-status error';
    status.textContent = 'The month could not be updated. Please try again.';
  } finally { updateMonthBulkButton(); }
});
$('#admin-region')?.addEventListener('change', event => { state.adminRegion = event.target.value; state.selectedAvailabilityDate = ''; loadAvailabilityLocks(); });

function filteredCustomers() {
  const query = normalise($('[data-filter="customers"]')?.value);
  const segment = $('[data-customer-segment]')?.value || '';
  return state.customers.filter(customer => {
    const matches = !query || normalise([customer.name, customer.email, customer.phone, ...customer.addresses].join(' ')).includes(query);
    const segmentMatch = !segment || (segment === 'returning' && customer.bookings.length > 1) || (segment === 'new' && customer.bookings.length <= 1) || (segment === 'high-value' && customer.totalSpend >= 250);
    return matches && segmentMatch;
  });
}

function renderCustomers() {
  const rows = filteredCustomers();
  $('[data-customer-grid]').innerHTML = rows.length ? rows.map(customer => `<article class="admin-profile-card"><div class="admin-profile-head"><span class="admin-avatar">${esc(customer.name.split(/\s+/).map(item => item[0]).slice(0, 2).join('').toUpperCase())}</span><div><h3>${esc(customer.name)}</h3><p>${esc(customer.email || customer.phone)}</p></div></div><div class="admin-stat-row"><div><strong>${customer.bookings.length}</strong><span>Bookings</span></div><div><strong>${money(customer.totalSpend)}</strong><span>Spent</span></div><div><strong>${customer.reviews.length}</strong><span>Reviews</span></div></div><div class="admin-card-actions"><button class="btn btn-sm" data-open-customer="${esc(customer.id)}">View profile</button><button class="btn btn-sm btn-ghost" data-email-customer="${esc(customer.id)}"><i class="fa-regular fa-envelope"></i></button></div></article>`).join('') : '<div class="admin-empty-state"><h3>No customers found</h3></div>';
  $$('[data-open-customer]').forEach(button => button.addEventListener('click', () => openCustomer(state.customers.find(item => item.id === button.dataset.openCustomer))));
  $$('[data-email-customer]').forEach(button => button.addEventListener('click', () => { const customer = state.customers.find(item => item.id === button.dataset.emailCustomer); switchTab('email'); fillEmail({ to: customer.email, subject: '', body: `Hello ${customer.name},\n\n` }); }));
}

function openCustomer(customer) {
  const bookings = customer.bookings.sort(bookingSort);
  showModal(`<span class="admin-kicker">Customer profile</span><h2 id="admin-modal-title">${esc(customer.name)}</h2><div class="admin-detail-grid"><div class="admin-detail-item"><span>Email</span>${esc(customer.email || '—')}</div><div class="admin-detail-item"><span>Phone</span>${esc(customer.phone || '—')}</div><div class="admin-detail-item"><span>Total bookings</span>${customer.bookings.length}</div><div class="admin-detail-item"><span>Total paid spend</span>${money(customer.totalSpend)}</div></div><h3>Addresses</h3><p>${customer.addresses.map(esc).join('<br>') || 'No saved address'}</p><h3>Booking history</h3><div>${bookings.map(row => `<button class="admin-list-row" data-open-booking="${esc(row.id)}"><span class="admin-list-main"><strong>${humanDate(row.date)} · ${esc(getServiceName(row.service))}</strong><span>${esc(row.reference || '')}</span></span>${statusBadge(row.status)}</button>`).join('') || '<p>No bookings.</p>'}</div><h3>Internal customer notes</h3><textarea data-customer-notes rows="4" placeholder="Preferences, access information, follow-up notes…"></textarea><div class="admin-form-actions"><button class="btn" data-save-customer-note>Save notes</button><button class="btn btn-ghost" data-email-profile>Email customer</button></div>`, root => {
    const profileId = slug(customer.email || customer.phone || customer.name);
    getAdminDocument('customerProfiles', profileId).then(profile => $('[data-customer-notes]', root).value = profile?.notes || '');
    $$('[data-open-booking]', root).forEach(button => button.addEventListener('click', () => openBooking(state.bookings.find(row => row.id === button.dataset.openBooking))));
    $('[data-save-customer-note]', root).addEventListener('click', async () => { await setAdminDocument('customerProfiles', profileId, { name: customer.name, email: customer.email, phone: customer.phone, notes: $('[data-customer-notes]', root).value }); await logAdminActivity('customer_notes_updated', { type: 'customer', recordId: profileId, description: `Updated notes for ${customer.name}` }); toast('Customer notes saved.'); });
    $('[data-email-profile]', root).addEventListener('click', () => { closeModal(); switchTab('email'); fillEmail({ to: customer.email, body: `Hello ${customer.name},\n\n` }); });
  });
}

$('[data-add-customer]')?.addEventListener('click', () => showModal(`<form data-new-customer class="admin-form-stack"><span class="admin-kicker">Customer record</span><h2>Add customer</h2><label>Name<input name="name" required></label><label>Email<input name="email" type="email"></label><label>Phone<input name="phone"></label><label>Notes<textarea name="notes"></textarea></label><button class="btn">Save customer</button></form>`, root => $('[data-new-customer]', root).addEventListener('submit', async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); await setAdminDocument('customerProfiles', slug(data.email || data.phone || data.name), data); await logAdminActivity('customer_created', { type: 'customer', description: `Created customer record for ${data.name}` }); closeModal(); toast('Customer record saved.'); })));

function renderTeam() {
  const query = normalise($('[data-filter="team"]')?.value);
  const status = $('[data-team-status]')?.value || '';
  const rows = state.team.filter(item => (!query || normalise([item.name, item.email, item.phone, item.areas, item.skills].join(' ')).includes(query)) && (!status || item.status === status));
  $('[data-team-grid]').innerHTML = rows.length ? rows.map(item => `<article class="admin-profile-card"><div class="admin-profile-head"><span class="admin-avatar">${esc((item.name || '?').split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase())}</span><div><h3>${esc(item.name)}</h3><p>${esc(item.role || 'Cleaner')} · ${statusBadge(item.status || 'active')}</p></div></div><p><i class="fa-solid fa-location-dot"></i> ${esc(Array.isArray(item.areas) ? item.areas.join(', ') : item.areas || 'No areas added')}</p><p><i class="fa-solid fa-broom"></i> ${esc(Array.isArray(item.skills) ? item.skills.join(', ') : item.skills || 'General cleaning')}</p><div class="admin-card-actions"><button class="btn btn-sm" data-edit-team="${esc(item.id)}">Edit</button><button class="btn btn-sm btn-ghost" data-team-schedule="${esc(item.id)}">Schedule</button></div></article>`).join('') : '<div class="admin-empty-state"><h3>No team members yet</h3><p>Add cleaners so bookings can be assigned.</p></div>';
  $$('[data-edit-team]').forEach(button => button.addEventListener('click', () => openTeamMember(state.team.find(item => item.id === button.dataset.editTeam))));
  $$('[data-team-schedule]').forEach(button => button.addEventListener('click', () => { state.scheduleCleaner = button.dataset.teamSchedule; $('[data-schedule-cleaner]').value = state.scheduleCleaner; switchTab('schedule'); renderSchedule(); }));
  renderTeamOptions();
}

function openTeamMember(item = {}) {
  showModal(`<form data-team-form class="admin-form-stack"><span class="admin-kicker">Team management</span><h2>${item.id ? 'Edit team member' : 'Add team member'}</h2><div class="admin-modal-grid"><label>Name<input name="name" value="${esc(item.name || '')}" required></label><label>Role<input name="role" value="${esc(item.role || 'Cleaner')}"></label><label>Email<input name="email" type="email" value="${esc(item.email || '')}"></label><label>Phone<input name="phone" value="${esc(item.phone || '')}"></label><label>Status<select name="status"><option value="active" ${item.status !== 'inactive' ? 'selected' : ''}>Active</option><option value="inactive" ${item.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></label><label>Employment type<select name="employmentType"><option>Employee</option><option>Self-employed</option><option>Contractor</option></select></label><label class="full">Areas covered<input name="areas" value="${esc(Array.isArray(item.areas) ? item.areas.join(', ') : item.areas || '')}" placeholder="Manchester, Salford"></label><label class="full">Skills / services<input name="skills" value="${esc(Array.isArray(item.skills) ? item.skills.join(', ') : item.skills || '')}" placeholder="Deep clean, oven, carpet"></label><label class="full">Working days<input name="workingDays" value="${esc(Array.isArray(item.workingDays) ? item.workingDays.join(', ') : item.workingDays || '')}" placeholder="Monday, Tuesday"></label><label class="full">Notes<textarea name="notes">${esc(item.notes || '')}</textarea></label></div><div class="admin-form-actions"><button class="btn">Save member</button>${item.id ? '<button class="btn btn-danger" type="button" data-archive-team>Archive</button>' : ''}</div></form>`, root => {
    $('[data-team-form]', root).addEventListener('submit', async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); ['areas', 'skills', 'workingDays'].forEach(key => data[key] = data[key].split(',').map(value => value.trim()).filter(Boolean)); const id = await setAdminDocument('teamMembers', item.id || '', data); await logAdminActivity(item.id ? 'team_member_updated' : 'team_member_created', { type: 'team', recordId: id, description: `${item.id ? 'Updated' : 'Added'} team member ${data.name}` }); closeModal(); toast('Team member saved.'); });
    $('[data-archive-team]', root)?.addEventListener('click', async () => { await archiveAdminRecord('teamMembers', item.id, 'Archived from team manager'); closeModal(); toast('Team member archived.'); });
  });
}
$('[data-add-team]')?.addEventListener('click', () => openTeamMember());

function renderTeamOptions() {
  const options = state.team.filter(item => item.status !== 'inactive').map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
  const schedule = $('[data-schedule-cleaner]');
  if (schedule) schedule.innerHTML = `<option value="">All cleaners</option>${options}`;
}

function filteredEnquiries() {
  const query = normalise($('[data-filter="enquiries"]')?.value);
  const status = $('[data-enquiry-status]')?.value || '';
  return state.enquiries.filter(row => (!query || normalise([row.name, row.email, row.phone, row.topic, row.message].join(' ')).includes(query)) && (!status || row.status === status));
}

function renderEnquiries() {
  const rows = filteredEnquiries();
  const list = $('[data-enquiry-list]');
  list.innerHTML = rows.length ? rows.map(row => `<button class="admin-inbox-item ${state.selectedEnquiryId === row.id ? 'active' : ''}" data-enquiry-id="${esc(row.id)}"><header><strong>${esc(row.name || row.email)}</strong>${statusBadge(row.status)}</header><small>${esc(row.topic || 'Enquiry')} · ${humanDateTime(row.createdAt)}</small><p>${esc(row.message || '')}</p></button>`).join('') : '<div class="admin-empty-state"><h3>No enquiries found</h3></div>';
  $$('[data-enquiry-id]', list).forEach(button => button.addEventListener('click', () => { state.selectedEnquiryId = button.dataset.enquiryId; renderEnquiries(); }));
  renderEnquiryPreview(state.enquiries.find(row => row.id === state.selectedEnquiryId));
}

function renderEnquiryPreview(row) {
  const node = $('[data-enquiry-preview]');
  if (!row) { node.innerHTML = '<div class="admin-empty-state"><i class="fa-regular fa-message"></i><h3>Select an enquiry</h3><p>The full message and reply actions will appear here.</p></div>'; return; }
  node.innerHTML = `<span class="admin-kicker">${esc(row.topic || 'Customer enquiry')}</span><h2>${esc(row.name || row.email)}</h2><div class="admin-detail-grid"><div class="admin-detail-item"><span>Email</span>${esc(row.email || '—')}</div><div class="admin-detail-item"><span>Phone</span>${esc(row.phone || '—')}</div><div class="admin-detail-item"><span>Received</span>${humanDateTime(row.createdAt)}</div><div class="admin-detail-item"><span>Status</span>${statusBadge(row.status)}</div></div><h3>Message</h3><p style="white-space:pre-wrap">${esc(row.message || '')}</p><label>Internal notes<textarea data-enquiry-notes rows="4">${esc(row.adminNotes || '')}</textarea></label><div class="admin-form-actions"><button class="btn" data-reply-enquiry><i class="fa-regular fa-envelope"></i> Reply</button><select data-enquiry-change-status><option value="new">New</option><option value="replied">Replied</option><option value="waiting">Waiting for customer</option><option value="resolved">Resolved</option><option value="spam">Spam</option></select><button class="btn btn-ghost" data-save-enquiry>Save notes/status</button><button class="btn btn-ghost" data-convert-enquiry>Convert to booking</button><button class="btn btn-danger" data-archive-enquiry>Archive</button></div>`;
  $('[data-enquiry-change-status]', node).value = row.status || 'new';
  $('[data-reply-enquiry]', node).addEventListener('click', () => { switchTab('email'); fillEmail({ to: row.email, subject: `Re: ${row.topic || 'Your enquiry'}`, body: `Hello ${row.name || ''},\n\n` }); });
  $('[data-save-enquiry]', node).addEventListener('click', async () => { await updateAdminDocument('enquiries', row.id, { status: $('[data-enquiry-change-status]', node).value, adminNotes: $('[data-enquiry-notes]', node).value }); await logAdminActivity('enquiry_updated', { type: 'customer', recordId: row.id, description: `Updated enquiry from ${row.name || row.email}` }); toast('Enquiry updated.'); });
  $('[data-convert-enquiry]', node).addEventListener('click', () => openBooking({ first_name: row.name || '', email: row.email || '', phone: row.phone || '', notes: row.message || '', status: 'awaiting_confirmation' }));
  $('[data-archive-enquiry]', node).addEventListener('click', async () => { if (!await confirmAction('Archive enquiry?', 'You can restore it later.', 'Archive')) return; await archiveAdminRecord('enquiries', row.id, 'Resolved or archived enquiry'); state.selectedEnquiryId = ''; toast('Enquiry archived.'); });
}

function renderApplications() {
  const query = normalise($('[data-filter="applications"]')?.value);
  const statusFilter = $('[data-application-status]')?.value || '';
  const roleFilter = $('[data-application-role]')?.value || '';
  const rows = state.applications.filter(row => (!query || normalise([row.name, row.email, row.phone, row.role, row.areas].join(' ')).includes(query)) && (!statusFilter || row.status === statusFilter) && (!roleFilter || row.role === roleFilter));
  const stages = ['new', 'reviewing', 'shortlisted', 'interview', 'offer', 'hired', 'rejected'];
  $('[data-application-board]').innerHTML = stages.map(stage => { const cards = rows.filter(row => (row.status || 'new') === stage); return `<section class="admin-kanban-column"><h3>${stage.replaceAll('_', ' ')} <span>${cards.length}</span></h3>${cards.map(row => `<article class="admin-applicant-card" data-open-application="${esc(row.id)}"><strong>${esc(row.name || 'Applicant')}</strong><p>${esc(row.role || 'Role not selected')}</p><small>${esc(Array.isArray(row.areas) ? row.areas.join(', ') : row.areas || '')}</small></article>`).join('')}</section>`; }).join('');
  $$('[data-open-application]').forEach(card => card.addEventListener('click', () => openApplication(state.applications.find(row => row.id === card.dataset.openApplication))));
  const roles = [...new Set(state.applications.map(row => row.role).filter(Boolean))];
  const roleNode = $('[data-application-role]');
  const current = roleNode.value;
  roleNode.innerHTML = `<option value="">All roles</option>${roles.map(role => `<option>${esc(role)}</option>`).join('')}`;
  roleNode.value = current;
}

function openApplication(row) {
  const stages = ['new', 'reviewing', 'shortlisted', 'interview', 'offer', 'hired', 'rejected', 'archived'];
  showModal(`<span class="admin-kicker">Recruitment pipeline</span><h2 id="admin-modal-title">${esc(row.name || 'Applicant')}</h2><div class="admin-detail-grid">${Object.entries(row).filter(([key]) => !['id', 'createdAt', 'updatedAt', 'adminNotes'].includes(key)).map(([key, value]) => `<div class="admin-detail-item"><span>${esc(key.replaceAll('_', ' '))}</span>${esc(Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : value)}</div>`).join('')}</div><label>Pipeline stage<select data-application-stage>${stages.map(stage => `<option value="${stage}" ${row.status === stage ? 'selected' : ''}>${stage}</option>`).join('')}</select></label><label>Internal notes<textarea data-application-notes rows="5">${esc(row.adminNotes || '')}</textarea></label><div class="admin-form-actions"><button class="btn" data-save-application>Save application</button><button class="btn btn-ghost" data-email-applicant>Email applicant</button><button class="btn btn-danger" data-archive-application>Archive</button></div>`, root => {
    $('[data-save-application]', root).addEventListener('click', async () => { await updateAdminDocument('applications', row.id, { status: $('[data-application-stage]', root).value, adminNotes: $('[data-application-notes]', root).value }); await logAdminActivity('application_updated', { type: 'customer', recordId: row.id, description: `Moved ${row.name || 'applicant'} to ${$('[data-application-stage]', root).value}` }); closeModal(); toast('Application updated.'); });
    $('[data-email-applicant]', root).addEventListener('click', () => { closeModal(); switchTab('email'); fillEmail({ to: row.email, subject: 'Update on your application', body: `Hello ${row.name || ''},\n\n` }); });
    $('[data-archive-application]', root).addEventListener('click', async () => { await archiveAdminRecord('applications', row.id, 'Archived application'); closeModal(); toast('Application archived.'); });
  });
}

function renderFeedback() {
  const query = normalise($('[data-filter="feedback"]')?.value);
  const status = $('[data-feedback-status]')?.value || '';
  const rating = $('[data-feedback-rating]')?.value || '';
  const rows = state.feedback.filter(row => (!query || normalise([row.name, row.email, row.feedback].join(' ')).includes(query)) && (!status || row.status === status) && (!rating || String(row.rating) === rating));
  $('[data-feedback-admin]').innerHTML = rows.length ? rows.map(row => `<article class="admin-review-card ${row.featured ? 'featured' : ''}"><div class="admin-card-heading"><div><span class="admin-stars">${'★'.repeat(Number(row.rating) || 0)}${'☆'.repeat(Math.max(0, 5 - Number(row.rating || 0)))}</span><h3>${esc(row.name || 'Customer')}</h3></div>${statusBadge(row.status)}</div><p>“${esc(row.feedback || '')}”</p><small>${esc(row.email || '')} · ${humanDateTime(row.createdAt)}</small><div class="admin-card-actions"><button class="btn btn-sm" data-publish-review="${esc(row.id)}">${row.status === 'published' ? 'Unpublish' : 'Publish'}</button><button class="btn btn-sm btn-ghost" data-feature-review="${esc(row.id)}">${row.featured ? 'Unfeature' : 'Feature'}</button><button class="btn btn-sm btn-ghost" data-reply-review="${esc(row.id)}">Reply</button><button class="btn btn-sm btn-danger" data-archive-review="${esc(row.id)}">Archive</button></div></article>`).join('') : '<div class="admin-empty-state"><h3>No reviews found</h3></div>';
  $$('[data-publish-review]').forEach(button => button.addEventListener('click', async () => { const row = state.feedback.find(item => item.id === button.dataset.publishReview); if (row.status === 'published') await unpublishFeedback(row.id); else await publishFeedback(row.id, row); await logAdminActivity(row.status === 'published' ? 'review_unpublished' : 'review_published', { type: 'review', recordId: row.id, description: `${row.status === 'published' ? 'Unpublished' : 'Published'} review from ${row.name}` }); }));
  $$('[data-feature-review]').forEach(button => button.addEventListener('click', async () => { const row = state.feedback.find(item => item.id === button.dataset.featureReview); await updateAdminDocument('feedbackSubmissions', row.id, { featured: !row.featured }); toast(row.featured ? 'Review unfeatured.' : 'Review featured.'); }));
  $$('[data-reply-review]').forEach(button => button.addEventListener('click', () => { const row = state.feedback.find(item => item.id === button.dataset.replyReview); switchTab('email'); fillEmail({ to: row.email, subject: 'Thank you for your feedback', body: `Hello ${row.name || ''},\n\nThank you for taking the time to leave a review.\n\n` }); }));
  $$('[data-archive-review]').forEach(button => button.addEventListener('click', async () => { await archiveAdminRecord('feedbackSubmissions', button.dataset.archiveReview, 'Archived review'); toast('Review archived.'); }));
}

function renderEmailCentre() {
  const select = $('[data-email-template]');
  select.innerHTML = `<option value="">Start from blank</option>${state.emailTemplates.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}`;
  $('[data-email-template-list]').innerHTML = state.emailTemplates.length ? state.emailTemplates.map(item => `<div class="admin-template-item"><span><strong>${esc(item.name)}</strong><small>${esc(item.subject || '')}</small></span><span><button data-use-template="${esc(item.id)}">Use</button><button data-edit-template="${esc(item.id)}"><i class="fa-solid fa-pen"></i></button></span></div>`).join('') : '<p>No saved templates yet.</p>';
  $('[data-email-history]').innerHTML = state.emailHistory.slice(0, 8).map(item => `<div class="admin-list-row"><span class="admin-list-main"><strong>${esc(item.subject || 'Email')}</strong><span>${esc(item.to || '')} · ${humanDateTime(item.createdAt)}</span></span>${statusBadge(item.status || 'sent')}</div>`).join('') || '<p>No email history yet.</p>';
  $$('[data-use-template]').forEach(button => button.addEventListener('click', () => useEmailTemplate(button.dataset.useTemplate)));
  $$('[data-edit-template]').forEach(button => button.addEventListener('click', () => openEmailTemplate(state.emailTemplates.find(item => item.id === button.dataset.editTemplate))));
  const recipients = [...new Map(state.customers.filter(item => item.email).map(item => [item.email, item])).values()];
  $('[data-recipient-list]').innerHTML = recipients.map(item => `<option value="${esc(item.email)}">${esc(item.name)}</option>`).join('');
}

function fillEmail({ to = '', subject = '', body = '' }) {
  const form = $('#admin-email-form');
  form.elements.to.value = to;
  form.elements.subject.value = subject;
  form.elements.body.value = body;
  updateEmailCounter();
}

function useEmailTemplate(id) {
  const item = state.emailTemplates.find(template => template.id === id);
  if (!item) return;
  const form = $('#admin-email-form');
  form.elements.subject.value = item.subject || '';
  form.elements.body.value = item.body || '';
  updateEmailCounter();
}

function openEmailTemplate(item = {}) {
  showModal(`<form data-email-template-form class="admin-form-stack"><span class="admin-kicker">Saved reply</span><h2>${item.id ? 'Edit template' : 'Add email template'}</h2><label>Template name<input name="name" value="${esc(item.name || '')}" required></label><label>Subject<input name="subject" value="${esc(item.subject || '')}" required></label><label>Message<textarea name="body" rows="10" required>${esc(item.body || '')}</textarea></label><button class="btn">Save template</button></form>`, root => $('[data-email-template-form]', root).addEventListener('submit', async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); const id = await setAdminDocument('emailTemplates', item.id || '', data); await logAdminActivity(item.id ? 'email_template_updated' : 'email_template_created', { type: 'email', recordId: id, description: `${item.id ? 'Updated' : 'Created'} email template ${data.name}` }); closeModal(); toast('Email template saved.'); }));
}

function updateEmailCounter() {
  const textarea = $('#admin-email-form')?.elements.body;
  if (textarea) $('[data-email-counter]').textContent = `${textarea.value.length} / 5000`;
}
$('#admin-email-form')?.elements.body.addEventListener('input', updateEmailCounter);
$('[data-email-template]')?.addEventListener('change', event => useEmailTemplate(event.target.value));
$('[data-add-email-template]')?.addEventListener('click', () => openEmailTemplate());
$('[data-save-draft]')?.addEventListener('click', async () => { const data = Object.fromEntries(new FormData($('#admin-email-form'))); await addAdminDocument('emailDrafts', data); toast('Draft saved.'); });
$('[data-send-test]')?.addEventListener('click', () => { $('#admin-email-form').elements.to.value = config.emailjs?.adminEmail || config.email || ''; });

$('#admin-email-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form));
  const cfg = config.emailjs || {};
  const status = $('[data-admin-email-status]');
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  status.className = 'form-status'; status.textContent = 'Sending…';
  try {
    if (!window.emailjs || !cfg.publicKey || !cfg.serviceId || !cfg.adminMessageTemplateId) throw new Error('EMAILJS_NOT_CONFIGURED');
    window.emailjs.init({ publicKey: cfg.publicKey });
    await window.emailjs.send(cfg.serviceId, cfg.adminMessageTemplateId, {
      to_email: data.to,
      email_subject: data.subject,
      message: data.body,
      is_feedback: false,
      is_application: false,
      is_admin_message: true,
      is_enquiry: false,
      customer_name: '', rating: '', feedback: '', role: '', work_preference: '', areas: '', topic: '', customer_email: '', customer_phone: '',
      from_name: config.businessName || "FAUSTINA'S SPARKLY SERVICES",
      reply_to: cfg.adminEmail || config.email
    });
    await addAdminDocument('emailHistory', { ...data, status: 'sent' });
    await logAdminActivity('email_sent', { type: 'email', description: `Sent “${data.subject}” to ${data.to}` });
    status.textContent = 'Email sent successfully.'; form.reset(); updateEmailCounter(); toast('Email sent.');
  } catch (error) {
    console.error(error);
    await addAdminDocument('emailHistory', { ...data, status: 'failed', error: error?.text || error?.message || '' }).catch(() => {});
    status.className = 'form-status error'; status.textContent = `Email could not be sent${error?.text ? `: ${error.text}` : '.'}`;
  } finally { button.disabled = false; }
});

function defaultServices() {
  return Object.entries(config.rates || {}).map(([id, item]) => ({ id, active: true, description: '', pricingType: item.quoteOnly ? 'quote' : item.fixed ? 'fixed' : 'hourly', price: item.fixed ?? item.hourly ?? 0, minimumHours: item.minimumHours || 1, ...item }));
}

function renderServices() {
  const services = state.serviceCatalog?.services || defaultServices();
  $('[data-service-grid]').innerHTML = services.map(item => `<article class="admin-service-card ${item.active === false ? 'inactive' : ''}"><div class="admin-card-heading"><div><h3>${esc(item.name || item.id)}</h3><p>${esc(item.description || 'No description added')}</p></div>${statusBadge(item.active === false ? 'inactive' : 'active')}</div><div class="admin-service-price">${item.pricingType === 'quote' || item.quoteOnly ? 'Quote required' : `${money(item.price ?? item.hourly ?? item.fixed)}${item.pricingType === 'hourly' || item.hourly ? '/hr' : ''}`}</div><p>Minimum ${esc(item.minimumHours || 1)} hour(s)</p><div class="admin-card-actions"><button class="btn btn-sm" data-edit-service="${esc(item.id)}">Edit</button><button class="btn btn-sm btn-ghost" data-toggle-service="${esc(item.id)}">${item.active === false ? 'Activate' : 'Deactivate'}</button></div></article>`).join('');
  $$('[data-edit-service]').forEach(button => button.addEventListener('click', () => openService(services.find(item => item.id === button.dataset.editService))));
  $$('[data-toggle-service]').forEach(button => button.addEventListener('click', async () => { const item = services.find(service => service.id === button.dataset.toggleService); item.active = item.active === false; await saveServiceCatalog(services); }));
}

async function saveServiceCatalog(services) {
  await setAdminDocument('settings', 'serviceCatalog', { services });
  state.serviceCatalog = { services };
  await logAdminActivity('services_updated', { type: 'website', description: 'Updated services and pricing catalogue' });
  renderServices(); toast('Service catalogue saved.');
}

function openService(item = {}) {
  showModal(`<form data-service-form class="admin-form-stack"><span class="admin-kicker">Service catalogue</span><h2>${item.id ? 'Edit service' : 'Add service'}</h2><div class="admin-modal-grid"><label>Service name<input name="name" value="${esc(item.name || '')}" required></label><label>Service ID<input name="id" value="${esc(item.id || '')}" ${item.id ? 'readonly' : ''} required></label><label>Pricing type<select name="pricingType"><option value="hourly" ${item.pricingType === 'hourly' || item.hourly ? 'selected' : ''}>Hourly</option><option value="fixed" ${item.pricingType === 'fixed' || item.fixed ? 'selected' : ''}>Fixed</option><option value="quote" ${item.pricingType === 'quote' || item.quoteOnly ? 'selected' : ''}>Quote required</option></select></label><label>Price<input name="price" type="number" min="0" step="0.01" value="${esc(item.price ?? item.hourly ?? item.fixed ?? '')}"></label><label>Minimum hours<input name="minimumHours" type="number" min="1" value="${esc(item.minimumHours || 1)}"></label><label class="admin-check-row"><input name="active" type="checkbox" ${item.active === false ? '' : 'checked'}><span>Visible and bookable</span></label><label class="full">Description<textarea name="description" rows="4">${esc(item.description || '')}</textarea></label></div><button class="btn">Save service</button></form>`, root => $('[data-service-form]', root).addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); data.id = slug(data.id || data.name); data.active = form.elements.active.checked; data.price = Number(data.price || 0); data.minimumHours = Number(data.minimumHours || 1); data.quoteOnly = data.pricingType === 'quote'; if (data.pricingType === 'hourly') data.hourly = data.price; if (data.pricingType === 'fixed') data.fixed = data.price; const services = [...(state.serviceCatalog?.services || defaultServices())]; const index = services.findIndex(service => service.id === data.id); if (index >= 0) services[index] = data; else services.push(data); await saveServiceCatalog(services); closeModal(); }));
}
$('[data-add-service]')?.addEventListener('click', () => openService());

function renderWebsiteContent() {
  const content = state.siteContent || {};
  const form = $('[data-site-content-form]');
  form.elements.businessName.value = content.businessName || config.businessName || '';
  form.elements.phoneDisplay.value = content.phoneDisplay || config.phoneDisplay || '';
  form.elements.email.value = content.email || config.email || '';
  form.elements.openingHours.value = content.openingHours || config.openingHours || '';
  form.elements.serviceAreas.value = (content.serviceAreas || config.serviceAreas || []).join('\n');
  const announcement = content.announcement || {};
  const aForm = $('[data-announcement-form]');
  aForm.elements.enabled.checked = Boolean(announcement.enabled);
  aForm.elements.message.value = announcement.message || '';
  aForm.elements.linkText.value = announcement.linkText || '';
  aForm.elements.linkUrl.value = announcement.linkUrl || '';
  renderFaqs(content.faqs || []);
  renderConfirmationEditors();
}

function renderFaqs(faqs) {
  $('[data-faq-list]').innerHTML = faqs.length ? faqs.map((faq, index) => `<div class="admin-list-row"><span class="admin-list-main"><strong>${esc(faq.question)}</strong><span>${esc(faq.answer)}</span></span><button class="admin-row-action" data-edit-faq="${index}">Edit</button></div>`).join('') : '<p>No FAQs added yet.</p>';
  $$('[data-edit-faq]').forEach(button => button.addEventListener('click', () => openFaq(Number(button.dataset.editFaq))));
}

function openFaq(index = -1) {
  const faqs = [...(state.siteContent?.faqs || [])];
  const faq = faqs[index] || {};
  showModal(`<form data-faq-form class="admin-form-stack"><h2>${index >= 0 ? 'Edit FAQ' : 'Add FAQ'}</h2><label>Question<input name="question" value="${esc(faq.question || '')}" required></label><label>Answer<textarea name="answer" rows="6" required>${esc(faq.answer || '')}</textarea></label><button class="btn">Save FAQ</button></form>`, root => $('[data-faq-form]', root).addEventListener('submit', async event => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); if (index >= 0) faqs[index] = data; else faqs.push(data); state.siteContent = { ...(state.siteContent || {}), faqs }; await setAdminDocument('settings', 'siteContent', state.siteContent); closeModal(); renderWebsiteContent(); toast('FAQ saved.'); }));
}
$('[data-add-faq]')?.addEventListener('click', () => openFaq());

function renderConfirmationEditors() {
  const defaults = {
    booking: { eyebrow: 'Deposit received', title: 'Thank you. Your £25 deposit has been paid.', message: "The selected slot is reserved while FAUSTINA'S SPARKLY SERVICES reviews the booking and communicates the actual service price. The £25 deposit is taken into account when the final amount due is confirmed.", next: 'We normally respond within one working day.' },
    application: { eyebrow: 'Application received', title: 'Thank you for applying to join our team.', message: 'Your application has been sent securely to the recruitment team for review.', next: 'Shortlisted applicants will be contacted.' }
  };
  const settings = state.confirmations || {};
  $('[data-confirmation-editors]').innerHTML = ['booking', 'application'].map(type => { const item = { ...defaults[type], ...(settings[type] || {}) }; return `<details><summary><strong>${type === 'booking' ? 'Booking confirmation' : 'Application confirmation'}</strong></summary><form data-confirmation-form="${type}" class="admin-form-stack"><label>Eyebrow<input name="eyebrow" value="${esc(item.eyebrow)}"></label><label>Heading<input name="title" value="${esc(item.title)}"></label><label>Main message<textarea name="message">${esc(item.message)}</textarea></label><label>Next step<textarea name="next">${esc(item.next)}</textarea></label><button class="btn btn-sm">Save ${type}</button></form></details>`; }).join('');
  $$('[data-confirmation-form]').forEach(form => form.addEventListener('submit', async event => { event.preventDefault(); const type = form.dataset.confirmationForm; const current = state.confirmations || {}; current[type] = Object.fromEntries(new FormData(form)); await saveConfirmationSettings(current); state.confirmations = current; toast('Confirmation page content saved.'); }));
}

$('[data-save-site-content]')?.addEventListener('click', async () => {
  const form = $('[data-site-content-form]');
  const aForm = $('[data-announcement-form]');
  const basic = Object.fromEntries(new FormData(form));
  basic.serviceAreas = basic.serviceAreas.split('\n').map(value => value.trim()).filter(Boolean);
  basic.announcement = { enabled: aForm.elements.enabled.checked, message: aForm.elements.message.value, linkText: aForm.elements.linkText.value, linkUrl: aForm.elements.linkUrl.value };
  const content = { ...(state.siteContent || {}), ...basic };
  await setAdminDocument('settings', 'siteContent', content);
  state.siteContent = content;
  await logAdminActivity('website_content_updated', { type: 'website', description: 'Updated business details and website announcement' });
  $('[data-site-content-status]').textContent = 'Website content saved.'; toast('Website content saved.');
});

const automationDefinitions = [
  ['bookingReceived', 'Deposit received', 'Immediately acknowledge a paid £25 booking deposit.', 'immediate'],
  ['bookingConfirmed', 'Booking confirmed', 'Send when an admin changes a booking to confirmed.', 'status'],
  ['bookingDeclined', 'Booking declined', 'Send when a booking is declined.', 'status'],
  ['bookingRescheduled', 'Booking rescheduled', 'Notify the customer after a date or time change.', 'status'],
  ['appointmentReminder', 'Appointment reminder', 'Send 24 hours before the appointment.', 'scheduled'],
  ['paymentReminder', 'Payment reminder', 'Remind customers with confirmed unpaid bookings.', 'scheduled'],
  ['cleaningCompleted', 'Cleaning completed', 'Send after a job is marked completed.', 'status'],
  ['reviewRequest', 'Review request', 'Ask for feedback after a completed clean.', 'scheduled'],
  ['applicationReceived', 'Application received', 'Acknowledge a new job application.', 'immediate']
];

function renderAutomations() {
  const settings = state.automationSettings || {};
  $('[data-automation-grid]').innerHTML = automationDefinitions.map(([id, name, description, mode]) => `<article class="admin-automation-card"><header><div><h3>${esc(name)}</h3><span class="admin-status ${mode === 'scheduled' ? 'pending' : 'active'}">${esc(mode)}</span></div><label class="admin-switch"><input type="checkbox" data-automation="${id}" ${settings[id]?.enabled ? 'checked' : ''}><span></span></label></header><p>${esc(description)}</p>${mode === 'scheduled' ? `<label>Timing<select data-automation-timing="${id}"><option value="24" ${settings[id]?.hours === 24 ? 'selected' : ''}>24 hours</option><option value="48" ${settings[id]?.hours === 48 ? 'selected' : ''}>48 hours</option></select></label>` : ''}</article>`).join('');
}
$('[data-save-automations]')?.addEventListener('click', async () => {
  const settings = {};
  automationDefinitions.forEach(([id, , , mode]) => { settings[id] = { enabled: $(`[data-automation="${id}"]`).checked, mode, hours: Number($(`[data-automation-timing="${id}"]`)?.value || 0) }; });
  await setAdminDocument('settings', 'automations', settings);
  state.automationSettings = settings;
  await logAdminActivity('automations_updated', { type: 'website', description: 'Updated customer communication automation settings' });
  toast('Automation settings saved.');
});

function reportRows() {
  const period = $('[data-report-period]')?.value || '30';
  if (period === 'all') return state.bookings;
  const start = Date.now() - Number(period) * 86400000;
  return state.bookings.filter(row => (parseDate(row.date)?.getTime() || timestampMs(row.createdAt)) >= start);
}

function renderReports() {
  const rows = reportRows();
  const completed = rows.filter(row => row.status === 'completed');
  const cancelled = rows.filter(row => ['cancelled', 'declined'].includes(row.status));
  const revenue = rows.filter(row => row.depositStatus === 'paid' || row.paymentStatus === 'deposit_paid' || row.balanceStatus === 'paid' || row.status === 'completed').reduce((sum, row) => sum + getReceivedAmount(row), 0);
  const average = rows.length ? rows.reduce((sum, row) => sum + getBookingTotal(row), 0) / rows.length : 0;
  const kpis = [['Bookings', rows.length, 'fa-calendar-check'], ['Revenue', money(revenue), 'fa-sterling-sign'], ['Average value', money(average), 'fa-chart-simple'], ['Cancellation rate', `${rows.length ? Math.round(cancelled.length / rows.length * 100) : 0}%`, 'fa-ban']];
  $('[data-report-kpis]').innerHTML = kpis.map(([label, value, icon]) => `<article class="admin-kpi"><div class="admin-kpi-head"><span>${esc(label)}</span><i class="admin-kpi-icon fa-solid ${icon}"></i></div><strong>${esc(value)}</strong></article>`).join('');
  renderBarChart($('[data-revenue-chart]'), monthlySeries(12));
  const serviceCounts = Object.entries(rows.reduce((acc, row) => { const name = getServiceName(row.service); acc[name] = (acc[name] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]);
  const maxService = Math.max(1, ...serviceCounts.map(([, count]) => count));
  $('[data-service-report]').innerHTML = serviceCounts.map(([name, count]) => `<div class="admin-progress-row"><div class="admin-progress-label"><span>${esc(name)}</span><b>${count}</b></div><div class="admin-progress"><span style="width:${count / maxService * 100}%"></span></div></div>`).join('') || '<p>No data.</p>';
  const statusCounts = Object.entries(rows.reduce((acc, row) => { acc[row.status || 'new'] = (acc[row.status || 'new'] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]);
  const maxStatus = Math.max(1, ...statusCounts.map(([, count]) => count));
  $('[data-status-report]').innerHTML = statusCounts.map(([status, count]) => `<div class="admin-progress-row"><div class="admin-progress-label"><span>${esc(status.replaceAll('_', ' '))}</span><b>${count}</b></div><div class="admin-progress"><span style="width:${count / maxStatus * 100}%"></span></div></div>`).join('') || '<p>No data.</p>';
  const returning = state.customers.filter(customer => customer.bookings.length > 1).length;
  const avgRating = state.feedback.length ? state.feedback.reduce((sum, row) => sum + Number(row.rating || 0), 0) / state.feedback.length : 0;
  const topService = serviceCounts[0]?.[0] || 'No data';
  $('[data-insights]').innerHTML = `<div class="admin-insight"><strong>${returning}</strong><span>Returning customers</span></div><div class="admin-insight"><strong>${avgRating.toFixed(1)} / 5</strong><span>Average review rating</span></div><div class="admin-insight"><strong>${esc(topService)}</strong><span>Most booked service</span></div><div class="admin-insight"><strong>${completed.length}</strong><span>Completed jobs</span></div><div class="admin-insight"><strong>${state.applications.filter(row => row.status === 'hired').length}</strong><span>Applicants hired</span></div><div class="admin-insight"><strong>${state.enquiries.filter(row => row.status === 'resolved').length}</strong><span>Resolved enquiries</span></div>`;
}
$('[data-report-period]')?.addEventListener('change', renderReports);

function renderActivity() {
  const query = normalise($('[data-filter="activity"]')?.value);
  const type = $('[data-activity-type]')?.value || '';
  const rows = state.activity.filter(row => (!query || normalise([row.action, row.description, row.adminEmail].join(' ')).includes(query)) && (!type || row.type === type));
  $('[data-activity-log]').innerHTML = rows.length ? rows.map(row => `<article class="admin-timeline-item"><span class="admin-timeline-icon"><i class="fa-solid fa-clock-rotate-left"></i></span><div class="admin-timeline-content"><strong>${esc(row.description || row.action)}</strong><p>${esc(row.adminEmail || 'Admin')} · ${humanDateTime(row.createdAt)}</p>${row.collection ? `<small>${esc(row.collection)} / ${esc(row.recordId)}</small>` : ''}</div></article>`).join('') : '<div class="admin-empty-state"><h3>No activity found</h3></div>';
}

function renderTrash() {
  const collection = $('[data-trash-collection]')?.value || '';
  const rows = state.archives.filter(item => !collection || item.sourceCollection === collection);
  $('[data-trash-table]').innerHTML = rows.length ? rows.map(item => `<tr><td>${esc(item.sourceCollection)}</td><td>${esc(item.record?.reference || item.record?.name || item.record?.email || item.sourceId)}</td><td>${humanDateTime(item.archivedAt)}</td><td>${esc(item.reason || '—')}</td><td><button class="admin-row-action" data-restore="${esc(item.id)}">Restore</button> <button class="admin-row-action" data-delete-archive="${esc(item.id)}">Delete forever</button></td></tr>`).join('') : '<tr><td colspan="5"><div class="admin-empty-state"><h3>Archive is empty</h3></div></td></tr>';
  $$('[data-restore]').forEach(button => button.addEventListener('click', async () => { await restoreArchivedRecord(button.dataset.restore); await logAdminActivity('record_restored', { type: 'general', recordId: button.dataset.restore, description: 'Restored archived record' }); toast('Record restored.'); }));
  $$('[data-delete-archive]').forEach(button => button.addEventListener('click', async () => { if (!await confirmAction('Delete forever?', 'This cannot be undone.', 'Delete permanently')) return; await adminDeleteDocument('archives', button.dataset.deleteArchive); toast('Archived record permanently deleted.'); }));
}

function renderSettings() {
  const settings = state.securitySettings || { sessionMinutes: 60, confirmDelete: true, preferArchive: true, trashDays: 90 };
  const form = $('[data-security-form]');
  form.elements.sessionMinutes.value = settings.sessionMinutes || 60;
  form.elements.confirmDelete.checked = settings.confirmDelete !== false;
  form.elements.preferArchive.checked = settings.preferArchive !== false;
  form.elements.trashDays.value = settings.trashDays || 90;
  $('[data-admin-users]').innerHTML = state.admins.length ? state.admins.map(item => `<div class="admin-list-row"><span class="admin-list-main"><strong>${esc(item.email || item.id)}</strong><span>${esc(item.role || 'admin')} · ${item.active === false ? 'inactive' : 'active'}</span></span>${statusBadge(item.active === false ? 'inactive' : 'active')}</div>`).join('') : '<p>Your current Firebase admin record controls access. Owner accounts can manage role records after deploying the updated rules.</p>';
}
$('[data-save-security]')?.addEventListener('click', async () => { const form = $('[data-security-form]'); const settings = { sessionMinutes: Number(form.elements.sessionMinutes.value), confirmDelete: form.elements.confirmDelete.checked, preferArchive: form.elements.preferArchive.checked, trashDays: Number(form.elements.trashDays.value) }; await setAdminDocument('settings', 'security', settings); state.securitySettings = settings; $('[data-security-status]').textContent = 'Security preferences saved.'; resetInactivityTimer(); toast('Security settings saved.'); });
$('[data-add-admin-user]')?.addEventListener('click', () => showModal(`<form data-admin-role-form class="admin-form-stack"><h2>Add admin role record</h2><p>Create the Firebase Authentication user first, then paste their UID here.</p><label>User UID<input name="uid" required></label><label>Email<input name="email" type="email" required></label><label>Role<select name="role"><option value="manager">Manager</option><option value="staff">Staff</option><option value="owner">Owner</option></select></label><label class="admin-check-row"><input name="active" type="checkbox" checked><span>Active access</span></label><button class="btn">Save role record</button></form>`, root => $('[data-admin-role-form]', root).addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); data.active = form.elements.active.checked; await setAdminDocument('admins', data.uid, { email: data.email, role: data.role, active: data.active }); closeModal(); toast('Admin role record saved.'); })));

function runSystemCheck() {
  const checks = [
    ['Firebase configured', isFirebaseConfigured],
    ['EmailJS public key', Boolean(config.emailjs?.publicKey && !config.emailjs.publicKey.startsWith('YOUR_'))],
    ['EmailJS service ID', Boolean(config.emailjs?.serviceId && !config.emailjs.serviceId.startsWith('YOUR_'))],
    ['Admin message template', Boolean(config.emailjs?.adminMessageTemplateId)],
    ['Availability slots', state.slots.length > 0],
    ['Admin profile', Boolean(state.profile)]
  ];
  $('[data-system-health]').innerHTML = checks.map(([name, ok]) => `<div class="admin-list-row"><span class="admin-list-main"><strong>${esc(name)}</strong></span>${statusBadge(ok ? 'active' : 'inactive')}</div>`).join('');
}
$('[data-check-health]')?.addEventListener('click', runSystemCheck);

function csvCell(value) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }
function downloadCsv(filename, rows) {
  if (!rows.length) { toast('There is no data to export.', 'error'); return; }
  const keys = [...new Set(rows.flatMap(row => Object.keys(row).filter(key => !['metadata', 'record'].includes(key))))];
  const csv = [keys.map(csvCell).join(','), ...rows.map(row => keys.map(key => csvCell(Array.isArray(row[key]) ? row[key].join('; ') : typeof row[key] === 'object' ? JSON.stringify(row[key]) : row[key])).join(','))].join('\n');
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = filename; link.click(); URL.revokeObjectURL(link.href);
}

function exportCollection(name) {
  const data = { bookings: state.bookings, customers: state.customers.map(item => ({ name: item.name, email: item.email, phone: item.phone, bookings: item.bookings.length, totalSpend: item.totalSpend, addresses: item.addresses })), enquiries: state.enquiries, applications: state.applications, feedback: state.feedback, activity: state.activity }[name] || [];
  downloadCsv(`faustina-${name}-${todayKey()}.csv`, data);
}
$$('[data-export]').forEach(button => button.addEventListener('click', () => exportCollection(button.dataset.export)));
$('[data-export-report]')?.addEventListener('click', () => downloadCsv(`faustina-report-${todayKey()}.csv`, reportRows()));
$('[data-export-overview]')?.addEventListener('click', () => downloadCsv(`faustina-overview-${todayKey()}.csv`, state.bookings));
$('[data-export-all]')?.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), bookings: state.bookings, enquiries: state.enquiries, applications: state.applications, feedback: state.feedback, team: state.team, emailTemplates: state.emailTemplates, activity: state.activity }, null, 2)], { type: 'application/json' });
  const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `faustina-admin-backup-${todayKey()}.json`; link.click(); URL.revokeObjectURL(link.href);
});

function printRecord(title, record) {
  const popup = window.open('', '_blank', 'width=900,height=700');
  popup.document.write(`<html><head><title>${esc(title)}</title><style>body{font-family:Arial;padding:30px}h1{color:#1f5a3c}dl{display:grid;grid-template-columns:180px 1fr;gap:8px}dt{font-weight:bold}dd{margin:0;border-bottom:1px solid #ddd;padding-bottom:7px}</style></head><body><h1>${esc(title)}</h1><dl>${Object.entries(record).filter(([key]) => !key.startsWith('_')).map(([key, value]) => `<dt>${esc(key.replaceAll('_', ' '))}</dt><dd>${esc(Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : value)}</dd>`).join('')}</dl><script>window.print()<\/script></body></html>`);
  popup.document.close();
}

function globalSearchResults(query) {
  if (!query) return [];
  const results = [];
  state.bookings.forEach(row => { if (normalise([row.reference, getBookingName(row), row.email, row.phone, row.postcode].join(' ')).includes(query)) results.push({ type: 'Booking', title: getBookingName(row), detail: row.reference || row.date, tab: 'bookings', action: () => openBooking(row) }); });
  state.customers.forEach(row => { if (normalise([row.name, row.email, row.phone].join(' ')).includes(query)) results.push({ type: 'Customer', title: row.name, detail: row.email || row.phone, tab: 'customers', action: () => openCustomer(row) }); });
  state.enquiries.forEach(row => { if (normalise([row.name, row.email, row.topic, row.message].join(' ')).includes(query)) results.push({ type: 'Enquiry', title: row.name || row.email, detail: row.topic || '', tab: 'enquiries', action: () => { state.selectedEnquiryId = row.id; switchTab('enquiries'); renderEnquiries(); } }); });
  state.applications.forEach(row => { if (normalise([row.name, row.email, row.role].join(' ')).includes(query)) results.push({ type: 'Application', title: row.name, detail: row.role || '', tab: 'applications', action: () => openApplication(row) }); });
  return results.slice(0, 12);
}

$('[data-global-search]')?.addEventListener('input', event => {
  const node = $('[data-global-search-results]');
  const query = normalise(event.target.value);
  const results = globalSearchResults(query);
  node.hidden = !query;
  node.innerHTML = results.length ? results.map((item, index) => `<button class="admin-search-result" data-search-index="${index}"><strong>${esc(item.title)}</strong><span>${esc(item.type)} · ${esc(item.detail)}</span></button>`).join('') : '<div class="admin-search-result">No matching records</div>';
  $$('[data-search-index]', node).forEach(button => button.addEventListener('click', () => { node.hidden = true; event.target.value = ''; results[Number(button.dataset.searchIndex)].action(); }));
});

document.addEventListener('click', event => { if (!$('.admin-global-search')?.contains(event.target)) $('[data-global-search-results]').hidden = true; });

function attachFilters() {
  const map = {
    'bookings': renderBookings,
    'customers': renderCustomers,
    'team': renderTeam,
    'enquiries': renderEnquiries,
    'applications': renderApplications,
    'feedback': renderFeedback,
    'activity': renderActivity
  };
  $$('[data-filter]').forEach(input => input.addEventListener('input', () => map[input.dataset.filter]?.()));
  $('[data-booking-status-filter]')?.addEventListener('change', renderBookings);
  $('[data-booking-region-filter]')?.addEventListener('change', renderBookings);
  $('[data-customer-segment]')?.addEventListener('change', renderCustomers);
  $('[data-team-status]')?.addEventListener('change', renderTeam);
  $('[data-enquiry-status]')?.addEventListener('change', renderEnquiries);
  $('[data-application-status]')?.addEventListener('change', renderApplications);
  $('[data-application-role]')?.addEventListener('change', renderApplications);
  $('[data-feedback-status]')?.addEventListener('change', renderFeedback);
  $('[data-feedback-rating]')?.addEventListener('change', renderFeedback);
  $('[data-activity-type]')?.addEventListener('change', renderActivity);
  $('[data-trash-collection]')?.addEventListener('change', renderTrash);
}

function rerenderAll() {
  buildCustomers();
  renderOverview();
  renderNotifications();
  renderBookings();
  renderSchedule();
  renderCustomers();
  renderTeam();
  renderEnquiries();
  renderApplications();
  renderFeedback();
  renderEmailCentre();
  renderServices();
  renderWebsiteContent();
  renderAutomations();
  renderReports();
  renderActivity();
  renderTrash();
  renderSettings();
}

async function subscribeData() {
  const subscriptions = [
    ['bookingRequests', rows => { state.bookings = rows.map(row => ({ ...row, _collection: 'bookingRequests' })); rerenderAll(); }, { orderBy: 'createdAt', limit: 500 }],
    ['enquiries', rows => { state.enquiries = rows; rerenderAll(); }, { orderBy: 'createdAt', limit: 500 }],
    ['applications', rows => { state.applications = rows; rerenderAll(); }, { orderBy: 'createdAt', limit: 500 }],
    ['feedbackSubmissions', rows => { state.feedback = rows; rerenderAll(); }, { orderBy: 'createdAt', limit: 500 }],
    ['teamMembers', rows => { state.team = rows; rerenderAll(); }, { orderBy: 'createdAt', limit: 200 }],
    ['emailTemplates', rows => { state.emailTemplates = rows; renderEmailCentre(); }, { orderBy: 'createdAt', limit: 200 }],
    ['emailHistory', rows => { state.emailHistory = rows; renderEmailCentre(); }, { orderBy: 'createdAt', limit: 100 }],
    ['activityLogs', rows => { state.activity = rows; renderActivity(); renderOverview(); }, { orderBy: 'createdAt', limit: 500 }],
    ['archives', rows => { state.archives = rows; renderTrash(); }, { orderBy: 'archivedAt', limit: 500 }],
    ['admins', rows => { state.admins = rows; renderSettings(); }, { limit: 100 }]
  ];
  for (const [collection, callback, options] of subscriptions) {
    state.unsubscribers.push(await subscribeAdminCollectionFlexible(collection, callback, options));
  }
  state.unsubscribers.push(await subscribeAdminDocument('settings', 'siteContent', value => { state.siteContent = value; renderWebsiteContent(); }));
  state.unsubscribers.push(await subscribeAdminDocument('settings', 'serviceCatalog', value => { state.serviceCatalog = value; renderServices(); }));
  state.unsubscribers.push(await subscribeAdminDocument('settings', 'automations', value => { state.automationSettings = value; renderAutomations(); }));
  state.unsubscribers.push(await subscribeAdminDocument('settings', 'security', value => { state.securitySettings = value; renderSettings(); resetInactivityTimer(); }));
}

async function initialiseDashboard() {
  state.initialised = true;
  attachFilters();
  state.availability = await getAvailabilitySettings().catch(() => null);
  if (state.availability?.slots?.length) state.slots = state.availability.slots;
  $('#admin-start').value = state.availability?.start || '06:00';
  $('#admin-end').value = state.availability?.end || '23:00';
  $$('.admin-day-toggles input').forEach(input => input.checked = (state.availability?.workingDays || config.workingDays || []).includes(Number(input.value)));
  state.confirmations = await getConfirmationSettings().catch(() => null);
  renderDefaultSlots();
  renderWebsiteContent();
  renderAutomations();
  renderSettings();
  await loadAvailabilityLocks();
  await subscribeData();
  await logAdminActivity('admin_signed_in', { type: 'security', description: `${state.user?.email || 'Admin'} signed in` }).catch(() => {});
}

if (isFirebaseConfigured) {
  await watchAdminAuth(async user => {
    if (user) {
      state.profile = await getAdminProfile(user.uid).catch(() => null);
      showDashboard(user);
    } else showLogin();
  });
} else showLogin();
