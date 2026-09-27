# Sprint 7 — Contract K1–K4

Tech Lead · T25 · 2026-09-27. Spec đã chốt: [sprint-7.md](sprint-7.md). T24 làm lại ⚙ trước; tài liệu này giao diện hóa K1–K4 cho T26/T27, không thay bố cục T24.

## 1. Mục tiêu và lựa chọn

Người dùng chọn ngưỡng mặc định **150.000 token vào/lượt**, chỉnh theo agent, **0 = tắt**, đồng thời ưu tiên chất lượng và chi phí. Phiên mới phải nhận memory, summary, chat gần đây, task và bàn giao công việc; không gọi thêm lượt AI để tóm tắt, không tự đổi model, không can thiệp nén phiên của CLI.

Code hiện tại: `core.run()` cộng usage của các đoạn retry/run-command, lưu session theo agent và workspace; `promptIndexed()` cấp briefing đầy đủ cho fresh/adopted và chỉ tin mới cho resume. `main.executeJob()` xử lý audit, task-status, log và route. Dùng lại các đường này, không thêm service, dependency hoặc kho trạng thái riêng.

Chọn **lưu số đo cuối lượt trong record phiên, quyết định mở mới ở đầu lượt kế tiếp**. Không cần timer, worker hoặc cờ xoay phiên lưu riêng. Token vào là số CLI báo cho lượt, có thể gồm nhiều bước gọi model; đây là chỉ báo chi phí/ngữ cảnh, **không phải phép đo chính xác dung lượng context**. Đây không phải trần chi phí của lượt đang chạy; trần chi phí chuỗi S6 giữ nguyên. Không khẳng định mọi lỗi 503 đều do phiên dài hoặc ngưỡng này sẽ loại bỏ 503.

K2 có giới hạn thời điểm: app chỉ biết token cuối lượt sau khi đã gửi prompt. Vì vậy mọi lượt bật tự xoay đều được nhắc bàn giao cuối lượt, thay vì đợi vượt ngưỡng mới nhắc. Agent trả block ngắn, **app ghi file thay agent**. Ghi trực tiếp từ CLI đòi thêm quyền/scope và không dùng được với readOnly; gọi thêm lượt bàn giao tăng chi phí. Hai cách đó không dùng trong sprint này. Block có thêm ít token nhưng không thêm lần gọi CLI.

## 2. Dữ liệu và cấu hình

### 2.1 Agent

Thêm `sessionTokenLimit: number` vào agent trong `.chat/agents.json`:

- Mặc định khi thiếu: `150000`; chỉ nhận số nguyên an toàn `>= 0`, không nhận chuỗi, null, âm, số lẻ, NaN/Infinity. FE chuyển giá trị input sang number trước khi gửi; ô trống dùng mặc định, **không biến 0 thành mặc định**.
- `team()` trả giá trị đã chuẩn hóa; `saveTeam()` giữ giá trị cũ nếu payload cũ không có thuộc tính, chỉ dùng default khi agent chưa có cấu hình. Dữ liệu cũ không bị ghi lại chỉ vì mở box.
- Cấu hình sai do sửa JSON tay: trả `sessionConfigError` trên agent như `commandConfigError`; không âm thầm thay ngưỡng, không spawn lượt thường của agent đó trước khi sửa cấu hình. `saveTeam()` báo lỗi validation theo cách hiện có.
- Được lưu ngưỡng khi agent đang chạy. Chụp ngưỡng lúc **lượt thực sự bắt đầu**, không đổi giữa các đoạn retry/command. Lượt kế tiếp đọc cấu hình mới nhất, kể cả job đã xếp hàng từ trước.

### 2.2 Session

Mở rộng record đang có trong `sessions.json` hoặc `worktree-sessions.json`; vẫn khóa theo `(canonical project, workspaceId|null, agentName)`:

```ts
type LastTurn = {
  runId: string;
  inputTokens: number | null;
  partial: boolean;
  at: string; // ISO, thời điểm kết thúc lượt CLI
};
// Giữ các field seen, seenHash, adopted, costCheckpoint hiện có.
type SessionRecord = {
  id: string | null;
  cli: string;
  seen: number;
  at: string;
  lastTurn?: LastTurn;
};
```

