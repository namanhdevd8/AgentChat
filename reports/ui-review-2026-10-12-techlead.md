# Góp ý techlead cho đề xuất giao diện 2026-10-12

**Bàn giao PM:** nội dung bổ sung cho mục 3 của `reports/ui-review-2026-10-12.md`. Bản PM ở commit `efb124b` chưa gộp vào main; lưu góp ý riêng để hai nhánh không cùng thêm một file rồi xung đột. PM tổng hợp và chốt mục 4 để người dùng duyệt. Chưa có quyết định triển khai.

**Đề nghị:** ưu tiên sửa “Cần bạn” tự mất yêu cầu, làm gọn file/tin hệ thống và diễn đạt trạng thái rõ hơn. R1 và một phần R5 đã có trong bản 0.5.0; cần chỉnh chức năng hiện hữu. R6 là thay đổi giao thức/khóa, R7 là lỗi số đo cần xử lý riêng, không nên tính cả hai là sửa UI nhỏ.

## 1. Bằng chứng và phạm vi

Đã mở ảnh PM cung cấp, đối chiếu code tại `53ff83f` và bản nháp PM. Chỉ đánh giá màn hình chính trong ảnh; chưa thao tác app thật, chưa kiểm chứng modal Quyền, tooltip, thông báo macOS, bàn phím, màn hình hẹp hay giao diện tối.

![Màn hình chính do PM chụp, bản 0.5.0](../.chat/attachments/app-main-2026-10-12.png)

| Bước người dùng cần làm | Nhận xét từ ảnh |
|---|---|
| 1. Biết mình cần xử lý gì | Chưa rõ: T31 chờ thử tay, nhưng yêu cầu nằm trong chat và không thấy mục “Cần bạn”. |
| 2. Biết nhóm đang làm gì | Có thanh chạy và nút Dừng; câu lệnh dài, trạng thái chờ khóa và thời gian ước lượng chưa dễ hiểu. |
| 3. Mở tài liệu hoặc xem kết quả | Bảng task đã gọn; file chung dài, merge trống vẫn chiếm chỗ, nhiều dòng hệ thống chen giữa trao đổi. |

Giữ bố cục ba cột, ô nhập cố định và bảng task chỉ xem. Chữ metadata xám nhỏ và trạng thái thể hiện bằng màu là rủi ro khả năng đọc cần kiểm tra thêm; ảnh chưa đủ để kết luận tỷ lệ tương phản hoặc khả năng dùng trình đọc màn hình.

## 2. Những điểm cần đính chính trong bản nháp

- **R1 đã tồn tại:** `index.html:565`, `renderer.js:2717` và `core.js:993` đã có “Cần bạn”, nhảy tới tin, nút trả lời, badge và thông báo khi cửa sổ không được focus. Vấn đề nổi bật là cách xác định đã trả lời, không phải thiếu khung.
- **R5 đã có tổng box:** `renderer.js:1376` hiển thị token/USD và cảnh báo thiếu dữ liệu trong Timeline. `CHANGELOG.md` ghi việc chuyển này từ bản 0.3.0. Icon Timeline khó nhận ra trong ảnh; chưa có cơ sở để đưa cả panel chi phí trở lại cột phải.
- **R4 đã có giải thích trong popup thành viên:** `memberStatusText` ở `renderer.js:2450`. Chấm ở header được tô theo màu agent và lớp `busy`, nên không được suy ra đỏ = lỗi, cam = chờ từ ảnh. Cần tăng khả năng nhận biết ngay tại nút.
- **W1 là chờ khóa một chiều trong ảnh:** techlead chờ PM; chưa có bằng chứng hai người chờ nhau hoặc deadlock. `main.js:642` khóa metadata theo phạm vi trước khi chạy, nên cả lượt đọc/thảo luận vẫn có thể phải đợi nếu phạm vi cho phép ghi memory.
- **File FE hiện tại là `renderer.js` cùng `index.html`:** logic đã tách ra khỏi HTML. Không dùng số dòng HTML từ báo cáo Sprint 8 cũ để giao việc.

## 3. Góp ý từng đề xuất R1–R7

