# Kế hoạch kỹ thuật: Timvot hỗ trợ người mua từ nhóm Facebook

Ngày lập: 27/09/2026 · Đối tượng: kỹ sư frontend, backend, dữ liệu, QA và người phụ trách sản phẩm.

Tài liệu này triển khai [chiến lược dành cho người mua từ nhóm Facebook](facebook-first-buyer-strategy.vi.md) trên website Next.js 16 + Supabase hiện có. Người mua được **tìm vợt, kiểm tra tin, so sánh và xem bằng chứng miễn phí**. Bản đầu hoạt động khi chưa đăng nhập và không phụ thuộc vào việc đọc tự động bài đăng Facebook.

## 1. Kết quả cần đạt

Người chơi vừa thấy một tin bán vợt có thể mở Timvot trên điện thoại, nhập tên vợt, giá và tình trạng, rồi nhận được ba câu trả lời:

1. **Có hợp mình không?** Vì sao và phải đánh đổi điều gì?
2. **Giá có thể đánh giá đến đâu?** Mốc tham khảo nào là cùng phiên bản/cùng tình trạng, dữ liệu cập nhật khi nào, chỗ nào chưa đủ dữ liệu?
3. **Bước tiếp theo là gì?** Cần xin ảnh hoặc hỏi gì, có lựa chọn nào đáng so sánh, làm sao quay lại tin ban đầu?

Trên trang đầu có ba lối vào: **Kiểm tra tin vừa thấy**, **Tìm vợt phù hợp**, **So sánh vài cây**. Giao dịch vẫn có thể diễn ra qua Facebook/Messenger hoặc tại cửa hàng. Mục tiêu thiết kế là ra kết quả đầu tiên trong khoảng một phút; phải đo với người dùng thật trước khi quảng bá con số này.

### Phạm vi phát hành

| Mức | Bao gồm | Điều kiện |
| --- | --- | --- |
| P0 · Phát hành đầu tiên | Nhập tin thủ công; nhận diện mẫu/phiên bản; kết quả độ phù hợp; mốc giá có nhãn nguồn và độ tin cậy; checklist mua vợt cũ; so sánh và link chia sẻ gọn; ba lối vào trên trang đầu. | Không cần tài khoản hoặc dịch vụ mới. Không lưu bài Facebook/ảnh cá nhân lên máy chủ. |
| P1 · Sau khi kiểm chứng | Dữ liệu giao dịch/tin vợt cũ cùng tình trạng có kiểm duyệt; lưu/chia sẻ kết quả thuận tiện hơn; góp ý kết quả; câu hỏi bổ sung về cây vợt đang dùng và mục tiêu tiến bộ. | Có người dùng thật, quy trình kiểm duyệt và độ phủ dữ liệu. |
| P2 · Sau khi có bằng chứng nhu cầu | Video đánh giá được biên tập, ảnh người dùng tự chọn/OCR, hỏi đáp mở, công cụ cho quản trị viên nhóm hoặc người bán. | Đo được lợi ích so với thao tác thủ công và có quy trình quyền riêng tư/nội dung. |

Không biến P0 thành chợ đăng tin mới, hệ thống thanh toán, công cụ quét nhóm riêng tư hoặc chatbot trả lời mọi câu hỏi. Những việc đó không cần để kiểm chứng giá trị cốt lõi.

## 2. Hiện trạng kỹ thuật và khoảng trống

