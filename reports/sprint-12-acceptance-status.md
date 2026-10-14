# Sprint 12 — tự động đạt, còn Electron và bằng chứng task

PM · 2026-10-15. Nền sản phẩm QA kiểm **`7b30ac89db815c2aaf4411d556924a6d826a44b6`**. Main hiện tại `e9982ab` chỉ thêm báo cáo so với nền này; PM đã đối chiếu danh sách file thay đổi.

## Kết quả được ghi nhận

QA T52 kiểm độc lập một lần: `npm run check` exit 0, khoảng 95 giây, qua marker cuối main harness. Đạt phần tự động: recovery, lỗi Tiếp tục giữ qua render, Kiểm tra lại, chat/Cần bạn đồng bộ, seq thật, chống bấm trùng/đổi box, fixture publish/retry/superseded. Không có lỗi mới, còn cảnh báo backlog T49 đã biết. QA chỉ đọc/kiểm main, không sửa file trong lượt này.

Đây là nghiệm thu tự động, **chưa phải toàn bộ T52**. Electron tiếp tục SIGABRT trước fixture; chưa có kết quả Electron cho UI mới hoặc xác nhận box thật. T51/T53/T55 còn thiếu hồ sơ kiểm đúng task trên bản cuối. T54/T57/T56 giữ Xong; Sprint 12 chưa đóng.

## Làm mới bằng chứng — đúng chủ task, không triển khai lại

Cổng hiện tại chỉ tạo review record từ người nhận task; PM không thay owner và techlead không gửi review thay T51/T53. Vì vậy các lượt dưới đây chỉ phục vụ ghi nhận bàn giao trên code techlead đã hoàn tất:

| Người | Task | Đầu ra |
| --- | --- | --- |
| dev-be | T51 | Check qua app liên kết T51, nguồn trùng code main đã QA kiểm, rồi owner review. |
| dev-fe | T53 | Check qua app liên kết T53, nguồn trùng code main đã QA kiểm, rồi owner review. |
| techlead | T55 | Làm mới check qua app và owner review T55 trên bản cuối; không dùng hồ sơ này để đóng T51/T53. |

Ba việc độc lập, chỉ đọc/kiểm và bàn giao, không cùng sửa code/test hay metadata chung. PM đã đọc worktree BE/FE: sạch, HEAD cũ `0b17f86`; cần được đồng bộ main trước khi kiểm. Không lấy code cũ ở hai nhánh này gộp ngược vào bản đã nghiệm thu. Techlead vẫn phụ trách mọi sửa code phát sinh theo quyết định End-User.

Quy trình cho mỗi chủ task:

1. Xác nhận worktree sạch, nguồn đã đồng bộ main và code/test giống bản đã nghiệm thu; ghi SHA. Nếu app chưa đồng bộ hoặc có thay đổi ngoài dự kiến thì báo PM, không kiểm trên nền cũ rồi gọi đó là bằng chứng mới.
2. Lấy revision mới nhất trong prompt/bảng task; gửi block cuối câu trả lời `run-command` có `command: "npm run check"` và `tasks: [{id: "T…", expectedRevision: "…"}]` cho đúng task của mình. Không gửi cùng task-status. Chạy shell không thay thế hồ sơ này.
3. Nhận kết quả exit 0, treeStable và không verificationError rồi gửi owner review trong block task-status ở cuối lượt kế, dùng revision mới nhất. Bàn giao SHA/checkId; giữ nguyên code giữa check và review. Nếu lỗi/timeout, lưu output và báo PM, không thử lặp cho xanh.
4. PM đối chiếu task/definitionRevision/source/workspace/review trước khi duyệt. T51 có thể xét đóng riêng khi đủ bằng chứng cho phần BE đã nghiệm thu; T53/T55 vẫn còn phần UI thực tế. Không đóng bằng hồ sơ của task khác hay đổi acceptance để vượt cổng.

## QA T52 — chẩn đoán Electron có giới hạn

PM đọc crash report mới nhất `~/Library/Logs/DiagnosticReports/Electron-2026-10-15-014209.ips`, captureTime `2026-10-15 01:42:08 +0700`: EXC_CRASH/SIGABRT, abort() ở main thread, stack qua `_RegisterApplication`, `_NSInitializeAppContext`, `NSApplication init/sharedApplication`. Hai report trước lúc 01:19 cũng có chuỗi này. Điều này khớp việc chưa vào fixture; **chưa xác định nguyên nhân gốc hoặc kết luận do quyền/sandbox/dependency**.

QA tiếp tục T52 bằng việc đối chiếu stderr/crash log và cách khởi chạy (CLI, môi trường, binary thực tế, phiên GUI), so với lượt Electron 19/19 đã chạy được trước đó. Ưu tiên đọc dữ kiện, không chạy lại toàn suite Node đã đạt. Chỉ thử khởi tạo Electron có timeout khi có giả thuyết/thay đổi cách chạy cụ thể; báo trước/sau và kết quả. Nếu vẫn dừng trước fixture, báo rõ điều kiện bên ngoài cần thay đổi, không gọi lặp hoặc ghi ca UI thành đạt.

Không tự thay dependency, cấu hình máy hay quyền CLI để chữa thử. Nếu phát hiện lỗi sản phẩm/harness cần sửa, báo PM và techlead trước khi sửa vùng đang ổn định. Khi Electron khởi tạo được, chỉ nghiệm thu luồng Tiếp tục/Kiểm tra lại và đổi box liên quan; T56 bố cục đã đạt không cần chạy lặp.

## Nhánh QA đang xung đột

Queue `2044663f-fced-443f-87c9-132c52e722a8` xung đột check.js khi cố gộp lại HEAD **`2c6ae36`**, cũng là HEAD cũ đã gửi ở lượt trước. Worktree QA sạch và lượt vừa rồi không có thay đổi mới, nên thông báo conflict không phủ định kết quả kiểm trên main `7b30ac8`.

Các ca của `2c6ae36` đã được techlead nhận và mở rộng trong bản cuối. QA đồng bộ nhánh riêng với main, đối chiếu giữ đủ assertion mới để kết thúc xung đột lịch sử; không reset/xóa nhánh hay gộp lại nguyên check.js cũ. Nếu còn phần riêng chưa được nhận, báo rõ hunk trước khi kết thúc. Không tạo một vòng test chỉ để thử lại queue cũ trên cùng nguồn.

## Trạng thái và bước tiếp

T52 chuyển Đang làm cho phần chẩn đoán/kiểm Electron còn lại. T51/T53 chờ owner review mới; T55 chờ bằng chứng mới và phản hồi bố cục trên box thật. Sau khi nhận đủ bằng chứng, PM chốt những phần đã đạt và đưa danh sách thử tay cụ thể cho End-User. Lượt PM này không sửa code, không tự chạy lại sản phẩm hay thay hồ sơ userData.
