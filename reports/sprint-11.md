# Sprint 11: Cổng "xong" có bằng chứng, luật chia việc, bàn giao tự điền (chốt 2026-10-14)

Nguồn: đánh giá P0 của techlead [p0-research-review-2026-10-14.md](p0-research-review-2026-10-14.md), dựa trên tài liệu nghiên cứu `research_notes/Dự án tương tự Agent Chat/`. End-User đã duyệt. PM chốt **đợt đầu** theo khuyến nghị của techlead. Code nền: main `6278360` (0.9.0).

## Phạm vi
| Mục | Làm gì | Tiêu chí nghiệm thu |
|---|---|---|
| G1 Hồ sơ kiểm | App lưu kết quả các lệnh check do app chạy thật (hàng chờ merge, run-command): queue/run, workspace, SHA nguồn, SHA integration đã kiểm, lệnh, mã thoát, thời điểm, đoạn lỗi có giới hạn. Mỗi kết quả gắn với task/revision rõ ràng, không đoán từ tên agent hay tiêu đề commit. | Log cũ vẫn đọc được. Squash vẫn nối đúng nguồn với candidate. Không chạy lại check trùng với hàng chờ. |
| G2 Cổng "xong" | Agent thường chỉ chuyển task của mình tới `review`, **chỉ PM được `done`**. Task code (có worktree) chỉ đóng được khi bàn giao đã gộp và có bằng chứng G1 còn khớp bản code. Task tài liệu, research, QA hoặc thử tay thì đóng kèm lý do hoặc link báo cáo và người duyệt. Check xanh **không tự đóng** task. | Agent tự `done` bị chặn. PM không dùng được check của task hoặc SHA khác. Code đổi sau khi check thì bằng chứng cũ hết hiệu lực. Task thử tay không tự đóng khi check xanh. Task tài liệu có đường duyệt hợp lệ. |
| G3 Cảnh báo đổi test | Khi bàn giao có đổi file test, cấu hình test hoặc script check, người duyệt thấy cảnh báo. Không cấm sửa `check.js`. `mergeChecks` vẫn đi qua cơ chế trust hiện có. | Đổi `check.js` thì task hiện cảnh báo, không bị chặn. |
| G4 Luật chia việc | Thêm vào RULES/prompt của PM: mỗi việc có đầu ra, tiêu chí nghiệm thu và người phụ trách; việc nhỏ trong một chỗ giao một agent; chỉ chạy song song khi các việc độc lập; vượt phạm vi thì quay lại PM; mỗi task có **cách nghiệm thu** riêng, không bắt buộc script riêng. Luật này không ghi đè phân công cụ thể của End-User. | Prompt PM có luật mới. Scope và quyền công cụ không đổi. |
| G5 Bàn giao tự điền | Khi cấp prompt và bàn giao, app tự điền phần dữ kiện: branch/HEAD, workspace, tóm tắt diff (có giới hạn), task còn mở kèm revision, check gần nhất gắn SHA hoặc "chưa có", ghi rõ nguồn và thời điểm. Agent vẫn tự viết phần quyết định, blocker và bước kế. Dữ kiện này không chép vào memory chung. | Dự án không có Git thì để trống, không tự `git init`. "Check gần nhất" không được hiển thị như "code hiện tại đã đạt". |
| G6 Chi phí lượt lỗi | Cộng chi phí đo được của mọi lượt (lỗi, dừng, timeout) vào chi phí chuỗi và trần chi phí; khoản chưa biết thì đánh dấu. | Lượt `error` có `costUsd` được cộng vào `chain.costUsd`. |

## Để đợt sau (Sprint 12 dự kiến)
- Phanh "không tiến triển" áp dụng cho chuỗi 1, 2 hay nhiều agent, tính theo tiến triển thật (P0-2). Tin trùng không tạo lượt gọi mới.
- Sự kiện merge có kiểu cho lỗi gộp (P0-3, phần đầu). Tự gọi agent sửa check thì chỉ làm sau khi các giới hạn đã nghiệm thu, và vẫn phải có hạn mức.
- Ngoài phạm vi: xoay phiên theo % context, AI tự giải conflict, loại tin theo độ giống ngữ nghĩa, `--max-budget-usd` (cân nhắc ở Sprint 12).

## Phân công
1. techlead **T46**: contract `reports/sprint-11-design.md`. Cần chốt:
   - schema hồ sơ kiểm và migration;
   - cách gắn task/revision với queue và run;
   - luật chuyển trạng thái và block `task-status` của PM khi đóng task (thêm trường bằng chứng hoặc lý do);
   - đường duyệt cho task không có code;
   - cách phát hiện file test/check bị đổi;
   - định dạng phần dữ kiện bàn giao;
   - nơi cộng chi phí lượt lỗi;
   - ca kiểm cho QA.
2. Sau contract, làm song song: dev-be **T47** (G1, G2, G3 phía app; G4 prompt; G5; G6) và dev-fe **T48** (hiện bằng chứng và trạng thái "chờ kiểm" trên task, cảnh báo đổi test, lý do đóng task không có check).
3. PM nhận đủ T47 và T48 rồi gọi qa **T49** nghiệm thu.

## Điều kiện trước khi bắt đầu
Thư mục chính đang có file chưa commit: `research_notes/` và `reports/Dự án tương tự Agent Chat.md`. Vì vậy app chưa gộp được nhánh của techlead (báo cáo P0) và các nhánh sau. End-User cần commit hai mục này hoặc thêm chúng vào `.gitignore`.
