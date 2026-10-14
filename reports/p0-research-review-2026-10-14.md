# Đánh giá P0 trong nghiên cứu “Dự án tương tự Agent Chat”

Ngày: 2026-10-14 · Người đánh giá: techlead · Code đối chiếu: **0.9.0, main `6278360`**.

Nguồn: `research_notes/Dự án tương tự Agent Chat/Dự án tương tự Agent Chat.html`. Thư mục này chưa có trong worktree của techlead; đã đọc bản ở `/Users/namanh/Dev/ai-chat/research_notes/` và đối chiếu với code trong worktree. Số thứ tự dưới đây giữ nguyên năm mục P0 của tài liệu.

Đây là **đánh giá và đề xuất phạm vi**, chưa phải sprint đã duyệt. Chưa sửa code sản phẩm hay tạo task.

## Kết luận

**Nên làm P0, nhưng không triển khai nguyên văn cả năm mục.** Ưu tiên cao nhất là ngăn task bị đóng khi chưa có bằng chứng kiểm tra và sửa phanh chuỗi. Luật chia việc và bàn giao bằng dữ kiện là phần hỗ trợ đáng làm sớm. Tự gọi agent sửa merge nên triển khai sau khi các giới hạn chạy đã đủ chắc.

Ba điểm phải sửa trong đề xuất: không chạy lại check trên một worktree đang thay đổi để thay thế kết quả kiểm integration; không miễn giới hạn cho lượt tự sửa; không xoay phiên theo phần trăm khi chưa đo được cửa sổ và ngữ cảnh thật của CLI.

| Mục | Đánh giá | Phần nên làm trước | Độ lớn dự kiến |
| --- | --- | --- | --- |
| 1. Cổng “xong” | **P0 cao nhất** | Agent thường chỉ tới `review`; PM đóng khi bằng chứng đúng bản code và đã nghiệm thu | Vừa; cần nối task với kết quả kiểm |
| 2. Phanh chuỗi | **P0** | Bao phủ mọi chuỗi, tính đúng chi phí, giữ nút Tiếp tục | Vừa, không chỉ thêm điều kiện đếm |
| 3. Tự gửi lỗi merge | Tách hai phần | Chuẩn hóa sự kiện trước; tự gọi sửa sau, có hạn mức | Nhỏ nếu chỉ sự kiện; vừa nếu tự chạy |
| 4. Luật chia việc | **Làm sớm** | Giao việc nhỏ cho một agent; song song khi độc lập; rõ người duyệt | Nhỏ, nhưng prompt không phải cơ chế cưỡng chế |
| 5. Bàn giao tự điền | **Làm phần dữ kiện** | App điền repo/task/check; agent ghi quyết định và chỗ kẹt | Nhỏ–vừa; phần xoay theo % để sau |

Các mức độ lớn là đánh giá kỹ thuật tương đối, chưa phải cam kết thời gian.

## 1. Cổng “xong”: đúng vấn đề, cần dùng bằng chứng sẵn có

**Hiện trạng đã kiểm:** `core.js:1522`, `validateTaskChanges`, kiểm revision và chủ task; PM được đổi mọi task. Hàm không kiểm bước chuyển hay kết quả test. Probe gọi trực tiếp hàm xác nhận agent có thể chuyển task của mình từ `doing` sang `done` mà không cần bằng chứng.

App **đã có cổng kiểm trước khi gộp code**: `main.js:409` lưu SHA/lệnh kiểm vào queue; phần xử lý merge tạo integration bằng squash, chạy check, kiểm cây không bị sửa, rồi mới đưa candidate vào main. Khoảng trống là **task chưa liên kết với bằng chứng này**, và kết quả check thành công từng lệnh chưa được lưu thành hồ sơ đủ để đóng task.

Đề xuất:

