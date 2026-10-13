# Sprint 9 — Contract R2/R3/R4/R5/R7

Techlead · T33 · 2026-10-13. Theo [spec Sprint 9](sprint-9.md), nền sản phẩm **`f32a970` / 0.6.0**. Đã đối chiếu trực tiếp nội dung commit này và spec ở nhánh PM; worktree techlead còn nền cũ nên không dùng bản code đang checkout làm chuẩn. Đây là bàn giao thiết kế, chưa triển khai sản phẩm.

## 1. Phạm vi và lựa chọn

Mục tiêu: giảm nhiễu màn hình chính, đọc trạng thái dễ hơn và tránh xoay phiên chỉ vì một lượt dùng nhiều tool. Giữ bố cục hiện tại, bộ icon SVG 0.6.0, kho dữ liệu/IPC và cơ chế quyền đang có; không thêm dependency.

- R2 chỉ gom các sự kiện thành công liên tiếp tại FE; không gắn chip vào lượt agent và không sửa log gốc.
- R3 ghim file, nhóm theo tên sprint và nhớ trạng thái theo box; không thêm mtime hoặc suy sprint đã đóng từ tên file.
- R4 nhãn ngắn + chi tiết có giới hạn: BE bổ sung chi tiết chưa bị cắt 160 ký tự, FE hiển thị.
- R5 làm rõ nút Timeline, dùng nguyên tổng chi phí BE đang trả.
- R7 số đo ngữ cảnh độc lập với usage. Chỉ Claude có nguồn được xác định ở contract này; Codex/agy chưa có nguồn xác minh thì trả null.

**R1 “Cần bạn” giữ nguyên theo quyết định của người dùng.** R6, chi phí theo agent/sprint, file mới sửa lên đầu, thay đổi thu hồi tin và các backlog khác không thuộc sprint. Contract này thay quy tắc dùng tổng token để xoay phiên ở Sprint 7, không thay cách tính tổng usage/chi phí.

## 2. R7 — Nguồn số đo và contract dữ liệu

### 2.1 Hai đại lượng riêng

| Đại lượng | Nguồn / mục đích |
|---|---|
| `usage.inputTokens`, `lastTurn.inputTokens` | Token tiêu thụ của lượt theo adapter hiện tại, gồm các đoạn retry/run-command. Giữ phép cộng, chênh lệch checkpoint Codex và cost checkpoint Claude như 0.6.0. |
| `contextInputTokens` | Token đầu vào của **bước model chính gần nhất**, không cộng các bước. Chỉ số này quyết định xoay phiên và hiện trong popup ngữ cảnh. |

Không tính USD từ `contextInputTokens`; không cộng trường này vào reducer tổng box. Không gọi nó là tổng số token của toàn phiên hoặc phần trăm dung lượng context tối đa.

### 2.2 Nguồn cho từng adapter

