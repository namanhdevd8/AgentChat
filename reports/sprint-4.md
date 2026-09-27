# Sprint 4: PM đóng được task của người khác

Người viết: @pm · 2026-09-27. End-User chốt: sửa lỗ hổng tồn từ Sprint 3.

## Vấn đề
Block `task-status` chỉ cho agent đổi task của chính mình, còn `tasks.json` không có trường status. Vì vậy PM không đóng được task khi nghiệm thu, và bảng bị lệch với thực tế: T1–T7 chưa hiện "xong" dù Sprint 3 đã đóng.

## Phạm vi
1. **PM được đổi trạng thái mọi task** qua đúng block `task-status` hiện có, vẫn kiểm tra `expectedRevision` như cũ. "PM" được xác định giống quy tắc migration ở Sprint 3: agent tên `pm`, không phân biệt hoa/thường. Các agent khác vẫn chỉ đổi được task của chính mình.
2. **Prompt của PM hiện toàn bộ task** kèm người nhận, trạng thái và revision, không chỉ "Task của bạn". Như vậy PM mới có revision để đóng task.
3. Tin hệ thống ghi rõ ai đã đổi, ví dụ "pm chuyển T2 sang Xong".
4. **Gỡ IPC `setTaskStatus`** (preload và main) vì UI không còn dùng tới.

## Ngoài phạm vi
Không đổi UI. Không thêm quyền cho End-User.

## Phân công
- **@dev-be:** mục 1–4 trong `core.js`, `main.js`, `preload.js`. Việc nhỏ nên không cần tài liệu thiết kế riêng; nếu có câu hỏi về kiến trúc thì hỏi techlead.
- **@qa:** thêm check cho các trường hợp: PM đổi task của dev-fe thì được; dev-fe đổi task của qa thì bị từ chối; revision cũ thì bị từ chối; không còn `setTaskStatus` trong preload.

## Trạng thái (2026-09-27)
- T8 (dev-be) và T9 (qa) đã xong; End-User xác nhận `npm run check` qua.
- Prompt của PM đã hiện toàn bộ 9 task kèm revision, tức mục 2 chạy đúng trên app thật.
- PM gửi block `task-status` để chuyển T1–T9 sang "xong". **Sprint đóng khi bảng hiện ☑ cho cả 9 task.**
- **ĐÃ ĐÓNG (2026-09-27):** tin hệ thống ghi "pm chuyển T1…T9 sang Xong", End-User xác nhận bảng đủ ☑.

## Tiêu chí nghiệm thu
- `npm run check` xanh.
- Sau khi khởi động lại app, PM chuyển T1–T7 sang "xong" bằng một block `task-status`, và bảng hiện ☑ cho cả 7 task.
