# Hotfix bố cục bảng task — 2026-10-14

Theo yêu cầu trực tiếp của End-User, trên nền `38c2710`. Sửa riêng hàng task; không thay đổi IPC, quy tắc bằng chứng hay các phần chuỗi/Cần bạn/merge của T53.

## Vấn đề và thay đổi

- Hàng cũ dùng flex không xuống dòng: badge, người nhận và nút Bằng chứng chiếm hết chỗ, tiêu đề biến mất ở cột hẹp.
- Hàng mới chia hai tầng: icon/mã/tên task ở trên; người nhận, trạng thái kiểm và cảnh báo đổi test ở dưới. Tên dành tối đa hai dòng, giữ tooltip đầy đủ và thao tác mở spec.
- Trạng thái kiểm trở thành nút mở Bằng chứng, có mũi tên đóng/mở, thay cho badge và nút riêng lặp lại. Giữ tên truy cập “Bằng chứng T…: trạng thái”, `aria-expanded`, Enter/Space, Esc trả focus.
- Metadata tự xuống dòng. Bỏ margin âm gây cuộn ngang; giữ màu trạng thái và cảnh báo đổi test.

## File

- `index.html`: bố cục task, nút trạng thái, giới hạn phần nội dung bằng chứng ở cột hẹp.
- `renderer.js`: nhóm metadata và gộp trạng thái vào control bằng chứng; giữ nguyên luồng IPC và panel.
- `check.js`: cập nhật truy vấn cảnh báo theo DOM mới; kiểm nhãn trạng thái và tên truy cập của nút.

## Kiểm tra

- `npm run check`: đạt. Vẫn có dòng `BUG T49-nhan-queue-bi-chan` đã biết: badge khi queue bị blocked-dirty; không thuộc bản sửa này.
- Probe Electron với CSS và các hàm render task thật, dữ liệu fixture T50–T52: cột 240/300/635px, theme sáng/tối, không tràn ngang và metadata nằm dưới tên. Kiểm thêm tên/assignee rất dài, trạng thái ready và cảnh báo đổi test.
- Gửi sự kiện bàn phím vào cửa sổ Electron: Enter mở spec; Enter/Space mở bằng chứng; Esc đóng và trả focus. Kiểm cả 8 trạng thái xác minh: panel mở ở cột 240px không tràn ngang, badge không đè nút đóng.
- `git diff --check`: đạt. Probe tạm đã dọn, không thêm dependency.
- Chưa thử trực tiếp trên box đang chạy của End-User. Sau khi gộp chỉ cần Cmd+R vì thay đổi sản phẩm nằm ở renderer/CSS.

Ảnh là bản render bằng dữ liệu fixture trong Electron, không thay đổi task thật:

![Cột 240px, sáng](../.chat/attachments/task-layout-light-240.png)
![Cột 240px, tối](../.chat/attachments/task-layout-dark-240.png)
