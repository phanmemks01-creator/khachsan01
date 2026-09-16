export const APP_VERSION = '4.2.3';
export const ROOM_STATUSES = ['Phòng trống', 'Đã đặt', 'Đang ở', 'Chờ vệ sinh', 'Bảo trì', 'Tạm khóa'];
export const ACTIVE_BOOKING_STATUSES = ['Chờ xác nhận', 'Đã xác nhận', 'Đã nhận phòng'];

export function id(prefix = 'ID') {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const random = Math.floor(100000 + Math.random() * 900000);
  return `${String(prefix).toUpperCase()}-${stamp}-${random}`;
}

export function deepClone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function isoLocal(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function createInitialState() {
  const rates = [
    { id: 'GIA_DON', roomType: 'Phòng đơn', name: 'Giá phòng đơn', weekday: 500000, weekend: 550000, active: true },
    { id: 'GIA_DOI', roomType: 'Phòng đôi', name: 'Giá phòng đôi', weekday: 800000, weekend: 900000, active: true },
    { id: 'GIA_GIA_DINH', roomType: 'Phòng gia đình', name: 'Giá phòng gia đình', weekday: 1200000, weekend: 1350000, active: true }
  ];
  const rooms = Array.from({ length: 20 }, (_, index) => {
    const number = index + 1;
    const roomType = number % 5 === 0 ? 'Phòng gia đình' : (number % 2 === 0 ? 'Phòng đôi' : 'Phòng đơn');
    return {
      id: `P${String(number).padStart(2, '0')}`,
      name: `Phòng ${number}`,
      floor: Math.ceil(number / 5),
      roomType,
      capacity: roomType === 'Phòng đơn' ? 1 : roomType === 'Phòng đôi' ? 2 : 4,
      status: 'Phòng trống',
      active: true,
      note: ''
    };
  });
  const services = [
    { id: 'NUOC_500', type: 'Đồ giải khát', name: 'Nước tinh khiết 500 ml', unit: 'Chai', price: 10000, cost: 5000, trackStock: true, stock: 100, minStock: 20, active: true },
    { id: 'NUOC_1500', type: 'Đồ giải khát', name: 'Nước tinh khiết 1,5 lít', unit: 'Chai', price: 20000, cost: 10000, trackStock: true, stock: 60, minStock: 10, active: true },
    { id: 'NUOC_NGOT', type: 'Đồ giải khát', name: 'Nước ngọt', unit: 'Lon', price: 15000, cost: 8000, trackStock: true, stock: 80, minStock: 12, active: true },
    { id: 'NUOC_TRAI_CAY', type: 'Đồ giải khát', name: 'Nước trái cây', unit: 'Chai', price: 25000, cost: 14000, trackStock: true, stock: 40, minStock: 8, active: true },
    { id: 'GIAT_UI', type: 'Dịch vụ', name: 'Giặt ủi', unit: 'Lần', price: 50000, cost: 0, trackStock: false, stock: 0, minStock: 0, active: true },
    { id: 'AN_SANG', type: 'Dịch vụ', name: 'Ăn sáng', unit: 'Suất', price: 80000, cost: 0, trackStock: false, stock: 0, minStock: 0, active: true },
    { id: 'TRA_MUON', type: 'Phụ thu', name: 'Phụ thu trả phòng muộn', unit: 'Lần', price: 200000, cost: 0, trackStock: false, stock: 0, minStock: 0, active: true }
  ];
  return {
    meta: { version: APP_VERSION, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: 0 },
    settings: {
      hotelName: 'KHÁCH SẠN MẪU', address: '', phone: '', email: '', taxCode: '', logo: '',
      checkInTime: '14:00', checkOutTime: '12:00', currency: 'VND', vatRate: 0,
      serviceFeeRate: 0, invoiceTitle: 'HÓA ĐƠN THANH TOÁN', invoiceFooter: 'Cảm ơn Quý khách và hẹn gặp lại!',
      financeLocked: true, financeSessionMinutes: 30, financeMaxAttempts: 5, financeLockMinutes: 15,
      financePinHash: ''
    },
    rates, rooms, services,
    guests: [], bookings: [], stays: [], moves: [], charges: [], invoices: [], invoiceLines: [], receipts: [],
    housekeeping: [], maintenance: [], stockIns: [], stockOuts: [], audit: []
  };
}

export function validateState(state) {
  const arrays = ['rates', 'rooms', 'services', 'guests', 'bookings', 'stays', 'moves', 'charges', 'invoices', 'invoiceLines', 'receipts', 'housekeeping', 'maintenance', 'stockIns', 'stockOuts', 'audit'];
  if (!state || typeof state !== 'object' || !state.settings || !state.meta) throw new Error('Tệp dữ liệu không hợp lệ.');
  arrays.forEach((key) => { if (!Array.isArray(state[key])) throw new Error(`Thiếu danh sách ${key}.`); });
  return true;
}
