import assert from 'node:assert/strict';
import { createInitialState, validateState } from '../src/model.js';
import {
  addCharge, adjustInvoice, availableRooms, checkIn, checkOut, completeMaintenance, createBooking, createMaintenance,
  dashboard, extendStay, financeReport, invoiceGroupId, nights, payInvoice, payInvoiceGroup, receiveStock, refundSurplus, roomAvailable,
  transferRoom, updateHousekeeping
} from '../src/domain.js';
import healthHandler from '../api/health.js';
import stateHandler from '../api/state.js';
import { HotelStore } from '../src/store.js';

const tests = [];
async function test(name, action) { try { await action(); tests.push({ name, ok: true }); } catch (error) { tests.push({ name, ok: false, error }); } }

await test('Dữ liệu khởi tạo hợp lệ và đủ 20 phòng', () => {
  const state = createInitialState(); assert.equal(validateState(state), true); assert.equal(state.rooms.length, 20); assert.equal(state.rates.length, 3); assert.equal(state.settings.financePinHash, '');
});
await test('Số đêm tối thiểu bằng 1', () => { assert.equal(nights('2026-09-07T14:00', '2026-09-07T18:00'), 1); assert.equal(nights('2026-09-07T14:00', '2026-09-09T14:00'), 2); });

await test('Giữ nguyên giá đã chốt dù bảng giá thay đổi', () => {
  let snapshotState = createInitialState();
  snapshotState = createBooking(snapshotState, { roomIds: ['P01'], guestName: 'Khách giữ giá', guestCount: 1, deposit: 0, arrival: '2026-09-07T14:00', departure: '2026-09-08T12:00' });
  const booking = snapshotState.bookings[0];
  snapshotState.rates.find((rate) => rate.roomType === 'Phòng đơn').weekday = 900000;
  snapshotState = checkIn(snapshotState, booking.id, '2026-09-07T14:00');
  snapshotState = checkOut(snapshotState, snapshotState.stays[0].id, { checkout: '2026-09-08T12:00' });
  assert.equal(snapshotState.invoices[0].roomAmount, 500000);
});

await test('Gia hạn kiểm tra lịch và lưu thêm giá từng đêm', () => {
  let extensionState = createInitialState();
  extensionState = createBooking(extensionState, { roomIds: ['P03'], guestName: 'Khách gia hạn', guestCount: 1, deposit: 0, arrival: '2026-09-07T14:00', departure: '2026-09-08T12:00' });
  extensionState = checkIn(extensionState, extensionState.bookings[0].id, '2026-09-07T14:00');
  extensionState = extendStay(extensionState, extensionState.stays[0].id, '2026-09-09T12:00');
  assert.equal(extensionState.stays[0].expectedCheckout, '2026-09-09T12:00');
  assert.equal(Object.keys(extensionState.stays[0].nightlyRates).length, 2);
});

await test('Chuyển phòng lưu lịch sử và đưa phòng cũ chờ vệ sinh', () => {
  let moveState = createInitialState();
  moveState = createBooking(moveState, { roomIds: ['P03'], guestName: 'Khách chuyển phòng', guestCount: 1, deposit: 0, arrival: '2026-09-07T14:00', departure: '2026-09-09T12:00' });
  moveState = checkIn(moveState, moveState.bookings[0].id, '2026-09-07T14:00');
  moveState = transferRoom(moveState, moveState.stays[0].id, 'P04', '2026-09-08T10:00', 'Khách yêu cầu');
  assert.equal(moveState.moves.length, 1);
  assert.equal(moveState.stays[0].roomId, 'P04');
  assert.equal(moveState.rooms.find((room) => room.id === 'P03').status, 'Chờ vệ sinh');
  assert.equal(moveState.rooms.find((room) => room.id === 'P04').status, 'Đang ở');
});

