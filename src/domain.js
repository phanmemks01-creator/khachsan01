import { ACTIVE_BOOKING_STATUSES, deepClone, id } from './model.js';

const money = (value) => Math.max(0, Math.round(Number(value || 0) || 0));
const asDate = (value) => value instanceof Date ? value : new Date(value);
const overlap = (aStart, aEnd, bStart, bEnd) => asDate(aStart) < asDate(bEnd) && asDate(aEnd) > asDate(bStart);

export function nights(start, end) {
  const diff = asDate(end).getTime() - asDate(start).getTime();
  if (!Number.isFinite(diff) || diff <= 0) return 1;
  return Math.max(1, Math.ceil(diff / 86400000));
}

export function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
}

export function roomRate(state, room, at = new Date()) {
  const rate = state.rates.find((item) => item.active && item.roomType === room.roomType);
  if (!rate) return 0;
  const day = asDate(at).getDay();
  return money(day === 0 || day === 6 ? rate.weekend : rate.weekday);
}

function nightlyRateSnapshot(state, room, start, end, existing = {}) {
  const snapshot = { ...existing };
  const first = asDate(start);
  for (let index = 0; index < nights(start, end); index += 1) {
    const date = new Date(first.getTime() + index * 86400000);
    const key = date.toISOString().slice(0, 10);
    if (snapshot[key] === undefined) snapshot[key] = roomRate(state, room, date);
  }
  return snapshot;
}

export function roomAvailable(state, roomId, start, end, ignoreBookingId = '', ignoreStayId = '') {
  const room = state.rooms.find((item) => item.id === roomId && item.active);
  if (!room || ['Bảo trì', 'Tạm khóa'].includes(room.status)) return false;
  const bookingConflict = state.bookings.some((booking) => booking.id !== ignoreBookingId && booking.roomId === roomId && ACTIVE_BOOKING_STATUSES.includes(booking.status) && overlap(start, end, booking.arrival, booking.departure));
  const stayConflict = state.stays.some((stay) => stay.id !== ignoreStayId && stay.roomId === roomId && stay.status === 'Đang ở' && overlap(start, end, stay.checkIn, stay.expectedCheckout));
  const maintenance = state.maintenance.some((item) => item.roomId === roomId && !['Hoàn thành', 'Đã hủy'].includes(item.status));
  return !bookingConflict && !stayConflict && !maintenance;
}

export function availableRooms(state, start, end, query = '', filters = {}) {
  const keyword = normalize(query);
  return state.rooms.filter((room) => {
    const text = normalize([room.id, room.name, room.floor, room.roomType].join(' '));
    return room.active && (!keyword || text.includes(keyword)) && (!filters.floor || String(room.floor) === String(filters.floor)) && (!filters.roomType || room.roomType === filters.roomType) && (!filters.capacity || room.capacity >= Number(filters.capacity)) && roomAvailable(state, room.id, start, end);
  });
}

function audit(state, action, object, objectId, detail = '') {
  state.audit.unshift({ id: id('LOG'), at: new Date().toISOString(), user: 'Web App', action, object, objectId, detail });
  state.audit = state.audit.slice(0, 3000);
}

function touch(state) {
  state.meta.updatedAt = new Date().toISOString();
  state.meta.revision = Number(state.meta.revision || 0) + 1;
  return state;
}

function findOrCreateGuest(state, name, phone = '') {
  let guest = state.guests.find((item) => phone && item.phone === phone);
  if (!guest) {
    guest = { id: id('KH'), name: String(name).trim(), phone: String(phone).trim(), email: '', document: '', nationality: '', address: '', note: '' };
    state.guests.push(guest);
  } else if (name) guest.name = String(name).trim();
  return guest;
}

