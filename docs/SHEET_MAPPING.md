# ĐỐI CHIẾU 21 TRANG GOOGLE SHEETS

| Trang tính cũ | Dữ liệu trong phiên bản Vercel/Supabase |
| --- | --- |
| HUONG_DAN | `README.md`, thư mục `docs/` |
| CAI_DAT | `state.settings` |
| BANG_GIA_PHONG | `state.rates` |
| DM_PHONG | `state.rooms` |
| DM_DICH_VU | `state.services` |
| DM_KHACH_HANG | `state.guests` |
| DAT_PHONG | `state.bookings` |
| LUU_TRU | `state.stays` |
| CHUYEN_PHONG | `state.moves` |
| PHAT_SINH | `state.charges` |
| HOA_DON | `state.invoices` |
| CT_HOA_DON | `state.invoiceLines` |
| PHIEU_THU | `state.receipts` |
| BUONG_PHONG | `state.housekeeping` |
| BAO_TRI | `state.maintenance` |
| KHO_MINIBAR | tồn hiện tại trong `state.services` |
| NHAP_KHO | `state.stockIns` |
| XUAT_KHO | `state.stockOuts` |
| NHAT_KY | `state.audit` |
| DOANH_THU | tính thời gian thực bằng `financeReport()` |
| DASHBOARD | tính thời gian thực bằng `dashboard()` |

Dữ liệu được lưu trong một tài liệu JSONB có số phiên bản. Hàm PostgreSQL `save_hotel_state` khóa hàng và kiểm tra phiên bản trước khi ghi, tránh hai thiết bị ghi đè lẫn nhau.
