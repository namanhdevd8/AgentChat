# Sprint 2 — Thiết kế và contract FE/BE

Tech Lead · 2026-09-27 · Theo [sprint-2.md](sprint-2.md). Tài liệu để FE và BE triển khai song song; chưa phải báo cáo nghiệm thu.

## 1. Quyết định chính

- FE giữ trong `index.html`: Markdown, gợi ý tên, ô nhập, cuộn, cài đặt phạm vi và trạng thái chờ.
- BE giữ trong `core.js`, `main.js`, `preload.js`: chuẩn hóa phạm vi, điều phối lượt, kiểm tra thay đổi file, IPC mở link. BE cũng phụ trách dependency trong `package.json`; PM cần bổ sung `package-lock.json` vào phạm vi BE trước khi cài dependency.
- Dùng **markdown-it 15.0.2** đóng gói cùng app. Không tự viết parser Markdown bằng regex, không CDN, không thêm framework UI.
- Khóa ở đây là **khóa điều phối các lượt do app khởi chạy** theo phạm vi đã khai báo. Phát hiện sửa ngoài phạm vi là kiểm tra sau lượt, không phải sandbox ngăn mọi thao tác ghi của CLI/editor bên ngoài. `readOnly` không được quảng bá là quyền filesystem do hệ điều hành cưỡng chế.
- Giữ quyết định **không dừng CLI khi tắt app**. Vì vậy reservation của lượt đang chạy phải được lưu; mở lại app không được quên khóa rồi chạy đè lên CLI cũ.
- Snapshot chỉ phát hiện thay đổi còn tồn tại ở cuối khoảng quan sát. Khi nhiều tác nhân cùng ghi, không khẳng định ai đã sửa chỉ từ snapshot. Cảnh báo phải thể hiện điều này.

Không chọn worktree/merge hoặc filesystem sandbox riêng cho từng CLI: chúng vượt cơ chế xếp hàng + cảnh báo mà spec yêu cầu. Không chọn chặn toàn dự án cho mọi agent: FE và BE với danh sách file tách biệt phải chạy song song.

## 2. Contract chung

Giữ message/usage và `stop(dir,name,runId)` của [Sprint 1](sprint-1-design.md). Các bổ sung dưới đây là contract để hai dev không phải chờ nhau.

```ts
type AgentScope = {
  owns: string[];                // [] = toàn dự án nếu readOnly=false
  readOnly: boolean;             // true = không được ghi file nào theo quy ước nhóm
  ownsLegacy?: string;           // giữ nguyên mô tả cũ, không dùng làm matcher
  scopeNeedsReview?: boolean;    // true = không cho chạy, phải sửa/lưu trong ⚙
};

type ActiveRun = {
  name: string;
  runId: string;
  label: string;
  stopping: boolean;
  phase: 'queued' | 'running' | 'checking';
  blockedBy: Array<{name: string; runId: string; path: string; reason: 'scope' | 'previous' | 'orphan'}>;
};

type OrphanLock = {
  name: string;
  runId: string;
  owns: string[];
  readOnly: boolean;
  state: 'alive' | 'unknown';
};
```

| API / event | Contract |
| --- | --- |
| `open(dir)` | Trả `{log, team, active, orphanLocks}`. `team` luôn có owns dạng array, readOnly boolean; active là lượt đầu còn tồn tại của từng agent, kể cả đang chờ. |
| `saveTeam(dir, team)` | Nhận owns array/readOnly, kiểm tra và trả team chuẩn hóa; không ghi file nếu có lỗi. FE gửi một phần tử owns cho mỗi dòng nhập. Agent legacy mơ hồ cần thêm cờ xác nhận tạm `scopeConfirmed:true` từ thao tác xác nhận riêng trong ⚙; cờ này không lưu xuống disk. |
| `status(dir,name,on,runId)` | Giữ chữ ký. `on=true` khi một lượt trở thành lượt đầu của agent, kể cả chưa spawn; `false` khi lượt kết thúc/bị bỏ. |
| `progress(dir,name,data)` | `data={runId,label,phase,blockedBy,stopping}`; luôn là snapshot của lượt, không delta. FE chỉ áp dụng đúng runId. |
| `stop(dir,name,runId)` | Giữ `{accepted:boolean}`. Lượt đang chờ: xóa đúng lượt đó; đang chạy: dùng stop group hiện tại; checking: có thể hủy kiểm tra và ghi audit chưa hoàn tất. Không hủy mọi việc của agent. |
| `locks(dir, orphanLocks)` | Snapshot khóa của lượt từ lần chạy app trước; FE thay danh sách cảnh báo của box. Không đưa chúng vào activeRuns theo tên vì cùng agent có thể đang có một lượt mới chờ khóa. |
| `releaseLock(dir,runId)` | Chỉ dành cho khóa cũ `unknown`. BE mở hộp thoại xác nhận kiểm tra CLI đã hết; không tự kill PID. Khóa biết còn sống không được gỡ bằng API này. Trả `{released:boolean}`. |
| `openFile(dir,file)` | Đổi chữ ký cũ `openFile(file)`; chỉ mở file dự án đã kiểm tra, dùng cho panel File chung và link file. |
| `openLink(dir,href)` | Link Markdown: chuyển URL http(s) ra trình duyệt; link file đi qua cùng kiểm tra với openFile. Không điều hướng cửa sổ app. |

