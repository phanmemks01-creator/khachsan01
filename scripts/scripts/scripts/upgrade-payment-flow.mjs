import fs from 'node:fs';

const appPath = 'src/app.js';
const domainPath = 'src/domain.js';
let app = fs.readFileSync(appPath, 'utf8');
let domain = fs.readFileSync(domainPath, 'utf8');

const replaceOnce = (text, pattern, replacement, label) => {
  const matches = text.match(pattern);
  if (!matches) throw new Error(`Không tìm thấy vùng cần sửa: ${label}`);
  return text.replace(pattern, replacement);
};

// 1) Domain: checkout only closes the stay and creates a draft invoice.
domain = domain.replace(
  "  const surcharge = money(options.surcharge || stay.surcharge);\n  const discount = money(options.discount || 0);\n  if (discount > 0 && !String(options.discountReason || '').trim()) throw new Error('Giảm tiền phải có lý do.');",
  "  // Phụ thu/giảm tiền được xử lý tại bước Thanh toán, không xử lý tại Trả phòng.\n  const surcharge = 0;\n  const discount = 0;"
);
domain = domain.replace(
  "    roomAmount: roomCalculation.total, serviceAmount, surcharge, discount, discountReason: options.discountReason || '',",
  "    roomAmount: roomCalculation.total, serviceAmount, surcharge, discount, discountReason: '', roomAdjustmentReason: '',"
);

// 2) Domain: add invoice adjustment while preserving old invoice/payment structures.
if (!domain.includes('export function adjustInvoice(')) {
  const marker = '\nexport function payInvoice(current, invoiceId, payload) {';
  const fn = `
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
`;
  if (!domain.includes(marker)) throw new Error('Không tìm thấy vị trí chèn adjustInvoice.');
  domain = domain.replace(marker, `${fn}${marker}`);
}

// 3) App import adjustInvoice.
app = app.replace(
  '  addCharge, availableRooms, cancelBooking, checkIn, checkOut, completeMaintenance, createBooking,',
  '  addCharge, adjustInvoice, availableRooms, cancelBooking, checkIn, checkOut, completeMaintenance, createBooking,'
);

// 4) Checkout modal: remove surcharge/discount from checkout.
app = replaceOnce(app, /function checkoutModal\(stayId\) \{[\s\S]*?\n\}\nfunction paymentModal\(invoiceId\)/, `function checkoutModal(stayId) {
  const stay = ui.state.stays.find((item) => item.id === stayId);
  const booking = ui.state.bookings.find((item) => item.id === stay?.bookingId);
  const earliestCheckout = new Date(new Date(stay.checkIn).getTime() + 60000);
  const suggestedCheckout = new Date(Math.max(Date.now(), earliestCheckout.getTime()));
  openModal(\`<h2>Trả phòng \${esc(stay?.roomId)}</h2><p class="sub">\${esc(stay?.guestName)} · Nhóm \${esc(booking?.groupId || 'đặt lẻ')} · Cọc \${money(stay?.deposit)}</p><form id="checkoutForm"><input type="hidden" name="stayId" value="\${esc(stayId)}"><div class="form-grid"><div class="field span-2"><label>Thời gian trả</label><input name="checkout" type="datetime-local" min="\${esc(isoLocal(earliestCheckout))}" value="\${esc(isoLocal(suggestedCheckout))}" required></div><div class="field span-2"><label>Ghi chú trả phòng</label><input name="note"></div></div><p class="sub">Trả phòng chỉ chốt thời gian và lập hóa đơn. Tiền phòng, phụ thu và giảm tiền được kiểm tra/chỉnh tại mục Thanh toán.</p><div class="actions no-print"><button class="button primary">Trả phòng & chuyển sang thanh toán</button></div></form>\`);
}
function paymentModal(invoiceId)`, 'checkoutModal');

