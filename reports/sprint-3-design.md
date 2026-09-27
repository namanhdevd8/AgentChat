# Sprint 3 — Thiết kế và contract FE/BE

Tech Lead · 2026-09-27 · Theo [phạm vi PM](sprint-3.md). Tài liệu bàn giao triển khai, chưa phải kết quả nghiệm thu.

## 1. Quyết định kiến trúc

- Dùng lại Electron main/preload, renderer hiện tại và `markdown-it@15.0.2`; không thêm dependency, server hoặc database.
- Report mở trong một khung xem chỉ đọc của app. Chat và report dùng chung renderer Markdown; đường dẫn và quyền đọc được kiểm tra ở main.
- PM ghi **định nghĩa task** vào `.chat/tasks.json`. Main ghi **thay đổi trạng thái** vào `.chat/log.jsonl` sẵn có. Bảng là kết quả ghép hai nguồn này, không để PM và thao tác kéo thả cùng ghi đè một JSON.
- Agent gửi yêu cầu đổi trạng thái task của mình trong phần dữ liệu cuối câu trả lời; main kiểm tra danh tính từ lượt chạy và bỏ phần dữ liệu trước khi đăng chat/gọi agent khác. Áp dụng khi lượt **thành công** kết thúc; không suy diễn task đang làm từ trạng thái CLI.
- Bảng thay vùng Thành viên bên phải. Avatar header mở chi tiết, dùng lại `activeRuns`, `stopAgent(name, runId)` và `insertMentionAtCursor(name)`.
- Giữ quyết định không dừng agent khi thoát app, khóa/orphan của Sprint 2 và hành vi cảnh báo khi snapshot lỗi. Sprint này không bổ sung thu hồi câu trả lời khi app đã thoát.

### Điểm nối vào code hiện tại

| File | Tái sử dụng / thay đổi |
|---|---|
| `core.js` | `prompt` cả phiên mới/resume, `readLog`/`appendLog`, `files`, kiểm tra scope; thêm helper dữ liệu task và đọc file an toàn, export để QA test |
| `main.js` | `knownProject`, `validSender`, `resolveFile`, `terminal`, `post`; thêm IPC/watch, commit task trong đường terminal thành công |
| `preload.js` | Thêm các phương thức mục 4; không đưa `fs`, `shell` hoặc IPC thô vào renderer |
| `index.html` | `initMarkdown`, `renderMarkdown`, `bindLinkHandler`, `refreshFiles`, `renderTeam`, `renderActiveUI`, `openProject`; giữ cơ chế chống response cũ/đổi box |
| `check.js` | QA bổ sung kiểm tra contract; không cần thư viện test mới |

## 2. File task và quyền ghi

### 2.1. `.chat/tasks.json` — PM là người ghi

```json
{
  "version": 1,
  "tasks": [
    {
      "id": "T1",
      "title": "Khung xem report trong app",
      "assignee": "dev-fe",
      "spec": "reports/sprint-3.md",
      "createdAt": "2026-09-27T12:00:00.000Z",
      "updatedAt": "2026-09-27T12:00:00.000Z"
    }
  ]
}
```