| Đã có | Có thể tái sử dụng | Khoảng trống phải xử lý |
| --- | --- | --- |
| `src/lib/finder.ts`, `/[locale]/finder`, `FinderQuiz` | Bộ câu hỏi, xếp hạng và lý do phù hợp. | Chưa nhận “cây vợt tôi đang xem”; chưa giải thích điểm đánh đổi hoặc ưu tiên năm ra mắt. Kết quả đang hiển thị `lowestPrice ?? msrp`, dễ khiến giá niêm yết trông như giá đang bán. |
| `rackets`, `racket_variants`, `racket_market`, tra cứu catalogue | Mẫu chuẩn, thương hiệu, 3U/4U, cỡ cán, điểm số. | Cần tra cứu tên gần đúng với kết quả giới hạn và xác nhận phiên bản trước khi phân tích; không tải toàn bộ catalogue cho từng lượt kiểm tra. |
| `offers`, `price_points`, `getVariantPrice`, `price-window.ts` | Giá/tin bán cửa hàng, tình trạng của từng `offer`, chuỗi giá theo `variant_id`. | `price_points` không có tình trạng; `median30` hiện là trung vị của 1/3 cuối chuỗi quan sát, chưa phải cửa sổ 30 ngày theo lịch. `updated_at` của offer không tự chứng minh người bán vừa xác nhận còn hàng. |
| `/[locale]/compare`, `CompareProvider` | So sánh nhiều vợt, trạng thái lưu ở trình duyệt. | Cần đưa tin đang kiểm tra vào so sánh, làm nổi bật khác biệt có ích và tạo link có thể chia sẻ mà không lộ dữ liệu riêng. |
| Đánh giá, người bán, watchlist, cẩm nang, `next-intl` | Bằng chứng, hướng dẫn và hai ngôn ngữ. | Cần checklist riêng cho tin vợt cũ, phân biệt nguồn và mức chắc chắn; mọi chuỗi mới phải có `vi` và `en`. |
| Cache Components, Supabase RLS, kiểm thử Playwright | Hạ tầng đọc dữ liệu và kiểm soát quyền. | Đường đọc mới phải giới hạn truy vấn, giữ shell nhanh, không mở quyền ghi ẩn danh vào dữ liệu giá đáng tin. |

Nguồn chính: `src/lib/types.ts`, `src/lib/data/repository.ts`, `src/lib/data/catalog-page.ts`, `src/lib/price-window.ts`, `src/app/[locale]/finder/page.tsx`, các migration trong `supabase/migrations/`. Trước mỗi PR sửa mã Next.js, đọc phần liên quan trong `node_modules/next/dist/docs/` theo `AGENTS.md`; dự án đang bật `cacheComponents: true`.

## 3. Đặc tả trải nghiệm frontend

### 3.1. Trang đầu và điều hướng

- Thêm khối “Bạn đang tìm vợt theo cách nào?” với ba hành động kể trên; “Kiểm tra tin vừa thấy” là hành động chính trên điện thoại. Điều hướng tới `/vi/check` hoặc `/en/check` theo locale.
- Trang đích từ Facebook phải cho nhập tên vợt và giá ngay trên màn hình đầu, không yêu cầu đọc bài giới thiệu hoặc tạo tài khoản.
- Giữ hệ màu, kiểu chữ, component `ds/` và quy tắc của website; mỗi màn hình chỉ có một hành động chính. Nút đủ lớn cho thao tác chạm, trạng thái focus rõ, nhãn không chỉ dựa vào màu.

### 3.2. Form “Kiểm tra tin đăng” (`/[locale]/check`)

| Trường | Quy tắc P0 | Lỗi/thiếu dữ liệu |
| --- | --- | --- |
| Tên mẫu vợt | Bắt buộc; gợi ý tối đa 8 mẫu, có thương hiệu, tên đầy đủ, ảnh nhỏ nếu có. Người dùng phải chọn một mẫu chuẩn hoặc tiếp tục với trạng thái “chưa xác định mẫu”. | Nếu có nhiều Play/Tour/Pro hoặc đời vợt, hỏi chọn; không tự gộp. Nếu không tìm thấy, đưa link tìm trong catalogue và nhận góp ý tên mẫu còn thiếu. |
| Phiên bản | Chọn 3U/4U, cỡ cán, màu khi biết; nhãn “chưa rõ” hợp lệ. | Không cho so giá như cùng phiên bản khi chưa xác định được bản. |
| Giá tin đang xem | Số VND, bắt buộc cho đánh giá giá; có thể bỏ qua để chỉ xem độ phù hợp. | Kiểm tra phạm vi hợp lý, chặn số âm/ký tự lạ, hiển thị định dạng `₫`. |
| Tình trạng | `mới`, `khui hộp`, `đã dùng`, `chưa rõ`; P0 không ép phân hạng chi tiết cây vợt cũ. | Nếu “đã dùng” hoặc “chưa rõ”, P0 chỉ đưa mốc giá cửa hàng với nhãn rõ ràng, không kết luận giá món hàng đó. |
| Thông tin người chơi | 2–3 câu tối thiểu hoặc dùng câu trả lời Finder hiện có nếu người dùng tự chọn. | Cho xem kết quả giá/thông số trước; độ phù hợp hiển thị “cần thêm thông tin về bạn” nếu thiếu. |

