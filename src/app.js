import { excelWorkbook } from './excel.js';
import { HotelStore } from './store.js';
import { APP_VERSION, deepClone, id, isoLocal, validateState } from './model.js';
import {
  saveEmployee, addCharge, adjustInvoice, availableRooms, cancelBooking, checkIn, checkOut, completeMaintenance, createBooking,
  createMaintenance, directCheckIn, dashboard, roomPerformance, extendStay, financeReport, invoiceGroupId, normalize, payInvoice, payInvoiceGroup, receiveStock, refundSurplus,
  roomPriceQuote, roomRate, roomAvailable, transferRoom, updateHousekeeping
} from './domain.js';

const store = new HotelStore();
const reportToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const ui = {
  performance: { from: reportToday.slice(0, 7) + '-01', to: reportToday },
  mapRoomId: null,
  page: 'dashboard', state: null, busy: false, financeUnlockedUntil: 0,
  booking: { arrival: isoLocal(), departure: isoLocal(new Date(Date.now() + 86400000)), priceMode: 'Theo ngày', query: '', floor: '', roomType: '', selected: new Set() },
  roomFilter: { query: '', floor: '', status: '' },
  listFilters: {
    bookings: { room: '', date: '', guest: '', phone: '' },
    stays: { room: '', date: '', guest: '', phone: '' },
    payments: { room: '', date: '', guest: '', phone: '' }
  },
  finance: { from: reportToday.slice(0, 7) + '-01', to: reportToday, detailDate: '' }
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = (value) => new Intl.NumberFormat('vi-VN').format(Math.round(Number(value || 0))) + ' ₫';
const dateTime = (value) => value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value)) : '';
const pct = (value) => `${Math.round(Number(value || 0) * 100)}%`;
const moneyRaw = (value) => String(value ?? '').replace(/[^\d-]/g, '');
const formatMoneyInput = (input) => { const raw = moneyRaw(input.value); input.value = raw === '' ? '' : new Intl.NumberFormat('vi-VN').format(Number(raw)); };
const formData = (form) => {
  const data = Object.fromEntries(new FormData(form).entries());
  $$('[data-money]', form).forEach((input) => { if (input.name) data[input.name] = moneyRaw(data[input.name]); });
  return data;
};

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

function openModal(html) { $('#modalBody').innerHTML = `<div class="modal-content">${html}</div>`; $('#modal').showModal(); requestAnimationFrame(() => $('#modalBody input, #modalBody select, #modalBody textarea')?.focus()); }
function closeModal() { $('#modal').close(); ui.mapRoomId = null; }

async function mutate(action, successMessage) {
  if (ui.busy) return false;
  setBusy(true);
  $('#modalBody [data-save-error]')?.remove();
  try {
    const next = action(ui.state); validateState(next);
    await store.save(next);
    ui.state = next; render(); toast(successMessage || 'Đã lưu dữ liệu.'); return true;
  } catch (error) {
    const message = error.message || 'Không thể lưu dữ liệu.';
    toast(message, true);
    if ($('#modal').open) {
      const alert = document.createElement('p');
      alert.className = 'error-text'; alert.dataset.saveError = ''; alert.setAttribute('role', 'alert');
      alert.textContent = message; $('#modalBody .modal-content').append(alert);
    }
    if (error.code === 'VERSION_CONFLICT') { const result = await store.load(); ui.state = result.state; render(); }
    return false;
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
  services: ['Dịch vụ / Minibar', 'Ghi phát sinh và quản lý tồn kho'], payments: ['Thanh toán', 'Thanh toán riêng từng phòng hoặc gộp nhiều phòng cùng mã nhóm'],
  housekeeping: ['Buồng phòng', 'Vệ sinh, bảo trì và mở lại phòng'], finance: ['Tài chính', 'Báo cáo doanh thu theo khoảng ngày'], settings: ['Cài đặt', 'Thông tin khách sạn, phòng, giá và dịch vụ']
};

function navigate(page) {
  ui.mapRoomId = null;
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

function roomTypePerformanceChart(report) {
  const colors = ['#2563eb', '#0d9488', '#9333ea', '#ea580c', '#db2777', '#0891b2', '#4f46e5', '#65a30d'];
  if (!report.byType.length) return '<div class="empty">Chưa có loại phòng đang hoạt động để hiển thị biểu đồ.</div>';
  if (!report.capacityHours) return '<div class="empty">Khoảng ngày đã chọn chưa có thời gian thực tế để tính hiệu suất.</div>';
  return `<div role="figure" aria-label="Biểu đồ hiệu suất theo loại phòng, thang đo từ 0 đến 100 phần trăm" style="margin:18px 0 24px"><p class="sub">Mỗi màu tương ứng một loại phòng. Độ dài thanh thể hiện hiệu suất theo giờ trong khoảng ngày đã chọn.</p><div style="display:flex;justify-content:space-between;font-size:12px;color:#64748b;margin:12px 0 6px" aria-hidden="true"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>${report.byType.map((row, index) => {
    const color = colors[index % colors.length];
    const percent = Math.max(0, Math.min(100, row.rate * 100));
    return `<div style="margin:0 0 18px"><div style="display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:6px"><span style="min-width:0;overflow-wrap:anywhere"><span aria-hidden="true" style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${color};margin-right:7px"></span><b>${esc(row.type)}</b> <span class="sub" style="display:inline">(${row.rooms} phòng)</span></span><strong style="color:${color};white-space:nowrap">${pct(row.rate)}</strong></div><div role="img" aria-label="${esc(row.type)}: ${pct(row.rate)}" style="height:24px;border-radius:6px;overflow:hidden;background-color:#f1f5f9;background-image:linear-gradient(to right,transparent calc(100% - 1px),#cbd5e1 0);background-size:25% 100%"><div style="height:100%;width:${percent}%;background:${color};border-radius:6px"></div></div></div>`;
  }).join('')}</div>`;
}

function renderRoomPerformance(unlocked) {
  const { from, to } = ui.performance;
  const report = roomPerformance(ui.state, from, to);
  const hours = (value) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value);
  return `<div class="card" style="margin-top:14px"><h2>2. Báo cáo hiệu suất phòng theo khoảng ngày</h2><form id="performanceForm" class="toolbar" style="margin-top:14px"><div class="field"><label>Từ ngày</label><input type="date" name="from" value="${esc(from)}" required></div><div class="field"><label>Đến ngày</label><input type="date" name="to" value="${esc(to)}" required></div><button class="button primary">Xem báo cáo</button></form><p class="sub">Tính cả hai ngày đã chọn, theo giờ Việt Nam; ngày hôm nay tính đến thời điểm hiện tại. Hiệu suất = giờ phòng thực tế có khách / tổng giờ của các phòng đang hoạt động. Phù hợp cả thuê giờ, qua đêm và theo ngày; không phải công suất theo đêm bán.</p><div class="grid grid-4">${kpi('Hiệu suất theo giờ', report.capacityHours ? pct(report.rate) : '—')}${kpi('Giờ phòng có khách', hours(report.occupiedHours))}${kpi('Tổng giờ phòng', hours(report.capacityHours))}${kpi('Tiền phòng trả trong kỳ', unlocked ? money(report.roomRevenue) : '🔒 Đã khóa')}</div><p class="sub">Mẫu số dùng danh sách phòng đang hoạt động hiện tại, bao gồm phòng chờ vệ sinh/bảo trì/tạm khóa; chưa có lịch sử tăng giảm số phòng. Tiền phòng lấy từ hóa đơn có ngày trả trong kỳ, gồm cả chưa thu; không gồm dịch vụ, thuế, phụ thu và giảm giá chung.</p><div class="grid grid-2"><div><h3>Hiệu suất theo loại phòng</h3>${roomTypePerformanceChart(report)}<div class="table-wrap"><table class="table"><thead><tr><th>Loại phòng</th><th>Số phòng</th><th>Giờ có khách</th><th>Hiệu suất</th></tr></thead><tbody>${report.byType.map((row) => `<tr><td>${esc(row.type)}</td><td>${row.rooms}</td><td>${hours(row.occupiedHours)}</td><td>${report.capacityHours ? pct(row.rate) : '—'}</td></tr>`).join('')}</tbody></table></div></div><div><h3>Cảnh báo và đề xuất</h3><p class="sub">Ngưỡng 40%/80% là tham khảo nội bộ, không phải chuẩn ngành. Cảnh báo hiện tại độc lập với khoảng báo cáo.</p>${report.alerts.map((alert) => `<div class="notice" style="margin:10px 0"><b>${esc(alert.level)} · ${esc(alert.text)}</b><p>${esc(alert.action)}</p></div>`).join('') || '<p>Chưa có cảnh báo theo các quy tắc hiện tại.</p>'}</div></div><details style="margin-top:14px"><summary>Chi tiết hiệu suất theo ngày (${report.daily.length} ngày)</summary><div class="table-wrap" style="max-height:420px;overflow:auto"><table class="table"><thead><tr><th>Ngày</th><th>Giờ có khách</th><th>Tổng giờ phòng</th><th>Hiệu suất</th></tr></thead><tbody>${report.daily.map((row) => `<tr><td>${esc(row.date.split('-').reverse().join('/'))}</td><td>${hours(row.occupiedHours)}</td><td>${hours(row.capacityHours)}</td><td>${pct(row.rate)}</td></tr>`).join('') || '<tr><td colspan="4">Chưa có thời gian thực tế trong khoảng đã chọn.</td></tr>'}</tbody></table></div></details></div>`;
}

function renderDashboard() {
  const data = dashboard(ui.state); const unlocked = !ui.state.settings.financeLocked || Date.now() < ui.financeUnlockedUntil;
  const pending = ui.state.invoices.filter((item) => item.status === 'Chờ thanh toán').slice(0, 6);
  return `<div class="grid grid-6">${kpi('Tổng phòng', data.totalRooms)}${kpi('Phòng trống', data.available, 'green')}${kpi('Đã đặt', data.booked)}${kpi('Đang ở', data.occupied, 'orange')}${kpi('Chờ vệ sinh', data.cleaning, 'orange')}${kpi('Bảo trì', data.maintenance, 'red')}</div>
  <div class="grid grid-4" style="margin-top:14px">${kpi('Công suất phòng', pct(data.occupancyRate))}${kpi('Khách đến hôm nay', data.arrivalsToday)}${kpi('Trả phòng hôm nay', data.departuresToday)}${kpi('Hóa đơn chờ thu', data.pendingInvoices, 'red')}</div>
  <div class="grid grid-2" style="margin-top:14px"><div class="card"><h3>Tài chính tháng này</h3><div class="summary" style="margin-top:18px"><div><span>Doanh thu</span><b>${unlocked ? money(data.monthRevenue) : '🔒 Đã khóa'}</b></div><div><span>Công nợ</span><b>${unlocked ? money(data.outstanding) : '🔒 Đã khóa'}</b></div></div></div>
  <div class="card"><h3>Hóa đơn cần xử lý</h3>${pending.length ? pending.map((item) => `<p><b>${esc(item.id)}</b> · ${esc(item.roomId)} · ${money(item.due)}</p>`).join('') : '<div class="empty">Không có hóa đơn chờ thanh toán.</div>'}</div></div>${renderRoomPerformance(unlocked)}`;
}

function renderRooms() {
  const { query, floor, status } = ui.roomFilter;
  const floors = [...new Set(ui.state.rooms.map((room) => room.floor))].sort((a, b) => String(a).localeCompare(String(b), 'vi', { numeric: true }));
  return `<div class="toolbar"><div class="field"><label>Tìm phòng</label><input id="roomQuery" value="${esc(query)}" placeholder="Gõ mã, tên hoặc loại phòng"></div><div class="field"><label>Tầng</label><select id="roomFloor"><option value="">Tất cả</option>${floors.map((item) => `<option ${String(item) === floor ? 'selected' : ''}>${item}</option>`).join('')}</select></div><div class="field"><label>Trạng thái</label><select id="roomStatus"><option value="">Tất cả</option>${['Phòng trống', 'Đã đặt', 'Đang ở', 'Chờ vệ sinh', 'Bảo trì', 'Tạm khóa'].map((item) => `<option ${item === status ? 'selected' : ''}>${item}</option>`).join('')}</select></div></div>
  <p class="sub">Bấm vào phòng để xem khách, nhận/trả phòng, dịch vụ, thanh toán hoặc vệ sinh. Các phòng được nhóm theo tầng.</p><div id="roomGrid">${roomCardsHtml()}</div>`;
}

function roomCardsHtml() {
  const { query, floor, status } = ui.roomFilter;
  const rooms = ui.state.rooms.filter((room) => room.active && (!query || normalize(`${room.id} ${room.name} ${room.roomType}`).includes(normalize(query))) && (!floor || String(room.floor) === floor) && (!status || room.status === status));
  if (!rooms.length) return '<div class="empty">Không có phòng phù hợp.</div>';
  const floors = [...new Set(rooms.map((room) => String(room.floor)))].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }));
  return floors.map((floorName) => {
    const group = rooms.filter((room) => String(room.floor) === floorName).sort((a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true }));
    return `<section style="margin-bottom:24px"><div class="section-head" style="padding:12px 16px;border-radius:12px;background:#e0f2fe;border-left:5px solid #0284c7"><h2 style="margin:0">Tầng ${esc(floorName)}</h2><span>${group.length} phòng hiển thị</span></div><div class="room-grid">${group.map((room) => `<button type="button" class="room-card" data-action="open-map-booking" data-id="${esc(room.id)}" aria-label="Đặt ${esc(room.name)}, tầng ${esc(floorName)}, ${esc(room.status)}" style="text-align:left"><h3>${esc(room.name)}<span class="status ${statusClass(room.status)}">${esc(room.status)}</span></h3><p>${esc(room.id)} · ${esc(room.roomType)} · ${room.capacity} khách</p><div class="price">${money(roomRate(ui.state, room))}/đêm</div><p class="sub">Bấm để xem và thao tác</p></button>`).join('')}</div></section>`;
  }).join('');
}

function roomOperationsModal(roomId) {
  const room = ui.state.rooms.find((item) => item.id === roomId && item.active);
  if (!room) return toast('Không tìm thấy phòng.', true);
  ui.mapRoomId = roomId;
  const stay = ui.state.stays.find((item) => item.roomId === roomId && item.status === 'Đang ở');
  const bookings = ui.state.bookings.filter((item) => item.roomId === roomId && ['Chờ xác nhận', 'Đã xác nhận'].includes(item.status)).sort((a, b) => new Date(a.arrival) - new Date(b.arrival));
  const tasks = ui.state.housekeeping.filter((item) => item.roomId === roomId && !['Hoàn thành', 'Đã hủy'].includes(item.status));
  const invoices = ui.state.invoices.filter((item) => item.roomId === roomId && item.status !== 'Đã hủy' && (item.due > 0 || item.surplus > 0));
  const guestInfo = (item) => `<p><b>${esc(item.guestName)}</b> · SĐT: ${esc(item.phone || 'Chưa nhập')} · ${item.guestCount || 1} khách</p><p>${esc(item.priceMode || 'Theo ngày')} · Tiền cọc: ${money(item.deposit)}</p>${item.note ? `<p>Ghi chú: ${esc(item.note)}</p>` : ''}`;
  const charges = stay ? ui.state.charges.filter((item) => item.stayId === stay.id) : [];
  openModal(`<h2>${esc(room.name)} · Tầng ${esc(room.floor)}</h2><p>${esc(room.roomType)} · <b>${esc(room.status)}</b></p>
    ${stay ? `<div class="card"><h3>Khách đang lưu trú</h3>${guestInfo(stay)}<p>Nhân viên nhận phòng: <b>${esc(stay.checkInEmployeeName || 'Chưa ghi nhận')}</b></p><p>Nhận: ${dateTime(stay.checkIn)}<br>Trả dự kiến: ${dateTime(stay.expectedCheckout)}</p><div class="actions"><button class="button" data-action="map-services" data-id="${esc(stay.id)}">Thêm dịch vụ</button><button class="button primary" data-action="open-checkout" data-id="${esc(stay.id)}">Trả phòng / giảm giá / thanh toán</button></div>${charges.length ? `<h3>Dịch vụ đã dùng</h3>${charges.map((item) => `<p>${esc(item.name)} × ${item.quantity} · ${money(item.amount)}</p>`).join('')}` : ''}</div>` : ''}
    ${bookings.length ? `<h3>Khách đã đặt phòng (${bookings.length})</h3>${bookings.map((item) => `<div class="card" style="margin:10px 0">${guestInfo(item)}<p>${esc(item.id)} · ${esc(item.status)}<br>${dateTime(item.arrival)} → ${dateTime(item.departure)}</p><button class="button success" data-action="map-checkin" data-id="${esc(item.id)}">Nhận phòng</button></div>`).join('')}` : ''}
    ${tasks.length ? `<h3>Vệ sinh phòng</h3>${tasks.map((item) => `<div class="card"><p>${esc(item.type)} · <b>${esc(item.status)}</b></p><p>Người thực hiện: ${esc(item.assignee || 'Chưa phân công')}</p><div class="actions">${item.status === 'Chờ xử lý' ? `<button class="button" data-action="map-clean-start" data-id="${esc(item.id)}">Bắt đầu vệ sinh</button>` : ''}<button class="button success" data-action="map-clean-done" data-id="${esc(item.id)}">Hoàn thành vệ sinh</button></div></div>`).join('')}` : ''}
    ${invoices.length ? `<h3>Hóa đơn cần xử lý</h3>${invoices.map((item) => `<div class="card"><p>${esc(item.id)} · ${esc(item.guestName)}<br>Còn thu: ${money(item.due)} · Thừa: ${money(item.surplus)}</p><div class="actions">${item.due > 0 ? `<button class="button primary" data-action="map-pay" data-id="${esc(item.id)}">Thanh toán${Number(item.paid || 0) === 0 ? ' / giảm giá' : ' phần còn lại'}</button>` : ''}${item.surplus > 0 ? `<button class="button" data-action="refund" data-id="${esc(item.id)}">Hoàn tiền thừa</button>` : ''}<button class="button" data-action="print-invoice" data-id="${esc(item.id)}">Xem hóa đơn</button></div></div>`).join('')}` : ''}
    <div class="actions"><button class="button" data-action="close-modal">Đóng</button>${!['Bảo trì', 'Tạm khóa'].includes(room.status) ? `<button class="button primary" data-action="map-new-booking" data-id="${esc(roomId)}">Đặt phòng mới</button>` : ''}</div>`);
}

function mapServicesModal(stayId) {
  const stay = ui.state.stays.find((item) => item.id === stayId && item.status === 'Đang ở');
  if (!stay) return toast('Khách không còn lưu trú.', true);
  openModal(`<h2>Thêm dịch vụ · ${esc(stay.roomId)}</h2><p>${esc(stay.guestName)}</p><form id="chargeForm"><input type="hidden" name="stayId" value="${esc(stayId)}"><div id="chargeRows">${chargeRowHtml(ui.state.services.filter((item) => item.active))}</div><div class="actions"><button type="button" class="button" data-action="add-charge-row">+ Thêm dịch vụ</button></div><div class="field"><label>Ghi chú</label><input name="note"></div><div class="actions"><button type="button" class="button" data-action="map-back">Quay lại phòng</button><button class="button success">Lưu dịch vụ</button></div></form>`);
}

function mapPaymentModal(invoiceId) {
  const invoice = ui.state.invoices.find((item) => item.id === invoiceId);
  if (!invoice) return toast('Không tìm thấy hóa đơn.', true);
  if (!Number(invoice.paid || 0)) return paymentModal(invoiceId);
  openModal(`<h2>Thu tiền còn lại · ${esc(invoice.roomId)}</h2><p>${esc(invoice.guestName)} · ${esc(invoice.id)}</p><p>Còn phải thu: <b>${money(invoice.due)}</b></p><p class="sub">Hóa đơn đã thu một phần nên giá và giảm tiền đã được khóa.</p><form id="mapCollectForm">${employeeField('Nhân viên thu ngân')}<input type="hidden" name="invoiceId" value="${esc(invoice.id)}"><div class="field"><label>Số tiền thu</label><input name="amount" data-money inputmode="numeric" value="${money(invoice.due)}" required></div><div class="field"><label>Phương thức</label><select name="method"><option>Tiền mặt</option><option>Chuyển khoản</option><option>Thẻ</option></select></div><div class="field"><label>Ghi chú</label><input name="note"></div><div class="actions"><button class="button success">Ghi nhận thanh toán</button></div></form>`);
}

function mapBookingModal(roomId) {
  const room = ui.state.rooms.find((item) => item.id === roomId && item.active);
  if (!room) return toast('Không tìm thấy phòng đang hoạt động.', true);
  const arrival = isoLocal();
  const departure = isoLocal(new Date(Date.now() + 86400000));
  const rate = ui.state.rates.find((item) => item.active && item.roomType === room.roomType);
  openModal(`<h2>Đặt / nhận ${esc(room.name)}</h2><p><b>Tầng ${esc(room.floor)} · ${esc(room.roomType)}</b> · ${esc(room.status)}</p><div style="padding:12px;background:#eff6ff;border:1px solid #bae6fd;border-radius:10px;margin:12px 0"><p style="margin:0 0 8px">Ngày thường: <b>${money(rate?.weekday)}</b> · Cuối tuần: <b>${money(rate?.weekend)}</b> · Qua đêm: <b>${money(rate?.overnight ?? rate?.weekday)}</b></p><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px"><span>Giờ đầu: <b>${money(rate?.hourlyFirst)}</b></span><span>Giờ thứ 2: <b>${money(rate?.hourlySecond)}</b></span><span>Giờ thứ 3: <b>${money(rate?.hourlyThird)}</b></span><span>Từ giờ thứ 4: <b>${money(rate?.hourlyFromFourth)}/giờ</b></span></div><p class="sub" style="margin:8px 0 0">Tiền theo giờ cộng dồn từng giờ; phần lẻ giờ làm tròn lên theo cách tính hiện tại.</p></div><form id="mapBookingForm">${employeeField('Nhân viên nhận phòng trực tiếp', false)}<input type="hidden" name="roomId" value="${esc(room.id)}"><div class="form-grid"><div class="field span-2"><label>Tên khách *</label><input name="guestName" required></div><div class="field"><label>Số điện thoại</label><input name="phone" type="tel"></div><div class="field"><label>Số khách</label><input name="guestCount" type="number" min="1" max="${room.capacity}" value="1" required></div><div class="field span-2"><label>Loại tính giá *</label><select name="priceMode"><option>Theo ngày</option><option>Qua đêm</option><option>Theo giờ</option></select></div><div class="field"><label>Nhận dự kiến *</label><input name="arrival" type="datetime-local" value="${esc(arrival)}" required></div><div class="field"><label>Trả dự kiến *</label><input name="departure" type="datetime-local" value="${esc(departure)}" required></div><div class="field span-2"><label for="mapRoomEstimate">Tiền phòng dự kiến</label><input id="mapRoomEstimate" readonly aria-describedby="mapRoomEstimateDetail" style="font-size:20px;font-weight:800;color:#0369a1;background:#eff6ff"><span id="mapRoomEstimateDetail" class="sub" aria-live="polite"></span></div><div class="field"><label>Tiền cọc</label><input name="deposit" type="text" inputmode="numeric" data-money value="0"></div><div class="field"><label>Kênh đặt</label><select name="channel"><option>Trực tiếp</option><option>Điện thoại</option><option>Website</option><option>Đại lý</option></select></div><div class="field span-4"><label>Ghi chú</label><input name="note"></div></div><p class="sub">Lưu đặt phòng dùng giờ nhận dự kiến. Nhận phòng trực tiếp dùng thời điểm bấm nút. Hệ thống kiểm tra lịch trống trước khi lưu.</p><div class="actions"><button type="button" class="button" data-action="close-modal">Hủy</button><button type="submit" class="button primary">Lưu đặt phòng</button><button type="submit" class="button success" value="direct-checkin">Nhận phòng trực tiếp</button></div></form>`);
  refreshMapRoomEstimate();
}