let state = createInitialState();
await test('Tìm phòng thông minh theo loại phòng không dấu', () => {
  const rooms = availableRooms(state, '2026-09-07T14:00', '2026-09-08T12:00', 'phong don'); assert.ok(rooms.length > 0); assert.ok(rooms.every((room) => room.roomType === 'Phòng đơn'));
});
await test('Một khách đặt nhiều phòng và tiền cọc không nhân đôi', () => {
  state = createBooking(state, { roomIds: ['P01', 'P02'], guestName: 'Khách thử nghiệm', phone: '0900000000', guestCount: 1, deposit: 1300000, arrival: '2026-09-07T14:00', departure: '2026-09-08T12:00', channel: 'Trực tiếp' });
  const rows = state.bookings.filter((item) => item.phone === '0900000000'); assert.equal(rows.length, 2); assert.equal(new Set(rows.map((item) => item.groupId)).size, 1); assert.equal(rows.reduce((sum, item) => sum + item.deposit, 0), 1300000);
});
await test('Chặn đặt trùng lịch cùng phòng', () => { assert.equal(roomAvailable(state, 'P02', '2026-09-07T15:00', '2026-09-08T10:00'), false); });
await test('Nhận phòng và đổi trạng thái phòng', () => {
  const booking = state.bookings.find((item) => item.roomId === 'P01'); state = checkIn(state, booking.id, '2026-09-07T14:00');
  assert.equal(state.stays[0].status, 'Đang ở'); assert.equal(state.rooms.find((room) => room.id === 'P01').status, 'Đang ở');
});
await test('Ghi đồ giải khát tự trừ tồn kho', () => {
  const stay = state.stays.find((item) => item.roomId === 'P01'); state = addCharge(state, { stayId: stay.id, serviceId: 'NUOC_500', quantity: 2 });
  assert.equal(state.services.find((item) => item.id === 'NUOC_500').stock, 98); assert.equal(state.charges[0].amount, 20000);
});
await test('Trả phòng tạo hóa đơn và công việc vệ sinh', () => {
  const stay = state.stays.find((item) => item.roomId === 'P01'); state = checkOut(state, stay.id, { checkout: '2026-09-08T12:00' });
  assert.equal(state.invoices.length, 1); assert.equal(state.invoices[0].total, 520000); assert.equal(state.invoices[0].due, 20000); assert.ok(state.invoices[0].groupId); assert.equal(state.invoices[0].roomHistory.at(-1).to, '2026-09-08T12:00'); assert.equal(state.rooms.find((room) => room.id === 'P01').status, 'Chờ vệ sinh');
});

await test('Điều chỉnh hóa đơn tại Thanh toán giữ phụ thu và giảm tiền', () => {
  let paymentState = createInitialState();
  paymentState = createBooking(paymentState, { roomIds: ['P01'], guestName: 'Khách điều chỉnh hóa đơn', guestCount: 1, deposit: 0, arrival: '2026-09-07T14:00', departure: '2026-09-08T12:00' });
  paymentState = checkIn(paymentState, paymentState.bookings[0].id, '2026-09-07T14:00');
  paymentState = checkOut(paymentState, paymentState.stays[0].id, { checkout: '2026-09-08T12:00' });
  const invoiceId = paymentState.invoices[0].id;
  assert.equal(paymentState.invoices[0].surcharge, 0);
  assert.equal(paymentState.invoices[0].discount, 0);
  paymentState = adjustInvoice(paymentState, invoiceId, { surcharge: 100000, discount: 50000, discountReason: 'Ưu đãi khách hàng' });
  assert.equal(paymentState.invoices[0].surcharge, 100000);
  assert.equal(paymentState.invoices[0].discount, 50000);
  assert.equal(paymentState.invoices[0].total, 550000);
  assert.equal(paymentState.invoices[0].due, 550000);
  assert.equal(paymentState.invoiceLines.find((line) => line.invoiceId === invoiceId && line.type === 'Tiền phòng').amount, 500000);
  assert.throws(() => adjustInvoice(paymentState, invoiceId, { discount: 60000, discountReason: '' }), /Giảm tiền phải có lý do/);
});

