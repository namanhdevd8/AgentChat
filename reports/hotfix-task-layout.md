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
- Gửi sự kiện bàn phím vào cửa sổ Electron: Enter mở spec; Enter/Space mở bằng chứng; Esc **khi focus ở trong panel** đóng và trả focus. Lượt đầu chưa kiểm Esc ngay tại nút trạng thái; QA T56 đã tìm thấy thiếu sót này. Kiểm cả 8 trạng thái xác minh: panel mở ở cột 240px không tràn ngang, badge không đè nút đóng.
- `git diff --check`: đạt. Probe tạm đã dọn, không thêm dependency.
- Chưa thử trực tiếp trên box đang chạy của End-User. Sau khi gộp chỉ cần Cmd+R vì thay đổi sản phẩm nằm ở renderer/CSS.

Ảnh là bản render bằng dữ liệu fixture trong Electron, không thay đổi task thật:

![Cột 240px, sáng](../.chat/attachments/task-layout-light-240.png)
![Cột 240px, tối](../.chat/attachments/task-layout-dark-240.png)

## T55 — sửa Esc theo nghiệm thu T56

Nền `c388641`. Lỗi cũ: mở bằng chứng bằng Enter/Space thì focus vẫn ở nút; handler Esc chỉ nằm trong panel nên không nhận được sự kiện từ nút.

- `renderer.js`: đưa handler Esc lên phần tử chứa cả nút và panel của **từng task**. Chỉ xử lý khi task đang mở bằng chứng; đóng panel, xóa trạng thái mở, cập nhật `aria-expanded=false`, trả focus về nút. Không đóng panel của task khác.
- `check.js`: giữ bộ QA kiểm IPC chậm/đổi box/tải lại và bố cục. Thêm kiểm Esc từ nút khi IPC còn chờ, phản hồi muộn không mở lại panel và Esc khi đã đóng không bị chặn.
- Electron 44.4.5: cả Enter → Esc ngay và Space → Esc ngay đều đạt, không cần Tab vào panel; Esc bên trong panel trả đúng focus và giữ panel khác đang mở. Các ca viewer, IPC thật, bố cục 240/300/635px × sáng/tối của QA vẫn đạt (`node check.js --electron`, exit 0).
- `npm run check` exit 0; ca QA `T56 task board stale IPC` vẫn đạt. Cảnh báo backlog `T49-nhan-queue-bi-chan` vẫn còn. `git diff --check` đạt.
- Đây là bản code mới; checkId cũ `8265cd1b-eb0b-48fb-8c4f-28ea0d128cd8` không dùng để duyệt bản này. Bàn giao review để app tạo bằng chứng kiểm mới qua queue. Chưa nghiệm thu trên box thật của End-User.
