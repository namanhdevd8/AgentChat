# Sprint 3: Xem report trong app, bảng task, chi tiết thành viên

Người viết: @pm · 2026-09-27. Phạm vi do End-User chốt trong chat.

> Markdown **trong chat** đã xong ở Sprint 2. Sprint này làm phần còn lại: xem report ngay trong app.

## Phạm vi

### A. Xem report ngay trong app
- Bấm vào file trong mục "File chung", hoặc bấm link `reports/...` / `.chat/...` trong chat, thì mở **khung xem trong app**, không mở bằng app ngoài như hiện nay.
- File `.md` hiển thị dạng Markdown, dùng chung renderer an toàn của Sprint 2 (`html:false`, chống XSS). File khác (`.json`, `.js`…) hiện dạng chữ thô, font monospace.
- Khung xem có: tên file, nút đóng, nút "Mở bằng app ngoài" (giữ cách mở cũ), và nút tải lại nội dung.
- Link giữa các report (ví dụ `[roadmap.md](roadmap.md)`) mở tiếp trong khung xem.
- Chỉ mở được file nằm trong thư mục dự án (dùng lại IPC mở file an toàn của Sprint 2).
- Chỉ **xem**, không sửa trong app.

### B. Bảng task (kanban) thay cho các card thành viên ở cột phải
- Cột phải gồm: **Bảng task** ở trên, **File chung** giữ nguyên ở dưới. Các card thành viên được bỏ và chuyển lên header (mục C).
- Bảng có 4 cột: **Cần làm · Đang làm · Chờ duyệt · Xong**.
- Mỗi task gồm: mã (`T1`, `T2`…), tiêu đề ngắn, người nhận (@agent), trạng thái, link spec nếu có (ví dụ `reports/sprint-3.md`), và thời gian cập nhật.
- **PM tạo task từ chat:** khi giao việc, PM ghi task vào file dữ liệu chung. App tự cập nhật bảng khi file đổi, không cần tải lại.
- Agent được giao task cũng được đổi trạng thái task của mình (ví dụ Đang làm → Chờ duyệt).
- End-User đổi trạng thái được bằng cách kéo thả card sang cột khác.
- Bấm vào card: nếu task có link spec thì mở spec trong khung xem (mục A).
- Không cột nào có card thì hiện dòng hướng dẫn ngắn.
- Mỗi box chat có bảng riêng, dữ liệu nằm trong thư mục `.chat/` của dự án đó.

### C. Chi tiết thành viên khi di chuột vào avatar trên header
- Di chuột vào một avatar trên header, hoặc focus bằng bàn phím, thì hiện khung xổ xuống gồm: @tên, tài khoản CLI, model, effort, vai trò, phạm vi (owns / readOnly), trạng thái hiện tại (rảnh / đang làm + bước tiến độ / đang chờ khóa + lý do).
- Trong khung có nút **Dừng** khi agent đang chạy hoặc đang chờ, thay cho nút Dừng ở card cũ, và nút **@ gọi** để chèn `@tên ` vào ô nhập.
- Khung không bị biến mất khi rê chuột từ avatar xuống để bấm nút. Esc đóng khung.
- Cảnh báo "Cần xác nhận phạm vi" (nếu có) cũng hiện trong khung này.

## Trạng thái (2026-09-27)
- **BE:** dev-be bàn giao, `npm run check` xanh.
- **FE:** lượt của dev-fe trả về rỗng, không có tin bàn giao. `index.html` sửa lúc 01:47 đã có code cho viewer, kanban (kéo thả, `setTaskStatus`), `member-popover` và `readProjectFile`. PM mới thấy code có mặt, chưa xác nhận xong hết.
- Đã gọi QA nghiệm thu cả hai phần. End-User cần khởi động lại app để nạp BE mới.
- Sau khi khởi động lại, PM sẽ tạo các task Sprint 3 trong `.chat/tasks.json` để thử bảng bằng dữ liệu thật.