// 5) Single payment modal: full service detail + editable room/surcharge/discount.
app = replaceOnce(app, /function paymentModal\(invoiceId\) \{[\s\S]*?\nfunction groupPaymentModal\(groupId\) \{/, `function paymentModal(invoiceId) {
  const invoice = ui.state.invoices.find((item) => item.id === invoiceId);
  const lines = ui.state.invoiceLines.filter((item) => item.invoiceId === invoiceId && item.type !== 'Tiền phòng');
  const serviceRows = lines.length ? lines.map((line) => \`<tr><td>\${esc(line.name)}</td><td>\${line.quantity} \${esc(line.unit)}</td><td>\${money(line.unitPrice)}</td><td>\${money(line.amount)}</td></tr>\`).join('') : '<tr><td colspan="4" class="empty">Không có dịch vụ/minibar.</td></tr>';
  openModal(\`<h2>Thanh toán phòng \${esc(invoice.roomId)}</h2><p class="sub">\${esc(invoice.guestName)} · Hóa đơn \${esc(invoice.id)}</p><form id="paymentForm"><input type="hidden" name="invoiceId" value="\${esc(invoiceId)}"><div class="table-wrap"><table class="table"><thead><tr><th>Dịch vụ / minibar</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>\${serviceRows}</tbody></table></div><div class="form-grid" style="margin-top:15px"><div class="field"><label>Tiền phòng (có thể sửa)</label><input name="roomAmount" type="number" min="0" value="\${Number(invoice.roomAmount || 0)}" required></div><div class="field"><label>Lý do điều chỉnh giá phòng</label><input name="roomAdjustmentReason" value="\${esc(invoice.roomAdjustmentReason || '')}" placeholder="Bắt buộc nếu sửa tiền phòng"></div><div class="field"><label>Phụ thu</label><input name="surcharge" type="number" min="0" value="\${Number(invoice.surcharge || 0)}"></div><div class="field"><label>Giảm tiền (VNĐ)</label><input name="discount" type="number" min="0" value="\${Number(invoice.discount || 0)}"></div><div class="field span-2"><label>Lý do giảm tiền</label><input name="discountReason" value="\${esc(invoice.discountReason || '')}" placeholder="Bắt buộc khi có giảm tiền"></div><div class="field"><label>Số tiền thu</label><input name="amount" type="number" min="1" value="\${Number(invoice.due || 0)}" required></div><div class="field"><label>Phương thức</label><select name="method"><option>Tiền mặt</option><option>Chuyển khoản</option><option>Thẻ</option></select></div><div class="field span-2"><label>Ghi chú</label><input name="note"></div></div><div class="summary" style="margin-top:15px"><div><span>Dịch vụ</span><b>\${money(invoice.serviceAmount)}</b></div><div><span>Cọc + đã thu</span><b>\${money(invoice.deposit + invoice.paid)}</b></div><div><span>Còn phải thu hiện tại</span><b>\${money(invoice.due)}</b></div></div><div class="actions"><button class="button success">Cập nhật & ghi nhận thanh toán</button></div></form>\`);
}
function groupPaymentModal(groupId) {`, 'paymentModal');

// 6) Group payment modal: details per room and editable adjustments per room.
app = replaceOnce(app, /function groupPaymentModal\(groupId\) \{[\s\S]*?\n\}\nfunction extendStayModal\(stayId\)/, `function groupPaymentModal(groupId) {
  const invoices = ui.state.invoices.filter((item) => invoiceGroupId(ui.state, item) === groupId && Number(item.due || 0) > 0);
  if (invoices.length < 2) return toast('Nhóm này hiện không còn từ hai hóa đơn chờ thu.', true);
  const totalDue = invoices.reduce((sum, item) => sum + Number(item.due || 0), 0);
  const roomBlocks = invoices.map((invoice) => {
    const lines = ui.state.invoiceLines.filter((line) => line.invoiceId === invoice.id);
    const detail = lines.length ? lines.map((line) => \`<tr><td>\${esc(line.name)}</td><td>\${line.quantity} \${esc(line.unit)}</td><td>\${money(line.unitPrice)}</td><td>\${money(line.amount)}</td></tr>\`).join('') : '<tr><td colspan="4" class="empty">Không có dịch vụ/minibar.</td></tr>';
    return \`<div class="card" style="margin:12px 0"><div class="section-head"><div><h3>Phòng \${esc(invoice.roomId)}</h3><p>\${esc(invoice.id)} · Cọc \${money(invoice.deposit)} · Còn thu \${money(invoice.due)}</p></div><input type="checkbox" name="invoiceIds" value="\${esc(invoice.id)}" data-due="\${Number(invoice.due || 0)}" checked></div><div class="table-wrap"><table class="table"><thead><tr><th>Nội dung</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>\${detail}</tbody></table></div><div class="form-grid"><div class="field"><label>Tiền phòng</label><input name="roomAmount_\${esc(invoice.id)}" type="number" min="0" value="\${Number(invoice.roomAmount || 0)}"></div><div class="field"><label>Lý do sửa giá phòng</label><input name="roomReason_\${esc(invoice.id)}" value="\${esc(invoice.roomAdjustmentReason || '')}"></div><div class="field"><label>Phụ thu</label><input name="surcharge_\${esc(invoice.id)}" type="number" min="0" value="\${Number(invoice.surcharge || 0)}"></div><div class="field"><label>Giảm tiền (VNĐ)</label><input name="discount_\${esc(invoice.id)}" type="number" min="0" value="\${Number(invoice.discount || 0)}"></div><div class="field span-2"><label>Lý do giảm</label><input name="discountReason_\${esc(invoice.id)}" value="\${esc(invoice.discountReason || '')}"></div></div></div>\`;
  }).join('');
  openModal(\`<h2>Thanh toán gộp nhiều phòng</h2><p class="sub">\${esc(invoices[0].guestName)} · Nhóm \${esc(groupId)}</p><form id="groupPaymentForm"><input type="hidden" name="groupId" value="\${esc(groupId)}">\${roomBlocks}<div class="form-grid" style="margin-top:15px"><div class="field span-2"><label>Số tiền thanh toán gộp</label><input name="amount" type="number" min="1" value="\${totalDue}" required></div><div class="field span-2"><label>Phương thức</label><select name="method"><option>Tiền mặt</option><option>Chuyển khoản</option><option>Thẻ</option></select></div><div class="field span-4"><label>Ghi chú chung</label><input name="note" placeholder="Ví dụ: Khách thanh toán toàn bộ đoàn"></div></div><p class="sub">Mỗi phòng giữ hóa đơn riêng. Có thể sửa tiền phòng, phụ thu và giảm tiền riêng từng phòng trước khi thanh toán gộp.</p><div class="actions"><button class="button success">Cập nhật & xác nhận thanh toán gộp</button></div></form>\`);
}
function extendStayModal(stayId)`, 'groupPaymentModal');

// 7) Single payment submit: adjust invoice first, then receive money in the same state mutation.
app = app.replace(
  "  if (form.id === 'paymentForm') { const saved = await mutate((state) => payInvoice(state, data.invoiceId, data), 'Đã ghi nhận thanh toán riêng.'); if (saved) closeModal(); }",
  "  if (form.id === 'paymentForm') { const saved = await mutate((state) => payInvoice(adjustInvoice(state, data.invoiceId, data), data.invoiceId, data), 'Đã cập nhật hóa đơn và ghi nhận thanh toán riêng.'); if (saved) closeModal(); }"
);

// 8) Group submit: apply each selected room adjustment, then pay group.
app = app.replace(
  "  if (form.id === 'groupPaymentForm') { const invoiceIds = new FormData(form).getAll('invoiceIds'); const saved = await mutate((state) => payInvoiceGroup(state, invoiceIds, data), 'Đã thanh toán gộp nhiều phòng.'); if (saved) closeModal(); }",
  `  if (form.id === 'groupPaymentForm') {
    const fd = new FormData(form); const invoiceIds = fd.getAll('invoiceIds');
    const saved = await mutate((state) => {
      let next = state;
      invoiceIds.forEach((invoiceId) => {
        next = adjustInvoice(next, invoiceId, {
          roomAmount: fd.get(\`roomAmount_\${invoiceId}\`), roomAdjustmentReason: fd.get(\`roomReason_\${invoiceId}\`),
          surcharge: fd.get(\`surcharge_\${invoiceId}\`), discount: fd.get(\`discount_\${invoiceId}\`), discountReason: fd.get(\`discountReason_\${invoiceId}\`)
        });
      });
      const refreshedDue = invoiceIds.reduce((sum, invoiceId) => sum + Number(next.invoices.find((item) => item.id === invoiceId)?.due || 0), 0);
      const amount = Math.min(Number(data.amount || 0), refreshedDue);
      if (amount <= 0) throw new Error('Nhóm hóa đơn không còn số tiền phải thu.');
      return payInvoiceGroup(next, invoiceIds, { ...data, amount });
    }, 'Đã cập nhật chi tiết và thanh toán gộp nhiều phòng.');
    if (saved) closeModal();
  }`
);

// 9) Invoice print: show adjustment reasons without changing old invoice structure.
app = app.replace(
  '<b>Phụ thu:</b> ${money(invoice.surcharge)}<br><b>Giảm tiền:</b> ${money(invoice.discount)}<br><b>Phí dịch vụ:</b>',
  '<b>Phụ thu:</b> ${money(invoice.surcharge)}<br><b>Giảm tiền:</b> ${money(invoice.discount)}${invoice.discountReason ? ` · ${esc(invoice.discountReason)}` : ``}<br>${invoice.roomAdjustmentReason ? `<b>Lý do điều chỉnh giá phòng:</b> ${esc(invoice.roomAdjustmentReason)}<br>` : ``}<b>Phí dịch vụ:</b>'
);

fs.writeFileSync(appPath, app);
fs.writeFileSync(domainPath, domain);
console.log('Đã nâng cấp luồng Trả phòng → Thanh toán → Thanh toán gộp, giữ nguyên cấu trúc dữ liệu cũ.');
