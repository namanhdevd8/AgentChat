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

## Nghiệm thu T45 (PM, 2026-10-13)
QA kiểm trên main `7c406bc`, check của QA đã vào main `77c48b7`. Kết quả: **V1, V2, V3 đạt**, kiểm cả trên Electron 44.4.5 thật (`node check.js --electron`).
- V3: iframe `sandbox=""`, không đoạn JS nào chạy (script, onload, `javascript:`, srcdoc, SVG). Server đếm request nhận 0 request. Meta refresh, `<base>` và bấm link đều không điều hướng được trang. Esc vẫn đóng được khi focus nằm trong iframe. CSS, `@import` và ảnh vẫn hiện đúng.
- Node: 20 ca T41 lặp lại cho xem trước HTML và `readImage`. Symlink tài nguyên, token cũ, cổng request và điều hướng đều bị chặn.
- **Còn 2 lỗi cho dev-be** (check.js in ra `BUG …`, đều là tiêu chí ở mục 7.1 của contract):
  1. `T45-cap-song-song`: gửi cùng lúc 200 ảnh thì cả 200 đều được phục vụ, vượt trần 128. Nguyên nhân: main.js:1446 kiểm `resourcePaths.size` trước khi đọc, nhưng chỉ cộng sau khi đọc xong. Cần giữ chỗ (reserve) trước khi đọc.
  2. `T45-doi-symlink-luc-xac-nhan`: trong lúc hộp xác nhận "Mở bằng trình duyệt" đang mở, đổi symlink sang file HTML khác thì app vẫn mở file mới (main.js:1868). Cần so file sau xác nhận với file đã xác minh trước đó (realpath + dev/ino), lệch thì từ chối.
- Trạng thái: T45 → Xong. T43 trả lại dev-be sửa 2 lỗi; sửa xong thì bỏ try/BUG để thành assert. T44 giữ Chờ duyệt tới khi End-User thử tay.

### Việc End-User thử tay (khởi động lại app, vì main.js và preload.js đã đổi)
1. V1: kéo góc và dùng phím mũi tên để đổi cỡ khung xem. Phóng to rồi thu nhỏ, đóng rồi mở lại, khung phải nhớ cỡ.
2. V2: bấm một link ảnh hoặc `.svg`, thử "Vừa khung" và "100%".
3. V3: mở một file `.html`, chuyển qua lại giữa hai tab Xem trước và Mã nguồn. Bấm "Mở bằng trình duyệt" thì phải hiện hộp xác nhận.
4. Kiểm lại cả 3 mục trên với theme sáng và tối.
