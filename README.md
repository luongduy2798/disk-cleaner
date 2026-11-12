# Disk Cleaner

Web local phân tích và dọn ổ đĩa trên macOS. Node.js **≥20**, không cần cài dependency.

```bash
npm start
```

Lệnh `disk-cleaner` dùng cùng entrypoint khi đã được liên kết/cài như trước. Trình duyệt tự mở địa chỉ `http://127.0.0.1:<cổng-trống>`. Giữ terminal đang chạy; `Ctrl+C` dừng backend. Chỉ truy cập từ máy này, không mở ra LAN. CLI cũ đã được thay bằng web.

## Sử dụng

- **Tổng quan:** mặc định **Macintosh HD · Toàn ổ**, gồm volume macOS và Data. Dung lượng APFS lấy theo toàn container bằng `diskutil`, hiển thị GB thập phân như macOS; tránh chỉ tính volume Data bằng `df`. Nếu không đọc được thông tin APFS thì báo rõ đang dùng số liệu filesystem.
- **Gợi ý dọn dẹp:** vị trí được nhận diện bằng quy tắc, gồm cache, dependency, bộ cài và các mục cần cân nhắc. Gợi ý không đồng nghĩa có thể xoá mà không ảnh hưởng.
- **Thư mục:** cây thư mục tải khi mở nhánh, breadcrumb, tìm kiếm, sắp xếp và phân trang 100 mục. Phạm vi toàn ổ bao gồm `/Applications`, `/Users` (cả các tài khoản đọc được), `/Library`, `/private`, `/opt` và các nhánh khác của ổ khởi động, gồm mục ẩn. Home vẫn có trong danh sách phạm vi. Chọn thư mục hoặc ổ ngoài qua hộp thoại macOS.
- **File lớn:** file chiếm từ **100 MiB dung lượng trên đĩa**, hiển thị thêm dung lượng logic. Sparse file có dung lượng logic lớn nhưng ít block không được tính như file chiếm toàn bộ dung lượng đó.
- Chọn tên để đọc công dụng, bằng chứng, độ chắc chắn, tác động và khả năng tạo lại. Có nút mở vị trí trong Finder.

**Quét nhanh** chạy khi khởi động: nhận diện vị trí quen thuộc, khám phá cache ứng dụng và dependency dự án, đọc chỉ mục Spotlight rồi **tự tính dung lượng các thư mục gợi ý**. Kết quả xuất hiện dần; trạng thái ghi “Chờ tính”, “Đang tính” hoặc “Chưa đầy đủ” khi thiếu quyền. Có thể dừng để giữ kết quả đã đo. Kích thước luôn lấy từ metadata hiện tại, không lưu số đo cố định theo máy.

Ở phạm vi toàn ổ, lượt nhanh đo thêm Ứng dụng và Thùng rác của tài khoản hiện tại. Thanh dung lượng chia **Tài liệu, Ứng dụng, Phát triển, Thùng rác, Dữ liệu hệ thống, macOS**; các nhóm cập nhật dần từ metadata quét, không quyết định mục nào được phép dọn. macOS lấy từ dung lượng volume hệ thống. Phần chưa quét, thiếu quyền, snapshot và volume phụ ghi **Chưa phân loại**. Quy tắc phân nhóm là ước tính, có thể khác cách phân nhóm riêng của Storage trong macOS. Chọn **Quét sâu toàn ổ** để phân tích phần còn lại.

Quy tắc nhận diện cache npm/npx, Bun, Gradle, pip/uv, Flutter, Chrome, Electron, Playwright, gói cập nhật TablePlus và các thư mục cache cụ thể của VS Code cùng một số ứng dụng Electron/Chromium. Không gợi ý toàn bộ Application Support, lịch sử chỉnh sửa VS Code/Android Studio, SDK Android hay thư mục `.cache` chưa xác định. Dependency dự án cần có `package.json`; lượt nhanh chỉ khám phá tới hai cấp trong Desktop/Documents, hoặc hai cấp từ phạm vi con được chọn trong đó.

Kết quả nhanh vẫn **chưa đầy đủ**, có thể thiếu file ẩn, thư mục bị loại khỏi Spotlight, ổ chưa lập chỉ mục hoặc dự án nằm sâu hơn. Thư mục ngoài các gợi ý vẫn ghi “Chưa tính” cho tới khi chọn **Quét sâu phạm vi** hoặc quét riêng mục đang xem. Lượt nhanh có nhiều gợi ý lớn vẫn có thể kéo dài; không cần đợi xong để đọc kết quả.

Khung quét hiển thị **% lớn và thanh tiến độ**. Giai đoạn đo của quét nhanh tính theo số vị trí đã xử lý; quét sâu ghi rõ **ước tính theo nhánh thư mục**, cập nhật tổng nhánh trong cùng lượt duyệt. Các nhánh không có cùng kích thước, nên đây không phải % số file hoặc thời gian còn lại. Khi nhận diện vị trí/đọc Spotlight chưa biết tổng, thanh chạy ở trạng thái chưa xác định. 100% chỉ báo lượt quét đã kết thúc; mục bị bỏ qua và kết quả chưa đầy đủ vẫn được đánh dấu. Dừng quét giữ tiến độ đã có.