- Đây là định nghĩa, **không có field `status`**. Task mới mặc định `todo`; trạng thái hiện tại lấy từ log. DTO ra FE luôn có đủ trạng thái/thời gian theo spec.
- `id`: `^T[1-9][0-9]*$`, duy nhất, tăng dần khi PM tạo; không tái sử dụng ID đã xóa. `createdAt` bất biến, dùng cùng ID nhận diện một task.
- `title`: chữ thuần, trim, 1–160 ký tự. `assignee`: tên agent, không có ký tự `@`; task mới phải giao cho thành viên hiện có. Agent bị xóa khỏi team sau này vẫn hiện tên trên task, không làm hỏng toàn bảng.
- `spec`: `null` hoặc đường dẫn tương đối trong dự án, tối đa 1024 ký tự, không scheme/đường dẫn tuyệt đối/đi ra ngoài root. Có thể chưa tồn tại khi tạo task; lúc bấm mở mới báo thiếu file. V1 chỉ nhận đường dẫn file, không URL ngoài.
- `createdAt`/`updatedAt`: ISO UTC hợp lệ. PM giữ `createdAt`, cập nhật `updatedAt` khi sửa tiêu đề/spec. Đổi người nhận chưa thuộc UI sprint này; muốn giao lại thì tạo task ID mới để tránh trạng thái/câu trả lời cũ áp vào người mới.
- Tối đa 1 MiB và 2000 task mỗi file. Duplicate ID, schema sai, field lạ hoặc sai kiểu: từ chối cả bản đọc, không nhận một phần.
- PM đọc bản mới nhất, giữ task có sẵn, ghi `.chat/tasks.json.tmp` rồi rename thành `.chat/tasks.json`. Không lưu một bản JSON cũ đã đọc từ lượt trước. Scheduler hiện có đảm bảo hai lượt PM không chạy cùng lúc.
- Chưa có file lần đầu: bảng rỗng hợp lệ; app không tự tạo task. Xóa hết task phải ghi `{ "version": 1, "tasks": [] }`. File từng tồn tại rồi bị mất/hỏng: báo lỗi và giữ bản tốt gần nhất trong phiên, không âm thầm xóa bảng hay ghi đè file để “sửa”.

### 2.2. Quyền và scope

| Chủ thể | Được làm |
|---|---|
| PM | Tạo/sửa định nghĩa trong `.chat/tasks.json`, dùng `.chat/tasks.json.tmp` để lưu nguyên tử |
| Agent được giao | Yêu cầu đổi `status` của task có `assignee === job.name`; không ghi trực tiếp tasks/log |
| End-User qua UI | Đổi trạng thái mọi task qua IPC |
| Main | Ghi metadata thay đổi trạng thái vào log; không sửa định nghĩa của PM |

BE thêm đúng **hai literal path** `.chat/tasks.json`, `.chat/tasks.json.tmp` vào scope PM mặc định và PM hiện có (`name === 'pm'`, so tên không phân biệt hoa/thường) nếu scope hạn chế chưa bao phủ chúng. Giữ mọi quyền khác; `owns:[]` vốn toàn dự án thì giữ nguyên, không biến thành scope chỉ được sửa task. Không thêm `.chat/**` hoặc task path vào tất cả agent: wildcard đó có thể khóa cả metadata và làm mất khả năng chạy song song.

Migration chạy trước khi spawn, nguyên tử và idempotent, có backup riêng `.chat/agents.json.pre-sprint-3.bak`; không ghi đè backup Sprint 2. Không migrate khi còn lượt/khóa orphan của PM có thể ghi config; chờ giải quyết theo cơ chế Sprint 2. PM readOnly hoặc scope chưa xác nhận: giữ cờ, báo cần chỉnh trong Cài đặt; không tự nâng quyền. Không sửa scope của techlead trong migration này. Team không có tên `pm`: không tự chọn một agent khác làm PM, hiển thị hướng dẫn thiết lập.

`tasks.json` vẫn được audit như file PM; chỉ temp task và backup migration được loại khỏi snapshot. `log.jsonl` đã là dữ liệu app được loại khỏi snapshot. Chính sách scope là cơ chế phối hợp/audit hiện có, không phải sandbox OS ngăn mọi CLI cố tình sửa ngoài quyền.

## 3. Trạng thái, concurrent update và giao thức agent

### 3.1. Dữ liệu FE nhận

```ts
type TaskStatus = 'todo' | 'doing' | 'review' | 'done';
type Task = {
  id: string; title: string; assignee: string; spec: string | null;
  createdAt: string; updatedAt: string;
  status: TaskStatus;
  revision: string; // opaque; FE/agent gửi lại nguyên giá trị
};
type TaskBoard = {
  tasks: Task[];
  error: null | { code: string; message: string };
};
type TaskChange = { id: string; status: TaskStatus; expectedRevision: string };
```

Map nhãn cố định: `todo` → Cần làm, `doing` → Đang làm, `review` → Chờ duyệt, `done` → Xong. Cho đổi giữa bất kỳ hai cột; không thêm workflow approval tự động. Thứ tự trong mỗi cột theo số ID tăng dần; không lưu thứ tự kéo card.