export function createBooking(current, payload) {
  const state = deepClone(current);
  const roomIds = [...new Set(payload.roomIds || [])];
  if (!payload.guestName?.trim()) throw new Error('Vui lòng nhập tên khách.');
  if (!roomIds.length) throw new Error('Vui lòng chọn ít nhất một phòng.');
  if (asDate(payload.departure) <= asDate(payload.arrival)) throw new Error('Ngày trả phải sau ngày nhận.');
  roomIds.forEach((roomId) => {
    if (!roomAvailable(state, roomId, payload.arrival, payload.departure)) throw new Error(`Phòng ${roomId} không còn trống trong khoảng đã chọn.`);
  });
  const guest = findOrCreateGuest(state, payload.guestName, payload.phone);
  const groupId = id('NHOM');
  const weights = roomIds.map((roomId) => roomRate(state, state.rooms.find((room) => room.id === roomId), payload.arrival));
  const weightTotal = Math.max(1, weights.reduce((sum, value) => sum + value, 0));
  let distributed = 0;
  roomIds.forEach((roomId, index) => {
    const room = state.rooms.find((item) => item.id === roomId);
    const expectedRate = weights[index];
    const nightlyRates = nightlyRateSnapshot(state, room, payload.arrival, payload.departure);
    const deposit = index === roomIds.length - 1 ? money(payload.deposit) - distributed : Math.round(money(payload.deposit) * expectedRate / weightTotal);
    distributed += deposit;
    const booking = {
      id: id('DP'), groupId, createdAt: new Date().toISOString(), arrival: payload.arrival, departure: payload.departure,
      nights: nights(payload.arrival, payload.departure), roomId, roomType: room.roomType, rateId: state.rates.find((rate) => rate.roomType === room.roomType)?.id || '',
      expectedRate, nightlyRates, guestId: guest.id, guestName: guest.name, phone: guest.phone, guestCount: Math.max(1, Number(payload.guestCount || 1)),
      deposit: money(deposit), status: 'Đã xác nhận', channel: payload.channel || 'Trực tiếp', note: payload.note || ''
    };
    if (booking.guestCount > room.capacity) throw new Error(`${room.name} chỉ chứa tối đa ${room.capacity} khách.`);
    state.bookings.unshift(booking);
    room.status = 'Đã đặt';
  });
  audit(state, 'Tạo đặt phòng', 'DAT_PHONG', groupId, `${guest.name} · ${roomIds.join(', ')}`);
  return touch(state);
}

export function cancelBooking(current, bookingId) {
  const state = deepClone(current);
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking || booking.status === 'Đã nhận phòng') throw new Error('Phiếu đặt không thể hủy.');
  booking.status = 'Đã hủy';
  refreshRoomStatus(state, booking.roomId);
  audit(state, 'Hủy đặt phòng', 'DAT_PHONG', bookingId, booking.roomId);
  return touch(state);
}

export function checkIn(current, bookingId, actualCheckIn = new Date().toISOString()) {
  const state = deepClone(current);
  const booking = state.bookings.find((item) => item.id === bookingId);
  if (!booking || !['Chờ xác nhận', 'Đã xác nhận'].includes(booking.status)) throw new Error('Phiếu đặt không hợp lệ để nhận phòng.');
  if (state.stays.some((stay) => stay.roomId === booking.roomId && stay.status === 'Đang ở')) throw new Error('Phòng đang có khách.');
  const room = state.rooms.find((item) => item.id === booking.roomId);
  if (!room || ['Bảo trì', 'Tạm khóa', 'Chờ vệ sinh'].includes(room.status)) throw new Error('Phòng chưa sẵn sàng nhận khách.');
  const stay = {
    id: id('LT'), bookingId: booking.id, roomId: room.id, roomType: room.roomType, rateId: booking.rateId,
    guestId: booking.guestId, guestName: booking.guestName, phone: booking.phone, guestCount: booking.guestCount,
    checkIn: actualCheckIn, expectedCheckout: booking.departure, checkout: '', nights: 1, averageRate: booking.expectedRate,
    nightlyRates: { ...(booking.nightlyRates || nightlyRateSnapshot(state, room, booking.arrival, booking.departure)) },
    roomHistory: [{ roomId: room.id, roomType: room.roomType, from: actualCheckIn, to: '' }],
    roomAmount: 0, surcharge: 0, deposit: booking.deposit, status: 'Đang ở', note: booking.note || ''
  };
  state.stays.unshift(stay);
  booking.status = 'Đã nhận phòng';
  room.status = 'Đang ở';
  audit(state, 'Nhận phòng', 'LUU_TRU', stay.id, room.id);
  return touch(state);
}

