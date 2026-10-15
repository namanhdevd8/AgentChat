# Xử lý hàng chờ merge theo yêu cầu End-User

PM · 2026-10-15 · yêu cầu: “giải quyết hàng chờ merge”. Nền kiểm tra: main `538a06931c957e85ea2101b89d0645bef39e2976`. Lượt PM chỉ điều tra đọc và giao việc trong phạm vi; **chưa thay đổi hàng chờ hoặc worktree QA**.

## Dữ kiện đã xác minh

- Registry có 148 mục lịch sử: 116 merged, 12 blocked-dirty, 3 needs-deps, 14 conflict, 3 check-failed. Không có mục queued/checking/merging/publishing tại thời điểm đọc; đây không phải một worker đang treo trong bước Git.
- Có 12 mục chưa merged và chưa có supersededBy trong dữ liệu thô. Tuy nhiên 4 mục FE/BE/PM có kết quả `contained` bằng 0 commit chưa được nhận khi tính cả `record.merged`; `worktreeState` sẽ trình bày chúng là đã gộp. Không biến 4 bản ghi lịch sử này thành lỗi đang chặn và không cần xóa chúng.
- **8 mục conflict còn lại cùng workspace QA `25b6a92f-5c62-4660-a978-504f62131432`, cùng head `2c6ae36185d8c5a55f7848c85b3e3044b571321c`**, đều xung đột `check.js`. Bốn lần thử mới nhất ngày 15/10 có cùng base main `538a069`.
- Worktree QA sạch, không có merge dở, HEAD vẫn `2c6ae36`. So với main/record.merged, còn 10 commit chưa được Git hoặc registry nhận là đã tích hợp. Không có job QA đang giữ reservation trong `.chat/locks.json` lúc PM đọc; phải kiểm lại trước mọi thao tác sau này.
- Các ca QA đã được techlead nhận và mở rộng trên main trong quá trình T52; QA vừa chấp nhận phạm vi Node + fixture Electron. `git diff 2c6ae36 main -- check.js` cho thấy main có sửa seq thật, giữ trạng thái lỗi/xác minh lại và đồng bộ fixture publish. **Không lấy nguyên check.js cũ đè lên main.** Việc ca kiểm đã được nhận không tự làm SHA QA thành ancestor của main.

Các mục QA cần đối chiếu khi thực thi (đọc lại registry vì trạng thái có thể đổi):

| Queue ID | Base lúc thử |
| --- | --- |
| `d49db75c-b0b5-47e5-82e4-063794d5d7f8` | `2915106` |
| `2044663f-fced-443f-87c9-132c52e722a8` | `e9982ab` |
| `7cbfd5d1-5684-44ca-a0dd-5d8a9a01507d` | `fa626c1` |
| `ab7837b5-564c-437b-87b3-3facd9d5dbdc` | `b7992dc` |
| `48bea8eb-2640-4d32-99a9-0110e98ca06d` | `538a069` |
| `829ae9de-68e3-4305-b118-665d8accc8dd` | `538a069` |
| `adc2e957-b641-44ad-bc6c-653281fb2ff9` | `538a069` |
| `14f94606-258d-4080-9b3b-2a8d6f1e2216` | `538a069` |

## Nguyên nhân và ranh giới xử lý

Trong `main.js`, đoạn hoàn tất workspace (~1046–1064) xếp hàng khi `result.outcome === 'success' && ahead`; chốt trùng hiện chỉ so **runId + headSha**. Lượt QA mới dù không sửa file vẫn có runId mới và `ahead === true`, nên lại xếp cùng source đã conflict. `startWorkspace` chỉ đồng bộ nguồn đã `contained`; nhánh QA cũ không thỏa điều kiện nên luôn quay lại nguồn này.

`pumpMerge` chỉ lấy mục queued. Các thông báo conflict lặp là những attempt mới cho cùng nguồn, không phải bằng chứng worker tự retry vô hạn một entry. `retryMerge` có logic supersededBy, nhưng đường enqueue cuối lượt không dùng cùng điều kiện chống trùng. `stopMerge` chỉ xử lý queued/checking, không thể dùng để dọn các conflict đã kết thúc.

PM không sửa main.js/check.js, registry userData hoặc worktree của người khác. Phần triển khai và thao tác qua app giao techlead. Yêu cầu End-User đã cho phép xử lý hàng chờ này; không cần hỏi lại chỉ để đọc, sao lưu hoặc thực hiện bước phục hồi hợp lệ. Việc sửa Git/worktree khác phải đi qua cơ chế app có guard hoặc người phụ trách, không tự vượt cwd/scope bằng shell.

