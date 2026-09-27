# Sprint 1 — Interface và thiết kế thực hiện

Tech Lead · 2026-09-26 · Theo [sprint-1.md](sprint-1.md). Phạm vi đã chốt: Dừng + timeout, tiến độ trực tiếp, token/chi phí/thời gian mỗi lượt và tổng box. Đây là tài liệu bàn giao; chưa sửa hoặc nghiệm thu code.

## 1. Quyết định kiến trúc

Giữ luồng `index.html → preload.js → main.js → core.run → CLI`. Mở rộng IPC và adapter `CLI` có sẵn; dùng `AbortController`, `readline`, `crypto.randomUUID` của Node. Không thêm SDK, thư viện, worker hoặc cơ sở dữ liệu.

- `core.js`: parse stream, điều khiển tiến trình, giữ session, chuẩn hóa kết quả.
- `main.js`: hàng đợi theo `(dir, agent.name)`, lượt đang chạy, timer, IPC, ghi log và route.
- `preload.js`: thêm `stop`; giữ cách đăng ký `api.on` hiện tại.
- `index.html`: nút Dừng, timeout trong ⚙, dòng tiến độ, usage và tổng box.
- `check.js`: QA bổ sung kiểm tra với dữ liệu giả, không gọi dịch vụ AI.

Hai hướng còn lại không chọn: polling không cung cấp bước trực tiếp; chuyển sang SDK/process chạy thường trực làm đổi cơ chế phiên và triển khai nhiều hơn yêu cầu. Giữ một process cho một lượt.

Đã đọc toàn bộ `core.js`, `main.js`, `preload.js`, `index.html`, `check.js`; `core.run` hiện chỉ có caller trong `main.ask`, `CLI.parse` còn được gọi trong `check.js`. Hiện `run` thử phiên mới sau **mọi** lỗi: cần bỏ retry rộng này để Dừng/lỗi không chạy lại công việc. Phiên hết hạn báo lỗi và dùng thao tác chọn/làm mới phiên có sẵn trong ⚙.

## 2. Contract FE ↔ BE

Các tên dưới đây là contract chốt cho hai dev; chữ ký dùng để mô tả JS, không yêu cầu chuyển TypeScript.

```ts
type Usage = {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  durationMs: number;
  partial: boolean;
};

type ActiveRun = {
  name: string;
  runId: string;
  label: string;
  stopping: boolean;
};

type Outcome = 'success' | 'stopped' | 'timeout' | 'error';

// Giữ from/text/at của log cũ. Các trường mới chỉ có ở kết quả một lượt.
type TurnMessage = {
  from: string;
  text: string;
  at: string;
  runId: string;
  agent: string;
  cli: string;
  outcome: Outcome;
  usage: Usage;
};
```

`runId` là UUID mới khi lấy việc ra khỏi queue, **khác session ID**. `cli` ghi đúng tài khoản, ví dụ `codex2`; parser chọn từ `account(cli).bin`. Mỗi lượt có đúng một terminal message, kể cả dừng, quá giờ hoặc lỗi.

| API / channel | Chữ ký và ý nghĩa |
| --- | --- |
| `api.stop` / IPC `stop` | `stop(dir, name, runId) → Promise<{accepted: boolean}>`. Chỉ tác động lượt đang chạy khớp cả ba giá trị. |
| `api.open` / IPC `open` | Trả `{log, team, active: ActiveRun[]}`. Bổ sung snapshot RAM để đổi box/Cmd+R vẫn có nút Dừng và bước hiện tại. |
| `status` | `api.on('status', (dir, name, on, runId) => …)`. Giữ ba tham số đầu, thêm `runId`; `on=true` trước chạy và `false` khi đã thu dọn. |
| `progress` | `api.on('progress', (dir, name, {runId, label}) => …)`. Chỉ cập nhật bước mới nhất, không ghi log. |
| `usage` | `api.on('usage', (dir, name, {runId, usage}) => …)`. Phát đúng một lần sau khi lưu terminal message, kể cả lỗi/dừng. Đây là thông báo số liệu kết thúc, không phải một tin chat mới. |
| `message` | Giữ `api.on('message', (dir, msg) => …)`. Terminal message mang usage; đây là nguồn duy nhất để cộng tổng và hiển thị lịch sử. |
| `saveTeam` | Giữ chữ ký, thêm `agent.timeoutMinutes?: number`. Thiếu → 30; giá trị nhập phải là số nguyên 1–1440. |