await test('Trả phòng chặn thời gian trước lúc nhận và không tạo hóa đơn trùng', () => {
  let checkoutState = createInitialState();
  checkoutState = createBooking(checkoutState, { roomIds: ['P05'], guestName: 'Khách kiểm tra trả phòng', guestCount: 1, deposit: 0, arrival: '2026-09-07T14:00', departure: '2026-09-08T12:00' });
  checkoutState = checkIn(checkoutState, checkoutState.bookings[0].id, '2026-09-07T14:00');
  assert.throws(() => checkOut(checkoutState, checkoutState.stays[0].id, { checkout: '2026-09-07T13:00' }), /không được trước/);
  checkoutState = checkOut(checkoutState, checkoutState.stays[0].id, { checkout: '2026-09-08T12:00' });
  assert.throws(() => checkOut(checkoutState, checkoutState.stays[0].id, { checkout: '2026-09-08T12:00' }), /không hợp lệ/);
});
await test('Một người thanh toán gộp nhiều phòng và vẫn giữ hóa đơn riêng', () => {
  let groupState = createInitialState();
  groupState = createBooking(groupState, { roomIds: ['P01', 'P02'], guestName: 'Khách thanh toán gộp', phone: '0911000000', guestCount: 1, deposit: 0, arrival: '2026-09-07T14:00', departure: '2026-09-08T12:00' });
  const bookings = groupState.bookings.filter((item) => item.phone === '0911000000');
  bookings.forEach((booking) => { groupState = checkIn(groupState, booking.id, '2026-09-07T14:00'); });
  [...groupState.stays].forEach((stay) => { groupState = checkOut(groupState, stay.id, { checkout: '2026-09-08T12:00' }); });
  const groupId = bookings[0].groupId;
  const invoices = groupState.invoices.filter((invoice) => invoiceGroupId(groupState, invoice) === groupId);
  assert.equal(invoices.length, 2);
  groupState = payInvoiceGroup(groupState, invoices.map((invoice) => invoice.id), { amount: 900000, method: 'Chuyển khoản', note: 'Thu một lần cho đoàn' });
  const updated = groupState.invoices.filter((invoice) => invoiceGroupId(groupState, invoice) === groupId);
  assert.equal(updated.reduce((sum, invoice) => sum + invoice.paid, 0), 900000);
  assert.equal(updated.reduce((sum, invoice) => sum + invoice.due, 0), 400000);
  const groupReceipts = groupState.receipts.filter((receipt) => receipt.bookingGroupId === groupId);
  assert.ok(groupReceipts.length >= 1); assert.equal(new Set(groupReceipts.map((receipt) => receipt.paymentGroupId)).size, 1);
  assert.equal(new Set(updated.map((invoice) => invoice.id)).size, 2);
});
await test('Thu dư, hoàn tiền thừa rồi khóa hóa đơn', () => {
  const invoice = state.invoices[0]; state = payInvoice(state, invoice.id, { amount: 30000, method: 'Tiền mặt' }); assert.equal(state.invoices[0].surplus, 10000); assert.equal(state.invoices[0].status, 'Chờ thanh toán');
  state = refundSurplus(state, invoice.id); assert.equal(state.invoices[0].surplus, 0); assert.equal(state.invoices[0].status, 'Đã thanh toán');
});
await test('Hoàn thành vệ sinh mới mở lại phòng', () => {
  const task = state.housekeeping.find((item) => item.roomId === 'P01'); state = updateHousekeeping(state, task.id, 'Hoàn thành'); assert.equal(state.rooms.find((room) => room.id === 'P01').status, 'Phòng trống');
});
await test('Bảo trì khóa phòng đến khi hoàn thành', () => {
  state = createMaintenance(state, 'P03', 'Kiểm tra điều hòa', 'Ưu tiên'); assert.equal(state.rooms.find((room) => room.id === 'P03').status, 'Bảo trì');
  state = completeMaintenance(state, state.maintenance[0].id); assert.equal(state.rooms.find((room) => room.id === 'P03').status, 'Phòng trống');
});
await test('Nhập kho tăng tồn và ghi lịch sử', () => {
  const before = state.services.find((item) => item.id === 'NUOC_500').stock; state = receiveStock(state, { serviceId: 'NUOC_500', quantity: 10, cost: 6000, supplier: 'Nhà cung cấp thử' }); assert.equal(state.services.find((item) => item.id === 'NUOC_500').stock, before + 10); assert.equal(state.stockIns.length, 1);
});
await test('Dashboard và báo cáo tài chính tính đúng doanh thu', () => {
  const report = financeReport(state, '2026-01-01', '2026-12-31'); assert.equal(report.invoiceCount, 1); assert.equal(report.revenue, 520000); assert.ok(dashboard(state).totalRooms === 20);
});