Quét sâu dùng một lượt `opendir`/`lstat`, tối đa 16 thao tác I/O cùng lúc, dùng chung dữ liệu giữa các màn hình. Phạm vi toàn ổ cho phép cặp volume macOS/Data đã nhận diện, bỏ `/System/Volumes` và `/Volumes` để tránh cộng trùng hoặc quét nhầm ổ ngoài. Các phạm vi khác không tự vượt filesystem; không đi theo symlink. Hãy chọn ổ ngoài làm phạm vi riêng. Giới hạn độ sâu 256, có thông báo khi bỏ qua. Có thể duyệt kết quả và dừng trong lúc quét; kết quả dừng giữa chừng luôn được đánh dấu. Vùng hệ thống chỉ được xem.

Kết quả và thời điểm đo chỉ nằm trong bộ nhớ tới khi backend dừng. Đổi màn hình không quét lại. **Quét lại** bắt đầu lượt mới, bỏ cache; thay đổi từ ứng dụng khác không được theo dõi tự động. Dung lượng hard link chỉ cộng một lần; APFS clone và snapshot khiến dung lượng thực thu hồi có thể khác ước tính.

## Chuyển Thùng rác

1. Dừng quét hoặc đợi hoàn tất; chọn tối đa 200 mục mỗi lần. Không chọn sẵn mục nào.
2. Xem danh sách, đường dẫn và tác động. Mục chưa rõ hoặc rủi ro cao cần xác nhận bổ sung; mục cha/con được gộp để tránh thao tác trùng.
3. Xác nhận chuyển Thùng rác. Backend kiểm tra lại danh tính, phiên bản, đường dẫn thực và phạm vi; mục thay đổi phải được xem lại. Xác nhận có hiệu lực 2 phút và chỉ dùng một lần.
4. Đọc kết quả thành công/thất bại từng mục. Khôi phục hoặc dọn Thùng rác bằng Finder.

**Chuyển Thùng rác chưa giải phóng dung lượng.** Công cụ không xoá vĩnh viễn. Ưu tiên `/usr/bin/trash`; nếu macOS chưa có lệnh này, dùng Finder qua AppleScript. Không có fallback xoá trực tiếp. macOS có thể hỏi quyền điều khiển Finder.

Vùng hệ thống, symlink, mục đặc biệt, Thùng rác, thư mục người dùng quan trọng và gốc được chọn được bảo vệ. Thao tác dùng ID do server cấp, xác nhận gắn với metadata lúc chọn; lệnh nhận argv, không ghép shell. Dữ liệu, đường dẫn và tên file không gửi tới dịch vụ bên ngoài. Server kiểm tra Host/Origin, cookie phiên HttpOnly/SameSite=Strict; không bật CORS. Tên file được hiển thị bằng text.

## Quyền truy cập

Thiếu quyền vẫn quét phần đọc được, báo phần bị bỏ qua thay vì coi thư mục là rỗng. Dùng **Hướng dẫn quyền truy cập** trong web để mở **System Settings → Privacy & Security → Full Disk Access**. Cấp quyền cho **ứng dụng chạy backend** (Terminal, iTerm, VS Code…), thoát/mở lại ứng dụng đó rồi chạy lại. Không cần cấp Full Disk Access nếu không muốn đọc các vùng được macOS bảo vệ.

Web không thể tự bật Full Disk Access. Hộp thoại gợi ý ứng dụng dựa trên terminal chạy backend và hiển thị đường dẫn Node. Thống kê tách lỗi `EPERM`/`EACCES`, lỗi quét khác và các mục bỏ qua; danh sách ưu tiên tối đa 20 lỗi truy cập. Symlink và mục đặc biệt chỉ gộp số lượng, không lấp danh sách lỗi. Full Disk Access không gỡ mọi giới hạn hệ thống hoặc thay đổi quy tắc bỏ qua liên kết.

## Kiểm chứng

Self-check không có dependency, dùng `node:assert`, chỉ tạo fixture tạm trong repository và giả lập Spotlight, lệnh macOS, thao tác Thùng rác:

```bash
npm run self-check
```

Bao phủ phạm vi chồng lặp, giới hạn I/O, hard link/sparse file, thiếu quyền, symlink, filesystem khác, quét cặp macOS/Data không trùng volume, tổng container APFS và phân nhóm, huỷ quét, tự khám phá và đo gợi ý, phân biệt cache với lịch sử chỉnh sửa, phân loại chưa rõ, tên file đặc biệt, lựa chọn đã cũ, dọn thất bại một phần và bảo vệ HTTP local.

Theo chỉ dẫn hiện tại, **chưa chạy self-check, kiểm tra cú pháp, build, lint hoặc benchmark**. Chưa xác nhận mức tăng tốc bằng đo đạc.