- Giữ quyền agent thường chuyển task của mình sang `review`; chỉ PM thực hiện `done` ở bước đầu. QA/reviewer cung cấp kết quả nghiệm thu, chưa cần thêm một cơ chế phân quyền reviewer mới. Task của chính PM cũng phải có bằng chứng phù hợp.
- Lưu kết quả do app thực sự chạy: queue/run, workspace, SHA nguồn, SHA integration đã kiểm, danh sách lệnh, mã thoát và thời điểm. Nối rõ task/revision với kết quả; không suy ra task chỉ từ tên agent hay tiêu đề commit.
- Tận dụng check của merge queue. Khi `review` tới trước kết quả merge, task ở trạng thái chờ kiểm; không khởi động thêm bộ check trùng lặp. Code đã đổi sau check hoặc candidate phải dựng lại thì kết quả cũ không đủ để duyệt phần sửa mới.
- Với task code dùng worktree, chỉ cho đóng khi bản bàn giao đã gộp và bằng chứng còn phù hợp, cộng với nghiệm thu của PM. **Check xanh không tự đóng task**: UI, hành vi sản phẩm và yêu cầu thử tay vẫn cần duyệt.
- Có đường nghiệm thu rõ cho task tài liệu/research/QA và dự án không bật worktree: ghi lý do, liên kết báo cáo/kết quả kiểm và người duyệt. Không ép mọi task phải có commit code hay chạy `npm run check` bất kể loại việc.
- Cảnh báo khi thay đổi test, cấu hình test hoặc script thực thi check. Không cấm mọi sửa test: dev và QA hiện cần sửa `check.js`. Người duyệt phải thấy thay đổi đó. `mergeChecks` trong cấu hình đã có cơ chế trust; tiếp tục dùng cơ chế này, không tin bản agent tự sửa trên đĩa.

Không mặc định công bố “x test pass/y fail”: runner hiện có mã thoát/stdout/stderr, không có giao thức đếm test chung. Hiện tên lệnh, mã thoát và đoạn lỗi có giới hạn là đủ; chỉ hiển thị số test khi có parser xác định cho runner tương ứng.