- Trên mobile: form theo từng nhóm ngắn, bàn phím số cho giá, gợi ý tìm kiếm có thể chọn bằng bàn phím và trình đọc màn hình, lỗi đặt ngay dưới trường. Giữ dữ liệu đã nhập khi quay lại chỉnh sửa.
- Không yêu cầu dán URL Facebook ở P0. Khi có URL ở P1, chỉ dùng để người mua quay lại bài; không hứa đọc được nội dung nhóm riêng tư. Không đặt URL bài, tên người bán, ảnh, nội dung hội thoại hoặc thông tin sức khỏe vào link chia sẻ.
- Trạng thái rõ ràng: đang tìm mẫu, nhiều mẫu gần giống, chưa có mẫu, chưa có offer, dữ liệu giá cũ, lỗi mạng và kết quả một phần. Lỗi dữ liệu giá không được làm mất kết quả thông số/checklist.

### 3.3. Màn hình kết quả

Thứ tự nội dung ở 360–390px: **tên mẫu và độ chắc chắn nhận diện → độ phù hợp và điểm đánh đổi → ngữ cảnh giá → 3 câu cần hỏi người bán → lựa chọn thay thế → so sánh chi tiết**. Giữ một CTA chính “Sao chép câu hỏi gửi người bán”; các nút “So sánh”, “Sửa thông tin”, “Xem giá cửa hàng” là phụ. Trên desktop có thể đặt ngữ cảnh giá bên cạnh độ phù hợp; không làm nội dung phụ thuộc vào hai cột.

Các nhãn kết quả phải là văn bản rõ nghĩa:

- **Độ phù hợp:** “Có thể hợp”, “Có điểm cần cân nhắc”, “Chưa đủ thông tin về người chơi”; luôn kèm 1–2 lý do có dữ liệu và ít nhất một điểm đánh đổi khi có thể suy ra.
- **Giá:** “Có tin cùng điều kiện để tham khảo”, “Chỉ có giá cửa hàng làm mốc”, “Chưa đủ dữ liệu”. Không dùng nhãn “hời/rẻ nhất” nếu điều kiện ở mục 5 không đạt.
- **Nguồn:** số tin hợp lệ, đúng phiên bản/tình trạng, nguồn giá, ngày quan sát; tách giá người mua nhập khỏi giá Timvot thu thập.
- **Vợt cũ:** checklist hỏi về ảnh cận khung/gen/thân/cán, nứt hoặc sửa chữa, đúng phiên bản và cách kiểm tra trực tiếp; không cấp chứng nhận “chính hãng” cho một cây chưa kiểm tra.

Link chia sẻ P0 chỉ mang ID mẫu/phiên bản, giá và tình trạng do người dùng chủ động chọn chia sẻ. Trang kết quả cá nhân hóa sâu không mặc định chia sẻ câu trả lời Finder; riêng câu hỏi vai/khuỷu tay hiện nằm trên URL Finder nên cần loại khỏi mọi thẻ/link chia sẻ mới.

### 3.4. Cải thiện Finder, so sánh và nội dung

