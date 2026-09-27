# Sprint 7: UI ⚙ hai bên + kiểm soát token phiên (chốt 2026-09-27)

Đề xuất gốc: reports/sprint-7-proposal.md. End-User chốt: ngưỡng 150k, làm cả K1–K4, **làm lại UI ⚙ trước**.

## Phạm vi
**T24 (dev-fe, làm trước): UI ⚙ hai bên**
- Trái: sidebar liệt kê các mục (vd Chung/Box, từng agent, Worktree & Git, Giới hạn & chi phí). Phải: nội dung của mục đang chọn.
- Sắp xếp gọn: mỗi mục một khung, nhãn rõ, bỏ cuộn dài một trang. Giữ phong cách Neubrutalism.
- Giữ nguyên mọi chức năng và dữ liệu hiện có (avatar, lệnh được phép, phiên mới, worktree, giới hạn lượt, trần chi phí). Không đổi IPC.
- Chừa chỗ trong mục agent cho ô "Ngưỡng xoay phiên" (T27).

**K1 tự xoay phiên:** sau mỗi lượt, nếu token vào của lượt > ngưỡng (mặc định 150.000, chỉnh theo agent, 0 = tắt) thì lượt sau mở phiên mới với đủ memory/summary/chat gần đây/task. Không xoay giữa lượt hoặc khi đang thử lại. Ghi tin hệ thống.
**K2 bàn giao:** lượt vượt ngưỡng được nhắc ghi 3–5 dòng vào `.chat/handoff/<agent>.md`; phiên mới đọc file này. Không gọi thêm lượt.
**K3 gọn prompt:** bảng task trong prompt chỉ gồm task chưa xong + "đã xong N task".
**K4 hiển thị:** popup avatar hiện cỡ phiên (token vào lượt gần nhất) / ngưỡng.

## Ngoài phạm vi
Nén phiên bên trong CLI, tự đổi model.

## Phân công và thứ tự
1. dev-fe T24 và techlead T25 (thiết kế K1–K4, `reports/sprint-7-design.md`) chạy song song.
2. Sau T25: dev-be T26 (K1–K3); dev-fe T27 (ô ngưỡng trong ⚙ mới + K4) sau khi xong T24.
3. PM nhận đủ rồi gọi qa T28.

## Tiêu chí nghiệm thu
- ⚙ có sidebar trái + nội dung phải; mọi cài đặt cũ vẫn lưu được.
- CLI giả báo token vào 200k → lượt sau là phiên mới, có tin hệ thống, phiên mới nhận được nội dung handoff.
- Ngưỡng 0 → không xoay. Ngưỡng chỉnh theo agent được lưu.
- Prompt PM không còn task đã xong.
- Popup avatar hiện cỡ phiên / ngưỡng.
- `npm run check` xanh.

## Nghiệm thu (PM, 2026-09-27)
- QA T28 đạt: `npm run check` xanh (10,4 giây), không phát hiện lỗi.
  - Xoay phiên: đúng 150.000 không xoay, 150.001 thì lượt sau là phiên mới; ngưỡng 0 hoặc token không rõ thì không xoay.
  - Handoff: file được lưu, block bị gỡ khỏi tin chat, chặn symlink. Prompt chỉ gồm task chưa xong + "Đã xong N task".
- T25, T26, T28 → Xong.
- dev-fe không gửi tin bàn giao T27 (lượt rỗng); code có trong commit 68d0c4c. QA mới đọc code T27, chưa có check tự động cho ⚙ hai bên (T24).
- **T24, T27 giữ Chờ duyệt đến khi End-User thử tay** ⚙ hai bên và popup cỡ phiên.
