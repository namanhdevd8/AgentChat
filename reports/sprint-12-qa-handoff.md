# Sprint 12 — bàn giao nghiệm thu tích hợp T52 và hoàn tất T56

PM · 2026-10-14. Bản tích hợp cần kiểm: **`0a25c49a24b22d649cb47fedc027b685f171e92f`** (main `0a25c49`).

## Bản BE đã gộp và hồ sơ đã xác minh

- Nguồn BE: `bad00375d137c827556ee1cdb2bce4a8cbec7003`, gồm T51, T54 và T57; main đã có FE T53 và hotfix bố cục/Esc T55.
- App runner: checkId `ba6f3a2a-95a8-4a7e-888a-1f322731ca54`, `npm run check`, exit 0, 18.653 giây, treeStable=true; taskRefs có đủ T51/T54/T57 và đúng definitionRevision. Ba review hiện đã có sourceSha `bad0037`, không còn thiếu SHA như lần bàn giao trước.
- Hàng chờ `623f2ec6-2ea9-4751-8e11-dc29480a1530` đã chuyển **merged** vào 16:11:36 UTC. Candidate/main là `0a25c49`; không còn lỗi queue.
- Check của lần gộp: **`86077420-e725-40ff-a792-68aa4f21b50e`**, `npm run check`, exit 0, 18.188 giây, treeStable=true. Record liên kết đúng ba task và ba review hiện hành, cùng source/candidate/queue của lần gộp này.
- PM đọc bản sửa xác nhận đã khôi phục `if (maximized) win.maximize()`, giữ kiểm cửa sổ còn sống và gỡ listener nativeTheme khi `closed`. Main harness đã có assertion phóng to lúc mở, lưu trạng thái lúc đóng và callback theme. Đây chưa phải nghiệm thu Electron thật.

Các task code giữ Chờ duyệt. Kết quả queue đạt cho phép chuyển sang nghiệm thu độc lập; không thay việc kiểm toàn contract hoặc phản hồi trên box thật.

## Giao QA

**T52 — qa, acceptance manual:** bắt đầu nghiệm thu tích hợp theo [spec mục 6 và 8](sprint-12.md) và toàn bộ [contract mục 9](sprint-12-design.md). Đầu ra là kết quả từng nhóm ca, SHA thực kiểm, lệnh/exit code, lỗi kèm tái hiện và giới hạn kiểm tra.

**T56 — qa, acceptance manual:** hoàn tất phần kiểm lại Esc và hồi quy bố cục theo [tiêu chí hotfix](hotfix-task-layout-acceptance.md) trong cùng lượt kiểm Electron. Không coi lần kiểm bị dừng trước đây là đã nghiệm thu xong.

Phạm vi QA vẫn là `check.js` và công cụ kiểm. Giữ các sửa harness chưa gộp nếu còn trong nhánh QA; tích hợp main trước, giữ đủ suites/assertion BE/FE/QA và hoàn tất xung đột trong lượt. Không sửa sản phẩm hoặc dùng task/log/nhánh thật của nhóm làm fixture. Nếu workspace bị chặn trước khi chạy, báo nguyên lỗi và trạng thái đã lưu cho PM.

### Các điểm cần kiểm độc lập