### 3.2. Lưu trạng thái trong log hiện có

Một message do main tạo có thể thêm `taskUpdates` như sau:

```json
{
  "from": "system",
  "text": "Bạn đã chuyển T1 sang Đang làm.",
  "at": "2026-09-27T12:05:00.000Z",
  "kind": "task-status",
  "taskUpdates": [
    {
      "id": "T1",
      "createdAt": "2026-09-27T12:00:00.000Z",
      "assignee": "dev-fe",
      "status": "doing",
      "eventId": "9ba89177-2bc2-42eb-ac06-a34af6300573"
    }
  ]
}
```

- UI drag: main `post` một system message trên, **không gọi `route`**, không có `runId`/`usage` nên không cộng thêm lượt/token. Không thêm `@` vào câu thông báo.
- Agent: gắn `taskUpdates` đã được kiểm tra vào **chính terminal message thành công**. Không phát thêm một message cùng `runId`, tránh bị dedup của FE loại bỏ hoặc cộng trùng usage. `from` là `job.name`, thời gian lấy từ main; không nhận actor/timestamp từ agent.
- Khôi phục bảng: đọc định nghĩa và duyệt log theo thứ tự append, lấy update mới nhất cho `(id, createdAt)`; chỉ dùng nếu người nhận khớp. Log cũ không có metadata vẫn hợp lệ. Không dùng thời gian để quyết định ai ghi sau.
- `revision` = SHA-256 của JSON mảng `[id,title,assignee,spec,createdAt,definition.updatedAt,lastEventIdOrNull]` với `spec` luôn chuẩn hóa về string/null. Cùng dữ liệu cho cùng revision kể cả restart; thay metadata hoặc trạng thái đều đổi revision. `updatedAt` hiển thị thời gian mới hơn giữa định nghĩa và event hợp lệ, chỉ phục vụ hiển thị.
- Task bị xóa thì log trạng thái cũ được giữ nhưng không tạo lại card. Cấm tái sử dụng ID; `createdAt` giúp tránh áp nhầm lịch sử nếu một file được sửa sai quy trình.
- Đọc log để dựng/ghi task phải có chế độ **strict**: JSONL hỏng không được rơi vào `readLog()` hiện tại trả `[]` khi lỗi rồi coi mọi task là Cần làm. Bổ sung `readLog(dir, {strict:true})` giữ nguyên default cho caller cũ; blank line bỏ qua, record task sai schema báo lỗi bảng. Không tự truncate log.

### 3.3. Chống ghi đè và xử lý lỗi

1. Main đọc định nghĩa và trạng thái mới nhất, validate request, đối chiếu `expectedRevision` từng task.
2. UI là actor `user`; agent là `job.name` do main cung cấp. Actor không lấy từ request, từ text tự xưng hoặc model-generated JSON. Chỉ UI và người nhận task được đổi trạng thái.
3. Đọc → kiểm tra → append log chạy nối tiếp, **không `await` chen giữa kiểm tra revision và append**. App đã single-instance. PM có thể rename định nghĩa đồng thời nhưng main không ghi đè file đó; event chứa danh tính task, chỉ áp vào task còn phù hợp.
4. Append thành công mới báo `ok`/phát refresh. Append lỗi thì không giữ thay đổi optimistic như đã lưu. Một batch agent là all-or-nothing; một task stale/sai quyền làm cả batch bị từ chối nhưng không mất câu trả lời của agent.
5. Hai cập nhật cùng revision: chỉ lần đầu được ghi; lần sau trả `CONFLICT` kèm bảng hiện tại. FE phục hồi trạng thái server và báo “Task đã thay đổi, hãy chọn lại”. Không tự retry với revision mới, vì như vậy sẽ ghi đè lựa chọn của người dùng.
6. Status đích đã giống hiện tại, revision vẫn đúng: no-op thành công, không thêm log. Revision cũ vẫn là conflict dù status giống nhau.
7. File hỏng/đang ghi dở: giữ bản tốt gần nhất để xem, trả `error`, khóa thao tác đổi status đến khi đọc được dữ liệu hợp lệ. Khởi động mới không có cache thì hiện lỗi, không giả thành bảng rỗng đã tải thành công. Lỗi task không ngăn agent chạy hoặc đọc chat.

