# Hotfix nút cài đặt và hàng chờ merge

Tech Lead · 2026-09-27 · Bản vá trong worktree hiện tại, chờ app gộp nhánh.

## Nguyên nhân đã xác nhận

1. **Nút ⚙ không mở:** `renderEditors()` dùng `cur` nhưng mất khai báo khi sửa phần chọn phiên. Agent bật nhớ phiên làm phát sinh `ReferenceError: cur is not defined` trước `showModal()`.
2. **Hàng chờ giữ lỗi đã xử lý:** dữ liệu thật còn mục `blocked-dirty` của dev-fe tại SHA `d1ea878`, mặc dù cùng SHA đã được gộp. `retryMerge` thêm mục mới nhưng không đánh dấu mục cũ đã được thay thế; UI tính cả lịch sử đã gộp vào số đang chờ.
3. **Ghi registry không đồng bộ:** retry và dừng mục đang chờ có thể ghi đè snapshot registry của worker đang merge/check. Hai lần thử lại cũng có thể tạo công việc trùng.
4. **Nút merge báo sai kết quả:** FE chỉ bắt exception, bỏ qua phản hồi `{ok:false,error}`. Tin merge thành công cũng hiện nút gọi agent sửa; tin lỗi lịch sử vẫn gọi được agent dù lỗi đã hết hiệu lực.

## Thay đổi

- `index.html`: khôi phục phiên hiện tại theo đúng CLI; hàng chờ chỉ hiện mục chưa gộp; dùng chung xử lý kết quả cho các nút thử lại/sửa/dừng, hiện lỗi BE và bỏ phản hồi sau khi đổi box. Tin gộp thành công không còn nút sửa.
- `main.js`: retry và dừng mục đang chờ dùng cùng Git lock với worker; worker kiểm tra lại mục còn queued trước khi xử lý. Retry giữ SHA riêng của lượt mới và thêm `supersededBy` vào mục cũ, gọi lặp không thêm mục nữa.
- Registry cũ vẫn đọc được: khi SHA của lỗi đã nằm trong nhánh đích, API trình bày là đã gộp và bỏ quyền thử lại/sửa. Giữ nguyên lịch sử trên đĩa; không sửa trực tiếp dữ liệu sống để che lỗi.
- `requestMergeRepair` kiểm tra trạng thái hiệu lực trước khi ghi tin/gọi agent, gồm cả mục đã được retry thay thế và lỗi lịch sử đã gộp.

## Kiểm chứng

- Đã thấy test đỏ đúng `cur is not defined`, lỗi cũ vẫn actionable, UI đếm cả mục đã gộp, bỏ qua `ok:false`, và gọi sửa từ lỗi lịch sử đã xử lý trước khi sửa từng phần.
- `npm run check`: **đạt** sau bản sửa cuối cùng. Test renderer chạy code thật trong Node VM với DOM/IPC giả: mở cài đặt, chọn phiên đúng CLI, số đang chờ, ba nút merge trả lỗi, phản hồi muộn sau đổi box.
- Git fixture qua `main.js`: thử lại không tạo trùng, ẩn lỗi cũ sau thành công, registry cũ, chặn lượt sửa không cần thiết, dừng mục queued giữ nguyên các mục khác. Các ca sẵn có về root bẩn, check đỏ, gộp song song và conflict vẫn đạt.
- Review độc lập: đã xử lý phát hiện về nút sửa lịch sử; không còn phát hiện Critical/Important trong bản vá.
- Giới hạn: thử smoke bằng Electron riêng kết thúc với `SIGABRT`, không có stderr; chưa xác định nguyên nhân và chưa xác minh giao diện thật trong môi trường chạy này. Kết quả renderer ở trên là kiểm thử Node VM.

## Nạp bản sửa

Sau khi app báo đã gộp nhánh techlead, **khởi động lại app** vì có sửa `main.js`. Chỉ Cmd+R chưa nạp phần BE.
Kiểm tra lại nút ⚙ và hàng chờ: lỗi cũ của SHA đã gộp biến khỏi danh sách; lỗi chưa xử lý vẫn có thao tác phù hợp. Lịch sử tin nhắn được giữ nguyên.
