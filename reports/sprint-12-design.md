# Sprint 12 — Contract phanh chuỗi, chống gọi trùng và sự kiện merge

Techlead · T50 · 2026-10-14. Theo spec `reports/sprint-12.md` trên nhánh PM; code nền **`71f5fef`**. Main đã thêm spec ở `8cc33cd`, không đổi code sản phẩm so với nền này. Tài liệu thiết kế, chưa phải kết quả nghiệm thu.

## 1. Quyết định

1. **Dừng cấp lượt tự động sau 3 lượt agent thành công liên tiếp không có tiến triển mới.** Đếm lượt đã kết thúc, không đếm tên agent, thao tác tool hoặc thời gian chờ. Lỗi/Stop/timeout chỉ hạch toán chi phí, không tăng cũng không xóa số lượt không tiến triển.
2. Tiến triển và chống trùng dùng fingerprint xác định từ nội dung/bằng chứng thực, giữ lịch sử trong **toàn bộ một chuỗi hữu hạn**. Không dùng model, độ giống ngữ nghĩa, timestamp hay ID ngẫu nhiên làm tín hiệu mới.
3. Phanh là trạng thái được giữ: một khi dừng, kết quả đến muộn không tự mở lại chuỗi. Các job đã cấp được hoàn tất; người nhận phát sinh sau đó được gom vào danh sách chờ. Tiếp tục chỉ khả dụng khi các job/route đã cấp ổn định.
4. Lưu quyết định dừng và việc đã bấm Tiếp tục ngoài source để chống cấp trùng sau restart. Không khôi phục tự chạy CLI/job cũ; trường hợp không rõ một job đã bắt đầu chưa phải hiện gián đoạn, không tự chạy lại.
5. Sự kiện merge bổ sung metadata vào `kind:'merge'` hiện có. Sự kiện không gọi agent; nút sửa thủ công dùng đúng sự kiện còn hiệu lực và vẫn chịu giới hạn chuỗi/chi phí.
6. **Cần task FE riêng**, phạm vi nhỏ: thẻ dừng cập nhật nhánh đang chạy/người nhận chờ, trạng thái Tiếp tục sau restart, và chi tiết sự kiện merge. Không thêm màn hình/cấu hình. PM tạo task và giao FE theo mục 8; T51 không tự sửa renderer/index.

Giữ nguyên giới hạn cấu hình 1–50 lượt (mặc định 12), trần chi phí mềm và G6 Sprint 11. Không thêm dependency; không sửa badge T49, cổng done, squash, quyền, no-kill-on-exit hoặc hành vi agent chỉ route mention đầu dòng.

## 2. Những điểm phải thay ở code nền

- `recordChainTurn` hiện chỉ bắt hai tên xen kẽ sáu lượt; audit thiếu hoặc metadata thay đổi lại xóa bộ đếm. `accountedRuns` chống cộng chi phí hai lần nhưng chưa chống ghi nhận tiến triển hai lần.
- `routeTargets` kiểm budget trước vòng lặp; `ask` có nhiều await và có thể nhận trả về một job đang chờ. Cần giữ chỗ/recheck ngay trước cấp job, không dùng tăng rồi giảm bộ đếm rải rác.
- `haltChain` chỉ đăng tin, chưa có trạng thái chặn dùng chung cho các nhánh. `continuedChains` chỉ là Set trong RAM; tiếp tục hiện dựng lại tin chỉ có tên người nhận nên thiếu ngữ cảnh bàn giao cụ thể.
- `mergeError` đã có phân loại trạng thái. Hai đường refuse/catch phát tin riêng; retry đổi queue ID nhưng tự dựng lại candidate có thể dùng cùng queue. Phải phân biệt **queue** với **attempt**.

Probe hàm thật ở lượt thiết kế xác nhận: sáu lượt rỗng của ba agent không dừng; finalize cùng run hai lần chỉ cộng phí một lần nhưng tăng idle hai lần; audit thiếu làm idle về 0. Đây là ca hồi quy phải sửa, không phải kết quả test bản triển khai Sprint 12.

## 3. S1 — Đo tiến triển

### 3.1 Cửa sổ, baseline và ranh giới

Mỗi chain mới có `threshold:3`, `idleStreak:0`, `idleRunIds:[]`, `completedRuns:Set`, `seenProofs:Set`, các baseline theo domain và bảng milestone. Chain chỉ sống tối đa số lượt đã được cấu hình; **không bỏ fingerprint cũ khi trượt qua ba lượt**, vì bỏ sẽ cho phép A→B→A lặp lại mãi. Tiếp tục là chain mới, seed baseline từ trạng thái hiện tại.

Baseline source được lấy **sau startWorkspace/sync, trước CLI**. Tái sử dụng snapshot trước/sau hiện có; không quét thêm toàn repo mỗi event progress. Task/check baseline lấy từ bảng/hồ sơ app trước khi job chạy; seed trạng thái đang tồn tại, không coi toàn bộ code/task/check có từ trước là thành tích của lượt đầu.

