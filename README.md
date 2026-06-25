# disk-cleaner

Tool dọn ổ cứng trên terminal cho macOS.

```bash
npm start
```

Phím:

- `↑` / `↓`: di chuyển
- `Enter`: mở mục / chuyển mục đang chọn vào Thùng rác
- `r`: quét lại
- `q`: quay lại / thoát

An toàn:

- Ưu tiên dùng lệnh `trash` của macOS.
- Nếu không có `trash`, dùng Finder qua AppleScript.
- Không xoá trực tiếp các path bảo vệ như `/`, `/System`, `/Applications`, `~`, hoặc `~/Library`.
- Mục gợi ý chủ yếu là cache, simulator/device support, package cache, artifact dev có thể tạo lại.

Tính năng nên thêm sau:

- Chọn nhiều mục bằng `space`.
- Xuất report Markdown.
- Lọc file cũ theo thời gian.
- Mode dọn `node_modules` theo từng project.