`ponytail:` dựng task từ log đang được app đọc sẵn, không thêm event store hoặc cache framework. Nếu lịch sử đủ lớn gây chậm, bổ sung checkpoint riêng sau khi có số đo; không mở rộng trong Sprint 3.

### 3.4. Agent cập nhật task của mình

`core.prompt()` bổ sung danh sách task hiện tại của agent, có `revision`, ở **cả nhánh fresh và resume**. PM nhận thêm hướng dẫn file/mẫu tạo task. Nếu không đọc được bảng, ghi một dòng báo chưa cập nhật được task, vẫn chạy công việc chính.

Agent muốn đổi trạng thái thì thêm đúng một fenced block cuối kết quả, độc lập với chat tối đa 5 dòng:

````text
Đã hoàn tất khung xem, sẵn sàng kiểm tra.
```task-status
[{"id":"T1","status":"review","expectedRevision":"revision-da-nhan-trong-prompt"}]
```
````

- Đây là protocol nội bộ; main bỏ block khỏi `text` **trước** `post`, lưu chat và quét mention. Người dùng chỉ thấy câu trả lời thường và card đổi cột.
- Chỉ parse block `task-status` đứng riêng ở cuối **kết quả cuối cùng** của lượt success; không parse chunk tiến độ, tool output, report, lịch sử hay tin người dùng. Dùng parser Markdown sẵn có hoặc kiểm tra fence top-level rõ ràng; không regex lấy JSON bên trong blockquote/code mẫu khác.
- Tối đa 20 yêu cầu, 8 KiB cho payload, mỗi ID một lần; chỉ cho ba field của `TaskChange`. Không eval, không nhận đường dẫn hoặc lệnh shell.
- Malformed/thiếu fence đóng/sai quyền/conflict: không đổi task; giữ phần chat và thông báo ngắn lỗi cập nhật (không lộ payload), không biến lượt CLI thành lỗi. Không tự gọi agent để sửa vì dễ tạo vòng lặp.
- Stop/timeout/error: không áp yêu cầu kể cả đã có text hoàn chỉnh. Resume đọc revision mới. Replay cùng yêu cầu không thể ghi hai lần vì revision đã đổi; không parse lại log lúc mở app như yêu cầu mới.
- Trạng thái task không đồng nghĩa agent đang chạy. V1 lưu cập nhật của agent khi hoàn tất lượt; người dùng có thể kéo sang Đang làm bất cứ lúc nào. Chưa cần outbox file riêng, background command service hoặc tự đổi tất cả task khi spawn/stop.

## 4. Contract IPC để FE/BE làm song song

Tên exposed API và IPC trùng nhau. Mọi IPC mới dùng `validSender` + `knownProject`; main lấy root canonical, không tin renderer đã validate. API cũ `open/stop/openFile/openLink` giữ tương thích.

```ts
api.tasks(dir: string): Promise<TaskBoard>
api.setTaskStatus(dir: string, change: TaskChange): Promise<
  { ok: true; board: TaskBoard } |
  { ok: false; code: 'CONFLICT'|'NOT_FOUND'|'INVALID'|'DATA_ERROR'|'IO_ERROR';
    message: string; board: TaskBoard }
>
api.readProjectFile(dir: string, href: string, fromFile?: string | null): Promise<
  { ok: true; file: {
      path: string; // tương đối root, '/', dùng cho lần reload/watch kế tiếp
      name: string; format: 'markdown'|'text'; content: string;
      version: string; // SHA-256 nội dung, không dùng riêng mtime
      canOpenExternal: boolean;
    } } |
  { ok: false; code: 'INVALID_PATH'|'OUTSIDE_PROJECT'|'NOT_FOUND'|
      'UNSUPPORTED'|'TOO_LARGE'|'FILE_CHANGED'|'IO_ERROR'; message: string;
    file?: { path: string; name: string; canOpenExternal: boolean } }
>
api.watchProject(dir: string | null, file?: string | null): Promise<
  { ok: boolean; message?: string }
>
api.on('project-changed', (dir: string, changed: {
  tasks: boolean; files: boolean; file: string | null; error?: string
}) => void)
```