`runId` sinh **khi enqueue** và giữ nguyên qua chờ → chạy → kết thúc. Trong RAM phải lưu từng job riêng; `activeFor` chỉ chọn job đầu của mỗi agent để phù hợp Map hiện có ở FE. Những job phía sau không biến mất khi job đầu bị Dừng. Chưa cần UI quản lý toàn bộ hàng đợi.

FE cập nhật cả hai chỗ nhận event: luồng live và vòng replay `pendingEvents` trong `openProject`. `syncActive` phải giữ phase/blockedBy/stopping, không chỉ giữ label. Bản snapshot sau Cmd+R/đổi box là nguồn khôi phục trạng thái chờ.

## 3. Phạm vi mới và dữ liệu cũ

### Cú pháp

- Đường dẫn tương đối với project, dùng `/`; ví dụ `index.html`, `reports/**`, `src/**/*.js`.
- Hỗ trợ literal và wildcard `*`, `?`, `**`. `**` chỉ là một segment riêng. Không hỗ trợ phủ định `!`, brace `{}`, character class `[]`, extglob; báo lỗi cụ thể, không âm thầm bỏ pattern.
- `reports/` chuẩn hóa thành `reports/**`. Đường dẫn đang là thư mục cũng chuẩn hóa như vậy; file chưa tồn tại vẫn được nhận là literal file, thư mục chưa tồn tại phải viết `/` hoặc `/**` rõ ràng.
- Trim, bỏ `./` đầu, bỏ phần tử trống, loại trùng. Cấm absolute path, drive/UNC, backslash, NUL/control character và segment `..`. Không bỏ `..` bằng normalize rồi coi là hợp lệ.
- Project lấy `realpath`; kiểm tra các thành phần đã tồn tại của literal/prefix. Sprint này không nhận scope đi xuyên symlink; báo người dùng khai báo đường dẫn thật trong project. Không cho đường dẫn thoát root.
- `owns:[]` và `readOnly:false` là toàn bộ project; không biến array rỗng thành không có quyền. `readOnly:true` luôn có tập ghi rỗng, bất kể owns. `.chat/memory.md` không phải ngoại lệ ghi chung tự động.