export function extendStay(current, stayId, newCheckout) {
  const state = deepClone(current);
  const stay = state.stays.find((item) => item.id === stayId && item.status === 'Đang ở');
  if (!stay) throw new Error('Không tìm thấy lượt lưu trú đang hoạt động.');
  if (asDate(newCheckout) <= asDate(stay.expectedCheckout)) throw new Error('Thời gian gia hạn phải sau thời gian trả hiện tại.');
  if (!roomAvailable(state, stay.roomId, stay.expectedCheckout, newCheckout, '', stay.id)) throw new Error(`Phòng ${stay.roomId} đã có lịch tiếp theo, không thể gia hạn.`);
  const room = state.rooms.find((item) => item.id === stay.roomId);
  stay.nightlyRates = nightlyRateSnapshot(state, room, stay.checkIn, newCheckout, stay.nightlyRates || {});
  stay.expectedCheckout = newCheckout;
  const booking = state.bookings.find((item) => item.id === stay.bookingId);
  if (booking) {
    booking.departure = newCheckout;
    booking.nights = nights(booking.arrival, newCheckout);
    booking.nightlyRates = { ...stay.nightlyRates };
  }
  audit(state, 'Gia hạn lưu trú', 'LUU_TRU', stay.id, `${stay.roomId} → ${newCheckout}`);
  return touch(state);
}

export function transferRoom(current, stayId, newRoomId, movedAt = new Date().toISOString(), reason = '') {
  const state = deepClone(current);
  const stay = state.stays.find((item) => item.id === stayId && item.status === 'Đang ở');
  if (!stay) throw new Error('Không tìm thấy lượt lưu trú đang hoạt động.');
  if (stay.roomId === newRoomId) throw new Error('Phòng chuyển đến phải khác phòng hiện tại.');
  if (asDate(movedAt) < asDate(stay.checkIn) || asDate(movedAt) >= asDate(stay.expectedCheckout)) throw new Error('Thời gian chuyển phòng phải nằm trong thời gian lưu trú.');
  const oldRoom = state.rooms.find((item) => item.id === stay.roomId);
  const newRoom = state.rooms.find((item) => item.id === newRoomId && item.active);
  if (!newRoom || !roomAvailable(state, newRoomId, movedAt, stay.expectedCheckout)) throw new Error('Phòng chuyển đến không còn trống trong thời gian lưu trú còn lại.');
  const previousRoomId = stay.roomId;
  const history = Array.isArray(stay.roomHistory) && stay.roomHistory.length
    ? stay.roomHistory
    : [{ roomId: previousRoomId, roomType: stay.roomType, from: stay.checkIn, to: '' }];
  history[history.length - 1].to = movedAt;
  history.push({ roomId: newRoom.id, roomType: newRoom.roomType, from: movedAt, to: '' });
  stay.roomHistory = history;
  stay.nightlyRates = nightlyRateSnapshot(state, newRoom, movedAt, stay.expectedCheckout, stay.nightlyRates || {});
  for (const [date, rate] of Object.entries(nightlyRateSnapshot(state, newRoom, movedAt, stay.expectedCheckout))) stay.nightlyRates[date] = rate;
  stay.roomId = newRoom.id;
  stay.roomType = newRoom.roomType;
  stay.rateId = state.rates.find((item) => item.active && item.roomType === newRoom.roomType)?.id || '';
  stay.averageRate = roomRate(state, newRoom, movedAt);
  state.moves.unshift({ id: id('CP'), stayId: stay.id, bookingId: stay.bookingId, guestName: stay.guestName, fromRoomId: previousRoomId, toRoomId: newRoom.id, movedAt, reason: String(reason || '').trim(), oldRate: roomRate(state, oldRoom, movedAt), newRate: stay.averageRate });
  oldRoom.status = 'Chờ vệ sinh';
  newRoom.status = 'Đang ở';
  state.housekeeping.unshift({ id: id('VS'), createdAt: movedAt, roomId: previousRoomId, type: 'Vệ sinh sau chuyển phòng', priority: 'Ưu tiên', status: 'Chờ xử lý', assignee: '', startedAt: '', completedAt: '', note: reason || '' });
  audit(state, 'Chuyển phòng', 'CHUYEN_PHONG', stay.id, `${previousRoomId} → ${newRoom.id}${reason ? ` · ${reason}` : ''}`);
  return touch(state);
}

