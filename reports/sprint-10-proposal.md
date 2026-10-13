# Đề xuất Sprint 10: khung xem file (PM, 2026-10-13)

End-User hỏi 3 ý: (1) khung xem file có kích thước cố định, không phóng to hay thu nhỏ được; (2) file `.html` có thể xem trước không; (3) ảnh hoặc sơ đồ do agent tạo ra có hiện được không.

## Hiện trạng (PM đọc code trên main `4dd444f`)
- Khung xem đặt cứng `width: min(880px, 94vw); height: min(720px, 90vh)` (index.html:404). Không có nút phóng to và không kéo được góc để đổi cỡ.
- Khung xem chỉ đọc văn bản UTF-8 (hotfix T40). `.html` hiện dạng mã nguồn.
- Ảnh: `![…](…)` trong chat và trong `.md` đã hiện được qua `readImage` (core.js:1785), nhưng **chỉ PNG, JPEG, GIF, WebP**, tối đa 10 MiB. Bấm vào link `.png` thì khung xem không hiện ảnh. **SVG chưa hỗ trợ.**
- Sơ đồ: khối ```` ```mermaid ```` chỉ hiện dạng code, vì app chưa có thư viện vẽ.
- CSP của app (index.html:5) chặn script lạ và mạng ngoài. Mọi cách hiển thị mới phải giữ nguyên lớp chặn này.

## Đề xuất
| Mã | Làm gì | Rủi ro / ghi chú | Cỡ |
|---|---|---|---|
| V1 | **Khung xem đổi cỡ được:** nút Phóng to / Thu nhỏ (gần full cửa sổ), kéo góc để đổi cỡ, nhớ kích thước lần trước. | Không có. | Nhỏ |
| V2 | **Ảnh trong khung xem + SVG:** bấm link `.png/.jpg/.gif/.webp/.svg` thì khung xem hiện ảnh, có nút vừa khung / 100%. Thêm SVG vào `readImage` để `![](sơ-đồ.svg)` hiện trong chat. | Hiển thị SVG bằng thẻ `<img>`, vì `<img>` không chạy script bên trong SVG nên an toàn. Agent vẽ sơ đồ bằng cách ghi file `.svg` (là văn bản), không cần thêm thư viện. | Nhỏ |
| V3 | **Xem trước HTML:** tab "Xem trước \| Mã nguồn". Trang hiện trong iframe sandbox: **không chạy JS, không tải mạng ngoài**, CSS viết sẵn trong file và ảnh cùng thư mục vẫn hiện. Cần chạy JS đầy đủ thì dùng nút "Mở bằng trình duyệt". | HTML do AI tạo ra có thể chứa script. Không cho chạy JS trong app là cách an toàn nhất. | Vừa |
| V4 | **Vẽ sơ đồ Mermaid** từ khối ```` ```mermaid ```` trong chat và `.md`. | Phải thêm thư viện `mermaid` (khoảng 2–3 MB), pin phiên bản, đóng gói trong app, chạy ở chế độ `strict`. Là dependency mới nên **cần End-User duyệt**. | Vừa |

## PM khuyến nghị
- Làm **V1 + V2 + V3** trong Sprint 10. V2 đã đủ để agent vẽ sơ đồ (dưới dạng file SVG) mà không cần thêm dependency.
- **V4 để sau.** Chỉ làm nếu End-User thấy agent thường viết Mermaid trong chat hơn là tạo file SVG.
- Ngoài phạm vi: trình xem PDF/Office trong app, chạy JS của HTML trong app, agent tự tạo ảnh bitmap (cần công cụ tạo ảnh riêng).

## End-User cần quyết
1. Duyệt V1 + V2 + V3?
2. HTML xem trước **không chạy JS** (khuyến nghị), hay cần cả JS?
3. Có thêm V4 Mermaid (dependency mới) ngay không?

Sau khi End-User duyệt: PM tạo `reports/sprint-10.md` và task từ T42 → techlead viết contract → dev-be (đọc ảnh/SVG, đọc tài nguyên cho HTML) và dev-fe (khung xem, tab, ảnh) làm song song → QA.