- Finder: giữ năm câu hỏi đầu; sau kết quả mới cho lọc tùy chọn “mẫu ra mắt từ năm…”, “tôi đang dùng/thích cây…”, “muốn cải thiện phòng thủ/tấn công/kiểm soát”. Đánh giá bằng người dùng trước khi đổi thuật toán xếp hạng. Cung cấp lý do khi giới thiệu mẫu đời cũ hơn mong muốn.
- Kết quả Finder: phân biệt **giá đang có offer còn hàng** và **MSRP tham khảo**; khi không có offer, không hiện giá MSRP như giá mua ngay. Cho thêm một dòng điểm đánh đổi và nút “Kiểm tra một tin bán cây này”.
- So sánh: làm nổi bật chênh lệch có liên quan đến câu hỏi người chơi (trọng lượng, điểm cân bằng, độ cứng, năm ra mắt, giá có offer); cho đưa tối đa hai lựa chọn thay thế vào cùng tin gốc. Tiếp tục giữ bảng kỹ thuật đầy đủ cho người chơi nhiều kinh nghiệm.
- Nội dung hướng dẫn: một trang ngắn “Mua vợt cũ cần hỏi gì?” liên kết từ kết quả; video đánh giá chỉ thêm ở P2, ghi nguồn và phân biệt người chơi thực tế với người bán.

## 4. Thiết kế backend và hợp đồng dữ liệu

### 4.1. Luồng P0 không lưu tin Facebook

1. Trang `/[locale]/check` là Server Component có shell tĩnh và phần đọc `searchParams`/dữ liệu đặt sau `Suspense`, theo cấu trúc Finder hiện tại. `params` và `searchParams` là async theo Next.js 16 đang cài.
2. Component client nhỏ chỉ quản lý form và gợi ý tên vợt. Submit bằng điều hướng tới URL kết quả đã chuẩn hóa; server kiểm tra lại toàn bộ input. Không gọi Server Action để ghi dữ liệu vì P0 không ghi tin đăng.
3. Thêm `GET /api/rackets/search?q=` (hoặc mở rộng truy vấn hiện có nếu đáp ứng được) trả tối đa 8 mẫu với ID, brand, tên, năm, thumbnail và các phiên bản. Chuỗi tìm dài/thiếu hợp lệ trả 400; debounce ở client; truy vấn DB có giới hạn, không dựng `loadIndex()` cho mỗi ký tự gõ. Kiểm tra plan truy vấn và bổ sung index chỉ nếu số đo cần.
4. Thêm hàm thuần trong `src/lib/listing-check/`: chuẩn hóa input, tính độ phù hợp dựa trên `finder.ts`, chọn điểm đánh đổi, xây checklist và xác định trạng thái giá. Đặt truy vấn ở `src/lib/data/listing-check-repository.ts`; tải đúng racket, variant, các offer còn hàng và lịch sử liên quan. Không lặp công thức trong SQL, component và TypeScript.
5. URL kết quả chỉ chứa `racketId`, `variantId?`, `priceVnd?`, `condition?` và lựa chọn không nhạy cảm. Giới hạn chiều dài/giá trị, bỏ khóa lạ. Không chứa URL Facebook, ảnh, mô tả bài, thông tin người bán hoặc vấn đề sức khỏe. Đặt `noindex` cho kết quả có query người dùng; trang `/check` trống có thể lập chỉ mục.

**Kiểu kết quả thống nhất cho frontend:** `modelMatch: exact | ambiguous | missing`; `fit: supported | needs_profile | uncertain` cùng `reasons[]` và `tradeoffs[]`; `price.status: comparable | reference_only | insufficient | stale` cùng `evidence[]`, `observedAt`, `source`, `sampleSize`; `questionsForSeller[]`; `alternatives[]`. Mỗi nhãn trên UI được sinh từ trạng thái có cấu trúc, không suy đoán từ một điểm số duy nhất.

### 4.2. Quy tắc nhận diện mẫu

- Chuẩn hóa chữ hoa/thường, khoảng trắng và dấu phân tách; tra cứu thương hiệu + tên mẫu; giữ riêng Play/Tour/Pro, đời vợt, 3U/4U và cỡ cán. Không dùng một `slug` gần giống làm khẳng định “đúng mẫu”.
- Trả tối đa 8 ứng viên và mức khớp; người mua xác nhận. Khi chỉ có tên “Astrox 77”, hệ thống phải hỏi tiếp phiên bản; khi thiếu năm ra mắt, ghi “chưa xác định đời”.
- Log lỗi nhận diện theo mã/nhóm lỗi, không log nguyên văn bài Facebook. Kiểm tra top 30–50 mẫu thường được hỏi bằng bộ ví dụ biên tập thủ công.

### 4.3. Dữ liệu và migration