export function addCharge(current, payload) {
  const state = deepClone(current);
  const stay = state.stays.find((item) => item.id === payload.stayId && item.status === 'Đang ở');
  const service = state.services.find((item) => item.id === payload.serviceId && item.active);
  const quantity = Math.max(1, Math.round(Number(payload.quantity || 1)));
  if (!stay) throw new Error('Không tìm thấy lượt lưu trú đang hoạt động.');
  if (!service) throw new Error('Dịch vụ không hợp lệ.');
  if (service.trackStock && Number(service.stock || 0) < quantity) throw new Error(`${service.name} không đủ tồn kho.`);
  const charge = {
    id: id('PS'), at: new Date().toISOString(), stayId: stay.id, roomId: stay.roomId, type: service.type,
    serviceId: service.id, name: service.name, unit: service.unit, quantity, unitPrice: money(service.price),
    amount: money(service.price) * quantity, status: 'Chưa lập hóa đơn', invoiceId: '', note: payload.note || ''
  };
  state.charges.unshift(charge);
  if (service.trackStock) {
    service.stock = Number(service.stock || 0) - quantity;
    state.stockOuts.unshift({ id: id('XK'), at: charge.at, serviceId: service.id, name: service.name, quantity, reason: 'Phát sinh lưu trú', stayId: stay.id });
  }
  audit(state, 'Ghi phát sinh', 'PHAT_SINH', charge.id, `${stay.roomId} · ${service.name} × ${quantity}`);
  return touch(state);
}

export function receiveStock(current, payload) {
  const state = deepClone(current);
  const service = state.services.find((item) => item.id === payload.serviceId && item.trackStock);
  const quantity = Math.max(1, Math.round(Number(payload.quantity || 0)));
  if (!service) throw new Error('Mặt hàng không theo dõi tồn kho.');
  service.stock = Number(service.stock || 0) + quantity;
  if (payload.cost !== undefined && payload.cost !== '') service.cost = money(payload.cost);
  state.stockIns.unshift({ id: id('NK'), at: new Date().toISOString(), serviceId: service.id, name: service.name, quantity, cost: service.cost, amount: service.cost * quantity, supplier: payload.supplier || '' });
  audit(state, 'Nhập kho', 'NHAP_KHO', service.id, `${service.name} × ${quantity}`);
  return touch(state);
}

function calculateRoomAmount(state, stay, checkout) {
  const start = asDate(stay.checkIn);
  const count = nights(start, checkout);
  const room = state.rooms.find((item) => item.id === stay.roomId);
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const date = new Date(start.getTime() + index * 86400000);
    const key = date.toISOString().slice(0, 10);
    total += money(stay.nightlyRates?.[key] ?? roomRate(state, room, date));
  }
  return { count, total, average: count ? Math.round(total / count) : 0 };
}