Để kiểm tra một file: literal so đường dẫn; `dir/**` kiểm tra biên segment và bao gồm file ẩn trong thư mục; `[]` bao gồm mọi file trong phạm vi audit. Các glob còn lại dùng `path.matchesGlob` có sẵn, với quy tắc file ẩn của matcher: muốn khớp `.env` hoặc segment ẩn phải khai báo rõ. Node tại máy là 26.8.1, đã kiểm tra có hàm này; QA kiểm tra cả Node của Electron. [Node path.matchesGlob](https://nodejs.org/api/path.html#pathmatchesglobpath-pattern).

### Migration an toàn, không đoán từ văn xuôi

1. `team(dir)` chuẩn hóa khi đọc và trả hình dạng mới; **không tự ghi đè** agents.json chỉ vì mở box. Lần `saveTeam` thành công đầu tiên lưu dạng mới bằng temp + rename, giữ bản gốc `agents.json.pre-sprint-2.bak` một lần.
2. owns thiếu/rỗng → `[]`, readOnly mặc định false. String chỉ có đường dẫn/glob, phân cách dấu phẩy/chấm phẩy/xuống dòng → array sau validation.
3. String có mô tả tự do, không xác định chắc phần nào là path → giữ nguyên trong ownsLegacy, `scopeNeedsReview:true`. Có thể gợi ý các path nhận diện được trong UI, nhưng không cho chạy và không tự cấp toàn dự án. Một agent chưa rõ scope không chặn việc của các agent khác đã hợp lệ.
4. Chỉ đọc toàn bộ phải do checkbox hoặc giá trị readOnly rõ ràng; cụm “chỉ đọc code” trong scope Tech Lead **không** có nghĩa cấm ghi reports. PM dùng bảng chuyển đổi dưới đây để xác nhận trong ⚙.
5. Chỉ bỏ scopeNeedsReview khi scope hợp lệ **và** người dùng đã bấm “Xác nhận phạm vi này” cho agent đó (`scopeConfirmed:true`). Lưu model/timeout hoặc các field khác không được âm thầm biến scope mơ hồ `[]` thành toàn quyền: giữ cờ review nếu chưa xác nhận. BE đối chiếu dữ liệu cũ và bỏ cờ scopeConfirmed khỏi dữ liệu persist. Không xóa role/model/effort/resume/timeout hay session trong migration. Scope arrays được format thành lời dặn rõ ràng trong cả prompt mới và prompt resume; không để `[]` bị nội suy thành chuỗi rỗng gây hiểu sai.

Bảng chuyển đổi dữ liệu hiện tại để PM xác nhận, không phải logic hard-code tên người trong BE:

| Agent | owns đích | readOnly |
| --- | --- | --- |
| pm | `["reports/**", ".chat/memory.md"]` | false |
| techlead | `["reports/**"]`; giữ ghi chú “chỉ đọc code” | false |
| dev-fe | `["index.html"]` | false |
| dev-be | `["main.js", "core.js", "preload.js", "package.json", "package-lock.json"]` | false |
| qa | `["check.js"]` | false |

Agent QA vẫn ghi check.js nên không bật readOnly. Ví dụ một reviewer chỉ xem code mới dùng `readOnly:true`.

⚙: textarea owns, mỗi dòng một path/glob; checkbox Chỉ đọc; note dưới ô: “Để trống: toàn dự án. Chỉ đọc: cảnh báo nếu có ghi.” Mô tả cũ/đang cần xác nhận hiển thị riêng. Server kiểm tra lại toàn bộ, không chỉ dựa FE.

## 4. Thuật toán khóa và hàng đợi

### Khóa trên tên file tương lai, không chỉ file đang có

Mỗi scope sinh descriptor khóa trên đường dẫn tuyệt đối đã chuẩn hóa:

- Literal file: khóa đúng file.
- Thư mục `dir/**`: khóa cả cây dir.
- Glob khác: khóa cây ở **prefix thư mục cố định trước wildcard đầu tiên**. `src/**/*.js` và `src/**/*.css` cùng giữ cây src; `*.js` giữ cả root. Khóa rộng hơn phạm vi matcher để không bỏ lọt file mới tạo.
- owns rỗng: cây project root. readOnly: không giữ khóa và không chờ khóa của writer; vẫn phải xếp tuần tự các lượt cùng agent để giữ session.
- Xung đột khi hai file trùng nhau, file nằm trong cây, hoặc hai cây có quan hệ cha/con. So theo biên segment: `src` không bao gồm `src2`. Dùng canonical absolute path để cùng folder mở bằng alias hoặc project lồng nhau không tránh được khóa. Trên macOS so khóa không phân biệt hoa/thường để tránh bỏ lọt alias; audit vẫn dùng spelling đường dẫn đã chuẩn hóa thực tế.

Chấp nhận khóa bảo thủ làm hai glob khác đuôi trong cùng thư mục phải chờ. Code cần một comment: `ponytail: lock the fixed directory prefix of globs; exact glob intersection only if this reduces useful parallelism`. Không cần giải bài toán giao của mọi ngôn ngữ glob.

### Điều phối

Thay Promise chain không hủy được bằng danh sách job có trạng thái; giữ logic route/terminal message hiện tại. Có một hàm pump chạy khi enqueue, nhả khóa hoặc hủy job, không polling liên tục cho công việc trong app.

1. Mỗi agent chạy tối đa một job. Chỉ job đầu của agent được tranh khóa. Một writer được chạy khi không xung đột với reservation hiện tại và không vượt một writer cũ hơn đang chờ phạm vi giao nhau. Job ở phạm vi không liên quan vẫn chạy; reader không bị writer chặn.
2. Kiểm tra và giữ **toàn bộ** descriptor của job trong một bước đồng bộ, trước await/snapshot/spawn. Không giữ một nửa rồi chờ phần còn lại, tránh deadlock.
3. Scope/readOnly chụp và đóng băng cho job. `saveTeam` từ chối đổi tên/CLI/resume/owns/readOnly/xóa agent còn job queued/running/checking; vẫn cho chỉnh timeout/model/role cho job gửi sau. Không để thay owns giữa lượt làm biến mất vi phạm.
4. Sau khi giữ khóa: snapshot trước → core.run → snapshot sau/audit → terminal message và cảnh báo nếu có → nhả khóa trong finally → pump. Chỉ nhả reservation khi nhóm process của lượt đã hết. Nếu kill thất bại, hoặc CLI cha kết thúc nhưng group vẫn còn, giữ reservation vào orphanLocks (alive/unknown tùy kết quả kiểm tra), báo lỗi/audit chưa đầy đủ, không route và **không** mở đường cho writer khác. Trường hợp chưa từng spawn thì được nhả ngay.
5. Label chờ do BE tạo, ví dụ `chờ dev-fe (index.html)`; UI thêm tên agent hiện tại. blockedBy có dữ liệu cấu trúc, không bắt FE parse label. Khi thay blocker hoặc bắt đầu chạy, gửi progress snapshot mới; không ghi tiến độ chờ vào log.
6. Chỉ `outcome='success'` được route; audit warning không route. Lỗi scan không được giữ queue vĩnh viễn; nếu trước chạy không snapshot được thì không spawn, báo lỗi rõ ràng. Nếu sau chạy scan lỗi thì giữ kết quả CLI nhưng cảnh báo audit chưa đầy đủ.

### Dừng và timeout khi chờ

- Giữ S1: thời gian ở sau một job khác của **cùng agent** chưa tính timeout. Khi job trở thành đầu hàng, timeout bắt đầu và tính cả chờ khóa + thực thi CLI, không reset khi được khóa. Đây là quy tắc chốt cho yêu cầu timeout lúc chờ của S2.
- Dừng/timeout queued: đánh dấu kết thúc trước khi pump, xóa đúng job, bỏ timer, không spawn, không cập nhật sessions/seen/costCheckpoint, không route. Các job khác vẫn giữ nguyên.
- Main post một terminal system message “agent đã bị dừng khi chờ” hoặc “agent quá giờ khi chờ khóa”. Vì chưa spawn, usage có input/output/cost/duration bằng 0 và partial=false; không cộng thời gian chờ vào thời gian chạy CLI.
- Dừng running dùng core.run và process group của S1. checking hiển thị “đang kiểm tra file…”; timer CLI đã được xóa khi CLI xong. Nếu người dùng Dừng trong checking thì dừng scan, không route, ghi outcome stopped cùng số usage đã thu và cảnh báo audit chưa hoàn tất.
- Stop và pump phải kiểm tra cùng trạng thái job; queued bị hủy không được spawn ở một callback đến muộn. runId cũ không bao giờ dừng job mới.

### Đóng/mở app: không kill và không quên reservation

Dùng `app.requestSingleInstanceLock()` để tránh hai main process cùng điều phối; không có daemon mới. API này còn cần khi chạy Electron từ terminal trên macOS. [Electron app](https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelockadditionaldata).

- Lưu lượt đã được cấp chạy trong `.chat/locks.json` bằng temp + rename **trước spawn**: `{version:1,runs:[{runId,name,owns,readOnly,locks,pgid,startedAt}]}`. Reader có locks rỗng; vẫn lưu để không resume cùng session trong lúc reader cũ còn chạy. `locks` là descriptor đã chuẩn hóa; core.run thêm callback nội bộ `onSpawn(pid)` để ghi pgid ngay sau spawn trả về. File lock ghi lỗi thì không được để process chạy không có reservation: báo lỗi và thu dọn lượt đó.
- Thoát app không gọi stopGroup và không xóa reservation của CLI còn chạy. Queue chưa spawn vẫn chỉ nằm trong RAM như S1; không thêm cơ chế khôi phục câu trả lời/queue sau thoát.
- Khi mở app, đọc reservation của các project đã đăng ký trước khi pump. Lượt từ instance cũ đưa vào orphanLocks, giữ scope tương ứng và chặn job mới của chính agent đó dù là reader. Thăm dò process group bằng tín hiệu **0** trên macOS mỗi giây khi còn khóa cũ: ESRCH → nhóm đã hết, nhả khóa; còn sống → giữ; không kiểm tra được → unknown. Không kill theo một PID lưu cũ, tránh PID tái sử dụng. Định dạng registry đọc từ disk cũng phải validate; PID/pgid phải là số nguyên dương, không dùng nguyên dữ liệu tùy ý làm tham số process.kill.
- Record thiếu pgid, JSON hỏng, hoặc không xác minh được không được mặc định là không có khóa. Giữ reservation bảo thủ (toàn project nếu mất descriptor), hiện thông báo và lựa chọn releaseLock cho người dùng sau khi họ kiểm tra CLI đã hết. Không có TTL tự mở khóa.
- FE hiện cảnh báo khóa cũ riêng với nút “Giải phóng khóa chưa xác minh” chỉ cho unknown; BE xác nhận lại và hỏi bằng dialog. Điều này không dừng agent khi đóng app. Đừng gắn nút Dừng hiện tại vào một controller đã mất sau restart.
- Khi CLI cũ hết, không bịa terminal answer hoặc khẳng định audit đã chạy; app không giữ stdout/snapshot qua lần thoát. Rủi ro process con tự thoát process group của S1 vẫn phải được kiểm thử, không tuyên bố đã giải quyết bằng registry.

Đây là phần tối thiểu để quyết định không kill khi thoát không làm mất ý nghĩa khóa ở lần mở tiếp theo. Editor, CLI khởi chạy ngoài app hoặc app dùng userData khác không thuộc hệ thống điều phối này.

## 5. Phát hiện thay đổi ngoài phạm vi

Dùng snapshot **hash nội dung**, không chỉ mtime: file mới, xóa, đổi nội dung, đổi loại file/link đều phải thấy. Không cần git vì thư mục dự án hiện tại không có repository git.

Interface thuần dự kiến trong core để QA gọi:

```ts
normalizeScope(agent, dir)       // AgentScope đã validate; legacy mơ hồ giữ cờ review
scopeAllows(scope, relativePath) // boolean; readOnly luôn false
scopeLocks(scope, dir)           // [{path: absolutePath, tree: boolean}]
lockConflict(a, b)              // đường dẫn xung đột hoặc null
snapshot(dir, {signal})          // Promise<Map<relativePath, fingerprint>>
changedPaths(before, after)     // string[], sorted; thêm/sửa/xóa
```

- Walk bất đồng bộ, dùng lstat, SHA-256 cho file thường (stream để không nạp file lớn vào RAM), hash nội dung đường dẫn symlink bằng readlink nhưng **không đi theo symlink**. Kiểm tra lỗi đọc/thay đổi trong lúc hash; báo audit incomplete nếu không thu được snapshot đáng tin.
- Scanner phải quan sát AbortSignal và dừng stream đang đọc khi hủy. Comment giới hạn: `ponytail: hash files at turn boundaries; use a change journal if large projects make scans slow`.
- Quét file ẩn. Loại `.git/`, `node_modules/` và file vận hành app: `.chat/log.jsonl`, `.chat/sessions.json`, `.chat/locks.json`, đúng file temp/backup mà app tạo. Không loại toàn bộ `.chat`, không loại reports, `.chat/memory.md`, agents.json hoặc dist một cách mặc định. Các vùng loại trừ phải hiện trong chú thích của tính năng kiểm tra, không gọi là kiểm soát toàn filesystem.
- Không giữ bản sao nội dung, không tự hoàn tác. Chạy audit cả khi success/stopped/timeout/error nếu đã spawn và có baseline. Job bị hủy khi chờ không cần audit.
- Lấy `changedPaths.filter(p => !scopeAllows(scope,p))`. readOnly có tập ghi rỗng nên mọi thay đổi quan sát được đều là ngoài phạm vi.
- Mọi file ngoài scope quan sát được đều phải được báo; **không tự bỏ qua vì nó thuộc scope agent khác**, vì chính lượt này cũng có thể đã sửa file đó. Trong chạy song song, cảnh báo ghi “Phát hiện file ngoài phạm vi thay đổi trong thời gian lượt X; chưa xác định tác nhân, có lượt khác/editor có thể đang ghi”. Không ghi “X đã vi phạm” nếu chỉ có snapshot.
- Danh sách là đường dẫn tương đối, không đưa nội dung file vào log. Nếu dài, UI có thể thu gọn nhưng dữ liệu phải giữ toàn bộ danh sách. Snapshot không phát hiện thao tác ghi rồi phục hồi hoàn toàn trước lần quét sau hoặc ghi qua symlink ra ngoài project; không hứa khả năng đó.

Main post **một system message riêng**, không route và không có usage:

```ts
{
  from: 'system', text, at,
  kind: 'scope-warning',
  relatedRunId: runId,            // KHÔNG đặt runId của terminal message vào đây
  paths: ['outside.txt'],
  auditComplete: true,
  attribution: 'unverified'
}
```

Lý do dùng relatedRunId: FE hiện loại trùng message theo runId; nếu dùng cùng runId cho cảnh báo thì cảnh báo sẽ bị nuốt. Terminal message vẫn giữ đúng một runId/usage như S1. Cảnh báo scan lỗi dùng cùng kind, auditComplete=false, paths là phần đã biết. FE hiển thị file names bằng text/DOM an toàn.

## 6. Markdown và mở link

BE thêm production dependency pin `markdown-it: "15.0.2"`, lockfile đi kèm. FE nạp đồng bộ trước script app:

```html
<script src="./node_modules/markdown-it/dist/browser/markdown-it.umd.min.js"></script>
```

UMD global là `window.markdownit`; path trên được đối chiếu [metadata 15.0.2](https://raw.githubusercontent.com/markdown-it/markdown-it/15.0.2/package.json) và [build config](https://raw.githubusercontent.com/markdown-it/markdown-it/15.0.2/support/build-dist.mjs). Electron-builder đưa production node_modules vào gói kể cả khi đã có build.files; QA vẫn kiểm tra asset thực tế trong bản đóng gói. [electron-builder v26](https://www.electron.build/v26/docs/contents/).

Một hàm render dùng cho message cũ/mới và user/agent/system:

```js
const md = new window.markdownit({ html: false, linkify: false, breaks: true })
  .disable('image')
```

- Dùng cấu hình này với renderer mặc định, không plugin tạo HTML và không highlight callback. Output parser mới được đưa vào DOM; raw message không bao giờ đi thẳng vào innerHTML. `html:false` là chiến lược an toàn chính thức của parser, không cần thêm sanitizer khi giữ cấu hình này. [markdown-it safety](https://github.com/markdown-it/markdown-it/blob/master/docs/safety.md).
- Đậm/nghiêng/code/fence/list/blockquote/link/table dùng parser hiện có. Raw HTML như `<img src=x onerror=alert(1)>` phải hiện thành chữ. Ảnh không tải; không sinh id/name từ nội dung người dùng. Lỗi nạp/parser fallback về textContent và báo lỗi, không fallback sang raw HTML.
- Thắt `md.validateLink` thành allowlist http(s) hoặc đường dẫn reports/.chat; giữ bước kiểm tra protocol của parser. Link absolute tới reports/.chat của **project hiện tại** cũng được nhận để các tin cũ từ Codex còn bấm được. Protocol `javascript:`, `data:`, `vbscript:`, `file:`, protocol-relative `//…` và custom scheme không được mở.
- Giữ linkify file bằng cách đi qua **text node sau render**, bỏ qua anchor và fenced code (`pre`). Cho phép link file trong inline code để giữ các tin kiểu `` `reports/a.md` `` đang có. Tạo anchor bằng DOM; không regex-thay thế trên chuỗi HTML. Đường dẫn có khoảng trắng dùng link Markdown rõ ràng.
- FE bắt click/keyboard của anchor, `preventDefault`, dùng `getAttribute('href')` thay vì thuộc tính href đã resolve theo file URL. Mở qua `api.openLink(dir, href)`; panel File chung đổi sang `api.openFile(dir,file)`. Các promise lỗi phải hiện thông báo tại UI, không nuốt lỗi.
- BE dùng một resolver cho mọi caller mở file: project đã biết, resolve đường dẫn, giải mã URL một lần có kiểm soát, kiểm tra biên root và realpath, chỉ regular file trong `reports/` hoặc `.chat/`. Chặn `..`, encoded traversal, symlink thoát root, URL dạng file và đường dẫn project khác. Chỉ shell.openPath với tài liệu `.md`, `.txt`, `.json`, `.jsonl`, `.log`, `.csv`, `.yaml`, `.yml`, `.pdf` và ảnh `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.avif`; không mở executable từ một link agent gửi. Định dạng khác hiện lỗi rõ “Không hỗ trợ mở trực tiếp định dạng này” tại link/panel, không giả bấm thành công hoặc im lặng.
- Với web link, BE parse bằng URL, chỉ protocol http/https và hostname hợp lệ, rồi shell.openExternal sau thao tác click của người dùng. Chặn điều hướng cửa sổ chính và tạo window ngoài ý muốn. Validate sender IPC. Không nới CSP/nodeIntegration/contextIsolation để nạp parser. [Electron security](https://www.electronjs.org/docs/latest/tutorial/security#15-do-not-use-shellopenexternal-with-untrusted-content).
- Usage là DOM text nằm ngoài phần Markdown. CSS bỏ pre-wrap chung trên body Markdown, giữ whitespace ở pre/code, giới hạn chiều rộng trong grid; code và table dài cuộn ngang, không làm box tràn.

Log vẫn lưu text gốc; không lưu HTML và không render lại text để route mention. Hành vi gọi agent từ text gốc giữ nguyên.

## 7. Ô nhập, gợi ý tên và vị trí cuộn

### Gợi ý tại caret

Chỉ mở khi selection thu gọn và caret nằm trong token `@` + tên ASCII `[A-Za-z0-9_-]*`, phía trước là đầu dòng/whitespace/dấu mở ngoặc. Không hiện cho email `a@b`. Lọc prefix không phân biệt hoa/thường; giữ thứ tự team, không sort lại. Với team hiện tại, `@de` cho dev-fe trước dev-be, nên ↓ rồi Enter chọn dev-be đúng tiêu chí PM.

Lưu range của **toàn token quanh caret**, index lựa chọn và danh sách kết quả; dùng `setRangeText` thay đúng token bằng `@name `, giữ phần text trước/sau, caret ở sau dấu cách. Không chỉ append tên vào cuối textarea. Nếu vừa có sẵn khoảng trắng sau token thì tránh thêm khoảng trắng thừa.

| Trạng thái / phím | Hành vi |
| --- | --- |
| Đang IME (`compositionstart`…`compositionend`, isComposing hoặc keyCode 229) | Không chọn/gửi bằng Enter/→; đóng/suppress popup trong composition, cập nhật sau commit. |
| Popup có kết quả: ↑ / ↓ | Di chuyển lựa chọn, vòng đầu/cuối; không di chuyển caret. |
| Popup mở: Enter / → không modifier | Có kết quả: chèn lựa chọn, consume event; không có kết quả: không gửi/chèn, giữ thông báo “Không có thành viên phù hợp”. |
| Popup mở: Esc | Đóng popup; không tự mở lại vì keyup Esc. Mở lại khi text/caret đổi. |
| Shift+Enter | Xuống dòng như bình thường, đóng popup. |
| Popup đóng: Enter không Shift | Gửi theo hành vi cũ nếu không composing. |
| Tab, ←, Home/End, click đổi caret hoặc selection | Giữ chức năng biên tập; tính lại token/đóng popup nếu mất ngữ cảnh. |
| Chuột chọn option | Không submit form; giữ range trước khi textarea mất focus, chọn rồi trả focus/caret. |

Control nhận focus là textarea/combobox: đặt aria-controls, aria-expanded, aria-autocomplete và aria-activedescendant tại control này; trỏ tới popup và option đang chọn. Popup có `role=listbox`; option có ID và aria-selected. Nút chuột nếu dùng button phải có `type=button`, không submit. Popup đóng khi gửi, đổi box hoặc ra ngoài vùng ô nhập/popup. Tái dùng thao tác chèn mention cho nút Thành viên; các thay đổi bằng code cũng gọi hàm resize textarea.

### Cao tối đa 1/4 box

- Mốc đo là `main.clientHeight` (box chat), không phải viewport hoặc chiều cao log hiện còn lại. Textarea border-box không vượt `floor(main.clientHeight / 4)`.
- Recompute sau input, paste, mention insertion, clear/send và ResizeObserver trên main. Reset height để đo scrollHeight, clamp theo trần; khi vượt trần đặt overflow-y auto. Chiều cao ban đầu 44px nhưng cũng bị trần giới hạn ở cửa sổ rất nhỏ.
- Gửi xong trở về chiều cao ban đầu; text dài được giữ khi gửi thất bại theo hành vi FE lựa chọn, không dùng DOM resize để làm mất text. Popup nổi phía trên ô nhập, không tham gia chiều cao log.

### Giữ chỗ đọc

`addMsg()` hiện luôn gán `log.scrollTop = log.scrollHeight`; bỏ hành vi vô điều kiện tại đây, dùng cùng chính sách cho agent/user/system/history.

1. **Trước** khi append, lấy `nearBottom = scrollHeight - clientHeight - scrollTop <= 48`. Chỉ follow nếu nearBottom hoặc chính người dùng vừa bấm gửi. Gửi tin chủ động cuộn xuống ngay; không bắt buộc follow mãi nếu họ cuộn lên ngay sau đó.
2. Khi đang đọc cũ, giữ scrollTop/anchor nội dung hiện tại sau append. Không đợi append xong mới kiểm tra nearBottom. Set `overflow-anchor:none` cho log nếu quản lý anchor bằng code để tránh browser và app cùng sửa vị trí.
3. Composer resize, typing/queued rows và header đổi chiều cao cũng không được kéo người đang đọc xuống cuối. Giữ cờ follow và anchor của message đầu nhìn thấy + offset trong các lần đổi layout; nếu follow thì bám đáy, nếu không thì khôi phục anchor. Không cần thư viện cuộn hoặc virtual list.
4. Lần mở box/hydrate history render đồng bộ rồi cuộn đáy **một lần**; không scroll cho từng tin trong forEach. Giữ openSeq và pendingEvents của S1. Không dùng async Markdown IPC làm tin chèn sai thứ tự hoặc nhảy chiều cao về sau.
5. Nếu dùng requestAnimationFrame, kiểm tra người dùng có vừa cuộn lên trước khi áp dụng cuộn đáy. Không tự đưa focus về ô nhập chỉ vì nhận tin.

## 8. Bàn giao song song và QA

| Người | File và đầu ra |
| --- | --- |
| dev-fe | Chỉ `index.html`: render Markdown, compose, scroll, owns/readOnly/review UI, queued/blockers/orphanLocks UI và hai chữ ký mở link/file. Có thể viết theo contract trước khi BE hoàn tất. Xong báo PM kèm kiểm tra đã chạy. |
| dev-be | `core.js`, `main.js`, `preload.js`, `package.json`; `package-lock.json` sau PM bổ sung phạm vi. Cài parser, normalize/migration, scheduler/cancel/persistence/audit và IPC. Không sửa index.html. Xong báo PM kèm kiểm tra đã chạy. |
| pm | Bổ sung package-lock vào owns của BE; sau bản mới được nạp, xác nhận scope mơ hồ của Tech Lead theo bảng ở mục 3. Nối dòng memory cuối tài liệu. Nhận hai bàn giao rồi gọi QA một lần; không cần trả lời trạng thái đang chờ. |
| qa | `check.js`: chỉ bắt đầu nghiệm thu tích hợp sau khi PM đã nhận **cả FE và BE** báo xong, tránh gọi khi một nửa app còn contract cũ hoặc bị cả hai dev gọi trùng. |

Đợt viết code này chạy song song được vì file hai dev tách biệt; app đang chạy vẫn dùng BE S1. **Không coi đó là đã kiểm thử khóa S2**. Khi hai dev đã kết thúc, mở lại app để nạp main/core/preload mới rồi mới thử scheduler. Không khởi động lại giữa hai lượt đang sửa code và không thêm hook kill-on-quit.

QA mở rộng `node check.js` hiện có, assert + Node/Electron có sẵn, không thêm framework. Các hàm normalize/matcher/lockConflict/snapshot cần export từ core. Scheduler cần kiểm tra bằng fake core/IPC hoặc các helper thuần, không gọi CLI tính phí. Renderer dùng cửa sổ Electron ẩn với api giả, chạy chính index.html, không copy logic renderer sang test.

| Nhóm | Ca bắt buộc |
| --- | --- |
| Markdown | Các cấu trúc yêu cầu và table; raw img/script/SVG/event-handler thành chữ; code fence chứa HTML không thực thi; javascript/data/file/custom URL, entity/control-char scheme không mở; link file tương đối/absolute hợp lệ vẫn mở. |
| Link boundary | `reports/../…`, `%2e%2e`, symlink thoát root, file executable, đường dẫn box khác bị từ chối ở BE; link web không điều hướng app. Bản packaged tải parser được khi offline. |
| Mention/IME | `@de` → ↓ → Enter = dev-be + một dấu cách, 0 send; →, Esc, click, zero matches, caret giữa token, selection, email, Shift+Enter; IME tổng hợp và thử gõ tiếng Việt thật. |
| Resize/scroll | Paste dài, window resize, clear và chèn mention không vượt 25%; tin mới/system warning/typing row không kéo chỗ đọc; ở đáy và tự gửi thì follow; đổi box lúc event đến không sai thứ tự. |
| Migration | String path list chuyển được; mô tả Tech Lead không thành readOnly toàn bộ hoặc toàn quyền; string mơ hồ không spawn; lưu timeout mà chưa xác nhận scope không bỏ cờ review; backup gốc không bị ghi đè; config/session cũ giữ nguyên thông tin. |
| Scope/lock | FE vs BE song song; hai scope cùng file phải chờ; thư mục cha/con và case alias không lọt; `src` khác `src2`; file chưa tồn tại vẫn khóa; glob cùng prefix chờ bảo thủ; readonly không chờ writer; cùng agent vẫn tuần tự. |
| Queue | Hủy queued không spawn/không đổi phiên; timeout trong lúc chờ; stop runId cũ không hủy lượt mới; mọi reservation được giữ nguyên khi kill lỗi; nhả khóa sau lỗi/abort; thứ tự công bằng nhưng việc không giao nhau vẫn chạy. |
| Audit | Thêm/sửa/xóa; cùng mtime/size nhưng nội dung khác; sửa memory ngoài scope; readOnly ghi; audit sau stop; lỗi đọc không báo sạch; thay đổi từ lượt song song vẫn được báo với attribution chưa xác minh, không quy lỗi sai. Cảnh báo không bị dedup với terminal và không route. |
| Restart | CLI giả còn sống khi đóng app không bị app gửi kill; mở lại writer xung đột phải chờ reservation; group hết thì nhả; record thiếu/hỏng giữ unknown; không kill một PID tái sử dụng; single-instance gate. |
| Regression S1 | Stop group ≤2 giây, session/seen/costCheckpoint, usage/header và hồi phục active sau Cmd+R vẫn qua. Không thêm kill-on-quit. |

Khi check tự động bị môi trường chặn, ghi đúng lệnh và phần chưa chạy; không kết luận đạt. Smoke trong app thật vẫn cần cho IME, cuộn, hai job song song và trải nghiệm Dừng lúc chờ.

Tech Lead đã đọc các luồng hiện tại, kiểm tra Node có matchesGlob và đối chiếu nguồn dependency; chỉ ghi tài liệu, chưa thay đổi code hay chạy nghiệm thu S2.

Dòng memory để PM nối: `Sprint 2 contract: reports/sprint-2-design.md; owns array + readOnly, khóa trước spawn, Stop hủy đúng runId đang chờ; Markdown đóng gói html:false; không kill-on-quit, giữ reservation qua restart; QA sau cả FE và BE.`
