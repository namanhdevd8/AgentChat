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

## Backlog sau Sprint 7 (cập nhật 2026-09-28)
Đã xong: A, B, D, F, H, J, xoay phiên theo token, ⚙ hai bên. Còn lại:

| # | Việc | Vì sao | Cỡ |
|---|---|---|---|
| E | **Xem diff mỗi lượt + nút hoàn tác** | Đã có worktree nên mỗi lượt agent là một commit: xem diff và `git revert` commit đó là đủ, dễ hơn trước nhiều | Vừa |
| C | **Thông báo macOS khi có agent @user hoặc chuỗi dừng** | main.js chưa có `Notification`, End-User vẫn phải canh app | Nhỏ |
| L | **Lượt rỗng nhưng có commit thì app tự tóm tắt** ("dev-fe sửa index.html +114/−14, task T27"), rồi gọi PM | Log có 16 tin "(không có phản hồi)". Gần nhất là T27: PM phải tự grep mới biết đã có code | Nhỏ |
| M | **Smoke test UI bằng Electron** trong `npm run check`: mở ⚙, đổi mục, lưu, mở popup | T24/T27 không có check tự động nên phải chờ End-User thử tay | Vừa |
| N | **Tắt app khi agent đang chạy thì hỏi xác nhận** (main.js chưa có `before-quit`) | Tiến trình CLI vẫn chạy ngầm và sửa file, câu trả lời bị mất. End-User từng chọn không dừng agent: chỉ hỏi, không tự dừng | Nhỏ |
| G | Mẫu team, import/export `agents.json` | Mở dự án mới nhanh | Vừa |
| I | Icon, đóng gói `.dmg`, ký app, tự cập nhật | Bản trong `dist/` đang cũ | Vừa |
| O | **Báo cáo chi phí theo sprint/agent** | Hiện chỉ có tổng box, khó biết agent nào tốn tiền | Nhỏ |

| P | **Quyền công cụ của CLI theo agent** (End-User báo 2026-09-28) | Claude chạy `-p --permission-mode acceptEdits` (core.js:97): được sửa file, nhưng Bash/WebFetch/MCP cần hỏi quyền. Chạy ngầm không có ai trả lời nên agent bị từ chối, rồi đi đường vòng | Vừa |

**Đề xuất cho P:**
1. Thêm mục "Quyền" cho từng agent trong ⚙, có 3 mức:
   - Chỉ sửa file (hiện tại).
   - Tuỳ chỉnh: danh sách công cụ được phép, ví dụ `Bash(npm test:*)`, `WebFetch`, truyền vào `--allowedTools`.
   - Toàn quyền: `bypassPermissions`, có cảnh báo đỏ.
2. Kết quả của Claude có trường `permission_denials`. App đọc trường này và hiện tin hệ thống, ví dụ "claude bị từ chối Bash(pnpm i)", kèm nút "Cho phép và chạy lại".
3. codex: tuỳ chọn bật mạng hoặc `danger-full-access`. agy: dò cờ tương ứng.
- Cách tạm, không cần code: tạo `.claude/settings.json` trong dự án mới, có `permissions.allow`. Claude `-p` có đọc file này.

**PM đề xuất Sprint 8: P + E + C + L** (P làm trước vì đang chặn dự án mới). E trực tiếp giúp duyệt chất lượng; C và L nhỏ, giảm thời gian ngồi canh và giảm việc PM phải đoán. M làm cùng nếu QA còn sức, để không phụ thuộc thử tay.

## Đề xuất của PM

Làm **#1, #3, #4** trước. Ba mục này nhỏ, cùng nằm ở luồng gọi CLI, và giúp End-User kiểm soát được agent cũng như chi phí. Sau đó làm #2 trước khi cho nhiều dev agent chạy song song.

## Backlog sau Sprint 9 (cập nhật 2026-10-13)
- **R1 "Cần bạn":** khi End-User gửi tin mới gọi PM, mọi yêu cầu cũ của PM bị đóng theo. End-User chọn để sau, vì hiện chỉ đọc rồi bấm x.
- **R6:** ghi memory qua block, để PM và techlead không còn chờ nhau trên `.chat/memory.md`.
- Chi phí theo agent và theo sprint; gắn chip trạng thái vào đúng lượt; đưa file mới sửa lên đầu File chung.
- Tin `needs-deps` cần ghi rõ End-User phải tự gộp rồi chạy `npm install`, vì hiện bấm Thử lại sẽ kẹt mãi (góp ý QA T37).
- R7 cho codex/agy: chưa có nguồn số đo ngữ cảnh, đang trả null.
- Tự tạo link file: "Node.js", "Vue.js" bị biến thành link chết (QA T41); chỉ tạo link khi file có thật hoặc chuỗi có dạng đường dẫn.
- Mục cũ vẫn còn: E (diff + hoàn tác), L (lượt rỗng có commit), lỗi `team-changed` ghi đè draft.