`lastTurn` là lượt thường gần nhất, không cộng dồn nhiều lượt. Nguồn duy nhất là `result.usage.inputTokens` sau khi core cộng các đoạn trong cùng lượt. Giá trị thiếu/không hợp lệ → null; số 0 hợp lệ. `partial` theo usage, nhưng chi phí chưa biết không làm một số inputTokens hợp lệ thành vô hiệu.

Agent tắt nhớ phiên vẫn lưu record đo lường `id:null, seen:0` để K4 hoạt động; record này **không được dùng như phiên resume**. Mọi consumer chọn phiên chỉ dùng record có `id` không rỗng và CLI khớp. CLI/account khác không dùng số đo/session cũ. Record cũ thiếu `lastTurn` hiển thị chưa có số đo, không suy số liệu từ tổng box hay quét log cũ.

Root/worktree không dùng chung record. `setSession()` ghi atomic bằng temp + rename cho cả hai dạng file, giữ các agent/workspace khác; thao tác read–modify–write đồng bộ hiện có không được chèn await gây ghi đè giữa hai agent.

## 3. K1 — Vòng đời xoay phiên

Điều kiện ngay trước tạo prompt của một lượt thường:

```text
resume != false
AND record.id có thật, record.cli == agent.cli
AND sessionTokenLimit > 0
AND record.lastTurn.inputTokens là số hợp lệ > sessionTokenLimit
```

**Bằng 150.000 không xoay; 150.001 có xoay.** Cờ `rotationPending` cho FE được suy từ chính điều kiện này, không ghi thêm cờ vào file. Đổi ngưỡng lên/xuống hoặc đặt 0 được áp dụng khi tính lại, không phải thực hiện một yêu cầu xoay đã lỗi thời.

1. `main.executeJob()` truyền `runId: job.runId` và ngưỡng mới nhất vào `core.run()`; các thuộc tính CLI/scope của job vẫn theo cơ chế hiện có. Truyền `trackSession:false` cho job `kind:'summary'`; mặc định true cho lượt thường. Job summary không đọc/ghi số đo, handoff hoặc phiên thường của PM.
2. Nếu điều kiện đạt, core chọn `session = null`, dựng prompt fresh bằng `promptIndexed()` và đặt cost baseline Claude về 0. Không xóa record cũ trước khi spawn: nếu không tạo được phiên mới, record cùng số đo cao còn nguyên để lần sau vẫn chọn fresh.
3. `rememberEarly(newId)` lưu phiên mới theo cơ chế hiện có, bỏ `lastTurn` của phiên cũ; bảo toàn checkpoint đúng **phiên mới**. Không sao chép seen/costCheckpoint của phiên cũ sang. Agent đang chạy ở phiên mới nhưng chưa xong lượt hiển thị “Phiên mới, chưa có số đo”.
4. Sau toàn bộ vòng retry/run-command kết thúc, lưu `lastTurn` của lượt vừa chạy và record ID hiện tại. Nhánh lưu success hiện tái tạo object phải giữ đúng các field mới; ghi checkpoint Claude không được vô tình xóa số đo.
5. `core.run()` trả thêm `sessionRotation: null | { previousSessionId, previousRunId, inputTokens, limit, handoffStatus }`, với `handoffStatus: 'current'|'older'|'missing'` được xác định khi dựng prompt fresh. Chỉ trả object khi quyết định tự xoay thực sự nhận được ID phiên mới. Main ghi một tin system `kind:'session-rotated'`, `relatedRunId: job.runId`, không kèm usage và không route: “dev-fe mở phiên mới: lượt trước 200.000 token vào, vượt ngưỡng 150.000.” Nếu spawn thất bại trước ID, chỉ báo lỗi chạy, không báo đã xoay.

Không xoay ở giữa một `core.run()`: empty retry và các đoạn trả kết quả lệnh vẫn dùng ID/timer/runId hiện tại; 80k + 80k trong hai đoạn chỉ khiến **lượt sau** fresh. Giữ nguyên retry phiên chết hiện có; đó là cơ chế khác, vẫn cộng chi phí mọi đoạn, không tạo một vòng thử lại mới cho K1.

