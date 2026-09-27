# Sprint 2: Trải nghiệm chat và khóa file thật

Người viết: @pm · 2026-09-27. Phạm vi do End-User chốt trong chat.

## Phạm vi

### A. Hiển thị tin nhắn dạng Markdown
- Hiện tại tin nhắn hiện nguyên ký hiệu thô như `**đạt**`. Cần hiển thị đúng định dạng: đậm, nghiêng, `code`, khối code, danh sách, trích dẫn, link, và bảng nếu làm được.
- **An toàn:** không chèn HTML thô từ tin nhắn. Tin của agent là dữ liệu không tin cậy, nên phải chống XSS. Vẫn giữ CSP hiện tại.
- Vẫn giữ tính năng bấm vào đường dẫn `reports/...` và `.chat/...` để mở file.
- Tin nhắn cũ trong log cũng hiển thị theo cách mới. Không đổi định dạng `log.jsonl`.

### B. Gợi ý khi gõ `@`
- Gõ `@` thì hiện danh sách thành viên và lọc theo chữ gõ tiếp, ví dụ `@de` chỉ còn dev-fe và dev-be.
- Phím ↑/↓ để chọn. Enter hoặc → để chèn `@tên `. Esc để đóng.
- Khi danh sách đang mở, Enter chỉ dùng để chọn, không gửi tin.
- Dùng chuột bấm chọn cũng được.
- Gõ tiếng Việt (IME) không làm hiện danh sách sai hoặc gửi tin nhầm.

### C. Ô nhập co giãn
- Ô nhập cao dần theo nội dung, tối đa 1/4 chiều cao box chat. Quá mức đó thì cuộn bên trong ô nhập.
- Gửi tin xong thì ô nhập trở về chiều cao ban đầu.

### D. Giữ vị trí cuộn
- Nếu End-User đang cuộn lên đọc tin cũ, tin mới tới **không được** làm nhảy vị trí cuộn.
- Chỉ tự cuộn xuống cuối khi đang ở gần cuối, hoặc khi End-User vừa gửi tin.

### E. #2 Khóa file thật (theo phạm vi `owns`)
Hiện `owns` chỉ là lời dặn trong prompt và là chữ tự do. Cần:
1. **Chuẩn hóa `owns`** thành danh sách đường dẫn hoặc glob (ví dụ `index.html`, `reports/**`). Để trống nghĩa là toàn dự án. Có thể đánh dấu một agent là chỉ đọc. Phải chuyển đổi được `agents.json` hiện có, và sửa được trong ⚙.
2. **Không chạy chồng phạm vi:** hai agent có phạm vi giao nhau không được chạy cùng lúc; agent sau phải xếp hàng. Trên giao diện hiện rõ lý do chờ, ví dụ `@dev-be chờ @dev-fe (index.html)`. Agent chỉ đọc không bị khóa.
3. **Phát hiện sửa ngoài phạm vi:** sau mỗi lượt, nếu agent sửa file nằm ngoài phạm vi thì chat hiện tin hệ thống liệt kê các file đó. Chỉ cảnh báo, không tự hoàn tác.
4. Nút Dừng và timeout của Sprint 1 vẫn chạy đúng khi agent đang chờ khóa: dừng một agent đang xếp hàng thì phải bỏ nó khỏi hàng.

## Quyết định của PM (2026-09-27)
- Chấp nhận thêm dependency `markdown-it@15.0.2` (production, pin phiên bản, đóng gói trong app) theo sprint-2-design.md.
- `package.json` và `package-lock.json` thuộc phạm vi **dev-be**. `agents.json` hiện vẫn là chữ tự do; khi dev-be chuyển đổi `owns` sang dạng mới thì dùng đúng bảng ở mục 3 của file thiết kế.
- End-User sẽ sửa lại phạm vi trong ⚙ nếu muốn khác.

## Trạng thái (2026-09-27)
- **BE:** dev-be báo đã xong, `npm run check` xanh.
- **FE:** dev-fe báo đã xong A–E. PM grep thấy có code cho `markdownit(`, phím ↑/↓/→, IME, `nearBottom` và `readOnly`. Như vậy mới biết code có mặt, chưa biết chạy đúng hay không.
- **QA:** đã nhận việc nghiệm thu (được gọi từ tin bàn giao của dev-fe). Đang chờ kết quả `npm run check` và kiểm tra tay theo tiêu chí ở trên.