| Adapter thực tế (`account(agent.cli).bin`) | Quyết định trong Sprint 9 |
|---|---|
| `claude`, kể cả tài khoản `claude2`… | Đọc `message.usage` của event `type:'assistant'` thuộc luồng chính: không có `parent_tool_use_id` ở cả event và message. Công thức: `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. Không dùng `result.usage`, `modelUsage`, `output_tokens` hoặc tổng cost để suy ngữ cảnh. |
| `codex`, kể cả `codex2`… | Adapter đang đọc tổng ở `turn.completed.usage`, chưa có nguồn bước cuối được xác minh. Trả `contextInputTokens:null`; không lấy tổng, chênh lệch checkpoint hoặc số token cached làm ngữ cảnh. |
| `agy` | `step_update.usage` đang được cộng theo step, nhưng chưa có bằng chứng mọi step tương ứng một model request chính. Trả null; không lấy step có index lớn nhất hoặc usage ở result để đoán. |

Tài liệu Claude phân biệt usage mỗi bước trong assistant message và tổng trong result; cùng message ID có thể xuất hiện nhiều lần khi dùng nhiều tool. Đây là cơ sở chọn nguồn, không phải kết quả thử CLI thật trên máy này. [Claude Agent SDK — Track per-step usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking#track-per-step-usage).

Quy tắc parser Claude:

1. Đọc số đo **trước** các nhánh trả sớm nhãn Read/Edit/Bash/text trong `CLI.claude.event`; không chỉ đo ở lời trả lời bằng chữ cuối cùng.
2. Bắt buộc có message ID không rỗng và `usage.input_tokens` là số nguyên an toàn không âm. Cache field vắng mặt tính 0; field có mặt nhưng null/âm/lẻ/chuỗi hoặc tổng vượt số nguyên an toàn làm số đo null. Không cộng field breakdown con của cache creation lần nữa. 0 là số đo hợp lệ.
3. Thứ tự bước theo lần đầu thấy message ID trong stream của một lần spawn. Cùng ID là cùng một bước: cập nhật snapshot, không cộng; bản lặp của ID cũ không thay thế bước mới hơn. Mỗi lần spawn bắt đầu trạng thái đo mới.
4. Bước chính mới có usage thiếu/sai làm số đo hiện tại null, không giữ số đo của bước trước làm số đo bước cuối. Event subagent không thay đổi số đo chính. Event compact/reset đã nhận diện phải xóa snapshot cũ cho tới assistant chính kế tiếp; dữ liệu không nhận diện chắc chắn không tạo số đo.
5. Luồng chính không có số đo hợp lệ → null. BE không đổi cờ CLI, đọc transcript bên ngoài, gọi thêm model hay cài SDK để lấy số đo. Chưa hỗ trợ đo Codex/agy đồng nghĩa chúng không tự xoay theo ngưỡng này; nút “Phiên mới” thủ công vẫn dùng được.

### 2.3 Field thống nhất cho core, log và session

```ts
// Mở rộng kết quả CLI.parse/exec và core.run; mọi nhánh trả mới có field này.
type ContextResult = { contextInputTokens: number | null };

// Terminal message trong log.jsonl có contextInputTokens ở cấp ngoài usage.
type TurnMessage = {
  // ...runId, cli, agent, outcome, usage và nội dung hiện có
  contextInputTokens: number | null;
};