export function checkOut(current, stayId, options = {}) {
  const state = deepClone(current);
  const stay = state.stays.find((item) => item.id === stayId && item.status === 'Đang ở');
  if (!stay) throw new Error('Lượt lưu trú không hợp lệ để trả phòng.');
  const checkout = options.checkout || new Date().toISOString();
  if (!Number.isFinite(asDate(checkout).getTime())) throw new Error('Thời gian trả phòng không hợp lệ.');
  if (asDate(checkout) < asDate(stay.checkIn)) throw new Error('Thời gian trả phòng không được trước thời gian nhận phòng.');
  if (state.invoices.some((item) => item.stayId === stay.id && item.status !== 'Đã hủy')) throw new Error('Lượt lưu trú này đã có hóa đơn, không thể lập trùng.');
  const booking = state.bookings.find((item) => item.id === stay.bookingId);
  const roomCalculation = calculateRoomAmount(state, stay, checkout);
  const charges = state.charges.filter((item) => item.stayId === stay.id && item.status === 'Chưa lập hóa đơn');
  const serviceAmount = charges.reduce((sum, item) => sum + money(item.amount), 0);
  // Phụ thu/giảm tiền được xử lý tại bước Thanh toán, không xử lý tại Trả phòng.
  const surcharge = 0;
  const discount = 0;
  const subtotal = roomCalculation.total + serviceAmount + surcharge - discount;
  const serviceFee = Math.round(Math.max(0, subtotal) * Number(state.settings.serviceFeeRate || 0));
  const vat = Math.round(Math.max(0, subtotal + serviceFee) * Number(state.settings.vatRate || 0));
  const total = Math.max(0, subtotal + serviceFee + vat);
  const initialDue = Math.max(0, total - money(stay.deposit));
  const initialSurplus = Math.max(0, money(stay.deposit) - total);
  const initiallyPaid = initialDue === 0 && initialSurplus === 0;
  const finalRoomHistory = deepClone(stay.roomHistory || []);
  if (finalRoomHistory.length) finalRoomHistory[finalRoomHistory.length - 1].to = checkout;
  const invoice = {
    id: id('HD'), createdAt: new Date().toISOString(), stayId: stay.id, bookingId: stay.bookingId,
    groupId: booking?.groupId || '', guestId: stay.guestId || booking?.guestId || '', phone: stay.phone || booking?.phone || '',
    roomId: stay.roomId, roomHistory: finalRoomHistory, guestName: stay.guestName,
    checkIn: stay.checkIn, checkout, nights: roomCalculation.count, averageRate: roomCalculation.average,
    roomAmount: roomCalculation.total, serviceAmount, surcharge, discount, discountReason: '', roomAdjustmentReason: '',
    serviceFee, vat, total, deposit: money(stay.deposit), paid: 0, refunded: 0,
    due: initialDue, surplus: initialSurplus,
    status: initiallyPaid ? 'Đã thanh toán' : 'Chờ thanh toán', paidAt: initiallyPaid ? new Date().toISOString() : '', lastMethod: initiallyPaid ? 'Tiền cọc' : '', note: options.note || ''
  };
  state.invoices.unshift(invoice);
  const roomLabel = (stay.roomHistory || []).map((item) => item.roomId).filter((value, index, values) => values.indexOf(value) === index).join(' → ') || stay.roomId;
  state.invoiceLines.push({ invoiceId: invoice.id, type: 'Tiền phòng', itemId: stay.roomId, name: `Tiền phòng ${roomLabel}`, unit: 'Đêm', quantity: roomCalculation.count, unitPrice: roomCalculation.average, amount: roomCalculation.total, note: '' });
  charges.forEach((charge) => {
    charge.status = 'Đã lập hóa đơn'; charge.invoiceId = invoice.id;
    state.invoiceLines.push({ invoiceId: invoice.id, type: charge.type, itemId: charge.serviceId, name: charge.name, unit: charge.unit, quantity: charge.quantity, unitPrice: charge.unitPrice, amount: charge.amount, note: charge.note });
  });
  if (finalRoomHistory.length) stay.roomHistory = deepClone(finalRoomHistory);
  stay.checkout = checkout; stay.nights = roomCalculation.count; stay.averageRate = roomCalculation.average; stay.roomAmount = roomCalculation.total; stay.status = 'Đã trả phòng';
  if (booking) booking.status = 'Đã trả phòng';
  const room = state.rooms.find((item) => item.id === stay.roomId); if (room) room.status = 'Chờ vệ sinh';
  state.housekeeping.unshift({ id: id('VS'), createdAt: new Date().toISOString(), roomId: stay.roomId, type: 'Vệ sinh sau trả phòng', priority: 'Thường', status: 'Chờ xử lý', assignee: '', startedAt: '', completedAt: '', note: '' });
  audit(state, 'Trả phòng và lập hóa đơn', 'HOA_DON', invoice.id, `${stay.roomId} · ${invoice.total}`);
  return touch(state);
}

export function invoiceGroupId(state, invoice) {
  if (invoice?.groupId) return invoice.groupId;
  const stay = state.stays.find((item) => item.id === invoice?.stayId);
  const booking = state.bookings.find((item) => item.id === (invoice?.bookingId || stay?.bookingId));
  return booking?.groupId || `DON-${invoice?.id || 'KHONG_MA'}`;
}

function refreshInvoicePayment(invoice) {
  const available = money(invoice.deposit) + money(invoice.paid) - money(invoice.refunded);
  invoice.due = Math.max(0, money(invoice.total) - available);
  invoice.surplus = Math.max(0, available - money(invoice.total));
  if (invoice.due === 0 && invoice.surplus === 0) {
    invoice.status = 'Đã thanh toán';
    invoice.paidAt ||= new Date().toISOString();
  } else {
    invoice.status = 'Chờ thanh toán';
    invoice.paidAt = '';
  }
}

