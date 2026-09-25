# timvot.com

[English](README.md) | **Tiếng Việt**

Danh mục vợt và dây cước cầu lông dành cho thị trường Việt Nam, hỗ trợ so sánh thông
số, xem giá từ các cửa hàng, tìm vợt phù hợp, đọc bài hướng dẫn, theo dõi sản phẩm,
đánh giá và quản lý gian hàng. Tiếng Việt (`vi`) là ngôn ngữ mặc định; website cũng
hỗ trợ tiếng Anh (`en`).

Dự án sử dụng Next.js 16, React 19, TypeScript, Tailwind CSS 4, Supabase và next-intl.
Website dành cho người dùng chạy từ thư mục này. [Ứng dụng quản trị](admin/README.md)
có bộ thư viện phụ thuộc và quy trình triển khai riêng.

## Bắt đầu nhanh

Cài **Node.js 24.x** và npm. Chạy các lệnh sau tại thư mục gốc của dự án:

```bash
npm ci
npm run dev
```

Mở [localhost:3000/vi](http://localhost:3000/vi) hoặc
[localhost:3000/en](http://localhost:3000/en).

Bạn có thể duyệt danh mục mẫu có sẵn mà không cần tệp cấu hình môi trường.
Đăng nhập, theo dõi sản phẩm, gửi đánh giá và cập nhật thông tin người bán cần Supabase.

## Kết nối Supabase (tùy chọn)

1. Sao chép [.env.example](.env.example) thành `.env.local`.
2. Điền thông tin dự án Supabase dùng cho môi trường phát triển:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```

3. Để áp dụng các migration (tệp thay đổi cấu trúc cơ sở dữ liệu), đặt thêm
   `DIRECT_URL` là chuỗi kết nối Postgres ở chế độ session qua cổng 5432,
   hoặc đặt `SUPABASE_ACCESS_TOKEN`. Sau đó chạy:

   ```bash
   npm run migrate:dry   # Liệt kê các tệp migration, không thay đổi cơ sở dữ liệu
   npm run migrate       # Áp dụng các migration chưa chạy
   ```

4. Để thêm dữ liệu mẫu vào cơ sở dữ liệu phát triển mới:

   ```bash
   npm run seed:sql
   npm run migrate -- --file=supabase/seed.sql
   ```

5. Làm theo [hướng dẫn thiết lập xác thực](docs/auth-setup.md) để cấu hình URL
   callback và đăng nhập Google/Facebook nếu cần, rồi khởi động lại máy chủ phát triển.

Giữ kín `.env.local`. `SUPABASE_SERVICE_ROLE_KEY` chỉ cần cho các script có quyền
đặc biệt và thao tác quản trị; không đưa khóa này vào biến có tiền tố `NEXT_PUBLIC_`.
Khóa này không thay thế được thông tin kết nối dùng cho migration ở trên.

## Các lệnh phát triển

| Lệnh | Chức năng |
| --- | --- |
| `npm run dev` | Chạy website và tự cập nhật khi mã nguồn thay đổi |
| `npm run typecheck` | Kiểm tra kiểu dữ liệu của ứng dụng và các script |
| `npm test` | Chạy các bộ kiểm thử thư viện, bảo mật, trình thu thập dữ liệu và migration |
| `npm run test:guides` | Kiểm thử tiến trình tạo bài hướng dẫn và nội dung bài viết |
| `npm run build` | Tạo bản dựng website cho môi trường production |
| `npm start` | Chạy bản dựng production trên máy cục bộ |
| `npm run test:e2e` | Tạo bản dựng và chạy kiểm thử trình duyệt bằng Playwright với dữ liệu mẫu |

Trước lần kiểm thử trình duyệt đầu tiên, chạy `npx playwright install chromium`.
Kiểm tra kiểu dữ liệu, chạy các kiểm thử liên quan và tạo bản dựng production
trước khi mở pull request. Ứng dụng quản trị được kiểm tra riêng;
xem [hướng dẫn thiết lập](admin/README.md).

## Cấu trúc dự án

| Đường dẫn | Nội dung |
| --- | --- |
| `src/app/[locale]/` | Các trang: vợt, dây cước, so sánh, tìm vợt, ưu đãi, bài hướng dẫn, tài khoản và người bán |
| `src/components/` | Thành phần giao diện dùng chung; `ds/` chứa các thành phần của hệ thống thiết kế |
| `src/app/globals.css` | Kiểu giao diện chung và các biến thiết kế |
| `src/lib/data/` | Truy vấn danh mục, chuyển đổi dữ liệu và dữ liệu mẫu |
| `src/lib/` | Kiểu dữ liệu nghiệp vụ, Court Score, xác thực và logic nghiệp vụ |
| `src/i18n/`, `messages/` | Định tuyến theo ngôn ngữ và bản dịch tiếng Anh/tiếng Việt |
| `supabase/migrations/` | Cấu trúc cơ sở dữ liệu và chính sách truy cập |
| `scripts/` | Thu thập dữ liệu, bảo trì danh mục, migration và xuất bản bài hướng dẫn |
| `e2e/` | Kiểm thử trình duyệt |
| `admin/` | Ứng dụng quản trị độc lập |

Cập nhật cả hai tệp bản dịch khi thay đổi nội dung giao diện. Đặt logic truy cập
dữ liệu trong `src/lib/data/` và tạo migration khi thay đổi cấu trúc cơ sở dữ liệu.
Trước khi sửa mã Next.js, đọc tài liệu đi kèm phiên bản đã cài tại
`node_modules/next/dist/docs/`, theo yêu cầu trong [AGENTS.md](AGENTS.md).

## Dữ liệu và xuất bản nội dung

### Thu thập dữ liệu vợt và sao lưu

Chạy lệnh tại thư mục gốc của dự án. Để sao lưu dữ liệu từ Supabase, đồng bộ cơ sở
dữ liệu và tải ảnh lên, đặt `NEXT_PUBLIC_SUPABASE_URL` và
`SUPABASE_SERVICE_ROLE_KEY` trong `.env.local`.

| Lệnh | Chức năng |
| --- | --- |
| `npm run backup` | Xuất bản sao dữ liệu danh mục vào `backups/backup-<timestamp>.json` |
| `npm run scrape:quick` | Thu thập tối đa 3 trang mỗi cửa hàng, bỏ qua xác minh bằng trình duyệt; chỉ lưu JSON |
| `npm run scrape` | Thu thập từ tất cả cửa hàng mặc định và xác minh bằng trình duyệt; chỉ lưu JSON |
| `npm run scrape:sync` | Thu thập, xác minh và đồng bộ giá vợt cùng số lượng tồn kho lên Supabase |
| `npm run scrape:refresh` | Thu thập và đồng bộ, bỏ qua xác minh bằng trình duyệt |
| `npm run scrape:images` | Thu thập bộ ảnh vợt và tải lên Supabase |
| `npm run market:refresh` | Tính lại điểm Court Score đã lưu sau khi danh mục thay đổi |

Trước khi xác minh bằng trình duyệt, chạy `npx playwright install chromium`.
Các cửa hàng mặc định gồm VNB, QV Badminton, FBShop và HVShop.
Để chỉ thu thập từ một cửa hàng:

```bash
npm run scrape -- --site=vnb --pages=3 --no-verify
```

Kết quả thu thập vợt được lưu tại `scripts/scraper/output/rackets.json`.
Sao lưu trước khi đồng bộ thay đổi. Nếu chưa cấu hình thông tin kết nối Supabase,
`backup` chỉ xuất dữ liệu mẫu. Kiểm tra các cảnh báo và số bản ghi từng bảng:
lỗi đọc bảng có thể khiến bản sao lưu không đầy đủ. Bản sao lưu này không bao gồm
người dùng trong Auth và tệp trong Storage; xem [hướng dẫn chuyển toàn bộ dự án](docs/supabase-instance-migration.md)
nếu cần chuyển cả những dữ liệu đó.

### Chạy tự động theo lịch

[Workflow thu thập dữ liệu và sao lưu hằng ngày](.github/workflows/daily-scraper.yml)
chạy trên máy Ubuntu do GitHub cung cấp lúc **01:00 UTC / 08:00 giờ Việt Nam**.
Workflow đồng bộ thông tin chào bán vợt, nhập danh mục Venson, cập nhật điểm,
thu thập ảnh từ các nguồn đã chọn, kiểm tra ảnh và tạo bản sao lưu sau khi đồng bộ.

Để chạy thủ công, mở GitHub **Actions → Shuttlecraft Daily Scraper & Backup Sync
→ Run workflow**. Đây là tên hiện tại của workflow. Cấu hình các secret của repository:
`NEXT_PUBLIC_SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY`; các bước đo hiệu năng
cũng sử dụng `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` và `DIRECT_URL`. Có thể đặt thêm
`REVALIDATE_URL` / `REVALIDATE_SECRET` để làm mới bộ nhớ đệm của website sau khi đồng bộ.

Tải `daily-db-backup-<run-number>` từ phần artifacts của lần chạy; thời gian lưu là
30 ngày. Tùy chọn `sync_db` khi chạy thủ công chỉ điều khiển bước thu thập từ cửa hàng;
các bước nhập danh mục, cập nhật điểm và tải ảnh lên vẫn chạy.

### Dây cước và bài hướng dẫn

- `npm run scrape:strings` thu thập giá và số lượng dây cước còn hàng.
- `npm run scrape:strings:sync` ghi vào cơ sở dữ liệu đã cấu hình, sử dụng cùng
  URL Supabase và khóa service-role.
- Việc tạo bài hướng dẫn có cấu hình riêng:
  [hướng dẫn xuất bản bài viết](docs/ai-guides-operations.md).

Toàn bộ các lệnh được liệt kê trong [package.json](package.json).

## Triển khai

Website và ứng dụng quản trị được triển khai thành hai dự án Vercel riêng.
Dùng thư mục gốc cho website và `admin/` cho ứng dụng quản trị.
Đặt `NEXT_PUBLIC_SITE_URL` của website thành `https://timvot.com` trong môi trường production.

[Workflow triển khai production](.github/workflows/deploy-production.yml) được chạy
thủ công để tạo bản dựng và triển khai một commit đã chọn từ `main`.
Workflow cần secret `VERCEL_TOKEN` và các biến `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`
của repository.

Khi triển khai, rất nên cài Vercel CLI bằng `npm i -g vercel` để sử dụng
`vercel env pull`, `vercel deploy` và `vercel logs`.

## Tài liệu bổ sung

- [Xác thực và đăng nhập qua mạng xã hội](docs/auth-setup.md)
- [Thiết lập và triển khai ứng dụng quản trị](admin/README.md)
- [Xuất bản bài hướng dẫn](docs/ai-guides-operations.md)
- [Bổ sung ảnh vợt từ cửa hàng](docs/retailer-image-backfill.md)
- [Chuyển dự án Supabase](docs/supabase-instance-migration.md)
