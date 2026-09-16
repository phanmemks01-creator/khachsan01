import fs from 'node:fs';

const appPath = 'src/app.js';
let app = fs.readFileSync(appPath, 'utf8');

function replaceRequired(text, from, to, label) {
  if (!text.includes(from)) throw new Error(`Không tìm thấy vùng cần sửa: ${label}`);
  return text.replace(from, to);
}

function functionBlock(text, name) {
  const start = text.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Không tìm thấy hàm ${name}`);
  const next = text.indexOf('\nfunction ', start + 1);
  if (next < 0) throw new Error(`Không tìm thấy điểm kết thúc hàm ${name}`);
  return { start, end: next, block: text.slice(start, next) };
}

function replaceFunction(text, name, nextBlock) {
  const current = functionBlock(text, name);
  return text.slice(0, current.start) + nextBlock + text.slice(current.end);
}

app = replaceRequired(
  app,
  "  roomFilter: { query: '', floor: '', status: '' }, finance: { from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) }",
  "  roomFilter: { query: '', floor: '', status: '' },\n  listFilters: {\n    bookings: { room: '', date: '', guest: '', phone: '' },\n    stays: { room: '', date: '', guest: '', phone: '' },\n    payments: { room: '', date: '', guest: '', phone: '' }\n  },\n  finance: { from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) }",
  'trạng thái bộ lọc'
);

if (!app.includes('function listFilterToolbar(')) {
  const marker = '\nfunction renderBookings() {';
  if (!app.includes(marker)) throw new Error('Không tìm thấy vị trí chèn helper bộ lọc.');
  const helpers = String.raw`
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
`;
  app = app.replace(marker, '\n' + helpers + '\nfunction renderBookings() {');
}

{
  const current = functionBlock(app, 'renderBookings').block;
  const next = replaceRequired(
    current,
    '<div class="section-head"><div><h2>Danh sách đặt phòng</h2><p>Mỗi phòng là một dòng; cùng đoàn dùng chung mã nhóm.</p></div></div>${bookingTable()}`;',
    '<div class="section-head"><div><h2>Danh sách đặt phòng</h2><p>Mỗi phòng là một dòng; cùng đoàn dùng chung mã nhóm. Tìm nhanh khách đã đặt theo phòng, ngày, tên hoặc số điện thoại.</p></div></div>${listFilterToolbar(\'bookings\', \'Ngày đặt / lưu trú\')}<div id="bookingListWrap">${bookingTable()}</div>`;',
    'toolbar đặt phòng'
  );
  app = replaceFunction(app, 'renderBookings', next);
}

{
  const current = functionBlock(app, 'bookingTable').block;
  const next = replaceRequired(current, 'const rows = ui.state.bookings.slice(0, 300);', 'const rows = filteredBookings().slice(0, 300);', 'lọc bảng đặt phòng');
  app = replaceFunction(app, 'bookingTable', next);
}

{
  const current = functionBlock(app, 'renderStays').block;
  let table = current.replace('function renderStays() {', 'function staysTable() {\n  const rows = filteredStays();');
  table = replaceRequired(table, '${ui.state.stays.map((item) =>', '${rows.map((item) =>', 'lọc bảng lưu trú');
  const render = "function renderStays() {\n  return `${listFilterToolbar('stays', 'Ngày lưu trú')}<div id=\"staysListWrap\">${staysTable()}</div>`;\n}";
  app = replaceFunction(app, 'renderStays', table + '\n\n' + render);
}

{
  const current = functionBlock(app, 'renderPayments').block;
  let content = current.replace('function renderPayments() {', 'function paymentsContent() {\n  const filteredInvoices = ui.state.invoices.filter(paymentFilterMatches);');
  content = replaceRequired(content, ".filter(([, invoices]) => invoices.length > 1).map(([groupId, invoices]) => {", ".filter(([, invoices]) => invoices.length > 1 && invoices.some(paymentFilterMatches)).map(([groupId, invoices]) => {", 'lọc nhóm thanh toán');
  content = replaceRequired(content, '${ui.state.invoices.map((item) =>', '${filteredInvoices.map((item) =>', 'lọc hóa đơn');
  const render = "function renderPayments() {\n  return `${listFilterToolbar('payments', 'Ngày hóa đơn')}<div id=\"paymentsListWrap\">${paymentsContent()}</div>`;\n}";
  app = replaceFunction(app, 'renderPayments', content + '\n\n' + render);
}

app = replaceRequired(
  app,
  "  if (action === 'filter-booking-type') { ui.booking.roomType = actionNode.dataset.type || ''; render(); }",
  "  if (action === 'filter-booking-type') { ui.booking.roomType = actionNode.dataset.type || ''; render(); }\n  if (action === 'clear-list-filter') {\n    const scope = actionNode.dataset.scope;\n    if (ui.listFilters[scope]) { ui.listFilters[scope] = { room: '', date: '', guest: '', phone: '' }; render(); }\n    return;\n  }",
  'nút xóa lọc'
);

app = replaceRequired(
  app,
  "  if (event.target.id === 'bookingQuery') { ui.booking.query = event.target.value; $('#bookingRoomGrid').innerHTML = bookingRoomCards(); }",
  "  if (event.target.id === 'bookingQuery') { ui.booking.query = event.target.value; $('#bookingRoomGrid').innerHTML = bookingRoomCards(); }\n  const listScope = event.target.dataset?.listFilterScope; const listKey = event.target.dataset?.listFilterKey;\n  if (listScope && listKey && ui.listFilters[listScope]) { ui.listFilters[listScope][listKey] = event.target.value; refreshListFilter(listScope); }",
  'lọc nhanh khi nhập'
);

fs.writeFileSync(appPath, app);
console.log('Đã thêm lọc nhanh Phòng / Ngày / Khách / SĐT cho Đặt phòng, Lưu trú và Thanh toán.');