- `tasks()` luôn resolve lỗi dữ liệu thành `TaskBoard.error`; invalid sender/project vẫn reject IPC. `setTaskStatus` không nhận assignee/actor hoặc cả board để ghi đè.
- `readProjectFile` lỗi `UNSUPPORTED`/`TOO_LARGE` có thể trả `file` sau khi đã kiểm tra containment/type; cho giữ nút mở ngoài nếu policy cũ cho phép. Lỗi đường dẫn không trả metadata file ngoài dự án.
- `open()` không bắt buộc đổi shape. FE gọi `watchProject(d, null)` rồi `tasks(d)` trong quá trình mở box; task lỗi không làm hỏng hydrate log/team/runs của Sprint 1–2.
- `project-changed` chỉ **invalidation**, không mang snapshot để FE đua nhau ghi trạng thái. `tasks:true` khiến FE gọi `tasks`; `files:true` gọi `files`; `file` là đường dẫn file đang xem cần đọc lại.
- API `watchProject` chọn **một** box và tối đa **một** file đang xem cho cửa sổ; `dir:null` dọn hết, `file:null` chỉ ngừng theo dõi report đang xem. Lệnh gọi sau thay subscription cũ, setup đồng bộ theo thứ tự IPC.
- `api.on` có thể trả hàm unsubscribe, giữ tương thích caller cũ. FE đăng ký event một lần, không thêm listener mỗi lần đổi box.

## 5. Khung xem file và kiểm tra đường dẫn

### Đọc an toàn tại main/core

- Tách phần kiểm tra đường dẫn của `resolveFile` thành helper dùng chung; policy **read text** cho file trong toàn dự án, còn **open external** giữ allowlist Sprint 2. S2 hiện chỉ mở ngoài `reports/`/`.chat/` và vài extension; không copy nguyên hạn chế đó sang viewer vì spec yêu cầu xem cả `.js` dưới dạng chữ.
- `href` từ chat/File chung không có `fromFile`: tương đối root. Trong report, `roadmap.md`/`./roadmap.md` tính từ thư mục report; `reports/...`/`.chat/...` vẫn tính từ root. `../` được resolve nếu kết quả còn nằm trong root; ra ngoài root thì từ chối. Absolute path trong project được hỗ trợ cho link chat cũ.
- Decode URL một lần, kiểm tra lại sau decode; tách query/fragment trước decode. Reject control char, NUL, backslash, scheme lạ, `//`, path không hợp lệ. `fromFile` cũng phải là path hợp lệ trong project, không cho caller dùng nó làm base bên ngoài.
- Kiểm tra cả lexical containment và `realpath` containment bằng `path.relative` trên root canonical; không chỉ `startsWith(root)`, không tự lowercase toàn bộ đường dẫn trên filesystem phân biệt hoa/thường. Symlink trỏ ngoài root bị từ chối; phải là regular file. Không trả content ngoài root trong error.
- Dùng `original-fs` cho filesystem dự án trong Electron như snapshot đã sửa, không đổi `process.noAsar`; không coi file `app.asar` là cây thư mục của viewer.
- Đọc tối đa **2 MiB**, kiểm tra kích thước trước và giới hạn bytes thực đọc (file có thể lớn thêm). Dùng handle/fstat, đóng trong finally; kiểm tra lại file nếu thay thế trong lúc đọc, trả `FILE_CHANGED` thay vì gắn nội dung cho sai file. File chứa NUL/UTF-8 không hợp lệ hoặc binary trả `UNSUPPORTED`; không tải PDF/ảnh/HTML vào webview/iframe.
- `.md` → `markdown`, các file text khác kể cả `.js`, `.json`, `.html` → `text`. FE text bằng `pre.textContent`, không thực thi HTML/JS. UTF-8 BOM hợp lệ được bỏ.
- Nút “Mở bằng app ngoài” gọi `api.openFile(dir, file.path)` hiện có, kiểm tra lại đường dẫn ở main. Chỉ enable khi `canOpenExternal`; dạng chưa được policy ngoài hỗ trợ vẫn đọc text được trong app. Không nới `shell.openPath` để vô tình chạy file chương trình/script.

