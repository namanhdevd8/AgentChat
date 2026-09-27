# Đề xuất cải tiến Agent Chat

Người viết: @pm · 2026-09-26. Đây là đề xuất để End-User chọn thứ tự làm, chưa có hạng mục nào được chốt.

## P0 · Độ tin cậy (nên làm trước)

| # | Tính năng | Vì sao cần | Ai làm |
|---|---|---|---|
| 1 | **Nút Dừng agent** (kill process) và giới hạn thời gian mỗi lượt | Hiện agent chạy sai hướng thì không dừng được, chỉ còn cách tắt app | dev-be, dev-fe |
| 2 | **Khóa file thật** theo `owns` | `owns` mới là lời dặn trong prompt; hai dev vẫn có thể sửa đè cùng một file | techlead thiết kế, dev-be làm |
| 3 | **Hiện tiến độ trực tiếp** (stream-json): "đang đọc X / sửa Y" | Hiện chỉ thấy "đang làm…", không biết agent đang làm gì | dev-be, dev-fe |
| 4 | **Chi phí / token mỗi lượt** và tổng theo box | claude trả `total_cost_usd`, codex và agy trả `usage`, nhưng app đang bỏ qua | dev-be, dev-fe |

## P1 · Trải nghiệm

| # | Tính năng | Vì sao cần |
|---|---|---|
| 5 | Hiển thị Markdown trong chat, xem report ngay trong app | Hiện report phải mở bằng app ngoài |
| 6 | Xem diff sau mỗi lượt (agent đã sửa gì), có nút hoàn tác | End-User duyệt thay đổi nhanh hơn |
| 7 | Gợi ý tên khi gõ `@` | Gọi đúng agent, không gõ sai tên |
| 8 | Thông báo macOS khi có agent @user | Không phải ngồi canh app |
| 9 | Bảng task (kanban) do PM tạo từ chat | Theo dõi ai đang làm gì, xong chưa |

## P2 · Mở rộng

| # | Tính năng |
|---|---|
| 10 | Mỗi dev agent làm trong git worktree riêng, merge qua hàng chờ có chạy `npm run check` |
| 11 | Mẫu team có sẵn (web app, mobile, data…), import/export `agents.json` |
| 12 | Tìm kiếm lịch sử chat; tự tóm tắt log cũ vào memory |
| 13 | Icon app, ký app, tự cập nhật |

## Backlog sau Sprint 4 (cập nhật 2026-09-27)
Đã xong: #1, #2, #3, #4, #5, #7, #9 (dạng cây checklist). Các đầu việc chờ End-User chọn:

| # | Việc | Vì sao | Cỡ |
|---|---|---|---|
| A | **Cho agent tự chạy `npm run check`** (cấu hình quyền lệnh cho từng agent) | QA và dev bị chặn `node` gần như mọi lượt, nên End-User phải tự chạy check rồi dán kết quả | Nhỏ |
| B | **Tự thử lại 1 lần khi agent trả về rỗng** | Có 13/123 tin "(không có phản hồi)", chủ yếu từ dev-fe (agy) | Nhỏ |
| C | **Thông báo macOS khi có agent @user** | Không phải ngồi canh app | Nhỏ |
| D | **Chỉ gọi agent khi @ để giao việc** (ví dụ @ ở đầu dòng), nhắc tên thì không gọi | Nhắc "@pm" trong câu cũng gọi pm, gây chạy thừa | Nhỏ |
| E | **Xem diff sau mỗi lượt, có nút hoàn tác** (#6) | End-User duyệt thay đổi nhanh | Vừa |
| F | **Tìm kiếm lịch sử chat, tự tóm tắt log cũ vào memory** (#12) | Log đọc toàn bộ ở mỗi lượt nên sẽ chậm dần; prompt dài | Vừa |
| G | **Mẫu team có sẵn, import/export `agents.json`** (#11) | Mở dự án mới nhanh | Vừa |
| H | **Mỗi dev làm trong git worktree riêng, merge qua hàng chờ có check** (#10) | Song song an toàn hơn khóa file | Lớn |
| I | **Icon app, đóng gói lại `.dmg`, ký app, tự cập nhật** (#13) | Bản `.app` trong `dist/` đang cũ | Vừa |

| J | **Nới giới hạn chuỗi agent nhưng vẫn có phanh** (End-User hỏi 2026-09-27, PM đề xuất bên dưới) | Giới hạn 6 lượt hay cắt ngang chuỗi hợp lệ, ví dụ techlead → dev-be + dev-fe → qa → dev-be sửa → qa → pm | Nhỏ |

**Đề xuất cho J:**
1. Số lượt tối đa chỉnh được trong ⚙ theo từng box, mặc định **12** (khoảng 1–50).
2. **Phát hiện chat qua lại:** hai agent gọi nhau quá 3 vòng mà không có file nào đổi và không có task nào đổi trạng thái thì dừng sớm, kể cả khi chưa hết số lượt.
3. **Trần chi phí** cho mỗi chuỗi (tuỳ chọn, ví dụ 5 USD), dùng số liệu usage sẵn có.
4. Khi dừng, hiện nút **"Tiếp tục"** để End-User cho chạy thêm một chuỗi, không phải gõ @ lại.

Lý do: sau Sprint 5, agent chỉ gọi nhau khi @ ở đầu dòng và có luật "chưa tới bước thì không trả lời", nên vòng lặp vô ích đã ít hơn nhiều. Phanh nên dựa vào "không có tiến triển" và chi phí thay vì một con số cứng.

Cấu hình còn treo: techlead vẫn `owns: []` (toàn quyền, khóa cả dự án). End-User sửa trong ⚙.

## Nợ kỹ thuật đã biết

- `log.jsonl` được đọc toàn bộ ở mỗi lượt, nên sẽ chậm dần khi log dài.
- **Tắt app khi agent đang chạy** (đọc từ code, chưa thử thực tế; cập nhật 2026-09-27):
  - Từ Sprint 1, CLI được spawn `detached: true` và app không có xử lý `before-quit`. Vì vậy tiến trình CLI có thể vẫn chạy ngầm sau khi tắt app, và vẫn sửa file.
  - Câu trả lời cuối của agent bị mất, không vào `log.jsonl`. Hàng chờ và chuỗi @ đang dở cũng mất.
  - Phiên vẫn được giữ (ID lưu ngay khi CLI công bố), nên lần sau agent resume đúng phiên.
  - Đề xuất: khi tắt app mà còn agent chạy thì hỏi xác nhận, rồi dừng hết process group; ghi tin nhắn "đã dừng do tắt app" vào log.
- agy thỉnh thoảng trả về phản hồi rỗng.
- Danh sách phiên codex chỉ quét 400 phiên gần nhất.

## Đề xuất của PM

Làm **#1, #3, #4** trước. Ba mục này nhỏ, cùng nằm ở luồng gọi CLI, và giúp End-User kiểm soát được agent cũng như chi phí. Sau đó làm #2 trước khi cho nhiều dev agent chạy song song.