export function adjustInvoice(current, invoiceId, payload = {}) {
  const state = deepClone(current);
  const invoice = state.invoices.find((item) => item.id === invoiceId && item.status !== 'Đã hủy');
  if (!invoice) throw new Error('Không tìm thấy hóa đơn.');
  if (money(invoice.paid) > 0) throw new Error('Hóa đơn đã phát sinh thanh toán. Không thể sửa tiền phòng/phụ thu/giảm tiền.');

  const oldRoomAmount = money(invoice.roomAmount);
  const roomAmount = payload.roomAmount === undefined || payload.roomAmount === '' ? oldRoomAmount : money(payload.roomAmount);
  const surcharge = money(payload.surcharge ?? invoice.surcharge);
  const discount = money(payload.discount ?? invoice.discount);
  const roomAdjustmentReason = String(payload.roomAdjustmentReason ?? invoice.roomAdjustmentReason ?? '').trim();
  const discountReason = String(payload.discountReason ?? invoice.discountReason ?? '').trim();

  if (roomAmount !== oldRoomAmount && !roomAdjustmentReason) throw new Error('Khi sửa tiền phòng, vui lòng nhập lý do điều chỉnh giá phòng.');
  if (discount > 0 && !discountReason) throw new Error('Giảm tiền phải có lý do.');

  const subtotal = Math.max(0, roomAmount + money(invoice.serviceAmount) + surcharge - discount);
  const serviceFee = Math.round(subtotal * Number(state.settings.serviceFeeRate || 0));
  const vat = Math.round((subtotal + serviceFee) * Number(state.settings.vatRate || 0));
  const total = Math.max(0, subtotal + serviceFee + vat);

  invoice.roomAmount = roomAmount;
  invoice.surcharge = surcharge;
  invoice.discount = discount;
  invoice.discountReason = discountReason;
  invoice.roomAdjustmentReason = roomAdjustmentReason;
  invoice.serviceFee = serviceFee;
  invoice.vat = vat;
  invoice.total = total;

  const roomLine = state.invoiceLines.find((line) => line.invoiceId === invoice.id && line.type === 'Tiền phòng');
  if (roomLine) {
    roomLine.amount = roomAmount;
    roomLine.unitPrice = invoice.nights ? Math.round(roomAmount / invoice.nights) : roomAmount;
    roomLine.note = roomAdjustmentReason;
  }
  refreshInvoicePayment(invoice);
  audit(state, 'Điều chỉnh hóa đơn tại thanh toán', 'HOA_DON', invoice.id,
    'Tiền phòng ' + roomAmount + ' · Phụ thu ' + surcharge + ' · Giảm ' + discount);
  return touch(state);
}

export function payInvoice(current, invoiceId, payload) {
  const state = deepClone(current);
  const invoice = state.invoices.find((item) => item.id === invoiceId && item.status !== 'Đã hủy');
  if (!invoice) throw new Error('Không tìm thấy hóa đơn.');
  const amount = money(payload.amount);
  if (!amount) throw new Error('Số tiền thu phải lớn hơn 0.');
  state.receipts.unshift({ id: id('PT'), at: new Date().toISOString(), type: 'Thu thanh toán', invoiceId: invoice.id, roomId: invoice.roomId, guestName: invoice.guestName, amount, method: payload.method || 'Tiền mặt', status: 'Đã ghi nhận', note: payload.note || '' });
  invoice.paid = money(invoice.paid) + amount;
  invoice.lastMethod = payload.method || 'Tiền mặt';
  refreshInvoicePayment(invoice);
  audit(state, 'Thu tiền hóa đơn', 'PHIEU_THU', invoice.id, `${amount} · ${invoice.lastMethod}`);
  return touch(state);
}

