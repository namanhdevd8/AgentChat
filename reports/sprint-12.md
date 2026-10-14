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
| T53 | dev-fe | `renderer.js`, `index.html`: thẻ dừng/Cần bạn theo ChainView, chi tiết mergeEvent, guard callback/box; chỉ suite rendererS12Checks và assertion FE trong `check.js` | code | Dùng đúng payload BE theo contract mục 7 và bổ sung mục 8 bên dưới; QA T52 đạt luồng draining/ready/continued, phím/theme, chống callback cũ; PM duyệt bằng checks |
| T54 | dev-be | Hotfix `core.js`/`main.js` và assertion BE trong `check.js`: approval manual có report hợp lệ hoạt động | code | Ca main thực với report tương đối hợp lệ đạt; report ngoài dự án bị từ chối, manual reason-only vẫn đạt, task code có worktree vẫn không được duyệt manual; QA T52 kiểm lại và PM duyệt bằng checks |

Sau bàn giao T50, PM chấp nhận cần phần FE để hiển thị trạng thái chờ nhánh kết thúc và ngăn bấm Tiếp tục trước khi đủ điều kiện. T53 dùng thẻ/nút sẵn có, không thêm màn hình hoặc cấu hình. T54 là lỗi mới phát hiện khi PM nghiệm thu tài liệu; giao cùng BE sửa trước phần T51, không gộp nó thành một mục mở rộng không có task.

Thứ tự cập nhật: PM duyệt T50 → BE T54 rồi T51, song song với FE T53 theo contract đã chốt → PM nhận đủ T51/T53/T54 và code đã gộp → gọi QA T52 một lần → sửa lỗi nếu có → PM nghiệm thu. Trong `check.js`, BE sở hữu sprint12CoreChecks/main harness và ca manual-report; FE sở hữu rendererS12Checks. Khi ráp dòng nối suites cuối file phải giữ cả hai bên; không sửa chung fixture nếu chưa thống nhất.

Dev không tự đổi task sang done. Tài liệu/QA dùng approval manual có lý do và báo cáo nghiệm thu; trường report là tùy chọn. Task code dùng đúng checkIds của lần bàn giao. Không dùng task thật, log thật hay nhánh đang làm của team làm fixture.

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

## 8. PM nghiệm thu T50 và giao triển khai (2026-10-14)

Đã đọc toàn bộ [contract Sprint 12](sprint-12-design.md), bản techlead `41e6b0f`, gộp vào main `38c2710`. Contract đạt S1–S3: có baseline/novelty cho source, task, check; giới hạn 3 lượt success; admission chung cho nhiều nhánh; lưu claim qua restart; sự kiện theo attempt và giữ thao tác sửa thủ công. T50 đủ điều kiện đóng bằng approval manual. Đã tạo T53 FE theo yêu cầu mục 7–8; QA T52 chờ đủ hai phía.

PM chốt hai quy ước tích hợp còn chưa ghi rõ trong type để BE/FE không tự chọn khác nhau; đọc cùng contract mục 7:

1. `ChainView.revision` giữ kiểu string, là **chuỗi số thập phân tăng đơn điệu theo stopId**, bắt đầu `"1"`, lưu cùng checkpoint và không reset sau restart. Mỗi thay đổi view tăng một lần; chỉ đọc lại không tăng. FE so giá trị số, bỏ response/event có revision thấp hơn bản đã nhận; bản bằng nhau không cần render lại. Guard dir/box/openSeq vẫn bắt buộc. Ca bắt buộc: nhận revision `"10"` rồi response chậm `"9"` không được mở lại nút Tiếp tục hoặc làm mất pending.
2. Dùng lại `worktreeState.queue[].canRepair` làm cờ quyền bấm nút: BE trả false khi mục không còn hiệu lực hoặc claim sửa đã nhận, kể cả sau restart; không chỉ dựa vào state conflict/check-failed. Bổ sung `queue[].mergeEvent: MergeFailure | null` với payload đã lọc giống thông báo chat để FE đọc chi tiết từ cùng nguồn. Không cần gửi private claim hay thêm API claim cho FE. FE dùng trạng thái queue hiện hành để vô hiệu nút trong cả chat/hàng chờ; nếu chưa tải được trạng thái thì không suy ra được phép sửa chỉ từ log cũ. BE vẫn kiểm lại tại IPC. Lỗi legacy giữ cách hiển thị và kiểm quyền bằng queue hiện tại.

Đây là quy ước triển khai của cùng chức năng đã duyệt, không thêm màn hình hay hành vi tự động. Nếu dev thấy cần đổi interface, báo PM và techlead trước khi thay để hai phía cùng cập nhật. QA dùng payload thực từ BE, không chỉ fixture tự dựng.

### T54 — Lỗi duyệt manual kèm report