## Thay đổi theo End-User (2026-09-27): bỏ kanban, dùng dạng cây checklist
End-User thấy bảng 4 cột chiếm nhiều chỗ, và không muốn người dùng tự đổi trạng thái bằng tay vì dễ loạn. Thay mục B như sau:
- Cột phải hiện **danh sách dạng cây, gọn như một scratchpad checklist**:
  - Cấp 1 là **nhóm theo file spec** (ví dụ `sprint-3.md`), kèm tiến độ `4/6`. Task không có spec vào nhóm "Khác".
  - Cấp 2 là các task, mỗi task **một dòng**: biểu tượng trạng thái (☐ cần làm · ◐ đang làm · ⧗ chờ duyệt · ☑ xong), mã, tiêu đề, `@người nhận`. Task xong thì chữ mờ.
  - Bấm vào tên nhóm để mở/gập. Nhóm đã xong hết thì mặc định gập.
- **End-User chỉ xem**: bỏ kéo thả và mọi nút đổi trạng thái. Trạng thái chỉ do agent đổi (qua block `task-status`) hoặc PM.
- Bấm vào một dòng task thì mở spec trong khung xem, như cũ.
- File chung vẫn ở dưới, giữ nguyên.
- BE giữ nguyên dữ liệu và IPC. IPC `setTaskStatus` không còn được UI gọi; techlead quyết định có gỡ hay không.
- Nghiệm thu: bảng không chiếm quá khoảng nửa cột phải với 6 task; không kéo được; mở/gập nhóm được; trạng thái đổi khi agent gửi block `task-status`.

## ĐÃ ĐÓNG (2026-09-27)
- End-User nghiệm thu: xem report trong app, bảng task dạng cây (chỉ xem), popup thành viên. QA không còn lỗi mở; `npm run check` xanh.
- **Việc tồn, đưa vào backlog:**
  1. Hiện PM **không đổi được trạng thái task của người khác**: block `task-status` chỉ cho agent đổi task của chính mình, còn `tasks.json` không có trường status. Vì vậy các task T1–T7 vẫn đang ở trạng thái cũ trên bảng dù sprint đã đóng. Cần cơ chế để PM đóng task khi nghiệm thu, hoặc agent tự chuyển task sang "xong" khi bàn giao.
  2. Gỡ IPC `setTaskStatus` (dev-be), vì UI không còn gọi tới.

## Ngoài phạm vi
- Sửa file trong app, kéo thả để giao task cho agent khác, tự động tạo task bằng AI ngoài PM.

## Quyết định cần techlead chốt
- Định dạng và vị trí file task (đề xuất `.chat/tasks.json`). Xử lý khi PM, agent và End-User cùng ghi file này.
- Cơ chế theo dõi file đổi để cập nhật bảng và khung xem.
- Phạm vi mới cần thêm: PM cần quyền ghi file task. Agent đổi trạng thái task của mình thì có cần mở phạm vi hay đi qua cơ chế khác?

## Phân công
1. **@techlead:** thiết kế, ghi vào `reports/sprint-3-design.md`.
2. **@dev-be** (lưu task, theo dõi file, IPC) và **@dev-fe** (khung xem, kanban, dropdown thành viên) làm song song.
3. **@qa:** check tự động cho dữ liệu task (đọc/ghi, file hỏng, ghi trùng) rồi kiểm tra tay.

## Tiêu chí nghiệm thu
- Bấm `reports/roadmap.md` trong chat thì thấy Markdown trong app. Trong khung xem, `<img src=x onerror=alert(1)>` hiện dạng chữ.
- PM giao việc trong chat thì card xuất hiện ở "Cần làm" mà không cần tải lại. Kéo card sang cột khác thì trạng thái được lưu, khởi động lại app vẫn giữ.
- Rê chuột vào avatar dev-be trên header thì thấy đủ thông tin; bấm Dừng được khi dev-be đang chạy.
- `npm run check` xanh.
