# Sprint 5: Bớt thao tác tay, bớt lượt chạy thừa, avatar agent

Người viết: @pm · 2026-09-27. End-User chốt: A + B + D + avatar, làm trước. **Sprint 6 sẽ là F + H** (tìm kiếm/tóm tắt log, git worktree + hàng chờ merge).

## Phạm vi

### A. Agent tự chạy lệnh kiểm tra
- Mỗi agent có danh sách **lệnh được phép chạy**, sửa được trong ⚙. Mặc định là `npm run check`.
- Agent chạy được đúng các lệnh trong danh sách mà không bị chặn, với cả 3 CLI (claude, codex, agy). Cách cấp quyền cụ thể cho từng CLI do techlead chốt.
- **Không** mở quyền chạy mọi lệnh. Lệnh ngoài danh sách vẫn bị chặn như cũ.
- Nghiệm thu: gọi qa, qa tự chạy `npm run check` và dán kết quả thật, End-User không phải chạy hộ.

### B. Tự thử lại khi agent trả về rỗng
- Nếu một lượt **thành công nhưng câu trả lời rỗng**, app tự chạy lại **1 lần** trong cùng phiên, với lời nhắc ngắn kiểu "Bạn chưa gửi tin trả lời. Hãy gửi tin trả lời cho nhóm."
- Dòng tiến độ hiện "đang thử lại". Chi phí và token của cả hai lần được cộng vào tin nhắn.
- **Không** thử lại khi agent bị Dừng, quá giờ hoặc lỗi. Lần thử lại vẫn rỗng thì hiện "(không có phản hồi)" như hiện nay.

### D. Chỉ gọi agent khi @ để giao việc
- Với **tin của agent**: chỉ gọi người được @ **ở đầu dòng** (có thể sau dấu gạch đầu dòng `-`, `*`, `1.`). @ nằm giữa câu, trong `code` hoặc khối code thì chỉ là nhắc tên, không gọi.
- Với **tin của End-User**: giữ như cũ, mọi @ đều gọi.
- Cập nhật quy tắc nhóm trong prompt để agent biết cách mới.
- Nghiệm thu: tin agent có dòng "Xong thì dev-be làm tiếp, @qa kiểm tra sau" (có @ giữa câu) không gọi qa; tin có dòng bắt đầu bằng "@qa …" thì gọi qa.

### Avatar agent (sửa trong ⚙)
- Mỗi agent có avatar là **chân dung hình người đơn giản** (đầu và vai), chọn được **nam hoặc nữ** (khác nhau ở kiểu tóc), trên **nền màu** để dễ phân biệt.
- Trong ⚙: chọn giới tính và màu nền từ bảng màu có sẵn (khoảng 8 màu Neubrutalism, đủ tương phản), có xem trước.
- Agent mới được gán sẵn giới tính và màu khác các agent hiện có.
- Avatar dùng ở mọi chỗ đang hiện avatar: header, tin nhắn, popup thành viên. Vẽ bằng SVG nội tuyến, không tải ảnh ngoài.
- End-User giữ avatar chữ cái như hiện nay.
- **End-User làm rõ (2026-09-27):** giới tính và màu nền **chọn độc lập**. Ví dụ A là nam nền xanh, B cũng là nam nhưng nền vàng. Đổi màu bất cứ lúc nào trong ⚙. Thiết kế đã đáp ứng: 8 màu, không bắt buộc khác nhau.

## Ngoài phạm vi
Upload ảnh avatar tuỳ ý. Đổi cách định tuyến cho tin của End-User.

## Phân công
1. **@techlead:** thiết kế ngắn, ghi vào `reports/sprint-5-design.md`: cách cấp quyền lệnh cho từng CLI, điều kiện thử lại, quy tắc @ đầu dòng (kèm regex), schema avatar trong `agents.json`.
2. **@dev-be** (A, B, D, schema avatar trong `saveTeam`) và **@dev-fe** (vẽ avatar SVG, ⚙ cho avatar và danh sách lệnh) làm song song.
3. **@qa:** thêm check cho quy tắc @, thử lại khi rỗng, schema avatar; kiểm tra tay bằng cách tự chạy `npm run check`.

## Trạng thái (2026-09-27)
- **T11 (BE):** dev-be bàn giao, `npm run check` và test runner thật xanh.
- **T12 (FE):** dev-fe lại trả về rỗng, không có tin bàn giao (lần thứ 3 liên tiếp; tính năng B sẽ xử lý sau khi khởi động lại). `index.html` sửa lúc 02:53 đã có code avatar SVG (`createElementNS`, gender, swatch 8 màu, `data-agent-avatar`) và `allowedCommands` trong ⚙. PM mới thấy code có mặt, chưa xác nhận xong hết.
- Đã gọi QA nghiệm thu T11, T12, T13. End-User cần khởi động lại app để nạp BE mới.

- **ĐÃ ĐÓNG (2026-09-27):** qa tự chạy `npm run check` trong app (exit 0); End-User duyệt avatar và các mục còn lại. Đã sửa hồi quy mốc chi phí Claude khi Dừng. B chưa gặp lượt rỗng thật để thấy trên app, nhưng check tự động xanh.

## Tiêu chí nghiệm thu
- qa tự chạy được `npm run check` trong app.
- Một lượt trả về rỗng được thử lại tự động đúng 1 lần.
- Nhắc tên giữa câu không gọi agent.
- Mỗi agent có avatar người, nam hoặc nữ, nền màu khác nhau; đổi trong ⚙ thì mọi chỗ hiện avatar cập nhật theo.
- `npm run check` xanh.