Thứ tự thông thường: `status(true) → progress* → ghi log → message → usage → status(false)`. Nhánh dừng cũng giữ thứ tự này. Không cộng usage lần nữa khi nhận event `usage`.

`accepted=true` nghĩa là BE đã nhận yêu cầu dừng, không khẳng định tiến trình đã chết. Bấm lặp cùng lượt đang dừng vẫn trả true nhưng không tạo timer hoặc message thứ hai. Không có lượt/đã xong/`runId` cũ → false, không dừng lượt kế tiếp. Lỗi tham số hoặc lỗi quyền điều khiển trả IPC error; FE hiện lỗi và giữ trạng thái thật.

BE kiểm tra sender là cửa sổ app, kiểu các tham số và tra đúng active entry; không nhận PID hoặc câu lệnh từ FE. Dùng khóa `dir + '\0' + name` ở cả hai phía, thay cách nối `dir + name` hiện tại.

## 3. Một lượt, Dừng và timeout

Interface nội bộ tối thiểu:

```ts
core.run(dir, agent, { signal, onProgress })
  // Promise<{ outcome: Outcome, text: string, usage: Usage }>
  // onProgress(label: string); signal.reason: 'stopped' | 'timeout'
```

Các lỗi vận hành dự kiến như spawn thất bại, CLI lỗi, output không hợp lệ được chuẩn hóa thành `outcome='error'`. `main.ask` vẫn có `catch/finally` cho lỗi ngoài dự kiến, để queue không bị rejected vĩnh viễn và luôn dọn trạng thái.

