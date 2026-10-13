# Sprint 9: Làm gọn giao diện + sửa số đo xoay phiên (chốt 2026-10-13)

Nguồn: mục 4 [ui-review-2026-10-12.md](ui-review-2026-10-12.md). Góp ý techlead: [ui-review-2026-10-12-techlead.md](ui-review-2026-10-12-techlead.md).

End-User duyệt, **trừ R1**: End-User đọc khung "Cần bạn" rồi bấm x để ẩn, không dùng các nút trong đó, nên chuyển việc sửa vòng đời "Cần bạn" vào backlog.
Code nền: main `f32a970` (0.6.0: thu hồi tin, bộ icon SVG). FE gồm `renderer.js` (logic) và `index.html`.

## Phạm vi
| Mục | Làm gì | Tiêu chí nghiệm thu |
|---|---|---|
| R2 Tin hệ thống | Gom các tin hệ thống **thành công liên tiếp** ("chuyển T… sang…", "Đã gộp nhánh…") thành một dòng "N cập nhật · Xem", bấm vào thì mở ra. Lỗi, bị từ chối quyền và chuỗi bị dừng luôn hiện đủ, không gom. | Mở được từng tin trong nhóm. Tìm kiếm và nhảy tới tin vẫn chạy, kể cả khi tin nằm trong nhóm đang gập. Không làm lệch vị trí cuộn. |
| R3 File chung | Ghim `memory.md` và `roadmap.md` lên đầu. Các file còn lại nhóm theo sprint, mặc định thu gọn. Ẩn khung hàng chờ merge khi trống, có mục hoặc có lỗi thì hiện lại. | Dùng được bằng bàn phím. Mỗi box nhớ nhóm nào đang mở. |
| R4 Thanh đang chạy | Hiện nhãn ngắn, ví dụ "Đang chạy lệnh" hay "Chờ pm nhả memory.md". Bấm hoặc rê chuột mới xem đủ lệnh. Không hiện ước lượng thời gian khi đang chờ khóa. Chấm trên avatar có chữ mô tả trạng thái (tooltip/aria). | Nút Dừng luôn nhìn thấy. Kiểm trên cửa sổ hẹp, cả giao diện sáng và tối. |
| R5 Chi phí | Làm rõ nút "Timeline · Chi phí"; tổng chi phí của box vẫn xem ở đó. | Tổng không bị tính trùng hay thiếu sau khi gom tin (R2). |
| R7 Xoay phiên | Thêm số đo **ngữ cảnh** riêng, lấy từ bước gọi model gần nhất trong lượt, dùng để quyết định xoay phiên và hiện trong popup cỡ phiên. Tổng token tiêu thụ vẫn giữ để tính tiền. | Lượt có nhiều tool call, bước cuối dưới 150k thì không bị xoay phiên. CLI không có số đo thì hiện "chưa có dữ liệu" và không xoay sai. |

## Ngoài phạm vi (backlog)
- R1 sửa vòng đời "Cần bạn": tin mới của End-User gọi PM đang đóng mọi yêu cầu cũ của PM. End-User chọn để sau.
- R6 ghi memory qua block (bỏ khóa nhau trên `.chat/memory.md`).
- Chi phí theo agent và theo sprint; gắn chip trạng thái vào đúng lượt; đưa file mới sửa lên đầu (đều cần thêm dữ liệu từ BE).
- Mục cũ: E (diff + hoàn tác), L (lượt rỗng có commit), lỗi `team-changed` ghi đè draft.

## Phân công
1. techlead **T33**: contract `reports/sprint-9-design.md`. Cần chốt:
   - R7: lấy số đo ngữ cảnh ở đâu cho từng CLI (claude/codex/agy), tên trường trong log/sessions, ngưỡng so với số đo nào, cách hiển thị khi thiếu dữ liệu.
   - R2: luật gom (loại tin nào được gom, khi nào ngắt nhóm), cách tìm kiếm/nhảy tới tin mở nhóm.
   - R3: luật nhóm file theo sprint, nơi lưu trạng thái mở theo box.
   - Ca kiểm cho QA.
2. Sau contract, làm song song:
   - dev-be **T34**: R7.
   - dev-fe **T35**: R2 + R3. dev-fe **T36**: R4 + R5 + hiện số đo ngữ cảnh R7 trong popup.
3. PM nhận đủ T34, T35, T36 rồi gọi qa **T37** nghiệm thu.