function refreshMapRoomEstimate() {
  const form = $('#mapBookingForm');
  if (!form) return;
  const amount = $('#mapRoomEstimate', form);
  const detail = $('#mapRoomEstimateDetail', form);
  const value = (name) => $(`[name="${name}"]`, form)?.value || '';
  try {
    const room = ui.state.rooms.find((item) => item.id === value('roomId') && item.active);
    if (!room || !ui.state.rates.some((rate) => rate.active && rate.roomType === room.roomType)) throw new Error('Phòng chưa có bảng giá hoạt động.');
    if (!value('arrival') || !value('departure')) throw new Error('Nhập đủ giờ nhận và giờ trả để xem tiền dự kiến.');
    const quote = roomPriceQuote(ui.state, room, value('arrival'), value('departure'), value('priceMode'));
    amount.value = money(quote.total);
    detail.textContent = `${quote.count} ${quote.unit} · ${quote.priceMode}. Chỉ gồm tiền phòng, chưa trừ cọc, chưa gồm dịch vụ, phụ thu, thuế và giảm giá.`;
    detail.className = 'sub';
  } catch (error) {
    amount.value = '—'; detail.textContent = error.message; detail.className = 'sub error-text';
  }
}

for (const eventName of ['input', 'change']) document.addEventListener(eventName, (event) => {
  if (event.target.closest('#mapBookingForm') && ['arrival', 'departure', 'priceMode'].includes(event.target.name)) refreshMapRoomEstimate();
});

function bookingRoomCards() {
  const b = ui.booking; const rooms = availableRooms(ui.state, b.arrival, b.departure, b.query, { floor: b.floor, roomType: b.roomType }).filter((room) => !b.selected.has(room.id));
  $('#bookingResultCount') && ($('#bookingResultCount').textContent = `${rooms.length} phòng có thể chọn`);
  return rooms.map((room) => {
    let quote;
    try { quote = roomPriceQuote(ui.state, room, b.arrival, b.departure, b.priceMode); } catch { quote = { total: 0, count: 0, unit: '' }; }
    return `<button type="button" class="room-card" data-action="toggle-room" data-id="${esc(room.id)}"><h3>${esc(room.name)}<span>+</span></h3><p>${esc(room.roomType)} · Tầng ${room.floor}</p><p>Tối đa ${room.capacity} khách · ${esc(b.priceMode)}</p><div class="price">${quote.total ? money(quote.total) : 'Chưa cài giá'}${quote.count ? `<span class="sub">${quote.count} ${esc(quote.unit)}</span>` : ''}</div></button>`;
  }).join('') || '<div class="empty">Không còn phòng phù hợp trong khoảng đã chọn.</div>';
}

function bookingTypeSummary() {
  const b = ui.booking;
  const types = [...new Set(ui.state.rooms.filter((room) => room.active).map((room) => room.roomType))];
  return `<div class="chip-list"><button type="button" class="chip ${!b.roomType ? 'active' : ''}" data-action="filter-booking-type" data-type="">Tất cả</button>${types.map((type) => {
    const total = ui.state.rooms.filter((room) => room.active && room.roomType === type).length;
    const available = availableRooms(ui.state, b.arrival, b.departure, '', { floor: b.floor, roomType: type }).length;
    return `<button type="button" class="chip ${b.roomType === type ? 'active' : ''}" data-action="filter-booking-type" data-type="${esc(type)}">${esc(type)}: còn ${available}/${total}</button>`;
  }).join('')}</div>`;
}

function renderBookingSelected() {
  const node = $('#bookingSelected'); if (!node) return;
  node.innerHTML = ui.booking.selected.size ? [...ui.booking.selected].map((roomId) => `<button type="button" class="selected-item" data-action="remove-room" data-id="${esc(roomId)}">${esc(roomId)} ×</button>`).join('') : '<span class="sub">Chưa chọn phòng.</span>';
}

