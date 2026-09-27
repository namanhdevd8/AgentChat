# Đề xuất Sprint 7: kiểm soát token của phiên resume (PM, 2026-09-27)

## Vấn đề
- Khi resume, app chỉ gửi phần tin mới (core.js:1173), nên prompt mỗi lượt không phải thủ phạm chính.
- Thứ phình to là **lịch sử bên trong phiên CLI**: file đã đọc, kết quả lệnh, suy nghĩ của các lượt trước. Mỗi lượt resume đều gửi lại toàn bộ lịch sử đó.
- Ví dụ: phiên dev-fe dùng từ Sprint 1 lên 0,8–1,27 triệu token vào mỗi lượt, dẫn đến lỗi 503. Hiện chỉ có một cách xử lý là End-User tự bấm "Phiên mới" trong ⚙.
- Chất lượng cũng giảm theo, vì khi ngữ cảnh quá dài, model dễ bám vào thông tin cũ đã sai (code đã đổi, task đã đóng).

## Đề xuất (cân bằng chất lượng và chi phí)
**K1. Tự xoay phiên theo ngưỡng (làm chính)**
- Sau mỗi lượt, app đọc số token vào của lượt đó (đã có từ Sprint 1). Nếu vượt ngưỡng thì **lượt sau** tự mở phiên mới.
- Ngưỡng mặc định: **150 nghìn**. Chỉnh được trong ⚙ theo từng agent; đặt 0 là tắt.
- Phiên mới vẫn nhận đủ bối cảnh như khi bấm "Phiên mới": memory, summary.md, chat gần đây và task.
- Không xoay khi đang ở giữa một lượt hoặc khi đang thử lại sau lỗi.
- App ghi một tin hệ thống, ví dụ: "dev-fe sang phiên mới (phiên cũ 180 nghìn token)".

**K2. Bàn giao trước khi xoay (bảo vệ chất lượng)**
- Khi vượt ngưỡng, agent phải ghi 3–5 dòng "đang làm gì, còn dở gì" vào `.chat/handoff/<agent>.md`, và phiên mới đọc file này.
- Cách làm: thêm một câu vào prompt của lượt vượt ngưỡng. Không cần gọi thêm lượt, nên không tốn thêm chi phí.

**K3. Gọn prompt**
- Bảng task trong prompt chỉ hiện các task chưa xong, cộng một dòng "đã xong N task". Hiện prompt của PM gửi lại cả 23 task kèm revision ở mọi lượt.
- Giữ nguyên HISTORY của chat gần đây.

**K4. Hiển thị**
- Popup avatar hiện cỡ phiên hiện tại (token vào của lượt gần nhất) và ngưỡng xoay, để End-User thấy agent nào sắp đầy.

## Ngoài phạm vi
- Tự nén hoặc tóm tắt bên trong phiên CLI: mỗi CLI làm một kiểu, khó kiểm soát.
- Đổi model tự động.

## Cần End-User chốt
1. Ngưỡng mặc định 150 nghìn có được không? Mức thấp hơn thì rẻ hơn nhưng agent phải đọc lại file thường hơn.
2. Làm cả K1–K4 hay chỉ K1 và K3 trước?

## Phân công dự kiến
- techlead: thiết kế ngắn.
- dev-be: K1, K2, K3.
- dev-fe: ô ngưỡng trong ⚙ và K4.
- qa: check xoay phiên bằng CLI giả báo số token lớn.