export function payInvoiceGroup(current, invoiceIds, payload = {}) {
  const state = deepClone(current);
  const selectedIds = [...new Set(invoiceIds || [])];
  if (!selectedIds.length) throw new Error('Vui lòng chọn ít nhất một hóa đơn để thanh toán gộp.');
  const invoices = selectedIds.map((invoiceId) => state.invoices.find((item) => item.id === invoiceId && item.status !== 'Đã hủy'));
  if (invoices.some((item) => !item)) throw new Error('Có hóa đơn không tồn tại hoặc đã bị hủy.');
  const groupIds = [...new Set(invoices.map((invoice) => invoiceGroupId(state, invoice)))];
  if (groupIds.length !== 1) throw new Error('Chỉ được thanh toán gộp các phòng thuộc cùng một mã nhóm đặt phòng.');
  const totalDue = invoices.reduce((sum, invoice) => sum + money(invoice.due), 0);
  const amount = money(payload.amount);
  if (!amount) throw new Error('Số tiền thu phải lớn hơn 0.');
  if (amount > totalDue) throw new Error(`Thanh toán gộp tối đa ${totalDue.toLocaleString('vi-VN')} ₫. Tiền thừa nên xử lý trên từng hóa đơn.`);
  const paymentGroupId = id('TTG');
  let remaining = amount;
  const ordered = [...invoices].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.roomId).localeCompare(String(b.roomId)));
  ordered.forEach((invoice) => {
    const allocated = Math.min(remaining, money(invoice.due));
    if (!allocated) return;
    state.receipts.unshift({
      id: id('PT'), paymentGroupId, bookingGroupId: groupIds[0], at: new Date().toISOString(), type: 'Thu thanh toán gộp',
      invoiceId: invoice.id, roomId: invoice.roomId, guestName: invoice.guestName, amount: allocated,
      method: payload.method || 'Tiền mặt', status: 'Đã ghi nhận', note: payload.note || ''
    });
    invoice.paid = money(invoice.paid) + allocated;
    invoice.lastMethod = payload.method || 'Tiền mặt';
    refreshInvoicePayment(invoice);
    remaining -= allocated;
  });
  audit(state, 'Thu tiền gộp nhiều phòng', 'PHIEU_THU', paymentGroupId, `${groupIds[0]} · ${selectedIds.length} hóa đơn · ${amount}`);
  return touch(state);
}

export function refundSurplus(current, invoiceId, method = 'Tiền mặt') {
  const state = deepClone(current);
  const invoice = state.invoices.find((item) => item.id === invoiceId);
  if (!invoice || money(invoice.surplus) <= 0) throw new Error('Hóa đơn không có tiền thừa cần hoàn.');
  const amount = money(invoice.surplus);
  state.receipts.unshift({ id: id('PH'), at: new Date().toISOString(), type: 'Hoàn thanh toán', invoiceId: invoice.id, roomId: invoice.roomId, guestName: invoice.guestName, amount, method, status: 'Đã ghi nhận', note: 'Hoàn tiền thừa' });
  invoice.refunded = money(invoice.refunded) + amount; invoice.surplus = 0; invoice.status = invoice.due === 0 ? 'Đã thanh toán' : 'Chờ thanh toán'; invoice.paidAt = invoice.status === 'Đã thanh toán' ? new Date().toISOString() : '';
  audit(state, 'Hoàn tiền thừa', 'PHIEU_THU', invoice.id, `${amount} · ${method}`);
  return touch(state);
}

export function updateHousekeeping(current, taskId, status, assignee = '') {
  const state = deepClone(current);
  const task = state.housekeeping.find((item) => item.id === taskId);
  if (!task) throw new Error('Không tìm thấy công việc buồng phòng.');
  task.status = status; if (assignee) task.assignee = assignee;
  if (status === 'Đang làm') task.startedAt = new Date().toISOString();
  if (status === 'Hoàn thành') { task.startedAt ||= new Date().toISOString(); task.completedAt = new Date().toISOString(); refreshRoomStatus(state, task.roomId); }
  audit(state, 'Cập nhật buồng phòng', 'BUONG_PHONG', task.id, `${task.roomId} · ${status}`);
  return touch(state);
}

export function createMaintenance(current, roomId, issue, priority = 'Thường') {
  const state = deepClone(current);
  const room = state.rooms.find((item) => item.id === roomId);
  if (!room || !issue?.trim()) throw new Error('Vui lòng chọn phòng và nhập sự cố.');
  const item = { id: id('BT'), createdAt: new Date().toISOString(), roomId, issue: issue.trim(), priority, status: 'Chờ xử lý', assignee: '', completedAt: '', note: '' };
  state.maintenance.unshift(item); room.status = 'Bảo trì';
  audit(state, 'Báo bảo trì', 'BAO_TRI', item.id, `${roomId} · ${issue}`);
  return touch(state);
}