function bookingPriceTableHtml() {
  const b = ui.booking;
  const rates = ui.state.rates.filter((rate) => rate.active && (!b.roomType || rate.roomType === b.roomType));
  if (!rates.length) return '<div class="empty">Chưa có bảng giá cho loại phòng đang chọn.</div>';
  const rows = rates.map((rate) => {
    const room = ui.state.rooms.find((item) => item.active && item.roomType === rate.roomType);
    let estimated = 0; let detail = '';
    if (room) {
      try {
        const quote = roomPriceQuote(ui.state, room, b.arrival, b.departure, b.priceMode);
        estimated = quote.total;
        detail = quote.count ? `${quote.count} ${quote.unit}` : '';
      } catch {}
    }
    if (b.priceMode === 'Theo giờ') {
      return `<tr><td><b>${esc(rate.roomType)}</b></td><td>${money(rate.hourlyFirst || 0)}</td><td>${money(rate.hourlySecond || 0)}</td><td>${money(rate.hourlyThird || 0)}</td><td>${money(rate.hourlyFromFourth || 0)}/giờ</td><td><b>${estimated ? money(estimated) : '—'}</b><span class="sub">${esc(detail)}</span></td></tr>`;
    }
    if (b.priceMode === 'Qua đêm') {
      return `<tr><td><b>${esc(rate.roomType)}</b></td><td>${money(rate.overnight ?? rate.weekday ?? 0)}</td><td><b>${estimated ? money(estimated) : '—'}</b><span class="sub">${esc(detail)}</span></td></tr>`;
    }
    return `<tr><td><b>${esc(rate.roomType)}</b></td><td>${money(rate.weekday || 0)}</td><td>${money(rate.weekend || 0)}</td><td><b>${estimated ? money(estimated) : '—'}</b><span class="sub">${esc(detail)}</span></td></tr>`;
  }).join('');

  if (b.priceMode === 'Theo giờ') {
    return `<div class="card" style="margin-top:14px"><div class="section-head"><div><h3>Bảng giá theo giờ</h3><p>Tiền phòng được cộng dồn: giờ đầu + giờ thứ 2 + giờ thứ 3 + mỗi giờ từ giờ thứ 4.</p></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Loại phòng</th><th>Giờ đầu</th><th>Giờ thứ 2</th><th>Giờ thứ 3</th><th>Từ giờ thứ 4</th><th>Dự kiến</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }
  if (b.priceMode === 'Qua đêm') {
    return `<div class="card" style="margin-top:14px"><div class="section-head"><div><h3>Bảng giá qua đêm</h3><p>Hiển thị giá qua đêm của từng loại phòng và tiền dự kiến theo thời gian đã chọn.</p></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Loại phòng</th><th>Giá qua đêm</th><th>Dự kiến</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }
  return `<div class="card" style="margin-top:14px"><div class="section-head"><div><h3>Bảng giá theo ngày</h3><p>Giá được tính theo ngày thường/cuối tuần trong khoảng lưu trú.</p></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Loại phòng</th><th>Ngày thường</th><th>Cuối tuần</th><th>Dự kiến</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

function refreshBookingPriceTable() {
  const node = $('#bookingPriceTable');
  if (node) node.innerHTML = bookingPriceTableHtml();
}


function filterPhone(value) { return String(value || '').replace(/\D/g, ''); }
function overlapsFilterDate(filterDate, startValue, endValue = startValue) {
  if (!filterDate) return true;
  const dayStart = new Date(filterDate + 'T00:00:00');
  const dayEnd = new Date(filterDate + 'T23:59:59.999');
  const start = new Date(startValue || 0);
  const end = new Date(endValue || startValue || 0);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return false;
  return start <= dayEnd && end >= dayStart;
}
function listTextMatches(item, filter, phoneOverride = '') {
  const roomOk = !filter.room || normalize(item.roomId || '').includes(normalize(filter.room));
  const guestOk = !filter.guest || normalize(item.guestName || '').includes(normalize(filter.guest));
  const wantedPhone = filterPhone(filter.phone);
  const phoneOk = !wantedPhone || filterPhone(phoneOverride || item.phone || '').includes(wantedPhone);
  return roomOk && guestOk && phoneOk;
}
function filteredBookings() {
  const filter = ui.listFilters.bookings;
  return ui.state.bookings.filter((item) => listTextMatches(item, filter) && overlapsFilterDate(filter.date, item.arrival, item.departure));
}
function filteredStays() {
  const filter = ui.listFilters.stays;
  return ui.state.stays.filter((item) => listTextMatches(item, filter) && overlapsFilterDate(filter.date, item.checkIn, item.checkout || item.expectedCheckout));
}
function invoicePhone(invoice) {
  const stay = ui.state.stays.find((item) => item.id === invoice.stayId);
  const booking = ui.state.bookings.find((item) => item.id === (invoice.bookingId || stay?.bookingId));
  return invoice.phone || stay?.phone || booking?.phone || '';
}
function paymentFilterMatches(invoice) {
  const filter = ui.listFilters.payments;
  const at = invoice.createdAt || invoice.checkout;
  return listTextMatches(invoice, filter, invoicePhone(invoice)) && overlapsFilterDate(filter.date, at, at);
}
function listFilterToolbar(scope, dateLabel = 'Ngày') {
  const filter = ui.listFilters[scope];
  return '<div class="toolbar">' +
    '<div class="field"><label>Lọc phòng</label><input data-list-filter-scope="' + esc(scope) + '" data-list-filter-key="room" value="' + esc(filter.room) + '" placeholder="Gõ số/mã phòng"></div>' +
    '<div class="field"><label>' + esc(dateLabel) + '</label><input type="date" data-list-filter-scope="' + esc(scope) + '" data-list-filter-key="date" value="' + esc(filter.date) + '"></div>' +
    '<div class="field"><label>Lọc khách</label><input data-list-filter-scope="' + esc(scope) + '" data-list-filter-key="guest" value="' + esc(filter.guest) + '" placeholder="Gõ tên khách"></div>' +
    '<div class="field"><label>Số điện thoại</label><input inputmode="tel" data-list-filter-scope="' + esc(scope) + '" data-list-filter-key="phone" value="' + esc(filter.phone) + '" placeholder="Gõ số điện thoại"></div>' +
    '<button type="button" class="button" data-action="clear-list-filter" data-scope="' + esc(scope) + '">Xóa lọc</button></div>';
}
function refreshListFilter(scope) {
  if (scope === 'bookings' && $('#bookingListWrap')) $('#bookingListWrap').innerHTML = bookingTable();
  if (scope === 'stays' && $('#staysListWrap')) $('#staysListWrap').innerHTML = staysTable();
  if (scope === 'payments' && $('#paymentsListWrap')) $('#paymentsListWrap').innerHTML = paymentsContent();
}

function renderBookings() {
  const b = ui.booking; const floors = [...new Set(ui.state.rooms.map((room) => room.floor))].sort(); const types = [...new Set(ui.state.rooms.map((room) => room.roomType))];
  return `<div class="card"><form id="bookingForm">${employeeField('Nhân viên nhận phòng trực tiếp', false)}<div class="form-grid"><div class="field span-2"><label>Loại tính giá phòng *</label><select name="priceMode" id="bookingPriceMode" required><option ${b.priceMode === 'Theo giờ' ? 'selected' : ''}>Theo giờ</option><option ${b.priceMode === 'Qua đêm' ? 'selected' : ''}>Qua đêm</option><option ${b.priceMode === 'Theo ngày' ? 'selected' : ''}>Theo ngày</option></select><span class="sub">Chọn ngay từ lúc đặt phòng; cách tính này được chốt theo phiếu đặt.</span></div><div class="field"><label>Nhận dự kiến *</label><input name="arrival" id="bookingArrival" type="datetime-local" value="${esc(b.arrival)}" required></div><div class="field"><label>Trả dự kiến *</label><input name="departure" id="bookingDeparture" type="datetime-local" value="${esc(b.departure)}" required></div><div class="field"><label>Gõ tìm phòng</label><input id="bookingQuery" value="${esc(b.query)}" placeholder="Ví dụ: phòng đơn"></div><div class="field"><label>Tầng</label><select id="bookingFloor"><option value="">Tất cả</option>${floors.map((item) => `<option ${String(item) === b.floor ? 'selected' : ''}>${item}</option>`).join('')}</select></div><div class="field"><label>Loại phòng</label><select id="bookingType"><option value="">Tất cả</option>${types.map((item) => `<option ${item === b.roomType ? 'selected' : ''}>${esc(item)}</option>`).join('')}</select></div><div class="field"><label>Tên khách *</label><input name="guestName" required></div><div class="field"><label>Số điện thoại</label><input name="phone"></div><div class="field"><label>Số khách / phòng</label><input name="guestCount" type="number" min="1" value="1"></div><div class="field"><label>Tổng tiền cọc</label><input name="deposit" type="text" inputmode="numeric" data-money min="0" value="0"></div><div class="field"><label>Kênh đặt</label><select name="channel"><option>Trực tiếp</option><option>Điện thoại</option><option>Website</option><option>Đại lý</option></select></div><div class="field span-2"><label>Ghi chú</label><input name="note"></div></div>
  <div id="bookingPriceTable">${bookingPriceTableHtml()}</div><div class="section-head"><div><h2>Chọn phòng còn trống</h2><p id="bookingResultCount"></p></div></div>${bookingTypeSummary()}<div id="bookingSelected" class="selected-list"></div><div id="bookingRoomGrid" class="room-grid">${bookingRoomCards()}</div><p class="sub">Nhận phòng trực tiếp: giờ nhận là thời điểm bấm nút; áp dụng loại tính giá và giờ trả dự kiến đã chọn.</p><div class="actions"><button type="submit" class="button primary">Lưu đặt phòng</button><button type="submit" class="button success" name="bookingAction" value="direct-checkin">Nhận phòng trực tiếp</button></div></form></div>
  <div class="section-head"><div><h2>Danh sách đặt phòng</h2><p>Mỗi phòng là một dòng; loại tính giá được khóa ngay từ phiếu đặt để tránh nhầm khi trả phòng.</p></div></div>${listFilterToolbar('bookings', 'Ngày đặt / lưu trú')}<div id="bookingListWrap">${bookingTable()}</div>`;
}

function bookingTable() {
  const rows = filteredBookings().slice(0, 1000);
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Mã nhóm / Phiếu</th><th>Phòng</th><th>Khách</th><th>Nhận–trả</th><th>Giá / Cọc</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${rows.map((item) => `<tr><td><b>${esc(item.groupId)}</b><span class="sub">${esc(item.id)}</span></td><td><b>${esc(item.roomId)}</b><span class="sub">${esc(item.roomType)}</span></td><td>${esc(item.guestName)}<span class="sub">${esc(item.phone)}</span></td><td>${dateTime(item.arrival)}<span class="sub">→ ${dateTime(item.departure)} · ${esc(item.priceMode || 'Theo ngày')}</span></td><td>${money(item.expectedRoomAmount ?? item.expectedRate)}<span class="sub">${esc(item.priceMode || 'Theo ngày')} · Cọc ${money(item.deposit)}</span></td><td><span class="status ${statusClass(item.status)}">${esc(item.status)}</span></td><td>${['Chờ xác nhận', 'Đã xác nhận'].includes(item.status) ? `<button class="button success small" data-action="checkin" data-id="${esc(item.id)}">Nhận phòng</button> <button class="button danger small" data-action="cancel-booking" data-id="${esc(item.id)}">Hủy</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Chưa có đặt phòng.</td></tr>'}</tbody></table></div>`;
}

function staysTable() {
  const rows = filteredStays().slice(0, 1000);
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Mã lưu trú</th><th>Phòng</th><th>Khách</th><th>Nhận phòng</th><th>Trả dự kiến</th><th>Cọc</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${rows.map((item) => `<tr><td>${esc(item.id)}</td><td><b>${esc(item.roomId)}</b>${item.roomHistory?.length > 1 ? `<span class="sub">Đã chuyển ${item.roomHistory.length - 1} lần</span>` : ''}</td><td>${esc(item.guestName)}<span class="sub">${esc(item.phone)}</span></td><td>${dateTime(item.checkIn)}<span class="sub">NV nhận: ${esc(item.checkInEmployeeName || 'Chưa ghi nhận')}</span><span class="sub">${esc(item.priceMode || 'Theo ngày')}</span></td><td>${dateTime(item.expectedCheckout)}${item.checkout ? `<span class="sub">Đã trả: ${dateTime(item.checkout)} · NV trả: ${esc(item.checkOutEmployeeName || 'Chưa ghi nhận')}</span>` : ''}</td><td>${money(item.deposit)}</td><td><span class="status ${statusClass(item.status)}">${esc(item.status)}</span></td><td>${item.status === 'Đang ở' ? `<button class="button small" data-action="open-extend" data-id="${esc(item.id)}">Gia hạn</button> <button class="button small" data-action="open-transfer" data-id="${esc(item.id)}">Chuyển phòng</button> <button class="button primary small" data-action="open-checkout" data-id="${esc(item.id)}">Trả phòng</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Chưa có lượt lưu trú.</td></tr>'}</tbody></table></div>`;
}


function renderStays() {
  return `${listFilterToolbar('stays', 'Ngày lưu trú')}<div id="staysListWrap">${staysTable()}</div>`;
}
function chargeRowHtml(services, index = 0) {
  return `<div class="charge-row form-grid" data-charge-row style="margin-top:12px;padding:12px;border:1px solid #d8e0ea;border-radius:12px"><div class="field span-2"><label>Dịch vụ / đồ giải khát</label><select name="serviceId" required><option value="">Chọn dịch vụ</option>${services.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} · ${money(item.price)}</option>`).join('')}</select></div><div class="field"><label>Số lượng</label><input name="quantity" type="number" min="1" value="1" required></div><div class="field" style="align-self:end"><button type="button" class="button danger small" data-action="remove-charge-row">Xóa dòng</button></div></div>`;
}
function renderServices() {
  const activeStays = ui.state.stays.filter((item) => item.status === 'Đang ở'); const services = ui.state.services.filter((item) => item.active);
  return `<div class="grid grid-2"><div class="card"><h2>Ghi phát sinh nhiều dịch vụ</h2><p class="sub">Có thể thêm nhiều loại đồ uống/dịch vụ cho cùng một phòng trong một lần ghi.</p><form id="chargeForm" style="margin-top:15px"><div class="form-grid"><div class="field span-2"><label>Khách đang lưu trú</label><select name="stayId" required><option value="">Chọn phòng</option>${activeStays.map((item) => `<option value="${esc(item.id)}">${esc(item.roomId)} · ${esc(item.guestName)}</option>`).join('')}</select></div></div><div id="chargeRows">${chargeRowHtml(services)}</div><div class="actions"><button type="button" class="button" data-action="add-charge-row">+ Thêm dịch vụ / đồ uống</button></div><div class="field" style="margin-top:12px"><label>Ghi chú chung</label><input name="note"></div><div class="actions"><button class="button success">Ghi phát sinh</button></div></form></div>
  <div class="card"><h2>Nhập kho minibar</h2><form id="stockForm" style="margin-top:15px"><div class="form-grid"><div class="field span-2"><label>Mặt hàng</label><select name="serviceId" required><option value="">Chọn mặt hàng</option>${services.filter((item) => item.trackStock).map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select></div><div class="field"><label>Số lượng</label><input name="quantity" type="number" min="1" required></div><div class="field"><label>Giá nhập</label><input name="cost" type="text" inputmode="numeric" data-money></div><div class="field span-2"><label>Nhà cung cấp</label><input name="supplier"></div></div><div class="actions"><button class="button primary">Nhập kho</button></div></form></div></div>
  <div class="section-head"><h2>Tồn kho</h2></div><div class="grid grid-4">${services.filter((item) => item.trackStock).map((item) => `<div class="card kpi ${item.stock <= item.minStock ? 'red' : 'green'}"><small>${esc(item.name)} · ${esc(item.unit)}</small><strong>${item.stock}</strong><span>Tối thiểu ${item.minStock} · Giá bán ${money(item.price)}</span></div>`).join('')}</div>
  <div class="section-head"><h2>Phát sinh gần đây</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Thời gian</th><th>Phòng</th><th>Nội dung</th><th>SL</th><th>Thành tiền</th><th>Trạng thái</th></tr></thead><tbody>${ui.state.charges.slice(0, 100).map((item) => `<tr><td>${dateTime(item.at)}</td><td>${esc(item.roomId)}</td><td>${esc(item.name)}</td><td>${item.quantity} ${esc(item.unit)}</td><td>${money(item.amount)}</td><td>${esc(item.status)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Chưa có phát sinh.</td></tr>'}</tbody></table></div>`;
}
function paymentsContent() {
  const filteredInvoices = ui.state.invoices.filter(paymentFilterMatches).slice(0, 1000);
  const groups = new Map();
  ui.state.invoices.forEach((invoice) => {
    const groupId = invoiceGroupId(ui.state, invoice);
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId).push(invoice);
  });
  const groupCards = [...groups.entries()].filter(([, invoices]) => invoices.length > 1 && invoices.some(paymentFilterMatches)).map(([groupId, invoices]) => {
    const outstanding = invoices.filter((item) => Number(item.due || 0) > 0);
    const total = invoices.reduce((sum, item) => sum + Number(item.total || 0), 0);
    const deposit = invoices.reduce((sum, item) => sum + Number(item.deposit || 0), 0);
    const paid = invoices.reduce((sum, item) => sum + Number(item.paid || 0), 0);
    const surcharge = invoices.reduce((sum, item) => sum + Number(item.surcharge || 0), 0);
    const discount = invoices.reduce((sum, item) => sum + Number(item.discount || 0), 0);
    const due = invoices.reduce((sum, item) => sum + Number(item.due || 0), 0);
    const rooms = invoices.map((item) => item.roomId).join(', ');
    const privateButtons = invoices.filter((item) => Number(item.paid || 0) === 0 && item.status !== 'Đã hủy' && Number(item.due || 0) > 0).map((item) => `<button class="button small" data-action="open-payment" data-id="${esc(item.id)}">Sửa riêng ${esc(item.roomId)}</button>`).join('');
    const groupPaymentButton = outstanding.length > 1 ? `<button class="button success" data-action="open-group-payment" data-id="${esc(groupId)}">Thanh toán gộp ${outstanding.length} phòng</button>` : '';
    const paymentActions = [groupPaymentButton, privateButtons].filter(Boolean).join('');
    return `<div class="card payment-group"><div class="section-head"><div><h3>${esc(invoices[0].guestName)}</h3><p>${esc(groupId)} · ${invoices.length} phòng: ${esc(rooms)}</p></div><span class="status ${due ? 'waiting' : 'paid'}">${due ? 'Còn thanh toán' : 'Đã hoàn tất'}</span></div><div class="summary"><div><span>Tổng hóa đơn</span><b>${money(total)}</b></div><div><span>Cọc + đã thu</span><b>${money(deposit + paid)}</b></div><div><span>Phụ thu</span><b>${money(surcharge)}</b></div><div><span>Giảm tiền</span><b>${money(discount)}</b></div><div><span>Còn phải thu</span><b>${money(due)}</b></div></div>${paymentActions ? `<div class="actions">${paymentActions}</div>` : ''}</div>`;
  }).join('');
  return `${groupCards ? `<div class="section-head"><div><h2>Thanh toán gộp theo mã nhóm đặt phòng</h2><p>Một lần thu có thể phân bổ cho nhiều phòng; hóa đơn từng phòng vẫn được giữ riêng.</p></div></div><div class="grid grid-2">${groupCards}</div>` : ''}
  <div class="section-head"><div><h2>Hóa đơn từng phòng</h2><p>Có thể thu riêng, thu nhiều lần hoặc in từng hóa đơn.</p></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Hóa đơn</th><th>Nhóm / Phòng / Khách</th><th>Tiền phòng</th><th>Dịch vụ</th><th>Tổng</th><th>Cọc + Đã thu</th><th>Còn thu / Thừa</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${filteredInvoices.map((item) => `<tr><td><b>${esc(item.id)}</b><span class="sub">${dateTime(item.createdAt)}</span></td><td><b>${esc(item.roomId)}</b><span class="sub">${esc(item.guestName)}</span><span class="sub">Nhóm ${esc(invoiceGroupId(ui.state, item))}</span></td><td>${money(item.roomAmount)}</td><td>${money(item.serviceAmount)}</td><td><b>${money(item.total)}</b></td><td>${money(item.deposit + item.paid)}</td><td>${item.due ? money(item.due) : item.surplus ? `Thừa ${money(item.surplus)}` : '0 ₫'}</td><td><span class="status ${statusClass(item.status)}">${esc(item.status)}</span></td><td><button class="button small" data-action="print-invoice" data-id="${esc(item.id)}">In</button> ${Number(item.paid || 0) === 0 && item.status !== 'Đã hủy' ? `<button class="button primary small" data-action="open-payment" data-id="${esc(item.id)}">${item.due > 0 ? 'Sửa & thu riêng' : 'Sửa hóa đơn'}</button>` : ''} ${item.surplus > 0 ? `<button class="button danger small" data-action="refund" data-id="${esc(item.id)}">Hoàn thừa</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Chưa có hóa đơn.</td></tr>'}</tbody></table></div>`;
}


function renderPayments() {
  return `${listFilterToolbar('payments', 'Ngày hóa đơn')}<div id="paymentsListWrap">${paymentsContent()}</div>`;
}
function renderHousekeeping() {
  const rooms = ui.state.rooms.filter((room) => room.active);
  return `<div class="grid grid-2"><div><div class="section-head"><h2>Công việc vệ sinh</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Phòng</th><th>Công việc</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${ui.state.housekeeping.map((item) => `<tr><td><b>${esc(item.roomId)}</b></td><td>${esc(item.type)}<span class="sub">${dateTime(item.createdAt)}</span></td><td><span class="status ${statusClass(item.status)}">${esc(item.status)}</span></td><td>${item.status === 'Chờ xử lý' ? `<button class="button small" data-action="housekeeping-start" data-id="${esc(item.id)}">Bắt đầu</button>` : ''}${item.status !== 'Hoàn thành' ? ` <button class="button success small" data-action="housekeeping-done" data-id="${esc(item.id)}">Hoàn thành</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Chưa có công việc vệ sinh.</td></tr>'}</tbody></table></div></div>
  <div><div class="section-head"><h2>Bảo trì</h2><button class="button primary small" data-action="open-maintenance">+ Báo hỏng</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Phòng</th><th>Sự cố</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>${ui.state.maintenance.map((item) => `<tr><td>${esc(item.roomId)}</td><td>${esc(item.issue)}<span class="sub">${esc(item.priority)}</span></td><td><span class="status ${statusClass(item.status)}">${esc(item.status)}</span></td><td>${item.status !== 'Hoàn thành' ? `<button class="button success small" data-action="maintenance-done" data-id="${esc(item.id)}">Hoàn thành</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Chưa có phiếu bảo trì.</td></tr>'}</tbody></table></div></div></div>
  <div class="section-head"><h2>Danh sách toàn bộ buồng phòng</h2></div><div class="room-grid">${rooms.map((room) => `<div class="room-card"><h3>${esc(room.name)}<span class="status ${statusClass(room.status)}">${esc(room.status)}</span></h3><p>${esc(room.roomType)} · Tầng ${room.floor}</p><div class="price">${money(roomRate(ui.state, room))}</div></div>`).join('')}</div>`;
}

function employeeField(label, required = true) {
  const employees = (ui.state.employees || []).filter((item) => item.active !== false);
  return `<div class="field" style="margin:12px 0"><label>${esc(label)}${required ? ' *' : ''}</label><select name="employeeId" ${required ? 'required' : ''}><option value="">Chọn nhân viên</option>${employees.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}</select>${!employees.length ? '<span class="sub">Thêm nhân viên tại Cài đặt → Nhân viên trước khi thực hiện giao dịch.</span>' : ''}</div>`;
}
function employeeSettings() {
  const employees = (ui.state.employees || []).filter((item) => item.active !== false);
  return `<div class="card" style="margin-bottom:14px"><div class="section-head"><h2>Nhân viên</h2><button class="button primary" data-action="employee-add">+ Thêm nhân viên</button></div><p class="sub">Chọn tên nhân viên khi nhận phòng, trả phòng và thu/hoàn tiền. Sửa hoặc xóa tên không thay đổi lịch sử giao dịch.</p><div class="table-wrap"><table class="table"><thead><tr><th>Tên nhân viên</th><th>Thao tác</th></tr></thead><tbody>${employees.map((item) => `<tr><td>${esc(item.name)}</td><td><button class="button small" data-action="employee-edit" data-id="${esc(item.id)}">Sửa</button> <button class="button danger small" data-action="employee-delete" data-id="${esc(item.id)}">Xóa</button></td></tr>`).join('') || '<tr><td colspan="2" class="empty">Chưa có nhân viên. Bấm Thêm nhân viên để bắt đầu.</td></tr>'}</tbody></table></div></div>`;
}
function employeeModal(employeeId = '') {
  const employee = (ui.state.employees || []).find((item) => item.id === employeeId);
  openModal(`<h2>${employee ? 'Sửa' : 'Thêm'} nhân viên</h2><form id="employeeForm"><input type="hidden" name="employeeId" value="${esc(employeeId)}"><div class="field"><label>Tên nhân viên *</label><input name="employeeName" value="${esc(employee?.name || '')}" maxlength="100" required></div><div class="actions"><button type="button" class="button" data-action="close-modal">Hủy</button><button class="button primary">Lưu nhân viên</button></div></form>`);
}
function checkInModal(bookingId) {
  const booking = ui.state.bookings.find((item) => item.id === bookingId);
  if (!booking) return toast('Không tìm thấy phiếu đặt.', true);
  openModal(`<h2>Nhận phòng ${esc(booking.roomId)}</h2><p>${esc(booking.guestName)} · ${esc(booking.phone)}<br>Trả dự kiến: ${dateTime(booking.departure)}</p><form id="receiveEmployeeForm"><input type="hidden" name="bookingId" value="${esc(bookingId)}">${employeeField('Nhân viên nhận phòng')}<div class="actions"><button class="button success">Xác nhận nhận phòng</button></div></form>`);
}
const financeColumns = ['Ngày', 'Số HĐ', 'Tiền phòng', 'Dịch vụ', 'Phụ thu', 'Giảm giá', 'Phí dịch vụ', 'VAT', 'Doanh thu', 'Thực thu'];
const financeValues = (row) => [row.date, row.count, row.room, row.service, row.surcharge, row.discount, row.serviceFee, row.vat, row.amount, row.cash];
function financeDailyTable(report) {
  const total = report.byDay.reduce((sum, row) => sum.map((value, i) => i ? value + financeValues(row)[i] : value), ['Tổng', 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const cells = (values) => values.map((v, i) => `<td>${i > 1 ? money(v) : esc(v)}</td>`).join('');
  return `<div class="card" style="margin-top:14px"><h3>Bảng doanh thu theo ngày</h3><p class="sub">Bảng dạng Excel. Bấm Xem chi tiết để xem hóa đơn và các khoản thu của từng ngày.</p><div class="table-wrap"><table class="table"><thead><tr>${financeColumns.map((v) => `<th>${v}</th>`).join('')}<th>Thao tác</th></tr></thead><tbody>${report.byDay.map((row) => `<tr>${cells(financeValues(row))}<td><button class="button small" data-action="finance-day" data-id="${row.date}">Xem chi tiết</button></td></tr>`).join('')}</tbody><tfoot><tr>${cells(total)}<td></td></tr></tfoot></table></div></div>`;
}
function financeSheets(report, from, to) {
  const unknown = 'Chưa ghi nhận';
  const totals = report.byDay.reduce((sum, row) => sum.map((v, i) => i ? v + financeValues(row)[i] : v), ['Tổng', 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const invoiceIds = new Set(report.invoices.map((item) => item.id));
  return [
    { name: 'Theo ngày', rows: [financeColumns, ...report.byDay.map(financeValues), totals] },
    { name: 'Hóa đơn', rows: [['Ngày thanh toán đủ', 'Hóa đơn', 'Phòng', 'Khách', 'Điện thoại', 'Nhận phòng', 'Trả phòng', 'Tiền phòng', 'Dịch vụ', 'Phụ thu', 'Giảm giá', 'Phí dịch vụ', 'VAT', 'Tổng', 'Tiền cọc', 'Đã thu thêm', 'NV nhận phòng', 'NV trả phòng', 'Thu ngân lần cuối'], ...report.invoices.map((i) => [dateTime(i.paidAt || i.createdAt), i.id, i.roomId, i.guestName, i.phone || '', dateTime(i.checkIn), dateTime(i.checkout), i.roomAmount, i.serviceAmount, i.surcharge, i.discount, i.serviceFee, i.vat, i.total, i.deposit, i.paid, i.checkInEmployeeName || unknown, i.checkOutEmployeeName || unknown, i.cashierName || (i.lastMethod === 'Tiền cọc' ? 'Tiền cọc' : unknown)])] },
    { name: 'Phiếu thu', rows: [['Thời gian', 'Phiếu thu', 'Hóa đơn', 'Phòng', 'Khách', 'Loại', 'Số tiền (hoàn âm)', 'Phương thức', 'Thu ngân', 'Ghi chú'], ...report.receipts.map((r) => [dateTime(r.at), r.id, r.invoiceId, r.roomId, r.guestName, r.type, (String(r.type || '').startsWith('Hoàn') ? -1 : 1) * Number(r.amount || 0), r.method, r.employeeName || unknown, r.note])] },
    { name: 'Chi tiết dịch vụ', rows: [['Hóa đơn', 'Loại', 'Nội dung', 'Đơn vị', 'Số lượng', 'Đơn giá', 'Thành tiền'], ...ui.state.invoiceLines.filter((line) => invoiceIds.has(line.invoiceId)).map((line) => [line.invoiceId, line.type, line.name, line.unit, line.quantity, line.unitPrice, line.amount])] },
    { name: 'Thông tin báo cáo', rows: [['Nội dung', 'Giá trị'], ['Khách sạn', ui.state.settings.hotelName], ['Từ ngày', from], ['Đến ngày', to], ['Múi giờ', 'Asia/Ho_Chi_Minh (UTC+7)'], ['Doanh thu', 'Hóa đơn đã thanh toán đủ, theo ngày thanh toán đủ'], ['Thực thu', 'Phiếu thu trừ hoàn tiền trong khoảng lọc, chưa gồm tiền cọc'], ['Thu ngân hóa đơn', 'Người thu lần cuối; từng lần thu có tên riêng ở Phiếu thu'], ['Dữ liệu cũ', 'Chưa ghi nhận nếu giao dịch chưa lưu tên nhân viên']] }
  ];
}
function exportFinance(singleDay = false) {
  const from = singleDay && ui.finance.detailDate ? ui.finance.detailDate : ui.finance.from;
  const to = singleDay && ui.finance.detailDate ? ui.finance.detailDate : ui.finance.to;
  const report = financeReport(ui.state, from, to);
  const blob = excelWorkbook(financeSheets(report, from, to));
  const link = document.createElement('a'), url = URL.createObjectURL(blob);
  link.href = url; link.download = `Doanh-thu_${from}_${to}.xlsx`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function financeUnlocked() { return !ui.state.settings.financeLocked || Date.now() < ui.financeUnlockedUntil; }
function financeDetails(report) {
  const invoiceRows = report.invoices.map((invoice) => {
    const lines = ui.state.invoiceLines.filter((line) => line.invoiceId === invoice.id);
    const detail = lines.map((line) => `${esc(line.name)} × ${line.quantity} ${esc(line.unit)}: ${money(line.amount)}`).join('<br>') || '—';
    return `<tr><td>${dateTime(invoice.paidAt || invoice.createdAt)}</td><td><b>${esc(invoice.id)}</b><span class="sub">${esc(invoice.roomId)} · ${esc(invoice.guestName)}</span></td><td>${detail}</td><td>${money(invoice.roomAmount)}</td><td>${money(invoice.serviceAmount)}</td><td>${money(invoice.surcharge)}</td><td>${money(invoice.discount)}</td><td>${money(invoice.total)}</td><td>${esc(invoice.checkInEmployeeName || 'Chưa ghi nhận')}</td><td>${esc(invoice.checkOutEmployeeName || 'Chưa ghi nhận')}</td><td>${esc(invoice.cashierName || (invoice.lastMethod === 'Tiền cọc' ? 'Tiền cọc' : 'Chưa ghi nhận'))}</td></tr>`;
  }).join('') || '<tr><td colspan="11" class="empty">Chưa có hóa đơn đã thanh toán trong khoảng ngày.</td></tr>';
  const receiptRows = report.receipts.map((receipt) => {
    const invoice = ui.state.invoices.find((item) => item.id === receipt.invoiceId);
    const amount = String(receipt.type || '').startsWith('Hoàn') ? `- ${money(receipt.amount)}` : money(receipt.amount);
    return `<tr><td>${dateTime(receipt.at)}</td><td><b>${esc(receipt.id)}</b><span class="sub">${esc(receipt.paymentGroupId || receipt.invoiceId || '')}</span></td><td>${esc(receipt.roomId || invoice?.roomId || '')} · ${esc(receipt.guestName || invoice?.guestName || '')}</td><td>${esc(receipt.type)}</td><td>${amount}</td><td>${esc(receipt.method || '')}</td><td>${esc(receipt.note || '')}</td><td>${esc(receipt.employeeName || 'Chưa ghi nhận')}</td></tr>`;
  }).join('') || '<tr><td colspan="8" class="empty">Chưa có khoản thu trong khoảng ngày.</td></tr>';
  return `<div class="card" style="margin-top:14px"><h3>Chi tiết hóa đơn đã thanh toán</h3><p class="sub">Gồm tiền phòng, từng dịch vụ/đồ uống, phụ thu, giảm tiền và tổng tiền.</p><div class="table-wrap"><table class="table"><thead><tr><th>Ngày thu</th><th>Hóa đơn / khách</th><th>Chi tiết dịch vụ</th><th>Tiền phòng</th><th>Dịch vụ</th><th>Phụ thu</th><th>Giảm tiền</th><th>Tổng</th><th>NV nhận phòng</th><th>NV trả phòng</th><th>Thu ngân lần cuối</th></tr></thead><tbody>${invoiceRows}</tbody></table></div></div><div class="card" style="margin-top:14px"><h3>Chi tiết các khoản thu</h3><p class="sub">Mỗi phiếu thu hiển thị riêng, kể cả thanh toán gộp và hoàn tiền.</p><div class="table-wrap"><table class="table"><thead><tr><th>Thời gian</th><th>Phiếu thu</th><th>Phòng / khách</th><th>Loại thu</th><th>Số tiền</th><th>Phương thức</th><th>Ghi chú</th><th>Thu ngân</th></tr></thead><tbody>${receiptRows}</tbody></table></div></div>`;
}
function renderFinance() {
  if (!financeUnlocked()) return `<div class="card finance-lock"><div class="lock">🔒</div><h2>Tài chính đang khóa</h2><p>Nhập PIN quản lý để xem doanh thu.</p><button class="button primary" data-action="open-finance">Mở khóa tài chính</button></div>`;
  const report = financeReport(ui.state, ui.finance.from, ui.finance.to); const max = Math.max(1, ...report.byDay.map((item) => item.amount));
  return `<div class="toolbar"><div class="field"><label>Từ ngày</label><input id="financeFrom" type="date" value="${ui.finance.from}"></div><div class="field"><label>Đến ngày</label><input id="financeTo" type="date" value="${ui.finance.to}"></div><button class="button primary" data-action="filter-finance">Lọc báo cáo</button><button class="button success" data-action="export-finance">Xuất Excel (.xlsx)</button><button class="button" onclick="window.print()">In báo cáo</button></div><p class="sub">Đang xem: ${esc(ui.finance.from)} → ${esc(ui.finance.to)} (giờ Việt Nam). Doanh thu ghi nhận theo ngày hóa đơn thanh toán đủ; thực thu là phiếu thu trừ hoàn tiền, chưa gồm tiền cọc. Công nợ là số dư hiện tại toàn khách sạn. Xuất Excel sử dụng khoảng ngày đã bấm Lọc.</p>
  <div class="grid grid-4">${kpi('Số hóa đơn', report.invoiceCount)}${kpi('Tổng doanh thu', money(report.revenue), 'green')}${kpi('Thực thu', money(report.cashReceived))}${kpi('Công nợ hiện tại', money(report.outstanding), 'red')}${kpi('Tiền phòng', money(report.roomRevenue))}${kpi('Dịch vụ', money(report.serviceRevenue))}${kpi('Phụ thu', money(report.surcharge))}${kpi('Thuế GTGT', money(report.vat))}</div>
  <div class="card" style="margin-top:14px"><h3>Doanh thu theo ngày</h3><div class="bar-chart" style="margin-top:16px">${report.byDay.map((item) => `<div class="bar-row"><span>${esc(item.date)}</span><div class="bar-track"><div class="bar-fill" style="width:${item.amount / max * 100}%"></div></div><strong>${money(item.amount)}</strong></div>`).join('') || '<div class="empty">Chưa có doanh thu trong khoảng ngày.</div>'}</div></div>${financeDailyTable(report)}<div id="financeDetail"><div class="section-head"><h2>Chi tiết ${ui.finance.detailDate ? esc(ui.finance.detailDate) : 'khoảng ngày đã lọc'}</h2><div>${ui.finance.detailDate ? '<button class="button" data-action="finance-all">Xem cả khoảng ngày</button> <button class="button success" data-action="export-finance" data-day="true">Xuất Excel ngày này</button>' : ''}</div></div>${financeDetails(ui.finance.detailDate ? financeReport(ui.state, ui.finance.detailDate, ui.finance.detailDate) : report)}</div>`;
}

function renderSettings() {
  const s = ui.state.settings;
  return `${employeeSettings()}<div class="card"><h2>Thông tin khách sạn</h2><form id="settingsForm" style="margin-top:15px"><div class="form-grid"><div class="field span-2"><label>Tên khách sạn</label><input name="hotelName" value="${esc(s.hotelName)}"></div><div class="field span-2"><label>Địa chỉ</label><input name="address" value="${esc(s.address)}"></div><div class="field"><label>Điện thoại</label><input name="phone" value="${esc(s.phone)}"></div><div class="field"><label>Email</label><input name="email" value="${esc(s.email)}"></div><div class="field"><label>Mã số thuế</label><input name="taxCode" value="${esc(s.taxCode)}"></div><div class="field"><label>Chọn logo PNG/JPG/WebP</label><input id="logoInput" type="file" accept="image/png,image/jpeg,image/webp"></div><div class="field"><label>VAT (ví dụ 0.08)</label><input name="vatRate" type="number" step="0.01" min="0" max="1" value="${s.vatRate}"></div><div class="field"><label>Phí dịch vụ</label><input name="serviceFeeRate" type="number" step="0.01" min="0" max="1" value="${s.serviceFeeRate}"></div><div class="field"><label>Giờ nhận phòng</label><input name="checkInTime" type="time" value="${esc(s.checkInTime)}"></div><div class="field"><label>Giờ trả phòng</label><input name="checkOutTime" type="time" value="${esc(s.checkOutTime)}"></div><div class="field"><label>Khóa mục tài chính</label><select name="financeLocked"><option value="true" ${s.financeLocked ? 'selected' : ''}>Bật</option><option value="false" ${!s.financeLocked ? 'selected' : ''}>Tắt</option></select></div><div class="field"><label>Thời gian mở khóa (phút)</label><input name="financeSessionMinutes" type="number" min="5" max="120" value="${s.financeSessionMinutes}"></div><div class="field"><label>Số lần nhập PIN sai</label><input name="financeMaxAttempts" type="number" min="3" max="10" value="${s.financeMaxAttempts || 5}"></div><div class="field"><label>Thời gian khóa tạm (phút)</label><input name="financeLockMinutes" type="number" min="5" max="60" value="${s.financeLockMinutes || 15}"></div><div class="field span-2"><label>Tiêu đề hóa đơn</label><input name="invoiceTitle" value="${esc(s.invoiceTitle)}"></div><div class="field span-2"><label>Lời cuối hóa đơn</label><input name="invoiceFooter" value="${esc(s.invoiceFooter)}"></div></div>${s.logo ? `<img src="${esc(s.logo)}" alt="Logo hiện tại" style="max-height:80px;margin-top:12px">` : ''}<div class="actions"><button type="button" class="button" data-action="restore-backup">Khôi phục bản sao</button><button type="button" class="button" data-action="change-finance-pin">Đổi PIN tài chính</button><button class="button primary">Lưu cài đặt</button></div></form></div>
  <div class="card" style="margin-top:14px"><h2>Mã truy cập hệ thống</h2><p class="sub">Đổi mã truy cập đăng nhập tại đây. Mã mới tối thiểu 12 ký tự và không hiển thị lại sau khi lưu.</p><form id="accessKeyForm" style="margin-top:12px"><div class="form-grid"><div class="field"><label>Mã truy cập mới</label><input name="newAccessKey" type="password" minlength="12" autocomplete="new-password" required></div><div class="field"><label>Nhập lại mã truy cập</label><input name="confirmAccessKey" type="password" minlength="12" autocomplete="new-password" required></div></div><div class="actions"><button class="button primary">Đổi mã truy cập</button></div></form></div>
  <div class="card" style="margin-top:14px"><h2>Loại phòng</h2><p class="sub">Sửa tên loại phòng tại đây; giá đã chốt và lịch sử đặt phòng được giữ nguyên.</p><div class="table-wrap"><table class="table"><thead><tr><th>Loại phòng</th><th>Số phòng</th><th>Thao tác</th></tr></thead><tbody>${ui.state.rates.map((rate) => `<tr><td>${esc(rate.roomType)}</td><td>${ui.state.rooms.filter((room) => room.roomType === rate.roomType).length}</td><td><button type="button" class="button small" data-action="open-room-type-edit" data-id="${esc(rate.id)}">Sửa loại phòng</button></td></tr>`).join('')}</tbody></table></div></div>
  <div class="section-head"><div><h2>Danh sách phòng và giá hiện hành</h2><p>Loại phòng có thể bổ sung linh hoạt; mỗi loại có bảng giá theo ngày, qua đêm và theo giờ riêng.</p></div><div><button class="button" data-action="open-rate-edit">Sửa bảng giá</button> <button class="button" data-action="open-room-type-add">+ Thêm loại phòng</button> <button class="button primary" data-action="open-room-add">+ Thêm phòng</button></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Mã</th><th>Tên phòng</th><th>Tầng</th><th>Loại</th><th>Sức chứa</th><th>Giá theo ngày / qua đêm / theo giờ</th><th>Trạng thái</th><th>Hoạt động</th></tr></thead><tbody>${ui.state.rooms.map((room) => { const rate = ui.state.rates.find((item) => item.roomType === room.roomType); return `<tr><td>${esc(room.id)}</td><td>${esc(room.name)}</td><td>${room.floor}</td><td>${esc(room.roomType)}</td><td>${room.capacity}</td><td>${money(rate?.weekday)} ngày thường · ${money(rate?.weekend)} cuối tuần<span class="sub">Qua đêm: ${money(rate?.overnight ?? rate?.weekday)} · Giờ đầu: ${money(rate?.hourlyFirst || 0)}</span></td><td>${esc(room.status)}</td><td><button class="button small" data-action="open-room-edit" data-id="${esc(room.id)}">Sửa</button> <button class="button danger small" data-action="delete-room" data-id="${esc(room.id)}">Xóa</button> <button class="button small" data-action="toggle-room-active" data-id="${esc(room.id)}">${room.active ? 'Đang bật' : 'Đang tắt'}</button></td></tr>`; }).join('')}</tbody></table></div>
  <div class="section-head"><h2>Danh mục dịch vụ / đồ giải khát</h2><button class="button primary" data-action="open-service-add">+ Thêm dịch vụ</button></div><div class="table-wrap"><table class="table"><thead><tr><th>Mã</th><th>Loại</th><th>Tên</th><th>Đơn vị</th><th>Giá nhập</th><th>Giá bán</th><th>Tồn</th><th>Hoạt động</th></tr></thead><tbody>${ui.state.services.map((item) => `<tr><td>${esc(item.id)}</td><td>${esc(item.type)}</td><td>${esc(item.name)}</td><td>${esc(item.unit)}</td><td>${money(item.cost)}</td><td>${money(item.price)}</td><td>${item.trackStock ? item.stock : '—'}</td><td><button class="button small" data-action="open-service-edit" data-id="${esc(item.id)}">Sửa</button> <button class="button danger small" data-action="delete-service" data-id="${esc(item.id)}">Xóa</button> <button class="button small" data-action="toggle-service-active" data-id="${esc(item.id)}">${item.active ? 'Đang bật' : 'Đang tắt'}</button></td></tr>`).join('')}</tbody></table></div>`;
}

function renameRoomType(state, rateId, name) {
  const roomType = String(name || '').trim().replace(/\s+/g, ' ');
  if (!roomType) throw new Error('Tên loại phòng không được để trống.');
  const next = deepClone(state);
  const rate = next.rates.find((item) => item.id === rateId);
  if (!rate) throw new Error('Không tìm thấy loại phòng.');
  if (next.rates.some((item) => item.id !== rateId && normalize(item.roomType).replace(/\s+/g, ' ') === normalize(roomType))) throw new Error('Loại phòng này đã tồn tại.');
  const previousName = rate.roomType;
  rate.roomType = roomType;
  if (rate.name === `Giá ${previousName}`) rate.name = `Giá ${roomType}`;
  next.rooms.forEach((room) => { if (room.roomType === previousName) room.roomType = roomType; });
  next.meta.revision += 1;
  next.meta.updatedAt = new Date().toISOString();
  return next;
}

function roomTypeEditModal(rateId) {
  const rate = ui.state.rates.find((item) => item.id === rateId);
  if (!rate) return toast('Không tìm thấy loại phòng.', true);
  openModal(`<h2>Sửa loại phòng</h2><form id="roomTypeEditForm"><input type="hidden" name="id" value="${esc(rate.id)}"><div class="field"><label>Tên loại phòng *</label><input name="roomType" value="${esc(rate.roomType)}" required></div><p class="sub">Tên mới áp dụng cho tất cả phòng thuộc loại này. Bảng giá và lịch sử đặt phòng không thay đổi.</p><div class="actions"><button type="button" class="button" data-action="close-modal">Hủy</button><button class="button primary">Lưu thay đổi</button></div></form>`);
}

function roomEditModal(roomId) {
  const room = ui.state.rooms.find((item) => item.id === roomId);
  if (!room) return toast('Không tìm thấy phòng.', true);
  openModal(`<h2>Sửa phòng ${esc(room.id)}</h2><form id="roomEditForm"><input type="hidden" name="id" value="${esc(room.id)}"><div class="form-grid"><div class="field"><label>Mã phòng</label><input value="${esc(room.id)}" disabled></div><div class="field"><label>Tên phòng</label><input name="name" value="${esc(room.name)}" required></div><div class="field"><label>Tầng</label><input name="floor" type="number" min="1" value="${room.floor}" required></div><div class="field"><label>Loại phòng</label><select name="roomType">${ui.state.rates.map((rate) => `<option ${rate.roomType === room.roomType ? 'selected' : ''}>${esc(rate.roomType)}</option>`).join('')}</select></div><div class="field"><label>Sức chứa</label><input name="capacity" type="number" min="1" value="${room.capacity}" required></div></div><p class="sub">Mã phòng không đổi để bảo toàn lịch sử. Không thể đổi loại phòng khi phòng đang có khách.</p><div class="actions"><button class="button primary">Lưu thay đổi</button></div></form>`);
}
function serviceEditModal(serviceId) {
  const service = ui.state.services.find((item) => item.id === serviceId);
  if (!service) return toast('Không tìm thấy dịch vụ.', true);
  openModal(`<h2>Sửa danh mục ${esc(service.name)}</h2><form id="serviceEditForm"><input type="hidden" name="id" value="${esc(service.id)}"><div class="form-grid"><div class="field"><label>Mã</label><input value="${esc(service.id)}" disabled></div><div class="field"><label>Loại</label><select name="type"><option ${service.type === 'Đồ giải khát' ? 'selected' : ''}>Đồ giải khát</option><option ${service.type === 'Dịch vụ' ? 'selected' : ''}>Dịch vụ</option><option ${service.type === 'Phụ thu' ? 'selected' : ''}>Phụ thu</option></select></div><div class="field span-2"><label>Tên</label><input name="name" value="${esc(service.name)}" required></div><div class="field"><label>Đơn vị</label><input name="unit" value="${esc(service.unit)}" required></div><div class="field"><label>Giá nhập</label><input name="cost" type="text" inputmode="numeric" data-money value="${money(service.cost)}"></div><div class="field"><label>Giá bán</label><input name="price" type="text" inputmode="numeric" data-money value="${money(service.price)}" required></div><div class="field"><label>Tồn tối thiểu</label><input name="minStock" type="number" min="0" value="${service.minStock || 0}"></div></div><p class="sub">Giá mới chỉ áp dụng cho giao dịch phát sinh sau khi lưu; lịch sử không thay đổi.</p><div class="actions"><button class="button primary">Lưu thay đổi</button></div></form>`);
}
function checkoutModal(stayId) {
  const stay = ui.state.stays.find((item) => item.id === stayId);
  const booking = ui.state.bookings.find((item) => item.id === stay?.bookingId);
  const earliestCheckout = new Date(new Date(stay.checkIn).getTime() + 60000);
  const suggestedCheckout = new Date(Math.max(Date.now(), earliestCheckout.getTime()));
  openModal(`<h2>Trả phòng ${esc(stay?.roomId)}</h2><p class="sub">${esc(stay?.guestName)} · Nhóm ${esc(booking?.groupId || 'đặt lẻ')} · <b>${esc(stay?.priceMode || 'Theo ngày')}</b> · Cọc ${money(stay?.deposit)}</p><form id="checkoutForm">${employeeField('Nhân viên trả phòng')}<input type="hidden" name="stayId" value="${esc(stayId)}"><div class="form-grid"><div class="field span-2"><label>Thời gian trả</label><input name="checkout" type="datetime-local" min="${esc(isoLocal(earliestCheckout))}" value="${esc(isoLocal(suggestedCheckout))}" required></div><div class="field span-2"><label>Ghi chú trả phòng</label><input name="note"></div></div><p class="sub">Trả phòng chốt thời gian và lập hóa đơn. Bước tiếp theo cho phép kiểm tra tiền phòng, phụ thu, giảm giá và thanh toán.</p><div class="actions no-print"><button class="button primary">Trả phòng & chuyển sang thanh toán</button></div></form>`);
}
function paymentModal(invoiceId) {
  const invoice = ui.state.invoices.find((item) => item.id === invoiceId);
  const lines = ui.state.invoiceLines.filter((item) => item.invoiceId === invoiceId && item.type !== 'Tiền phòng');
  const serviceRows = lines.length ? lines.map((line) => `<tr><td>${esc(line.name)}</td><td>${line.quantity} ${esc(line.unit)}</td><td>${money(line.unitPrice)}</td><td>${money(line.amount)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">Không có dịch vụ/minibar.</td></tr>';
  const canCollect = Number(invoice.due || 0) > 0;
  openModal(`<h2>Thanh toán phòng ${esc(invoice.roomId)}</h2><p class="sub">${esc(invoice.guestName)} · Hóa đơn ${esc(invoice.id)} · <b>${esc(invoice.priceMode || 'Theo ngày')}</b> · ${invoice.nights || 0} ${esc(invoice.pricingUnit || 'đêm')}</p><form id="paymentForm">${employeeField('Nhân viên thu ngân')}<input type="hidden" name="invoiceId" value="${esc(invoiceId)}"><div class="table-wrap"><table class="table"><thead><tr><th>Dịch vụ / minibar</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>${serviceRows}</tbody></table></div><div class="form-grid" style="margin-top:15px"><div class="field"><label>Tiền phòng (có thể sửa)</label><input name="roomAmount" type="text" inputmode="numeric" data-money min="0" value="${money(invoice.roomAmount)}" required></div><div class="field"><label>Lý do điều chỉnh giá phòng</label><input name="roomAdjustmentReason" value="${esc(invoice.roomAdjustmentReason || '')}" placeholder="Bắt buộc nếu sửa tiền phòng"></div><div class="field"><label>Phụ thu</label><input name="surcharge" type="text" inputmode="numeric" data-money min="0" value="${money(invoice.surcharge)}"></div><div class="field"><label>Giảm tiền (VNĐ)</label><input name="discount" type="text" inputmode="numeric" data-money min="0" value="${money(invoice.discount)}"></div><div class="field span-2"><label>Lý do giảm tiền</label><input name="discountReason" value="${esc(invoice.discountReason || '')}" placeholder="Bắt buộc khi có giảm tiền"></div><div class="field"><label>Số tiền thu (nếu có)</label><input name="amount" type="text" inputmode="numeric" data-money min="${canCollect ? 1 : 0}" value="${money(invoice.due)}" ${canCollect ? 'required' : ''}></div><div class="field"><label>Phương thức</label><select name="method"><option>Tiền mặt</option><option>Chuyển khoản</option><option>Thẻ</option></select></div><div class="field span-2"><label>Ghi chú</label><input name="note"></div></div><div class="summary" style="margin-top:15px"><div><span>Dịch vụ</span><b>${money(invoice.serviceAmount)}</b></div><div><span>Cọc + đã thu</span><b>${money(invoice.deposit + invoice.paid)}</b></div><div><span>Còn phải thu sau điều chỉnh</span><b id="paymentDuePreview">${money(invoice.due)}</b></div></div><div class="actions"><button class="button success">Cập nhật & ghi nhận thanh toán</button></div></form>`);
}
function groupPaymentModal(groupId) {
  const invoices = ui.state.invoices.filter((item) => invoiceGroupId(ui.state, item) === groupId && Number(item.due || 0) > 0);
  if (invoices.length < 2) return toast('Nhóm này hiện không còn từ hai hóa đơn chờ thu.', true);
  const totalDue = invoices.reduce((sum, item) => sum + Number(item.due || 0), 0);
  const roomBlocks = invoices.map((invoice) => {
    const lines = ui.state.invoiceLines.filter((line) => line.invoiceId === invoice.id);
    const detail = lines.length ? lines.map((line) => `<tr><td>${esc(line.name)}</td><td>${line.quantity} ${esc(line.unit)}</td><td>${money(line.unitPrice)}</td><td>${money(line.amount)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">Không có dịch vụ/minibar.</td></tr>';
    return `<div class="card" style="margin:12px 0"><div class="section-head"><div><h3>Phòng ${esc(invoice.roomId)}</h3><p>${esc(invoice.id)} · Cọc ${money(invoice.deposit)} · Còn thu ${money(invoice.due)}</p></div><input type="checkbox" name="invoiceIds" value="${esc(invoice.id)}" data-due="${Number(invoice.due || 0)}" checked></div><div class="table-wrap"><table class="table"><thead><tr><th>Nội dung</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>${detail}</tbody></table></div><div class="form-grid"><div class="field"><label>Tiền phòng</label><input name="roomAmount_${esc(invoice.id)}" type="text" inputmode="numeric" data-money min="0" value="${money(invoice.roomAmount)}"></div><div class="field"><label>Lý do sửa giá phòng</label><input name="roomReason_${esc(invoice.id)}" value="${esc(invoice.roomAdjustmentReason || '')}"></div><div class="field"><label>Phụ thu</label><input name="surcharge_${esc(invoice.id)}" type="text" inputmode="numeric" data-money min="0" value="${money(invoice.surcharge)}"></div><div class="field"><label>Giảm tiền (VNĐ)</label><input name="discount_${esc(invoice.id)}" type="text" inputmode="numeric" data-money min="0" value="${money(invoice.discount)}"></div><div class="field span-2"><label>Lý do giảm</label><input name="discountReason_${esc(invoice.id)}" value="${esc(invoice.discountReason || '')}"></div></div></div>`;
  }).join('');
  openModal(`<h2>Thanh toán gộp nhiều phòng</h2><p class="sub">${esc(invoices[0].guestName)} · Nhóm ${esc(groupId)}</p><form id="groupPaymentForm">${employeeField('Nhân viên thu ngân')}<input type="hidden" name="groupId" value="${esc(groupId)}">${roomBlocks}<div class="form-grid" style="margin-top:15px"><div class="field span-2"><label>Số tiền thanh toán gộp</label><input name="amount" type="text" inputmode="numeric" data-money min="1" value="${money(totalDue)}" required></div><div class="field span-2"><label>Phương thức</label><select name="method"><option>Tiền mặt</option><option>Chuyển khoản</option><option>Thẻ</option></select></div><div class="field span-4"><label>Ghi chú chung</label><input name="note" placeholder="Ví dụ: Khách thanh toán toàn bộ đoàn"></div></div><p class="sub">Mỗi phòng giữ hóa đơn riêng. Có thể sửa tiền phòng, phụ thu và giảm tiền riêng từng phòng trước khi thanh toán gộp.</p><div class="actions"><button class="button success">Cập nhật & xác nhận thanh toán gộp</button></div></form>`);
}
function extendStayModal(stayId) {
  const stay = ui.state.stays.find((item) => item.id === stayId);
  openModal(`<h2>Gia hạn phòng ${esc(stay.roomId)}</h2><form id="extendStayForm"><input type="hidden" name="stayId" value="${esc(stay.id)}"><div class="field"><label>Thời gian trả mới</label><input name="newCheckout" type="datetime-local" min="${esc(isoLocal(new Date(stay.expectedCheckout)))}" value="${esc(isoLocal(new Date(new Date(stay.expectedCheckout).getTime() + 86400000)))}" required></div><p class="sub">Hệ thống sẽ kiểm tra lịch đặt tiếp theo và giữ nguyên giá các đêm đã chốt.</p><div class="actions"><button class="button primary">Xác nhận gia hạn</button></div></form>`);
}
function transferRoomModal(stayId) {
  const stay = ui.state.stays.find((item) => item.id === stayId);
  const movedAt = isoLocal();
  const rooms = availableRooms(ui.state, movedAt, stay.expectedCheckout).filter((room) => room.id !== stay.roomId);
  openModal(`<h2>Chuyển phòng ${esc(stay.roomId)}</h2><form id="transferRoomForm"><input type="hidden" name="stayId" value="${esc(stay.id)}"><div class="form-grid"><div class="field span-2"><label>Thời gian chuyển</label><input name="movedAt" type="datetime-local" value="${esc(movedAt)}" required></div><div class="field span-2"><label>Phòng chuyển đến</label><select name="newRoomId" required><option value="">Chọn phòng trống</option>${rooms.map((room) => `<option value="${esc(room.id)}">${esc(room.name)} · ${esc(room.roomType)} · ${money(roomRate(ui.state, room, movedAt))}</option>`).join('')}</select></div><div class="field span-4"><label>Lý do chuyển phòng</label><input name="reason" required></div></div><p class="sub">Phòng cũ tự chuyển sang chờ vệ sinh; lịch sử chuyển phòng và mức giá được lưu lại.</p><div class="actions"><button class="button primary">Xác nhận chuyển</button></div></form>`);
}
function maintenanceModal() { openModal(`<h2>Báo hỏng / bảo trì</h2><form id="maintenanceForm"><div class="form-grid"><div class="field span-2"><label>Phòng</label><select name="roomId" required><option value="">Chọn phòng</option>${ui.state.rooms.filter((room) => room.active).map((room) => `<option value="${esc(room.id)}">${esc(room.name)}</option>`).join('')}</select></div><div class="field span-2"><label>Mức độ</label><select name="priority"><option>Thường</option><option>Ưu tiên</option><option>Khẩn</option></select></div><div class="field span-4"><label>Sự cố</label><textarea name="issue" required></textarea></div></div><div class="actions"><button class="button danger">Tạo phiếu bảo trì</button></div></form>`); }
function financeModal() {
  if (!ui.state.settings.financePinHash) {
    openModal(`<h2>Đặt PIN tài chính lần đầu</h2><form id="setupFinancePinForm"><label>PIN mới (4–8 số)<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" autocomplete="new-password" autofocus required></label><label>Nhập lại PIN<input name="confirmPin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" minlength="4" maxlength="8" autocomplete="new-password" required></label><p class="sub">Phần mềm không có PIN mặc định. Người quản lý tự đặt PIN khi sử dụng lần đầu.</p><div class="actions"><button class="button primary">Lưu PIN</button></div></form>`);
    return;
  }
  openModal(`<h2>Mở khóa tài chính</h2><form id="financePinForm"><label>Mã PIN quản lý<input name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" required></label><div class="actions"><button class="button primary">Xác thực</button></div></form>`);
}

function invoiceModal(invoiceId) {
  const invoice = ui.state.invoices.find((item) => item.id === invoiceId); const lines = ui.state.invoiceLines.filter((item) => item.invoiceId === invoiceId); const s = ui.state.settings;
  openModal(`<div class="invoice-print"><header>${s.logo ? `<img src="${esc(s.logo)}" alt="Logo" style="max-height:70px">` : ''}<h2>${esc(s.hotelName)}</h2><p>${esc(s.address)} · ${esc(s.phone)} · MST ${esc(s.taxCode)}</p><h3>${esc(s.invoiceTitle)}</h3></header><p><b>NV nhận phòng:</b> ${esc(invoice.checkInEmployeeName || 'Chưa ghi nhận')} · <b>NV trả phòng:</b> ${esc(invoice.checkOutEmployeeName || 'Chưa ghi nhận')}<br><b>Thu ngân lần cuối:</b> ${esc(invoice.cashierName || 'Chưa ghi nhận')}<br><b>Mã hóa đơn:</b> ${esc(invoice.id)}<br><b>Khách:</b> ${esc(invoice.guestName)} · <b>Phòng:</b> ${esc(invoice.roomId)}<br><b>Lưu trú:</b> ${dateTime(invoice.checkIn)} – ${dateTime(invoice.checkout)} (${invoice.nights} đêm)</p><table><thead><tr><th>Nội dung</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>${lines.map((line) => `<tr><td>${esc(line.name)}</td><td>${line.quantity} ${esc(line.unit)}</td><td>${money(line.unitPrice)}</td><td>${money(line.amount)}</td></tr>`).join('')}</tbody></table><p style="text-align:right"><b>Phụ thu:</b> ${money(invoice.surcharge)}<br><b>Giảm tiền:</b> ${money(invoice.discount)}${invoice.discountReason ? ` · ${esc(invoice.discountReason)}` : ``}<br>${invoice.roomAdjustmentReason ? `<b>Lý do điều chỉnh giá phòng:</b> ${esc(invoice.roomAdjustmentReason)}<br>` : ``}<b>Phí dịch vụ:</b> ${money(invoice.serviceFee)}<br><b>VAT:</b> ${money(invoice.vat)}<br><b>Tổng thanh toán:</b> ${money(invoice.total)}<br><b>Tiền cọc + đã thu:</b> ${money(invoice.deposit + invoice.paid)}<br><b>Còn phải thu:</b> ${money(invoice.due)}</p><p style="text-align:center">${esc(s.invoiceFooter)}</p><div class="actions no-print"><button type="button" class="button primary" onclick="window.print()">In hóa đơn</button></div></div>`);
}

async function sha256(text) { const data = new TextEncoder().encode(text); const hash = await crypto.subtle.digest('SHA-256', data); return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }

document.addEventListener('click', async (event) => {
  const nav = event.target.closest('[data-page]'); if (nav) { navigate(nav.dataset.page); return; }
  const actionNode = event.target.closest('[data-action]'); if (!actionNode) return;
  const action = actionNode.dataset.action; const itemId = actionNode.dataset.id;
  if (action === 'close-modal') { closeModal(); return; }
  if (action === 'open-map-booking') { roomOperationsModal(itemId); return; }
  if (action === 'map-new-booking') { mapBookingModal(itemId); return; }
  if (action === 'map-back') { if (ui.mapRoomId) roomOperationsModal(ui.mapRoomId); return; }
  if (action === 'map-services') { mapServicesModal(itemId); return; }
  if (action === 'map-pay') { mapPaymentModal(itemId); return; }
  if (action === 'map-checkin' || action === 'checkin') { checkInModal(itemId); return; }
  if (action === 'map-clean-start' || action === 'map-clean-done') {
    const saved = await mutate((state) => updateHousekeeping(state, itemId, action === 'map-clean-start' ? 'Đang làm' : 'Hoàn thành'), 'Đã cập nhật vệ sinh phòng.');
    if (saved) roomOperationsModal(ui.mapRoomId); return;
  }
  if (action === 'toggle-room') { ui.booking.selected.has(itemId) ? ui.booking.selected.delete(itemId) : ui.booking.selected.add(itemId); $('#bookingRoomGrid').innerHTML = bookingRoomCards(); renderBookingSelected(); }
  if (action === 'remove-room') { ui.booking.selected.delete(itemId); $('#bookingRoomGrid').innerHTML = bookingRoomCards(); renderBookingSelected(); }
  if (action === 'add-charge-row') {
    const form = $('#chargeForm'); const rows = $$('.charge-row', form); $('#chargeRows', form).insertAdjacentHTML('beforeend', chargeRowHtml(ui.state.services.filter((item) => item.active), rows.length));
  }
  if (action === 'remove-charge-row') {
    const rows = $$('.charge-row', $('#chargeForm')); if (rows.length <= 1) return toast('Cần giữ lại ít nhất một dòng dịch vụ.', true);
    actionNode.closest('[data-charge-row]')?.remove();
  }
  if (action === 'filter-booking-type') { ui.booking.roomType = actionNode.dataset.type || ''; render(); }
  if (action === 'clear-list-filter') {
    const scope = actionNode.dataset.scope;
    if (ui.listFilters[scope]) { ui.listFilters[scope] = { room: '', date: '', guest: '', phone: '' }; render(); }
    return;
  }
  if (action === 'cancel-booking' && confirm('Xác nhận hủy phiếu đặt phòng?')) await mutate((state) => cancelBooking(state, itemId), 'Đã hủy đặt phòng.');
  if (action === 'open-checkout') checkoutModal(itemId);
  if (action === 'open-extend') extendStayModal(itemId);
  if (action === 'open-transfer') transferRoomModal(itemId);
  if (action === 'open-payment') paymentModal(itemId);
  if (action === 'open-group-payment') groupPaymentModal(itemId);
  if (action === 'refund') { openModal(`<h2>Hoàn tiền thừa</h2><form id="refundEmployeeForm"><input type="hidden" name="invoiceId" value="${esc(itemId)}">${employeeField('Nhân viên thu ngân')}<div class="field"><label>Phương thức</label><select name="method"><option>Tiền mặt</option><option>Chuyển khoản</option><option>Thẻ</option></select></div><div class="actions"><button class="button primary">Xác nhận hoàn tiền</button></div></form>`); return; }
  if (action === 'print-invoice') invoiceModal(itemId);
  if (action === 'housekeeping-start') await mutate((state) => updateHousekeeping(state, itemId, 'Đang làm'), 'Đã bắt đầu vệ sinh.');
  if (action === 'housekeeping-done') await mutate((state) => updateHousekeeping(state, itemId, 'Hoàn thành'), 'Đã hoàn thành vệ sinh và cập nhật phòng.');
  if (action === 'open-maintenance') maintenanceModal();
  if (action === 'maintenance-done') await mutate((state) => completeMaintenance(state, itemId), 'Đã hoàn thành bảo trì.');
  if (action === 'open-finance') financeModal();
  if (action === 'filter-finance') {
    if (!financeUnlocked()) return render();
    const from = $('#financeFrom').value, to = $('#financeTo').value;
    try { financeReport(ui.state, from, to); ui.finance = { from, to, detailDate: '' }; render(); }
    catch (error) { toast(error.message, true); } return;
  }
  if (action === 'finance-day') { if (!financeUnlocked()) return render(); ui.finance.detailDate = itemId; render(); $('#financeDetail')?.scrollIntoView({ behavior: 'smooth' }); return; }
  if (action === 'finance-all') { ui.finance.detailDate = ''; render(); return; }
  if (action === 'export-finance') { if (!financeUnlocked()) return render(); exportFinance(actionNode.dataset.day === 'true'); return; }
  if (action === 'employee-add' || action === 'employee-edit') { employeeModal(action === 'employee-edit' ? itemId : ''); return; }
  if (action === 'employee-delete' && confirm('Xóa nhân viên khỏi danh sách chọn? Tên trên các giao dịch cũ vẫn được giữ.')) { await mutate((state) => saveEmployee(state, itemId, '', true), 'Đã xóa nhân viên khỏi danh sách chọn.'); return; }
  if (action === 'restore-backup') $('#restoreInput').click();
  if (action === 'change-finance-pin') {
    if (!ui.state.settings.financePinHash) financeModal();
    else openModal(`<h2>Đổi PIN tài chính</h2><form id="changePinForm"><label>PIN hiện tại<input name="currentPin" type="password" inputmode="numeric" required></label><label>PIN mới (4–8 số)<input name="newPin" type="password" inputmode="numeric" pattern="[0-9]{4,8}" required></label><div class="actions"><button class="button primary">Đổi PIN</button></div></form>`);
  }
  if (action === 'open-room-type-edit') roomTypeEditModal(actionNode.dataset.id);
  if (action === 'open-room-type-add') openModal(`<h2>Thêm loại phòng</h2><p class="sub">Mỗi loại phòng có thể cài giá độc lập. Sau khi lưu, loại mới sẽ xuất hiện ngay trong danh sách khi thêm/sửa phòng.</p><form id="roomTypeAddForm"><div class="form-grid"><div class="field span-2"><label>Tên loại phòng *</label><input name="roomType" placeholder="Ví dụ: Phòng Đơn VIP" required></div><div class="field"><label>Giá ngày thường</label><input name="weekday" type="text" inputmode="numeric" data-money min="0" value="0" required></div><div class="field"><label>Giá cuối tuần</label><input name="weekend" type="text" inputmode="numeric" data-money min="0" value="0" required></div><div class="field"><label>Giá qua đêm</label><input name="overnight" type="text" inputmode="numeric" data-money min="0" value="0" required></div><div class="field"><label>Giờ đầu</label><input name="hourlyFirst" type="text" inputmode="numeric" data-money min="0" value="0" required></div><div class="field"><label>Giờ thứ 2</label><input name="hourlySecond" type="text" inputmode="numeric" data-money min="0" value="0" required></div><div class="field"><label>Giờ thứ 3</label><input name="hourlyThird" type="text" inputmode="numeric" data-money min="0" value="0" required></div><div class="field"><label>Từ giờ thứ 4 · mỗi giờ</label><input name="hourlyFromFourth" type="text" inputmode="numeric" data-money min="0" value="0" required></div></div><div class="actions"><button class="button primary">Lưu loại phòng</button></div></form>`);
  if (action === 'open-room-add') openModal(`<h2>Thêm phòng</h2><form id="roomAddForm"><div class="form-grid"><div class="field"><label>Mã phòng</label><input name="id" required></div><div class="field"><label>Tên phòng</label><input name="name" required></div><div class="field"><label>Tầng</label><input name="floor" type="number" min="1" required></div><div class="field"><label>Loại phòng</label><select name="roomType">${ui.state.rates.map((rate) => `<option>${esc(rate.roomType)}</option>`).join('')}</select></div><div class="field"><label>Sức chứa</label><input name="capacity" type="number" min="1" required></div></div><div class="actions"><button class="button primary">Thêm phòng</button></div></form>`);
  if (action === 'open-rate-edit') openModal(`<h2>Sửa bảng giá phòng</h2><p class="sub">Cấu hình đồng thời giá theo ngày, qua đêm và theo giờ. Giá giờ là giá cộng dồn: giờ đầu + giờ 2 + giờ 3 + mỗi giờ từ giờ thứ 4.</p><form id="rateEditForm"><div class="form-grid">${ui.state.rates.map((rate, index) => `<div class="field span-4" style="margin-top:10px"><h3>${esc(rate.roomType)}</h3></div><input type="hidden" name="id_${index}" value="${esc(rate.id)}"><div class="field"><label>Giá ngày thường</label><input name="weekday_${index}" type="text" inputmode="numeric" data-money min="0" value="${rate.weekday || 0}" required></div><div class="field"><label>Giá cuối tuần</label><input name="weekend_${index}" type="text" inputmode="numeric" data-money min="0" value="${rate.weekend || 0}" required></div><div class="field"><label>Giá qua đêm</label><input name="overnight_${index}" type="text" inputmode="numeric" data-money min="0" value="${rate.overnight ?? rate.weekday ?? 0}" required></div><div class="field"><label>Giờ đầu</label><input name="hourlyFirst_${index}" type="text" inputmode="numeric" data-money min="0" value="${rate.hourlyFirst || 0}" required></div><div class="field"><label>Giờ thứ 2</label><input name="hourlySecond_${index}" type="text" inputmode="numeric" data-money min="0" value="${rate.hourlySecond || 0}" required></div><div class="field"><label>Giờ thứ 3</label><input name="hourlyThird_${index}" type="text" inputmode="numeric" data-money min="0" value="${rate.hourlyThird || 0}" required></div><div class="field"><label>Từ giờ thứ 4 · mỗi giờ</label><input name="hourlyFromFourth_${index}" type="text" inputmode="numeric" data-money min="0" value="${rate.hourlyFromFourth || 0}" required></div>`).join('')}</div><div class="actions"><button class="button primary">Lưu bảng giá</button></div></form>`);
  if (action === 'open-service-add') openModal(`<h2>Thêm dịch vụ</h2><form id="serviceAddForm"><div class="form-grid"><div class="field"><label>Mã</label><input name="id" required></div><div class="field"><label>Loại</label><select name="type"><option>Đồ giải khát</option><option>Dịch vụ</option><option>Phụ thu</option></select></div><div class="field span-2"><label>Tên dịch vụ</label><input name="name" required></div><div class="field"><label>Đơn vị</label><input name="unit" required></div><div class="field"><label>Giá nhập</label><input name="cost" type="text" inputmode="numeric" data-money min="0" value="0"></div><div class="field"><label>Giá bán</label><input name="price" type="number" min="0" required></div><div class="field"><label>Tồn ban đầu</label><input name="stock" type="number" min="0" value="0"></div></div><div class="actions"><button class="button primary">Thêm dịch vụ</button></div></form>`);
  if (action === 'open-room-edit') roomEditModal(itemId);
  if (action === 'open-service-edit') serviceEditModal(itemId);
  if (action === 'delete-room' && confirm('Xóa mềm phòng này khỏi danh mục? Lịch sử hóa đơn vẫn được giữ.')) await mutate((state) => { const next = deepClone(state); const room = next.rooms.find((item) => item.id === itemId); if (!room) throw new Error('Không tìm thấy phòng.'); if (room.status !== 'Phòng trống') throw new Error('Chỉ được xóa phòng đang trống.'); room.active = false; next.meta.revision += 1; next.meta.updatedAt = new Date().toISOString(); return next; }, 'Đã xóa mềm phòng khỏi danh mục.');
  if (action === 'delete-service' && confirm('Xóa mềm dịch vụ này khỏi danh mục? Lịch sử phát sinh vẫn được giữ.')) await mutate((state) => { const next = deepClone(state); const service = next.services.find((item) => item.id === itemId); if (!service) throw new Error('Không tìm thấy dịch vụ.'); service.active = false; next.meta.revision += 1; next.meta.updatedAt = new Date().toISOString(); return next; }, 'Đã xóa mềm dịch vụ khỏi danh mục.');
  if (action === 'toggle-room-active') await mutate((state) => { const next = deepClone(state); const room = next.rooms.find((item) => item.id === itemId); if (room.status === 'Đang ở') throw new Error('Không thể tắt phòng đang có khách.'); room.active = !room.active; next.meta.revision += 1; return next; }, 'Đã cập nhật trạng thái hoạt động của phòng.');
  if (action === 'toggle-service-active') await mutate((state) => { const next = deepClone(state); const service = next.services.find((item) => item.id === itemId); service.active = !service.active; next.meta.revision += 1; return next; }, 'Đã cập nhật trạng thái dịch vụ.');
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'roomQuery') { ui.roomFilter.query = event.target.value; $('#roomGrid').innerHTML = roomCardsHtml(); }
  if (event.target.id === 'bookingQuery') { ui.booking.query = event.target.value; $('#bookingRoomGrid').innerHTML = bookingRoomCards(); }
  const listScope = event.target.dataset?.listFilterScope; const listKey = event.target.dataset?.listFilterKey;
  if (listScope && listKey && ui.listFilters[listScope]) { ui.listFilters[listScope][listKey] = event.target.value; refreshListFilter(listScope); }
});

document.addEventListener('blur', (event) => { if (event.target.matches?.('[data-money]')) formatMoneyInput(event.target); }, true);
document.addEventListener('change', (event) => {
  if (event.target.id === 'roomFloor') { ui.roomFilter.floor = event.target.value; $('#roomGrid').innerHTML = roomCardsHtml(); }
  if (event.target.id === 'roomStatus') { ui.roomFilter.status = event.target.value; $('#roomGrid').innerHTML = roomCardsHtml(); }
  if (event.target.id === 'bookingArrival') { ui.booking.arrival = event.target.value; ui.booking.selected.clear(); $('#bookingRoomGrid').innerHTML = bookingRoomCards(); renderBookingSelected(); refreshBookingPriceTable(); }
  if (event.target.id === 'bookingDeparture') { ui.booking.departure = event.target.value; ui.booking.selected.clear(); $('#bookingRoomGrid').innerHTML = bookingRoomCards(); renderBookingSelected(); refreshBookingPriceTable(); }
  if (event.target.id === 'bookingFloor') { ui.booking.floor = event.target.value; $('#bookingRoomGrid').innerHTML = bookingRoomCards(); }
  if (event.target.id === 'bookingType') { ui.booking.roomType = event.target.value; $('#bookingRoomGrid').innerHTML = bookingRoomCards(); refreshBookingPriceTable(); }
  if (event.target.id === 'bookingPriceMode') { ui.booking.priceMode = event.target.value; ui.booking.selected.clear(); $('#bookingRoomGrid').innerHTML = bookingRoomCards(); renderBookingSelected(); refreshBookingPriceTable(); }
  if (event.target.name === 'invoiceIds' && event.target.closest('#groupPaymentForm')) {
    const form = event.target.closest('#groupPaymentForm');
    const total = $$('input[name="invoiceIds"]:checked', form).reduce((sum, input) => sum + Number(input.dataset.due || 0), 0);
    const amount = $('input[name="amount"]', form); amount.max = String(total); amount.value = total ? money(total) : '';
  }
});

document.addEventListener('input', (event) => {
  const form = event.target.closest('#paymentForm');
  if (!form || !['roomAmount', 'roomAdjustmentReason', 'surcharge', 'discount', 'discountReason'].includes(event.target.name)) return;
  try {
    const data = formData(form);
    const preview = adjustInvoice(ui.state, data.invoiceId, data).invoices.find((item) => item.id === data.invoiceId);
    $('[name="amount"]', form).value = money(preview.due);
    $('[name="amount"]', form).required = preview.due > 0;
    const label = $('#paymentDuePreview', form); if (label) label.textContent = money(preview.due);
  } catch { /* Validation errors are shown on submit; retain the last valid quote. */ }
});

document.addEventListener('submit', async (event) => {
  event.preventDefault(); const form = event.target;
  // Named controls (e.g. name="id") can shadow native form properties.
  const formId = form.getAttribute('id'); const data = formData(form);
  if (formId === 'employeeForm') {
    const saved = await mutate((state) => saveEmployee(state, data.employeeId, data.employeeName), 'Đã lưu nhân viên.');
    if (saved) closeModal(); return;
  }
  if (formId === 'receiveEmployeeForm') {
    const saved = await mutate((state) => {
      const booking = state.bookings.find((item) => item.id === data.bookingId), now = new Date().toISOString();
      if (!booking || new Date(booking.departure) <= new Date(now)) throw new Error('Đã quá giờ trả dự kiến. Vui lòng kiểm tra lại lịch đặt.');
      if (!roomAvailable(state, booking.roomId, now, booking.departure, booking.id)) throw new Error('Phòng không còn trống trong khoảng nhận–trả này.');
      return checkIn(state, booking.id, now, data.employeeId);
    }, 'Đã nhận phòng và ghi nhận nhân viên.');
    if (saved) { if (ui.mapRoomId) roomOperationsModal(ui.mapRoomId); else closeModal(); } return;
  }
  if (formId === 'refundEmployeeForm') {
    const saved = await mutate((state) => refundSurplus(state, data.invoiceId, data.method, data.employeeId), 'Đã hoàn tiền thừa.');
    if (saved) { if (ui.mapRoomId) roomOperationsModal(ui.mapRoomId); else closeModal(); } return;
  }
  if (formId === 'mapBookingForm') {
    data.roomIds = [data.roomId];
    const direct = event.submitter?.value === 'direct-checkin';
    if (direct && !data.employeeId) return toast('Vui lòng chọn nhân viên nhận phòng; thêm tên tại Cài đặt → Nhân viên nếu danh sách trống.', true);
    if (!Number.isFinite(Date.parse(data.arrival)) || !Number.isFinite(Date.parse(data.departure))) return toast('Vui lòng nhập đủ giờ nhận và giờ trả hợp lệ.', true);
    const saved = await mutate((state) => direct ? directCheckIn(state, data) : createBooking(state, data), direct ? 'Đã nhận phòng trực tiếp từ sơ đồ phòng.' : 'Đã lưu đặt phòng từ sơ đồ phòng.');
    if (saved) closeModal();
  }
  if (formId === 'bookingForm') {
    data.roomIds = [...ui.booking.selected]; data.arrival = ui.booking.arrival; data.departure = ui.booking.departure; data.priceMode = ui.booking.priceMode;
    const direct = event.submitter?.value === 'direct-checkin';
    if (direct && !data.employeeId) return toast('Vui lòng chọn nhân viên nhận phòng; thêm tên tại Cài đặt → Nhân viên nếu danh sách trống.', true);
    const receivedAt = new Date().toISOString();
    const saved = await mutate((state) => direct ? directCheckIn(state, data, receivedAt) : createBooking(state, data), direct ? 'Đã nhận phòng trực tiếp. Phòng đã chuyển sang Đang ở.' : 'Đã lưu đặt phòng và chốt loại tính giá.');
    if (saved) { ui.booking.selected.clear(); if (direct) navigate('stays'); else render(); }
  }
  if (formId === 'chargeForm') {
    const items = $$('[data-charge-row]', form).map((row) => ({ serviceId: $('select[name="serviceId"]', row)?.value || '', quantity: $('input[name="quantity"]', row)?.value || '1' })).filter((item) => item.serviceId);
    if (!items.length) return toast('Vui lòng chọn ít nhất một dịch vụ.', true);
    const saved = await mutate((state) => items.reduce((next, item) => addCharge(next, { stayId: data.stayId, ...item, note: data.note || '' }), state), 'Đã ghi toàn bộ dịch vụ phát sinh.');
    if (saved) { if (ui.mapRoomId) roomOperationsModal(ui.mapRoomId); else form.reset(); }
  }
  if (formId === 'stockForm') { await mutate((state) => receiveStock(state, data), 'Đã nhập kho.'); form.reset(); }
  if (formId === 'checkoutForm') { const saved = await mutate((state) => checkOut(state, data.stayId, data), 'Đã trả phòng và lập hóa đơn.'); if (saved) { if (ui.mapRoomId) { const invoice = ui.state.invoices.find((item) => item.stayId === data.stayId); mapPaymentModal(invoice.id); } else { closeModal(); navigate('payments'); } } }
  if (formId === 'extendStayForm') { await mutate((state) => extendStay(state, data.stayId, data.newCheckout), 'Đã gia hạn lưu trú và giữ giá đã chốt.'); closeModal(); }
  if (formId === 'transferRoomForm') { await mutate((state) => transferRoom(state, data.stayId, data.newRoomId, data.movedAt, data.reason), 'Đã chuyển phòng và tạo công việc vệ sinh phòng cũ.'); closeModal(); }
  if (formId === 'paymentForm') {
    const saved = await mutate((state) => {
      const next = adjustInvoice(state, data.invoiceId, data);
      return Number(data.amount || 0) > 0 ? payInvoice(next, data.invoiceId, data) : next;
    }, 'Đã cập nhật hóa đơn và ghi nhận thanh toán riêng.');
    if (saved) { if (ui.mapRoomId) roomOperationsModal(ui.mapRoomId); else closeModal(); }
  }
  if (formId === 'mapCollectForm') {
    const saved = await mutate((state) => payInvoice(state, data.invoiceId, data), 'Đã ghi nhận thanh toán.');
    if (saved) roomOperationsModal(ui.mapRoomId);
  }
  if (formId === 'groupPaymentForm') {
    const fd = new FormData(form); const invoiceIds = fd.getAll('invoiceIds');
    const saved = await mutate((state) => {
      let next = state;
      invoiceIds.forEach((invoiceId) => {
        next = adjustInvoice(next, invoiceId, {
          roomAmount: moneyRaw(fd.get(`roomAmount_${invoiceId}`)), roomAdjustmentReason: fd.get(`roomReason_${invoiceId}`),
          surcharge: moneyRaw(fd.get(`surcharge_${invoiceId}`)), discount: moneyRaw(fd.get(`discount_${invoiceId}`)), discountReason: fd.get(`discountReason_${invoiceId}`)
        });
      });
      const refreshedDue = invoiceIds.reduce((sum, invoiceId) => sum + Number(next.invoices.find((item) => item.id === invoiceId)?.due || 0), 0);
      const amount = Math.min(Number(data.amount || 0), refreshedDue);
      if (amount <= 0) throw new Error('Nhóm hóa đơn không còn số tiền phải thu.');
      return payInvoiceGroup(next, invoiceIds, { ...data, amount });
    }, 'Đã cập nhật chi tiết và thanh toán gộp nhiều phòng.');
    if (saved) closeModal();
  }
  if (formId === 'maintenanceForm') { await mutate((state) => createMaintenance(state, data.roomId, data.issue, data.priority), 'Đã tạo phiếu bảo trì.'); closeModal(); }
  if (formId === 'setupFinancePinForm') {
    if (data.pin !== data.confirmPin) return toast('Hai lần nhập PIN chưa giống nhau.', true);
    const hash = await sha256(data.pin);
    await mutate((state) => { const next = deepClone(state); next.settings.financePinHash = hash; next.meta.revision += 1; next.meta.updatedAt = new Date().toISOString(); return next; }, 'Đã thiết lập PIN tài chính.');
    ui.financeUnlockedUntil = Date.now() + Number(ui.state.settings.financeSessionMinutes || 30) * 60000;
    closeModal(); render();
  }
  if (formId === 'financePinForm') {
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
  if (formId === 'changePinForm') { if (await sha256(data.currentPin) !== ui.state.settings.financePinHash) return toast('PIN hiện tại không đúng.', true); const hash = await sha256(data.newPin); await mutate((state) => { const next = deepClone(state); next.settings.financePinHash = hash; next.meta.revision += 1; next.meta.updatedAt = new Date().toISOString(); return next; }, 'Đã đổi PIN tài chính.'); closeModal(); }
  if (formId === 'accessKeyForm') {
    if (data.newAccessKey !== data.confirmAccessKey) return toast('Hai lần nhập mã truy cập chưa giống nhau.', true);
    if (String(data.newAccessKey || '').length < 12) return toast('Mã truy cập phải có ít nhất 12 ký tự.', true);
    setBusy(true);
    try { await store.changeAccessKey(data.newAccessKey); toast('Đã đổi mã truy cập. Hãy dùng mã mới cho lần đăng nhập tiếp theo.'); }
    catch (error) { toast(error.message || 'Không thể đổi mã truy cập.', true); }
    finally { setBusy(false); }
  }
  if (formId === 'settingsForm') { await mutate((state) => { const next = deepClone(state); next.settings = { ...next.settings, ...data, financeLocked: data.financeLocked === 'true', vatRate: Number(data.vatRate || 0), serviceFeeRate: Number(data.serviceFeeRate || 0), financeSessionMinutes: Number(data.financeSessionMinutes || 30), financeMaxAttempts: Number(data.financeMaxAttempts || 5), financeLockMinutes: Number(data.financeLockMinutes || 15) }; next.meta.revision += 1; next.meta.updatedAt = new Date().toISOString(); return next; }, 'Đã lưu cài đặt.'); }
  if (formId === 'performanceForm') {
    try { roomPerformance(ui.state, data.from, data.to); ui.performance = { from: data.from, to: data.to }; render(); }
    catch (error) { toast(error.message, true); }
  }
  if (formId === 'roomTypeEditForm') {
    const previousName = ui.state.rates.find((rate) => rate.id === data.id)?.roomType;
    const saved = await mutate((state) => renameRoomType(state, data.id, data.roomType), 'Đã cập nhật loại phòng.');
    if (saved) {
      if (ui.booking.roomType === previousName) ui.booking.roomType = ui.state.rates.find((rate) => rate.id === data.id)?.roomType || '';
      closeModal();
    }
  }
  if (formId === 'roomTypeAddForm') { await mutate((state) => { const next = deepClone(state); const roomType = String(data.roomType || '').trim(); if (!roomType) throw new Error('Tên loại phòng không được để trống.'); if (next.rates.some((rate) => normalize(rate.roomType) === normalize(roomType))) throw new Error('Loại phòng này đã tồn tại.'); next.rates.push({ id: id('GIA'), roomType, name: `Giá ${roomType}`, weekday: Math.max(0, Number(data.weekday || 0)), weekend: Math.max(0, Number(data.weekend || 0)), overnight: Math.max(0, Number(data.overnight || 0)), hourlyFirst: Math.max(0, Number(data.hourlyFirst || 0)), hourlySecond: Math.max(0, Number(data.hourlySecond || 0)), hourlyThird: Math.max(0, Number(data.hourlyThird || 0)), hourlyFromFourth: Math.max(0, Number(data.hourlyFromFourth || 0)), active: true }); next.meta.revision += 1; next.meta.updatedAt = new Date().toISOString(); return next; }, 'Đã thêm loại phòng mới và bảng giá tương ứng.'); closeModal(); }
  if (formId === 'roomAddForm') { const saved = await mutate((state) => { const next = deepClone(state); const roomId = String(data.id).trim().toUpperCase(); if (next.rooms.some((room) => room.id === roomId)) throw new Error('Mã phòng đã tồn tại.'); next.rooms.push({ id: roomId, name: data.name.trim(), floor: Number(data.floor), roomType: data.roomType, capacity: Number(data.capacity), status: 'Phòng trống', active: true, note: '' }); next.meta.revision += 1; return next; }, 'Đã thêm phòng.'); if (saved) closeModal(); }
  if (formId === 'rateEditForm') { await mutate((state) => { const next = deepClone(state); next.rates.forEach((rate, index) => { rate.weekday = Math.max(0, Number(data[`weekday_${index}`] || 0)); rate.weekend = Math.max(0, Number(data[`weekend_${index}`] || 0)); rate.overnight = Math.max(0, Number(data[`overnight_${index}`] || 0)); rate.hourlyFirst = Math.max(0, Number(data[`hourlyFirst_${index}`] || 0)); rate.hourlySecond = Math.max(0, Number(data[`hourlySecond_${index}`] || 0)); rate.hourlyThird = Math.max(0, Number(data[`hourlyThird_${index}`] || 0)); rate.hourlyFromFourth = Math.max(0, Number(data[`hourlyFromFourth_${index}`] || 0)); }); next.meta.revision += 1; next.meta.updatedAt = new Date().toISOString(); return next; }, 'Đã cập nhật bảng giá theo ngày, qua đêm và theo giờ.'); closeModal(); }
  if (formId === 'roomEditForm') {
    const saved = await mutate((state) => { const next = deepClone(state); const room = next.rooms.find((item) => item.id === data.id); if (!room) throw new Error('Không tìm thấy phòng.'); if (room.roomType !== data.roomType && room.status !== 'Phòng trống') throw new Error('Chỉ được đổi loại phòng khi phòng đang trống.'); room.name = String(data.name || '').trim(); room.floor = Number(data.floor || 1); room.roomType = data.roomType; room.capacity = Math.max(1, Number(data.capacity || 1)); if (!room.name) throw new Error('Tên phòng không được để trống.'); next.meta.revision += 1; next.meta.updatedAt = new Date().toISOString(); return next; }, 'Đã cập nhật phòng.'); if (saved) closeModal();
  }
  if (formId === 'serviceAddForm') { await mutate((state) => { const next = deepClone(state); const serviceId = String(data.id).trim().toUpperCase(); if (next.services.some((item) => item.id === serviceId)) throw new Error('Mã dịch vụ đã tồn tại.'); next.services.push({ id: serviceId, type: data.type, name: data.name.trim(), unit: data.unit.trim(), cost: Number(data.cost || 0), price: Number(data.price || 0), trackStock: data.type === 'Đồ giải khát', stock: Number(data.stock || 0), minStock: 0, active: true }); next.meta.revision += 1; return next; }, 'Đã thêm dịch vụ.'); closeModal(); }
  if (formId === 'serviceEditForm') {
    await mutate((state) => { const next = deepClone(state); const service = next.services.find((item) => item.id === data.id); if (!service) throw new Error('Không tìm thấy dịch vụ.'); service.type = data.type; service.name = String(data.name || '').trim(); service.unit = String(data.unit || '').trim(); service.cost = Math.max(0, Number(data.cost || 0)); service.price = Math.max(0, Number(data.price || 0)); service.minStock = Math.max(0, Number(data.minStock || 0)); service.trackStock = data.type === 'Đồ giải khát'; if (!service.name || !service.unit) throw new Error('Tên và đơn vị không được để trống.'); next.meta.revision += 1; next.meta.updatedAt = new Date().toISOString(); return next; }, 'Đã cập nhật danh mục dịch vụ.'); closeModal();
  }
});

$('#nav').addEventListener('click', () => {});
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('cancel', () => { ui.mapRoomId = null; });
function setDesktopMenuCollapsed(collapsed) {
  $('#app').classList.toggle('menu-collapsed', collapsed);
  const button = $('#sidebarToggle');
  if (button) {
    button.textContent = collapsed ? '›' : '‹';
    button.setAttribute('aria-label', collapsed ? 'Hiện menu' : 'Ẩn menu');
    button.title = collapsed ? 'Hiện menu' : 'Ẩn menu';
  }
  try { localStorage.setItem('hotel-menu-collapsed', collapsed ? '1' : '0'); } catch {}
}
$('#sidebarToggle').addEventListener('click', () => setDesktopMenuCollapsed(!$('#app').classList.contains('menu-collapsed')));
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
$('#loginForm').addEventListener('submit', async (event) => { event.preventDefault(); $('#loginError').textContent = ''; try { const result = await store.login($('#accessKeyInput').value); ui.state = result.state; $('#loginModal').close(); $('#app').classList.remove('hidden');
  try { setDesktopMenuCollapsed(localStorage.getItem('hotel-menu-collapsed') === '1'); } catch { setDesktopMenuCollapsed(false); } render(); } catch (error) { $('#loginError').textContent = error.message; } });

async function start() {
  const result = await store.load(); ui.state = result.state;
  $('#boot').classList.add('hidden'); $('#app').classList.remove('hidden');
  if (result.requiresLogin) $('#loginModal').showModal();
  render(); if (result.warning) toast(result.warning, true);
}

start().catch((error) => { $('#boot').innerHTML = `<strong>Không thể khởi động: ${esc(error.message)}</strong>`; });