Sau terminal/task event đã được ghi, thu dữ kiện của lượt, cập nhật progress một lần theo runId rồi mới quyết định route. Retry CLI/empty retry/run-command continuation trong cùng run chỉ tạo một lượt hoàn tất. `completedRuns` độc lập `accountedRuns`: không để việc hạch toán sớm khiến bỏ qua tiến triển, hoặc callback lỗi khiến đếm idle hai lần.

Chỉ successful terminal của job agent thực sự chạy mới vào idleStreak. Job xếp hàng, chờ lock, chờ check, summary job, system event và lần yêu cầu bị từ chối trước spawn không tạo lượt idle. Audit thiếu không được coi là có tiến triển; vẫn có thể công nhận task/check được xác minh độc lập, nếu không có thì lượt success đó tăng idle kèm lý do “thiếu dữ kiện kiểm tra”.

### 3.2 Fingerprint source/báo cáo

Domain là `(project,box,workspace hoặc main,phạm vi file hiệu dụng)`. Từ snapshot, lấy các file thuộc scope của job và có khả năng quy thay đổi cho lượt đó; bỏ mọi `.chat*`, `.git`, node_modules, dist, file temp/config/metadata do app sinh. Báo cáo trong `reports/` vẫn là đầu ra hợp lệ nếu thuộc phạm vi được giao.

`contentKey` = SHA-256 của danh sách sort theo path gồm **path, loại entry và digest nội dung/đích symlink**. Không đưa mtime/ctime/inode/permission mode vào key tiến triển; snapshot scope/audit hiện tại vẫn giữ kiểm mode riêng. Không theo symlink để đọc ngoài phạm vi. Xóa file được thể hiện bằng trạng thái không còn entry; tạo/rename có path mới. Không dùng commit SHA thay nội dung: commit rỗng, sửa commit message hoặc squash cùng code không phải tiến triển.

Seed contentKey trước CLI vào tập đã thấy; sau CLI chỉ công nhận nếu có thay đổi nội dung hợp lệ và contentKey cuối chưa từng thấy trong domain của chain. **A→B mới có thể tính; B→A quay lại baseline, A→B lần nữa không tính.** Thay đổi rồi hoàn tác ngay trong một lượt cũng không tính. Nội dung report thay đổi thực được tính; chỉ chạm timestamp hoặc ghi nguyên nội dung không tính.

Worktree riêng: loại các thay đổi chỉ do sync/merge main của app. Shared checkout: chỉ nhận path nằm trong reservation của job, không có writer khác có scope chồng lấn; nghi ngờ từ editor/process ngoài thì không tự gán tiến triển. Agent readOnly không được nhận công trạng thay đổi source; vẫn có snapshot code đọc được làm bối cảnh cho task/check/chống trùng, không dùng scope ghi rỗng để giả mọi phiên bản code giống nhau. Không dùng `metadataChanged.length` để reset nữa. Các giới hạn này không chứng minh ý nghĩa của từng dòng code: một thay đổi byte mới nhưng vô ích vẫn có thể qua phanh; trần lượt/chi phí tiếp tục là lớp giới hạn còn lại.

### 3.3 Task và công việc chỉ đọc

Khóa nội dung task dùng `(id,createdAt,assignee,semanticDefinition)`, trong đó semanticDefinition hash **title/spec/acceptance**, không gồm `updatedAt`, revision trạng thái hay reviewId. Với mỗi bản nội dung code/báo cáo liên quan, giữ milestone cao nhất đã xác nhận: `todo=0, doing=1, review=2, done=3`; seed mức đang có trước lượt.

Chỉ task update đã được main chấp nhận mới xét. Bước tới mức chưa đạt trên cùng task/nội dung có thể là tiến triển; đi lùi không tính và không hạ milestone. doing↔review, review mới với UUID khác hoặc cập nhật timestamp không reset vô hạn. Một định nghĩa task mới do PM tạo có đầu ra/người phụ trách hợp lệ tính một lần theo semanticDefinition; ghi lại file tasks.json không tính.

QA/research/review chỉ đọc có thể gửi task của mình tới review lần đầu và tạo tiến triển mà không sửa source. Không đòi prose khác nhau là kết luận mới. Khi nghiệm thu code khác, ngữ cảnh nội dung lấy từ bằng chứng được liên kết tường minh; nếu thiếu liên kết, dùng snapshot code của workspace mà agent thực sự đọc. Không đoán SHA/task từ câu “đã đạt”. PM done hợp lệ theo cổng Sprint 11 là milestone mới, không phải quyền mới cho agent khác.

