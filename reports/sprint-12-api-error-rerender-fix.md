# T53 — giữ lỗi Tiếp tục qua render lại; ổn định ca publish

Techlead · 2026-10-15 · nền `2915106`. Theo yêu cầu PM ở `sprint-12-api-error-rerender.md`, đọc từ worktree PM vì báo cáo chưa gộp. Chỉ sửa `renderer.js`, `check.js` và báo cáo trong worktree techlead.

## Lỗi FE và bản sửa

Đã lấy patch QA nguồn `2c6ae36` và chạy riêng `rendererS12Checks` trước sửa: exit 1, đúng assertion `T52-api-error-rerender`, cả cached/embedded/fallback tự bật lại. Nguyên nhân là khóa chỉ nằm trên nút DOM bị thay thế; trạng thái dùng để dựng nút mới vẫn là dữ kiện cho phép trước lỗi.

- Lưu lỗi theo message/stop trong trạng thái FE của box đang mở, dùng chung cho chat và Cần bạn. Đổi project/box xóa trạng thái đó; callback cũ có guard project/box/openSeq và không ghi lỗi sang box mới.
- Render lại, event stop khác hoặc event đúng stop có revision cũ/không hợp lệ không xóa lỗi. Lỗi lưu mốc revision mới nhất lúc thất bại, tránh dùng event đã tới trước lỗi để mở khóa.
- Event hợp lệ của **chính stop**, revision mới hơn, xác nhận lại trạng thái. Nó chỉ mở Tiếp tục khi trạng thái mới thực sự cho phép; false/draining/continued/unavailable vẫn khóa.
- Sau lỗi có nút **Kiểm tra lại** gọi `chainState`, chỉ đọc trạng thái, chưa chạy agent. Một lần đọc bắt đầu sau lỗi có thể xác nhận lại cùng revision; đọc bắt đầu trước lỗi, response khác stop/box hoặc revision cũ không được xóa lỗi mới.
- Mọi nơi chọn ChainView mới nhất theo revision; cache đã xác nhận được ưu tiên khi revision bằng nhau. Chat và Cần bạn cùng được cập nhật khi lỗi xuất hiện hoặc được xác minh lại. Giữ interrupted/canContinue:true, pending uncertain, seq, chống gửi trùng và kiểm cuối tại main.

## Fixture publish và index.lock

Ca D trước đây đợi queue `checking`, đặt CHECK_SLOW_MS=3000 rồi checkout đồng bộ. `checking` được ghi trước khi worker bắt đầu runner; terminal của agent vẫn có thể đang lấy facts/probe bằng Git. Khoảng sleep không chứng minh các thao tác đó đã xong. Log PM xác nhận index.lock trong repo tạm; chưa xác định chính xác PID giữ khóa ở lần lỗi cũ.

Fixture nay dùng barrier có timeout 15 giây:

1. Cho **runner thật** hoàn tất check, giữ kết quả tại ranh giới trả về publisher. Không giả lập kết quả pass hay bỏ check.
2. Chờ job agent hoàn tất terminal/facts; lấy Git lock của app trong harness rồi mới checkout sang `qa-detour`.
3. Giải phóng barrier trong finally, khôi phục runner; worker xử lý kết quả check thật và phát lỗi publish/TARGET_CHANGED.
4. Chờ worker hoàn tất cả cleanup/emit trước khi checkout về main dưới Git lock, rồi kiểm retry như cũ.

Giữ assertion phase publish, candidate, checkId, commandResult null, một event, retry thành công và superseded không nhận sửa. Chỉ expose thêm `withGitLock/mergeWorkers` trong module do harness biên dịch; không thêm IPC/hook test vào code sản phẩm. Không xóa index.lock, retry checkout, chèn sleep mới hay nới assertion. Không sửa BE/thuật toán merge để giải quyết lỗi fixture này.

## Kiểm tra

- Ca FE riêng: sau sửa đạt exit 0; giữ assert QA và thêm state cũ/sai box/sai revision, xác nhận false/true, đọc lại cùng revision, đọc sai stop, đọc bắt đầu trước lỗi, và khóa/mở đồng thời hai vị trí.
- Giữ toàn bộ nhóm integration/recovery, listener, layout/Esc, reducer và marker cuối harness.
- Syntax renderer/check và whitespace: đạt.
- Lượt check tổng đầu tiên sau sửa: exit 1 tại kiểm đọc lại trạng thái trong ca recovery BE, sau khi ca publish mới đã đạt. Thu nhỏ ca cho thấy fixture truyền tin đọc trực tiếp từ JSONL **thiếu `seq`**, nên phép so sánh `undefined === undefined` trước đây không kiểm được ID gửi đi. Đã đổi fixture lấy tin qua IPC `logPage` thật, thêm assert `Number.isInteger(message.seq)`; giữ payload ChainView từ `chainState`. Ca FE riêng với payload recovery được trích từ repo tạm đạt sau điều chỉnh.
- `npm run check` sau điều chỉnh fixture: **exit 0**, gồm assert buộc có `ok (main harness end)`; ca publish/TARGET_CHANGED, retry/superseded và recovery UI từ IPC thật đều chạy tới cuối. Chạy lại vì đã sửa fixture, không lặp suite để bỏ qua lỗi.
- Output còn dòng backlog đã biết `BUG T49-nhan-queue-bi-chan` (badge khi queue bị chặn). Không sửa hoặc xóa cảnh báo này trong hotfix T53.

Không chạy lại Electron trong lượt này. SIGABRT trước fixture là kết quả QA đã báo, không được đổi thành ca đạt; chưa nghiệm thu Electron hoặc box thật cho bản sửa này. Không lặp suite để tìm lần xanh.

## Bàn giao

PM gộp và gọi QA T52 kiểm độc lập; T53 vẫn theo người nhận trong định nghĩa task hiện hành. Check shell không thay thế bằng chứng task trong app; không gửi review T55 để gán kết quả sang T53. Sprint 12 chưa đóng. Với phần sửa renderer này, sau gộp Cmd+R để nạp lại UI.
