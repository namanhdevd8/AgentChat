# Sprint 12 — sửa tích hợp theo yêu cầu End-User

Techlead · 2026-10-15 · nền worktree `0b17f86` (đã có BE `c0efdd0`). End-User giao techlead sửa chung phần còn lại sau khi dừng hai dev. Chỉ sửa trong worktree techlead; không sửa nhánh dev/QA hay định nghĩa task chung.

## Phần sửa

### T51 — khôi phục Tiếp tục sau crash

- Dùng chung một đường khôi phục control store cho mở dự án, `chainState` và `continueChain`; tuần tự hóa khôi phục theo project/box. Giữ thao tác trong bộ đếm routing để đổi box không xen vào giữa thao tác.
- Claim và trạng thái cha `continued` được ghi atomic trước thông báo/cấp lượt. Gọi lặp trả cùng childChainId và cùng trạng thái **cha** như `chainState`; không trả trạng thái ready của con cho thẻ cha.
- Claim giữ `sourceRefs`, taskIds và runId trước khi enqueue. Phần reserved chưa cấp được giữ trong một thẻ dừng của chuỗi con, chỉ chạy sau thao tác Tiếp tục mới. Phần dispatching/admitted/uncertain không tự chạy lại; giữ riêng là chưa rõ kết quả. Orphan chặn cấp tiếp.
- Đối chiếu terminal đã được app ghi nhận; không chạy lại lượt đã kết thúc. Giữ người nhận từ terminal chưa kịp checkpoint, đồng thời tránh giả định rằng một outgoing chưa có terminal là chắc chắn chưa chạy. Trường hợp đó được giữ là uncertain để người dùng kiểm tra.
- Stop đang draining sau restart được đối chiếu với terminal/khóa. Giữ tin nguồn và phần việc còn chờ; chi phí terminal có sau checkpoint được cộng một lần. Checkpoint cũ thiếu dấu đã tính tiền được gắn cờ thiếu dữ liệu để tránh cộng trùng.
- Tham chiếu nguồn kiểm `seq/at/textHash`, trạng thái thu hồi và agent còn tồn tại. Store hỏng, thiếu checkpoint hiện đại hoặc nguồn lệch không cho cấp mù. Log legacy vẫn giữ xử lý UNAVAILABLE khi không xác định được childChainId.
- Sửa khoảng thời gian tin stop đã xuất hiện nhưng hàm append chưa trả về để lưu logMessageRef: chỉ liên kết lại đúng tin stop đã xác minh; reservation chưa hết thì vẫn draining.
- Prompt Tiếp tục chứa các tin nguồn theo thứ tự, nhắc kiểm kết quả hiện có trước khi làm tiếp. Không dựng prompt chỉ có danh sách tên agent.

### Tiến triển và admission

- Coalesce chỉ áp dụng cùng chain/agent/loại lượt; giữ đủ nguồn. Hai chain khác nhau không gộp nhầm.
- Recheck trạng thái chain sau await chuẩn bị; nếu đã halt thì trả việc về pending và giải phóng reservation, không lách thêm job.
- Khóa task dùng danh tính và nội dung định nghĩa thay vì UUID/revision trạng thái. Check novelty lấy hồ sơ app đã lưu, yêu cầu task/definition, policy, treeStable và treeSha hợp lệ; không nhận lời tự khai trong kết quả CLI.
- Kết quả đến muộn vẫn tính chi phí nhưng không reset hoặc làm phình tập tiến triển của chain đã halt. Chạm 8192 proof giữ tập đã thấy và dừng; runId idle được xóa khi có tiến triển mới.

### T53 — listener FE

Hai API `onChainChanged` và `on('chain-changed')` là hai đường thay thế nhau. Chỉ đăng ký một đường; giữ unsubscribe, guard revision/box/openSeq và toàn bộ bố cục hai tầng/Esc của T55.

## Kiểm tra

Lấy các ca QA từ `388c8e1` vào `check.js`; giữ các suite cũ, ca reducer/repair/legacy, và assertion bắt buộc `ok (main harness end)`. Không đổi ca Sprint 12 thành xfail/BUG.