Nếu không có task trong dự án, vẫn đo source và chống gọi trùng; một cuộc thảo luận thuần văn bản ba lượt không tạo đầu ra có thể bị dừng và cần người dùng Tiếp tục. Đây là lựa chọn cố ý thay vì giả định mọi câu trả lời mới đều là tiến triển.

### 3.4 Bằng chứng kiểm

Chỉ đọc CheckRecord do app tạo, đúng task/định nghĩa/nguồn, không corrupted/unverified; dùng resolver Sprint 11 để kiểm liên kết. Khóa novelty gồm danh tính task, semanticDefinition, **nội dung cây đã kiểm** (candidate cho merge, source cho runner), policy/lệnh và kết quả xác định `(outcome,exitCode,signal)`. Bỏ checkId/queueId/runId/thời gian/duration/excerpt. Dùng Git object để tính nội dung bản đã kiểm, không lấy HEAD đang chạy thay cho nó.

Một kết quả passed hoặc failed mới có treeStable và nguồn hợp lệ được tính một lần; cùng check, cùng code, cùng kết quả chạy lại không tính. Fail→pass có thể là thông tin mới; lặp fail/pass đã từng thấy không tạo tiến triển tiếp. Stop/timeout/unverified không được dùng để reset phanh. Native CLI tự báo test pass không có hồ sơ app không phải bằng chứng.

Kết quả merge check đến sau terminal được gắn về chain bằng `runId` nguồn/queue do app đã biết; có thể thêm `chainId` vào queue mới để tra cứu, không đoán từ agent. Thu các kết quả này ở lần đánh giá ranh giới kế tiếp; event check riêng không tạo lượt idle hay route. Nếu chain đã dừng, kết quả đến muộn chỉ cập nhật dữ kiện, **không mở lại**.

### 3.5 Quy tắc đếm và giới hạn bộ nhớ

Một lượt có ít nhất một proof mới → idleStreak về 0, lưu proof. Không có → cộng 1 và lưu runId; đến 3 thì latch phanh trước khi cấp người nhận tiếp. Mỗi proof được tiêu thụ một lần dù hai nhánh cùng quan sát; nhiều proof trong một lượt vẫn chỉ reset một lần. Mọi đọc/so sánh xong phải recheck và commit vào trạng thái chain trong một đoạn đồng bộ, không await chen giữa kiểm seen và thêm seen.

Giữ tối đa **8192 key novelty/milestone** mỗi chain; baseline source chỉ giữ digest, không giữ bản nội dung file. Chạm giới hạn không xóa tập cũ để tính lại: dừng với reason `tracking-limit`, giữ các yêu cầu chờ. Hash/snapshot lỗi không tạo digest ngẫu nhiên thành proof mới (`changing:*` hiện có phải bị loại). Không lưu bộ novelty để tự chạy tiếp sau restart; continuation mới seed lại sau thao tác rõ ràng của người dùng.

## 4. S2 — Không cấp job từ tin trùng

Chỉ áp dụng tin terminal success của agent, sau khi bỏ block protocol và xác định mention bằng `core.mentions` hiện tại. Chuẩn hóa text tối thiểu: CRLF→LF và trim hai đầu. Giữ hoa/thường, dấu, khoảng trắng trong dòng/code và nội dung liên kết. Không dùng tìm từ gần giống.

Khóa cho từng người nhận: hash `(chainId,người gửi chuẩn hóa,người nhận chuẩn hóa,tập người nhận đã sort,text,contextKey)`. Context gồm task semanticDefinition liên quan người gửi/người nhận, contentKey của workspace tương ứng, milestone và kết quả kiểm xác định nêu ở mục 3. Không gồm revision theo status/timestamp, UUID review/check/commit metadata. Key bối cảnh phải xác minh được; thiếu dữ kiện thì **không tự kết luận trùng**, để phanh idle/trần lượt xử lý.

Tin vẫn append log nguyên văn. Chỉ ghi khóa đã xử lý khi job được cấp thật hoặc yêu cầu đã được gộp vào một job đang chờ cùng chain. Lỗi setup chưa nhận việc không được “đốt” khóa. Một tin nhiều người nhận xử lý từng người: người đã nhận không bị gọi lại, người chưa nhận không bị rơi. Các yêu cầu trùng đang pending chỉ gom nguồn tham chiếu, không sinh thêm job.

Text giống nhau trên bản code/task mới được xử lý riêng. User gửi lại luôn tạo yêu cầu mới; Tiếp tục bắt đầu chain mới với bộ lọc mới. Chống trùng không thay luật mention và không bỏ tin khỏi log/search/totals. Nếu toàn bộ người nhận bị lọc và không còn việc cần cấp, chain kết thúc tự nhiên; không tạo nút Tiếp tục rỗng để người dùng chạy lại tin trùng. Các test ngưỡng 3 dùng lời nhắn khác nhau để kiểm phanh độc lập với chống trùng.

## 5. Điều phối song song, dừng và Tiếp tục