## Phạm vi T58 — techlead, acceptance code

Đầu ra gồm bản sửa tối thiểu ngăn tái phát, xử lý các mục QA cũ có căn cứ, và báo cáo trước/sau trong `reports/`. Techlead làm ở worktree của mình, kiểm tra `main.js` và các đường IPC/UI liên quan; chỉ mở rộng UI nếu cơ chế hiện tại thực sự thiếu thao tác cần thiết.

1. **Chặn tạo mục trùng:** một source cùng workspace đã có attempt đang chạy/chờ hoặc thất bại chưa được xử lý thì lượt chỉ đọc không tự sinh thêm attempt. Giữ khả năng đưa commit mới vào queue và cho người dùng thử lại tường minh; không dùng riêng điều kiện “lượt này không đổi file” để làm rơi commit hợp lệ chưa từng được xếp hàng. Mọi quyết định phải nằm dưới Git lock hiện có, bảo toàn review/task bindings.
2. **Xử lý nguồn QA và 8 mục cũ:** đối chiếu hunk với main, giữ/bảo toàn commit QA để truy vết; tích hợp phần còn thiếu nếu thực sự có. Chốt một kết quả hợp lệ cho nguồn đã được nhận hoặc thay thế, liên kết các attempt cũ với kết quả đó theo cơ chế app có kiểm tra trạng thái. Nếu SHA chưa được gộp thực sự thì không ghi giả là merged. Cần báo rõ cách nhánh QA được đồng bộ an toàn để lượt sau không tạo lại conflict; không chỉ ẩn badge.
3. Trước khi áp dụng vào box thật, lưu snapshot phục hồi và kiểm lại HEAD/dirty/job/worker của đúng workspace. Giữ nguyên lịch sử lỗi, bằng chứng task và các nhánh; không xóa queue wholesale, không sửa JSON userData bằng tay, không dùng reset/checkout đè thay đổi chưa kiểm. Không chạm worktree đang chạy hay sửa trạng thái T52 đã nghiệm thu để gỡ lỗi merge.
4. Giữ các test mới trên main, marker cuối harness, cổng check trước publish và các giới hạn hiện hành. Không tắt check/auto-merge/worktrees để làm hàng chờ trông sạch. Không mở rộng sang lỗi tự tóm tắt 32 KiB trong hotfix này.
5. Thực thi phần phục hồi đã được phép bằng cơ chế app hợp lệ, ghi queue IDs/SHA và trạng thái trước/sau. Nếu bản app đang chạy chưa hỗ trợ thao tác cần dùng, chuẩn bị bản sửa đã kiểm và chỉ rõ bước khởi động lại/thao tác cuối cần End-User; không báo đã dọn khi mới sửa code.

## Nghiệm thu

T58 cần các ca trên repo tạm: hai lượt thành công không sửa source sau conflict không thêm attempt; commit mới vẫn được gộp qua check; source hợp lệ chưa từng được enqueue không bị bỏ; retry tường minh và race giữa retry/finish không cấp trùng; bindings kiểm/task vẫn khớp; việc hợp nhất các mục cũ giữ được lịch sử và phần source chưa tích hợp không bị bỏ.

Chạy `npm run check` trên bản sửa, xác nhận marker cuối main harness và lưu bằng chứng liên kết T58 trước khi gửi review. Chỉ lặp kiểm khi có thay đổi hoặc lỗi cần xác minh.

**T59 — QA, acceptance manual, sau T58:** kiểm độc lập các tình huống trên repo tạm, rồi đọc trạng thái box thật sau xử lý. Đạt khi không còn các mục QA lỗi có thể thao tác cho nguồn cũ, không tạo thêm attempt cho lượt chỉ đọc, phần còn phải gộp nếu có được xử lý qua check, lịch sử/bằng chứng được giữ và nhánh không mất thay đổi. QA không tự thử lại queue cũ để kiểm, không dùng task/log thật làm fixture. Nếu quyền QA còn chặn ghi Git thì báo PM để bố trí thực thi có quyền và QA đọc bằng chứng, không chạy vòng lặp.

T58 phải báo rõ kết quả code và kết quả dọn box thật riêng biệt. T59 chưa được gọi cho tới khi có bản sửa/bàn giao. T53/T55 vẫn chờ End-User thử UI; T52 giữ Xong, không tái sử dụng làm task sửa queue.