| Nhóm | Cách kiểm |
| --- | --- |
| Mốc task/check | Các ca QA doing/review, failed/passed/passed chạy qua app main thật; thêm done lần đầu/lặp, định nghĩa mới, bằng chứng sai task/policy/tree hoặc timeout bị loại. |
| Admission | Cap 2 với 3 người; gate await trong ask rồi halt; cùng chain coalesce, khác chain tách; đủ nguồn và reservation được giải phóng. |
| tracking-limit | Seed 8191 proof trong fixture rồi gọi evaluator/route thật: đạt 8192 thì phanh, pending được giữ, kết quả muộn không làm mất baseline hay mở chain. Không chạy 8192 lượt CLI. |
| Crash/claim | Fresh module sau snapshot atomic; reserved trước/sau notice, dispatching/admitted/uncertain, terminal đã có, orphan, draining, nguồn thu hồi/store hỏng, double click và gọi lại sau restart. Không tự spawn khi chỉ đọc/khôi phục; reserved chạy sau một thao tác mới. |
| Routing sau terminal | Terminal trước checkpoint giữ người nhận/nguồn; chi phí partial được khôi phục đúng một lần. Lượt chưa rõ không chuyển thành chưa chạy. |
| Merge | Giữ QA publish sau check pass, candidate/checkId/commandResult, retry/superseded; giữ các ca deadlock repair, hai click, reducer, T38 và S11. |
| FE | Ca QA kiểm một listener khi preload có cả hai API; giữ late IPC và chuỗi Enter/Space → Esc của bảng task. |

Fixture chạy scheduler/evaluator/IPC thật trên project và userData tạm, CLI giả; chỉ xuất các hàm nội bộ trong bản Module do harness biên dịch, không thêm API test vào app sản phẩm. Ca race chờ điều kiện ready thật trước khi kiểm hai thao tác Tiếp tục; có assertion riêng rằng draining từ chối thao tác.

### Kết quả trên bản sửa cuối

- `node --check` main/core/renderer/check và `git diff --check`: đạt.
- `node check.js --electron`: exit 0, Electron 44.4.5, **19/19**. Gồm viewer, bố cục 240/300/635px × sáng/tối, Enter/Space → Esc, focus/aria, khôi phục maximized và đóng cửa sổ rồi đổi theme.
- `npm run check`: **exit 0**, gồm toàn bộ suites và main harness chạy tới marker cuối (runner bắt buộc có marker mới được coi là đạt). Chỉ còn dòng BUG của backlog T49 nêu bên dưới.

SHA-256 các file đã kiểm (trước commit bàn giao; không dùng SHA nền để nhận là code cuối đã kiểm):

```text
8e09752398b7e9335a2985d3ddee4f239198a5627bac38b141c66ac0d47f1fc9  main.js
e0a5ed7fda86d96ffaa914854e1e1574f24d5dfa9e8606f9c5761e9b0eb104ef  core.js
233d1b7c461578100545f2dab089c37ea5c8cf47eec6c6bfa2790ccd096aa58f  renderer.js
f3c2858e0f0cf6526b4159a7581329ccb2bf8968a6c3cb584022021613926435  check.js
```

Có lần check trong quá trình sửa fail ở assertion hai lần Tiếp tục đồng thời; lần đó chưa in response để xác định chính xác nhánh lỗi. Khi soát đã thấy fixture gọi ngay khi thẻ xuất hiện, trước khi draining xong, và cửa sổ thời gian thiếu logMessageRef. Đã thêm ca có kiểm soát cho khoảng thời gian này, chờ ready trước khi kiểm concurrency và giữ assertion draining từ chối. Không coi lần fail là đạt; kết quả cuối ở trên mới là bản bàn giao.

## Giới hạn và bàn giao

- Kiểm tự động dùng repo/CLI giả; Electron chạy app thật với dữ liệu mẫu. Chưa thử trên box đang dùng của End-User; không thay kết quả tự động bằng tuyên bố đã nghiệm thu box thật.
- Cảnh báo `T49-nhan-queue-bi-chan` là backlog cũ, ngoài yêu cầu này; không sửa badge đó hoặc nới cổng done để làm xanh.
- Đây là kết quả sửa/kiểm của tác giả, chưa phải QA độc lập mới hoặc quyết định đóng Sprint 12. T54/T57 đã đóng vẫn giữ nguyên; T56 đã đạt được kiểm hồi quy.
- Check bằng shell không tạo checkId liên kết task. T51/T53 hiện vẫn thuộc dev-be/dev-fe; PM cần điều phối hồ sơ kiểm/review đúng task và bản code mới trước khi đóng. Techlead chỉ gửi review của T55 được giao, không mượn bằng chứng T55 để đóng T51/T53.
- Sau khi bản sửa gộp đạt cần **khởi động lại app** vì có đổi main.js/core.js.