### 5.1 Admission và thứ tự hoàn tất

Mỗi chain có state `active → halting → stopped → continued`. Chuyển halting là một lần, ưu tiên lý do khi cùng quyết định: cost-ceiling, turn-limit, no-progress, tracking-limit. Lý do đầu đã latch giữ nguyên; chi phí/số job/người nhận còn chờ vẫn cập nhật sau đó.

- Dùng `reservedTurns` để giữ chỗ trước những await chuẩn bị của ask; chỉ chuyển sang `turns` khi thực sự thêm job. Kiểm `turns + reservedTurns` với cap. Sau **mọi await trước jobs.push**, kiểm lại state/budget/Stop/đã có job chờ phù hợp. Khi phanh, trả yêu cầu về pending và giải phóng chỗ; không tạo job lách qua vì ask bắt đầu từ trước.
- Chỉ coalesce job chờ của **cùng agent, cùng chain, cùng loại thao tác**. User tạo chain khác không bị gộp vào chain đã dừng; job của các chain khác xếp hàng tuần tự theo agent như cũ. Gộp cùng chain giữ tất cả trigger/reason, không cộng thêm lượt. Bỏ cơ chế giảm chain.turns trong `waitingTurn`; caller phải biết created/coalesced để hạch toán chính xác.
- Các job đã được nhận trước khi phanh, kể cả queued chờ lock, được hoàn tất; không hủy, không tính lượt idle khi chỉ chờ. Khi kết thúc sau phanh, vẫn tính chi phí và ghi đầu ra, nhưng outgoing mentions đi vào pending. Không có progress muộn nào chuyển lại active.
- Thứ tự đếm theo terminal đã được app chấp nhận, không theo thời gian timestamp của model. Chain có ba lượt success idle hoàn tất thì dừng cấp mới, dù một nhánh khác còn chạy. Nhánh đó được bàn giao bình thường; người dùng có thể Tiếp tục khi đã biết đầy đủ kết quả.
- Hạch toán G6 đúng một lần mọi outcome, luôn cộng phần USD hữu hạn đã biết kể cả partial. Null/partial đặt costIncomplete; không suy unknown=0. Chặn cấp mới ngay khi phần đã biết đạt trần. Các job đã nhận có thể làm tổng vượt trần mềm; không tự kill hoặc hứa trần hóa đơn tuyệt đối.

### 5.2 Danh sách pending và thông báo duy nhất

Pending giữ **yêu cầu + nguồn**, không chỉ tên agent: `{agent,sourceRefs:[{seq,at,textHash}],taskIds:[]}`. taskIds chỉ từ dữ liệu app liên kết tường minh; không parse title/chat để đoán. Gom nhiều nguồn cho một người nhận thành một job continuation, đưa đủ các nguồn vào prompt. SourceRefs trỏ tin gốc trong đúng box; không nhét toàn bộ text nhiều lần vào trạng thái điều phối.

Khi latch có công việc cần cấp, ghi một stopId và đăng đúng một `chain-stop`; chainId và stopId bằng nhau cho chuỗi mới. Nếu chưa có pending nhưng còn nhánh đang chạy, giữ latch và đăng khi nhánh tạo pending đầu tiên. Nếu tất cả kết thúc không còn người nhận, kết thúc yên lặng, không tạo yêu cầu Tiếp tục giả.

Thẻ ban đầu có thể đang **draining**: “Đã ngừng cấp lượt mới; đang chờ … kết thúc”, danh sách pending hiện tại, ba run liên quan nếu dừng do idle, chi phí/cờ thiếu. Khi các terminal/route/admission reservation của chain đã giải quyết hết, chuyển **ready**. Đặt reservation cho việc xử lý outgoing của terminal **trước removeJob**, giải phóng sau route/pending; nếu không, khoảng giữa removeJob và route hiện tại có thể làm ready sớm và rơi người nhận muộn. Những cập nhật này đi qua event IPC, không đăng nhiều tin dừng hoặc sửa log cũ. Có orphan/process chưa xác minh → chưa ready, giữ đường giải phóng khóa hiện có.

Thông báo mới dùng `chainId/stopId`, **không dùng `runId` hoặc `usage`** (reducer hiện coi system có runId là một lượt). Vẫn có `targets`, `continuationTarget`, `costUsd`, `costIncomplete` cho client cũ; UI mới dùng ChainView hiện tại. Text thông báo được dựng từ dữ kiện app, không tự route mention trong nó.

### 5.3 Lưu bền vững và idempotency

Main dùng **`control${chatName}.json` trong worktreeBase(root)**, version 1, ghi atomic bằng helper hiện có. Lưu các stop và claim thao tác Tiếp tục/sửa merge; không lưu trong `.chat` agent có thể sửa. Capture project/box từ lúc nhận việc, không lấy box đang được UI chọn ở callback muộn.

