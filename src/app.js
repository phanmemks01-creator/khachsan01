import { HotelStore } from './store.js';
import { APP_VERSION, deepClone, id, isoLocal, validateState } from './model.js';
import {
  addCharge, availableRooms, cancelBooking, checkIn, checkOut, completeMaintenance, createBooking,
  createMaintenance, dashboard, financeReport, normalize, payInvoice, receiveStock, refundSurplus,
  roomRate, updateHousekeeping
} from './domain.js';

const store = new HotelStore();
const ui = {
  page: 'dashboard', state: null, busy: false, financeUnlockedUntil: 0,
  booking: { arrival: isoLocal(), departure: isoLocal(new Date(Date.now() + 86400000)), query: '', floor: '', roomType: '', selected: new Set() },
  roomFilter: { query: '', floor: '', status: '' }, finance: { from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) }
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = (value) => new Intl.NumberFormat('vi-VN').format(Math.round(Number(value || 0))) + ' ₫';
const dateTime = (value) => value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '';
const pct = (value) => `${Math.round(Number(value || 0) * 100)}%`;
const formData = (form) => Object.fromEntries(new FormData(form).entries());

function toast(message, error = false) {
  const node = $('#toast'); node.textContent = message; node.className = `toast${error ? ' error' : ''}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.add('hidden'), 4200);
}

function setBusy(active) {
  ui.busy = active; $('#busy').classList.toggle('hidden', !active);
  $$('button').forEach((button) => { if (!button.closest('#loginModal')) button.disabled = active; });
}

function statusClass(status) {
  if (['Phòng trống', 'Đã thanh toán', 'Hoàn thành'].includes(status)) return 'available done paid';
  if (['Đang ở', 'Chờ xử lý', 'Đang làm', 'Chờ thanh toán'].includes(status)) return 'occupied waiting';
  if (['Bảo trì', 'Tạm khóa', 'Đã hủy'].includes(status)) return 'maintenance cancelled';
  return 'booked';
}

function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').showModal(); }
function closeModal() { $('#modal').close(); }

async function mutate(action, successMessage) {
  if (ui.busy) return;
  setBusy(true);
  try {
    const next = action(ui.state); validateState(next); ui.state = next; render();
    await store.save(next);
    renderSync(); toast(successMessage || 'Đã lưu dữ liệu.');
  } catch (error) {
    toast(error.message || 'Không thể lưu dữ liệu.', true);
    if (error.code === 'VERSION_CONFLICT') { const result = await store.load(); ui.state = result.state; render(); }
  } finally { setBusy(false); }
}

function renderSync() {
  const badge = $('#modeBadge');
  badge.textContent = store.mode === 'supabase' ? '● Supabase' : '● Dữ liệu cục bộ';
  badge.className = `badge ${store.mode === 'supabase' ? '' : 'local'}`;
  $('#syncText').textContent = `Phiên bản ${APP_VERSION} · ${ui.state?.meta?.revision || 0} thay đổi`;
  $('#brandName').textContent = ui.state?.settings?.hotelName || 'HOTEL MANAGER PRO';
  $('#notice').innerHTML = store.mode === 'local' ? `<div class="notice">Đang chạy ở chế độ cục bộ. Cấu hình Supabase trên Vercel để dùng chung dữ liệu giữa nhiều thiết bị.</div>` : '';
}

const titles = {
  dashboard: ['Dashboard', 'Tình trạng vận hành phòng và công việc cần xử lý'], rooms: ['Sơ đồ phòng', 'Theo dõi phòng theo tầng, loại và trạng thái'],
  bookings: ['Đặt phòng', 'Gõ, lọc, chọn một hoặc nhiều phòng còn trống'], stays: ['Lưu trú', 'Nhận phòng, phát sinh và trả phòng'],
  services: ['Dịch vụ / Minibar', 'Ghi phát sinh và quản lý tồn kho'], payments: ['Thanh toán', 'Hóa đơn, thu nhiều lần và hoàn tiền thừa'],
  housekeeping: ['Buồng phòng', 'Vệ sinh, bảo trì và mở lại phòng'], finance: ['Tài chính', 'Báo cáo doanh thu theo khoảng ngày'], settings: ['Cài đặt', 'Thông tin khách sạn, phòng, giá và dịch vụ']
};

function navigate(page) {
  ui.page = page; $$('#nav button').forEach((button) => button.classList.toggle('active', button.dataset.page === page));
  $('#sidebar').classList.remove('open'); $('#sidebarBackdrop').classList.remove('open'); render();
}

function render() {
  if (!ui.state) return;
  const [title, subtitle] = titles[ui.page]; $('#pageTitle').textContent = title; $('#pageSubtitle').textContent = subtitle;
  const renderers = { dashboard: renderDashboard, rooms: renderRooms, bookings: renderBookings, stays: renderStays, services: renderServices, payments: renderPayments, housekeeping: renderHousekeeping, finance: renderFinance, settings: renderSettings };
  $('#content').innerHTML = renderers[ui.page](); renderSync();
}

function kpi(label, value, color = 'blue') { return `<div class="card kpi ${color}"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`; }

function renderDashboard() {
  const data = dashboard(ui.state); const unlocked = !ui.state.settings.financeLocked || Date.now() < ui.financeUnlockedUntil;
  const pending = ui.state.invoices.filter((item) => item.status === 'Chờ thanh toán').slice(0, 6);
  return `<div class="grid grid-6">${kpi('Tổng phòng', data.totalRooms)}${kpi('Phòng trống', data.available, 'green')}${kpi('Đã đặt', data.booked)}${kpi('Đang ở', data.occupied, 'orange')}${kpi('Chờ vệ sinh', data.cleaning, 'orange')}${kpi('Bảo trì', data.maintenance, 'red')}</div>
  <div class="grid grid-4" style="margin-top:14px">${kpi('Công suất phòng', pct(data.occupancyRate))}${kpi('Khách đến hôm nay', data.arrivalsToday)}${kpi('Trả phòng hôm nay', data.departuresToday)}${kpi('Hóa đơn chờ thu', data.pendingInvoices, 'red')}</div>
  <div class="grid grid-2" style="margin-top:14px"><div class="card"><h3>Tài chính tháng này</h3><div class="summary" style="margin-top:18px"><div><span>Doanh thu</span><b>${unlocked ? money(data.monthRevenue) : '🔒 Đã khóa'}</b></div><div><span>Công nợ</span><b>${unlocked ? money(data.outstanding) : '🔒 Đã khóa'}</b></div></div></div>
  <div class="card"><h3>Hóa đơn cần xử lý</h3>${pending.length ? pending.map((item) => `<p><b>${esc(item.id)}</b> · ${esc(item.roomId)} · ${money(item.due)}</p>`).join('') : '<div class="empty">Không có hóa đơn chờ thanh toán.</div>'}</div></div>`;
}

function renderRooms() {
  const { query, floor, status } = ui.roomFilter;
  const floors = [...new Set(ui.state.rooms.map((room) => room.floor))].sort();
  return `<div class="toolbar"><div class="field"><label>Tìm phòng</label><input id="roomQuery" value="${esc(query)}" placeholder="Gõ mã, tên hoặc loại phòng"></div><div class="field"><label>Tầng</label><select id="roomFloor"><option value="">Tất cả</option>${floors.map((item) => `<option ${String(item) === floor ? 'selected' : ''}>${item}</option>`).join('')}</select></div><div class="field"><label>Trạng thái</label><select id="roomStatus"><option value="">Tất cả</option>${['Phòng trống', 'Đã đặt', 'Đang ở', 'Chờ vệ sinh', 'Bảo trì', 'Tạm khóa'].map((item) => `<option ${item === status ? 'selected' : ''}>${item}</option>`).join('')}</select></div></div>
  <div id="roomGrid" class="room-grid">${roomCardsHtml()}</div>`;
}

function roomCardsHtml() {
  const { query, floor, status } = ui.roomFilter;
  const rooms = ui.state.rooms.filter((room) => room.active && (!query || normalize(`${room.id} ${room.name} ${room.roomType}`).includes(normalize(query))) && (!floor || String(room.floor) === floor) && (!status || room.status === status));
  return rooms.map((room) => `<div class="room-card"><h3>${esc(room.name)}<span class="status ${statusClass(room.status)}">${esc(room.status)}</span></h3><p>${esc(room.id)} · Tầng ${room.floor}</p><p>${esc(room.roomType)} · ${room.capacity} khách</p><div class="price">${money(roomRate(ui.state, room))}/đêm</div></div>`).join('') || '<div class="empty">Không có phòng phù hợp.</div>';
}

function bookingRoomCards() {
  const b = ui.booking; const rooms = availableRooms(ui.state, b.arrival, b.departure, b.query, { floor: b.floor, roomType: b.roomType });
  $('#bookingResultCount') && ($('#bookingResultCount').textContent = `${rooms.length} phòng có thể chọn`);
  return rooms.map((room) => `<button type="button" class="room-card ${b.selected.has(room.id) ? 'selected' : ''}" data-action="toggle-room" data-id="${esc(room.id)}"><h3>${esc(room.name)}<span>${b.selected.has(room.id) ? '✓' : '+'}</span></h3><p>${esc(room.roomType)} · Tầng ${room.floor}</p><p>Tối đa ${room.capacity} khách</p><div class="price">${money(roomRate(ui.state, room, b.arrival))}</div></button>`).join('') || '<div class="empty">Không còn phòng phù hợp trong khoảng đã chọn.</div>';
}

function renderBookingSelected() {
  const node = $('#bookingSelected'); if (!node) return;
  node.innerHTML = ui.booking.selected.size ? [...ui.booking.selected].map((roomId) => `<span class="selected-item">${esc(roomId)}</span>`).join('') : '<span class="sub">Chưa chọn phòng.</span>';
}

function renderBookings() {
  const b = ui.booking; const floors = [...new Set(ui.state.rooms.map((room) => room.floor))].sort(); const types = [...new Set(ui.state.rooms.map((room) => room.roomType))];
  return `<div class="card"><form id="bookingForm"><div class="form-grid"><div class="field"><label>Nhận dự kiến *</label><input name="arrival" id="bookingArrival" type="datetime-local" value="${esc(b.arrival)}" required></div><div class="field"><label>Trả dự kiến *</label><input name="departure" id="bookingDeparture" type="datetime-local" value="${esc(b.departure)}" required></div><div class="field"><label>Gõ tìm phòng</label><input id="bookingQuery" value="${esc(b.query)}" placeholder="Ví dụ: phòng đơn"></div><div class="field"><label>Tầng</label><select id="bookingFloor"><option value="">Tất cả</option>${floors.map((item) => `<option ${String(item) === b.floor ? 'selected' : ''}>${item}</option>`).join('')}</select></div><div class="field"><label>Loại phòng</label><select id="bookingType"><option value="">Tất cả</option>${types.map((item) => `<option ${item === b.roomType ? 'selected' : ''}>${esc(item)}</option>`).join('')}</select></div><div class="field"><label>Tên khách *</label><input name="guestName" required></div><div class="field"><label>Số điện thoại</label><input name="phone"></div><div class="field"><label>Số khách / phòng</label><input name="guestCount" type="number" min="1" value="1"></div><div class="field"><label>Tổng tiền cọc</label><input name="deposit" type="number" min="0" value="0"></div><div class="field"><label>Kênh đặt</label><select name="channel"><option>Trực tiếp</option><option>Điện thoại</option><option>Website</option><option>Đại lý</option></select></div><div class="field span-2"><label>Ghi chú</label><input name="note"></div></div>
  <div class="section-head"><div><h2>Chọn phòng còn trống</h2><p id="bookingResultCount"></p></div></div><div id="bookingSelected" class="selected-list"></div><div id="bookingRoomGrid" class="room-grid">${bookingRoomCards()}</div><div class="actions"><button class="button primary">Lưu đặt phòng</button></div></form></div>
  <div class="section-head"><div><h2>Danh sách đặt phòng</h2><p>Mỗi phòng là một dòng; cùng đoàn dùng chung mã nhóm.</p></div></div>${bookingTable()}`;
}

function bookingTable() {
  const rows = ui.state.bookings.slice(0, 300);
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Mã nhóm / Phiếu</th><th>Phòng</th><th>Khách</th><th>Nhận–trả</th><th>Giá / Cọc</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${rows.map((item) => `<tr><td><b>${esc(item.groupId)}</b><span class="sub">${esc(item.id)}</span></td><td><b>${esc(item.roomId)}</b><span class="sub">${esc(item.roomType)}</span></td><td>${esc(item.guestName)}<span class="sub">${esc(item.phone)}</span></td><td>${dateTime(item.arrival)}<span class="sub">→ ${dateTime(item.departure)} · ${item.nights} đêm</span></td><td>${money(item.expectedRate)}<span class="sub">Cọc ${money(item.deposit)}</span></td><td><span class="status ${statusClass(item.status)}">${esc(item.status)}</span></td><td>${['Chờ xác nhận', 'Đã xác nhận'].includes(item.status) ? `<button class="button success small" data-action="checkin" data-id="${esc(item.id)}">Nhận phòng</button> <button class="button danger small" data-action="cancel-booking" data-id="${esc(item.id)}">Hủy</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Chưa có đặt phòng.</td></tr>'}</tbody></table></div>`;
}

function renderStays() {
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Mã lưu trú</th><th>Phòng</th><th>Khách</th><th>Nhận phòng</th><th>Trả dự kiến</th><th>Cọc</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${ui.state.stays.map((item) => `<tr><td>${esc(item.id)}</td><td><b>${esc(item.roomId)}</b></td><td>${esc(item.guestName)}<span class="sub">${esc(item.phone)}</span></td><td>${dateTime(item.checkIn)}</td><td>${dateTime(item.expectedCheckout)}</td><td>${money(item.deposit)}</td><td><span class="status ${statusClass(item.status)}">${esc(item.status)}</span></td><td>${item.status === 'Đang ở' ? `<button class="button primary small" data-action="open-checkout" data-id="${esc(item.id)}">Trả phòng</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Chưa có lượt lưu trú.</td></tr>'}</tbody></table></div>`;
}

function renderServices() {
  const activeStays = ui.state.stays.filter((item) => item.status === 'Đang ở'); const services = ui.state.services.filter((item) => item.active);
  return `<div class="grid grid-2"><div class="card"><h2>Ghi phát sinh</h2><form id="chargeForm" style="margin-top:15px"><div class="form-grid"><div class="field span-2"><label>Khách đang lưu trú</label><select name="stayId" required><option value="">Chọn phòng</option>${activeStays.map((item) => `<option value="${esc(item.id)}">${esc(item.roomId)} · ${esc(item.guestName)}</option>`).join('')}</select></div><div class="field"><label>Dịch vụ</label><select name="serviceId" required><option value="">Chọn dịch vụ</option>${services.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} · ${money(item.price)}</option>`).join('')}</select></div><div class="field"><label>Số lượng</label><input name="quantity" type="number" min="1" value="1"></div><div class="field span-2"><label>Ghi chú</label><input name="note"></div></div><div class="actions"><button class="button success">Ghi phát sinh</button></div></form></div>
  <div class="card"><h2>Nhập kho minibar</h2><form id="stockForm" style="margin-top:15px"><div class="form-grid"><div class="field span-2"><label>Mặt hàng</label><select name="serviceId" required><option value="">Chọn mặt hàng</option>${services.filter((item) => item.trackStock).map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select></div><div class="field"><label>Số lượng</label><input name="quantity" type="number" min="1" required></div><div class="field"><label>Giá nhập</label><input name="cost" type="number" min="0"></div><div class="field span-2"><label>Nhà cung cấp</label><input name="supplier"></div></div><div class="actions"><button class="button primary">Nhập kho</button></div></form></div></div>
  <div class="section-head"><h2>Tồn kho</h2></div><div class="grid grid-4">${services.filter((item) => item.trackStock).map((item) => `<div class="card kpi ${item.stock <= item.minStock ? 'red' : 'green'}"><small>${esc(item.name)} · ${esc(item.unit)}</small><strong>${item.stock}</strong><span>Tối thiểu ${item.minStock} · Giá bán ${money(item.price)}</span></div>`).join('')}</div>
  <div class="section-head"><h2>Phát sinh gần đây</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Thời gian</th><th>Phòng</th><th>Nội dung</th><th>SL</th><th>Thành tiền</th><th>Trạng thái</th></tr></thead><tbody>${ui.state.charges.slice(0, 100).map((item) => `<tr><td>${dateTime(item.at)}</td><td>${esc(item.roomId)}</td><td>${esc(item.name)}</td><td>${item.quantity} ${esc(item.unit)}</td><td>${money(item.amount)}</td><td>${esc(item.status)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Chưa có phát sinh.</td></tr>'}</tbody></table></div>`;
}

function renderPayments() {
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Hóa đơn</th><th>Phòng / Khách</th><th>Tiền phòng</th><th>Dịch vụ</th><th>Tổng</th><th>Cọc + Đã thu</th><th>Còn thu / Thừa</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${ui.state.invoices.map((item) => `<tr><td><b>${esc(item.id)}</b><span class="sub">${dateTime(item.createdAt)}</span></td><td>${esc(item.roomId)}<span class="sub">${esc(item.guestName)}</span></td><td>${money(item.roomAmount)}</td><td>${money(item.serviceAmount)}</td><td><b>${money(item.total)}</b></td><td>${money(item.deposit + item.paid)}</td><td>${item.due ? money(item.due) : item.surplus ? `Thừa ${money(item.surplus)}` : '0 ₫'}</td><td><span class="status ${statusClass(item.status)}">${esc(item.status)}</span></td><td><button class="button small" data-action="print-invoice" data-id="${esc(item.id)}">In</button> ${item.due > 0 ? `<button class="button primary small" data-action="open-payment" data-id="${esc(item.id)}">Thu tiền</button>` : ''} ${item.surplus > 0 ? `<button class="button danger small" data-action="refund" data-id="${esc(item.id)}">Hoàn thừa</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Chưa có hóa đơn.</td></tr>'}</tbody></table></div>`;
}

function renderHousekeeping() {
  const rooms = ui.state.rooms.filter((room) => room.active);
  return `<div class="grid grid-2"><div><div class="section-head"><h2>Công việc vệ sinh</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Phòng</th><th>Công việc</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${ui.state.housekeeping.map((item) => `<tr><td><b>${esc(item.roomId)}</b></td><td>${esc(item.type)}<span class="sub">${dateTime(item.createdAt)}</span></td><td><span class="status ${statusClass(item.status)}">${esc(item.status)}</span></td><td>${item.status === 'Chờ xử lý' ? `<button class="button small" data-action="housekeeping-start" data-id="${esc(item.id)}">Bắt đầu</button>` : ''}${item.status !== 'Hoàn thành' ? ` <button class="button success small" data-action="housekeeping-done" data-id="${esc(item.id)}">Hoàn thành</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Chưa có công việc vệ sinh.</td></tr>'}</tbody></table></div></div>
  <div><div class="section-head"><h2>Bảo trì</h2><button class="button primary small" data-action="open-maintenance">+ Báo hỏng</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Phòng</th><th>Sự cố</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${ui.state.maintenance.map((item) => `<tr><td>${esc(item.roomId)}</td><td>${esc(item.issue)}<span class="sub">${esc(item.priority)}</span></td><td><span class="status ${statusClass(item.status)}">${esc(item.status)}</span></td><td>${item.status !== 'Hoàn thành' ? `<button class="button success small" data-action="maintenance-done" data-id="${esc(item.id)}">Hoàn thành</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Chưa có phiếu bảo trì.</td></tr>'}</tbody></table></div></div></div>
  <div class="section-head"><h2>Danh sách toàn bộ buồng phòng</h2></div><div class="room-grid">${rooms.map((room) => `<div class="room-card"><h3>${esc(room.name)}<span class="status ${statusClass(room.status)}">${esc(room.status)}</span></h3><p>${esc(room.roomType)} · Tầng ${room.floor}</p><div class="price">${money(roomRate(ui.state, room))}</div></div>`).join('')}</div>`;
}

function financeUnlocked() { return !ui.state.settings.financeLocked || Date.now() < ui.financeUnlockedUntil; }
function renderFinance() {
  if (!financeUnlocked()) return `<div class="card finance-lock"><div class="lock">🔒</div><h2>Tài chính đang khóa</h2><p>Nhập PIN quản lý để xem doanh thu.</p><button class="button primary" data-action="open-finance">Mở khóa tài chính</button></div>`;
  const report = financeReport(ui.state, ui.finance.from, ui.finance.to); const max = Math.max(1, ...report.byDay.map((item) => item.amount));
  return `<div class="toolbar"><div class="field"><label>Từ ngày</label><input id="financeFrom" type="date" value="${ui.finance.from}"></div><div class="field"><label>Đến ngày</label><input id="financeTo" type="date" value="${ui.finance.to}"></div><button class="button primary" data-action="filter-finance">Lọc báo cáo</button><button class="button" onclick="window.print()">In báo cáo</button></div>
  <div class="grid grid-4">${kpi('Số hóa đơn', report.invoiceCount)}${kpi('Tổng doanh thu', money(report.revenue), 'green')}${kpi('Thực thu', money(report.cashReceived))}${kpi('Công nợ hiện tại', money(report.outstanding), 'red')}${kpi('Tiền phòng', money(report.roomRevenue))}${kpi('Dịch vụ', money(report.serviceRevenue))}${kpi('Phụ thu', money(report.surcharge))}${kpi('Thuế GTGT', money(report.vat))}</div>
  <div class="card" style="margin-top:14px"><h3>Doanh thu theo ngày</h3><div class="bar-chart" style="margin-top:16px">${report.byDay.map((item) => `<div class="bar-row"><span>${esc(item.date)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, item.amount / max * 100)}%"></div></div><strong>${money(item.amount)}</strong></div>`).join('') || '<div class="empty">Chưa có doanh thu trong khoảng ngày.</div>'}</div></div>`;
}

function renderSettings() {
  const s = ui.state.settings;
  return `<div class="card"><h2>Thông tin khách sạn</h2><form id="settingsForm" style="margin-top:15px"><div class="form-grid"><div class="field span-2"><label>Tên khách sạn</label><input name="hotelName" value="${esc(s.hotelName)}"></div><div class="field span-2"><label>Địa chỉ</label><input name="address" value="${esc(s.address)}"></div><div class="field"><label>Điện thoại</label><input name="phone" value="${esc(s.phone)}"></div><div class="field"><label>Email</label><input name="email" value="${esc(s.email)}"></div><div class="field"><label>Mã số thuế</label><input name="taxCode" value="${esc(s.taxCode)}"></div><div class="field"><label>Chọn logo PNG/JPG/WebP</label><input id="logoInput" type="file" accept="image/png,image/jpeg,image/webp"></div><div class="field"><label>VAT (ví dụ 0.08)</label><input name="vatRate" type="number" step="0.01" min="0" max="1" value="${s.vatRate}"></div><div class="field"><label>Phí dịch vụ</label><input name="serviceFeeRate" type="number" step="0.01" min="0" max="1" value="${s.serviceFeeRate}"></div><div class="field"><label>Giờ nhận phòng</label><input name="checkInTime" type="time" value="${esc(s.checkInTime)}"></div><div class="field"><label>Giờ trả phòng</label><input name="checkOutTime" type="time" value="${esc(s.checkOutTime)}"></div><div class="field"><label>Khóa mục tài chính</label><select name="financeLocked"><option value="true" ${s.financeLocked ? 'selected' : ''}>Bật</option><option value="false" ${!s.financeLocked ? 'selected' : ''}>Tắt</option></select></div><div class="field"><label>Thời gian mở khóa (phút)</label><input name="financeSessionMinutes" type="number" min="5" max="120" value="${s.financeSessionMinutes}"></div><div class="field"><label>Số lần nhập PIN sai</label><input name="financeMaxAttempts" type="number" min="3" max="10" value="${s.financeMaxAttempts || 5}"></div><div class="field"><label>Thời gian khóa tạm (phút)</label><input name="financeLockMinutes" type="number" min="5" max="60" value="${s.financeLockMinutes || 15}"></div><div class="field span-2"><label>Tiêu đề hóa đơn</label><input name="invoiceTitle" value="${esc(s.invoiceTitle)}"></div><div class="field span-2"><label>Lời cuối hóa đơn</label><input name="invoiceFooter" value="${esc(s.invoiceFooter)}"></div></div>${s.logo ? `<img src="${esc(s.logo)}" alt="Logo hiện tại" style="max-height:80px;margin-top:12px">` : ''}<div class="actions"><button type="button" class="button" data-action="restore-backup">Khôi phục bản sao</button><button type="button" class="button" data-action="change-finance-pin">Đổi PIN tài chính</button><button class="button primary">Lưu cài đặt</button></div></form></div>
  <div class="section-head"><div><h2>Danh sách phòng và giá hiện hành</h2><p>Giữ cấu trúc nguyên phòng, không có giường ghép.</p></div><div><button class="button" data-action="open-rate-edit">Sửa bảng giá</button> <button class="button primary" data-action="open-room-add">+ Thêm phòng</button></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Mã</th><th>Tên phòng</th><th>Tầng</th><th>Loại</th><th>Sức chứa</th><th>Giá thường / cuối tuần</th><th>Trạng thái</th><th>Hoạt động</th></tr></thead><tbody>${ui.state.rooms.map((room) => { const rate = ui.state.rates.find((item) => item.roomType === room.roomType); return `<tr><td>${esc(room.id)}</td><td>${esc(room.name)}</td><td>${room.floor}</td><td>${esc(room.roomType)}</td><td>${room.capacity}</td><td>${money(rate?.weekday)} / ${money(rate?.weekend)}</td><td>${esc(room.status)}</td><td><button class="button small" data-action="toggle-room-active" data-id="${esc(room.id)}">${room.active ? 'Đang bật' : 'Đang tắt'}</button></td></tr>`; }).join('')}</tbody></table></div>
  <div class="section-head"><h2>Danh mục dịch vụ / đồ giải khát</h2><button class="button primary" data-action="open-service-add">+ Thêm dịch vụ</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Mã</th><th>Loại</th><th>Tên</th><th>Đơn vị</th><th>Giá nhập</th><th>Giá bán</th><th>Tồn</th><th>Hoạt động</th></tr></thead><tbody>${ui.state.services.map((item) => `<tr><td>${esc(item.id)}</td><td>${esc(item.type)}</td><td>${esc(item.name)}</td><td>${esc(item.unit)}</td><td>${money(item.cost)}</td><td>${money(item.price)}</td><td>${item.trackStock ? item.stock : '—'}</td><td><button class="button small" data-action="toggle-service-active" data-id="${esc(item.id)}">${item.active ? 'Đang bật' : 'Đang tắt'}</button></td></tr>`).join('')}</tbody></table></div>`;
}

function checkoutModal(stayId) { openModal(`<h2>Trả phòng</h2><form id="checkoutForm"><input type="hidden" name="stayId" value="${esc(stayId)}"><div class="form-grid"><div class="field span-2"><label>Thời gian trả</label><input name="checkout" type="datetime-local" value="${isoLocal()}" required></div><div class="field"><label>Phụ thu</label><input name="surcharge" type="number" min="0" value="0"></div><div class="field"><label>Giảm tiền</label><input name="discount" type="number" min="0" value="0"></div><div class="field span-2"><label>Lý do giảm</label><input name="discountReason"></div><div class="field span-2"><label>Ghi chú</label><input name="note"></div></div><div class="actions no-print"><button class="button primary">Trả phòng & lập hóa đơn</button></div></form>`); }
function paymentModal(invoiceId) { const invoice = ui.state.invoices.find((item) => item.id === invoiceId); openModal(`<h2>Thu tiền hóa đơn ${esc(invoiceId)}</h2><form id="paymentForm"><input type="hidden" name="invoiceId" value="${esc(invoiceId)}"><div class="form-grid"><div class="field span-2"><label>Số tiền</label><input name="amount" type="number" min="1" value="${invoice.due}" required></div><div class="field span-2"><label>Phương thức</label><select name="method"><option>Tiền mặt</option><option>Chuyển khoản</option><option>Thẻ</option></select></div><div class="field span-4"><label>Ghi chú</label><input name="note"></div></div><div class="actions"><button class="button success">Ghi nhận thanh toán</button></div></form>`); }
function maintenanceModal() { openModal(`<h2>Báo hỏng / bảo trì</h2><form id="maintenanceForm"><div class="form-grid"><div class="field span-2"><label>Phòng</label><select name="roomId" required><option value="">Chọn phòng</option>${ui.state.rooms.filter((room) => room.active).map((room) => `<option value="${esc(room.id)}">${esc(room.name)}</option>`).join('')}</select></div><div class="field span-2"><label>Mức độ</label><select name="priority"><option>Thường</option><option>Ưu tiên</option><option>Khẩn</option></select></div><div class="field span-4"><label>Sự cố</label><textarea name="issue" required></textarea></div></div><div class="actions"><button class="button danger">Tạo phiếu bảo trì</button></div></form>`); }
function financeModal() { openModal(`<h2>Mở khóa tài chính</h2><form id="financePinForm"><label>Mã PIN quản lý<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" required></label><p class="sub">PIN mặc định khi tạo mới: 2468. Hãy đổi trong Cài đặt.</p><div class="actions"><button class="button primary">Xác thực</button></div></form>`); }

function invoiceModal(invoiceId) {
  const invoice = ui.state.invoices.find((item) => item.id === invoiceId); const lines = ui.state.invoiceLines.filter((item) => item.invoiceId === invoiceId); const s = ui.state.settings;
  openModal(`<div class="invoice-print"><header>${s.logo ? `<img src="${esc(s.logo)}" alt="Logo" style="max-height:70px">` : ''}<h2>${esc(s.hotelName)}</h2><p>${esc(s.address)} · ${esc(s.phone)} · MST ${esc(s.taxCode)}</p><h3>${esc(s.invoiceTitle)}</h3></header><p><b>Mã hóa đơn:</b> ${esc(invoice.id)}<br><b>Khách:</b> ${esc(invoice.guestName)} · <b>Phòng:</b> ${esc(invoice.roomId)}<br><b>Lưu trú:</b> ${dateTime(invoice.checkIn)} – ${dateTime(invoice.checkout)} (${invoice.nights} đêm)</p><table><thead><tr><th>Nội dung</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>${lines.map((line) => `<tr><td>${esc(line.name)}</td><td>${line.quantity} ${esc(line.unit)}</td><td>${money(line.unitPrice)}</td><td>${money(line.amount)}</td></tr>`).join('')}</tbody></table><p style="text-align:right"><b>Phụ thu:</b> ${money(invoice.surcharge)}<br><b>Giảm tiền:</b> ${money(invoice.discount)}<br><b>Phí dịch vụ:</b> ${money(invoice.serviceFee)}<br><b>VAT:</b> ${money(invoice.vat)}<br><b>Tổng thanh toán:</b> ${money(invoice.total)}<br><b>Tiền cọc + đã thu:</b> ${money(invoice.deposit + invoice.paid)}<br><b>Còn phải thu:</b> ${money(invoice.due)}</p><p style="text-align:center">${esc(s.invoiceFooter)}</p><div class="actions no-print"><button type="button" class="button primary" onclick="window.print()">In hóa đơn</button></div></div>`);
}

async function sha256(text) { const data = new TextEncoder().encode(text); const hash = await crypto.subtle.digest('SHA-256', data); return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }

document.addEventListener('click', async (event) => {
  const nav = event.target.closest('[data-page]'); if (nav) { navigate(nav.dataset.page); return; }
  const actionNode = event.target.closest('[data-action]'); if (!actionNode) return;
  const action = actionNode.dataset.action; const itemId = actionNode.dataset.id;
  if (action === 'toggle-room') { ui.booking.selected.has(itemId) ? ui.booking.selected.delete(itemId) : ui.booking.selected.add(itemId); $('#bookingRoomGrid').innerHTML = bookingRoomCards(); renderBookingSelected(); }
  if (action === 'checkin') await mutate((state) => checkIn(state, itemId), 'Đã nhận phòng.');
  if (action === 'cancel-booking' && confirm('Xác nhận hủy phiếu đặt phòng?')) await mutate((state) => cancelBooking(state, itemId), 'Đã hủy đặt phòng.');
  if (action === 'open-checkout') checkoutModal(itemId);
  if (action === 'open-payment') paymentModal(itemId);
  if (action === 'refund') await mutate((state) => refundSurplus(state, itemId), 'Đã hoàn tiền thừa.');
  if (action === 'print-invoice') invoiceModal(itemId);
  if (action === 'housekeeping-start') await mutate((state) => updateHousekeeping(state, itemId, 'Đang làm'), 'Đã bắt đầu vệ sinh.');
  if (action === 'housekeeping-done') await mutate((state) => updateHousekeeping(state, itemId, 'Hoàn thành'), 'Đã hoàn thành vệ sinh và cập nhật phòng.');
  if (action === 'open-maintenance') maintenanceModal();
  if (action === 'maintenance-done') await mutate((state) => completeMaintenance(state, itemId), 'Đã hoàn thành bảo trì.');
  if (action === 'open-finance') financeModal();
  if (action === 'filter-finance') { ui.finance.from = $('#financeFrom').value; ui.finance.to = $('#financeTo').value; render(); }
  if (action === 'restore-backup') $('#restoreInput').click();
  if (action === 'change-finance-pin') openModal(`<h2>Đổi PIN tài chính</h2><form id="changePinForm"><label>PIN hiện tại<input name="currentPin" type="password" inputmode="numeric" required></label><label>PIN mới (4–8 số)<input name="newPin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" required></label><div class="actions"><button class="button primary">Đổi PIN</button></div></form>`);
  if (action === 'open-room-add') openModal(`<h2>Thêm phòng</h2><form id="roomAddForm"><div class="form-grid"><div class="field"><label>Mã phòng</label><input name="id" required></div><div class="field"><label>Tên phòng</label><input name="name" required></div><div class="field"><label>Tầng</label><input name="floor" type="number" min="1" required></div><div class="field"><label>Loại phòng</label><select name="roomType">${ui.state.rates.map((rate) => `<option>${esc(rate.roomType)}</option>`).join('')}</select></div><div class="field"><label>Sức chứa</label><input name="capacity" type="number" min="1" required></div></div><div class="actions"><button class="button primary">Thêm phòng</button></div></form>`);
  if (action === 'open-rate-edit') openModal(`<h2>Sửa bảng giá phòng</h2><form id="rateEditForm"><div class="form-grid">${ui.state.rates.map((rate, index) => `<input type="hidden" name="id_${index}" value="${esc(rate.id)}"><div class="field span-2"><label>${esc(rate.roomType)} · ngày thường</label><input name="weekday_${index}" type="number" min="0" value="${rate.weekday}" required></div><div class="field span-2"><label>${esc(rate.roomType)} · cuối tuần</label><input name="weekend_${index}" type="number" min="0" value="${rate.weekend}" required></div>`).join('')}</div><div class="actions"><button class="button primary">Lưu bảng giá</button></div></form>`);
  if (action === 'open-service-add') openModal(`<h2>Thêm dịch vụ</h2><form id="serviceAddForm"><div class="form-grid"><div class="field"><label>Mã</label><input name="id" required></div><div class="field"><label>Loại</label><select name="type"><option>Đồ giải khát</option><option>Dịch vụ</option><option>Phụ thu</option></select></div><div class="field span-2"><label>Tên dịch vụ</label><input name="name" required></div><div class="field"><label>Đơn vị</label><input name="unit" required></div><div class="field"><label>Giá nhập</label><input name="cost" type="number" min="0" value="0"></div><div class="field"><label>Giá bán</label><input name="price" type="number" min="0" required></div><div class="field"><label>Tồn ban đầu</label><input name="stock" type="number" min="0" value="0"></div></div><div class="actions"><button class="button primary">Thêm dịch vụ</button></div></form>`);
  if (action === 'toggle-room-active') await mutate((state) => { const next = deepClone(state); const room = next.rooms.find((item) => item.id === itemId); if (room.status === 'Đang ở') throw new Error('Không thể tắt phòng đang có khách.'); room.active = !room.active; next.meta.revision += 1; return next; }, 'Đã cập nhật trạng thái hoạt động của phòng.');
  if (action === 'toggle-service-active') await mutate((state) => { const next = deepClone(state); const service = next.services.find((item) => item.id === itemId); service.active = !service.active; next.meta.revision += 1; return next; }, 'Đã cập nhật trạng thái dịch vụ.');
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'roomQuery') { ui.roomFilter.query = event.target.value; $('#roomGrid').innerHTML = roomCardsHtml(); }
  if (event.target.id === 'bookingQuery') { ui.booking.query = event.target.value; $('#bookingRoomGrid').innerHTML = bookingRoomCards(); }
});
document.addEventListener('change', (event) => {
  if (event.target.id === 'roomFloor') { ui.roomFilter.floor = event.target.value; $('#roomGrid').innerHTML = roomCardsHtml(); }
  if (event.target.id === 'roomStatus') { ui.roomFilter.status = event.target.value; $('#roomGrid').innerHTML = roomCardsHtml(); }
  if (event.target.id === 'bookingArrival') { ui.booking.arrival = event.target.value; ui.booking.selected.clear(); $('#bookingRoomGrid').innerHTML = bookingRoomCards(); renderBookingSelected(); }
  if (event.target.id === 'bookingDeparture') { ui.booking.departure = event.target.value; ui.booking.selected.clear(); $('#bookingRoomGrid').innerHTML = bookingRoomCards(); renderBookingSelected(); }
  if (event.target.id === 'bookingFloor') { ui.booking.floor = event.target.value; $('#bookingRoomGrid').innerHTML = bookingRoomCards(); }
  if (event.target.id === 'bookingType') { ui.booking.roomType = event.target.value; $('#bookingRoomGrid').innerHTML = bookingRoomCards(); }
});

document.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.target; const data = formData(form);
  if (form.id === 'bookingForm') { data.roomIds = [...ui.booking.selected]; data.arrival = ui.booking.arrival; data.departure = ui.booking.departure; await mutate((state) => createBooking(state, data), 'Đã lưu đặt phòng.'); ui.booking.selected.clear(); }
  if (form.id === 'chargeForm') { await mutate((state) => addCharge(state, data), 'Đã ghi phát sinh.'); form.reset(); }
  if (form.id === 'stockForm') { await mutate((state) => receiveStock(state, data), 'Đã nhập kho.'); form.reset(); }
  if (form.id === 'checkoutForm') { await mutate((state) => checkOut(state, data.stayId, data), 'Đã trả phòng và lập hóa đơn.'); closeModal(); }
  if (form.id === 'paymentForm') { await mutate((state) => payInvoice(state, data.invoiceId, data), 'Đã ghi nhận thanh toán.'); closeModal(); }
  if (form.id === 'maintenanceForm') { await mutate((state) => createMaintenance(state, data.roomId, data.issue, data.priority), 'Đã tạo phiếu bảo trì.'); closeModal(); }
  if (form.id === 'financePinForm') {
    const lockedUntil = Number(sessionStorage.getItem('hotel-finance-locked-until') || 0);
    if (Date.now() < lockedUntil) return toast(`Tài chính đang tạm khóa. Vui lòng thử lại sau ${Math.ceil((lockedUntil - Date.now()) / 60000)} phút.`, true);
    if (await sha256(data.pin) !== ui.state.settings.financePinHash) {
      const attempts = Number(sessionStorage.getItem('hotel-finance-attempts') || 0) + 1;
      const max = Number(ui.state.settings.financeMaxAttempts || 5);
      if (attempts >= max) {
        const until = Date.now() + Number(ui.state.settings.financeLockMinutes || 15) * 60000;
        sessionStorage.setItem('hotel-finance-locked-until', String(until)); sessionStorage.setItem('hotel-finance-attempts', '0');
        return toast(`Nhập sai quá ${max} lần. Tài chính đã tạm khóa.`, true);
      }
      sessionStorage.setItem('hotel-finance-attempts', String(attempts)); return toast(`Mã PIN không đúng. Còn ${max - attempts} lần thử.`, true);
    }
    sessionStorage.removeItem('hotel-finance-attempts'); sessionStorage.removeItem('hotel-finance-locked-until');
    ui.financeUnlockedUntil = Date.now() + Number(ui.state.settings.financeSessionMinutes || 30) * 60000; closeModal(); render();
  }
  if (form.id === 'changePinForm') { if (await sha256(data.currentPin) !== ui.state.settings.financePinHash) return toast('PIN hiện tại không đúng.', true); const hash = await sha256(data.newPin); await mutate((state) => { const next = deepClone(state); next.settings.financePinHash = hash; next.meta.revision += 1; next.meta.updatedAt = new Date().toISOString(); return next; }, 'Đã đổi PIN tài chính.'); closeModal(); }
  if (form.id === 'settingsForm') { await mutate((state) => { const next = deepClone(state); next.settings = { ...next.settings, ...data, financeLocked: data.financeLocked === 'true', vatRate: Number(data.vatRate || 0), serviceFeeRate: Number(data.serviceFeeRate || 0), financeSessionMinutes: Number(data.financeSessionMinutes || 30), financeMaxAttempts: Number(data.financeMaxAttempts || 5), financeLockMinutes: Number(data.financeLockMinutes || 15) }; next.meta.revision += 1; next.meta.updatedAt = new Date().toISOString(); return next; }, 'Đã lưu cài đặt.'); }
  if (form.id === 'roomAddForm') { await mutate((state) => { const next = deepClone(state); const roomId = String(data.id).trim().toUpperCase(); if (next.rooms.some((room) => room.id === roomId)) throw new Error('Mã phòng đã tồn tại.'); next.rooms.push({ id: roomId, name: data.name.trim(), floor: Number(data.floor), roomType: data.roomType, capacity: Number(data.capacity), status: 'Phòng trống', active: true, note: '' }); next.meta.revision += 1; return next; }, 'Đã thêm phòng.'); closeModal(); }
  if (form.id === 'rateEditForm') { await mutate((state) => { const next = deepClone(state); next.rates.forEach((rate, index) => { rate.weekday = Math.max(0, Number(data[`weekday_${index}`] || 0)); rate.weekend = Math.max(0, Number(data[`weekend_${index}`] || 0)); }); next.meta.revision += 1; next.meta.updatedAt = new Date().toISOString(); return next; }, 'Đã cập nhật bảng giá.'); closeModal(); }
  if (form.id === 'serviceAddForm') { await mutate((state) => { const next = deepClone(state); const serviceId = String(data.id).trim().toUpperCase(); if (next.services.some((item) => item.id === serviceId)) throw new Error('Mã dịch vụ đã tồn tại.'); next.services.push({ id: serviceId, type: data.type, name: data.name.trim(), unit: data.unit.trim(), cost: Number(data.cost || 0), price: Number(data.price || 0), trackStock: data.type === 'Đồ giải khát', stock: Number(data.stock || 0), minStock: 0, active: true }); next.meta.revision += 1; return next; }, 'Đã thêm dịch vụ.'); closeModal(); }
});

$('#nav').addEventListener('click', () => {});
$('#menuButton').addEventListener('click', () => { $('#sidebar').classList.toggle('open'); $('#sidebarBackdrop').classList.toggle('open'); });
$('#sidebarBackdrop').addEventListener('click', () => { $('#sidebar').classList.remove('open'); $('#sidebarBackdrop').classList.remove('open'); });
$('#refreshButton').addEventListener('click', async () => { setBusy(true); const result = await store.load(); if (result.requiresLogin) $('#loginModal').showModal(); else { ui.state = result.state; render(); toast('Đã tải dữ liệu mới nhất.'); } setBusy(false); });
$('#backupButton').addEventListener('click', () => { const blob = new Blob([store.exportJson()], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `hotel-manager-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href); });
$('#restoreInput').addEventListener('change', async (event) => { const file = event.target.files[0]; if (!file || !confirm('Khôi phục sẽ thay toàn bộ dữ liệu hiện tại. Tiếp tục?')) return; setBusy(true); try { ui.state = await store.importJson(await file.text()); render(); toast('Đã khôi phục bản sao.'); } catch (error) { toast(error.message, true); } finally { setBusy(false); event.target.value = ''; } });
document.addEventListener('change', async (event) => {
  if (event.target.id !== 'logoInput') return;
  const file = event.target.files[0]; if (!file) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast('Logo phải là PNG, JPG hoặc WebP.', true);
  if (file.size > 350000) return toast('Logo tối đa 350 KB để đồng bộ nhanh.', true);
  const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
  await mutate((state) => { const next = deepClone(state); next.settings.logo = dataUrl; next.meta.revision += 1; next.meta.updatedAt = new Date().toISOString(); return next; }, 'Đã cập nhật logo.');
});
$('#loginForm').addEventListener('submit', async (event) => { event.preventDefault(); $('#loginError').textContent = ''; try { const result = await store.login($('#accessKeyInput').value); ui.state = result.state; $('#loginModal').close(); $('#app').classList.remove('hidden'); render(); } catch (error) { $('#loginError').textContent = error.message; } });

async function start() {
  const result = await store.load(); ui.state = result.state;
  $('#boot').classList.add('hidden'); $('#app').classList.remove('hidden');
  if (result.requiresLogin) $('#loginModal').showModal();
  render(); if (result.warning) toast(result.warning, true);
}

start().catch((error) => { $('#boot').innerHTML = `<strong>Không thể khởi động: ${esc(error.message)}</strong>`; });
