# HOTEL MANAGER PRO 4.0.0

Phần mềm quản lý nghiệp vụ khách sạn chạy trên **GitHub + Vercel + Supabase**, chuyển đổi từ bộ Google Sheets + Apps Script Hotel Manager Pro 3.1.1.

## Quy trình hoàn chỉnh

**Đặt phòng → Nhận phòng → Lưu trú → Đồ giải khát/dịch vụ → Trả phòng → Hóa đơn → Thanh toán → In hóa đơn → Vệ sinh → Mở phòng → Thống kê doanh thu.**

## Chức năng

- Dashboard phòng trống, đã đặt, đang ở, vệ sinh, bảo trì và công suất.
- Tìm phòng không dấu bằng gõ, lọc tầng/loại và chọn nhiều phòng.
- Một khách đặt nhiều phòng; mỗi phòng có phiếu riêng và chung mã nhóm.
- Kiểm tra trùng lịch và sức chứa trước khi đặt.
- Nhận phòng, lưu trú, đồ giải khát/dịch vụ và tự trừ minibar.
- Trả phòng, tính tối thiểu một đêm, phụ thu, giảm tiền có lý do, phí dịch vụ và VAT.
- Hóa đơn, thu nhiều lần, tiền cọc, công nợ và hoàn tiền thừa.
- In hóa đơn với logo và thông tin khách sạn.
- Vệ sinh và bảo trì; chỉ mở lại phòng sau khi hoàn tất.
- Tài chính khóa PIN SHA-256; năm lần sai tạm khóa 15 phút; tải lại phải xác thực lại.
- Báo cáo doanh thu từ ngày đến ngày và biểu đồ theo ngày.
- Sao lưu/khôi phục toàn bộ dữ liệu bằng JSON.
- Giao diện responsive cho máy tính và điện thoại.

## Kiến trúc

- `index.html`, `styles.css`, `src/`: giao diện web không phụ thuộc framework, tải nhanh và không có lỗi Output Directory.
- `api/`: Vercel Serverless API; khóa Supabase chỉ nằm phía máy chủ.
- `supabase/migrations/`: bảng JSONB, RLS và hàm lưu nguyên tử kiểm tra phiên bản.
- `tests/`: kiểm thử nghiệp vụ và API bằng Node.js, không cần cài thư viện ngoài.
- `legacy-apps-script/`: gói Apps Script 3.1.1 dùng để đối chiếu và sao lưu.

## Chạy kiểm thử

Yêu cầu Node.js 20 trở lên:

```bash
npm run check
```

## Chạy thử cục bộ

Có thể mở `index.html` bằng một máy chủ tĩnh. Khi không có API/Supabase, phần mềm tự chuyển sang chế độ cục bộ bằng `localStorage` để thử giao diện và nghiệp vụ.

## Triển khai

Xem [docs/DEPLOY_VERCEL_SUPABASE.md](docs/DEPLOY_VERCEL_SUPABASE.md).

Các biến môi trường bắt buộc trên Vercel:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_ACCESS_KEY`

Không commit tệp `.env` và không đặt service role key trong mã trình duyệt.

## PIN tài chính

PIN ban đầu: `2468`. Đổi ngay trong **Cài đặt → Đổi PIN tài chính**.

## Đối chiếu dữ liệu cũ

Xem [docs/SHEET_MAPPING.md](docs/SHEET_MAPPING.md). Toàn bộ 21 trang Google Sheets đều có vùng dữ liệu hoặc báo cáo tương ứng.

## Sao lưu

- Sao lưu mã nguồn: tải ZIP hoàn chỉnh của thư mục dự án.
- Sao lưu dữ liệu: nhấn **Sao lưu** trong ứng dụng.
- Khôi phục: **Cài đặt → Khôi phục bản sao**.

## Trạng thái kiểm thử

Chạy `npm run check` để xác nhận cú pháp, cấu hình Vercel/Supabase, chống lộ service key và toàn bộ luồng nghiệp vụ trọng yếu trước mỗi lần triển khai.