Cấu trúc tối thiểu `{version:1,stops:{[stopId]:StopRecord},claims:{[actionKey]:ActionClaim}}`. StopRecord giữ ChainView cùng sourceRefs đầy đủ, logMessageRef và trạng thái checkpoint. ActionClaim giữ `kind:'continue'|'repair'`, khóa nguồn, childChainId, thời điểm và các dispatch `{agent,sourceRefs,runId,state:'reserved'|'dispatching'|'admitted'|'finished'|'uncertain'}`. Mọi sửa file dùng helper đọc–đổi–atomicWrite đồng bộ, không giữ bản JSON qua await. Không cần persist toàn bộ novelty map hoặc scheduler của các chain đang active; chỉ các stop/claim có side effect cần khôi phục.

Stop lưu reason, idleRunIds, cost, pending, runId của các job đã nhận, trạng thái và tham chiếu tin dừng `{seq,at,textHash}`. Ghi mỗi lần pending/cost/state đổi. Terminal mới thêm `chainId` để phục hồi phần đã có trong log nhưng chưa được checkpoint; không thêm terminal/usage thứ hai. Không phục hồi người nhận từ stdout CLI chưa từng được app nhận.

Tiếp tục giữ signature `api.continueChain(dir,{messageId})`. Trình tự:

1. Kiểm senderFrame/project/box, tìm đúng tin dừng và stop private tương ứng; recheck không draining/orphan, log nguồn chưa bị sửa/thu hồi và recipient còn tồn tại. Source không đọc được/agent bị xóa → lỗi cụ thể, giữ pending, không âm thầm bỏ người nhận.
2. Trong đoạn cập nhật đồng bộ của control store, claim stop và cấp **một childChainId**. Ghi claim trước await/post/spawn; mọi lần bấm/IPC lặp trả cùng childChainId và trạng thái hiện có, không tạo chain thứ hai.
3. Ghi một `chain-continue` với stopId/childChainId/continuedFrom; dùng eventId ổn định để append một lần. Seed chain mới theo cấu hình đã được trust hiện tại. Cấp yêu cầu pending qua admission bình thường, không gọi route bằng tin chỉ chứa tên agent. Prompt thêm các tin nguồn theo thứ tự seq và nhắc kiểm tra kết quả hiện tại trước khi làm phần còn dở.
4. Claim lưu trạng thái cấp của từng người nhận, runId được đặt trước enqueue. Trước mỗi side effect ghi nhận dispatching; sau enqueue xác nhận admitted. Không xóa claim nếu bước sau thất bại: làm vậy có thể chạy lại người đã được cấp trước đó.

Sau restart: claim đã nhận vẫn chống lặp; **không tự spawn lại** phần đang dispatching/admitted. Đối chiếu terminal log/lock registry; việc không rõ đã chạy chưa ghi interrupted và đòi kiểm tra orphan trước khi tiếp tục. Phần chắc chắn chưa cấp giữ trong một stop của child chain, chỉ cấp sau thao tác Tiếp tục mới của người dùng. Run có kết quả đã ghi không chạy lại. Yêu cầu uncertain vẫn hiện riêng trong pending, không tự đổi thành “chưa chạy”; nếu cần làm lại, người dùng gửi yêu cầu mới sau khi xem log/giải phóng orphan. Không được hứa exactly-once tiến trình qua crash; bảo đảm không tự dispatch lại một lần chưa rõ kết quả và không làm mất danh sách cần xử lý.

Store thiếu/hỏng hoặc tham chiếu log lệch → không coi stop là chưa dùng; trả unavailable để tránh cấp trùng. Stop legacy không có private record: dựng tham chiếu ổn định từ tin log thật, đối chiếu **mọi `chain-continue.continuedFrom`** đã có trước khi nhận claim lần đầu. Log hỏng thì không cho Tiếp tục mù. Việc này không replay mọi chain/job khi mở app.

Core `needsYou` phải nhận diện continuation **theo đúng stop/continuedFrom**, không dùng một boolean `resumed` để ẩn mọi chain-stop cũ khác. Giữ hành vi còn lại của “Cần bạn” ngoài phạm vi; không nhân dịp sửa R1.

## 6. S3 — Sự kiện merge có cấu trúc

### 6.1 Attempt và payload

Giữ queue ID hiện tại. Mỗi lần worker bắt đầu xử lý một entry queued có **attemptId UUID mới và attemptNo tăng**, lưu trước bước prepare/trust/check. Rebuild candidate vì target tiến lên cũng là attempt mới dù queue ID không đổi. Retry thủ công tạo queue mới như cũ và liên kết `retryOf`; không mang candidate/error/checkIds của attempt cũ sang attempt mới.