Claude có hook `TaskCompleted` để ngăn hoàn thành task bằng exit code 2, nhưng đó là task của Claude. Agent Chat điều phối ba CLI và có bảng task riêng; cổng đóng task phải đặt ở main/core của app. [Tài liệu Claude Code](https://code.claude.com/docs/en/agent-teams#enforce-quality-gates-with-hooks).

**Ca nghiệm thu quan trọng:** tự `done` bị chặn; PM không dùng check của task/SHA khác; check cũ bị vô hiệu khi có bản sửa mới; squash vẫn nối đúng nguồn và candidate; task thử tay không tự đóng khi check xanh; task tài liệu có đường duyệt hợp lệ; log cũ vẫn đọc được.

## 2. Phanh chuỗi: mở rộng cần thiết, tránh chặn nhầm

**Hiện trạng đã kiểm:** `main.js:919`, `recordChainTurn`, chỉ nhận diện sáu lượt thành công của đúng hai tên xen kẽ. Một thay đổi file, metadata hoặc task bất kỳ sẽ xóa bộ đếm. `routeTargets` có thêm trần lượt chung, mặc định 12; vì vậy bỏ lọt phanh không tiến triển **không đồng nghĩa chạy vô hạn**.

Probe xác nhận sáu lượt không đổi của một agent và chuỗi ba agent không kích hoạt phanh này; chuỗi hai agent xen kẽ thì có. Probe cũng xác nhận lượt `error` có `usage.costUsd = 0.25` không được cộng vào `chain.costUsd`, vì hàm return trước khi cộng. Nếu chuỗi còn các nhánh song song, trần chi phí có thể thiếu khoản này. Đây là lỗi cần xử lý cùng P0-2, không chỉ thêm cờ CLI.

Đề xuất:

- Theo dõi chuỗi không tiến triển bất kể một, hai hay nhiều agent; ngưỡng 2–3 chỉ là điểm bắt đầu để thử nghiệm, không áp đặt cho mọi loại công việc. QA/review/research có thể tạo kết quả hợp lệ mà không đổi source.
- Tính tiến triển bằng thay đổi gắn với nhiệm vụ: diff nội dung, báo cáo có thay đổi thực, kết quả kiểm mới cho đúng bản code, hoặc bước chuyển task hợp lệ. Không để ghi lại handoff/memory, đổi timestamp hay lật task qua lại trở thành cách reset phanh vô hạn.
- Chỉ xét sau lượt hoàn tất; tác vụ đang chạy, đang đợi check/lock hay đang cần quyết định không được coi là một lượt thất bại. Khi dừng, lưu nguyên nhân và trạng thái để Tiếp tục không mất việc.
- Tin trùng nên được giữ trong log để tra cứu nhưng không tạo thêm lượt gọi nếu cùng nội dung và cùng ngữ cảnh task/revision. Chưa dùng độ giống ngữ nghĩa để xóa tin: hai lần “đạt” ở hai phiên bản code khác nhau có thể đều đúng.
- Cộng chi phí đo được của mọi kết quả, gồm lỗi/dừng/timeout; đánh dấu khoản chưa biết. Với nhiều agent chạy đồng thời, cần tính phần ngân sách đã cấp cho các lượt đang chạy trước khi cấp thêm. Chỉ kiểm tổng sau khi lượt kết thúc là trần mềm.

`--max-budget-usd` là lớp bổ sung hợp lý cho Claude: tài liệu hiện ghi chỉ dùng ở print mode, dựa trên chi phí ước tính và **có thể vượt ngưỡng**. Không trình bày nó như trần hóa đơn tuyệt đối. Khi triển khai phải kiểm phiên bản CLI và hành vi resume/retry; các lần thử trong cùng run không được mỗi lần nhận lại toàn bộ ngân sách. [CLI reference](https://code.claude.com/docs/en/cli-reference).

**Ca nghiệm thu:** chuỗi 1/2/3 agent; QA chỉ đọc; báo cáo/check mới; task đổi qua lại; các agent song song; lỗi có chi phí; chi phí chưa biết; retry/resume; Stop và Tiếp tục.

## 3. Lỗi merge: tái sử dụng trạng thái, không miễn giới hạn

**Hiện trạng:** `main.js:420`, `mergeError`, đã phân biệt `conflict`, `check-failed`, `needs-deps`, `blocked-dirty`, `blocked-config`, `paused` và lỗi khác. `requestMergeRepair` tại `main.js:1787` là thao tác người dùng, chống gọi trùng job đang chạy theo queue ID và đăng tin dưới người gửi `user`. Cách đăng đó đúng với thao tác bấm nút hiện tại; nếu app tự kích hoạt thì phải ghi rõ nguồn hệ thống.

Phần còn thiếu là chính sách tự điều phối và nội dung bàn giao lỗi, không phải tạo lại hệ trạng thái merge.

- Phát sự kiện có cấu trúc từ queue hiện có: queue ID, agent/workspace, SHA, mã lỗi, file liên quan, lệnh lỗi và log đã cắt/lọc. Không phân loại lỗi bằng cách đoán từ văn bản chat.
- Nếu sau này bật tự sửa, bắt đầu với lỗi check mà agent có quyền sửa. Thư mục chính bẩn, dependency chưa phù hợp, config chưa được chấp nhận hay lệnh bị dừng không được tự gọi agent thử vô ích.
- Xung đột cần giữ quyết định hiện có “không tự giải conflict bằng AI”. Có thể đưa chẩn đoán cho chủ nhánh, nhưng tự áp dụng cách giải xung đột là phạm vi riêng cần chốt.
- **Không chấp nhận miễn giới hạn chuỗi.** Lượt sửa phải có ngân sách lượt/chi phí hữu hạn và tuân theo Stop. Nếu tách khỏi số lượt hội thoại thì vẫn phải có hạn mức sửa riêng và trần chi phí chung; bản đầu nên dùng cùng cơ chế giới hạn để đơn giản.
- Lưu số lần sửa qua restart; chống trùng và bỏ sự kiện của mục đã gộp/superseded. Không chỉ đếm theo task vì một task có thể có nhiều queue và một queue có thể chứa nhiều task. Theo dõi cả chuỗi sửa của bàn giao để việc sinh SHA mới không reset số lần thử.
- Có thể dùng ba lần làm ngưỡng mặc định để chuyển sang chờ người dùng, nhưng dừng ngay với loại lỗi không thể sửa bằng quyền hiện có. Không gọi PM lặp lại chỉ để PM gọi lại agent.

**Khuyến nghị:** làm sự kiện trước, giữ nút gọi sửa thủ công; thêm tự gọi có giới hạn sau P0-1/2. Đây là phần dễ làm app tốn tiền hơn nếu triển khai vội.

## 4. Luật chia việc: đáng làm ngay, không biến thành luật cứng sai ngữ cảnh

`core.js:97`, `RULES`, hiện quy định chat, memory, mention và ảnh; chưa có chiến lược chia việc nêu trong nghiên cứu. Nên thêm hướng dẫn ngắn cho PM: đầu ra/tiêu chí nghiệm thu/người phụ trách rõ; việc nhỏ một nơi giao một agent; công việc độc lập mới chạy song song; nhận việc thì làm; việc vượt phạm vi quay lại PM.

Hai điều cần chỉnh:

- “Mỗi task có check riêng” nên hiểu là **có cách nghiệm thu riêng**, không bắt mỗi task tạo script mới. Các task vẫn có thể dùng chung `npm run check`; phân công rõ người sửa assertion trong `check.js` nếu nhiều bên cùng cần.
- “PM không code” là mặc định theo vai/phạm vi của nhóm, không phải lệnh vô điều kiện cho mọi box. Trong nhóm này PM cần sửa spec/task, nên không đặt `readOnly` toàn bộ PM. Prompt hướng dẫn không thay thế scope/quyền công cụ, và không được ghi đè phân công cụ thể của người dùng.

Không lấy con số 83%/59% trong tài liệu để kết luận mọi việc song song đều kém. Lượt này chưa kiểm chứng thiết lập benchmark của các nghiên cứu đó. Căn cứ đủ để hành động ở đây là chi phí phối hợp và các file chung thực tế của app; đo lại trên công việc của nhóm sau khi đổi luật.

## 5. Bàn giao: dữ kiện tự điền hữu ích; xoay theo % chưa đủ dữ liệu

`core.js:1668–1700` đã có handoff theo agent/workspace/run, kiểm định dạng và giới hạn kích thước; nội dung 3–5 dòng vẫn do model viết. `sessionTokenLimit` tại `core.js:1361` **đã chỉnh được theo agent, 0 là tắt**: 150k là mặc định, không phải ngưỡng cố định như phần “Hiện trạng” của nghiên cứu.

`sessionRotationPending` dùng `lastTurn.contextInputTokens`, tức ngữ cảnh bước cuối của Claude, không phải tổng input cả lượt. Codex/agy chưa có số đo phù hợp nên trả `null`.

Nên bổ sung một phần dữ kiện do app dựng khi cấp prompt/bàn giao: branch và HEAD hiện tại, workspace, tóm tắt diff có giới hạn, task còn mở với revision, check gần nhất gắn SHA hoặc “chưa có”. Giữ riêng phần agent viết về quyết định, cách đã thử, blocker và bước tiếp theo. Không chép dữ kiện biến động này vào memory chung dài hạn.

Phải ghi rõ nguồn/thời điểm: HEAD của agent khác candidate squash đã kiểm; “check gần nhất” không có nghĩa “code hiện tại đã đạt”. Dữ kiện không có trong dự án không Git thì để trống, không tự khởi tạo repo. Dùng chung hồ sơ kiểm ở mục 1, không tạo kho kết quả thứ hai.

Hướng này phù hợp với việc giữ lịch sử Git và ghi chú tiến độ để phiên sau tiếp tục, nhưng không bảo đảm chỉ nhờ thêm handoff là agent sẽ hoàn thành đúng. [Anthropic: effective harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).

**Để sau:** tự xoay theo phần trăm cửa sổ và theo ranh giới task. Cần biết model/cửa sổ hiệu dụng cùng số đo context của từng CLI, và phải đo chi phí nạp lại prompt. Khi chưa có, giữ ngưỡng cấu hình hiện tại; không đoán context từ tổng token và không xoay mỗi khi một task đổi trạng thái.

## Phạm vi triển khai đề nghị

1. **Đợt đầu:** luật chia việc (4); hồ sơ kiểm do app ghi và cổng đóng task (1); dùng cùng dữ kiện cho bàn giao (phần đầu của 5). Sửa ngay thiếu chi phí lượt lỗi trong phần ngân sách chuỗi.
2. **Đợt tiếp:** phanh không tiến triển tổng quát (2), dựa trên kết quả task/check đã có; sự kiện merge có kiểu (phần đầu của 3).
3. **Sau nghiệm thu giới hạn:** tự gọi sửa check có hạn mức. Xoay theo % context, tự giải conflict và loại tin bằng độ giống ngữ nghĩa không nằm trong đợt đầu.

Không cần thay Electron, thêm framework điều phối, MCP hay thư viện mới để thực hiện phần đầu. PM chốt phạm vi rồi techlead mới viết contract/schema/migration cụ thể; bản đánh giá này không tự thay đổi quy trình đang chạy.

## Bằng chứng và giới hạn lượt đánh giá

- Đọc HTML nghiên cứu, code core/main liên quan và memory/roadmap; đối chiếu với baseline `6278360`.
- Chạy probe Node không sửa file sản phẩm: `validateTaskChanges` chấp nhận chủ task tự `done`; hàm `recordChainTurn` nguyên văn từ main bỏ lọt vòng 1/3 agent, bắt vòng 2 agent; chi phí lượt lỗi bị bỏ qua. Các kết quả đều khớp nhận định trên.
- Các probe là kiểm tra hàm cô lập, không phải nghiệm thu toàn luồng Electron hay CLI thật. Chưa chạy lại `npm run check` trong lượt đánh giá tài liệu này.
- Kiểm tài liệu chính thức Claude về hook và cờ ngân sách. Chưa kiểm chứng toàn bộ số sao, giấy phép, benchmark và tuyên bố so sánh đối thủ trong HTML; không dùng các con số đó để cam kết hiệu quả cho Agent Chat.
