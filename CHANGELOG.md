# Các thay đổi

## 0.9.0 · 2026-10-14

### Mới
- Panel phải có hai tab: **Tổng quan** (Cần bạn, Bảng task, Hàng chờ merge, File chung) và **Dự án**. Tab Tổng quan hiện số mục đang cần bạn.
- Tab **Dự án** hiện cây file của thư mục chính, của nhánh chưa gộp của một agent, hoặc của một commit gần đây. File đã đổi có nhãn M (sửa), A (thêm), D (xoá), U (mới, chưa commit); thư mục chứa file đổi có chấm. Có nút "Đã đổi" để chỉ hiện file thay đổi và ô lọc theo tên.
- Bấm file đã sửa hoặc đã xoá thì xem diff ngay trong khung xem. Chuột phải để mở file, xem thay đổi, chép đường dẫn tương đối hoặc đầy đủ.

### Thay đổi
- Mỗi lượt của agent vào nhánh chính thành đúng một commit (squash), không còn cặp "agent X: hoàn tất lượt" + "merge agent X". Tên commit là agent và việc đã làm, ví dụ `dev-be · T43 Xem diff mỗi lượt`, hoặc các file đã sửa khi lượt không gắn task.
- Sau khi gộp, nhánh của agent đang rảnh được đưa về nhánh chính ngay; agent đang chạy thì được đưa về ở đầu lượt kế tiếp.

## 0.8.0 · 2026-10-13

### Mới
- Nút **Cài đặt** ở cuối sidebar thay cho dòng phiên bản. Cửa sổ cài đặt có sidebar các mục và ô tìm kiếm (gõ không dấu cũng được).
- **Agent:** app tự tìm `claude`, `codex`, `agy` trong PATH và các thư mục cài đặt thường gặp (Homebrew, npm, nvm, bun…), hiện phiên bản và từng tài khoản đã đăng nhập chưa. Có nút Quét, Kiểm tra kết nối và Thêm thủ công để chọn file chạy khác. App mở từ Finder vẫn tìm được CLI dù không lấy được PATH của shell.
- **Font chữ:** chọn font giao diện trong các font đã cài trên máy, và cỡ chữ tin nhắn từ 12 đến 20px.
- **Giới thiệu:** phiên bản, tác giả, giấy phép, link mã nguồn và danh sách thay đổi, thay cho hộp thoại Giới thiệu cũ.
- Các mục MCP, Skill, Ngôn ngữ và các CLI Gemini, Qwen, Kimi, Copilot, Cursor được ghi "sắp có".

### Thay đổi
- Cài đặt nhóm bỏ nút "+ Thêm agent" (đã có nút + cạnh "Thành viên") và nút "Kiểm tra kết nối" (chuyển sang Cài đặt › Agent).
- Khi không tìm thấy CLI, lỗi trong chat chỉ tới Cài đặt › Agent thay cho `spawn ENOENT`.

## 0.7.0 · 2026-10-13

### Mới
- Khung xem file đổi được cỡ: kéo góc hoặc dùng phím mũi tên, có nút Phóng to / Thu nhỏ. App nhớ cỡ và chế độ lần trước.
- Bấm link tới ảnh PNG, JPEG, GIF, WebP hoặc SVG thì xem ngay trong khung, có nút "Vừa khung" và "100%". Ảnh SVG cũng hiện được trong chat và trong file `.md`.
- File HTML có hai tab Xem trước và Mã nguồn. Bản xem trước không chạy JavaScript, không tải mạng, không điều hướng ra ngoài; CSS và ảnh trong dự án vẫn hiện. Nút "Mở bằng trình duyệt" hỏi lại trước khi mở bản đầy đủ.
- Link tới file trong tin của agent mở được trong app, kể cả link `file://`, đường dẫn tuyệt đối trong nhánh riêng của agent, và tên file như `renderer.js` trong chữ hoặc trong code.
- Các tin hệ thống thành công liên tiếp ("chuyển T… sang…", "Đã gộp nhánh…") được gom thành một dòng "N cập nhật · Xem". Lỗi và chuỗi bị dừng vẫn hiện đủ.
- File chung ghim `memory.md` và `roadmap.md` lên đầu, các file khác nhóm theo sprint. Hàng chờ merge ẩn khi trống. Header các mục ở cột phải rõ hơn, có icon và mũi tên mở/đóng.
- Thanh đang chạy hiện nhãn ngắn ("Đang chạy lệnh"), bấm vào mới xem đủ lệnh. Nút "Timeline · Chi phí" dễ thấy hơn.