**P0:** Ưu tiên không tạo bảng tin đăng mới. Dùng `rackets`, `racket_variants`, `offers`, `price_points` hiện có; kết quả check được tính theo request và không lưu bài Facebook. Nếu cần metric, dùng sự kiện tổng hợp không chứa nội dung tin. Không mở quyền `insert` ẩn danh vào `offers` hoặc `price_points`.

**P1, chỉ khi có quy trình duyệt:** tạo bảng quan sát giá vợt cũ riêng, ví dụ `used_offer_observations` với `id`, `variant_id`, `condition`, `price_vnd`, `source_kind`, `observed_at`, `last_confirmed_at`, `status`, `seller_id?`, `created_at`. Chỉ công khai hàng đã duyệt; ghi rõ ai xác nhận và hạn sử dụng dữ liệu. Nếu nhận đóng góp từ người dùng, dùng hàng đợi riêng, chống spam và không biến một lần gửi thành dữ liệu giá được xác minh. Không nhập lại bài/ảnh từ nhóm kín để công khai. RLS: công chúng chỉ đọc bản duyệt, người gửi chỉ đọc mục của mình nếu có tài khoản, nhân viên duyệt mới được xuất bản. Admin app cần màn hình duyệt/sửa/xóa và nhật ký thay đổi.

**P2:** bảng video được biên tập theo `racket_id`, URL nguồn, tác giả, ngôn ngữ, ngày, chủ đề, mốc thời gian và trạng thái duyệt; chỉ công khai mục đã duyệt. Cập nhật CSP và đo tác động tải trang trước khi nhúng player; link tới video là phương án mặc định nếu embed làm chậm trang.

Mỗi migration mới phải chạy được sau các migration hiện có, có `check`, index phù hợp, RLS và đường lùi khi database chưa nâng cấp. Dữ liệu mẫu và trang không có Supabase phải ghi rõ là **dữ liệu mẫu**, không hiển thị như giá thị trường hiện hành.

### 4.4. Các luồng nối tiếp P1/P2

| Luồng | Frontend | Backend và điều kiện |
| --- | --- | --- |
| Lưu cảnh báo giá | Sau khi người mua xem mốc giá, nút “Báo tôi khi giá cửa hàng xuống dưới…” mở bước đăng nhập chỉ lúc họ muốn lưu; nói rõ cảnh báo áp dụng cho offer Timvot theo dõi, không theo dõi bài trong nhóm riêng tư. | Tái sử dụng `watchlist` và luồng thông báo hiện có; kiểm tra variant, mục tiêu giá, chống tạo trùng, lần quét kích hoạt, và trạng thái gửi. Không yêu cầu tài khoản cho kết quả check. |
| Góp ý sai mẫu/giá | Nút “Thông tin chưa đúng?” với lý do chọn sẵn (`sai_mau`, `sai_phien_ban`, `gia_cu`, `khac`); phần mô tả tự do là tùy chọn sau. | Bản đầu ghi event tổng hợp; nếu cần xử lý từng báo cáo, tạo hàng đợi riêng, giới hạn tần suất, lọc thông tin cá nhân và chỉ nhân viên xem. Không sửa giá công khai trực tiếp từ một báo cáo ẩn danh. |
| Cây vợt đang dùng và mục tiêu | Hỏi sau kết quả đầu, cho bỏ qua; giải thích cụ thể vì sao gợi ý khác cây đang dùng. | Mở rộng input `finder.ts` theo phiên bản để link cũ vẫn đọc được; test những cặp vợt thực tế, tránh biến “nâng cấp” thành mặc định mua vợt đắt hơn. |
| Video đánh giá | Thẻ nguồn gồm tác giả, ngày và chủ đề; click mới tải player hoặc mở YouTube. | Admin duyệt URL/mốc thời gian/nội dung liên quan tới đúng đời vợt; không lấy lời người bán làm đánh giá độc lập và không sao chép video lên Timvot. |
| Ảnh và OCR | Người mua chủ động chọn ảnh, xem trước phần tên/phiên bản được nhận diện và sửa trước khi phân tích. | Chỉ xét sau thử nghiệm P0; xác định cách xử lý ảnh, quyền lưu/xóa và độ chính xác bằng tập ảnh thật. Kết quả OCR luôn là gợi ý cần người dùng xác nhận, không là chứng nhận hàng thật. |

