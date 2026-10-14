# Sprint 12 — giữ trạng thái lỗi Tiếp tục qua render lại

PM · 2026-10-15. Nền sản phẩm **`2915106`**; T52 vẫn chưa đạt. Techlead tiếp tục sửa theo quyết định End-User, không gọi hai dev triển khai lại.

## Kết quả và lỗi T53

QA chạy `npm run check` một lần trên `2915106`: exit 0, 94,6 giây, qua marker cuối harness. Recovery, đúng seq, chống bấm trùng và guard đổi box đạt trong những ca đã chạy. Ca QA mới `T52-api-error-rerender` exit 1:

1. Stop có quyền Tiếp tục; bấm nút trong Cần bạn.
2. `continueChain` trả lỗi API; nút vừa bấm bị khóa.
3. Nhận `chain-changed` của một stop khác, khiến `renderNeeds` dựng lại danh sách.
4. Nút mới của stop bị lỗi tự bật bằng state cũ. Cả cache, embedded và fallback đều lỗi.

PM đối chiếu code ở main: catch chỉ báo toast, finally bỏ `continuingChains`; render mới tính quyền từ cView/item cũ. Khóa DOM của nút đã bị thay thế không lưu được kết quả lỗi. `applyChainViewUpdate` của stop khác gọi renderNeeds cũng đi qua đường này. Đây không phải lỗi claim BE đã sửa.

### Đầu ra sửa của techlead

- Trạng thái lỗi phải gắn với đúng stop trong đúng project/box, được cả chat/Cần bạn dùng nhất quán và giữ qua render lại. Chỉ dữ kiện mới hợp lệ cho chính stop đó mới có thể xác nhận lại quyền; event của stop khác, state cũ hoặc render thuần túy không được mở lại nút.
- Có đường phục hồi sau khi xác minh lại: không khóa vĩnh viễn một stop dù main đã xác nhận được phép tiếp tục. Đổi box không mang trạng thái lỗi sang box khác; response cũ không ghi ngược vào box hiện tại.
- Giữ interrupted/canContinue:true cho phần chắc chắn chưa chạy, các chốt false/thiếu dữ kiện/draining/continued/unavailable, pending uncertain, đúng seq, chống gửi trùng và kiểm cuối ở main.
- Nhận assert QA hiện có; thêm đối chứng event/state cũ không mở khóa, xác nhận hợp lệ mới của đúng stop mở đúng khi được phép, và hai vị trí UI nhất quán. Không chỉ giữ nút DOM vừa bấm ở trạng thái disabled.

## Patch QA và xung đột nhánh

Nguồn QA **`2c6ae36185d8c5a55f7848c85b3e3044b571321c`**, nhánh sạch, chỉ sửa check.js. Queue `d49db75c-b0b5-47e5-82e4-063794d5d7f8` conflict tại check.js do lịch sử trước bản tích hợp.

PM lưu [patch mới so với main](sprint-12-api-error-rerender-checks.patch), đúng `git diff 2915106 2c6ae36 -- check.js`. Patch thêm ca render lại sau lỗi và chẩn đoán exit/signal khi Electron không khởi tạo được; không mang lại phần test cũ đã tích hợp. Đã kiểm áp dụng bằng `git apply --check` trên worktree techlead, không sửa file sản phẩm ở đó. Techlead lấy patch này rồi sửa trên main mới nhất; giữ mọi ca tích hợp và marker cuối.

## Lượt gộp báo cáo PM bị đỏ — phần harness T52 cần ổn định

PM xác minh queue `717996da-5b19-402d-9a52-d39f701927fc`: candidate `40d269c` chỉ khác main `2915106` ở **18 dòng báo cáo**, không đổi sản phẩm/test. Check lỗi tại ca D publish, `check.js:3696`, lệnh fixture `git checkout -q -b qa-detour` trả 128 vì `.git/index.lock` đã tồn tại trong **repo tạm agent-chat-git-…**.

Ca D hiện chỉ đợi queue state checking rồi checkout, trong khi fixture/app còn có hoạt động Git bất đồng bộ. Log xác nhận va chạm khóa; PM chưa tái hiện riêng hoặc chứng minh chính xác tiến trình nào đang giữ khóa. Không coi lần đỏ này là check đạt vì sau đó QA có lượt xanh, cũng không quy lỗi cho file báo cáo.

Techlead soát và ổn định ranh giới đồng bộ của **fixture publish trong check.js** cùng lượt sửa: cần tạo tình huống main đổi nhánh sau check bắt đầu mà không đua với thao tác Git còn chạy. Dùng tín hiệu/barrier có giới hạn phù hợp harness, giữ assert phase publish/TARGET_CHANGED, candidate/checkId và retry/superseded. Không xóa index.lock đang dùng, bỏ assert, bọc lỗi cho qua, chèn sleep dài tùy ý hoặc chạy lại toàn suite đến khi xanh. Nếu xác định lỗi ở sản phẩm thay vì fixture, báo bằng chứng trước khi mở rộng bản sửa.

Không cần sửa nhánh PM hoặc metadata hàng chờ để gỡ lượt đỏ cũ. Sau khi bản sửa test/sản phẩm vào main, báo cáo PM còn chờ sẽ được gộp/kiểm trên nền mới theo quy trình.