```ts
type MergeFailure = {
  version: 1; eventId: string; attemptId: string; attemptNo: number;
  queueId: string; retryOf: string | null;
  agent: string; workspaceId: string | null; branch: string | null;
  sourceSha: string; candidateSha: string | null;
  phase: 'prepare'|'merge'|'dependencies'|'checks'|'publish'|'recovery';
  state: string; // trạng thái queue hiện có, không dựng hệ trạng thái thay thế
  category: 'conflict'|'check'|'dependency'|'workspace'|'configuration'|'stopped'|'internal';
  code: string; message: string;
  files: string[]; filesTruncated: boolean;
  commandResult: null | {command:string; exitCode:number|null; signal:string|null; error:string|null};
  checkIds: string[]; excerpt: string; truncated: boolean; at: string;
};
```

Map cố định từ **code**, không parse message: CONFLICT→conflict; CHECK_FAILED/CHECK_MUTATED_TREE→check; NEEDS_DEPS→dependency; DIRTY_ROOT→workspace; CHECK_NOT_ALLOWED/TARGET_CHANGED/SCOPE_AUDIT/CONFIG_UNTRUSTED→configuration; PAUSED→stopped; còn lại internal, giữ code gốc. phase lấy từ bước thực tế trong worker, không suy chỉ từ code.

`commandResult` chỉ từ runner đang lỗi/bị dừng; không tự lấy lệnh cuối của một check pass làm lệnh thất bại. CHECK_MUTATED_TREE sau mọi lệnh exit 0 có commandResult null và checkIds thật. Chặn trước check có checkIds rỗng, candidate null nếu chưa tạo; publish lỗi sau check có candidate/checkIds thật nhưng commandResult null. CheckRecord mới thêm attemptId; không lấy record “mới nhất của agent” hoặc của queue attempt khác.

Lưu payload lỗi cuối vào entry và phát `{from:'system',kind:'merge',eventId,queueId,owner,headSha,error,mergeEvent}`. Giữ error `{code,message,files,log}` tương thích, dựng từ cùng payload; text FE cũ đọc được. Không có runId/usage, không route, không tăng lượt/token/chi phí, không chạy thêm check để lấy dữ kiện. Sự kiện thành công giữ đường cũ; không dựng lỗi cho workspace commit failure chưa có queue (tin đó vẫn theo dạng legacy).

Giới hạn payload: message 2000 ký tự, files tối đa 50 path tương đối, excerpt tối đa 8192 ký tự, checkIds tối đa số record thật của attempt (bản hiện tại một record merge). Bỏ ANSI/control, dùng redaction managed path cho **mọi** chuỗi trước khi log/IPC/prompt. Không lộ absolute integration/worktree path; tên file tuyệt đối/đi ra ngoài root không được chép vào files. Có cờ cắt, không coi log đã cắt là toàn bộ lỗi.

### 6.2 Một sự kiện cho một lỗi terminal

`eventId = 'merge-failure:' + attemptId`. Một attempt chỉ có một quyết định lỗi terminal; refuse/catch/cleanup dùng cùng helper. Cleanup thất bại bổ sung log kỹ thuật, không sinh một lỗi “merge thất bại” thứ hai thay mất nguyên nhân gốc. Stop queued cũng đi qua helper với phase prepare; stop checking dùng attempt đang chạy; restart khi attempt dở tạo một PAUSED/recovery cho attempt đó.

Ghi payload vào registry trước append thông báo; `postOnce(eventId,...)` kiểm và append trong chính hàng ghi log nối tiếp. Bổ sung index eventId ở core để hai caller/khôi phục không cùng đăng hai lần. Đã append thành công nhưng crash trước cờ delivered → recovery tìm thấy eventId và không đăng lại. Payload đã lưu mà chưa append → hoàn tất một lần với `at` ban đầu, không route. Queue lỗi legacy không có attempt/payload chỉ đọc, không tự phát lại toàn bộ lỗi cũ.

Entry đã merged/superseded trước khi publish notification thì không phát chẩn đoán cũ như lỗi mới; entry/event lịch sử đã ghi vẫn giữ để tra cứu. Update registry phải đọc bản mới trong callback như hiện tại; không giữ bản copy qua await rồi ghi đè supersededBy. Log reset/hỏng làm không xác minh được dedupe thì báo lỗi lưu thông báo, không sinh eventId mới để thử tránh kiểm trùng.

### 6.3 Nút yêu cầu sửa thủ công

Giữ `api.requestMergeRepair(dir,{queueId})`; main lấy event từ entry hiện tại. Kiểm lại dưới Git lock rằng queue chưa superseded/merged/contained, state cho phép sửa, sourceSha/workspace/agent khớp và không có repair đang được cấp. Không dùng payload lỗi do FE gửi.