## 5. Quy tắc giá bắt buộc trước khi nói “giá tốt”

1. **Không so nhầm đối tượng:** cùng `variant_id`; tách `new`, `open-box` và các mức `used-*`. Nếu phiên bản hoặc tình trạng chưa rõ, chỉ hiển thị mốc tham khảo có nhãn, không kết luận.
2. **Chỉ dùng offer còn khả dụng:** `status = live`, `qty_available > 0`, ghi ngày quan sát. Định nghĩa ngưỡng “còn mới” trong cấu hình sản phẩm (đề xuất thử 48 giờ với lịch quét hiện tại), kiểm tra theo thực tế vận hành. `updated_at` của offer là lần cập nhật bản ghi, không mặc nhiên là người bán vừa xác nhận tồn kho.
3. **Ngưỡng bằng chứng:** khi có ít nhất 3 tin hợp lệ từ ít nhất 2 người bán độc lập, cùng phiên bản/tình trạng và còn trong cửa sổ mới, mới thử hiển thị khoảng giá/trung vị với cỡ mẫu. Dưới ngưỡng đó ghi “chưa đủ dữ liệu”. Với vợt cũ, tình trạng do người bán khai chỉ cho phép mốc tham khảo, không đủ để chứng nhận món hời.
4. **Giá niêm yết và giá bán:** MSRP là giá tham khảo riêng. Không lấy `lowestPrice ?? msrp` làm “giá hiện tại”; nếu không có offer thì trả `currentOfferPrice = null`.
5. **Lịch sử giá:** `variantPriceFromPoints()` đang dùng 1/3 cuối số quan sát cho `median30`. Trước khi hiển thị nhãn “30 ngày”, hoặc sửa hàm thành cửa sổ ngày lịch thực và cập nhật mọi nơi cùng kiểm thử, hoặc đổi nhãn thành “các lần ghi nhận gần đây”. Không dựng công thức thứ hai cho màn hình check.
6. **Tổng chi phí:** hiển thị phí vận chuyển, căng cước, bảo hành nếu có; khi thiếu ghi “chưa bao gồm/chưa rõ”. Không gọi “rẻ nhất” trên giá chưa đủ các khoản cần so.

Đặt chính sách này trong hàm thuần có test theo tình huống: thiếu variant, không có offer, một seller, offer quá cũ, vợt mới so với cũ, cùng ngày nhiều giá, giá bất thường, dữ liệu mẫu, và không có Supabase. UI phải hiển thị đúng trạng thái `insufficient`/`reference_only` thay vì số 0 hoặc lời khen giá chung chung.

## 6. Quyền riêng tư, bảo mật và vận hành

- Không quét hoặc tự truy cập bài trong nhóm riêng tư. P0 không nhận ảnh hay nội dung bài đăng vào máy chủ. Nếu P1 có ảnh, chỉ tải khi người dùng chủ động chọn, giới hạn kích thước/loại tệp, xóa metadata nhạy cảm, có thời hạn lưu và cơ chế xóa; ảnh không tự trở thành nội dung công khai.
- Xác thực toàn bộ dữ liệu từ URL ở server. Endpoint tìm kiếm công khai cần giới hạn độ dài, kết quả, tần suất và không để truy vấn DB toàn bảng theo mỗi phím gõ. Không dùng URL do người dùng nhập làm lệnh fetch phía server; tránh SSRF và open redirect.
- Không gửi tên/ảnh/người bán, URL bài Facebook, giá cá nhân hoặc câu trả lời về vai/khuỷu tay vào analytics, log hay Open Graph. Không suy ra khuyến nghị y khoa từ câu hỏi khó chịu ở vai/tay.
- Nhãn “người bán đã xác minh” chỉ áp dụng cho người bán mà Timvot đã kiểm tra theo quy trình hiện có; một tài khoản Facebook ngoài hệ thống không được kế thừa nhãn này. Giữ vị trí quảng bá tách khỏi thuật toán độ phù hợp và đánh giá giá.
- Cache theo dữ liệu catalogue/offer đã chuẩn hóa; kết quả chứa input cá nhân không cache công khai. Gắn cache tag hiện có (`TAG.rackets`, `TAG.offers`, `TAG.pricePoints`) vào phần đọc tương ứng và kiểm tra việc scraper làm mới dữ liệu. Giới hạn response, theo dõi thời gian tải lạnh và dung lượng truyền trên Vercel Hobby.

