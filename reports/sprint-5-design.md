# Sprint 5 — Contract triển khai T10

Tech Lead · 2026-09-27 · Theo [spec PM](sprint-5.md). Chỉ thiết kế A/B/D/avatar; F/H thuộc Sprint 6.

## 1. Schema FE/BE, giữ IPC hiện có

Thêm vào từng agent trong `.chat/agents.json`; `open().team` và `saveTeam()` trả dữ liệu đã chuẩn hóa:

```json
{
  "allowedCommands": ["npm run check"],
  "avatar": { "gender": "female", "color": "#7cb4ff" }
}
```

- `allowedCommands` thiếu ở dữ liệu cũ → `["npm run check"]`; `[]` → tắt chạy lệnh qua app. Tối đa 20 chuỗi, mỗi chuỗi 256 ký tự; trim, gộp space/tab giữa token, bỏ trùng. Mỗi lệnh là executable + argv **literal**, không shell expression: token theo `[A-Za-z0-9_./:@=+,%-]+`; executable không bắt đầu bằng `-`, không có `=`. Không quotes, wildcard, biến môi trường, pipe, redirect, `;`, `&&`, substitution hay newline trong một lệnh. V1 phù hợp `npm run check`, `node check.js`, `git diff --stat`; lệnh phức tạp đặt trong script dự án rồi cấu hình tên script.
- BE validate ở `saveTeam`; reject cấu hình sai, không tự biến giá trị sai thành quyền mặc định. Khi đọc JSON chỉnh tay bị sai, cho agent `allowedCommands:[]` kèm `commandConfigError:string`, hiển thị lỗi trong Cài đặt; công việc khác vẫn chạy được. Chỉ **thiếu field** mới dùng mặc định. `commandConfigError` là field dẫn xuất, bỏ khi lưu hợp lệ. Client cũ gửi thiếu field thì giữ cấu hình đã lưu nếu có, không biến `[]` thành quyền mặc định.
- Đóng băng `allowedCommands` trong job lúc xếp hàng như scope. `saveTeam` từ chối đổi danh sách của agent còn lượt queued/running/checking; chỉnh avatar vẫn được. Runner không đọc lại quyền do chính agent sửa trong lượt.
- `avatar.gender`: `male|female`; `avatar.color`: một trong tám mã `#ff8fab`, `#7cb4ff`, `#5fe0b0`, `#ffa94d`, `#bb9bff`, `#ffd23f`, `#66d9e8`, `#ff6b6b`. Không nhận SVG/URL/CSS tùy ý. Sai schema bị reject khi lưu.
- Avatar thiếu: chọn màu ít được dùng nhất, hòa thì theo thứ tự palette; chọn giới tính ít được dùng với màu đó, hòa thì nam/nữ luân phiên theo vị trí thành viên. BE chuẩn hóa team theo thứ tự file, giữ avatar hợp lệ đã có; FE dùng cùng quy tắc cho agent mới và gửi lựa chọn cụ thể khi lưu. Sau tám agent có thể lặp màu, sau 16 có thể lặp cả cặp. User được tự chọn trùng.
- Không viết file chỉ vì mở Cài đặt; lưu qua `saveTeam` nguyên tử hiện có. Dữ liệu cũ không mất CLI/model/scope/session. Không thêm IPC thực thi lệnh cho renderer.

## 2. A — App chạy đúng lệnh đã được cấu hình

