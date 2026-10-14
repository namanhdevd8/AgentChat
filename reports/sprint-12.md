# Sprint 12: Phanh chuỗi không tiến triển và sự kiện merge

Ngày chốt: 2026-10-14. End-User trả lời “Duyệt” cho báo cáo trạng thái lúc 20:17 có nêu hai mục Sprint 12; PM hiểu đây là duyệt triển khai hai mục đó và đã thông báo cách hiểu trong chat. Nguồn phạm vi: [đánh giá P0, mục 2–3](p0-research-review-2026-10-14.md) và phần để đợt sau của [Sprint 11](sprint-11.md).

Nền đối chiếu khi lập spec: `71f5fef`, đã gồm bản sửa Sprint 11 và check của QA. Sprint 1–11 cùng T1–T49 vẫn đã đóng. Lời duyệt này không được ghi thành bằng chứng End-User đã chạy thử phím/theme/panel Bằng chứng; phản hồi thử tay Sprint 11 vẫn chưa có.

## 1. Mục tiêu và phạm vi

Chuỗi gọi agent phải dừng khi tiếp tục chạy mà không tạo kết quả mới, dù có một, hai hay nhiều agent. Khi gộp code gặp lỗi, app cung cấp dữ kiện có cấu trúc từ hàng chờ hiện có để hiển thị và bàn giao lỗi chính xác.

| Mục | Đầu ra | Điều kiện đạt |
| --- | --- | --- |
| S1 Phanh tổng quát | Thay nhận diện riêng hai agent chat xen kẽ bằng theo dõi tiến triển của cả chuỗi; có lý do dừng và danh sách việc đang chờ | Chuỗi 1/2/3 agent đều được kiểm soát; báo cáo, kiểm tra và review hợp lệ có thể tạo tiến triển dù không sửa source |
| S2 Chống gọi từ tin trùng | Tin agent trùng nội dung/người nhận/ngữ cảnh nhiệm vụ trong cùng chuỗi vẫn lưu log nhưng không sinh lượt gọi trùng | Không chặn lời nhắn mới của End-User, nút Tiếp tục hoặc cùng nội dung gửi cho bản code/nhiệm vụ mới |
| S3 Sự kiện merge | Chuẩn hóa metadata lỗi từ queue hiện có, nối đúng lần thử, nhánh và hồ sơ kiểm | Hiển thị lỗi và yêu cầu sửa thủ công dùng dữ kiện này; không đoán mã lỗi từ văn bản chat, không phát lặp cùng lỗi |

Giữ giới hạn lượt hiện có (mặc định 12), trần chi phí tùy chọn và cách tính chi phí mọi outcome của Sprint 11. Không thêm dependency, màn hình quản trị hay cấu hình mới trong đợt này.

## 2. Hành vi phanh và chống trùng

### Tiến triển

- Dữ kiện đủ điều kiện: nội dung source/báo cáo thay đổi thực gắn với việc đang làm; kết quả kiểm mới gắn đúng bản code/nhiệm vụ; bước chuyển task hợp lệ tạo kết quả mới. Dùng lại hồ sơ kiểm Sprint 11.
- Ghi lại handoff/memory, timestamp, metadata tự sinh hay đổi task qua lại trên cùng bản bàn giao không được dùng để xóa bộ đếm mãi. Chạy lại cùng check trên cùng bản code với cùng kết quả không mặc nhiên là tiến triển mới.
- QA/review/research chỉ đọc vẫn phải bàn giao được một kết luận mới gắn task/bản code, ví dụ chuyển task sang review. Không bắt sửa source chỉ để tránh phanh. Không coi mọi câu trả lời khác nhau là tiến triển.
- Techlead chốt fingerprint và cửa sổ theo dõi hữu hạn, có ca chứng minh chống đếm trùng/reset giả. Không thêm model để đánh giá nội dung hay đo độ giống ngữ nghĩa.

### Dừng và tiếp tục