## 7. Đo lường sản phẩm và chất lượng

Sự kiện tối thiểu: `check_started`, `model_selected`, `check_completed`, `price_insufficient`, `seller_questions_copied`, `compare_opened`, `retailer_offer_opened`, `check_feedback_submitted`. Thuộc tính chỉ gồm nguồn truy cập, locale, trạng thái nhận diện, trạng thái giá và loại hành động; không chứa nội dung bài, URL Facebook, dữ liệu sức khỏe hay danh tính người bán cá nhân.

Theo dõi thêm độ phủ dữ liệu: % top model có ảnh, năm ra mắt, đúng variant, offer còn mới; % lượt check không đủ dữ liệu giá; số báo cáo sai mẫu/giá/tồn kho. Đo thời gian từ mở trang tới thấy kết quả và tới hoàn tất thao tác trên điện thoại mạng chậm. Mục tiêu nội bộ ban đầu: 8/10 người dùng thử hiểu kết luận và biết việc cần làm tiếp; không có trường hợp vợt cũ bị gọi “giá hời” chỉ dựa vào lịch sử giá vợt mới.

## 8. Chia việc theo PR có thể kiểm tra độc lập

| PR | Frontend | Backend/dữ liệu | Kiểm thử và điều kiện hoàn thành |
| --- | --- | --- | --- |
| 0. Audit dữ liệu và ngôn ngữ giá | Liệt kê mọi chỗ hiện `lowestPrice ?? msrp`, “30 ngày”, “còn hàng”, “đã xác minh”. | Kiểm tra top 30–50 mẫu, variant, giá, nguồn, thời gian cập nhật; chốt bảng trạng thái giá ở mục 5. | Có tập tình huống thật và danh sách lỗi được phân loại; chưa quảng bá “kiểm tra giá” trước khi xong. |
| 1. Nền tảng giá đáng tin | Phân biệt giá đang bán và MSRP trên Finder/card liên quan; trạng thái thiếu dữ liệu. | Hàm thuần `priceContext`, truy vấn offer đúng variant/condition, sửa hoặc đổi nhãn `median30` nhất quán. | Unit test các ca ở mục 5; e2e xác nhận không có offer thì không hiện giá mua ngay. |
| 2. Trang kiểm tra tin P0 | Trang `/[locale]/check`, form mobile, tìm mẫu, lỗi và kết quả ba câu hỏi, nút sao chép. Cập nhật `messages/vi.json` và `messages/en.json`. | Tra cứu mẫu giới hạn; `listing-check` domain/repository; xác thực input; noindex kết quả có query. | E2E vi/en: đúng mẫu, mơ hồ, không có mẫu, thiếu giá, thiếu offer, mạng lỗi; accessibility keyboard/screen reader và 320px/375px. |
| 3. Kết nối hành trình | Ba lối vào trang đầu, CTA từ Finder/detail/compare vào Check; so sánh tin gốc với lựa chọn khác; link chia sẻ an toàn. | Truy vấn thay thế có giới hạn; trạng thái URL công khai chỉ gồm dữ liệu đã cho phép. | Người dùng đi từ `/vi/check` → kết quả → so sánh → quay lại mà không mất input; link chia sẻ không chứa dữ liệu nhạy cảm. |
| 4. Phát hành thử và đo | Gắn sự kiện, câu hỏi hữu ích ngắn, sửa copy theo quan sát. | Theo dõi lỗi/cold path, kiểm tra tần suất dữ liệu giá, feature gate để chỉ mời dùng thử rồi mở CTA công khai. | 10 buổi quan sát trên mobile; QA dữ liệu; kiểm tra `typecheck`, test liên quan, build và Playwright. |
| 5. Lưu và góp ý P1 | Gắn cảnh báo giá với kết quả theo đúng variant; form góp ý sai thông tin; hỏi tùy chọn về cây đang dùng/mục tiêu. | Tái sử dụng `watchlist`, kiểm tra kích hoạt thông báo; hàng đợi góp ý nếu cần; mở rộng Finder có tương thích link cũ. | Người mua không đăng nhập vẫn xem kết quả; cảnh báo chỉ theo offer được theo dõi; góp ý ẩn danh không tự sửa dữ liệu công khai. |
| 6. Dữ liệu vợt cũ P1 | Hiển thị mốc giá vợt cũ theo điều kiện và số mẫu, biểu mẫu góp ý sai dữ liệu. | Migration bảng quan sát + RLS; quy trình duyệt admin; hạn dùng dữ liệu; chống trùng và spam. | Không có quan sát chưa duyệt lọt ra công khai; dữ liệu cũ/tình trạng khác không ảnh hưởng kết luận. |
| 7. Bằng chứng P2 | Video nguồn ngoài, đánh giá theo ngữ cảnh người chơi; thử ảnh/OCR khi có nhu cầu thật. | Lưu nguồn được duyệt; kiểm tra quyền ảnh, độ chính xác OCR và tác động tải trang. | Không tăng tải trang đáng kể; không gợi ý lời nhận xét không có nguồn; so sánh người dùng hiểu trước/sau. |