| Mã | Kết luận và phạm vi nên chốt | Phần kỹ thuật / cỡ tương đối |
|---|---|---|
| R1 | **Ưu tiên cao: sửa vòng đời “Cần bạn”.** Nhắn chủ đề mới không tự đóng yêu cầu thử tay cũ. Mỗi mục có “Trả lời” và “Đã xử lý”; vẫn nhảy tới tin gốc. | FE + BE, **vừa**. Tái dùng `needs`, `dismissNeed`, `send`; thao tác đóng phải gắn đúng tin, không đóng mọi mục của cùng người hỏi. Giữ thông báo hiện hữu, không xây thêm C. |
| R2 | **Đồng ý giảm nhiễu**, nhưng bắt đầu bằng thu gọn các sự kiện thành công liên tiếp thành “N cập nhật · Xem”. Lỗi, từ chối quyền và chuỗi dừng luôn hiện. | FE **nhỏ** cho gom liên tiếp; **vừa** nếu gắn chip đúng lượt. Task note có `relatedRunId`, nhưng tin merge hiện chỉ có `queueId/headSha/owner`; BE phải thêm liên kết lượt trước khi gắn vào chân tin. Không ghép theo agent gần nhất. |
| R3 | **Đồng ý:** ghim memory/roadmap, nhóm file theo sprint, thu gọn mặc định; merge trống ẩn. | FE **nhỏ** nếu dùng danh sách hiện tại. `core.files` chỉ trả đường dẫn nên “mới sửa lên đầu” cần thêm metadata từ BE; để sau. Số sprint lớn nhất không tự chứng minh sprint đang làm hay đã đóng. |
| R4 | **Đồng ý:** thanh chạy hiện nhãn ngắn như “Đang chạy lệnh”, “Đang đọc …”, “Chờ PM nhả memory.md”; chi tiết mở được bằng chuột và bàn phím. Thêm tên/trạng thái cho avatar qua nhãn truy cập. | FE **nhỏ** cho nhãn cơ bản. BE **nhỏ–vừa** nếu cần lệnh chi tiết: `core.js:119` đã cắt còn 160 ký tự trước khi gửi, tooltip phía FE không thể phục hồi phần mất. Dữ liệu chi tiết vẫn phải có giới hạn. Khi chờ khóa, không hiện ước lượng hoàn thành suy từ thời gian chạy model. |
| R5 | **Thu hẹp:** làm rõ nút “Timeline · Chi phí”, giữ tổng box tại đó. | FE **nhỏ**. Tách theo agent có thể bổ sung sau bằng reducer log. Tách theo sprint là **vừa**, cần quy tắc gán mỗi lượt cho sprint; một lượt có thể làm nhiều task. Không suy chi phí sprint từ trạng thái task hiện tại hoặc đếm hai lần. |
| R6 | **Đúng hướng nhưng không nhỏ.** Ghi memory qua app có thể giảm thời gian giữ khóa, song đây là thay đổi giao thức dùng chung. Để đợt riêng. | BE + QA **vừa**. Cần xác thực block, ghi tuần tự theo box, chống ghi lặp theo `runId`, xử lý crash và tương thích agent còn ghi trực tiếp. `owns: []` hiện là toàn dự án: xóa tên memory khỏi mảng không đồng nghĩa cấm ghi file đó. Chưa đổi toàn bộ đường ghi thì chưa được bỏ khóa. |
| R7 | **Có cơ sở xác nhận sai loại số đo; nên tách sửa lỗi.** Tổng token đã tiêu thụ và độ lớn ngữ cảnh gần nhất phải là hai trường khác nhau. | BE + FE + QA **vừa**. Giữ số đo tiêu thụ phục vụ usage; thêm số đo ngữ cảnh riêng cho xoay phiên/popup. Phải kiểm với stream thật của phiên bản CLI đang cài, kể cả resume, retry và thiếu usage. |

### R1: đã tái hiện việc mất yêu cầu bằng dữ liệu giả

`core.needsYou` đánh dấu mọi yêu cầu cũ của một agent là đã trả lời ngay khi gặp tin user mới gọi agent đó; tin không có mention mặc định làm tương tự với PM. Đây là hành vi được test hiện tại ghi nhận, nhưng không đủ để biết một yêu cầu cụ thể đã xong.

1. Ghi tin PM: `@user Thử tay T31 giúp mình.` → danh sách có **1** mục.
2. Ghi tin user: `@pm và @techlead xem ảnh và đề xuất giao diện.` → danh sách còn **0** mục.
3. Người dùng chưa xác nhận kết quả T31. Chuỗi này phù hợp với hiện tượng trong ảnh, nhưng chưa kiểm tra dữ liệu dismiss của app thật nên không khẳng định đây là nguyên nhân duy nhất của ảnh.

Đề nghị tối thiểu: chỉ đóng khi người dùng chọn xử lý đúng mục; gửi thất bại thì giữ nguyên. Nhắn tự do không tự đóng. Nhãn “Trả lời” phù hợp hơn nút “Duyệt” chung cho mọi câu hỏi, nhất là yêu cầu thử tay. Đóng mục nhắc việc không tự đổi trạng thái task. IPC mới hoặc mở rộng `send` chỉ nhận định danh tin; main xác minh box/tin hiện hữu và lưu trạng thái do người dùng điều khiển. Không cho nội dung agent tự đóng mục. Mục dừng chuỗi phải gắn đúng chuỗi đã tiếp tục.

### R7: điều gì đã biết, điều gì còn cần xác minh

Code hiện tại lấy `result.usage` qua `rawUsage` (`core.js:110,214`), cộng usage của các đoạn retry/lệnh (`core.js:2202`), lưu vào `lastTurn.inputTokens` rồi so ngưỡng ở `sessionRotationPending` (`core.js:1504`). Không lưu số đo riêng của bước model gần nhất.