### Render và điều hướng FE

- Mở khung xem lớn bằng native `<dialog>` trong app, dùng màu/viền Neubrutalism sẵn có; tên/path, Đóng, Tải lại, Mở bằng app ngoài. Dùng `showModal()`, focus ban đầu vào Đóng, Esc đóng, trả focus về link/card mở nó. Nội dung cuộn riêng, đóng viewer không đổi vị trí chat.
- `renderMarkdown(text, context)`/`bindLinkHandler` nhận context `{dir, fromFile}` đóng theo box tại lúc render, không phụ thuộc biến `dir` toàn cục đã đổi. Giữ `html:false`, disable image, không thêm HTML plugin/highlighter.
- `validateLink` hiện chỉ cho `reports/`/`.chat/` nên **phải mở rộng** cho liên kết tương đối như `roadmap.md`, `../roadmap.md`, tên có dấu/space được URL-encode. FE chỉ phân biệt scheme; main là nơi quyết định path có được đọc. `http/https` gọi `openLink`, local gọi viewer; không để browser tự navigate. Chặn `javascript/data/file/vbscript` và scheme khác cả ở FE lẫn main.
- Chỉ dùng `innerHTML` cho output từ renderer an toàn. Task title, tên file, thông báo lỗi và text thường đều dùng `textContent`. File Markdown chứa `<img src=x onerror=alert(1)>` hiển thị chữ, không tạo phần tử ảnh.
- Không yêu cầu scroll tới heading anchor trong Sprint 3; fragment không được làm path ra ngoài project. Click link tương đối vẫn phải chuyển đúng file.
- Điều hướng file mới: loading/error nằm ở khung mới; không để nội dung cũ mang tên file mới. Auto reload file hiện tại: giữ scroll, nếu file mất/hỏng giữ bản đang xem với nhãn chưa tải lại được; không tự đóng dialog.

### Theo dõi thay đổi

- Main dùng `fs.watch`/`original-fs.watch` thư mục `.chat` (lọc tasks.json), `reports` cấp đầu (File chung), và thư mục cha của file đang mở nếu khác hai thư mục trên. Không watch/hash cả dự án, `dist/` hay `node_modules`.
- Watch **thư mục**, không inode của file riêng: editor/PM có thể lưu bằng rename. Debounce khoảng 150 ms; `filename` null thì invalidate các mục liên quan. Sau commit task trong main, chủ động invalidation task, không cần watch mọi lần log append.
- FE dùng `openSeq`, một request generation cho bảng và một generation cho viewer. Tăng generation ngay khi invalidate/drag/đổi file/đổi box, kể cả fetch đang debounce; response cũ không được ghi đè drag ACK/nội dung mới. Kết quả `setTaskStatus` cũng phải kiểm tra đúng box/generation; nếu đã stale thì fetch lại.
- Kiểm tra generation trước cả side effect đổi watcher, không chỉ trước render. `refreshFiles()` cũng capture `dir` lúc gọi và bỏ response cũ; handler của file giữ đúng box gốc, không đọc biến `dir` đã chuyển sang box khác.
- Sau đọc file lần đầu và thiết lập watcher cho file đó, đọc lại một lần để khép khe hở read→watch. Khi đổi box/đóng dialog/reload renderer, dọn watcher/timer cũ; background agent hoàn tất không được tự mở lại viewer/đổi box.
- Watch error: phát trạng thái cảnh báo, vẫn cho Tải lại thủ công. Có nút Tải lại bảng; đọc lại khi cửa sổ focus để khôi phục thay đổi bị bỏ sót. Khi render lại chỉ nội dung file/bảng bị đổi, không rebuild chat.

## 6. Kanban và avatar header

### Bảng task