## Sự cố 2026-09-27 01:11: mọi lượt agent đều báo lỗi "File thay đổi trong lúc kiểm tra"
- **Nguyên nhân:** snapshot (mục E3) quét cả `dist/`. Trong Electron, `fs` coi `app.asar` là thư mục, nên app đi vào bên trong bản build cũ và `lstat` của các file ảo không ổn định giữa hai lần đọc. `npm run check` không bắt được lỗi này vì chạy bằng Node thường.
- **Đã sửa (hotfix trong `core.js`):** snapshot dùng `original-fs` khi chạy trong Electron, nên `.asar` được băm như một file. Kiểm tra trong Electron: 289 file, 216 ms, không lỗi. `npm run check` vẫn xanh.
- **Còn phải làm (dev-be):**
  1. Snapshot lỗi thì chỉ cảnh báo, không được huỷ cả lượt agent.
  2. Loại `dist/` (thư mục build) khỏi snapshot. PM quyết định, thay cho quyết định trước đó của techlead là không loại dist.
  3. Sửa lỗi qa đã báo: `saveTeam` phải bỏ cờ `scopeNeedsReview` khi có `scopeConfirmed:true`.

## Nghiệm thu (2026-09-27)
- **Đạt:** hotfix asar; lỗi quét chỉ cảnh báo; bỏ quét `dist/` và `.DS_Store`; `saveTeam` bỏ đúng cờ review; dev-fe và dev-be chạy song song; có `locks.json` và backup migration; `npm run check` xanh.
- **Cấu hình sai (End-User sửa trong ⚙):** techlead đang có `owns: []`, tức toàn quyền sửa dự án và khóa cả dự án mỗi khi chạy. Theo thiết kế thì phải là `["reports/**"]`. Migration đã biến mô tả "chỉ đọc code" thành toàn quyền.
- **Còn chờ End-User thử tay:** gõ `@de` ↓ Enter; gửi `<img src=x onerror=alert(1)>`; cuộn lên đọc tin cũ khi có tin mới; bấm Dừng một agent đang "chờ".
- **ĐÃ ĐÓNG (2026-09-27):** End-User xác nhận mọi thứ hoạt động tốt.
- Rủi ro còn mở: techlead vẫn `owns: []` (toàn quyền, khóa cả dự án), chờ End-User sửa trong ⚙.

## Ngoài phạm vi
- **Dừng agent khi tắt app: End-User quyết định KHÔNG làm.**
- Diff, hoàn tác, kanban.

## Phân công
1. **@techlead:** thiết kế và ghi vào `reports/sprint-2-design.md`:
   - Cách render Markdown an toàn (tự viết hay dùng thư viện đóng gói sẵn trong app, không tải từ CDN).
   - Hành vi phím của ô gợi ý `@`.
   - Định dạng `owns` mới và cách chuyển đổi dữ liệu cũ.
   - Thuật toán khóa và cách phát hiện file bị sửa (ví dụ so snapshot mtime/hash trước và sau lượt).
2. **@dev-fe (index.html)** làm A–D và phần UI của E. **@dev-be (core.js, main.js, preload.js)** làm phần lõi của E. Hai người **làm song song** vì không đụng file của nhau. Đây cũng là lần chạy thử thật của #2.
3. **@qa:** thêm check cho renderer (có ca XSS), cho glob/khóa/phát hiện ngoài phạm vi, rồi kiểm tra tay trên app.

## Tiêu chí nghiệm thu
- `npm run check` qua hết.
- Tin có `**đạt**`, danh sách, khối code hiển thị đúng. Chuỗi `<img src=x onerror=alert(1)>` hiện ra dạng chữ, không chạy.
- Gõ `@de` thì ↓ và Enter chèn đúng `@dev-be `; lúc chọn không bị gửi tin.
- Ô nhập không cao quá 1/4 box. Khi đang cuộn lên đọc tin cũ, có tin mới cũng không bị nhảy.
- Gọi dev-fe và dev-be cùng lúc với phạm vi không giao nhau thì cả hai chạy song song. Cho hai agent cùng phạm vi thì agent sau phải chờ và hiện lý do. Cố ý sửa một file ngoài phạm vi thì có cảnh báo.