## Electron và bàn giao

QA báo Electron bị **SIGABRT trong khởi tạo macOS trước fixture**: chưa có kết quả nghiệm thu Electron của lượt này, cũng chưa có box thật. Đây là giới hạn kiểm tra riêng, không đủ để kết luận tính năng sai hoặc đạt. Giữ output exit/signal; không tự lặp Electron để tìm lần chạy được. Chẩn đoán khởi tạo có giới hạn nếu cần để kiểm UI sau sửa, không thay cấu hình máy hoặc dependency ngoài phạm vi.

Sau sửa, kiểm ca hồi quy rồi chạy `npm run check` một lần, giữ marker cuối; báo SHA/lệnh/exit code và phạm vi còn thiếu. Techlead bàn giao PM, PM gọi QA kiểm độc lập trên bản gộp. T53 giữ Đang làm; T52 giữ Chờ duyệt với kết luận chưa đạt; T51/T55 chưa đóng; T54/T57/T56 giữ Xong. PM lượt này chỉ đọc code/log và ghi báo cáo/patch, không chạy lại sản phẩm.

## Nhận bản sửa 5430367 và bàn giao QA

Nguồn techlead **`5430367af930aa65fd12ca66414b0fe4bf1aa6c5`** chỉ đổi renderer.js, check.js và [báo cáo sửa](sprint-12-api-error-rerender-fix.md). PM đối chiếu diff: lỗi được giữ ngoài DOM và dùng chung hai vị trí; event mới đúng stop hoặc lần đọc trạng thái bắt đầu sau lỗi mới được xác nhận lại. Nút **Kiểm tra lại** chỉ gọi chainState, không chạy agent. Đây là đường phục hồi của lỗi đang sửa, không đổi phạm vi sản phẩm.

Đã xác minh gộp vào main **`7b30ac89db815c2aaf4411d556924a6d826a44b6`**: queue `e35e01cb-0bdc-4ede-95a9-ded195574048` merged lúc 18:40:07 UTC ngày 2026-10-14. Hồ sơ `bda27514-a918-49b6-b048-bf59f58041e2` passed, npm run check exit 0, 99,126 giây, treeStable. TaskRefs/reviewIds rỗng nên chưa dùng đóng các task code. Mục queue thứ hai cùng source cũng đã kết thúc merged, không cần gộp lại bản sửa.

Fixture publish dùng check thật, chặn kết quả trước publisher bằng barrier có timeout, chờ terminal/facts hoàn tất và dùng Git lock trong harness khi đổi nhánh; vẫn kiểm TARGET_CHANGED, candidate/checkId, retry và superseded. Không thêm test API vào main. Techlead báo check tổng sau điều chỉnh đạt; chưa kiểm lại Electron hoặc box thật.

Techlead còn phát hiện fixture recovery trước lấy JSONL thô thiếu seq, nên phép so sánh undefined với undefined chưa chứng minh gửi đúng ID. Bản mới lấy stop qua IPC logPage và bắt buộc seq là số nguyên. QA phải kiểm điều này trên dữ liệu mới, không dùng kết luận “đúng seq” của fixture cũ làm bằng chứng thay thế.

Sau khi bản sửa gộp đạt, QA nhận T52 kiểm độc lập:

1. Lỗi Tiếp tục từ cả chat/Cần bạn giữ khóa ở cả hai vị trí sau render lại, event stop khác, revision cũ/không hợp lệ hoặc box khác; cache/embedded/fallback đều được bao phủ. Kiểm cả nút dựng lại, không chỉ biến giữ nút cũ.
2. Event mới đúng stop chỉ mở nếu BE cho phép. “Kiểm tra lại” đọc mới sau lỗi có thể xác nhận cùng revision; request đọc bắt đầu trước lỗi, sai stop/box hoặc dữ liệu cũ không xóa lỗi mới. Nút này không gọi continueChain và không spawn agent; không làm mất nhãn uncertain.
3. Đổi box/callback muộn, chống bấm trùng giữa hai vị trí, recovery interrupted true/false và seq số nguyên từ logPage thật vẫn đúng. Giữ các ca tích hợp đã đạt khi đồng bộ main; không đưa check.js từ lịch sử QA cũ trở lại.
4. Soát barrier fixture publish: check thật chạy xong, không bịa pass, timeout/finally không treo, giữ mọi assertion lỗi publish/retry/superseded. Chạy npm run check một lần và xác nhận marker cuối. Không chạy thêm vòng chỉ để tìm lần xanh.
5. Electron chỉ kiểm luồng Tiếp tục/“Kiểm tra lại” liên quan nếu khởi tạo được; lưu exit/signal nếu SIGABRT tái diễn trước fixture, không lặp bộ bố cục. Báo tách biệt DOM/module restart, Electron thật và box End-User chưa kiểm.

Đầu ra: SHA, lệnh/exit code, ca đạt/lỗi/chưa kiểm và review T52. T52 chuyển Đang làm khi PM gọi; T51/T53/T55 tiếp tục mở, chỉ bổ sung bằng chứng đúng task trên bản cuối sau QA. PM chưa tự chạy lại sản phẩm trong lượt nhận bàn giao này.
