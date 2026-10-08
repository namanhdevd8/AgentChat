# Các thay đổi

## 0.2.0 · 2026-10-08

### Mới
- Giao diện tối giản: viền mảnh, một màu nhấn, avatar chữ viết tắt theo màu của từng agent, font Inter và JetBrains Mono.
- Mục **Cần bạn** gom các tin agent hỏi bạn, chuỗi đang dừng chờ tiếp tục và yêu cầu cấp quyền. Duyệt, yêu cầu sửa hoặc từ chối ngay trên thẻ; mỗi không gian có badge đếm việc, kèm thông báo hệ thống.
- Dòng agent đang chạy có đồng hồ, "lượt N (tối đa M)", ước tính thời gian còn lại và nhắc khi agent im lặng lâu.
- Timeline: agent nào chạy lúc nào, bao lâu.
- Bảng task nhóm theo trạng thái, có thanh tiến độ; nhóm Xong thu gọn sẵn.
- Phím tắt: ⌘K chuyển không gian (gõ không dấu), ⌘1…9, ⌘J tới box đang cần bạn, ⌘F tìm, ⌘⇧T timeline, ⌘, cài đặt.
- Nháp tin nhắn giữ riêng cho từng box; dải phân cách ngày trong lịch sử chat.
- Icon mới, mục Giới thiệu kèm danh sách thay đổi; cửa sổ nhớ kích thước và vị trí.

### Sửa
- Danh sách file chung dài không còn đè bảng task; mọi danh sách dài cuộn trong khung của nó.
- Agent không nhận lại toàn bộ bối cảnh ở mỗi lượt của phiên đang dùng.
- Kiểm tra merge chạy ngoài khoá git, không còn chặn các agent khác.
- Lịch sử chat không còn hở tin khi cuộn trang; gửi lỗi thì trả lại nội dung vào ô soạn.
- Hỏi trước khi thoát app lúc agent vẫn đang chạy.

### Bảo mật
- Agent chỉ chạy theo cấu hình nhóm bạn đã chấp nhận; cấu hình bị sửa trên đĩa phải được duyệt lại.
- Lệnh chạy và kiểm tra merge của codex/agy chạy trong sandbox; chế độ chỉ đọc áp dụng cho mọi CLI.
- Giá trị trong file của box không bao giờ thành tham số dòng lệnh; ghi file an toàn với symlink; git do app chạy bỏ qua hook của repo.
- Chính sách nội dung chặt hơn; hỏi trước khi mở link có chữ hiển thị khác địa chỉ thật.

## 0.1.0 · 2026-10-07

Bản đầu tiên.
- Mỗi folder dự án là một box chat của nhóm agent (Claude Code, Codex, agy); một folder có thể có nhiều box độc lập.
- Gọi agent bằng @tên, không có @ thì PM nhận; chuỗi agent gọi nhau có giới hạn lượt.
- Bảng task, file chung và bộ nhớ chung của nhóm.
- Worktree riêng cho từng agent và hàng chờ merge có bước kiểm tra.
- Tìm kiếm và cuộn trang lịch sử, thống kê token và chi phí.
- Quản lý phiên của từng CLI, cấp quyền công cụ ngay trong chat.
- Chạy trên macOS và Windows.