// Trong sessions.json / worktree-sessions.json, đúng agent + workspace như cũ.
type LastTurn = {
  runId: string;
  inputTokens: number | null; // giữ nghĩa token tiêu thụ cũ
  contextInputTokens: number | null;
  partial: boolean; // vẫn mô tả usage, không phải điều kiện hợp lệ của context
  at: string;
};
```

Main ghi `result.contextInputTokens ?? null` trên terminal, kể cả lỗi/chờ bị dừng. Trường không có trong log/session cũ đọc như null; **không fallback về `inputTokens`**, không quét log để lấp hoặc migrate file khi chỉ mở box. Parser/test dùng object so sánh chính xác cần cập nhật field mới. `seen`, `seenHash`, `adopted`, checkpoint token/cost, metadata task và ảnh giữ nguyên.

Trong `core.run`, ngữ cảnh lấy từ **lần spawn CLI cuối cùng của lượt**, không sum/max các đoạn. Kết quả cuối thành công mới lưu snapshot đo được; lượt error/Stop/timeout trả null cho số đo ngữ cảnh vì chưa xác nhận bước cuối hoàn tất. Usage từng đoạn vẫn được giữ kể cả lỗi. Nếu đoạn retry cuối thiếu context thì null, không lấy lại số đo đoạn đầu. Chạy lệnh app runner không tự tạo số đo; đoạn model nhận kết quả lệnh mới là nguồn tiếp theo.

### 2.4 Quyết định xoay và tương thích phiên

Ngay trước dựng prompt của lượt kế, dùng cùng một hàm cho core và `rotationPending`:

```text
resume != false
AND session.id hợp lệ, session.cli == agent.cli
AND sessionTokenLimit > 0
AND lastTurn.contextInputTokens là số nguyên an toàn >= 0
AND lastTurn.contextInputTokens > sessionTokenLimit
```

- Giữ ngưỡng cấu hình mặc định 150000, 0=tắt. Bằng ngưỡng không xoay; 150001 có xoay. Cập nhật ngưỡng áp dụng đầu lượt kế như cũ. Không xoay giữa các đoạn của một lượt.
- Không dùng `lastTurn.partial` của usage để vô hiệu context số nguyên đã đo được; chẳng hạn thiếu cost không làm mất số đo context.
- Ví dụ một lượt 60k + 65k + 70k: usage input 195k, context 70k → tiếp tục phiên. Empty retry 80k rồi 80k: usage 160k, context 80k → tiếp tục phiên. Bước đầu 200k, bước cuối 70k → context 70k, không dùng max.
- Đổi ID, reset/chọn phiên, đổi tài khoản/CLI, root/worktree không kế thừa context của phiên khác. Summary `trackSession:false` không ghi số đo vào phiên thường. `resume:false` có thể lưu thống kê với `id:null` nhưng không xoay.
- Giữ nguyên cơ chế bàn giao/fresh prompt và baseline cost=0 khi mở phiên mới. Xoay thất bại trước khi có ID mới giữ record cũ để còn thử lại; chỉ ghi tin “đã mở phiên mới” sau khi thật sự có ID mới. Orphan còn sống vẫn chặn chạy, không tự bỏ khóa.
- Đổi field nội bộ `sessionRotation.inputTokens` thành `sessionRotation.contextInputTokens`; giữ `previousSessionId`, `previousRunId`, `limit`, `handoffStatus`. Main ghi `kind:'session-rotated'`, `relatedRunId`, thêm `contextInputTokens` và `limit`, không kèm usage. Nội dung: “X mở phiên mới: ngữ cảnh bước cuối lượt trước N token, vượt ngưỡng L.” Tin lịch sử cũ giữ nguyên.

### 2.5 IPC và FE

Giữ nguyên `api.sessions(dir) -> SessionMap`, `open.sessions` và `sessions-changed(dir,map)`. `lastTurn.contextInputTokens` đi cùng record như trên; `rotationPending` từ BE dùng điều kiện mới. Không thêm IPC hoặc schema cấu hình agent.

FE thay cả label settings và popup:

| Trạng thái | Hiển thị |
|---|---|
| Có số đo, limit>0 | “Ngữ cảnh bước cuối: 70.000 / 150.000 token”; thêm “Sẽ mở phiên mới ở lượt kế tiếp” chỉ khi pending đúng |
| Chưa đo, record cũ, Codex/agy | “Ngữ cảnh bước cuối: Chưa có dữ liệu”; giải thích CLI chưa cung cấp số đo; không hiện sắp xoay |
| limit=0 | Thêm “Tự xoay: tắt” |
| resume=false | Thêm “Không nhớ phiên”; không pending |
| Settings | “Ngưỡng xoay phiên (token ngữ cảnh)”; “0 = tắt. Áp dụng cho lượt kế tiếp khi có số đo ngữ cảnh.” |

FE không suy context từ usage hoặc `inputTokens` cũ khi BE chưa cập nhật. Chỉ hiện pending khi có context hợp lệ, nhớ phiên bật, ID/CLI khớp và ngưỡng đạt theo quy tắc mới; `rotationPending:true` từ BE cũ mà không có context không đủ để hiện sắp xoay. Số 0 hiển thị 0, không dùng truthy check. Tooltip giải thích số đo đầu vào của bước cuối, gồm cache, không gồm output. Giữ `dir/openSeq` guard và buffer event khi đang mở box; popup cập nhật không làm mất draft settings.

## 3. R2 — Gom tin thành công, giữ nguyên định danh

### 3.1 Luật gom

Chỉ tin `from:'system'`, không có `usage`, không có `error` và không có hành động cần xử lý mới được xét; allowlist:

- `kind:'task-status-note'` với `relatedRunId` không rỗng.
- `kind:'merge'` với `queueId` và `headSha` không rỗng, không có error — hình dạng tin merge thành công do main 0.6.0 tạo. Tin thiếu dữ liệu để phân loại giữ riêng.

Nhóm ít nhất 2 tin có `seq` liền nhau trong cửa sổ đã tải, cùng ngày theo cách `dayLabel` đang tính. Ngắt nhóm ở mọi tin khác, thiếu seq, khoảng trống seq, đổi ngày hoặc log generation. Có thể gom qua ranh giới hai trang nếu các tin cuối/đầu thực sự liền nhau. Một tin đứng riêng không tạo hàng nhóm.

`permission-denied`, `chain-stop`, `chain-continue`, `session-rotated`, `scope-warning`, lỗi task/handoff/route, lỗi merge, `retract` và kind chưa biết luôn hiện riêng. Không phân loại bằng cách dò chữ “đã”/“thành công” trong text. Không sửa hành vi “Cần bạn”.

### 3.2 Cách biểu diễn tại FE

Giữ các hàng tin gốc làm **con trực tiếp của `#log`**, với `data-seq`/`data-at` như cũ; khi gập chỉ ẩn hàng thuộc nhóm. Chèn thêm một nút summary không có `data-seq`/`data-at`: “N cập nhật · Xem”, `aria-expanded`; mở bằng click/Enter/Space, mở rồi đổi thành “N cập nhật · Thu gọn”. Tin con dùng renderer hiện tại, giữ text, link, thứ tự và timestamp gốc trong dữ liệu; khi mở hiện thời gian của từng cập nhật.

