import fs from 'node:fs';

const path = 'src/app.js';
let app = fs.readFileSync(path, 'utf8');

function replaceOne(from, to, label) {
  if (!app.includes(from)) throw new Error(`Không tìm thấy vùng cần sửa: ${label}`);
  app = app.replace(from, to);
}

replaceOne('const rows = filteredBookings().slice(0, 300);', 'const rows = filteredBookings().slice(0, 1000);', 'Danh sách đặt phòng 1000 dòng');
replaceOne('const rows = filteredStays();', 'const rows = filteredStays().slice(0, 1000);', 'Danh sách lưu trú 1000 dòng');
replaceOne('const filteredInvoices = ui.state.invoices.filter(paymentFilterMatches);', 'const filteredInvoices = ui.state.invoices.filter(paymentFilterMatches).slice(0, 1000);', 'Danh sách thanh toán 1000 dòng');

fs.writeFileSync(path, app);
console.log('Đã nâng giới hạn hiển thị Đặt phòng / Lưu trú / Thanh toán lên tối đa 1.000 dòng.');