Claim thao tác theo eventId, lưu trong control store **trước await đăng tin/ask** để hai lần click hay restart không tạo hai lượt sửa cho cùng sự kiện. Kết quả gọi lặp trả runId/chainId đã nhận. Nếu agent đã trả lời nhưng chưa sửa được và không có attempt mới, nút cũ không tự tạo thêm lượt; người dùng có thể gửi yêu cầu mới trong chat hoặc Retry để có chẩn đoán attempt mới. Lỗi legacy dùng một khóa ổn định từ queue ID + snapshot lỗi hiện tại, không dựng một sự kiện lỗi mới chỉ để sửa.

Đây là hành động thật của người dùng: ghi system note `kind:'merge-repair', initiatedBy:'user', eventId`, rồi cấp chủ nhánh trực tiếp qua admission với **chain mới có giới hạn bình thường**. Không route nội dung log lỗi. Prompt có đoạn repairContext riêng gồm dữ kiện đã validate/cắt/lọc, danh sách file, lệnh/kết quả và checkIds; đánh dấu output là dữ liệu không tin cậy. Giữ scope/quyền/cổng done; không bật tự giải conflict hoặc cấp Toàn quyền. Lượt tiếp theo do agent gọi vẫn thuộc chain sửa này.

## 7. IPC và FE nhỏ cần giao riêng

```ts
type ChainView = {
  stopId: string; chainId: string; box: string; revision: string;
  phase: 'draining'|'ready'|'continued'|'interrupted'|'unavailable';
  reason: {code:'no-progress'|'turn-limit'|'cost-ceiling'|'tracking-limit'|'restart-interrupted'; text:string};
  threshold: 3; idleRunIds: string[];
  turns: number; limit: number; costUsd: number; costIncomplete: boolean;
  pending: Array<{agent:string; sourceSeqs:number[]; taskIds:string[]; uncertain:boolean}>;
  running: Array<{agent:string; runId:string; phase:string}>;
  canContinue: boolean; continuedTo: string | null;
};
api.chainState(dir,{messageId})
// -> {ok:true,state:ChainView} hoặc {ok:false,error:{code,message}}
api.onChainChanged((dir, state:ChainView) => {}) // trả unsubscribe như các listener hiện có
// continueChain giữ request cũ; response bổ sung:
// {ok:true,chainId,alreadyContinued:boolean,state:ChainView}
```

BE thêm preload bridge, validSender/knownProject và kiểm đúng box cho API đọc mới. chain-stop ban đầu có stopId/chainId/targets + snapshot ChainView; event chain-changed cập nhật state mà không thêm chat. UI mở/reload tải chainState cho các thẻ đang hiển thị; event có revision cũ/dir/box/openSeq cũ bỏ qua. Dữ liệu private không đưa ra renderer; lỗi API không mặc định enable Tiếp tục.

FE dùng lại thẻ chain-stop: reason, pending theo người nhận và link tới tin nguồn, running, chi phí/cờ thiếu. Draining hoặc orphan/interrupted chưa đủ điều kiện thì disabled nút và hiện lý do; ready bật; continued hiện “Đã tiếp tục”. Đổi box dọn cache/listener, guard cả callback của nút. Giữ Enter/Space/focus và theme; không cướp cuộn chat khi có nhánh kết thúc. Thẻ “Cần bạn” sử dụng cùng trạng thái để không có nút bypass điều kiện.

Thẻ merge hiện thêm vùng Chi tiết gập/mở từ mergeEvent: bước lỗi, lệnh/mã thoát nếu có, path, excerpt, SHA/checkIds. Mọi giá trị textContent; không biến command/log thành HTML hoặc control chạy lệnh. Giữ nút sửa theo code cũ; vô hiệu khi worktreeState cho biết superseded/merged hoặc claim đã nhận. Server vẫn là nơi kiểm lại dù FE chưa nhận event mới. Log legacy thiếu payload vẫn hiển thị thông báo cũ/nút gọi hiện có.

## 8. Phân công và cách tích hợp

| Phần | Người/file |
| --- | --- |
| T51 BE | core.js/main.js/preload.js: fingerprint/progress, admission, stop/claim store, continue/recovery, postOnce/index, mergeEvent/repairContext, chainState/event. check.js: thêm sprint12CoreChecks và các ca harness main riêng, sửa các assertion J cũ theo ngưỡng 3. |
| Task FE cần PM tạo | renderer.js/index.html: thẻ chain-stop/needs theo ChainView, chi tiết mergeEvent, guard UI; check.js chỉ rendererS12Checks/assertion FE. Không giao BE sửa UI ngoài phạm vi. |
| T52 QA | Sau đủ BE/FE gộp: kiểm độc lập main harness với repo/box tạm, persistence/restart, UI trên Electron; đối chiếu mục 9. |

BE/FE có thể làm song song sau khi PM tạo task FE. Trong check.js mỗi bên chỉ sửa phần của mình, cuối file giữ cả hai lời gọi suites khi gộp. Không sửa chung runner fixture nếu chưa thống nhất; QA bổ sung sau. PM nhận đủ mới gọi QA một lần. Gộp BE xong phải khởi động lại app.