Không bọc tin vào một node rồi tính nó như một tin. Không bỏ tin con khỏi DOM, không thêm sự kiện nhóm vào log/IPC. Mọi selector định danh tin vẫn trỏ đúng **một** hàng gốc; nhóm không dùng seq của tin con làm seq của summary.

Nhớ trạng thái mở nhóm trong bộ nhớ của cửa sổ log theo `(dir,box,generation,seq)`; không cần lưu xuống đĩa. Khi nhóm nối dài/nối với nhóm đã mở thì giữ mở nếu có tin thành viên đang mở. Thu gọn xóa trạng thái mở của cả nhóm. Prune khi tin bị trim, reset khi generation/box thay đổi; không tích lũy theo toàn bộ log.

### 3.3 Phân trang, cuộn, tìm kiếm và thu hồi

- `trimLogWindow` đếm **hàng tin gốc `[data-seq]`**, kể cả đang ẩn, tối đa 300; không đếm summary/day. `loadOlder`, `loadNewer` và cursor lấy seq đầu/cuối của hàng gốc. Không tự tải hết log chỉ để tìm điểm đầu một nhóm.
- Sau open/page/live/trim, tái tính nhóm trên cửa sổ <=300 tin. Trình tự: giữ mốc cuộn → bỏ summary cũ/bỏ ẩn do nhóm → cập nhật và trim hàng gốc → tạo day separator → dựng nhóm → khôi phục mốc. Day separator đứng trước summary của ngày; không chèn ngày vào giữa nhóm.
- Mốc cuộn là hàng hoặc summary nhìn thấy đầu tiên cùng độ lệch pixel; nếu bị trim dùng hàng còn lại gần nhất. Đang sát đáy (48px theo code cũ) thì giữ bám đáy; đang đọc lịch sử thì nội dung đang nhìn không nhảy do nhóm gập/mở lại. Không tạo lại nút đang giữ focus nếu chỉ toggle nhóm; sau toggle focus vẫn ở nút đó.
- `jumpToMessage(seq)` tìm hàng gốc, mở nhóm chứa nó **trước** `scrollIntoView`/highlight. Nếu chưa tải, dùng `logPage({around:seq,limit:100})` như cũ, dựng nhóm rồi mở đúng nhóm. Giới hạn truy vấn trong `#log`; giữ guard `openSeq`.
- Live event khi cửa sổ chưa tới cuối chỉ tăng badge như hiện có, không append để tạo lỗ seq. Reflow/grouping không gọi lại `firstSeen`, `noteTurnTime` hoặc cập nhật tổng chi phí cho một tin đã xử lý.
- Giữ `markRetracted`, `data-seq` và placeholder tin đã thu hồi của 0.6.0. Sự kiện `retract` là ranh giới nhóm và vẫn được xử lý ngay cả khi tin đích không nằm trong cửa sổ.

## 4. R3 — File chung và hàng merge

`api.files(dir)` vẫn trả `string[]` đường dẫn như hiện có. FE giữ đường dẫn đầy đủ làm định danh và dùng nguyên `openFileViewer`; không tự suy đường dẫn chỉ từ tên đang hiển thị.

