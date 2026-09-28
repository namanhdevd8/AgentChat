# Sprint 8 — Contract quyền CLI theo agent

Tech Lead · T29 · 2026-09-28. Spec: [sprint-8.md](sprint-8.md). Chỉ làm P; T30 BE và T31 FE làm song song, PM nhận đủ rồi giao QA T32. Không thêm dependency, SDK agent, dịch vụ quyền hoặc thay CLI hiện có.

## 1. Chốt ý nghĩa quyền và các điểm cần đính chính

Mục tiêu là cho người dùng cấu hình quyền của **tiến trình CLI do app mở**, liên kết danh sách lệnh hiện có với Claude, và xử lý một lần từ chối bằng thao tác rõ ràng của người dùng.

- `allowedCommands` bị thiếu hiện được chuẩn hóa thành `['npm run check']`; **`[]` mới tắt app runner**. Nó không phải danh sách cấm/cho phép toàn bộ lệnh bên trong CLI.
- `acceptEdits` không có nghĩa cấm tất cả Bash; CLI có quyền mặc định, quyền từ cấu hình người dùng/dự án và chính sách quản trị. Codex trong workspace sandbox vẫn chạy được lệnh. Vì vậy không dùng câu “Để trống = agent không chạy được lệnh nào”.
- Phần “cờ giống hệt hiện tại” của spec được hiểu là **giữ chế độ mặc định**, không phải giữ nguyên toàn bộ argv: cấp thêm `Bash(...)` từ danh sách lệnh là thay đổi có chủ đích của Sprint 8. Codex được chỉ định rõ chế độ không chờ approval và trạng thái mạng.
- `--allowedTools` của Claude cấp thêm quyền tự thực hiện, không giới hạn danh mục công cụ. Không có cờ tương đương đã xác minh cho Codex/agy. Không chuyển quy tắc Claude sang cờ bịa đặt của CLI khác. [Claude CLI reference](https://code.claude.com/docs/en/cli-reference).

UI gọi mức `edit` là **“Mặc định (sửa file + lệnh đã cho phép)”**, tương ứng “Chỉ sửa file” trong spec; hai mức còn lại là “Tuỳ chỉnh” và “Toàn quyền”. Dòng giải thích theo CLI ở mục 7 tránh hứa mức cô lập mà app không thực hiện.

## 2. Dữ liệu agent và migration

Giữ `allowedCommands: string[]` là nguồn duy nhất cho app runner; giữ validator, giới hạn 20 lệnh, exact argv và `spawn` không qua shell của Sprint 5. Thêm một object trong `.chat/agents.json`:

```ts
type AgentPermissions = {
  mode: 'edit' | 'custom' | 'full';
  allowTools: string[];   // chỉ có ý nghĩa với Claude ở custom
  networkAccess: boolean; // chỉ có ý nghĩa với Codex ở custom
};
// Khi thiếu toàn bộ object:
const defaults = { mode: 'edit', allowTools: [], networkAccess: false };
```

`team()` chuẩn hóa để đọc; không ghi lại JSON chỉ vì mở box. `saveTeam()` giữ object cũ nếu payload không có thuộc tính, dùng default cho agent mới. Nếu có object thì yêu cầu đủ field, đúng kiểu, không nhận null/array hoặc mode lạ. Quy tắc sai do sửa file tay → `permissionConfigError` trên agent và chặn spawn cho đến khi sửa, không tự rơi về Toàn quyền. Khi lưu bỏ field lỗi tạm như `commandConfigError` hiện có.

`allowTools` tối đa 32 dòng, mỗi dòng 512 ký tự, trim, bỏ dòng trống ở FE, dedup giữ thứ tự; không chứa newline/control/NUL. Kiểm tra dạng `Tool` hoặc `Tool(pattern)` với tên công cụ hợp lệ và ngoặc cân bằng; chỉ hỗ trợ tập quy tắc CLI đã có, không dựng bộ matcher của riêng app. Quy tắc MCP phải có tên server và tool rõ ràng (`mcp__server__tool`, hoặc wildcard trong phần tool khi người dùng tự cấu hình); không nhận `mcp__x` mơ hồ hay `mcp__*`. CLI vẫn là nơi quyết định quy tắc có hiệu lực; báo lỗi của CLI nếu cú pháp/phiên bản không hỗ trợ. Ví dụ hợp lệ: `Bash(npm test:*)`, `Bash(git status)`, `WebFetch`, `mcp__github__get_issue`.

Ràng buộc theo `account(agent.cli).bin`, áp dụng cả tài khoản có hậu tố số:

| CLI | `edit` | `custom` | `full` |
| --- | --- | --- | --- |
| Claude | Cấp các lệnh chuẩn hóa từ `allowedCommands` | Cấp hợp của lệnh và `allowTools` | Bỏ hỏi quyền theo khả năng CLI |
| Codex | Workspace sandbox, mạng tắt | Workspace sandbox, mạng theo `networkAccess`; `allowTools` phải rỗng | Bỏ workspace sandbox |
| agy | Giữ `accept-edits`, dùng app runner khi cần | Không hỗ trợ trong bản đã kiểm tra; UI vô hiệu lựa chọn, BE từ chối | Cờ tự chấp thuận của agy |

Claude/agy yêu cầu `networkAccess:false`; Codex/agy yêu cầu `allowTools:[]`. FE khi đổi CLI xóa các field không tương thích và đưa mode về `edit`, hiển thị thay đổi trước khi lưu. Không tự chuyển Toàn quyền sang CLI/tài khoản khác. Dữ liệu JSON không tương thích bị lỗi rõ ràng, không âm thầm bỏ qua quy tắc. Giữ danh sách custom khi đổi mode trong **cùng CLI**, nhưng chỉ áp dụng nó ở `custom`.

## 3. Map argv và các đường chạy

Đã kiểm tra cục bộ bằng `--version`/`--help`: Claude **2.1.283**, Codex **0.157.0**, agy **1.2.12**. Chưa chạy yêu cầu AI thật với các quyền mới. T30 phải lưu fixture argv và T32 kiểm tra cả fresh/resume; CLI cũ báo cờ không hỗ trợ thì trả lỗi cấu hình, không tự nâng quyền để chạy được.

### Claude

- `edit/custom`: giữ `--permission-mode acceptEdits`; thêm `--allowedTools` khi hợp danh sách không rỗng. Mỗi rule là một phần tử argv, không nối thành shell string; prompt luôn ngay sau `-p` như hotfix trước, không để option variadic nuốt prompt. Giữ `--resume`, model/effort, `--add-dir` và account env.
- Từng lệnh `normalizeAllowedCommands()` cho ra `command` được cấp thành **`Bash(command)`**, không thêm `:*` hoặc `*`. Dùng thứ tự lệnh rồi custom, dedup. Ví dụ `npm run check` → `Bash(npm run check)`; không tự cấp `Bash(npm *)`.
- `full`: `--permission-mode bypassPermissions`, không thêm danh sách `--allowedTools`. Không dùng cờ bypass ở mode khác. Không thêm cờ xóa cấu hình người dùng hoặc vô hiệu chính sách quản trị.

Quy tắc Bash của Claude là phép khớp lệnh của CLI, **không thay validator exact argv của app runner**. Allowlist bổ sung không ghi đè mọi deny/hook/quy tắc quản trị. MCP wildcard chỉ nằm sau tiền tố server cụ thể. [Claude permissions](https://code.claude.com/docs/en/permissions).

### Codex

Truyền bằng `-c key=value` cho cả `exec` và `exec resume`, vì resume hiện không có option `--sandbox` riêng:

```text
edit:   -c sandbox_mode="workspace-write"
        -c approval_policy="never"
        -c sandbox_workspace_write.network_access=false
custom: như edit, network_access theo checkbox true/false
full:   -c sandbox_mode="danger-full-access"
        -c approval_policy="never"
```

Các dòng là các cặp argv, dấu nháy trong giá trị chuỗi TOML được giữ đúng; không qua shell. `approval_policy="never"` là không chờ người trả lời, không phải tự cho phép hành động vượt sandbox. `network_access` điều khiển mạng của lệnh trong workspace sandbox, không phải công tắc chặn API model hoặc mọi dịch vụ MCP. Không dùng `--dangerously-bypass-approvals-and-sandbox` thay chế độ mặc định. [OpenAI configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

Codex không nhận `Bash(...)`; nó đã chạy được lệnh trong sandbox. Danh sách `allowedCommands` vẫn có tác dụng với app runner, không giới hạn các lệnh native của Codex. Không sinh file exec-policy/rules trong sprint này.

### agy

`edit` giữ `--mode accept-edits`. `full` giữ cách gọi hiện tại và thêm **`--dangerously-skip-permissions`**, cờ có trong help cục bộ. Không có cờ allowlist công cụ hoặc bật mạng riêng trong help đã kiểm tra; FE ghi không hỗ trợ phần đó. Không tự thêm `--sandbox` hoặc đoán cú pháp `--allowedTools` cho agy.

### Tất cả đường spawn

Map quyền trong bộ dựng args dùng chung của `core.js`, không chỉ ở `main.ask()`: fresh, resume, fallback phiên chết, empty retry và đoạn sau `run-command` phải dùng cùng cấu hình đã chụp của job. Không chuyển mode giữa chừng. Chụp cả object/array quyền khi enqueue; cấm sửa quyền/lệnh/CLI của agent còn job hoặc orphan chưa xử lý như các guard scope hiện tại.

Job `kind:'summary'` phải **ghi đè quyền thành default + danh sách lệnh rỗng**, không thừa kế custom/full/network của PM; vẫn giữ `readOnly`, `trackSession:false` và đường summary hiện có. Đây không phải cam kết OS sandbox read-only mới. Không tạo nút cấp quyền cho job summary.

## 4. Parse từ chối và thông báo

Claude parser đọc `permission_denials` ở terminal `type:'result'`, cả success lẫn error. SDK chính thức có field này; không suy quyền từ câu văn của agent, stderr có chữ “permission”, lỗi HTTP 403 hoặc nội dung code fence. [Anthropic SDK ResultMessage](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/types.py).

Shape hỗ trợ của từng entry là `{tool_name, tool_use_id?, tool_input}`; chỉ nhận tên string, input object không phải array. Entry lạ vẫn có thể báo “CLI báo từ chối quyền nhưng không đủ thông tin”, tuyệt đối không sinh rule từ việc ép object thành string. Giới hạn 32 entry/lượt; input để suy rule tối đa 8 KiB/entry; vượt giới hạn chỉ báo rút gọn, không có nút tự cấp. Không lưu toàn bộ `tool_input` vào log/UI; chỉ giữ tên tool, rule suy được và nhãn an toàn.

`core.run()` trả thêm `permissionDenials: [...]` đã chuẩn hóa, gom các đoạn trong cùng runId, dedup theo tool + rule (hoặc tool_use_id khi không suy được). Giữ usage mọi đoạn như hiện tại. Nếu terminal rỗng **và có denial**, không chạy empty retry tự động; trả lời ngắn về việc bị từ chối. Không biến denial thành success giả, không mất `is_error`, Stop/timeout hoặc lỗi kill. Các lỗi không liên quan vẫn theo retry hiện tại.

Rule được gợi ý cho nút:

| Denial | Rule chính xác app đề xuất | Khi không đủ điều kiện |
| --- | --- | --- |
| `Bash`, `tool_input.command` qua được `normalizeCommand` | `Bash(command đã chuẩn hóa)` | Shell ghép lệnh, glob, quote, substitution hoặc input quá dài → mở Quyền để người dùng tự cấu hình |
| `WebFetch`, URL http/https hợp lệ, không credentials, hostname hợp lệ | `WebFetch(domain:hostname)`; UI ghi rõ cấp cho hostname, không chỉ một URL | URL lỗi → chỉ thông báo |
| Tên `mcp__server__tool` cụ thể | Đúng tên tool đó; UI ghi rõ áp dụng mọi lời gọi tool này | Tên thiếu phần/wildcard → chỉ thông báo |
| Tool khác, kể cả thao tác file | Không tự sinh quy tắc mở rộng | Hiện tên và lối mở mục Quyền |

Nếu rule chính xác đã có trong hợp quyền đang áp dụng, hoặc agent đang `full`, không đề xuất cấp lại: thông báo kiểm tra cấu hình CLI/deny/hook. Không tự tìm cách vượt chính sách ngoài app. Custom rule rộng do người dùng tự nhập vẫn được hiển thị đúng nguyên văn; app không tự đề xuất `Bash`, `WebFetch` toàn bộ hoặc MCP wildcard.

Sau audit/commit/terminal của lượt thường, main ghi **một** system message `kind:'permission-denied'` chứa các denial, `relatedRunId`, `agent`, `cli`, `workspaceId`; không chứa usage và không gọi `route` cho thông báo. Giữ kết quả/code/usage và quy tắc route success cũ của lượt; một denial không chứng minh toàn bộ công việc thất bại. Stop/timeout/orphan chỉ có thông báo, không có nút chạy lại. Không xử lý `@` bên trong nhãn/rule như lệnh gọi agent; render bằng text node.

## 5. IPC và vòng đời “Cho phép và chạy lại”

### Trạng thái nhỏ, không thêm kho yêu cầu quyền

Main giữ `pendingPermissions` trong RAM: tối đa **một yêu cầu mới nhất cho mỗi (canonical root, agent)**. Mỗi yêu cầu có UUID, source runId, CLI/account, workspaceId, generation của log, revision team, các rule/denial đã validate và bản tham chiếu yêu cầu đã kích hoạt lượt. Snapshot `trigger = {from,text,seq?}` khi `route()` gọi `ask()`; lưu trong job rồi pending, không lấy “tin user mới nhất” khi bấm nút. Caller không có trigger (summary/repair đặc biệt) không có nút retry trong Sprint 8. Không giữ cả prompt lớn; trigger vượt 32 KiB chỉ báo không thể chạy lại bằng nút, cho phép gửi yêu cầu mới.

Pending có hiệu lực sau job đã terminal và release, chỉ khi chưa có job mới của agent được enqueue; bị hủy khi agent có lượt mới, team revision thay đổi, đổi workspace/phiên, log đổi generation, hoặc app khởi động lại. Việc hủy theo revision của cả team cố ý đơn giản: lưu avatar cũng có thể làm nút cũ hết hiệu lực. Reload renderer trong cùng main process còn giữ được. Đây là giới hạn có chủ đích: `ponytail: pending chỉ ở RAM; thêm khôi phục bền vững khi có yêu cầu retry qua restart`. Log từ chối vẫn còn; UI cũ hiển thị “Yêu cầu đã hết hiệu lực; gửi lại yêu cầu để thử tiếp”. Không diễn giải lại log do agent có thể sửa thành lệnh cấp quyền có hiệu lực.

### Contract cho FE

```ts
type PermissionRequestView = {
  id: string;
  agent: string;
  cli: string;
  workspaceId: string | null;
  sourceRunId: string;
  denials: { id: string; tool: string; label: string;
             rule: string | null; canGrant: boolean; reason: string | null }[];
};
// open(dir) thêm teamRevision:string và permissionRequests:PermissionRequestView[].
// message permission-denied thêm permissionRequestId:string|null,
// denials giống view; đây là lịch sử, không là quyền thực thi.
// Event qua api.on():
// 'permissions-changed', dir, { requests: PermissionRequestView[] }
// 'team-changed', dir, { team: Agent[], revision: string }

api.grantPermissionAndRetry(dir, { requestId: string, denialId: string })
// apiCall envelope:
// { ok:true, runId:string, team:Agent[], teamRevision:string }
// { ok:false, error:{ code:string, message:string,
//                    permissionSaved?:boolean } }

api.saveTeam(dir, members, { expectedRevision: string })
// Đổi IPC từ array trực tiếp sang apiCall envelope:
// { ok:true, team:Agent[], revision:string } hoặc { ok:false,error:{code,message} }
```

`core.saveTeam()` giữ API nội bộ trả array để các caller/test hiện có không đổi. `teamRevision` là SHA-256 bytes file agents.json hiện tại, không ghi bộ đếm; tái dùng crypto và kiểu kiểm tra revision của project settings. T31 sửa caller duy nhất của `api.saveTeam()` và cả xử lý `ok:false`, không gán cả response vào `team`. FE luôn gửi revision đã đọc; draft cũ sau thao tác cấp quyền bị `CONFLICT`, tránh Save ghi đè quyền vừa cấp. Không có IPC nhận raw command, tool_input hoặc rule do FE tự dựng để tự động grant.

### Thao tác chính xác

1. Nút nằm cạnh **một rule** đã hiển thị đầy đủ, kèm “Lưu quyền này cho agent và chạy tiếp yêu cầu trước; có thể phát sinh chi phí một lượt”. Nếu nhiều denial, người dùng chọn từng cái, không có tự “cho phép tất cả”. Bấm nút là xác nhận cấp **rule đó**; không thêm hộp thoại xác nhận thứ hai cho rule thông thường.
2. Main dùng `validSender`, `knownProject`; tìm request trong RAM theo đúng root/id/denialId, không đọc rule từ renderer/log. Reserve request trước await để chặn bấm đôi. Kiểm tra lại agent/account, revision, workspace, log generation, agent không có job/orphan, rule còn hợp lệ; sau mỗi await kiểm tra lại trước khi ghi/enqueue. Không khớp → `EXPIRED`/`CONFLICT`/`BUSY`, không sửa file hoặc spawn. Guard enqueue của mọi caller phải tôn trọng reservation này cho đến khi grant chuyển sang job hoặc thất bại.
3. Lưu vào `permissions.mode='custom'`. Nếu trước là custom: thêm rule, dedup. Nếu trước là edit: dùng danh sách **chỉ gồm rule mới**, không kích hoạt các custom rule cũ đang bất hoạt. Giữ `allowedCommands` và scope nguyên trạng; không tự thêm lệnh bị từ chối vào app runner. Nếu đã full hoặc rule đã được cấp, trả lỗi có lý do, không tự tăng quyền.
4. Ghi agents.json atomic bằng helper hiện có, phát `team-changed`, vô hiệu pending và phát `permissions-changed`. Tạo **một job thường mới** cho đúng agent, runId/timer/usage mới; không sửa outcome/cost của lượt cũ. Tái dùng `ask`, locks, worktree, snapshot/audit, queue merge, Stop và limits. Một thao tác người dùng tạo chuỗi mới như `send`, đếm lượt retry đầu tiên và áp dụng giới hạn/chi phí hiện hành; không tự chạy lại khi vẫn bị từ chối.
5. Prompt retry được dựng bằng `promptIndexed()` bình thường (fresh/resume theo Sprint 7), sau đó thêm trigger đã chụp và chỉ dẫn “Quyền X vừa được cấp; kiểm tra trạng thái hiện tại và tiếp tục phần chưa xong của yêu cầu này”. **Không dùng `initialPrompt` thay thế briefing** như summary, không chỉ gửi một từ “thử lại”; session `seen` đã có thể tiến qua yêu cầu cũ. Không chạy thẳng lệnh bị từ chối, không phát lại task-status/run-command cũ, không route trigger để gọi cả nhóm. Không hứa mọi thao tác trước đó idempotent.
6. Đường ghi config và enqueue không chèn await không cần thiết; nếu setup/enqueue vẫn thất bại sau lưu thì báo `permissionSaved:true` với thông báo “Đã lưu quyền nhưng chưa chạy lại…”. Không nói đã chạy khi chưa có job; không hoàn tác quyền một cách im lặng. Pending đã dùng không sinh thêm job lần hai. Thao tác đã khởi động nhưng process crash không được tự phát lại khi mở app.

Các mã lỗi thống nhất: `INVALID_ARGUMENT`, `CONFIG_ERROR`, `CONFLICT`, `BUSY`, `EXPIRED`, `CANCELLED`, `UNSUPPORTED`. Lỗi thực thi job sau enqueue đi qua terminal hiện có.

## 6. Xác nhận Toàn quyền và ranh giới scope

Khi `saveTeam` chuyển agent chưa full sang full, thêm agent mới full, hoặc đổi CLI/account của agent full: **main** gọi Electron `dialog.showMessageBox`, chỉ lưu sau khi người dùng bấm xác nhận. FE không gửi `confirmed:true` để vượt kiểm tra. Cancel là lựa chọn mặc định/cancelId; hủy không lưu một phần team. Một hộp thoại liệt kê các agent/CLI bị thay đổi, root dự án và tác động. Lưu avatar khi mode full đã có không hỏi lại; tắt full không hỏi.

Trong lúc chờ dialog, không giữ giả định team còn như cũ: sau xác nhận đọc lại revision và guard job/orphan, rồi mới lưu atomic. Revision đổi → `CONFLICT`, không dùng xác nhận cho payload khác. Cả save thường lẫn grant dùng chung validator/guard cấu hình; không sửa `agents.json` bằng đường tắt bỏ qua guard.

Cảnh báo đỏ trong UI và dialog: **“Agent có thể chạy lệnh, dùng mạng và tác động tới file ngoài dự án theo quyền tài khoản máy. Phạm vi file của app không phải sandbox bảo vệ hệ điều hành.”** Diễn đạt riêng agy là bỏ hỏi quyền của agy, không hứa bỏ mọi sandbox ngoài app. Người dùng vẫn có thể bị chính sách CLI/tổ chức chặn.

`owns`, readOnly, source/metadata locks, cwd worktree và audit không đổi; full không cấp thêm scope trong prompt hay tắt audit. Các giới hạn này hiện kiểm soát phối hợp và phát hiện sửa file, **không chặn trước mọi Bash/native tool**. App runner vẫn chỉ chạy `allowedCommands`, kể cả full. Không sửa cấu hình toàn cục, project settings của CLI, hook, MCP server hoặc biến môi trường tài khoản. Nút grant không sửa cấu hình mạng/Toàn quyền của agent khác.

## 7. Giao diện T31

Giữ màn hình ⚙ hai bên T24; trong nội dung mỗi agent, gom mode, rule/network và danh sách lệnh vào nhóm **Quyền**, không thêm một modal cấu hình khác.

- Claude: custom hiện textarea một rule/dòng với ví dụ hợp lệ. Hiện các quyền Bash suy ra từ `allowedCommands` ở phần xem trước chỉ đọc; không lưu bản sao vào `allowTools`. Nhắc quy tắc này bổ sung cho cấu hình CLI sẵn có.
- Codex: custom hiện “Cho lệnh trong sandbox truy cập mạng”; không hiện textarea Claude. Ghi “Codex tự chạy lệnh trong sandbox; danh sách bên dưới chỉ áp dụng khi app chạy hộ”. Full vô hiệu checkbox nhưng hiển thị mạng không bị giới hạn bởi workspace sandbox.
- agy: custom bị vô hiệu kèm lý do không hỗ trợ danh sách công cụ; default/full vẫn chọn được. Danh sách lệnh là đường `run-command` hiện có.
- Label chung: “Lệnh được tự chạy (mỗi dòng một lệnh)”; helper **“Để trống: tắt lệnh do app chạy hộ. Claude cũng không được app cấp thêm quyền Bash từ danh sách này. Quyền CLI sẵn có và Toàn quyền vẫn áp dụng.”** FE không biến textarea trống thành default khi Save; danh sách thiếu trong dữ liệu cũ vẫn theo migration.
- Chọn full hiện cảnh báo ngay; xác nhận native ở lúc Lưu. Hủy giữ draft để sửa, không hiển thị như đã lưu. Lỗi cấu hình hiện tại chỗ; giữ draft khi save thất bại.
- Denial message escape toàn bộ nhãn/rule; nút grant chỉ bật khi `permissionRequestId` còn trong `permissionRequests`, denial `canGrant` và agent không busy. Button có trạng thái đang xử lý, bàn phím/focus rõ; thông báo không thể cấp tự động có nút mở đúng agent ở Quyền.
- Subscribe các event một lần, bỏ khi đổi box theo pattern sẵn có. Phản hồi IPC/event phải khớp dir và lần mở box trước khi cập nhật team, popup hay trạng thái nút. Draft đang mở mà nhận `team-changed` đánh dấu đã cũ, yêu cầu tải lại trước khi Save; không âm thầm đè nội dung đang sửa.

## 8. Phân việc và nghiệm thu T32

**T30 BE:** `core.js` (schema/normalize/argv/denials/retry context), `main.js` (guard, pending, IPC/event, native confirmation), `preload.js` (thêm API và sửa saveTeam). Không cần sửa package. **T31 FE:** `index.html`, dùng chính tên field/IPC ở mục 5. **T32 QA:** mở rộng `check.js` dùng CLI giả và mock Electron như hiện có; không gọi model trả phí hoặc chạy full thật để test.

Các ca bắt buộc:

1. Migration: thiếu permissions dùng default; thiếu commands vẫn `npm run check`, `[]` vẫn rỗng; payload cũ bảo toàn quyền; dữ liệu sai/CLI không hỗ trợ bị chặn, không mở quyền ngầm.
2. Claude fresh/resume: prompt ngay sau `-p`, rule có khoảng trắng và nhiều rule vẫn từng argv; command tự sinh chính xác, custom dedup, default không kích hoạt custom cũ, full chỉ sau lựa chọn hợp lệ. Tắt full trả đúng default/custom đã chọn. Kiểm tra command có dấu phẩy trong validator hiện tại không bị CLI hiểu thành rule ngoài dự kiến; nếu phiên bản không thể biểu diễn an toàn thì báo cấu hình, không nới rule.
3. Codex fresh/resume: sandbox/network/approval TOML đúng ở cả hai đường, full không lẫn workspace override; không có `Bash(...)`. agy default/full đúng cờ, custom bị từ chối. Kiểm tra account có hậu tố số và `--add-dir` vẫn đúng.
4. Summary không thừa kế full/custom/network; retry rỗng, fallback phiên chết, đoạn command không mất/chuyển quyền. App runner full vẫn từ chối lệnh ngoài danh sách.
5. Result success và error có denials; thiếu/sai kiểu/trùng/quá dài/chuỗi chứa HTML hoặc `@` không crash, không route, không XSS. Rỗng có denial không empty retry; rỗng không denial giữ một retry. Usage không cộng hai lần từ tin system.
6. CLI giả từ chối `Bash(npm test)` → message + pending → bấm cho phép → lưu custom một rule, spawn đúng một lượt cho cùng agent/workspace với trigger cũ. Hai click song song chỉ một job; custom cũ bất hoạt không được bật ké. Shell ghép lệnh/unknown tool không sinh rule rộng; WebFetch/MCP hiển thị đúng phạm vi được cấp.
7. Retry fresh do vượt 150k vẫn có memory/task/handoff và trigger; resume không bị mất yêu cầu vì seen đã tiến. Lượt cũ đã sửa file/task không bị rollback hay replay protocol. Không tự retry tiếp khi vẫn bị từ chối.
8. IPC giả agent/root/id, draft stale, log reset, workspace/CLI đổi, active/orphan hoặc restart main → không cấp/không spawn. Reload renderer còn pending hợp lệ; log lịch sử vẫn đọc được khi pending hết hạn. Nếu lưu quyền thành công mà enqueue lỗi, UI báo đúng trạng thái.
9. Full: Cancel không đổi file/không spawn; Confirm lưu đúng agent; đổi revision hoặc agent bắt đầu job trong lúc dialog mở bị chặn; sửa avatar của agent full không hỏi lại. Save draft cũ sau grant phải conflict. Đổi box giữa IPC không cập nhật nhầm box.
10. `npm run check` xanh, `git diff --check` sạch; thử tay ⚙, cảnh báo/Cancel/Confirm native và denial button bằng CLI giả trong Electron. Phân biệt kết quả mock và thử app thật trong báo cáo; không kết luận Toàn quyền đã chạy thật khi chỉ kiểm tra argv.

T29 chỉ thay tài liệu; chưa triển khai hay kiểm thử hành vi Sprint 8. Khi bàn giao T30/T31, PM đồng bộ các đính chính ở mục 1 vào tiêu chí sprint để QA không kiểm tra theo câu “cấm hết” hoặc yêu cầu allowlist đồng nhất trên ba CLI.
