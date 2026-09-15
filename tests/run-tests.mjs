import assert from 'node:assert/strict';
import { createInitialState, validateState } from '../src/model.js';
import {
  addCharge, availableRooms, checkIn, checkOut, completeMaintenance, createBooking, createMaintenance,
  dashboard, financeReport, nights, payInvoice, receiveStock, refundSurplus, roomAvailable, updateHousekeeping
} from '../src/domain.js';
import healthHandler from '../api/health.js';
import stateHandler from '../api/state.js';

const tests = [];
async function test(name, action) { try { await action(); tests.push({ name, ok: true }); } catch (error) { tests.push({ name, ok: false, error }); } }

await test('Dữ liệu khởi tạo hợp lệ và đủ 20 phòng', () => {
  const state = createInitialState(); assert.equal(validateState(state), true); assert.equal(state.rooms.length, 20); assert.equal(state.rates.length, 3);
});
await test('Số đêm tối thiểu bằng 1', () => { assert.equal(nights('2026-09-07T14:00', '2026-09-07T18:00'), 1); assert.equal(nights('2026-09-07T14:00', '2026-09-09T14:00'), 2); });

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
  assert.equal(state.invoices.length, 1); assert.equal(state.invoices[0].total, 520000); assert.equal(state.invoices[0].due, 20000); assert.equal(state.rooms.find((room) => room.id === 'P01').status, 'Chờ vệ sinh');
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
await test('API health luôn trả cấu hình an toàn', async () => { const res = mockResponse(); await healthHandler({ method: 'GET' }, res); assert.equal(res.statusCode, 200); assert.equal(res.body.ok, true); assert.equal(typeof res.body.supabaseConfigured, 'boolean'); });
await test('API state chặn phương thức không hỗ trợ', async () => { const res = mockResponse(); await stateHandler({ method: 'DELETE', headers: {} }, res); assert.equal(res.statusCode, 405); });
await test('API state báo rõ khi chưa cấu hình Supabase', async () => { const res = mockResponse(); await stateHandler({ method: 'GET', headers: {} }, res); assert.equal(res.statusCode, 503); assert.equal(res.body.error, 'SUPABASE_NOT_CONFIGURED'); });

const failures = tests.filter((item) => !item.ok);
tests.forEach((item) => console.log(`${item.ok ? '✓' : '✗'} ${item.name}${item.ok ? '' : `: ${item.error.message}`}`));
console.log(`\nKẾT QUẢ: ${tests.length - failures.length}/${tests.length} kiểm thử đạt`);
if (failures.length) process.exit(1);