Lượt error/Stop/timeout đã kết thúc và có inputTokens hợp lệ vẫn lưu số đo, nên có thể khiến lượt sau chọn fresh; không có số đo thì không đoán. Nếu chưa nhận được ID thay thế khi thử fresh, giữ record cũ như bước 2. Orphan còn sống/chưa rõ tiếp tục chặn lượt kế theo S2/S6; không xoay/xóa record khi process đó còn có thể ghi. Tắt app không kill agent.

Thao tác “Phiên mới” thủ công xóa record/số đo của context được chọn; “chọn phiên” tạo record adopted chưa có số đo, không kế thừa số đo của ID trước. Không xóa lịch sử CLI hoặc log nhóm. Các lượt thực sự mới luôn dùng quy tắc tính cost baseline đang có, không dùng tổng chi phí của phiên cũ.

## 4. K2 — Bàn giao ngắn, không thêm lượt

### 4.1 Protocol

Khi `trackSession !== false`, `resume !== false` và ngưỡng > 0, thêm lời nhắc ngắn ở fresh/resume prompt, `emptyReply()` và `commandReply()`: ở **kết quả cuối cùng** trả 3–5 dòng bàn giao, gồm việc hiện tại, quyết định/ràng buộc, file/check đã làm, phần còn dở và bước kế. App lưu vào `.chat/handoff/<agent>.md`; agent không tự sửa file runtime này.

Ví dụ thứ tự hợp lệ:

````text
Tin trả lời ngắn cho nhóm.
```handoff
- Đang làm T26: xoay phiên theo số token cuối lượt.
- Đã sửa core.js; số đo tách theo workspace.
- Check đã chạy: npm run check, kết quả xanh.
- Còn thử reset/chọn phiên trên giao diện.
```
```task-status
[{"id":"T26","status":"review","expectedRevision":"..."}]
```
````

`handoff` là top-level fence, một block, nội dung UTF-8 tối đa **4.096 byte**, 3–5 dòng không rỗng; không nhận payload JSON/đường dẫn từ agent. Block không tính vào 5 dòng chat. Có thể đi kèm task-status; task-status vẫn ở cuối. `run-command` là kết quả trung gian và không được đi cùng handoff hoặc task-status.

Mở rộng bộ nhận diện protocol hiện có; không dùng regex bắt mọi code fence. Main bỏ task-status cuối trước, rồi lấy handoff cuối phần còn lại. **Không ghi handoff từ command response, empty retry trung gian, kết quả error/Stop/timeout hoặc job summary.** Chỉ lấy kết quả success cuối đã qua lifecycle của job. Handoff lỗi/thiếu không hủy câu trả lời/task hợp lệ, không sinh thêm lượt sửa; bỏ block đã nhận diện khỏi prose, giữ bàn giao hợp lệ trước đó và báo warning một lần nếu block có gửi nhưng sai.

Block không được lọt vào text dùng route mentions, log chat công khai hoặc summary nhóm. Nội dung có `@agent` chỉ là dữ liệu bàn giao, không gọi agent. Giữ nguyên xác thực task-status/revision và command allowlist.

### 4.2 Lưu và đọc

- App ghi `.chat/handoff/<agent.name>.md` ở canonical `.chat`, basename từ tên agent đã validate, **không nhận path từ payload**. Ghi atomic qua `<agent.name>.md.tmp` rồi rename. Header comment do app tạo chứa `{version:1, agent, workspaceId:null|string, runId, at}`; body là 3–5 dòng. Không cần sidecar hoặc database.
- Không đi qua symlink ở thư mục handoff/file đích/temp; kiểm tra containment, file thường, giới hạn header + body **8 KiB**, UTF-8 hợp lệ khi đọc. Dùng pattern đọc file an toàn đang có. File lỗi/không khớp agent hoặc workspace bị bỏ qua, không đưa dữ liệu nhánh khác vào prompt.
- Main lưu sau audit và trước terminal/route/release job. Cùng agent đã được serialize; agent khác ghi tên file khác. File/temp hợp lệ của các agent là metadata app quản lý, loại khỏi snapshot/audit và phép đo “có tiến triển” của J; không cấp thêm owns và không miễn audit cả `.chat/**`. readOnly vẫn không được sửa source; app ghi bàn giao từ output như ghi session/summary.
- Fresh/adopted prompt đọc tối đa một bàn giao đúng agent/workspace, sau summary và trước chat/task. Resume chỉ nhận lời nhắc ghi, không nạp lại body. Khi đổi CLI trong cùng workspace có thể dùng ghi chú công việc này; không dùng nó để khôi phục ID/chi phí của CLI cũ. Summary job bỏ qua hoàn toàn.
- Giữ một bản gần nhất theo đường dẫn đã chốt. Đổi root/worktree làm header không khớp → bỏ qua thay vì dùng nhầm nhánh; chưa cần giữ kho bàn giao cho từng context. Bản cũ/thiếu khi error, quên ghi hoặc crash không chặn fresh: dùng memory + summary + 30 tin gần đây + task, ghi rõ thiếu bàn giao mới trong tin xoay phiên. Nếu file hợp lệ nhưng `runId` khác lượt vừa xong, nạp với nhãn “bàn giao từ lượt trước” và thời gian.
- Prompt nói rõ bàn giao là ghi chú có thể cũ; trạng thái task và code hiện tại là nguồn kiểm tra trước khi sửa. Không hứa giữ nguyên mọi chi tiết của phiên cũ. Sau manual reset vẫn có thể đọc bàn giao đúng context để tiếp tục công việc.

