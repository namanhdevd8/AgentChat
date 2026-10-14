# Hotfix bố cục bảng task — giao nghiệm thu

PM · 2026-10-14. End-User yêu cầu techlead trực tiếp sửa bảng task quá chật; yêu cầu này cho phép techlead sửa UI ngoài phạm vi thiết kế thông thường. Bản triển khai: nguồn `4f2e323`, đã gộp main `18a0b92`. Báo cáo tác giả: [hotfix-task-layout.md](hotfix-task-layout.md).

## Đã nhận và giới hạn

- PM đã mở cả hai ảnh lỗi của End-User và ảnh `task-layout-light-240.png` của techlead. Ảnh mới tách tên task thành vùng riêng, người nhận/trạng thái xuống hàng dưới; không còn cảnh tên bị ép mất bởi nút Bằng chứng riêng. Đây là nhận xét từ ảnh fixture, chưa phải kiểm trên box của End-User.
- Đã đọc diff `index.html`, `renderer.js`, `check.js`: sửa bố cục hàng task, gộp trạng thái vào nút mở bằng chứng, cập nhật assertion DOM. Không thay IPC hay cổng duyệt task. Theo tác giả, `npm run check`, probe Electron sáng/tối ở 240/300/635px và bàn phím đều đạt. PM chưa chạy lại các kiểm này.
- Vì techlead tự viết code theo yêu cầu trực tiếp, QA kiểm độc lập trước khi PM đóng hotfix. Phần này không chờ T51/T53 của Sprint 12; T52 vẫn chờ đủ BE/FE Sprint 12.
- T50 là task thiết kế đã đóng, không dùng lại làm hồ sơ nghiệm thu code UI. Tiêu đề commit có T50 không phải liên kết bằng chứng cho hotfix.

## Task và đầu ra

| Task | Người phụ trách | acceptance | Đầu ra và điều kiện đóng |
| --- | --- | --- | --- |
| T55 | techlead | code | Bản sửa bảng task đã vào main; bổ sung hồ sơ kiểm app gắn T55 và bàn giao review đúng SHA. PM đóng bằng checks sau khi T56 đạt và có phản hồi thử tay cần thiết. |
| T56 | qa | manual | Nghiệm thu độc lập trên bản có `18a0b92`, báo SHA thực kiểm, kết quả từng ca, lỗi/cách tái hiện và giới hạn. PM đóng manual theo báo cáo nghiệm thu. |

Hiện giao T55 bổ sung hồ sơ và T56 kiểm độc lập, hai việc không cần sửa chung code. Nếu có lỗi sản phẩm, QA báo PM để trả T55 cho techlead; không tự sửa UI. QA chỉ bổ sung ca kiểm còn thiếu vào phần riêng của `check.js` khi cần, không sửa suites của T51/T53 đang làm.

## Bổ sung bằng chứng cho T55

Code được gộp trước khi task này tồn tại, nên check queue cũ không tự trở thành bằng chứng T55. Dùng đường kiểm lại của contract Sprint 11 mục 2.3 và 3.3:

1. Techlead dùng worktree sạch đã được app đồng bộ tới main có hotfix. Nếu còn thay đổi hoặc app chưa đồng bộ thì báo PM, không tạo commit rỗng.
2. Yêu cầu **app** chạy `npm run check` qua block `run-command` có `tasks:[{id:"T55",expectedRevision:"revision hiện tại từ prompt"}]`. Chạy trực tiếp bằng shell chỉ là kiểm cục bộ, không tạo hồ sơ app cho T55.
3. Khi app trả kết quả, bàn giao T55 bằng `task-status` sang review với revision hiện hành; báo SHA/checkId nếu app cung cấp. Run-command và task-status ở hai kết quả riêng theo protocol.
4. PM chỉ dùng bằng chứng còn hiệu lực, cùng bản code và liên kết T55; không đổi acceptance thành manual để bỏ cổng kiểm, không gán T55 vào record cũ. Nếu main/test thay đổi làm bằng chứng cũ hết hiệu lực thì dùng hướng dẫn kiểm lại của app.

## QA T56

- Lấy bản main có hotfix, ghi chính xác SHA thực kiểm. Chạy `npm run check`; kiểm Electron với hàm render/CSS thật và payload `taskEvidence` thật hoặc fixture theo đúng schema đã đối chiếu. Tách rõ kết quả tự động, Electron và phần chưa thử trên box người dùng.
- Cột 240/300/635px, theme sáng/tối: tên tối đa hai dòng và còn đọc được; metadata xuống dòng; không tràn ngang, chồng nút hoặc mất cảnh báo đổi test. Thử tên task/người nhận và chuỗi lỗi rất dài.
- Nút trạng thái có mũi tên đóng/mở, nhãn truy cập và `aria-expanded` đúng; bấm trạng thái chỉ mở bằng chứng, bấm tên mở spec. Enter/Space/Esc đúng hành vi, Esc trả focus.
- Mở/đóng panel với đủ tám trạng thái xác minh, nhất là ready, failed, unavailable, manual; không che nút đóng hoặc tràn ở 240px. Giữ nội dung/cảnh báo/bản kiểm, không đổi nghĩa trạng thái hay cổng done.
- Tải lại/đổi box khi đang mở panel hoặc IPC chậm: không hiện bằng chứng của task/box cũ. Bộ lọc/nhóm task và dòng đã done vẫn hiển thị đúng.
- Nếu lỗi, báo bước tái hiện, kích thước/theme/trạng thái và ảnh trong `.chat/attachments/` theo quy tắc nhóm. Không dùng task thật làm fixture hoặc tự thay trạng thái task của End-User.

