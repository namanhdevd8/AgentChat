# Sprint 12 — T53: mở Tiếp tục cho phần chưa chạy sau crash

PM · 2026-10-15. Techlead tiếp tục sửa theo quyết định End-User; hai dev không được gọi lại triển khai.

## Kết quả nghiệm thu T52

QA kiểm bản tích hợp `51b3909`: `npm run check` exit 0 khoảng 90 giây, tới marker cuối main harness. Probe bổ sung dùng payload recovery thật của BE exit 1: **T52 chưa đạt**, lỗi thuộc đầu ra FE T53. Listener và các ca BE tích hợp đã kiểm đạt; chưa chạy lại Electron hoặc thử box thật. Restart trong harness là nạp lại module main, không phải khởi động lại Electron thật.

Tái hiện: ghi snapshot atomic có claim `reserved` → nạp lại main → recovery tạo stop con giữ người nhận chưa chạy → `chainState` trả `phase: interrupted`, `canContinue: true` → nút Tiếp tục bị khóa trong chat và Cần bạn. Phần việc được BE giữ lại nhưng người dùng không bấm tiếp tục được.

PM đọc code xác nhận ba đường FE đều khóa `interrupted` vô điều kiện: `renderChainStopCard` khoảng renderer.js:1695, nhánh Cần bạn có ChainView khoảng 3905 và fallback trực tiếp từ item ngay bên dưới. Trong BE, recovery/getChainView cho phép interrupted có pending chắc chắn chưa cấp, không orphan/running. Contract mục 5.3 và 7 cho phép phần đó chạy sau một thao tác mới; nhãn interrupted tự nó không đủ để cấm.

## Yêu cầu sửa — techlead

Sửa T53 trong `renderer.js` và assertion liên quan ở `check.js` trên main mới nhất; mốc hiện tại `1ca2a84` có cùng code sản phẩm với `51b3909`.

- Chat, Cần bạn có ChainView và fallback item phải nhất quán: `interrupted` với `canContinue:true` bật nút cho phần BE đã xác nhận được phép. Giữ cảnh báo gián đoạn/việc chưa rõ kết quả, không đổi nhãn BE thành ready để che lỗi FE.
- `canContinue:false`, orphan/chưa đủ dữ kiện, chỉ còn pending uncertain, draining, continued và unavailable vẫn khóa đúng. Không mặc định cho phép interrupted khi thiếu canContinue; lỗi API không được tự bật quyền tiếp tục. Giữ hành vi legacy hợp lệ và để main kiểm lại khi nhận thao tác.
- Bấm gửi đúng `seq` của stop con, không cần runId; response/event cập nhật đúng thẻ, chống bấm trùng trong khi đang gửi và giữ guard box/openSeq/revision. Không cấp lại phần uncertain hoặc phần đã có kết quả.
- Dùng payload BE thật trong test để kiểm cả nút chat và nút Cần bạn, gồm nhánh có ChainView và fallback. Thêm đối chứng interrupted có/không có quyền; giữ các ca draining/continued/unavailable, listener, bố cục và Esc đã đạt.

## Nhận test QA khi nhánh đang xung đột

QA đã commit `f000263b40b2bb842081834238d66a258ab9c59c`, chỉ đổi `check.js`; queue bị conflict ở file đó vì nhánh vẫn có nền QA trước bản tích hợp. Không cần chờ QA gỡ merge để sửa sản phẩm.

PM đã lưu [patch phần mới so với main](sprint-12-recovery-ui-checks.patch), lấy đúng `git diff 51b3909 f000263 -- check.js`. Bốn hunk: truyền payload recovery vào rendererS12Checks, assert nút chat với payload đó, mở rộng listener cho cả hai API/đường fallback/unsubscribe, và gọi ca FE từ main harness bằng stop con thật. `git apply --check` trên worktree PM có bản tích hợp đã đạt; chưa áp dụng hay sửa file sản phẩm.

Techlead lấy bốn hunk này trên main, không thay toàn bộ check.js bằng bản cũ hoặc áp dụng lại cả lịch sử QA. Test mới hiện kiểm nút chat; cần bổ sung Cần bạn và nhánh fallback khi sửa. Giữ toàn bộ nhóm recovery/proof/admission/coalesce/tracking-limit và marker cuối harness trong main.

## Kiểm và bàn giao

Chạy ca hồi quy sau sửa rồi `npm run check` một lần, bảo đảm tới marker cuối. Kiểm Electron có giới hạn cho luồng stop con → Tiếp tục tại hai vị trí nếu cần để chứng minh thao tác UI; không lặp bộ bố cục T56. Lưu SHA, lệnh/exit code, output và phần chưa kiểm. Không chạy lặp tìm lần xanh hoặc giảm assertion để gộp.

