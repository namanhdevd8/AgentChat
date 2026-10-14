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