1. Khi đến lượt: tạo `runId`, controller và active entry, nhãn `đang khởi động…`; bắt đầu timer theo timeout của agent. Thời gian chờ queue không tính vào timeout hoặc `durationMs`; cấu hình chụp lúc bắt đầu lượt. BE đọc lại timeout đã lưu lúc lấy việc ra chạy để thay đổi trong ⚙ áp dụng cho lượt kế tiếp.
2. `stop` đánh dấu `stopping=true`, nhãn `đang dừng…`, rồi abort với reason `stopped`. Timer làm cùng việc với reason `timeout`. Lý do đến trước được giữ; kiểm tra signal trước spawn và trong xử lý kết quả để không bỏ sót dừng sát lúc khởi động/kết thúc.
3. Bản build hiện nhắm macOS: spawn với `detached:true`, vẫn giữ pipe stdout/stderr và stdin đóng; gửi `SIGTERM` cho process group riêng qua `process.kill(-pid, …)`. Sau 1 giây, nếu group còn sống, gửi `SIGKILL`; không dùng `pkill` theo tên CLI. Node hỗ trợ process group riêng trên POSIX với `detached`. [Node child_process](https://nodejs.org/api/child_process.html#optionsdetached).
4. Chỉ settle lượt sau khi đã xử lý đóng process và dọn group; group con có thể còn sống dù process cha đã exit, nên không hủy bước kiểm tra/kill chỉ vì cha đóng. `ESRCH` là đã hết process; lỗi khác phải được báo, không giả báo dừng thành công. Đích nghiệm thu là không còn CLI/process con của lượt sau tối đa 2 giây.
5. Sau khi abort được chấp nhận, bỏ câu trả lời đến muộn; không route mention từ phần đã nhận. Main post từ `system`: `@<name> đã bị dừng` hoặc `@<name> quá giờ`, kèm metadata/usage. Lỗi khác cũng là system message; chỉ `outcome='success'` mới gọi `route`.
6. `finally` xóa timer/listener, active entry và phát status false đúng runId. Giữ nguyên các việc đã xếp hàng; lượt kế tiếp được bắt đầu sau khi lượt này thu dọn xong. Agent khác và box khác không bị tác động.

Timer và logic kill dùng chung cho Dừng/quá giờ. Không truyền `signal` thẳng vào `spawn` rồi chỉ dựa vào kill PID cha. Không dùng `child.killed` làm bằng chứng đã hết process. Dừng không hoàn tác file đã sửa; khôi phục file thuộc tính năng diff/undo ngoài sprint.

Nếu có CLI/tool tự tạo process group khác, QA phải phát hiện qua kiểm tra process con; BE xử lý trước nghiệm thu, không chấp nhận còn tiến trình nền ghi file. Không mở rộng Windows trong bản build macOS này.

## 4. Giữ phiên khi bị ngắt

- Đọc ID ngay khi stream công bố: Claude init `session_id`, Codex `thread.started.thread_id`, agy init `conversation_id`. Với agent bật nhớ phiên, ghi ID sớm vào `sessions.json`, không chờ câu trả lời cuối.
- Phiên cũ: trước khi lượt thành công, giữ nguyên `seen` và `adopted`; không xóa phiên khi dừng/quá giờ/lỗi. Nếu chết trước event init, vẫn giữ ID cũ. Phiên mới đã nhận ID nhưng chưa thành công lưu `seen:0, adopted:true` để lần sau gửi đủ bối cảnh nhóm.
- Thành công: cập nhật `seen` bằng độ dài log đã chụp **trước lúc tạo prompt**, giống ý nghĩa hiện tại; bỏ `adopted`. Không dùng độ dài log lúc kết thúc vì có thể có tin mới chưa được đọc.
- Tắt nhớ phiên (`resume:false`) giữ hành vi hiện tại: không đọc/ghi session của lượt đó. Đổi tài khoản vẫn không dùng ID của CLI khác.
- Chặn `useSession`, `resetSession` trên agent đang chạy; reset-all từ chối nếu box có lượt đang chạy. Trong `saveTeam`, chặn đổi tên/xóa/đổi CLI/đổi resume của agent đang chạy; vẫn cho lưu role/model/effort/timeout cho lượt sau. FE hiển thị lỗi BE ngay trong ⚙. Tránh người dùng đổi phiên rồi kết quả đến muộn ghi đè lựa chọn.

Không tự mở phiên mới sau lỗi resume. Nếu CLI thật sự xóa/mất phiên, báo lỗi để người dùng dùng điều khiển phiên có sẵn. Không thể bảo đảm giữ phiên mới nếu CLI chưa tạo/công bố ID trước khi bị dừng; không bịa ID hoặc lấy phiên gần nhất của tài khoản.

## 5. Parse stream của ba CLI

Giữ adapter trong `CLI`; không tạo framework parser. Đề xuất `CLI[bin].event(event, state)` xử lý từng object vào state riêng của lượt; `CLI[bin].parse(stdout)` dùng lại reducer đó để QA kiểm tra batch output. Parser batch trả `{id, text, usage, error}`; cập nhật các assertion hiện có theo contract mới, vẫn nhận JSON đơn của Claude/agy để đọc fixture cũ.

Đọc stdout bằng `readline.createInterface({input: child.stdout, crlfDelay: Infinity})` với UTF-8; xử lý cả dòng cuối không có newline. Không `JSON.parse` trực tiếp từng chunk. Bỏ dòng rỗng/noise/event chưa biết; event lỗi nhận diện được vẫn phải đánh dấu failure. Giữ stderr tail hữu hạn cho thông báo lỗi. Kết thúc không có terminal hợp lệ là lỗi output, không route một mẩu assistant text còn dang dở.

| CLI | Thay args | Session, tiến độ và kết quả |
| --- | --- | --- |
| Claude | `--output-format stream-json --verbose`; giữ model/effort/permission/resume | `system/init.session_id`; `assistant.message.content[]` có `tool_use`: tên tool và `input`; `result.result` là câu trả lời cuối. `result.is_error` hoặc subtype lỗi → error. Bỏ assistant của subagent khi chọn câu trả lời chính. |
| Codex | Giữ `exec [resume] --json` và flags hiện tại | `thread.started.thread_id`; `item.started/updated/completed`: command, file change, MCP tool; lấy `agent_message` completed cuối của lượt làm câu trả lời. Chỉ thành công khi có `turn.completed`; `turn.failed`/fatal `error` → error. |
| agy | `--output-format stream-json --print-timeout 0`; giữ mode/model/effort/conversation | Discriminator là **`event`**, không phải `type`. `init.conversation_id`; `step_update.step_update` có tool; `result.result` chứa `response`, `status`, `usage`. Chỉ `status='SUCCESS'` là thành công. |

Các trường Codex đối chiếu [events.ts](https://raw.githubusercontent.com/openai/codex/main/sdk/typescript/src/events.ts) và [items.ts](https://raw.githubusercontent.com/openai/codex/main/sdk/typescript/src/items.ts). Các envelope agy đối chiếu [Headless mode](https://antigravity.google/docs/cli/headless/). Claude output mode đối chiếu [Headless](https://code.claude.com/docs/en/headless) và help tại máy.

Nhãn tiến độ là plain text một dòng, tối đa 160 ký tự, không đẩy raw JSON/output file vào FE:

- Claude `Read` → `đọc <file_path>`; `Edit`/`Write` → `sửa <file_path>`; `Bash` → `chạy <command>`.
- Codex `command_execution.command` → `chạy …`; `file_change.changes[].path` → `đã sửa …` nếu completed thành công; tool lỗi dùng `lỗi …`. MCP → `gọi <server>/<tool>`. Không đoán tên file bằng cách parse shell tùy tiện.
- agy dùng `step_update.tool_name` hoặc `tool_info.name`; `run_command` đọc `tool_info.parameters.CommandLine`. Tool file đọc field đường dẫn mà bản CLI thực sự cung cấp; thiếu field thì chỉ hiện tên tool, không suy đoán từ text trả lời.
- Tool chỉ phát event sau khi xong phải hiện `đã …`, không giả là đang thực hiện. Assistant đang sinh câu trả lời → `đang trả lời…`; không có tool thì vẫn có bước này. Không hiện nội dung reasoning.

Chỉ phát progress khi nhãn thay đổi; sau abort chỉ giữ `đang dừng…`. File hiển thị tương đối với project nếu nằm trong project. FE dùng `textContent`. Các bước không đi vào `log.jsonl`, prompt, hoặc mention routing.

## 6. Usage và tổng box

### Quy ước chung

- Token là số nguyên không âm; cost là số hữu hạn không âm. Không ép chuỗi thành số; field thiếu/sai kiểu/âm → `null`, không phải 0. `durationMs` đo bằng đồng hồ đơn điệu từ bắt đầu lượt đến thu dọn, kể cả lượt lỗi.
- `inputTokens`/`outputTokens` giữ định nghĩa bộ đếm đầu vào/đầu ra của provider (`input_tokens`/`output_tokens`). Không cộng cache/reasoning lần nữa; tooltip số liệu ghi “Theo bộ đếm của CLI; cách tính cache có thể khác nhau”. Không suy ra USD từ model hoặc bảng giá.
- `partial=true` khi số liệu của lượt bị ngắt/chỉ thu được một phần hoặc không xác định được phạm vi số đếm. Cost không được provider hỗ trợ có thể là null dù `partial=false` và token đầy đủ.
- Với lượt dừng/lỗi, vẫn ghi usage vào **chính system message**; không tạo một agent reply giả. Chưa có bộ đếm đáng tin → token/cost null, thời gian vẫn có.
- Box cộng từng trường có số từ terminal messages trong log, kể cả system message có runId/usage. Tổng token là tổng các input/output đã biết. Lưu số gốc; chỉ làm tròn khi hiển thị.
- Nếu có agent message cũ thiếu usage, field null, hoặc partial thì tổng tương ứng phải ghi `đã ghi nhận`/`chưa đủ dữ liệu`. Box trống có tổng 0; box chỉ có dữ liệu thiếu hiện `—`, không giả $0. Không backfill lịch sử.

### Nguồn số liệu và chống cộng trùng

**Codex:** lấy `turn.completed.usage.input_tokens/output_tokens` cho lượt hiện tại. Cached/reasoning là breakdown, không cộng lại. Chưa có terminal usage thì để null; không suy ra từ độ dài text. USD null nếu CLI không báo giá. [Codex event schema](https://raw.githubusercontent.com/openai/codex/main/sdk/typescript/src/events.ts).

**agy:** cộng usage của các step hoàn tất thuộc lượt mới, thay snapshot theo `(conversation_id, step_index)` để event lặp không cộng hai lần. Lấy ranh giới lượt ở `user_input` mới; không cộng step lịch sử khi resume. `result.usage` có thể cộng dồn, nên chỉ dùng trực tiếp khi biết đó là phiên mới; nếu thiếu ranh giới/số step thì để null/partial. Không cộng thêm result vào tổng step. [agy stream và scope counters](https://antigravity.google/docs/cli/headless/).

**Claude:** dùng `result.usage` cho token vòng chạy chính. Bản tại máy là **2.1.283**; từ 2.1.277, `total_cost_usd` khi resume gồm chi phí phiên trước. Phải lấy chênh lệch; không cộng raw total vào log. Assistant usage có thể lặp theo message ID và output còn tạm, nên không dùng để thay terminal output. [Claude cost tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking#accumulate-costs-across-multiple-calls).

Quyết định của app cho bộ đếm USD cộng dồn:

```ts
// Thêm vào session hiện có; checkpoint chỉ hợp lệ với đúng cli + id.
costCheckpoint?: { totalUsd: number };
```

1. Phiên do app tạo mới: baseline 0. Kết thúc có raw total hợp lệ: `costUsd = total - baseline`, lưu checkpoint mới cùng session.
2. Resume có checkpoint liên tục: lấy chênh lệch. Ví dụ hai raw total 0.10 và 0.16 → hai lượt 0.10 và 0.06, tổng box 0.16.
3. Phiên adopt/phiên cũ chưa có checkpoint, hoặc raw total nhỏ hơn baseline: lượt này cost null/partial, lưu raw total mới làm mốc cho lượt sau. Không tính tiền lịch sử ngoài box vào lượt hiện tại.
4. Bị kill/lỗi mà không nhận được total tin cậy: bỏ **checkpoint**, giữ **ID phiên**. Lượt kế tiếp chưa có baseline đáng tin thì áp dụng bước 3, không dồn phần tiêu thụ của lượt trước vào lượt đó. Agent tắt nhớ phiên dùng baseline 0 cho từng process.
5. Baseline chỉ hợp lệ nếu phiên được chạy liên tục qua app; thao tác adopt/reset/account switch xóa checkpoint. Nếu phát hiện phiên được dùng bên ngoài app hoặc counter scope không khớp, không đoán giá: null/partial và lập mốc lại.

Thiết kế nhắm phiên bản CLI tại máy. BE phải xác nhận bằng lượt mới + resume khi smoke test; nếu khác quy ước thì sửa adapter và fixture, không đổi schema FE. `costUsd` là ước tính do CLI báo, nhãn UI dùng `Chi phí CLI`, không coi là hóa đơn.

Ví dụ terminal message do app chuẩn hóa (số liệu minh họa):

```json
{
  "from": "dev-be",
  "text": "Đã cập nhật interface.",
  "at": "2026-09-26T16:00:00.000Z",
  "runId": "8959ab08-7f87-4903-a962-aec069bd1020",
  "agent": "dev-be",
  "cli": "codex2",
  "outcome": "success",
  "usage": {
    "inputTokens": 1200,
    "outputTokens": 240,
    "costUsd": null,
    "durationMs": 4200,
    "partial": false
  }
}
```

## 7. Ràng buộc FE

- Hai vị trí Dừng dùng cùng `(dir, name, runId)`: cột Thành viên và dòng tiến độ của từng agent. Sau bấm, khóa cả hai nút và hiện `đang dừng…`; false/error thì lấy lại snapshot, không tự giả hoàn thành. Chỉ status false đúng runId mới xóa lượt tương ứng.
- `.member` hiện là button để chèn mention. Đặt Dừng thành nút **cùng cấp** trong wrapper; không lồng button trong button. Có nhãn truy cập `Dừng <name>`, dùng được bằng bàn phím; vùng tiến độ dùng `aria-live="polite"`.
- Mở box hydrate từ `open.active`; giữ trạng thái theo cả dir và name. Đăng ký event một lần. Khi open đang chờ, buffer event của box và áp dụng sau snapshot; terminal message trùng runId chỉ thêm một lần. Bỏ kết quả open đến muộn nếu người dùng đã chuyển box.
- Usage hiện dưới từng message, kể cả message gộp header và system message kết thúc lượt. Ví dụ `Vào 1.200 · Ra 240 · USD — · 4,2 giây`; null hiện `—`, partial hiện `chưa đủ dữ liệu`.
- Header tính lại từ log khi mở box, rồi cập nhật từ message mới. `usage` event không tăng tổng; không lấy giá trị DOM đã format để tính.
- ⚙ thêm input number `min=1, max=1440, step=1`, nhãn `Giới hạn mỗi lượt (phút)`, mặc định 30. FE kiểm tra và BE kiểm tra lại; timeout mới áp dụng lượt sau. Giữ phong cách hiện có.

## 8. Bàn giao và nghiệm thu

| Người | Phần việc tiếp theo |
| --- | --- |
| dev-be | Sửa `core.js`, `main.js`, `preload.js` theo contract; xuất reducer/parser để QA gọi; xác nhận output thật của ba CLI và bàn giao FE sau khi interface sẵn sàng. |
| dev-fe | Sau BE: sửa `index.html` theo mục 2, 6, 7; xử lý log cũ và reload/đổi box. |
| qa | Sau FE: thêm assert vào `check.js`, chạy `npm run check`, kiểm tra tay và báo kết quả theo từng tiêu chí dưới đây. |

Các check cần có, gộp vào công cụ hiện tại, không thêm test framework:

1. Ba parser: stream bị chia giữa byte UTF-8/giữa dòng, nhiều dòng cùng chunk, dòng cuối thiếu newline, noise, event không biết, terminal lỗi dù exit 0, thiếu terminal, final text không lẫn tool/reasoning.
2. Usage: số 0 hợp lệ, null/field thiếu/âm, event lặp, step/result không cộng đôi; Claude raw totals 0.10 → 0.16 thành 0.10 → 0.06; adopt/stop mất checkpoint không biến thành tiền của lượt sau; agy resume không cộng lịch sử.
3. Dùng CLI giả chậm có process con để kiểm tra Dừng/timeout: group hết ≤2 giây, chỉ một terminal message, không retry hay route dù text từng nhận có mention. Thử bấm lặp và stop runId cũ khi lượt mới đã chạy.
4. Cùng agent có hai việc: dừng việc đầu rồi việc sau vẫn chạy; agent khác và box khác không bị dừng. Timer không chạy trong thời gian xếp hàng; spawn error không khóa queue. Kiểm tra validation timeout ở cả saveTeam và lúc chạy dữ liệu cũ.
5. Resume: đang dùng session S, dừng rồi lượt sau vẫn truyền S; phiên mới công bố ID trước khi dừng vẫn được giữ; `seen` không nhảy qua tin mới. Thử đổi/reset session lúc busy phải bị chặn.
6. UI: hai nút Dừng đúng agent, tiến độ xuất hiện trước kết thúc, không có progress trong log; reload/đổi box không mất active hoặc cộng trùng usage; log cũ mở bình thường; header sau mở lại khớp số gốc trong log.
7. Smoke test cả **Claude, Codex, agy** trên bản cài thật: công việc đọc file, chạy lệnh, câu trả lời không tool, một lượt resume, một lượt bị dừng. Ghi phiên bản và số đếm trước/sau; lưu fixture đã bỏ dữ liệu riêng tư. Không tuyên bố đã đạt chỉ từ dữ liệu giả.

Tech Lead chỉ tạo tài liệu trong `reports/`; chưa chạy agent thật hoặc sửa code. Các hạn chế cần giữ rõ khi nghiệm thu: usage có thể thiếu sau kill; không lấy được ID nếu CLI chưa công bố; process con thoát group phải được kiểm tra thực tế. Không có thay đổi nào cho khóa file/diff/kanban.

Dòng memory để PM nối khi bàn giao: `Sprint 1 interface: reports/sprint-1-design.md; stop theo runId, progress không lưu log, usage terminal là nguồn tổng box; Claude resume phải lấy chênh lệch chi phí.`
