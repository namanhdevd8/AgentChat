# T53 — sửa Tiếp tục của stop con sau crash

Techlead · 2026-10-15 · nền `1ca2a84`, cùng code sản phẩm với bản tích hợp `51b3909`. Theo giao việc PM sau probe QA chưa đạt. Không đổi BE, định nghĩa task hay worktree của agent khác.

## Sửa lỗi

`renderer.js` trước đây khóa `interrupted` vô điều kiện ở chat và hai đường của Cần bạn. Nay dùng chung điều kiện:

| Dữ kiện | Tiếp tục |
| --- | --- |
| interrupted và canContinue đúng boolean true | Bật, vẫn giữ nhãn gián đoạn và cảnh báo pending uncertain. |
| interrupted nhưng false hoặc thiếu canContinue | Khóa. |
| draining, continued, unavailable | Khóa dù payload có canContinue true. |
| ready với canContinue false | Khóa. |
| Legacy không có phase | Giữ hành vi cũ; main vẫn xác minh khi nhận thao tác. |

- Áp dụng cho thẻ chat, Cần bạn có ChainView từ cache/embedded và fallback từ item.
- Khi chat chưa đọc được ChainView hoặc đọc lỗi, không tự bật nút. Lỗi Tiếp tục cũng không tự bật lại bằng dữ kiện cũ.
- Giữ `seq` của stop con trong request; không đòi runId. Một tập thao tác đang chờ theo openSeq/message bảo vệ cả hai vị trí khỏi gửi lặp khi response/event chưa về; được dọn khi đổi dự án/box.
- Capture project/box/openSeq tại lúc dựng nút, bỏ click/response cũ sau đổi box. Response state cập nhật thẻ qua đường revision hiện có.
- Pending uncertain được ghi rõ “chưa rõ kết quả, không tự chạy lại”; không đổi nó thành phần chắc chắn chưa cấp và không đổi phase BE thành ready.

## Kiểm tra

Đã áp dụng đúng bốn hunk patch QA từ nhánh PM (`sprint-12-recovery-ui-checks.patch`, nguồn QA `f000263`), giữ các nhóm test tích hợp và marker cuối harness. Mở rộng `rendererS12Checks` bằng DOM harness của dự án:

- Main harness khôi phục claim reserved trên module main mới, lấy **message stop con và ChainView thật** truyền vào FE; kiểm nút chat và các đường Cần bạn.
- Ma trận interrupted true/false/thiếu, uncertain-only, orphan, draining, continued, unavailable, ready và legacy. Ca bị khóa gọi handler trực tiếp cũng không gửi IPC.
- Bấm gửi đúng seq, event đến khi đang gửi không mở lại nút, click lặp không thêm request; response continued cập nhật nhãn.
- API lỗi không bật nút; click/response thuộc box cũ không áp dụng cho box mới; cảnh báo uncertain vẫn hiện khi có phần được phép tiếp tục.
- Giữ test listener QA cho dedicated/generic/cả hai API, unsubscribe và bỏ event khác project; giữ bố cục/Esc/late IPC và toàn bộ suites BE trước đó.

Kết quả:

- Ca FE riêng: đạt exit 0.
- `node --check renderer.js`, `node --check check.js`, `git diff --check`: đạt.
- `npm run check`: chạy một lần sau sửa, **exit 0**; main harness qua marker cuối bắt buộc. Ca FE được gọi thêm từ main bằng payload recovery thật đã đạt. Chỉ còn cảnh báo backlog `T49-nhan-queue-bi-chan` đã biết, không có xfail/BUG mới cho Sprint 12.

Không lặp Electron bố cục T56 hoặc chỉnh CSS trong lượt này. Chưa thử trên box thật; kết quả DOM/IPC không thay cho nghiệm thu độc lập của QA. Check bằng shell không tạo bằng chứng task trong app.

## Bàn giao

PM nhận bản sửa để gộp rồi gọi QA kiểm lại T52. T53 vẫn thuộc dev-fe theo định nghĩa hiện tại; techlead không gửi task-status thay chủ task hoặc dùng T55 làm bằng chứng cho T53. Chưa đóng Sprint 12. Sau khi gộp, đổi renderer chỉ cần Cmd+R; nếu app chưa chạy bản BE tích hợp trước đó thì vẫn cần khởi động lại theo bàn giao trước.