export function completeMaintenance(current, maintenanceId) {
  const state = deepClone(current);
  const item = state.maintenance.find((entry) => entry.id === maintenanceId);
  if (!item) throw new Error('Không tìm thấy phiếu bảo trì.');
  item.status = 'Hoàn thành'; item.completedAt = new Date().toISOString(); refreshRoomStatus(state, item.roomId);
  audit(state, 'Hoàn thành bảo trì', 'BAO_TRI', item.id, item.roomId);
  return touch(state);
}

export function refreshRoomStatus(state, roomId) {
  const room = state.rooms.find((item) => item.id === roomId); if (!room) return;
  if (state.maintenance.some((item) => item.roomId === roomId && !['Hoàn thành', 'Đã hủy'].includes(item.status))) room.status = 'Bảo trì';
  else if (state.stays.some((item) => item.roomId === roomId && item.status === 'Đang ở')) room.status = 'Đang ở';
  else if (state.housekeeping.some((item) => item.roomId === roomId && !['Hoàn thành', 'Đã hủy'].includes(item.status))) room.status = 'Chờ vệ sinh';
  else if (state.bookings.some((item) => item.roomId === roomId && ['Chờ xác nhận', 'Đã xác nhận'].includes(item.status))) room.status = 'Đã đặt';
  else room.status = 'Phòng trống';
}

export function dashboard(state) {
  const rooms = state.rooms.filter((room) => room.active);
  const count = (status) => rooms.filter((room) => room.status === status).length;
  const now = new Date(); const month = now.toISOString().slice(0, 7); const day = now.toISOString().slice(0, 10);
  const paid = state.invoices.filter((invoice) => invoice.status === 'Đã thanh toán' && String(invoice.paidAt || invoice.createdAt).slice(0, 7) === month);
  return {
    totalRooms: rooms.length, available: count('Phòng trống'), booked: count('Đã đặt'), occupied: count('Đang ở'), cleaning: count('Chờ vệ sinh'), maintenance: count('Bảo trì'),
    occupancyRate: rooms.length ? count('Đang ở') / rooms.length : 0,
    arrivalsToday: state.bookings.filter((item) => ['Chờ xác nhận', 'Đã xác nhận'].includes(item.status) && item.arrival.slice(0, 10) === day).length,
    departuresToday: state.stays.filter((item) => item.status === 'Đang ở' && item.expectedCheckout.slice(0, 10) === day).length,
    pendingInvoices: state.invoices.filter((item) => item.status === 'Chờ thanh toán').length,
    outstanding: state.invoices.reduce((sum, item) => sum + (item.status === 'Chờ thanh toán' ? money(item.due) : 0), 0),
    monthRevenue: paid.reduce((sum, item) => sum + money(item.total), 0)
  };
}

export function financeReport(state, from, to) {
  const start = from ? new Date(`${from}T00:00:00`).getTime() : 0;
  const end = to ? new Date(`${to}T23:59:59`).getTime() : Number.MAX_SAFE_INTEGER;
  const invoices = state.invoices.filter((item) => item.status === 'Đã thanh toán' && asDate(item.paidAt || item.createdAt).getTime() >= start && asDate(item.paidAt || item.createdAt).getTime() <= end);
  const receipts = state.receipts.filter((item) => asDate(item.at).getTime() >= start && asDate(item.at).getTime() <= end);
  const byDay = {};
  invoices.forEach((item) => { const key = String(item.paidAt || item.createdAt).slice(0, 10); byDay[key] = (byDay[key] || 0) + money(item.total); });
  return {
    invoices, receipts,
    invoiceCount: invoices.length,
    revenue: invoices.reduce((sum, item) => sum + money(item.total), 0),
    roomRevenue: invoices.reduce((sum, item) => sum + money(item.roomAmount), 0),
    serviceRevenue: invoices.reduce((sum, item) => sum + money(item.serviceAmount), 0),
    surcharge: invoices.reduce((sum, item) => sum + money(item.surcharge), 0),
    discounts: invoices.reduce((sum, item) => sum + money(item.discount), 0),
    vat: invoices.reduce((sum, item) => sum + money(item.vat), 0),
    cashReceived: receipts.reduce((sum, item) => sum + (item.type.startsWith('Hoàn') ? -money(item.amount) : money(item.amount)), 0),
    outstanding: state.invoices.reduce((sum, item) => sum + (item.status === 'Chờ thanh toán' ? money(item.due) : 0), 0),
    byDay: Object.entries(byDay).sort().map(([date, amount]) => ({ date, amount }))
  };
}