1. Ghim theo thứ tự: file `memory.md` của **box hiện tại** mà BE trả, rồi `reports/roadmap.md` nếu có. Không tạo file thiếu, không ghim mọi basename trùng memory/roadmap ở nơi khác.
2. Chỉ basename dưới `reports/` khớp `/^sprint-([1-9]\d*)(?:-[^.]+)?\.md$/i` với N là số nguyên an toàn mới vào nhóm `sprint:N`. Ví dụ `sprint-9.md`, `sprint-9-design.md`, `sprint-9-proposal.md` cùng nhóm. Nhóm sắp N giảm dần; file spec `sprint-N.md` trước, phần còn lại sắp theo tên có numeric sort.
3. Các file khác (kể cả `agents.json`, hotfix, UI review) vào nhóm “Khác”, cuối danh sách, sắp theo tên. File ghim không lặp ở nhóm. Không đổi nhóm checklist task.
4. Dùng `details/summary` hoặc nút tương đương đủ thao tác bàn phím; hiển thị tên nhóm và số file. Mặc định mọi nhóm gập, hai file ghim luôn hiện. File dài cắt phần nhìn nhưng giữ tên đầy đủ trong title/accessible name; vùng file cuộn riêng như hiện tại.
5. Lưu map boolean theo group ID trong `localStorage`, key **`file-groups:v1:` + `JSON.stringify([dir,box])`**. Dùng `box` thực từ `open` response, không chỉ thư mục dự án. Dữ liệu lỗi/không ghi được → trạng thái mặc định/in-memory, không chặn mở file. Prune group không còn trong kết quả mới. `refreshFiles` bắt cả `dir`, `box`, `openSeq` để response box cũ không ghi đè box mới cùng thư mục.

Merge: lọc `state:'merged'` như hiện tại, nhưng giữ mọi mục còn error kể cả state bất thường. Ẩn section chỉ khi không còn mục cần hiển thị và không có lỗi tải/`worktreeState.reason` liên quan. Worktree tắt và không có lỗi thì ẩn. Có queued/checking/publishing/paused/blocked/conflict/check-failed/error/needs-deps thì hiện, giữ nguyên các nút và xử lý `ok:false`. API lỗi không được giả thành hàng đợi rỗng; hiện lỗi tải có nút thử lại, giữ dữ liệu tốt trước nếu có.

## 5. R4 — Nhãn ngắn và chi tiết lệnh

### 5.1 Phần BE đi kèm T34

Hiện `core.clean` và `exec` cắt mọi nhãn còn 160 ký tự. Chỉ FE không thể đáp ứng “xem đủ lệnh”; bổ sung dữ liệu **runtime**, không tăng log hay prompt:

```ts
type ProgressDetail = { detail: string | null; detailTruncated: boolean };
// Callback nội bộ mở rộng, callsite cũ một đối số vẫn hợp lệ:
onProgress(label: string, extra?: ProgressDetail): void;
// Cùng field thêm vào event progress và từng item open.active:
type ActiveRunExtra = ProgressDetail;
```

- Nguồn command: Claude `tool_use.input.command`, Codex `command_execution.command`, agy `run_command` có `CommandLine`; app runner lấy command đã validate. Đọc chuỗi gốc trước khi qua `clean`. Label ngắn “Đang chạy lệnh”, “Đã chạy lệnh” hoặc “Lỗi chạy lệnh” theo trạng thái.
- `detail` giữ xuống dòng/tab để xem/copy đúng nội dung, loại ký tự điều khiển khác, tối đa **8192 ký tự**. Vượt giới hạn cắt có `detailTruncated:true`, UI ghi rõ “Nội dung đã rút gọn”; không tuyên bố đang hiện đầy đủ phần bị cắt. Không biến detail thành HTML, Markdown thực thi hay nút chạy lệnh.
- Thao tác đọc/sửa dùng label ngắn với basename; detail chứa đường dẫn đầy đủ có sẵn trong event. Khi không có chi tiết riêng trả `detail:null, detailTruncated:false`.
- `core.exec` chuyển label và detail qua callback; dedup so cả bộ dữ liệu để hai lệnh khác nhau có cùng label vẫn phát progress. `main.progress`, job và `activeFor` lưu/trả cùng field, kể cả mở app giữa lượt. Chuyển phase hoặc hoạt động mới không có detail phải xóa chi tiết cũ; gọi lại `progress(job)` chỉ để refresh bộ đếm chuỗi thì giữ detail của hoạt động đó. Cập nhật cùng thao tác ảnh hưởng `activeAt` như progress hiện tại; không phát heartbeat giả.
- BE không đổi timeout, route, Stop, argv, quyền hay ngưỡng lệnh app runner. `preload` không cần method mới; event subscription hiện có đủ dùng.

### 5.2 Phần FE T36