| Nhóm | Trọng tâm |
| --- | --- |
| T51 phanh và tiến triển | Một/hai/ba agent; ngưỡng ba lượt success idle; baseline A→B→A; task milestone theo nội dung; check đúng nguồn/task/policy và không tính lại chỉ vì UUID/thời gian khác; audit thiếu không tạo tiến triển. |
| T51 song song/G6 | Admission sát trần, finalize lặp, nhánh đến muộn không mở lại chuỗi; pending không mất; chi phí lỗi/partial cộng đúng một lần và giữ phanh chi phí. |
| T51 Tiếp tục | Hai IPC đồng thời **và yêu cầu lặp sau lần thành công** đều trả cùng childChainId; draining chưa được cấp; giữ đủ tin nguồn cho việc tiếp tục. Kiểm restart và các điểm crash quanh claim/post/enqueue: không tự chạy lại phần chưa rõ, phần chưa cấp còn đường xử lý. |
| T51 chống trùng/merge | Tin trùng lưu log nhưng không gọi lại; ngữ cảnh code/task mới vẫn gọi được. Lỗi gộp trước check, check thất bại, publish sau check đạt đều có đúng phase/attempt/check/command; retry, superseded, cleanup không phát trùng hoặc gọi sửa tự động. Giữ nút sửa thủ công và chống cấp trùng. |
| T53 ráp FE/BE | Dùng payload BE thật cho ChainView và mergeEvent; draining/ready/continued, pending muộn, SHA candidate/source, revision `10` rồi `9`, đổi box/IPC trả muộn, lỗi API không mở nút Tiếp tục. Kiểm inert text, phím/theme và listener không trùng. |
| T54 | Main thật chấp nhận manual với report tương đối hợp lệ; chặn report ngoài phạm vi; reason-only vẫn hoạt động; task code có worktree vẫn phải có check đúng task/lần bàn giao. |
| T57 | Theme sáng/tối khi cửa sổ sống; updated sau destroyed/closed không ném lỗi và listener được dọn; hủy close vẫn cập nhật theme; khôi phục maximized=true/false và lưu đúng khi đóng. Kiểm đường đóng cửa sổ/thoát harness trên Electron thật để bắt exception End-User đã thấy. |
| T56 | Enter hoặc Space → Esc ngay khi focus còn ở nút trạng thái; Esc trong panel; chỉ đóng đúng panel; focus/aria đúng; IPC muộn không mở lại panel. Hồi quy bố cục 240/300/635px, sáng/tối và viewer. |

Bảng này nhấn mạnh chỗ ráp và các lỗi từng gặp; không rút bớt ca bắt buộc của contract mục 9. Phân biệt rõ kiểm bằng main/renderer harness và kiểm Electron thật. Không gọi model trả phí để làm fixture.

## Cách chạy và báo kết quả

1. Ghi SHA thực kiểm và mọi thay đổi test chưa commit. Chuẩn bị các ca cần thiết trước khi chạy toàn suite.
2. Chạy **một lần `npm run check` và một lần `node check.js --electron`** sau tích hợp; lưu output, exit code và thời lượng. Dùng timeout hữu hạn của harness; không mở vòng `for` chạy lặp toàn suite, không chờ bằng `pgrep` có thể khớp chính lệnh chờ.
3. Gặp assertion lỗi, uncaught exception hoặc timeout thì giữ output và báo lỗi; một lần xanh khác không xóa kết quả lỗi. Chỉ chạy lại phần liên quan khi đã thay đổi code/test hoặc cần xác minh một giả thuyết cụ thể; ghi rõ lý do.
4. Không bỏ assert, đổi thành BUG/xfail hoặc nuốt exit code để gộp được. Lỗi sản phẩm gửi PM để trả đúng người phụ trách; ca mới phải chỉ ra hành vi sai, không chỉ kiểm chuỗi source.
5. Bàn giao riêng kết luận T52/T56, phần nào chưa kiểm và tái hiện lỗi nếu có. Gửi `review` với revision hiện hành ở block `task-status` cuối cùng. PM ghi báo cáo nghiệm thu; QA không tự đóng task.

## Điều kiện đóng và phối hợp tiếp

- Lượt này gọi QA kiểm trên bản đã có T57; FE không cần chạy một vòng Electron trùng song song. Nếu QA phát hiện lỗi FE/BE, PM trả đúng task rồi mới kiểm lại phần đã sửa.
- T53 và T55 đang có bằng chứng cũ bị đánh dấu stale. Sau khi QA hoàn tất mọi sửa test và bản tích hợp ổn định, PM điều phối lấy bằng chứng mới đúng task/lần bàn giao; không dùng check BE thay cho hai task này.
- T55 còn chờ phản hồi bố cục trên box thật của End-User theo tiêu chí đã chốt. Kết quả fixture/Electron không tự thay phản hồi đó.
- PM lượt này chỉ đọc code, registry và hồ sơ kiểm, rồi ghi bàn giao; chưa chạy lại bộ kiểm sản phẩm hoặc Electron, chưa đóng task code.