Tài liệu chính thức phân biệt usage mỗi bước trong assistant message với usage tích lũy trong result; message cùng ID có thể lặp khi dùng nhiều tool. Vì vậy result usage không thể mặc nhiên coi là độ lớn ngữ cảnh của một bước. [Claude Agent SDK — Track cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking).

Số token ngữ cảnh vẫn gồm input mới, cache read và cache creation; bỏ cache khỏi phép tính sẽ làm số đo thấp sai. Tài liệu statusline mô tả `current_usage` lấy từ API call gần nhất; đây là bằng chứng phân biệt khái niệm, không phải khẳng định app hiện nhận được trường statusline. [Claude Code — Context window fields](https://code.claude.com/docs/en/statusline#context-window-fields).

Fixture giả định ba bước có input 60k, 65k, 70k: result cộng lại 195k. Parser hiện trả 195k và hàm quyết định xoay phiên trả `true` với ngưỡng 150k, dù bước cuối chỉ 70k. Đã chạy assertion cho parser và điều kiện ngưỡng; chưa chạy một phiên Claude thật ba bước để đối chiếu payload.

Hướng sửa đề nghị: thu số đo bước chính gần nhất từ stream assistant, phân biệt message ID và loại trừ nhánh con; dùng trường riêng như `lastContextInputTokens`. Thiếu số đo thì hiện “chưa có dữ liệu”, không thay bằng tổng nhiều bước mà gọi là ngữ cảnh. Không hứa giảm chi phí bao nhiêu từ một ảnh hoặc fixture.

## 4. Phương án để PM chốt với người dùng

| Phương án | Đổi lại | Ý kiến techlead |
|---|---|---|
| A. Chỉ chỉnh trình bày R3/R4 và nút chi phí | Ít việc, giao diện gọn hơn; yêu cầu vẫn có thể mất khi đổi chủ đề. | Chưa giải quyết điểm khó dùng quan trọng nhất. |
| B. Sửa R1 + làm gọn R2/R3/R4 + R5 thu hẹp | Sửa việc bị bỏ sót và giảm nhiễu; chủ yếu tận dụng luồng hiện có. | **Khuyến nghị cho đợt UI tiếp theo.** R2 dùng bản gom sự kiện liên tiếp trước. |
| C. Làm đủ R1–R7 cùng chi phí theo sprint | Đụng UI, lưu trạng thái, giao thức memory và cách xoay phiên cùng lúc. | Phạm vi lớn, khó nghiệm thu nguyên nhân nếu có hồi quy. |

Thứ tự đề nghị: R1 trước; tiếp theo R3/R4 và nút chi phí; R2 sau khi chốt cách tìm lại tin trong nhóm. R7 là ticket độ chính xác riêng để làm sớm, R6 và thống kê theo sprint để đợt sau. Đây là khuyến nghị gửi PM, chưa phải sprint hay task đã được duyệt.

Tiêu chí nghiệm thu bản B:

- Yêu cầu thử tay vẫn hiện sau tin nhắn đổi chủ đề; xử lý một mục không đóng các mục khác, không đổi task; khởi động lại giữ trạng thái đúng và gửi lỗi không làm mất mục.
- Gom tin hệ thống vẫn mở được từng tin, tìm kiếm/nhảy tới tin vẫn hoạt động, giữ vị trí cuộn và giới hạn DOM hiện có; lỗi/quyền/chuỗi dừng không bị chìm trong nhóm.
- File ghim và nhóm mở bằng bàn phím; nhóm giữ trạng thái theo box; hàng merge có lỗi phải hiện lại ngay cả khi không còn mục đang chạy.
- Trạng thái chạy/đợi có chữ, chi tiết không chỉ dựa vào hover; nút Dừng luôn nhìn thấy. Kiểm trên cửa sổ hẹp và giao diện sáng/tối.
- Tổng chi phí trong Timeline không cộng lại từ các chip/tin hệ thống mới; giữ chỉ báo thiếu dữ liệu.

## 5. Kiểm tra và bàn giao

- Đã mở ảnh gốc; đọc bản PM và code liên quan; chạy hai assertion bằng Node với dữ liệu giả cho R1 và R7, exit 0. Fixture tạo trong worktree và đã dọn.
- Chỉ thêm báo cáo này; không sửa code sản phẩm, cấu hình agent, task hoặc nhánh PM. Không chạy bộ `npm run check` cho thay đổi tài liệu; chưa nghiệm thu tương tác Electron hay CLI thật.
- Bản PM và bản góp ý đều cần được gộp qua quy trình app sau khi thư mục chính hết thay đổi chưa commit. Không tự dọn hoặc commit thay đổi của người dùng ở thư mục chính.
- PM đưa góp ý này vào mục 3, viết mục 4 theo phương án đã cân nhắc và gửi người dùng duyệt.