- Hàng chạy luôn có agent, lượt chuỗi, nhãn ngắn, thời gian đã qua và nút Dừng. Chờ khóa hiện “Chờ pm nhả memory.md”; có nhiều blocker thì thêm số còn lại và liệt kê trong chi tiết. Xếp hàng chưa có blocker hiện “Đang xếp hàng”. Không dùng màu agent như mức lỗi.
- Nhãn là control có thể focus; hover/focus xem tooltip, click/Enter/Space mở vùng chi tiết chứa `pre` có wrap/copy chữ, Escape đóng và trả focus. Không chỉ dùng HTML `title` cho lệnh dài. Chi tiết mặc định gập, không làm nút Dừng bị đẩy ra ngoài. Có thể dùng cùng một vùng cho chuỗi, blocker và command để tránh nhiều popup.
- Nhận field mới qua cả open.active, progress và pendingEvents; event thiếu detail phải xóa detail cũ. Với BE cũ chỉ có `label`, vẫn xem label đó nhưng không gọi là toàn bộ command. Không phân tích cú pháp shell để tự dựng lại lệnh.
- `phase:'queued'` không hiện “còn ~N phút”, “lâu hơn thường lệ” hoặc “im lặng” tính như model đang chạy; chỉ thời gian chờ. Khi thực sự chạy mới dùng thống kê hiện hữu.
- Avatar header có `title` và `aria-label` gồm tên + trạng thái chữ từ nguồn `memberStatusText`; cập nhật ở cả render và patch progress. Giữ popup focus/hover hiện có.
- `patchRun` cập nhật node tại chỗ, không thay nút Dừng khi progress tới. Nút Dừng không co lại; phần chữ `min-width:0`, wrap/ellipsis phù hợp. Dùng palette/theme và SVG hiện có; thử tại cửa sổ tối thiểu app hỗ trợ, cả sáng/tối.

## 6. R5 — Timeline · Chi phí

Giữ `#timeline-btn`, handler `openTimeline` và phím tắt hiện có; đổi từ chỉ icon sang icon + chữ **“Timeline · Chi phí”**. Header thiếu chỗ thì wrap bố cục hợp lý, không đè ô tìm kiếm/avatar hoặc làm mất khả năng nhận ra nút chi phí.

Panel tổng vẫn ở Timeline, dùng `currentTotals` từ `open`/meta message. R2 chỉ đổi biểu diễn, không cộng usage khi dựng lại nhóm. Giữ cảnh báo token/cost/log thiếu dữ liệu và nhãn tổng cả box, không gán tổng này thành chi phí khoảng thời gian đang chọn trong Timeline.

## 7. Phân công và thứ tự tích hợp

| Task | File / trách nhiệm |
|---|---|
| T34 BE | `core.js`, `main.js`: R7 parser/result/log/session/rotation, và **bổ sung progress detail R4 ở mục 5.1**. Không cần dependency/IPC mới. Cập nhật fixture/assertion BE trong `check.js` đang coi tổng token là ngữ cảnh. |
| T35 FE | `renderer.js`, `index.html`: R2/R3, selector phân trang/nhảy/cuộn, lỗi hàng merge. |
| T36 FE | `renderer.js`, `index.html`: R4/R5 và popup/settings R7. Cập nhật assertion nhãn UI cũ trong `check.js` theo nhãn mới. |
| T37 QA | `check.js`: mở rộng kiểm tra hành vi trong mục 8, nghiệm thu sau đủ T34–T36. |

PM giao T34 và T35/T36 theo contract để làm song song; T35/T36 do cùng FE triển khai liền mạch. **Cần giao thêm phạm vi hẹp `check.js` cho BE/FE** ở các assertion bị đổi contract nêu trên: bộ check cũ có test Codex xoay từ tổng token và static label cũ, sẽ chặn merge nếu để tới lượt QA mới sửa. BE chỉ sửa kiểm tra adapter/run/session; FE chỉ sửa kiểm tra UI/nhãn, không cùng sửa một block. QA bổ sung ca còn lại sau gộp. Đây là cập nhật test đi kèm thay đổi đã duyệt, không giao thêm tính năng.

Không tự sửa `.chat/tasks.json`, cấu hình agent hoặc mã ở worktree khác trong T33. Nếu worktree implementer chưa có 0.6.0, PM/app cần đồng bộ đúng nền trước khi code; không chép đè file 0.5.0 lên main. Nhận đủ bàn giao, PM gọi QA một lần. Gộp xong phải khởi động lại app để nạp main/core mới.

## 8. Ca kiểm và điều kiện nghiệm thu