- Chỉ đánh giá ở ranh giới lượt đã hoàn tất. Đang chạy, đang chờ lock/check hoặc chờ người dùng không tự tăng số lượt không tiến triển. Lượt lỗi/dừng/timeout vẫn phải hạch toán chi phí đúng một lần.
- Ngưỡng khởi điểm để techlead đối chiếu ca thực tế: 3 lượt hoàn tất liên tiếp không có tiến triển. Contract phải chốt con số và quy tắc nhánh song song trước khi giao dev; có thể giữ ngưỡng bảo thủ hơn nếu ca QA/review chứng minh cần, kèm lý do trong contract.
- Khi phanh kích hoạt, chặn cấp thêm lượt tự động cho chuỗi; không tự hủy công việc đang chạy. Các nhánh kết thúc sau đó không được mở lại chuỗi hoặc làm rơi người nhận đang chờ. Không phát nhiều thông báo dừng cho cùng quyết định dừng.
- Thông báo cho biết nguyên nhân, số lượt liên quan và chi phí đã biết/cờ thiếu dữ liệu. Dùng lại thông báo `chain-stop` và nút Tiếp tục. Người dùng bấm Tiếp tục mới cấp một chuỗi mới theo giới hạn hiện tại; giữ đúng việc cần tiếp tục và chống bấm lặp, kể cả sau khi mở lại app.
- Trần chi phí vẫn là trần mềm: lượt đã chạy có thể hoàn tất với chi phí vượt trần. Không cấp lượt mới khi phần đã biết đã đạt trần. Contract ghi rõ xử lý nhiều lượt đang chạy và chi phí chưa biết; không hứa giới hạn hóa đơn tuyệt đối.

### Tin trùng

- So khớp xác định trong cùng chuỗi: nội dung chuẩn hóa tối thiểu, người gửi/người nhận và ngữ cảnh task/bản bàn giao. Không chỉ dùng text hoặc task revision thay đổi theo việc lật trạng thái để quyết định.
- Không thay luật mention: agent gọi ở đầu dòng, End-User giữ cách gọi hiện có. Tin vẫn hiện trong log; chỉ bỏ lần cấp việc trùng. Không đếm lượt/token/chi phí cho một job không được tạo.
- Cùng câu “đạt” trên hai bản code khác nhau phải được xử lý riêng. End-User chủ động gửi lại yêu cầu hoặc bấm Tiếp tục không bị bộ lọc tin agent loại bỏ.

## 3. Sự kiện merge có cấu trúc

- Tận dụng trạng thái `conflict`, `check-failed`, `needs-deps`, `blocked-dirty`, `blocked-config`, `paused`, `error` của queue. Giữ tương thích với `kind: merge` và renderer hiện tại nếu có thể.
- Dữ kiện tối thiểu khi có: định danh sự kiện/lần thử, queue ID, agent/workspace, SHA nguồn và candidate đã kiểm, mã/trạng thái lỗi, danh sách file, lệnh thất bại/mã thoát, liên kết hồ sơ kiểm, đoạn log đã cắt/lọc, thời điểm. Không bịa lệnh/check/SHA candidate nếu lỗi xảy ra trước bước đó.
- Một chuyển trạng thái lỗi trong một lần thử chỉ phát một sự kiện. Retry thật là lần thử khác; mục đã gộp hoặc bị superseded không được phát chẩn đoán cũ như một lỗi mới. Sau restart vẫn đọc được lịch sử và không tự phát lại việc cũ.
- Nút yêu cầu agent sửa thủ công dùng đúng dữ kiện của mục còn hiệu lực; kiểm lại queue trước khi cấp việc. Sự kiện hệ thống tự nó không gọi agent, không giả nguồn End-User và không làm tăng lượt/token/chi phí.
- Log/queue cũ thiếu trường vẫn đọc được. Không đổi cách squash, cổng kiểm/duyệt task, quyền sửa file hay trust cấu hình. Không chạy thêm check trùng để tạo sự kiện.

## 4. Ngoài phạm vi đợt này

- Tự gọi agent sửa check, tự giải conflict, miễn giới hạn cho lượt sửa, cờ ngân sách CLI và xoay phiên theo phần trăm context.
- Thay đổi thuật toán dựa trên độ giống ngữ nghĩa; khôi phục tự chạy mọi job sau restart; tự dừng agent khi tắt app.
- Lỗi badge `T49-nhan-queue-bi-chan` và các mục khác trong roadmap giữ ở backlog. Nếu cần sửa để đạt tiêu chí Sprint 12 thì PM tạo task riêng trước khi giao.

## 5. Phân công và thứ tự