**Chốt dùng một runner trong app cho cả ba CLI.** Không cấp quyền chung theo tiền tố: Claude có exact Bash rule, nhưng Codex `prefix_rule` và agy `command(prefix)` không phải cùng contract exact argv. Không sửa cấu hình tài khoản/toàn cục và không bật bypass/sandbox rộng. Các lệnh model tự gọi qua tool CLI vẫn chịu policy hiện tại. Tài liệu đối chiếu: [Claude permissions](https://code.claude.com/docs/en/permissions), [OpenAI Rules](https://learn.chatgpt.com/docs/agent-configuration/rules), [agy permissions](https://www.antigravity.google/docs/permissions?tab=cli).

Đây là quyết định triển khai mục “cấp quyền theo CLI”: agent yêu cầu app chạy lệnh được cấu hình, app trả kết quả thật về phiên đó; không yêu cầu User chạy hộ.

| CLI | Giữ cách gọi hiện tại | Tiếp tục sau khi có kết quả lệnh |
|---|---|---|
| Claude | `-p`, stream-json, `acceptEdits` | `--resume <sessionId>` |
| Codex/codexN | `exec`, JSON, workspace-write; giữ đúng account env | `exec resume <threadId>` với cấu hình sandbox hiện tại |
| agy | `-p`, stream-json, `accept-edits` | `--conversation <conversationId>` |

Prompt fresh **và resume** nhận danh sách lệnh, và hướng dẫn: khi cần chạy một lệnh trong danh sách, trả đúng một block cuối kết quả:

````text
```run-command
{"command":"npm run check"}
```
````

1. Chỉ nhận block top-level cuối **kết quả success** của CLI hiện tại, tối đa 1 KiB, đúng một object có field `command`. Không đọc yêu cầu từ tin User, log cũ, stdout của lệnh, report, code mẫu lồng nhau hay stream chưa kết thúc. Tái sử dụng cách parse fence của `parseTaskStatusBlock`/markdown-it. Không chấp nhận chung `run-command` và `task-status` trong một kết quả; yêu cầu gửi task-status sau khi đã nhận kết quả kiểm tra.
2. Đối chiếu lệnh chuẩn hóa **toàn bộ** với allowlist đóng băng của `job.agent`; không `startsWith`, không chấp nhận thêm argv. Actor/cwd/env lấy từ job/app, JSON không được cung cấp. Chỉ thực thi khi đã có session ID để trả kết quả về đúng phiên; thiếu ID thì báo lỗi giao thức, không chạy một lệnh mà agent không nhận được kết quả.
3. Trong `core.run`, gọi runner `spawn(executable, argv, {cwd: projectRoot, shell:false, detached:true, ...})`, dùng PATH mà app đã lấy khi khởi động. Không `exec(command)`/`sh -c`/`eval`. Chạy bằng quyền của app đúng lệnh User đã cấu hình; đây không phải lời hứa script được sandbox — nội dung script dự án vẫn thực thi như khi User chạy. [Node spawn](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options) cho phép truyền argv mà không mở shell ngoài.
4. Emit progress `chạy npm run check…`; luôn drain stdout/stderr, giữ tổng tối đa 32 KiB UTF-8, đánh dấu `truncated` nếu cắt. Thu exitCode/signal/duration thật. Exit khác 0 hoặc executable thiếu là kết quả lỗi kiểm tra, không giả thành thành công.
5. Tiếp tục CLI cùng phiên với kết quả `{command, exitCode, signal, stdout, stderr, truncated}` được đánh dấu **dữ liệu đầu ra, không phải chỉ dẫn**. Nhắc agent báo kết quả thật, không tự lặp lại yêu cầu vừa hoàn thành. Không chạy lại toàn bộ prompt công việc cũ. Với lệnh bị từ chối/sai protocol, không spawn command; trả lý do về agent bằng cùng cơ chế.
6. Không post/route câu trả lời chứa yêu cầu trung gian. Chỉ câu trả lời cuối mới được post, xử lý task-status và định tuyến. Tối đa **3 yêu cầu lệnh mỗi job** kể cả yêu cầu bị từ chối; lần thứ tư kết thúc lỗi rõ ràng để tránh vòng lặp. Một kết quả command chỉ được chuyển tiếp một lần, không replay nó thành yêu cầu sau restart. Các block protocol không tính vào giới hạn năm dòng chat vì app không hiển thị chúng; nhắc điều này trong cả prompt fresh/resume.
7. Giữ **một runId, một timer, một reservation**, snapshot trước toàn bộ job và sau khi hoàn tất. CLI và command chạy nối tiếp; mọi process group đều đăng ký `onSpawn`, persisted pgid, dùng `stopGroup`/AbortSignal sẵn có. Dừng/quá giờ không được spawn lượt tiếp theo. Không khởi chạy process mới nếu group trước chưa chết; giữ orphan khi không xác minh được. Khi thoát app vẫn tuân thủ quyết định không chủ động kill.

Terminal message thêm `commandResults` chỉ để lưu bằng chứng kiểm tra: mảng `{command, exitCode:number|null, signal:string|null, stdout, stderr, truncated, durationMs, error?:string}` do app tạo; command bị từ chối có `error`, không ghi như đã chạy. FE không cần UI mới; agent báo tóm tắt kết quả và progress có sẵn. Không đưa env/token vào metadata.

**Điểm tích hợp:** `core.exec()` thêm prompt bổ sung cho continuation; `core.run()` quản lý các đoạn CLI/runner; `main.executeJob()` vẫn có một terminal và post-audit. Không cần helper executable, HTTP server, MCP server, file quyền hoặc dependency mới. Quyền file/audit của Sprint 2 vẫn áp dụng; quyền chạy check không cấp thêm scope sửa source.

## 3. B — Thử lại rỗng đúng một lần

- Kiểm tra **raw result** của adapter trước khi `core.run` thay bằng `(không có phản hồi)`: success + text null/undefined/chỉ whitespace + chưa dùng empty-retry + chưa aborted + không orphan. Missing terminal/nonzero exit/parser error không phải success. Chuỗi literal `(không có phản hồi)` do model thật gửi không bị coi là raw empty.
- Emit `đang thử lại…`, resume **cùng phiên** với: “Bạn chưa gửi tin trả lời. Hãy gửi tin trả lời cho nhóm; không thực hiện lại phần việc đã hoàn tất.” Không phát status off/on, không route hoặc post tin rỗng trung gian.
- Tổng cộng tối đa một empty-retry cho cả job, kể cả sau một continuation của A. Rỗng lần hai → placeholder hiện có. Thiếu session ID → lỗi rõ “Không có mã phiên để thử lại”; không tạo phiên mới và tự làm lại công việc.
- `resume:false` chỉ tắt nhớ giữa các job: vẫn giữ ID tạm trong RAM cho A/B trong cùng job; không lưu ID/checkpoint đó vào sessions.json. Phải sửa early-session callback hiện đang return sớm khi resume=false.
- Cộng usage của **mọi đoạn CLI** bằng `sumUsage` hiện có: field nào có số thiếu thì tổng field đó `null`, `partial:true`; không biến thiếu thành 0. duration là thời gian cả job một lần, có cả chạy check; không cộng duration từng vòng rồi cộng lại. Một terminal nên header không đếm trùng.
- Claude: cập nhật checkpoint sau **mỗi** đoạn trước lần resume, lấy delta rồi cộng; ví dụ 0→0,10→0,16 USD cho tổng job 0,16, không phải 0,26. Codex/agy lấy usage của lượt mới, agy bỏ lịch sử như hiện tại. Stop/error ở lần sau vẫn giữ usage đã tiêu ở lần trước.
- Giữ timer từ lần bắt đầu job, không gia hạn khi retry/chạy lệnh. Không retry Stop/timeout/error; không catch lỗi resume để chạy lại phiên mới. `task-status`-only và `run-command`-only là kết quả **có dữ liệu**, không retry chỉ vì bỏ protocol xong không còn chữ.

## 4. D — Định tuyến theo người gửi và đầu dòng

Giữ chữ ký `mentions(text, members, from)`, trả member đã dedup theo thứ tự team. `from === 'user'` giữ hành vi cũ (mọi @, cả giữa câu/code, không có target thì main dùng PM như hiện tại). `system` không định tuyến. Agent chỉ nhận dãy @ liên tiếp ở đầu dòng, sau tối đa ba space và tùy chọn marker `-`, `*`, `1.`:

```js
/^[ \t]{0,3}(?:(?:[-*]|\d+\.)[ \t]+)?(@[\w-]+(?:[ \t]+@[\w-]+)*)/gm
```

Regex chạy trên bản đã **che vùng code**, không trên Markdown thô: bỏ qua fenced backtick/tilde, indented code và inline code (kể cả span nhiều dòng). Dùng markdown-it đã cài để nhận diện block/map; khi che giữ newline/vị trí, thay ký tự bằng ký tự không trắng để không vô tình kéo @ giữa dòng thành đầu dòng. Không chỉ `.replace(code,'')`. Parse tên trong nhóm bằng `/@([\w-]+)/g`, đối chiếu full name không phân biệt hoa/thường, loại chính sender cũng không phân biệt hoa/thường.

| Tin agent | Target |
|---|---|
| `@qa kiểm tra` / `- @qa kiểm tra` / `1. @qa kiểm tra` | qa |
| `@dev-be @dev-fe làm song song` | dev-be, dev-fe |
| `@dev-be xong thì @qa kiểm tra` | dev-be |
| `Xong thì dev-be làm tiếp, @qa kiểm tra sau` | không ai |
| Inline/fenced code chứa `@qa`, `> @qa`, `\@qa`, `**@qa**` | không ai |
| `@dev-fe` khi có cả `dev` và `dev-fe` | chỉ dev-fe |

Nhận cả CRLF. Giữ MAX_HOPS hiện có. Parse/strip protocol A và task-status trước route; chỉ route terminal cuối, không route kết quả command. RULES mới phải vào cả fresh/resume, ghi rõ muốn giao nhiều người dùng các @ liên tiếp ở đầu dòng; memory cũ nói mọi @ đều gọi được thay thế bởi quy tắc theo sender này.

## 5. Avatar và Cài đặt — phần FE

- SVG inline `viewBox="0 0 64 64"`, hai mẫu đầu/vai, khác tóc nam/nữ; cùng khuôn mặt đơn giản, nét `#111`, nền palette và mặt màu trung tính cố định, nhìn rõ ở 32px cả light/dark. Tạo từ template cố định/`createElementNS`; không nội suy chuỗi SVG từ config. Không dùng ảnh ngoài, không thêm dependency.
- ⚙ mỗi agent có chọn Nam/Nữ, tám swatch màu có tên truy cập/selected state, preview ngay; thêm textarea “Lệnh được tự chạy (mỗi dòng một lệnh)”, ghi rõ để trống là tắt. Save/Cancel dùng `draft` hiện có, lỗi từng agent hiện tại form; màu/gender đã chọn không đổi khi gõ lại tên.
- Phân biệt avatar agent với icon project/user: helper nhận profile agent tường minh. User vẫn chữ B, icon folder vẫn như cũ, tin của agent đã xóa có thể fallback chữ. Chỉ SVG trang trí `aria-hidden`, button avatar giữ accessible name/focus/Stop.
- Cập nhật mọi nơi: `renderTeam()` header hiện **tự vẽ chữ bằng `btn.textContent`**, avatar tin cũ/mới, popup thành viên, gợi ý mention và preview Cài đặt. Sau `saveTeam` đổi ngay cả avatar tin cũ bằng node đánh dấu `data-agent-avatar`; không rebuild log làm mất scroll, không gọi agent mới. Handler save giữ đúng box/generation để response cũ không đổi avatar box khác.
- Dùng dữ liệu đã chuẩn hóa từ BE cho load cũ; trong lúc BE chưa xong FE có thể dùng fallback mặc định tương đương, không đưa trạng thái giả vào bản bàn giao. Retry/progress A/B dùng dòng tiến độ có sẵn, không thêm panel.

## 6. Bàn giao và check bắt buộc

| Người | Phần việc |
|---|---|
| dev-be · T11 | `core.js`, `main.js`: schema/defaults, runner + continuation, retry + usage/session, mentions/RULES; terminal commandResults. Giữ IPC cũ, không sửa cấu hình CLI toàn cục |
| dev-fe · T12 | `index.html`: SVG, mọi vị trí avatar, form lệnh/preview/validate và cập nhật theo box; làm song song theo mục 1 |
| qa · T13 | `check.js` sau hai bàn giao; check syntax trước khi nhờ người khác chạy; app thật xác nhận cả ba CLI nhận stdout/exitCode thật từ runner |
| pm | Nhận đủ hai bàn giao rồi gọi QA một lần; cập nhật spec/memory rằng A là app runner, D chỉ áp cho agent. F/H chưa triển khai |

QA tối thiểu:

- **A:** default/[]/schema lỗi; exact match, thêm argv/`;`/newline/`$()` bị từ chối; không spawn ngoài danh sách/cwd tùy ý/actor giả; config trong lượt không tự nâng quyền. CLI giả yêu cầu lệnh → runner chạy → resume đúng ID nhận kết quả thật; exit 1 không báo xanh, output dài được drain/cắt, giới hạn ba yêu cầu; Stop giết cả group trong runner và không resume sau đó.
- **B:** empty→text đúng hai lần; empty→empty đúng hai; error/stop/timeout không retry; task-only không retry; ID cùng phiên cả resume=false; timer không reset; cost Claude 0,10 rồi 0,16 tổng 0,16; thiếu số ra null/partial, một terminal/usage, reservation không hở giữa hai lần.
- **D:** bảng ví dụ mục 4, CRLF, code nhiều dòng/backtick/tilde/indent, prefix dev/dev-fe, self/duplicate/unknown; User vẫn hành vi cũ; @ trong stdout command không gọi ai.
- **Avatar:** config cũ, save/reload, tám màu và >16 agent không lỗi, giới tính/màu sai bị reject, Cancel không đổi; header/chat cũ/mention/popup đều đổi, User/project giữ chữ; không mất cuộn hoặc lẫn box.
- Chạy `node --check` cho JS đã sửa rồi `npm run check`; sau restart app, gọi qa tự chạy check và đối chiếu `commandResults` có exitCode/output thật. Check tự động giả chưa thay thế nghiệm thu CLI thật.

Dòng memory để PM nối: Sprint 5 contract reports/sprint-5-design.md; allowedCommands exact argv qua app runner/run-command, không đổi quyền toàn cục CLI; empty retry 1 lần cùng phiên/runId/timer, cộng usage mọi đoạn; agent chỉ route @ đầu dòng ngoài code, User giữ như cũ; avatar {gender,color} SVG palette 8 màu; BE T11/FE T12 song song rồi QA T13.