## Phối hợp với Sprint 12 và hoàn tất

- Dev-fe T53 tiếp tục phần ChainView/Cần bạn/merge trên nền có hotfix; giữ bố cục task hai tầng và nút trạng thái mở bằng chứng. T53 không được khôi phục DOM/assertion bảng task cũ khi gộp. Mỗi bên giữ phần `check.js` của mình và giữ đầy đủ lời gọi suites.
- Sau QA độc lập đạt, PM báo End-User Cmd+R để xem chính box thật ở cỡ cột họ dùng. Chưa có phản hồi thử tay thì ghi rõ phần còn chờ; không suy từ ảnh fixture rằng End-User đã nghiệm thu.
- Sau khi đã đủ bằng chứng và nghiệm thu, PM đóng T55 bằng approval checks, T56 bằng approval manual và ghi kết quả tại đây. Hiện chưa đóng hai task.

## Nhận hồ sơ kiểm T55 (2026-10-14)

- Techlead đã chạy `npm run check` qua app, liên kết T55: nguồn `18a0b92`, exit 0, 55,6 giây; checkId `8265cd1b-eb0b-48fb-8c4f-28ea0d128cd8`, `verificationError: null` theo bàn giao.
- Bảng task app cấp lúc 14:01 UTC xác nhận T55 ở `review`, verification `ready`, có đúng checkId trên. Đây là bằng chứng của T55; không dùng dòng “check gần nhất” trong worktree PM để suy trạng thái hotfix.
- Giữ T55 Chờ duyệt; T56 đang được QA kiểm độc lập. Chưa có kết quả T56 hoặc phản hồi thử tay trên box thật, nên chưa đủ điều kiện đóng hotfix. Không gọi lại QA cho cùng việc đang chạy.
- Cảnh báo `T49-nhan-queue-bi-chan` vẫn là backlog đã biết, không được ghi thành lỗi mới của bố cục. Khi đủ nghiệm thu, PM kiểm lại hiệu lực bằng chứng theo bảng task hiện hành trước khi gửi done.

## QA T56 lần 1 — bố cục đạt, còn lỗi Esc (2026-10-14)

QA báo kiểm độc lập trên main `18a0b92`, Electron 44.4.5 thật, bằng `node check.js --electron`; đã chạy `npm run check` và bổ sung ca IPC chậm. PM ghi nhận kết quả QA, chưa tự chạy lại Electron.

- **Đạt:** cột 240/300/635px ở cả sáng/tối; panel mở đủ tám trạng thái; tên/người nhận/lỗi dài; không tràn, chồng nội dung hoặc che nút đóng. Tên tối đa hai dòng, metadata riêng, cảnh báo đổi test còn nguyên, nhóm Xong gập sẵn và output `<script>` hiện thành chữ.
- **Đạt:** Enter trên tên mở spec; Esc đóng viewer và trả focus về tên. Enter/Space trên trạng thái mở panel bằng `taskEvidence` thật, nhãn truy cập và `aria-expanded` đúng.
- **Đạt:** trả lời IPC đến muộn sau đổi box/tải lại không đưa task/bằng chứng cũ trở lại. QA đã thử bỏ chốt chặn trên bản thử để xác nhận ca mới thực sự phát hiện lỗi.
- **Chưa đạt:** focus ở nút trạng thái sau khi Enter/Space mở panel → bấm Esc ngay không đóng panel; phải Tab vào panel rồi Esc mới đóng. PM đọc code xác nhận handler hiện chỉ gắn ở `renderTaskEvidencePanel`, `renderer.js:3237`.

### Trả T55 cho techlead

1. Sửa trong phạm vi hotfix: Esc đóng panel tương ứng khi focus vẫn ở nút trạng thái hoặc ở trong panel; `aria-expanded=false`, xóa trạng thái mở và giữ/trả focus về nút. Không bắt Esc toàn cục làm ảnh hưởng viewer hay panel/task khác; giữ thao tác mở bằng Enter/Space.
2. Thêm assert bắt đúng chuỗi **focus nút → Enter/Space → Esc ngay, chưa Tab** và kiểm Esc trong panel vẫn hoạt động. Ca IPC chậm QA vừa thêm phải được giữ khi đồng bộ/gộp main; không sửa phần T53.
3. Chạy `npm run check` và xác minh ca phím trên Electron thật; gửi lại review T55 để bằng chứng gắn bản sửa mới. CheckId của nguồn `18a0b92` là lịch sử, không dùng thay kết quả kiểm bản sửa Esc.

PM trả T55 về Đang làm. T56 giữ Chờ duyệt; sau khi bản sửa đã gộp, PM gọi QA kiểm lại ca Esc và hồi quy mở/đóng/focus. Chưa đóng hotfix hoặc báo đã đạt toàn bộ bàn phím; phần thử trên box thật vẫn chờ sau nghiệm thu QA. Không cần task mới vì Esc đã nằm trong tiêu chí T55/T56.
