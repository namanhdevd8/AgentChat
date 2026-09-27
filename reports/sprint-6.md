# Sprint 6: Lịch sử chat dài và mỗi dev một git worktree

Người viết: @pm · 2026-09-27. End-User đã chọn F + H, làm sau Sprint 5.

## F. Tìm kiếm lịch sử và tóm tắt log cũ

### F1. Tìm kiếm
- Có ô tìm kiếm trên header của box. Tìm theo chữ, không phân biệt hoa/thường và có dấu/không dấu. Lọc được theo người gửi.
- Danh sách kết quả hiện người gửi, giờ và đoạn trích có tô sáng. Bấm vào kết quả thì cuộn tới đúng tin trong chat và tô sáng tin đó trong chốc lát.
- Tìm được cả tin cũ đã được tóm tắt: tóm tắt chỉ để rút gọn prompt, log gốc vẫn giữ nguyên.

### F2. Không chậm khi log dài
- App không đọc lại toàn bộ `log.jsonl` ở mỗi lượt agent. Log 10.000 tin vẫn mở box và gửi tin mượt.

### F3. Tự tóm tắt log cũ
- Mỗi khi log có thêm khoảng **100 tin chưa được tóm tắt**, app tự nhờ **PM** tóm tắt phần cũ vào `.chat/summary.md`. File này nằm cạnh memory và được nạp vào prompt giống memory.
- Prompt khi mở phiên mới gồm: memory, summary và 30 tin gần nhất (như hiện nay).
- Lượt tóm tắt hiện trên chat như một lượt bình thường của PM, có chi phí. Có thể tắt trong ⚙.

## H. Mỗi dev làm trong git worktree riêng, gộp qua hàng chờ có chạy check

- **Điều kiện:** dự án phải là git repo. Nếu chưa phải, ⚙ có nút "Khởi tạo git" và app **không tự** `git init`.
- **Bật/tắt theo box trong ⚙**, mặc định tắt. Khi tắt, app chạy như hiện nay (khóa file của Sprint 2).
- Khi bật:
  1. Mỗi agent có quyền ghi được một **worktree + nhánh riêng** (ví dụ nhánh `agent/dev-fe`), và agent chạy trong worktree đó.
  2. Sau mỗi lượt có thay đổi, app **tự commit** vào nhánh của agent. Commit message gồm tên agent, task (nếu có) và tóm tắt ngắn.
  3. **Hàng chờ merge:** lần lượt từng nhánh được gộp vào nhánh chính trong một worktree tạm. App chạy các lệnh check trong danh sách được phép (mặc định `npm run check`); đạt thì cập nhật nhánh chính và thư mục làm việc của End-User.
  4. **Xung đột hoặc check đỏ:** không gộp, chat hiện tin hệ thống gọi đúng agent đó, kèm file xung đột hoặc log lỗi ngắn, để agent tự sửa trên nhánh của mình.
  5. Hai dev sửa cùng file vẫn chạy song song được, xung đột xử lý ở bước merge. Khóa file chỉ còn dùng khi tắt worktree.
- Giao diện: popup thành viên hiện nhánh và số commit chưa gộp. Có khu "Hàng chờ merge" gọn (đang chạy check / chờ / lỗi).
- **Không bao giờ** force-push hoặc tự xoá commit của End-User. Thư mục làm việc chính đang có thay đổi chưa commit thì dừng merge và báo End-User.

## Bổ sung theo thiết kế (2026-09-27, xem sprint-6-design.md)
- **Khóa metadata chung vẫn giữ khi bật H.** Worktree chỉ bỏ khóa file mã nguồn. Các file dùng chung như `.chat/*` và `reports/` vẫn khóa như Sprint 2, vì mọi agent cùng ghi chung một bản duy nhất.
- **Lỗi merge:** app gọi đúng agent sở hữu nhánh bằng tin hệ thống, kèm nút "gọi lượt sửa". Không tự động sinh vòng để AI giải xung đột. End-User hoặc agent chủ động bấm/gọi.
- Git chỉ được khởi tạo khi End-User xác nhận trong ⚙.

## J. Nới giới hạn chuỗi agent, có phanh (End-User chốt thêm vào Sprint 6, 2026-09-27)
1. **Đổi ngay** giới hạn mặc định từ 6 lên **12** lượt agent liên tiếp.
2. Số lượt tối đa chỉnh được trong ⚙ theo từng box (1–50, mặc định 12).
3. **Phát hiện chat qua lại:** hai agent gọi nhau quá 3 vòng mà không có file nào đổi và không có task nào đổi trạng thái thì dừng sớm, kèm tin hệ thống nêu lý do.
4. **Trần chi phí mỗi chuỗi** (tuỳ chọn, để trống là không giới hạn), dùng usage sẵn có. Chi phí không rõ thì không tính vào trần.
5. Khi chuỗi bị dừng vì giới hạn, phanh hoặc trần chi phí thì có nút **"Tiếp tục"** trên tin hệ thống. Bấm vào là chạy tiếp chuỗi với bộ đếm mới, không phải gõ @.
- Việc: **T20 (dev-be)** mục 1–4 phần lõi, trong đó mục 1 làm trước. **T21 (dev-fe)** ô cài đặt trong ⚙ và nút "Tiếp tục".
- Nghiệm thu: chuỗi 8 lượt hợp lệ chạy hết không bị cắt; hai agent chat qua lại không có tiến triển thì dừng sớm; bấm "Tiếp tục" thì chạy tiếp.