- Thay section `#team` bằng `#tasks`, File chung giữ bên dưới. Sidebar hiện 290px quá hẹp cho bốn cột: dùng khoảng `clamp(320px, 34vw, 520px)`, nav co còn khoảng 220px khi cần; mỗi lane tối thiểu 150px và board có **scroll ngang riêng**. Không ép chat nhỏ đến mức mất ô nhập; màn hình hẹp dùng sidebar dạng panel mở/đóng nhưng vẫn giữ đủ bốn lane.
- Native HTML drag/drop cho desktop, đồng thời mỗi card có `<select>` trạng thái hoặc menu tương đương để dùng bàn phím. Không thêm thư viện DnD. Payload chỉ task ID; drop chỉ nhận task thuộc box đang mở. Cho board cuộn ngang khi kéo sát mép để tới cột ngoài màn hình.
- Card hiện ID, title, avatar/tên người nhận, updatedAt. Nội dung thuần text. Vùng mở spec là button riêng; control trạng thái không nằm trong button đó. Không có spec thì card không mở file. Drag xong không phát click mở spec.
- Chỉ một mutation pending mỗi task, disable control/drop của task đó đến khi trả lời. Có thể hiển thị trạng thái “Đang lưu”; xác nhận thành công mới chốt cột. Event/watch và ACK đều dựa trên trạng thái main, không lấy vị trí DOM làm dữ liệu. Giữ node đang drag/focus khi refresh hoặc hoãn render tới dragend; không làm mất card giữa thao tác.
- Empty: “Nhờ PM tạo task khi giao việc.” Loading và lỗi dữ liệu khác empty. Bảng lỗi vẫn giữ card cache với cảnh báo/khóa thao tác, không xóa task trong file.
- Board/viewer/popover update không gọi auto-scroll chat; giữ `withPreservedScroll`, giới hạn ô nhập 1/4 box và gợi ý mention của Sprint 2.

### Chi tiết thành viên

- Avatar là `button type=button`, có tên truy cập, `aria-expanded` và `aria-controls`; click cũng mở được ngoài hover/focus. Một popup đang mở tại một thời điểm, không dùng tooltip role cho nội dung có nút.
- Popup là vùng tương tác riêng, không lồng nút Stop/@ trong button avatar. Hiển thị CLI, model/effort (rỗng → Mặc định), vai trò, owns/readOnly; `owns:[]` + không readOnly phải ghi “Toàn dự án”, không ghi nhầm chưa có quyền. Giữ cảnh báo scopeNeedsReview.
- Hover từ avatar xuống popup không đóng: vùng hit liên tục hoặc delay đóng khoảng 150 ms, hủy delay khi pointer/focus vào popup. Tab đi vào các nút; focus ra ngoài/outside click đóng. Esc đóng và trả focus về avatar; chặn mở lại tức thì do chính focus khôi phục.
- Trạng thái lấy từ `activeRuns` cùng nguồn dòng tiến độ: idle, queued + blocker, running + label, checking, stopping. `renderActiveUI()` phải cập nhật cả popup, vì event progress hiện không gọi `renderTeam()`.
- Giữ node avatar/popup theo agent khi nhận progress/status; không `replaceChildren` cả header khiến mất hover/focus/nút đang bấm. Team đổi/xóa agent hoặc đổi box mới đóng popup phù hợp.
- Stop dùng đúng `dir/name/runId` đang hiển thị, disabled khi stopping; stale run bị BE từ chối như Sprint 1. @ gọi dùng `insertMentionAtCursor`, đóng popup và focus ô nhập; không gửi chat tự động.
- Không bỏ nút Dừng của dòng tiến độ, banner orphan lock, thống kê usage hay Cài đặt khi bỏ card thành viên cũ.

## 7. Phân công và nghiệm thu

**BE — `core.js`, `main.js`, `preload.js`:** dữ liệu task/revision, protocol cuối lượt + fresh/resume prompt, migration quyền PM, readFile/watch và IPC. Không cần đổi dependencies. Tối thiểu export helper `parseTaskDefinitions`, `buildTaskBoard`, `parseTaskStatusBlock`, `validateTaskChanges`, `readProjectFile` để QA kiểm tra không cần mở Electron; chi tiết chữ ký nội bộ BE ghi trong bàn giao, contract IPC mục 4 giữ nguyên.