## 5. K3 — Task trong prompt

Chỉ đổi `taskContext()`:

1. Chọn tập theo quyền như cũ: PM thấy toàn nhóm, agent khác thấy task của mình.
2. Đưa `status !== 'done'` vào JSON, giữ `id,title,assignee` khi PM, `status,revision,spec` như hiện tại.
3. Thêm dòng **“Đã xong N task.”**; N chỉ đếm done trong cùng tập quyền. Có 0 task mở vẫn trả `[]` và tổng đúng, không bỏ rule/protocol.

Áp dụng fresh và resume. Không lọc định nghĩa/task reducer, log, IPC `tasks`, bảng checklist hoặc validator: PM vẫn được đổi mọi task và revision vẫn bắt buộc. Task đã xong không còn revision trong prompt; nếu cần mở lại phải tra bảng đầy đủ qua reducer `core.taskBoard()`/`taskBoardIndexed()` hiện có, không đoán revision từ `.chat/tasks.json` raw. Giữ nguyên nhánh `board.error` và quy tắc không đổi task khi dữ liệu lỗi. Không sửa HISTORY=30, không xóa log/task cũ.

## 6. Contract FE/BE cho T27

**Không thêm IPC command.** Giữ `saveTeam(dir,members)`, `sessions(dir)`, `resetSession`, `useSession` và các lỗi hiện có. Thêm dữ liệu vào response và một event qua `api.on()` sẵn có:

```ts
type SessionView = SessionRecord & {
  workspaceId: string | null;
  sessionTokenLimit: number; // cấu hình đã lưu, cùng nguồn với K1
  rotationPending: boolean; // suy theo mục 3, không phải trạng thái lưu thêm
};
type SessionMap = Record<string, SessionView>;
// api.sessions(dir) -> SessionMap, vẫn là map trực tiếp, KHÔNG bọc {ok:...}.
// api.open(dir) thêm sessions: SessionMap.
// api.on('sessions-changed', (dir, sessions: SessionMap) => ...).
```

`sessions` chỉ chọn đúng context qua `agentSessionContext()` hiện có. Record không khớp CLI bị bỏ khỏi map; không có record thì agent không có key. Main dùng chung hàm dựng map cho open/IPC/event. Thêm callback nội bộ `core.run(..., {onSessionChanged: () => void})`: sau khi lưu ID đầu tiên hoặc lastTurn, main phát `sessions-changed`; không dùng callback này để ghi lại session. Reset/useSession và saveTeam thành công cũng phát event (cần tính lại threshold/pending). Chuyển worktree mode phải gửi lại map context đang chọn. Summary không ghi đè dữ liệu này.

FE T27:

