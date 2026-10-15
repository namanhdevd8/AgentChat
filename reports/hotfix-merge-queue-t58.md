# T58 — Ngăn attempt trùng và phục hồi nguồn QA cũ

Techlead · 2026-10-15. Nền code `538a06931c`; main khi đối chiếu trạng thái thật là `132f01c87e` (thêm báo cáo PM, không đổi code/test nền).

## Kết quả và phần còn phải áp dụng

**Bản sửa code đã kiểm đạt. Hàng chờ box thật chưa được dọn.** Có đúng 8 mục QA conflict cùng nguồn `2c6ae36185d8c5a55f7848c85b3e3044b571321c`, worktree QA sạch, không có merge worker đang chạy lúc đọc 2026-10-15T14:53:55Z. Registry có 149 mục lịch sử. Xem [snapshot đọc trạng thái thật](hotfix-merge-queue-t58-live-before.json).

App đang chạy chưa có IPC phục hồi mới. Theo mục 5 của [phạm vi PM](hotfix-merge-queue-2026-10-15.md), bản sửa cần được gộp và khởi động lại trước khi dùng thao tác này trên box thật. Lượt này không sửa JSON userData, không reset/merge worktree QA bằng shell, không đổi task T52 hay tái chạy các bộ Electron Sprint 12. Chưa có snapshot phục hồi *box thật* vì chưa áp dụng thao tác; snapshot trước khi thay nguồn sẽ được app tạo.

## Bản sửa

- `main.js`: chốt source bằng workspace ID + head SHA, trong Git lock. Lượt đọc lại nguồn đã queued/running/thất bại giữ attempt hiện có; không dựa vào “không đổi file” để bỏ commit tự tạo chưa từng vào queue. Commit mới vẫn đi qua merge/check/publish bình thường.
- Thử lại tường minh hợp nhất các attempt lỗi cùng source bằng `supersededBy`. Nếu finish đã xếp cùng head vào queue thì dùng lại entry đó. Hai retry/finish đồng thời không cấp hai attempt. Lỗi/mergeEvent cũ được giữ tại entry cũ, không sao chép sang attempt mới.
- Review/task bindings được cộng dồn đúng source, có Git lock, không ghi đè những binding cũ. Retry khác SHA không mang bằng chứng source cũ sang. Check đã chạy hoặc đang chạy giữ hồ sơ đóng băng; review đến sau không tự được check cũ xác nhận.
- `preload.js` + `renderer.js`: thêm IPC/nút **Lấy main (sao lưu nhánh)** cho nguồn lỗi cần thay thế. Dùng chung cơ chế hiển thị lỗi và chống cập nhật UI khi đổi box của các nút merge hiện có.

## Phục hồi qua app

`replaceMergeSource(dir, { queueId })` chỉ nhận từ main frame của app và project đã biết. Đây là thao tác **thay nguồn**, không phải merge/check đạt.

1. Dưới Git lock, xác minh workspace thuộc registry/repo/nhánh/.chat đúng; box không có job, orphan, merge worker hoặc entry đang chờ/chạy. Main và workspace phải sạch, không có merge/rebase dở. HEAD workspace phải đúng source lỗi.
2. Hộp xác nhận native hiển thị source SHA, main SHA, thống kê diff; mặc định Hủy. Phải đánh dấu đã đối chiếu phần cần giữ trên main và chọn **Sao lưu và lấy main**. Hủy/không đánh dấu thì không đổi registry hay workspace.
3. Kiểm lại HEAD, nhánh, dirty/job/worker sau xác nhận. Ghi snapshot vào `userData/worktrees/<project-hash>/recovery/<id>/`: registry, verification, locks, task definitions, binary diff và metadata phục hồi. Tạo ref `refs/heads/agent-chat-backup/<workspaceId>/<id>` giữ toàn bộ lịch sử source cũ.
4. Ghi intent trước khi đổi Git, xác minh ref sao lưu rồi dùng `git reset --keep` với đúng main SHA đã xác nhận. Không dùng reset hard hoặc thay đổi main. Nếu thao tác bị ngắt sau khi Git đổi, intent và ref còn nguyên; chặn lượt agent/retry thường tới khi hoàn tất qua nút phục hồi. Nếu main đổi trong lúc intent còn dở, dừng để đối chiếu, không tự đoán nguồn mới.
5. Thêm entry kết quả `replaced`, chứa source/replacement SHA, backup ref và snapshot ID. Các entry lỗi cùng workspace/source nối `supersededBy` tới kết quả; giữ nguyên error, mergeEvent, review/task refs và hồ sơ kiểm. Không thêm source cũ vào `record.merged`, không tự cho task đạt, không xóa lịch sử lỗi. Chat có một tin `merge-recovery` không mang runId.

UI không tính `replaced` thành việc còn chờ, giống lịch sử `merged`, nhưng dữ liệu không đánh tráo hai trạng thái. Lượt QA tiếp theo bắt đầu từ main nên không tiếp tục đưa SHA cũ vào queue. Nguồn riêng chưa tích hợp vẫn có thể phục hồi từ nhánh sao lưu; app không tự kết luận nội dung riêng có thể bỏ.

## Đối chiếu source QA với main