PR 0–4 là đường phát hành P0. PR 5–7 chỉ bắt đầu sau khi có kết quả dùng thử; PR 6–7 còn cần người phụ trách nội dung/kiểm duyệt. Nếu một PR đụng vào nhiều TSX component, chạy bước rà soát React theo quy định dự án.

## 9. Danh sách nghiệm thu trước khi mở công khai

- Người mua không đăng nhập vẫn tìm, kiểm tra và so sánh được trên điện thoại; không có paywall cho các bước này.
- Tin “Astrox 77” mơ hồ phải hỏi lại Play/Tour/Pro; bản 3U không dùng giá của 4U để kết luận.
- Tin vợt cũ không được so trực tiếp với chuỗi giá vợt mới; ít dữ liệu phải hiện “chưa đủ dữ liệu”. MSRP, giá có offer và giá do người mua nhập được gắn nhãn riêng.
- Mọi kết luận có lý do, điểm cần cân nhắc, nguồn/độ mới dữ liệu và câu hỏi có thể gửi người bán.
- Link chia sẻ và analytics không lộ nội dung nhóm riêng tư, URL Facebook, ảnh, người bán cá nhân hoặc câu trả lời về sức khỏe.
- Hai locale đầy đủ; mobile 320px trở lên không tràn ngang, nút không đè thanh điều hướng, dùng được với bàn phím và trình đọc màn hình.
- Đường đọc mới không dựng toàn bộ index catalogue cho một lượt gõ hoặc lượt check; có số đo tải lạnh và kiểm tra khi DB thiếu migration/Supabase chưa cấu hình.
- Bộ test liên quan, typecheck, build và luồng Playwright đều qua trước khi phát hành. Đã thử tay với ít nhất 10 người mua thật và sửa các hiểu lầm lặp lại.

## 10. Quyết định cần giữ trong quá trình triển khai

1. **Câu chữ theo độ chắc chắn của dữ liệu**, không theo mong muốn quảng cáo. “Chưa đủ dữ liệu” là một kết quả hợp lệ.
2. **Một công thức cho mỗi nhận định**, dùng chung giữa Finder, trang check, trang chi tiết và so sánh; không sao chép logic giá/độ phù hợp vào nhiều tầng.
3. **Bản đầu không cần lưu bài Facebook** để hữu ích. Điều này giữ trải nghiệm nhanh, giảm rủi ro riêng tư và cho phép thử nghiệm trước khi xây hệ thống tin đăng.
4. **Người mua miễn phí và có quyền rời đi bất cứ lúc nào.** Chỉ yêu cầu tài khoản khi họ chủ động lưu hoặc gửi nội dung cần gắn với một người dùng.