- Trong mục agent của ⚙ mới: input number “Ngưỡng xoay phiên (token vào)”, min 0, step 1, mặc định 150000; trợ giúp “0 = tắt. Áp dụng cho lượt kế tiếp.” Agent tắt nhớ phiên vẫn giữ giá trị để dùng khi bật lại.
- Popup dùng nhãn **“Token vào lượt gần nhất: 200.000 / 150.000”**, thêm “Sẽ mở phiên mới ở lượt kế tiếp” khi pending. Khi limit=0 hiện “200.000 · Tự xoay: tắt”; chưa đo/null dùng “Chưa có số đo”, không thay bằng 0. Resume=false ghi “Không nhớ phiên”; không hiển thị trạng thái sắp xoay dù số đo cao.
- Tên “cỡ phiên” trong spec là proxy theo lượt; tooltip giải thích số CLI báo có thể cộng nhiều bước, không vẽ phần trăm context còn trống. `partial` có thể báo usage chưa đủ, không tự suy chi phí từ token.
- Cập nhật map/popup đúng `dir` và lần mở box; lời gọi `sessions()`/open có guard `openSeq` để không nhận response cũ. Nếu event đến khi đang mở box, buffer/replay như status để response open không ghi đè số đo mới. Event không làm reset draft hay render lại toàn bộ editor khi đang nhập. Sau thao tác thành công cập nhật từ response/event thực, giữ đúng cách báo lỗi của từng IPC.
- Picker phiên phải kiểm tra `record.id` trước khi chọn/hiện thông tin resume, vì có record chỉ chứa thống kê. Giữ bản sửa `cur` và các guard merge đã có. T24 không đổi IPC hay thêm logic xoay; T27 cắm field vào layout T24 đã bàn giao.

## 7. Phân công và kiểm chứng

**T26 / BE:** `core.js` — cấu hình, lastTurn/rotation trong run, handoff prompt/parser/I/O và K3; `main.js` — truyền runId/trackSession, lưu handoff sau audit, tin xoay phiên, SessionMap/event. `preload.js` không cần thêm method vì event subscription đã generic. Không đổi adapter CLI flags hoặc phạm vi ghi của CLI.

**T27 / FE:** `index.html` — sau T24, thêm cấu hình và dữ liệu popup theo mục 6. BE/FE dùng đúng tên field ở đây, bàn giao PM; PM nhận đủ T24/T26/T27 mới gọi **T28 / QA**. Không tự chuyển task sang done khi merge.

**T28:** thêm ca hành vi vào `check.js`, tái dùng CLI giả và repo Git tạm; không cần gọi model thật để nghiệm thu tự động:

| Nhóm | Ca bắt buộc |
|---|---|
| Config | Thiếu field →150000; 0 giữ nguyên qua save/load; sửa từng agent độc lập; payload cũ không làm mất ngưỡng; âm/lẻ/chuỗi/null bị từ chối |
| Rotation | 150000 không xoay, 150001/200000 xoay ở lượt kế; argv resume ID không còn ở lượt mới; memory/summary/chat/task/handoff có trong prompt fresh |
| Retry/usage | Empty retry và command loop giữ ID; 80k+80k chỉ xoay sau khi kết thúc; input=null không đoán; input có thật/cost=null vẫn so ngưỡng; tổng usage không bị đếm lần hai |
| Session/cost | Claude fresh baseline=0; lỗi mở mới trước ID giữ record cũ; restart đọc lastTurn; đổi ngưỡng trước lượt tới; reset/adopt/đổi CLI không dùng số đo ID cũ |
| Isolation | Hai agent cùng CLI và root/worktree riêng không xoay nhầm nhau; summary PM không chạm phiên/lastTurn/handoff thường; resume=false có K4 nhưng không resume/auto-rotate; orphan vẫn chặn lượt mới |
| Handoff | Success 3–5 dòng được lưu và nạp fresh; cùng task-status xử lý cả hai; run-command+handoff bị từ chối; thiếu/sai/quá lớn/lặp/nested/Stop/error không ghi đè bản tốt; @ trong body không route; symlink và workspace sai bị chặn; không tính handoff là tiến triển J |
| Tasks | PM chỉ thấy task chưa done + đúng N; non-PM đếm/lọc đúng assignee; toàn bộ done/board.error; full board và validator không mất task đã xong |
| UI | Thực thi handler mở/lưu ⚙, không chỉ grep HTML; popup 200k/ngưỡng, 0/null/partial, reset và ID mới; đổi box lúc promise chờ; giữ mọi chức năng T24 |

Chạy `npm run check` sau implementation; đây là thiết kế, chưa phải kết quả nghiệm thu K1–K4. Sau gộp code cần khởi động lại Electron để nạp main/core rồi thử tay ⚙ hai bên và popup. Thay đổi trong T25 chỉ gồm tài liệu và một dòng memory chung.
