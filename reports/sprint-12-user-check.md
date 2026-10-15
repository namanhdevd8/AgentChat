# Sprint 12 — thử trên box thật trước khi đóng T53/T55

Ngày 2026-10-15. QA đã nghiệm thu bộ kiểm tự động và giao diện trên fixture Electron. Còn cần phản hồi của bạn về thao tác thực tế; Sprint 12 chưa đóng.

## Chuẩn bị

Khởi động lại app để nạp bản sửa tiến trình chính, rồi mở box bạn đang dùng. Chỉ Cmd+R chưa đủ cho các thay đổi này. Dùng dữ liệu sẵn có; không sửa log/task hay tạo lỗi để thử.

## Các bước cần thử

| Phần | Thao tác | Kết quả mong đợi |
| --- | --- | --- |
| Bảng task — T55 | Thu/phóng cột tới cỡ bạn thường dùng; xem tên dài, người nhận và trạng thái ở theme sáng/tối. | Tên tối đa hai dòng, metadata phía dưới, không chồng hoặc tràn ngang. |
| Bằng chứng — T55 | Mở bằng nút trạng thái; dùng Enter/Space rồi Esc ngay khi focus vẫn ở nút. Thử Esc khi focus trong panel. | Đúng panel mở/đóng, focus trở về nút, nút đóng không bị che. |
| Tiếp tục — T53 | Với thẻ dừng hợp lệ có công việc bạn muốn tiếp tục, đối chiếu trạng thái ở chat và “Cần bạn”, rồi bấm Tiếp tục một lần. | Một lượt tiếp tục được gửi, hai vị trí cập nhật nhất quán; thẻ đã tiếp tục không cấp thêm lần nữa. Thao tác này sẽ chạy tiếp agent. |
| Đổi box — T53 | Chuyển sang box khác rồi trở lại. | Thẻ và trạng thái thuộc đúng box; phản hồi box cũ không làm đổi nút của box mới. |
| Kiểm tra lại — T53, nếu có sẵn lỗi | Nếu thao tác Tiếp tục báo lỗi, xem nút còn khóa sau khi giao diện cập nhật; bấm “Kiểm tra lại”. | Chỉ mở lại khi xác minh thành công và vẫn được phép tiếp tục; Kiểm tra lại không tự chạy agent. Nếu không gặp lỗi, ghi mục này “chưa thử”, không cần cố gây lỗi. |

Nếu không có thẻ dừng hợp lệ, ghi rõ chưa thử Tiếp tục. Thẻ cũ thiếu dữ liệu có thể báo không khả dụng; không dùng thẻ đó để suy ra luồng hiện tại đã đạt hoặc thất bại.

## Phản hồi

Báo từng phần **đạt / lỗi / chưa thử**. Nếu có lỗi, gửi thao tác vừa làm, kết quả thấy được và ảnh nếu tiện. PM sẽ đối chiếu với bằng chứng QA để chốt T53/T55 hoặc giao sửa phần cụ thể; chưa tự coi mục chưa thử là đạt.