## Quyết định End-User (2026-09-27)
- **Chưa khởi tạo git cho ai-chat.** H vẫn làm, nhưng QA nghiệm thu H trên một repo mẫu (fixture) riêng, không dùng chính ai-chat.

## Trạng thái (2026-09-27)
- **FE:** dev-fe đã bàn giao T16 (tìm kiếm, lọc, nhảy tới tin, giữ tối đa 300 tin trên màn hình, bật/tắt tóm tắt) và T18 (bật/tắt worktree, xem trước khi khởi tạo Git, nhánh trong popup, khu hàng chờ merge).
- **FE J:** dev-fe đã bàn giao T21 (ô 1–50 lượt, trần chi phí trong ⚙, nút "Tiếp tục").
- **BE:** dev-be đã bàn giao T15, T17, T20. `npm run check` xanh; merge trên repo Git mẫu đạt; log 10.000 tin mở trong 32 ms, tìm kiếm 7 ms.
- **Lỗi ráp FE do dev-be phát hiện (dev-fe đang sửa):**
  1. Nút khởi tạo Git gửi `files:[]`.
  2. Chỗ chọn phiên thiếu `agentName` và `workspaceId`.
  3. Khi lưu cài đặt, UI bỏ qua kết quả `ok:false`.
- Lượt sửa trước của dev-fe lỗi do dịch vụ agy trả **503 (không khả dụng)**, nên 3 lỗi trên chưa được sửa → task **T22**.
- **Điều tra lỗi 503 của dev-fe (PM, 2026-09-27):**
  - dev-fe (agy, `gemini-3.8-flash-high`, effort high) đang resume **cùng một phiên từ Sprint 1** (`81d472f4…`). Token vào của các lượt gần đây: 1,06 triệu · 0,45 triệu · 1,27 triệu · 0,89 triệu · 0,82 triệu; lượt lỗi vừa rồi 314 nghìn.
  - 5 lần UNAVAILABLE trong log, chỉ xảy ra với dev-fe.
  - Kết luận **có khả năng cao** (chưa chứng minh được) là phiên quá lớn làm dịch vụ từ chối. PM không chạy được agy để thử phiên mới vì lệnh bị chặn.
  - Cách xử lý đề xuất: End-User vào ⚙ → dev-fe → chọn "Phiên mới". Nhờ đã có `.chat/summary.md`, phiên mới vẫn đủ bối cảnh. Nếu vẫn 503 thì đổi tài khoản CLI của dev-fe sang codex.
- **Yêu cầu thêm của End-User (T23):** header của box đang quá nhiều thứ, bị tràn. Chuyển khối token và chi phí khỏi header sang **cột phải, nằm giữa bảng task và File chung**, hiển thị gọn, giữ nguyên số liệu hiện có.
- Gọi QA nghiệm thu T19 ngay khi dev-fe báo xong T22 và T23.
- Chờ End-User: khởi tạo git cho ai-chat; đưa J (nới giới hạn chuỗi) vào sprint này hay để sau.

## Ngoài phạm vi
Push lên remote, tạo PR, giải xung đột tự động bằng AI.

## Phân công
1. **@techlead** (T14): thiết kế `reports/sprint-6-design.md`. Gồm: cách đọc log theo đoạn và chỉ mục tìm kiếm; điều kiện gọi PM tóm tắt; vị trí worktree (không nằm trong thư mục dự án để snapshot không quét); vòng đời nhánh; hàng chờ merge; quan hệ với khóa file/snapshot/scope hiện có; migration.
2. Sau thiết kế: **dev-be** làm T15 (F lõi) và T17 (H lõi); **dev-fe** làm T16 (UI tìm kiếm) và T18 (UI worktree/hàng chờ). Được làm song song theo từng phần.
3. **qa** (T19): check tự động (log lớn, tìm có dấu/không dấu, xung đột merge, check đỏ, thư mục chính bẩn) và nghiệm thu tay.

## Tiêu chí nghiệm thu
- Tìm "khóa file" ra đúng các tin về Sprint 2, bấm vào thì nhảy tới tin.
- Log giả 10.000 tin: mở box và gửi tin không bị chậm rõ rệt.
- Sau ~100 tin mới, `.chat/summary.md` được PM cập nhật.
- Bật worktree: dev-fe và dev-be cùng sửa `index.html` ở hai vùng khác nhau thì merge tự động và check xanh. Nếu cố tình sửa cùng dòng thì agent sau nhận tin xung đột. Thư mục chính chưa commit thì merge dừng và báo.
- `npm run check` xanh.