| Nhóm | Ca bắt buộc và kết quả |
|---|---|
| Claude theo bước | Root assistant có 60k/65k/70k, result input 195k → context 70k, usage giữ 195k, lượt kế có resume. Root 150000 không xoay; 150001 xoay ở lượt kế. |
| Cache/ID | Input 4 + cache read 30000 + cache creation 500 → context 30504. Same ID nhiều tool không cộng; ID cũ lặp không thay bước mới. Subagent 300k không thay root 70k. Bước mới thiếu/sai usage → null; cache thiếu vs cache sai được phân biệt. |
| Retry/run-command | 80k + 80k giữ usage tổng 160k nhưng context 80k; đoạn cuối null → null. App command không cộng vào context. Bước cuối thấp hơn bước đầu dùng bước cuối. Không tự xoay giữa lượt. |
| Thiếu số đo/legacy | Codex/agy trả tổng rất lớn vẫn context null và không tự xoay; session/log cũ chỉ có inputTokens lớn cũng không xoay. Không mất checkpoint usage/cost hiện có; số 0 hợp lệ, chuỗi/âm/lẻ/Infinity/số không an toàn bị loại. |
| Lifecycle | Reset/adopt/account khác/workspace khác không nhận context cũ; summary không ghi đè phiên thường; resume=false/limit=0 không xoay; error/Stop/timeout context null nhưng usage vẫn có; lỗi fresh trước ID giữ record cũ. |
| Session IPC/log | Terminal có context ngoài usage; open/sessions/event thống nhất với record, rotationPending tính đúng. Tin xoay dùng context, không tăng totals hay route agent. Callback open chậm không đè event mới hoặc box khác. |
| R2 phân loại | Hai thành công liền nhau → một summary; một tin đứng riêng; error merge/quyền/chain/rotation/retract/unknown luôn hiện riêng. Qua ngày, khoảng seq hoặc message thường phải tách. Nội dung lỗi dù giống câu thành công vẫn không gom. |
| R2 tương tác | Click/Enter/Space mở/gập, focus giữ được; search/jump vào tin đang gập tự mở và tô đúng tin. Nhóm vắt qua page được nối đúng; group/trim tính đủ 300 tin kể cả ẩn. Live khi đọc lịch sử không tạo lỗ seq. |
| R2 hồi quy | Day separator đúng chỗ; cuộn không lệch sau prepend/trim/live/toggle; số lần cập nhật turnTimes và totals không tăng theo re-render; thu hồi tin 0.6.0 vẫn hiện placeholder và chặn/giữ job theo cơ chế hiện tại. |
| R3 | Memory .chat và .chat2 ghim đúng; roadmap chỉ hiện một lần; sprint 10 đứng trước 9; design/proposal cùng nhóm; tên gần giống vào Khác; file đã xóa không còn state. Refresh box cũ, localStorage lỗi và lỗi API không làm hỏng panel mới. |
| Merge | Queue thật rỗng → ẩn; queued/error/reason → hiện lại; API lỗi không ẩn như rỗng. Các nút retry/repair/stop vẫn kiểm `ok:false`. |
| R4 | Command >160 ký tự còn xem được tới giới hạn; >8192 có nhãn cắt; `<script>` chỉ là chữ. Hai command khác có cùng nhãn vẫn cập nhật; hoạt động mới thiếu detail không hiện command cũ. Reopen app giữa lượt nhận chi tiết từ active. |
| R4/R5/FE R7 | Chờ khóa không có ETA; Stop luôn thấy/click đúng runId khi progress tới; avatar có chữ trạng thái; popup dùng context/null/0 và ngưỡng mới; nút Timeline có chữ và tổng nguyên vẹn sau gom/mở/gập. |

Dev chạy `npm run check` và `git diff --check` trước bàn giao. QA thực thi parser/run/main và handler FE bằng harness sẵn có, không chỉ grep tên field. Kiểm hình học cuộn, bàn phím, tooltip và theme trên Electron thật; mock DOM không đủ kết luận các mục này. Với Claude thật, khi có lượt chạy hợp lệ thì so stream root assistant cuối với popup và quyết định lượt kế; không tự tạo lượt tốn tiền chỉ để thử. Nếu chưa có mẫu thật, báo rõ giới hạn đó, không mô tả fixture là đã kiểm CLI thật.

T33 chỉ kiểm tài liệu: đủ R2/R3/R4/R5/R7, tên field thống nhất, không kéo R1 vào phạm vi và whitespace sạch. Kết quả kiểm sản phẩm thuộc các bàn giao dev/QA sau này.