Workspace QA: `25b6a92f-5c62-4660-a978-504f62131432`, HEAD `2c6ae36`. Có 10 commit chưa được Git/registry tính là contained; trong đó 7 commit không phải merge (`6061445`, `a097c78`, `efa1567`, `60a4ef4`, `388c8e1`, `f000263`, `2c6ae36`) đều chỉ sửa `check.js`. Ba commit còn lại là QA merge main vào nhánh.

Đã đọc diff `2c6ae36..538a069 -- check.js`: main giữ các ca QA và sửa/mở rộng đúng những điểm đã nghiệm thu T52:

| Khác biệt trên main | Vì sao giữ main |
| --- | --- |
| Payload recovery có seq từ `logPage`, assert số nguyên | Fix fixture raw log không có seq |
| Các ca chat/cache/embedded/fallback giữ lỗi và xác minh lại | Giữ ca `T52-api-error-rerender`, thêm cùng stop/box/revision, đồng bộ hai nút, stale request |
| Instrumentation thêm Git lock/merge worker | Cho fixture publish đồng bộ với app thật |
| Publish dùng barrier sau check và chờ cleanup trước đổi nhánh | Thay timing 3 giây dễ đụng `index.lock`, giữ assertion lỗi publish/retry/superseded |
| Bộ listener, phanh, claim recovery và marker cuối | Các nhóm QA vẫn có và đã chạy tới cuối |

Không phát hiện hunk QA cần chép thêm; không chép nguyên `check.js` cũ đè lên main. Các khác biệt `core/main/renderer` giữa hai head là sửa sản phẩm trong quá trình T52, không phải source riêng do các commit QA trên tạo ra. Đối chiếu này áp dụng cho đúng SHA đã nêu; app từ chối phục hồi nếu workspace đã có commit mới hoặc dirty.

## Kiểm tra

- Lượt 1: `npm run check` **exit 1** ở ca mới T58. `repoProbe` so đường dẫn `/var/...` với realpath `/private/var/...` khi kiểm worktree tạm macOS. Đã sửa chuẩn hóa đường dẫn worktree trước probe. [Output giữ nguyên](hotfix-merge-queue-t58-check-1.txt).
- Lượt 2 sau sửa: `npm run check` **exit 0**, vượt chốt bắt buộc `ok (main harness end)`. [Output](hotfix-merge-queue-t58-check-2.txt). Các ca T58 chạy trong main harness thật với Electron/CLI giả và repo Git tạm, không dùng box thật làm fixture.
- Có ca source tự commit chưa enqueue; hai lượt đọc sau conflict không tạo attempt; hai retry khác queue ID chạy đồng thời với finish chỉ cấp một attempt; giữ task/review bindings; commit mới vẫn check/pass/publish với đúng source/task/review.
- Phục hồi: 8 lỗi cùng source; Hủy/không tick xác nhận; workspace/main dirty; job/orphan/worker; sửa file hoặc commit khi dialog mở; giả lập lỗi ghi registry sau khi Git đã đổi; intent chặn lượt mới; hoàn tất lại; ref sao lưu vẫn đọc được phần riêng; snapshot giữ nguyên lịch sử và verification; main không bị sửa; retry cũ/repair cũ/lượt đọc lại không tạo queue mới.
- Renderer VM kiểm nút phục hồi, IPC lỗi và ẩn kết quả `replaced` khỏi việc đang chờ. Giữ toàn bộ suites và assertion cũ, không thêm xfail. `git diff --check` đạt.
- Còn dòng cảnh báo backlog `T49-nhan-queue-bi-chan` đã biết. Chưa kiểm nút/hộp xác nhận mới bằng Electron thật hoặc thao tác trên box thật. Check có liên kết T58 qua app được yêu cầu riêng trước bàn giao review.

## Áp dụng box thật sau khi gộp

1. Khởi động lại app để nạp `main.js`/`preload.js` mới; chờ box không còn agent/merge đang chạy. Không gọi QA cũ trước khi đồng bộ nguồn.
2. Tại một trong tám mục QA source **`2c6ae36`**, chọn **Lấy main (sao lưu nhánh)**; đối chiếu SHA trong hộp xác nhận với báo cáo này rồi xác nhận. Một lần xử lý cả tám mục cùng source. Nếu nguồn đã đổi hoặc app báo busy/dirty thì dừng và đối chiếu lại, không xóa khóa hay dữ liệu chung.
3. Kiểm registry/UI: không còn mục QA lỗi có thể Retry/Repair cho source cũ; có entry `replaced`, tám liên kết `supersededBy`, backup ref và snapshot. HEAD QA bằng main ở lúc xác nhận; lịch sử test/bằng chứng còn nguyên. Ghi kết quả thực tế vào báo cáo rồi mới nghiệm thu dọn queue T59.

Các queue ID gốc: `d49db75c-b0b5-47e5-82e4-063794d5d7f8`, `2044663f-fced-443f-87c9-132c52e722a8`, `7cbfd5d1-5684-44ca-a0dd-5d8a9a01507d`, `ab7837b5-564c-437b-87b3-3facd9d5dbdc`, `48bea8eb-2640-4d32-99a9-0110e98ca06d`, `829ae9de-68e3-4305-b118-665d8accc8dd`, `adc2e957-b641-44ad-bc6c-653281fb2ff9`, `14f94606-258d-4080-9b3b-2a8d6f1e2216`.

**Chưa nghiệm thu dọn box thật, chưa đề nghị đóng T58/T59.** T53/T55 vẫn chờ xác nhận UI trên box thật; T52 giữ Xong.