function mockResponse() { return { statusCode: 0, headers: {}, body: null, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return value; } }; }
await test('API health luôn trả cấu hình an toàn', async () => { const res = mockResponse(); await healthHandler({ method: 'GET', query: {} }, res); assert.equal(res.statusCode, 200); assert.equal(res.body.ok, true); assert.equal(typeof res.body.supabaseConfigured, 'boolean'); assert.ok(['not_configured', 'not_checked'].includes(res.body.databaseStatus)); });
await test('API state chặn phương thức không hỗ trợ', async () => { const res = mockResponse(); await stateHandler({ method: 'DELETE', headers: {} }, res); assert.equal(res.statusCode, 405); });
await test('API state báo rõ khi chưa cấu hình Supabase', async () => { const res = mockResponse(); await stateHandler({ method: 'GET', headers: {} }, res); assert.equal(res.statusCode, 503); assert.equal(res.body.error, 'SUPABASE_NOT_CONFIGURED'); });
await test('API từ chối chạy Supabase khi thiếu APP_ACCESS_KEY an toàn', async () => {
  const previous = { url: process.env.SUPABASE_URL, secret: process.env.SUPABASE_SECRET_KEY, access: process.env.APP_ACCESS_KEY };
  process.env.SUPABASE_URL = 'https://example.supabase.co'; process.env.SUPABASE_SECRET_KEY = `sb_secret_${'x'.repeat(32)}`; delete process.env.APP_ACCESS_KEY;
  try { const res = mockResponse(); await stateHandler({ method: 'GET', headers: {} }, res); assert.equal(res.statusCode, 503); assert.equal(res.body.error, 'ACCESS_KEY_NOT_CONFIGURED'); }
  finally {
    if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
    if (previous.secret === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = previous.secret;
    if (previous.access === undefined) delete process.env.APP_ACCESS_KEY; else process.env.APP_ACCESS_KEY = previous.access;
  }
});
await test('Kho dữ liệu khởi tạo Supabase trống bằng bản cục bộ đầu tiên', async () => {
  const memory = new Map(); const calls = [];
  const storage = { getItem: (key) => memory.get(key) || null, setItem: (key, value) => memory.set(key, String(value)), removeItem: (key) => memory.delete(key) };
  const previous = { localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage, fetch: globalThis.fetch };
  globalThis.localStorage = storage; globalThis.sessionStorage = storage; storage.setItem('hotel-manager-pro-access-key', 'test-access-key');
  globalThis.fetch = async (path, options = {}) => {
    calls.push({ path, method: options.method || 'GET' });
    if ((options.method || 'GET') === 'GET') return { status: 200, ok: true, json: async () => ({ ok: true, state: null, version: 0 }) };
    return { status: 200, ok: true, json: async () => ({ ok: true, version: 1, updatedAt: new Date().toISOString() }) };
  };
  try {
    const testStore = new HotelStore(); const result = await testStore.load();
    assert.equal(testStore.mode, 'supabase'); assert.equal(result.state.rooms.length, 20); assert.equal(calls.some((call) => call.method === 'POST'), true); assert.equal(testStore.version, 1);
  } finally {
    globalThis.localStorage = previous.localStorage; globalThis.sessionStorage = previous.sessionStorage; globalThis.fetch = previous.fetch;
  }
});

const failures = tests.filter((item) => !item.ok);
tests.forEach((item) => console.log(`${item.ok ? '✓' : '✗'} ${item.name}${item.ok ? '' : `: ${item.error.message}`}`));
console.log(`\nKẾT QUẢ: ${tests.length - failures.length}/${tests.length} kiểm thử đạt`);
if (failures.length) process.exit(1);
