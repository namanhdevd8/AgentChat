# Mở file từ tin nhắn agent — 2026-10-13

## Nguyên nhân và thay đổi

Ảnh `img-44f8fd41c23b.png` có link Markdown trỏ tới `file:///…/renderer.js`, `index.html`, `check.js` trong worktree của dev-fe. Bộ Markdown từ chối `file:`, nên hiện nguyên cú pháp thay vì link. Viewer đã đọc được văn bản UTF-8 ngoài Markdown; vấn đề chính nằm ở nhận diện và định tuyến đường dẫn.

- `renderer.js`: nhận link Markdown `file://`; tự tạo link cho tên/đường dẫn mã nguồn, cấu hình và tài liệu phổ biến, kể cả trong inline code. Bỏ qua code block và link đã có. Link file đi qua IPC của viewer.
- `core.js`: giải mã file URL bằng API URL của Node, giữ kiểm tra phạm vi, symlink, kích thước và UTF-8.
- `main.js`: đường dẫn tuyệt đối xác định đúng dự án hoặc worktree đã đăng ký của dự án/box đang mở, kể cả tin cũ không có metadata workspace. Link `.chat` của worktree đọc dữ liệu chung. IPC trả thêm `workspace: {id, branch} | null` để FE giữ nhánh khi tải lại/đọc link tiếp theo.
- Tên file có khoảng trắng, dấu tiếng Việt, `%` và `#` được mã hóa lại khi tải lại/theo dõi file. HTML và mã nguồn hiển thị bằng `textContent` trong `<pre>`.

## Các định dạng

| Loại | Cách xem |
| --- | --- |
| `.md` | Render Markdown |
| Văn bản UTF-8, ví dụ `.js`, `.ts`, `.html`, `.css`, `.json`, `.yaml`, `.txt`, `.csv`, `.py` | Xem nội dung trong app, tối đa 2 MiB; không phụ thuộc đuôi file khi có link rõ ràng |
| PDF/ảnh nhị phân | Giữ luồng hiện có: ảnh Markdown được xem trong chat; file đủ điều kiện trong `reports/` hoặc `.chat*/` có nút mở bằng ứng dụng ngoài |
| Thư mục, file ngoài dự án/worktree đã đăng ký | Hiện lý do không mở được |

Chưa thêm trình xem PDF/Office hay chạy HTML trong app. Đường dẫn dài có khoảng trắng nên dùng link Markdown với URL mã hóa; tên file tự nhận diện trong văn bản thuần chỉ là tiện ích cho các dạng phổ biến.

## Kiểm tra và bàn giao

`npm run check` đạt (exit 0), gồm renderer VM, core thật và main IPC với Electron giả lập + repo/worktree Git thật trong thư mục tạm. Các ca mới: link giống ảnh, định dạng văn bản, ký tự đặc biệt, nhánh chưa gộp khác main, tải lại giữ nhánh, `.chat` dùng chung, thư mục có tên gần giống worktree bị từ chối, link ngoài dự án/symlink bị chặn, HTML hiện dạng text. `git diff --check` và kiểm tra cú pháp Node đạt.

Sau khi gộp cần **khởi động lại app** vì thay đổi `main.js` và `core.js`. Chưa kiểm tay trong Electron thật: mở link `renderer.js` trong tin cũ của dev-fe; thử Tải lại; mở `index.html` để xác nhận hiện mã nguồn; thử một report Markdown để kiểm hồi quy.

## Nghiệm thu (PM, 2026-10-13)
- QA đã soát độc lập (T41) trên main `93570dc` và báo **đạt**. QA thử 20 cách vượt phạm vi qua IPC thật, tất cả đều bị chặn, kể cả qua `openFile` và `readImage`; các cách này: `..` thô và `%2e%2e`, symlink file và thư mục trỏ ra ngoài, worktree integration, worktree giả, `file://` có host lạ, `.chat/../..`, `fromFile` trỏ ra ngoài. Tất cả các ca đã ghi vào check.js. HTML chỉ hiện dạng chữ, tải lại vẫn giữ đúng nhánh, viewer `.md` không hồi quy.
- T41 → Xong. **T40 giữ Chờ duyệt** cho tới khi End-User khởi động lại app và bấm thử link `renderer.js` và `index.html` trong tin cũ của dev-fe.
- Backlog (lỗi nhẹ, QA báo): tên như "Node.js" hay "Vue.js" trong tin cũng bị tự biến thành link, bấm vào chỉ báo không tìm thấy. Nên chỉ tự tạo link khi file tồn tại, hoặc khi chuỗi có dạng đường dẫn.