| Task | Người phụ trách | Đầu ra/phạm vi | acceptance | Cách nghiệm thu |
| --- | --- | --- | --- | --- |
| T50 | techlead | `reports/sprint-12-design.md`: contract tiến triển/ngưỡng, đồng thời, chống trùng, dừng/Tiếp tục, sự kiện merge và migration | manual | PM đối chiếu S1–S3 và các ca mục 6; chốt được interface và phạm vi file trước khi giao dev |
| T51 | dev-be | S1–S3 trong `core.js`, `main.js`, `preload.js` khi cần; các assertion liên quan trong `check.js` | code | Check có hồ sơ đúng task/bản bàn giao, queue gộp đạt; QA T52 đạt; PM duyệt bằng checks theo Sprint 11 |
| T52 | qa | Check độc lập trong `check.js`; kết quả theo từng tiêu chí, SHA đã kiểm và cách tái hiện lỗi trong bàn giao chat | manual | Chạy `npm run check` và harness app thật trên repo tạm, đối chiếu ca mục 6; PM ghi kết quả vào spec rồi duyệt manual |

Hiện chỉ giao T50. T51 và T52 chờ. Hai phần triển khai cùng nằm ở luồng điều phối BE nên giao một dev; dùng lại UI sẵn có. Nếu contract cho thấy cần thay `renderer.js`/`index.html`, techlead báo PM để tạo task FE với interface riêng, không tự sửa vượt phạm vi.

Thứ tự: techlead bàn giao → PM duyệt contract và giao BE → BE bàn giao/merge đạt → PM gọi QA → sửa lỗi nếu có → PM nghiệm thu. Dev không tự đổi task sang done. Tài liệu/QA dùng approval manual có báo cáo; task code dùng đúng checkIds của lần bàn giao. Không dùng task thật, log thật hay nhánh đang làm của team làm fixture.

## 6. Ca nghiệm thu bắt buộc

1. Chuỗi không tiến triển gồm một agent tự gọi, hai agent xen kẽ và ba agent; đều dừng đúng ngưỡng. Chuỗi tạo source/báo cáo thực và QA chỉ đọc có kết quả mới vẫn đi tiếp.
2. Đổi handoff/memory/timestamp, task doing↔review, lặp cùng check hoặc đổi nội dung rồi khôi phục không thể liên tục tạo lại cùng bằng chứng tiến triển. Thiếu dữ kiện audit không tự được coi là đã tiến triển.
3. Tin trùng giữ trong log, không thêm job; bản code/nhiệm vụ mới hoặc user gửi lại được xử lý. Không chặn mention hợp lệ, không cộng lượt cho job đã gộp vào job đang chờ.
4. Hai nhánh hoàn tất gần nhau: không đếm cùng kết quả hai lần, không chạy thêm sau khi phanh, không làm mất người nhận chờ; tác vụ đang chờ lock/check không bị tính thành lượt không tiến triển.
5. Stop, lỗi, timeout, retry/resume và chi phí chưa biết: giữ các ca G6; chi phí đã đo được cộng đúng một lần. Trần chi phí và trần lượt vẫn chặn cấp việc mới.
6. Tiếp tục giữ đúng công việc chờ, chỉ cấp một chuỗi khi bấm lặp/IPC đồng thời; thông báo dừng và trạng thái tiếp tục đọc đúng sau restart/đổi box.
7. Từng loại lỗi merge đều có trường đúng với bước thực tế; check-failed chứa lệnh/kết quả thật; blocked-dirty/needs-deps không bịa hồ sơ check. Không lộ đường dẫn quản lý nội bộ trong chẩn đoán.
8. Retry, superseded, đã gộp, restart và nút yêu cầu sửa: không phát trùng/lấy lỗi cũ/cấp việc hai lần. Không có lượt sửa tự động do sự kiện.
9. Hồi quy log cũ, UI thông báo/nút Tiếp tục/hàng chờ hiện có, tổng chi phí, taskEvidence và cổng done Sprint 11. Ca giao tiếp dùng payload thật từ BE; báo rõ phần nào kiểm bằng harness, phần nào bằng Electron thật.

## 7. Ghi nhận khi lập spec

PM đã đọc nguồn P0, contract Sprint 11 và các đường `recordChainTurn`, `routeTargets`, `haltChain`, `continueChain`, `mergeError` cùng parser task hiện tại. Lượt này chỉ lập tài liệu/task, chưa sửa code sản phẩm và chưa chạy bộ kiểm sản phẩm. Không coi việc duyệt spec là nghiệm thu S1–S3.