### Sửa lỗi
- Agent mở phiên mới theo cỡ ngữ cảnh của bước cuối trong lượt, không theo tổng token của cả lượt. Lượt dùng nhiều công cụ không còn bị xoay phiên sớm. Popup trên avatar hiện cỡ ngữ cảnh.
- Hàng chờ merge không còn kẹt ở "Thiếu dependency" khi nhánh chính chỉ đổi số phiên bản. Dependency được kiểm sau khi gộp thử, nên nhánh đổi dependency thật vẫn bị chặn.
- Agent tự gộp nhánh chính vào nhánh của mình thì các file mang về từ nhánh chính không còn bị tính là sửa ngoài phạm vi, và lượt đó vẫn được xếp hàng gộp.
- Mỗi lần gộp không thành công đều có một tin hệ thống trong chat.
- agy: lượt đã trả lời xong không còn bị báo lỗi chỉ vì agy kèm lỗi của lượt trước (hết quota, lỗi 500 đã tự thử lại). Thông báo lỗi không còn lặp lại cùng một câu kèm JSON thô.

### Bảo mật
- Cửa sổ app chạy ở chế độ sandbox. Chỉ trang chính mới gọi được IPC, khung xem trước HTML thì không.

## 0.6.0 · 2026-10-12

### Mới
- Thu hồi tin của bạn: rê chuột lên tin, bấm nút thu hồi hai lần. Agent không còn thấy nội dung tin; lượt chỉ do tin đó gọi (đang chờ hay đang chạy) bị dừng. Nếu ô soạn đang trống, nội dung tin được trả lại để sửa rồi gửi lại.
- Bộ icon SVG riêng thay cho emoji (⚙, 🌿, ⏱, ⚠️, 🚫, ✕…), cùng nét vẽ với giao diện app.

### Sửa lỗi
- Agent không còn bị chặn mãi với lỗi "Workspace có thay đổi chưa được app ghi nhận". App kiểm tra workspace khi lượt bắt đầu chạy thay vì lúc xếp hàng. App cũng chấp nhận việc agent tự commit hoặc tự gộp nhánh, và tự commit thay đổi còn sót từ lượt trước nếu nằm trong phạm vi của agent.

## 0.5.0 · 2026-10-12

### Mới
- Dòng tên trên mỗi tin của agent hiện cả model đã chạy lượt đó, ví dụ `claude · opus-5-5`, `codex2 · GPT-6.1-Sol`. Claude báo đúng model thật, kể cả khi để Mặc định hoặc chọn tên tắt như opus; Codex lấy model đã chọn hoặc model mặc định trong cấu hình của tài khoản; agy chỉ hiện khi bạn chọn model trong ⚙.

## 0.4.0 · 2026-10-12

### Mới
- Dán (⌘V) hoặc kéo ảnh PNG, JPEG, GIF, WebP vào ô soạn: ảnh hiện thành ảnh thu nhỏ có nút × để bỏ, và được gửi kèm tin nhắn. Ảnh đang soạn được giữ riêng cho từng box như phần chữ.
- Ảnh hiện ngay trong khung chat, kể cả ảnh agent gửi; bấm vào ảnh để mở cỡ lớn.
- Agent (Claude, Codex, agy) nhận đường dẫn ảnh và tự mở ảnh để xem. Agent cũng gửi được ảnh, ví dụ ảnh chụp màn hình, vào chat.

### Bảo mật
- Ảnh được nhận theo nội dung file, không theo đuôi; SVG và file nằm ngoài dự án bị chặn. Ảnh từ link ngoài không tự tải mà chỉ hiện thành link.

## 0.3.0 · 2026-10-09

### Mới
- Kéo mép trái panel bên phải để đổi độ rộng, tối đa 1/3 cửa sổ (khung chat luôn giữ tối thiểu 520px); bấm đúp để về mặc định, app nhớ độ rộng.
- Chi phí (token, USD) của cả box chuyển vào Timeline; panel bên phải gọn còn Bảng task và File chung.
- Nút giao diện ở chân sidebar: Theo hệ thống, Sáng, Tối; menu và hộp thoại hệ thống đổi theo, app nhớ lựa chọn.

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
