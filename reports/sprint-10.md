# Sprint 10: Khung xem file đổi cỡ, ảnh/SVG, xem trước HTML (chốt 2026-10-13)

End-User duyệt V1, V2 và V3 theo [sprint-10-proposal.md](sprint-10-proposal.md), làm đúng như PM khuyến nghị: HTML xem trước **không chạy JS**. V4 (Mermaid) để sau. Code nền: main `179ad05`.

## Phạm vi
| Mục | Làm gì | Tiêu chí nghiệm thu |
|---|---|---|
| V1 Khung xem đổi cỡ | Có nút Phóng to / Thu nhỏ: phóng to thì khung gần bằng cửa sổ, thu nhỏ thì về cỡ cũ. Kéo góc để đổi cỡ. App nhớ cỡ và chế độ lần trước. | Dùng được bằng phím, Esc vẫn đóng khung. Cửa sổ hẹp không làm mất nút Đóng. Kiểm cả theme sáng và tối. |
| V2 Ảnh + SVG | Bấm link tới `.png/.jpg/.jpeg/.gif/.webp/.svg` thì khung xem hiện ảnh, có nút "Vừa khung" và "100%". `readImage` nhận thêm SVG, nên `![](x.svg)` hiện được trong chat và trong `.md`. | SVG chỉ hiện qua `<img>` (blob), không chèn vào DOM, nên script trong SVG không chạy. Giữ giới hạn 10 MiB và các kiểm tra phạm vi đọc, symlink của hotfix T40. File lỗi hoặc giả đuôi thì báo lỗi rõ ràng. |
| V3 Xem trước HTML | File `.html/.htm` có 2 tab "Xem trước \| Mã nguồn", mặc định mở "Xem trước". Trang hiện trong iframe sandbox: không chạy JS, không form, không popup, không điều hướng ra ngoài, không tải mạng. CSS inline và ảnh/CSS tương đối nằm trong phạm vi dự án hoặc worktree vẫn hiện. Có nút "Mở bằng trình duyệt" để xem đầy đủ. | HTML có `<script>`, `onerror=…`, `<meta refresh>`, `<a target=_top>`, `<form>`, `<iframe src=https://…>` đều không gây tác dụng và không gọi được `window.parent`/IPC. Tài nguyên tương đối ngoài phạm vi (`../..`, symlink) bị chặn. |

## Ngoài phạm vi
- V4 vẽ Mermaid (cần dependency mới), chạy JS của HTML trong app, xem PDF/Office trong app, agent tự tạo ảnh bitmap.
- Backlog cũ giữ nguyên trong [roadmap.md](roadmap.md).

## Phân công
1. techlead **T42**: contract `reports/sprint-10-design.md`. Cần chốt:
   - V3: cách nạp HTML (srcdoc hay protocol riêng), thuộc tính sandbox, CSP của iframe, cách phân giải tài nguyên tương đối mà vẫn giữ kiểm tra phạm vi đọc của T40.
   - V2: nhận diện SVG (theo nội dung, không theo đuôi file), MIME, giới hạn kích thước.
   - V1: lưu cỡ và chế độ ở đâu.
   - IPC mới (nếu có) và ca kiểm cho QA.
2. Sau contract, làm song song: dev-be **T43** (đọc ảnh/SVG, đọc tài nguyên cho xem trước HTML, IPC) và dev-fe **T44** (khung xem đổi cỡ, hiện ảnh, tab Xem trước/Mã nguồn, iframe).
3. PM nhận đủ T43 và T44 rồi gọi qa **T45** nghiệm thu. Trọng tâm là bảo mật của V3 và V2.