Techlead bàn giao PM sau khi sửa và kiểm; PM gọi QA kiểm lại trên bản đã gộp. T53 tiếp tục Đang làm, T52 giữ Chờ duyệt với kết luận chưa đạt; T51 chưa đóng vì còn bước bằng chứng, T55 vẫn chờ nghiệm thu box thật. T54/T57/T56 giữ Xong. Chưa thay đổi định nghĩa hoặc trạng thái task trong lượt PM này.

## Nhận bản sửa và giao QA kiểm lại

Nguồn techlead **`8d5e4d39ee31fcbba6d5ee1ed1b93512eb526262`**, chỉ đổi `renderer.js`, `check.js` và [báo cáo sửa](sprint-12-recovery-ui-fix.md). Techlead báo ca FE riêng và `npm run check` đạt, tới marker cuối; chưa chạy lại Electron hoặc thử box thật. PM đã đối chiếu diff: có điều kiện dùng chung cho chat/Cần bạn/fallback, bảo vệ request đang chờ và box cũ; nhận bốn hunk QA và mở rộng kiểm bằng payload recovery thật. Đây chưa phải kết luận T52 đạt.

Đã xác minh gộp vào main **`29151067acd921f30e6954c210453c6981ab68f0`** lúc 18:15:37 UTC ngày 2026-10-14. Queue `8576d6b9-1b0e-47f1-b41b-bdcdb3713975` merged; check `f9707d30-db05-4eab-8d72-0e6a43f512db` passed, exit 0, 99,554 giây, treeStable. Check không có taskRefs/reviewIds nên chỉ xác nhận bản gộp đã kiểm, chưa đủ dùng đóng T51/T53/T55. Mục queue thứ hai cùng source SHA đã chuyển merged, không cần gọi lại techlead hay tạo lần kiểm khác để gộp lại bản này.

QA nhận T52 sau khi bản này gộp đạt; ghi SHA thực tế khi kiểm. Đồng bộ main và giữ các test tích hợp mới: phần QA ở `f000263` đã được tiếp nhận/mở rộng trong bản sửa, không đưa nguyên file cũ trở lại để giải xung đột. Nếu nhánh còn thay đổi test riêng chưa được nhận thì đối chiếu từng phần và báo PM; không bỏ assertion chưa đối chiếu.

Phạm vi kiểm lại tập trung:

1. Tái hiện ca reserved → restart module main → stop con interrupted/canContinue:true. Dùng message/ChainView thực để bấm cả chat và Cần bạn (cache, embedded, fallback); gửi đúng seq, chỉ cấp phần chắc chắn chưa chạy.
2. Đối chứng false/thiếu canContinue, uncertain-only, orphan, draining, continued, unavailable và lỗi chainState/continueChain vẫn khóa đúng; nhãn gián đoạn và cảnh báo uncertain còn hiện. Soát cả trạng thái sau render lại/event mới, không chỉ nút cũ vừa bấm.
3. Bấm hai vị trí khi một request đang chờ không gửi trùng; event chen giữa không bật lại nút. Click và response của box cũ không tác động box mới; response/state mới hiển thị đúng thẻ.
4. Chạy `npm run check` một lần, giữ toàn bộ nhóm BE đã đạt và xác nhận main harness tới marker cuối. Nếu fail-fast, lưu lỗi và nêu rõ phần chưa chạy; không chạy lặp tìm lần xanh.
5. Vì lượt sửa có đổi handler, kiểm Electron tập trung vào nút Tiếp tục và chuyển box nếu DOM harness chưa chứng minh thao tác thực; không lặp bộ bố cục T56. Báo rõ Electron/restart thật hay chỉ module/DOM harness và phần chưa thử trên box người dùng.

QA bàn giao T52 với kết quả/SHA/lệnh/exit code và các giới hạn. T52 chuyển Đang làm khi PM gọi; T51/T53/T55 chưa đóng, T54/T57/T56 giữ Xong. Bằng chứng đúng task cho bản cuối chỉ làm mới sau khi nghiệm thu ổn định; không dùng check không liên kết task để đóng thay.

## Kết quả kiểm lại trên 2915106

T52 chưa đạt: suite cũ exit 0, ca QA mới phát hiện Cần bạn tự bật lại nút sau lỗi API khi event của stop khác làm render lại. Electron SIGABRT trước fixture nên chưa nghiệm thu. Lượt gộp báo cáo PM cũng đỏ riêng ở fixture publish vì index.lock trong repo tạm. Techlead xử lý theo [yêu cầu sửa và log đối chiếu](sprint-12-api-error-rerender.md); có patch QA mới lấy trực tiếp trên nền main, không cần đợi nhánh QA hết xung đột.