**FE — `index.html`:** viewer + context links, board/drag/bàn phím, watch/async generations, header popup giữ Stop/progress. Có thể dùng fixture DTO mục 3–4 khi BE đang làm; bỏ fixture/fallback giả trước bàn giao. Không sửa core/preload để tránh đụng file.

**PM:** ghi quyết định scope/data vào spec và memory; sau BE triển khai thì tạo task bằng file chuẩn mới. Nhận đủ hai bàn giao rồi gọi QA một lần. Chưa giao QA thử app trước khi cả FE/BE có interface thật.

**QA — `check.js`:** `npm run check`, thêm check theo hành vi, dùng tmpdir và cleanup; không sửa dữ liệu box thật để kiểm tra file hỏng.

| Nhóm | Ca bắt buộc |
|---|---|
| Data | File chưa có → empty; schema sai/trùng ID/truncated JSON → error, giữ bản tốt; rename file liên tiếp; task xóa không hồi sinh từ log; log cũ không metadata; log hỏng không reset status |
| Concurrency | PM thêm T2 đồng thời user đổi T1 → cả hai còn sau restart; hai request cùng revision chỉ một thành công; cùng status/no-op; lỗi append không ACK success; metadata sửa làm request cũ conflict |
| Agent | Người nhận được đổi, agent khác không; không tin actor JSON; fresh/resume đều có revision; block success được bỏ khỏi chat/routing; stop/error/tool/user/code mẫu không thực thi; batch sai không áp một phần; replay không nhân đôi |
| Scope | Migration PM idempotent, đúng hai literal, backup giữ nguyên; không nâng readOnly/review; FE/BE vẫn không bị khóa chung do task; app status update không gây cảnh báo scope mới |
| Viewer | Relative sibling/parent bên trong root, root-prefix, absolute cũ; traversal thường/encoded, symlink ngoài root, root gần giống, control/scheme bị chặn; UTF-8/binary/2 MiB; `.js` là text; asar không thành thư mục |
| Markdown | Dùng cấu hình production; raw img/script và link javascript/data không thực thi; `roadmap.md` trong report mở đúng, http/https ra ngoài; thiếu file có lỗi rõ |
| Async/watch | Atomic replace vẫn refresh; file đang xem bị xóa/đổi; switch A→B khi IPC A chậm; fetch bảng cũ về sau drag ACK; watcher dọn khi đóng/reload; không kéo chat xuống khi đọc tin cũ |
| UI tay | 4 cột/scroll ngang, click spec, kéo và select status, restart giữ; hover→popup không mất, Tab/Esc, progress giữ focus; Stop running và queued theo runId, @ chèn không gửi |

Chạy app cần restart vì BE đổi main/core/preload. Node check không đủ chứng minh hover/drag/watch trong Electron; báo riêng kết quả kiểm tra tay. Tech Lead chỉ chốt thiết kế ở lượt này, chưa xác nhận Sprint 3 đạt nghiệm thu.

## 8. Căn cứ và dòng memory bàn giao

- [Node fs.watch caveats](https://nodejs.org/api/fs.html#caveats): watch file theo inode có thể mất lần thay file bằng rename; filename callback có thể không có. Vì vậy dùng watcher thư mục và invalidation.
- [markdown-it safety](https://github.com/markdown-it/markdown-it/blob/master/docs/safety.md): giữ HTML tắt và tránh plugin tạo HTML không an toàn; renderer shared giữ cấu hình Sprint 2.
- [Electron process.noAsar](https://www.electronjs.org/docs/latest/api/process#processnoasar): đây là switch toàn cục; không dùng nó để đọc file dự án, giữ cách `original-fs` đã sửa.

Dòng để PM nối vào `.chat/memory.md`:

> Sprint 3 contract: reports/sprint-3-design.md; PM ghi định nghĩa .chat/tasks.json (+ temp literal scope), main lưu status trong log.jsonl; agent đổi task của mình qua block task-status ở kết quả success, kiểm tra revision; viewer/kanban/header popup dùng IPC mục 4; FE/BE song song, PM nhận đủ rồi gọi QA.
