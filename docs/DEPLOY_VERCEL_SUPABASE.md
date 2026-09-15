# TRIỂN KHAI CHO NGƯỜI MỚI BẮT ĐẦU

## 1. Tạo cơ sở dữ liệu Supabase

1. Mở dự án Supabase.
2. Chọn **SQL Editor → New query**.
3. Sao chép toàn bộ `supabase/migrations/001_hotel_manager.sql` và nhấn **Run**.
4. Vào **Project Settings → API**, lấy Project URL và `service_role` key.

Không đưa `service_role` key vào mã nguồn hoặc biến bắt đầu bằng `NEXT_PUBLIC_`.

## 2. Kết nối GitHub với Vercel

1. Trong Vercel chọn **Add New → Project**.
2. Chọn kho `phamtu115/DUNGCU2026`.
3. Framework Preset chọn **Other**.
4. Để trống Build Command và Output Directory; `vercel.json` đã xử lý web tĩnh và Serverless API.

## 3. Khai báo Environment Variables

Tạo ba biến cho Production, Preview và Development:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` — đánh dấu Sensitive.
- `APP_ACCESS_KEY` — mã đăng nhập riêng của phần mềm, đánh dấu Sensitive.

Sau khi thêm hoặc thay đổi biến, phải **Redeploy**.

## 4. Kiểm tra sau triển khai

1. Mở `https://TEN-MIEN-VERCEL/api/health`.
2. Kết quả cần có `ok: true`, `supabaseConfigured: true`, `accessKeyConfigured: true`.
3. Mở trang chính, nhập `APP_ACCESS_KEY`.
4. Tạo một phiếu đặt thử, tải lại trang và kiểm tra dữ liệu vẫn còn.
5. Thực hiện một ca thử: đặt → nhận → phát sinh → trả → thanh toán → vệ sinh.

## 5. Sao lưu

Nhấn **Sao lưu** trên thanh trên cùng. Phần mềm tải một tệp JSON chứa đầy đủ danh mục và giao dịch. Khôi phục trong **Cài đặt → Khôi phục bản sao**.