- Phát hiện khi chuẩn bị duyệt T50: `main.js`, hàm `verifyTaskApproval`, gọi `core.validTaskSpec(approval.report, root)`, nhưng `core.js` chưa export `validTaskSpec`.
- PM đã chạy probe chỉ đọc: lấy nguyên nhánh manual của hàm từ main, dùng core thật và giả lập registry/settings rỗng. `{kind:'manual',reason:'…'}` trả `{ok:true}`; thêm `report:'reports/sprint-12.md'` gây **TypeError: core.validTaskSpec is not a function**. Đây là probe cô lập, chưa phải nghiệm thu IPC toàn luồng.
- BE sửa tại validator dùng chung, giữ kiểm phạm vi report và cổng chặn manual cho task code có worktree. Thêm assert qua main harness thật cho đường có report; kiểm cả report hợp lệ, đường thoát dự án, reason-only và task code. Không nới quyền hoặc bỏ validation để tránh lỗi.
- T50 lần này dùng approval manual với reason có nêu đường dẫn báo cáo, bỏ trường report tùy chọn; đây là định dạng parser đã hỗ trợ. Sau T54, dùng lại trường report khi có tài liệu.
- Lượt PM này chỉ sửa tài liệu/task/memory, xác minh JSON/parser và probe trên; chưa chạy `npm run check` hay Electron. Phần sản phẩm do BE/FE triển khai và QA T52 nghiệm thu.

## 9. Nhận T53 lần 1 — cần hoàn tất tích hợp (2026-10-14)

FE báo đã làm ChainView/Cần bạn, mergeEvent và rendererS12Checks, check cục bộ đạt. Tuy nhiên T53 chưa có hồ sơ kiểm hợp lệ trên bảng task, và app đã báo không tự commit vì kiểm phạm vi chưa đủ. PM chưa nghiệm thu T53.

PM đọc worktree FE tại thời điểm nhận bàn giao: HEAD `6318ecc`, đang merge, còn `UU index.html` và `UU check.js`. CSS nhánh FE đổi hàng task thành flex-wrap, title một dòng và min-width 120px; phía main đã có hotfix hai tầng bằng grid, title tối đa hai dòng, metadata riêng. Đây là phần T53 được yêu cầu giữ từ T55. Các report xuất hiện do main mang vào không tự chứng minh FE sửa ngoài phạm vi.

Trả T53 về Đang làm, dev-fe thực hiện trong worktree của mình:

1. Hoàn tất xung đột đang có và tích hợp main chứa **`d1543f3`**. Giữ các thay đổi Sprint 12 của FE, đồng thời giữ nguyên bố cục bảng task từ main: grid, tên hai dòng, metadata riêng, nút trạng thái mở bằng chứng và bản sửa Esc T55. Không dùng bản CSS flex-wrap/tiêu đề một dòng của T53 thay hotfix.
2. `check.js`: giữ rendererS12Checks cùng toàn bộ suite/cách chạy của main, gồm ca QA IPC chậm và Enter/Space → Esc. Dòng nối suites cuối file phải giữ cả hai bên. Assertion mới `html.includes('flex-wrap: wrap')` không chứng minh riêng hàng task đúng và không được dùng để buộc khôi phục CSS cũ; kiểm hành vi T53 và tái sử dụng ca bố cục T56 hiện có.
3. Cảnh báo `.chat/memory.md`, `.chat/tasks.json` ghi rõ **chưa xác định tác nhân**; dữ liệu chung có thể thay đổi trong lượt agent khác. Không xóa/hoàn tác metadata chung, không nới scope hay bỏ kiểm để vượt cổng. Sau khi tích hợp, gửi lại lượt bàn giao để app audit/commit/check đúng bản hiện tại. Nếu tiếp tục bị chặn, báo PM nguyên văn lỗi và trạng thái worktree để giao điều tra riêng; không quy kết nguồn sửa từ cảnh báo này.
4. Chạy `npm run check` và `node check.js --electron` để bảo đảm phần tích hợp giữ hotfix; gửi review T53 lại sau khi sạch xung đột, báo kết quả và phần BE còn chờ. Check đạt trên bản cũ không được trình bày như đã kiểm bản sau giải quyết xung đột.

T51/T54 vẫn đang do BE làm. PM chỉ gọi QA T52 khi đã nhận đủ các phần và code gộp đạt. QA T56 kiểm lại hotfix riêng trên main d1543f3 theo [báo cáo hotfix](hotfix-task-layout-acceptance.md). Lượt PM này chỉ đọc diff/worktree và cập nhật báo cáo, không sửa code hay tự giải xung đột thay FE.

## 10. Bàn giao BE và FE bị chặn trước CLI (2026-10-14)

T51/T54 gửi task-status sai vị trí nên app chưa chuyển review; PM đọc diff còn thiếu hai trường worktreeState và nguồn system của repair theo contract. FE vẫn kẹt merge ở bước startWorkspace, nên gọi lại chưa cho agent cơ hội giải quyết conflict. Chi tiết bằng chứng, việc trả BE và phương án sao lưu/hủy merge FE cần End-User cho phép nằm tại [sprint-12-integration-recovery.md](sprint-12-integration-recovery.md). T51/T53/T54 giữ Đang làm; chưa đủ điều kiện gọi T52.

End-User đã duyệt phục hồi FE; PM sao lưu và hủy merge dở thành công ngày 2026-10-14. Worktree FE sạch, giữ nguyên HEAD `6318ecc` và code T53; chi tiết bản sao/kiểm chứng tại mục 4 của báo cáo phục hồi. Giao lại FE tiếp tục tích hợp main và bàn giao; trạng thái T53 vẫn Đang làm.