T50 không tự tạo task FE, không đổi .chat/tasks.json, không sửa sản phẩm hay nhánh PM. Bàn giao phải nói rõ FE là phụ thuộc nghiệm thu; không để T51 triển khai thẻ draining nhưng không có UI đọc nó. Không coi user “Duyệt” báo cáo trạng thái là đã nghiệm thu phím/theme Sprint 11.

## 9. Ca kiểm bắt buộc

| Ca | Kỳ vọng |
| --- | --- |
| Một/hai/ba agent | Dùng text khác nhau nhưng không đầu ra: sau success thứ 3 không cấp job thứ 4. Không còn phụ thuộc mẫu hai tên xen kẽ. |
| Novelty source | Seed A; A→B tính một lần, B→A và A→B lặp không tính; sửa rồi hoàn tác trong cùng lượt, mtime/mode, metadata/handoff/memory không reset. Report nội dung mới trong scope được tính. |
| Task/QA | doing→review mới tạo tiến triển không cần sửa file; làm lại review UUID khác/timestamp/doing↔review không reset; done hợp lệ tính một lần; code/định nghĩa thực mới phân biệt. |
| Check | Cùng nguồn/task/policy/kết quả nhưng ID/thời gian/log khác không tính lại; fail→pass mới tính; vòng fail/pass đã thấy không reset; nguồn sai/unverified không tính; kết quả muộn không mở chain đã halt. |
| Audit/finalize | Audit thiếu không clear idle; finalize cùng run hai lần không tăng idle hoặc tiền hai lần. Retry/tool nhiều lần vẫn một terminal. Chạm giới hạn theo dõi không xóa seen. |
| Tin trùng | Tin lưu đủ nhưng không job mới; nhiều người nhận chỉ cấp người chưa nhận; CRLF/trim nhận diện; whitespace/code/case khác không bị chuẩn hóa quá tay; user gửi lại và câu giống trên code mới vẫn chạy. |
| Admission race | Hai route cùng lúc sát cap chỉ cấp số slot còn; ask đang await bị halt thì không push job; coalesce trong cùng chain không tăng lượt, khác chain không gộp nhầm. |
| Nhánh đến muộn | A/B/C idle xong, D còn chạy: một stop, không kill D; D có progress và gọi thêm người thì pending bổ sung, chain không mở lại; UI tới ready chỉ khi ổn định. |
| Chi phí/Stop | Giữ toàn bộ G6, partial USD vẫn cộng; queued timeout không idle; job error/Stop không reset streak; sau khi đạt trần không cấp mới, job đã nhận vẫn hoàn tất và cập nhật chi phí. |
| Continue | Double click/IPC song song/restart chỉ một childChainId; đủ tin nguồn, không chỉ mention; crash trước/sau claim/post/enqueue không tự replay job không rõ; pending chưa cấp còn đường xử lý, orphan chặn đúng. |
| Cô lập/legacy | Đổi box khi request chậm; log nguồn bị sửa/thu hồi, agent bị xóa, control file hỏng không cho chạy mù; hai chain-stop chỉ một được tiếp tục thì cái kia còn; stop/queue/log cũ đọc được. |
| Merge payload | Tất cả category/phase; lỗi trước check không bịa check/command/candidate; check lỗi có kết quả runner thật; publish lỗi sau pass không gán lệnh pass thành lệnh lỗi; log/path an toàn và bounded. |
| Một sự kiện | refuse/catch/cleanup không trùng; crash giữa registry/log/ack không trùng; cùng queue rebuild là attempt khác; retry/superseded/contained không phát lỗi cũ; event không route/tăng totals. |
| Sửa thủ công | Hai click và restart không cấp hai job cùng event; payload phải từ queue hiện tại; legacy có chẩn đoán rõ giới hạn; không tự sửa do event; chain sửa tính lượt/cost và giữ scope/quyền. |
| FE/hồi quy | Thẻ dừng chạy/draining/ready/continued, phím/theme, pending muộn, chi tiết merge; không double listener; không làm sai cost/timeline/taskEvidence/cổng done/squash. Badge T49 vẫn ngoài phạm vi. |

Dev chạy npm run check và git diff --check; các ca Sprint 12 bắt buộc là assert, không xfail/BUG. Giữ assertion G6 đo USD lỗi thật từ QA T49. QA dùng payload BE thật, đồng hồ/finalize có kiểm soát và thư mục tạm để ép race/crash; không dùng task/nhánh thật làm fixture, không gọi model trả phí chỉ để thử. Ghi riêng phần harness và phần Electron thật.

Lượt T50 chỉ đối chiếu code, chạy ba probe baseline nêu mục 2 và kiểm tài liệu. Chưa chạy lại toàn bộ bộ kiểm sản phẩm, chưa triển khai S1–S3.
