# Sprint 11 — Contract G1–G6

Techlead · T46 · 2026-10-14. Theo spec `reports/sprint-11.md` đã đọc trực tiếp trong worktree PM `agents/1d3692b0-3f5c-4aef-8ea1-bae8f5cec06c/`; spec chưa gộp lúc thiết kế. Nền sản phẩm **main `6278360`, 0.9.0**; HEAD techlead `bacba4e` chỉ thêm báo cáo P0. Đây là contract triển khai, chưa phải kết quả nghiệm thu.

## 1. Quyết định và phạm vi

- Giữ Electron/core/main/preload/renderer, bốn trạng thái `todo/doing/review/done`, task chỉ xem trong UI, task-status là đường agent yêu cầu thay đổi. **Chỉ tên `pm` (không phân biệt hoa/thường) được yêu cầu `done`.** Không cấp quyền mới cho người dùng qua IPC hay reviewer khác.
- Tái sử dụng merge queue/check runner và trust cấu hình. Không tự chạy thêm check khi nhận `review` nếu queue đang kiểm cùng bàn giao. Không suy task từ mention, tên nhánh, tiêu đề commit hoặc danh sách mọi task của agent.
- Hồ sơ kiểm do app lưu ngoài source; agent chỉ gửi tham chiếu. Check xanh không tự đóng task. Cảnh báo đổi test không chặn agent sửa test.
- G6 chỉ sửa tính chi phí và đánh dấu thiếu dữ liệu. Không thêm phanh tổng quát, tự gọi sửa merge, cờ ngân sách CLI hay xoay phiên theo % context trong sprint này.
- Không thêm dependency, sửa scope, nâng quyền CLI, tự `git init` hay dừng agent khi thoát app.

## 2. G1 — Hồ sơ kiểm và liên kết task

### 2.1 Nguồn dữ liệu và lưu trữ

Main ghi **`verification${core.chatName(root)}.jsonl` trong `worktreeBase(root)`**, cùng vùng userData đang giữ registry, kể cả box tắt worktree. Cô lập theo realpath project + box như registry hiện tại. Không đặt hồ sơ có thẩm quyền trong `.chat`, không nhận đường dẫn kho từ renderer/agent. Dùng ghi nối tiếp theo box, chống symlink như các file dữ liệu app hiện có; entry chỉ thêm, không sửa kết quả cũ.

Mỗi dòng có `{version:1, kind:'review'|'check'|'handoff-facts', ...}` theo schema dưới đây và mục 6. Các ID do app sinh UUID; thời gian UTC ISO; SHA đủ 40 ký tự; path tương đối POSIX đã kiểm trong repo. `null` có nghĩa chưa đo/không áp dụng, không tự đổi thành 0 hay pass.

```ts
type TaskRef = {
  id: string; createdAt: string; assignee: string;
  definitionRevision: string; // hash định nghĩa, không gồm event trạng thái
  requestedRevision: string;  // revision được gửi lúc khai báo liên kết, để truy vết
};
type ReviewRecord = {
  version: 1; kind: 'review'; id: string; at: string;
  task: TaskRef; runId: string; workspaceId: string | null;
  sourceSha: string | null; baseSha: string | null;
  checkPolicyHash: string; // SHA-256 JSON danh sách mergeChecks đã normalize, giữ thứ tự
  artifactPaths: string[]; pathsComplete: boolean;
  // Các path có thay đổi trong bàn giao; gồm tên cũ và mới khi đổi tên.
  warnings: TestWarnings;
};
type TestWarnings = {
  files: Array<{path: string; reason: 'test'|'test-config'|'check-script'}>;
  total: number; truncated: boolean;
};
type CheckRecord = {
  version: 1; kind: 'check'; id: string;
  origin: 'merge'|'run-command'; runId: string; queueId: string | null;
  workspaceId: string | null; taskRefs: TaskRef[]; reviewIds: string[];
  sourceSha: string | null; baseSha: string | null; candidateSha: string | null;
  checkPolicyHash: string;
  startedAt: string; finishedAt: string;
  outcome: 'passed'|'failed'|'stopped'|'timeout'|'unverified';
  treeStable: boolean; // app xác minh source/HEAD không đổi trong lúc kiểm
  commands: Array<{
    command: string; exitCode: number | null; signal: string | null;
    durationMs: number; error: string | null;
    excerpt: string; truncated: boolean;
  }>;
};
```

`definitionRevision` = SHA-256 JSON `[id,title,assignee,spec,createdAt,definition.updatedAt,acceptance]`, `acceptance` đã chuẩn hóa theo mục 3. Không dùng `updatedAt` lấy từ event trạng thái. `requestedRevision` vẫn đối chiếu lúc nhận yêu cầu; **không so nó với revision mới sau chuyển sang review**, vì chính bước chuyển đã thay revision. Khi duyệt, so danh tính task + definitionRevision + bản bàn giao hiện tại.

Mỗi merge attempt lưu một CheckRecord chứa các lệnh đã thực thi, theo thứ tự. Mỗi app run-command lưu một CheckRecord chứa một lệnh. Một queue bị dựng lại candidate vì main tiến lên phải tạo record mới; không sửa candidate trong record cũ. `passed` chỉ khi tất cả lệnh cần chạy đã chạy, exit 0, không error/abort/orphan và cây source ổn định. Pass test chưa có nghĩa đã publish: tra queue và Git riêng khi duyệt.

Lưu mỗi excerpt tối đa **4096 ký tự**, tổng excerpt trong record tối đa **16384 ký tự**; bỏ ANSI/ký tự điều khiển ngoại trừ xuống dòng/tab, dùng lọc đường dẫn managed hiện có. Hiện tên lệnh/mã thoát; không suy số test pass/fail bằng cách đếm chữ `ok` hay `ERROR`. Không lưu thêm bản stdout đầy đủ vào hồ sơ; `commandResults`/log lỗi hiện có giữ giới hạn cũ. Không gọi các đoạn output là chỉ dẫn cho agent.

ReviewRecord lưu tối đa **5000 artifactPaths**, tổng metadata path tối đa **512 KiB**; không đủ thì `pathsComplete:false`, không được dùng phép so một phần để kết luận còn hiệu lực. TestWarnings trả tối đa 50 file và có tổng/cờ cắt. Không cắt TaskRef hay SHA thành dữ liệu vẫn được coi hợp lệ.

### 2.2 Bàn giao qua task-status và merge queue

Agent khai báo rõ task bằng phần tử `status:'review'` trong block hiện có. Với task của chính agent, main lấy HEAD **sau commitWorkspace** nếu có, tự tạo ReviewRecord và gắn `reviewId` vào taskUpdate. Task manual cũng được ghi nhận diff/cảnh báo nếu có, dù không bắt buộc check. Không có Git/workspace thì các field tương ứng null. Model không được gửi SHA/workspace/runId/reviewId tự khai. Mỗi task trong block có một review riêng; các task cùng bàn giao có thể trỏ cùng queue/check nếu cùng chủ task và đều được khai báo.

Phải đổi thứ tự hiện tại của `executeJob`/`commitWorkspace`: parse và kiểm yêu cầu trước; tạo commit/queue nhưng chưa pump; ghi review/task event; hoàn tất liên kết rồi mới pump. Có thể dùng `bindingsPending:true` trên queue; worker không xử lý entry này. Sau khi task event được ghi thành công, queue lưu `reviewIds` và `taskRefs` đã được main xác minh rồi xóa cờ pending. `job.taskIds` hiện chỉ dùng đặt tiêu đề commit, **không được dùng làm liên kết bằng chứng**.

Một batch sai revision/quyền/schema bị từ chối toàn bộ task update như hiện tại; nội dung trả lời và commit code hợp lệ vẫn giữ. Queue không có liên kết hợp lệ vẫn được gộp theo cơ chế cũ nhưng không dùng đóng task. Lượt lỗi/dừng/timeout không tự tạo review, dù có checkpoint code.

ReviewRecord được ghi trước log task event; event giữ `reviewId` làm tham chiếu. Record chưa được event nào xác nhận không trở thành bàn giao đang hiệu lực. Nếu app dừng giữa hai bước, khôi phục chỉ giải phóng queue pending khi tìm được task event tương ứng; không tìm thấy thì bỏ liên kết task và tiếp tục queue không liên kết. Không suy “đã ghi review” chỉ vì thấy file hồ sơ.

PM được chuyển task người khác sang review, nhưng không gắn worktree của PM vào task đó. Giữ review có sẵn nếu còn phù hợp; nếu chưa có thì trả thông tin “Chưa có bàn giao của người phụ trách”. Chủ task gửi review để thiết lập bàn giao code. Task thủ công không cần source SHA/queue.

`review → review` chỉ tạo event mới khi thực sự bàn giao lại (bản code/định nghĩa thay đổi hoặc chủ task cần lập liên kết còn thiếu); cùng revision, cùng bàn giao đã có là no-op. Mở lại bằng `todo/doing` làm bàn giao trước không còn là bàn giao hiện tại; muốn đóng code phải review lại. Không xóa hồ sơ cũ.

### 2.3 App run-command

Giữ cú pháp cũ; thêm field tùy chọn `tasks`, tối đa 20 phần tử duy nhất. Tăng giới hạn block run-command lên 8192 byte, giữ tối đa 3 yêu cầu mỗi lượt và luật không gửi cùng handoff/task-status.

```json
{"command":"npm run check","tasks":[{"id":"T47","expectedRevision":"revision đang thấy trong prompt"}]}
```

Core parser chỉ nhận `command` và tùy chọn `tasks`; mỗi task chỉ có `id/expectedRevision`. Main kiểm revision và quyền: agent chỉ liên kết task của mình; PM có thể liên kết mọi task. Field vắng → vẫn chạy lệnh hợp lệ, lưu hồ sơ không liên kết, không đoán task. Field có nhưng sai → báo lỗi yêu cầu, không chạy lệnh hoặc lập hồ sơ pass.

Bổ sung callback nội bộ `options.executeCommand({command,tasks})` vào `core.run`; main thực hiện kiểm liên kết, lấy snapshot trước/sau, gọi `core.runCommand` và ghi CheckRecord **trước** khi trả kết quả về model. Core không tự truy cập userData. Luồng app luôn truyền callback; unit-test/caller cũ có thể dùng runner hiện tại nhưng không tự tạo ID bằng chứng. Kết quả command bổ sung `checkId:string|null` và `verificationError:string|null` vào kết quả công khai; ghi hồ sơ lỗi không được biến thành check hợp lệ.

Ghi nhận cả lệnh lỗi/Stop/timeout đã thực sự chạy. Yêu cầu bị từ chối allowlist không tạo kết quả “đã chạy”. Native Bash/CLI tự chạy lệnh không có callback app thì không coi lời agent báo là bằng chứng G1.

Runner có thể chạy khi worktree bẩn, nhưng HEAD lúc đó không mô tả hết code đã kiểm: `treeStable:false`, kết quả chỉ để tham khảo. Muốn dùng run-command cho đóng task code phải có HEAD sạch trước/sau, không đổi tracked/untracked source trong lúc kiểm, không orphan; SHA đó đã nằm trong main hoặc có mapping squash đã xác minh. Không tự commit chỉ để biến kết quả dirty thành pass. Trong luồng thông thường, check integration của queue là bằng chứng đủ, không cần agent chạy lặp thêm.

### 2.4 Migration và tính toàn vẹn

- File hồ sơ chưa có → chưa có bằng chứng; không tạo pass từ lời chat cũ hay `commandResults` cũ thiếu danh tính code. Queue cũ vẫn retry/merge được; trường mới thiếu mặc định không liên kết.
- Retry cùng source SHA/policy được giữ liên kết task còn đúng; đổi HEAD hoặc định nghĩa task thì phải xác minh lại bằng review mới, không copy mù `reviewIds/checkIds`. Record pass của attempt cũ không thắng record fail/stopped mới hơn cho cùng bàn giao/chính sách.
- Dòng cuối hồ sơ ghi dở: giữ/bỏ qua phần chưa hoàn tất có báo lỗi, không nhận như record hợp lệ; hỏng giữa file → trạng thái bằng chứng unavailable và chặn duyệt bằng check. Không reset cả bảng task hay tự tạo lại lịch sử pass. Ghi lỗi phải hiện thông báo cụ thể.
- Không thay reducer totals bằng cách phát system message có `runId/usage` cho từng check. Thông báo hồ sơ dùng `relatedRunId`, `checkId`, `kind:'verification'`, không route và không tăng token/lượt/chi phí. Khi merge đã publish mà ghi hồ sơ thất bại, vẫn báo code đã gộp, nhưng bằng chứng chưa đủ; không sửa lại lịch sử thành “đã kiểm có hồ sơ”.

## 3. G2 — Đóng task

### 3.1 Định nghĩa task và event tương thích

Giữ `.chat/tasks.json` version 1, thêm field tùy chọn **`acceptance:'code'|'manual'`**. Vắng field đọc là `code`; không đoán từ tên task/agent/spec. PM ghi rõ ở task mới: `manual` cho tài liệu, research, QA/nghiệm thu tay; `code` cho triển khai sản phẩm. `manual` là cách nghiệm thu, không phải tên vai. PM không đổi code sang manual chỉ để bỏ qua check đỏ.

Parser nhận đúng schema cũ hoặc schema có thêm acceptance; field khác vẫn lỗi. Sửa acceptance phải tăng definition.updatedAt, làm đổi revision/definitionRevision như sửa title/spec. Giữ thuật toán revision cũ cho định nghĩa chưa có field để không vô hiệu mọi prompt đang chạy; với định nghĩa có field, thêm acceptance vào dữ liệu hash. Parser phải giữ thông tin field vắng trong định nghĩa nội bộ, chỉ chuẩn hóa mặc định ở DTO/definitionRevision. DTO luôn trả acceptance chuẩn hóa và definitionRevision. Task đã done trong log cũ giữ done, hiển thị “Lịch sử trước Sprint 11”; không yêu cầu đóng lại hàng loạt. Khi mở lại task, áp dụng luật mới.

TaskUpdate nhận thêm tùy chọn `reviewId` và `approval` do main sinh; validator log vẫn nhận đúng record schema cũ. `approval` lưu kind, checkIds hoặc reason/report, `reviewer` lấy từ job.name, `at` lấy thời gian app. Event done giữ reviewId đang được duyệt để tra chi tiết; todo/doing bỏ liên kết hiện hành, không xóa lịch sử. Không tin reviewer/at từ protocol. Gỡ task hoặc đổi danh tính không được làm hồ sơ cũ áp vào task khác.

### 3.2 Block task-status

Các phần tử không phải done giữ ba field cũ. Done phải có đúng một approval:

```json
[{"id":"T47","status":"done","expectedRevision":"revision hiện tại","approval":{"kind":"checks","checkIds":["UUID hồ sơ do app cấp"],"note":"Đã nghiệm thu theo spec; các mục thử tay cần thiết đã đạt."}}]
```

```json
[{"id":"T49","status":"done","expectedRevision":"revision hiện tại","approval":{"kind":"manual","reason":"Đã nghiệm thu các ca trong báo cáo QA.","report":"reports/sprint-11-qa.md"}}]
```

- `checkIds`: 1–20 UUID duy nhất. `note/reason`: chữ không rỗng, tối đa 1000 ký tự, không ký tự điều khiển; report là null hoặc path theo `validTaskSpec` (viewer kiểm quyền khi mở). Giữ block tối đa 8192 byte/20 task; PM chia batch khi vượt giới hạn.
- Non-PM gửi done luôn bị từ chối, kể cả task của chính mình hay gửi approval giả. PM được đổi todo/doing/review của mọi task như cũ. No-op với revision cũ vẫn CONFLICT; không tự nâng revision rồi thử lại.
- Task code có bàn giao worktree bắt buộc đang review và dùng checks. Task manual dùng manual. Task code thực hiện hoàn toàn không có worktree được dùng manual kèm lý do nêu rõ đường nghiệm thu; main ghi chế độ thực tế này vào approval. Đường này chỉ mở khi worktree hiện tắt và lịch sử bàn giao của task không có workspace/queue code cần duyệt; thiếu/hỏng dữ liệu không được coi là không-worktree. Tắt worktree sau một review có workspace không biến nó thành task không-worktree.
- Đóng task manual không bắt buộc thêm một lượt review trung gian. Với code còn thiếu review/evidence, main từ chối với lý do rõ, không tự hạ xuống đường manual. Batch all-or-nothing và giữ nguyên lời trả lời khi protocol lỗi.

### 3.3 Điều kiện bằng chứng còn hiệu lực

Main quyết định, FE/model không tự tính. Với đường checks, tất cả điều kiện sau phải đúng:

1. Bảng task không lỗi; actor là PM; expectedRevision đúng; task đang review có ReviewRecord đã được event hiện tại xác nhận; danh tính/definitionRevision khớp. CheckRecord thuộc cùng project/box, chứa TaskRef đúng task và định nghĩa, workspace và sourceSha đúng bàn giao. `requestedRevision` cũ được giữ làm lịch sử, không làm check hết hiệu lực chỉ vì doing chuyển review.
2. Các record passed, treeStable, không thiếu lệnh; hợp lại bao phủ đủ **mergeChecks hiện đang được trust**, policy hash trùng và configTrust hiện không có thay đổi chờ xác nhận. Không tự pin config trong bước duyệt. Với từng command, không chọn pass cũ nếu lần thực thi mới hơn của chính command trên cùng nguồn/task/policy là fail/stopped/unverified; phải có lần kiểm lại thành công sau đó. Không có đủ dữ liệu thì chưa sẵn sàng.
3. Với merge: candidateSha đúng attempt đã publish, queue/mapping nguồn→candidate xác minh được và candidate vẫn là ancestor main. Không bắt sourceSha của nhánh agent là ancestor main, vì app dùng squash. `state:'merged'` ở đường alreadyMerged không có hồ sơ check không tự sinh pass.
4. Với runner: source sạch đã được gộp, check đúng SHA được review; không gộp kết quả của các SHA khác nhau để đủ bộ lệnh. Đây cũng là đường kiểm lại chủ động khi code đã gộp nhưng trước đó không có hồ sơ hợp lệ; không cần commit rỗng hay queue giả.
5. Không có bàn giao mới hơn cho task, job/orphan còn sửa workspace, source bẩn hay commit chưa gộp của workspace đó. Workspace đã được app sync sang main là hợp lệ nếu mapping cho bàn giao vẫn đúng; không so đơn thuần `workspace.HEAD === sourceSha` sau squash/sync.
6. Code thuộc artifactPaths của bàn giao trên main còn giống bản đã kiểm (gồm xóa/đổi tên), và không có thay đổi test/config/check-script/dependency manifest/lockfile từ bản kiểm đến hiện tại ảnh hưởng chính sách kiểm. Root bẩn hoặc không xác minh đầy đủ thì chưa cho đóng. Commit main chỉ đổi file không liên quan không làm tất cả task hết hạn. Bằng chứng này xác nhận bàn giao, không cam kết mọi trạng thái repo tương lai đều đã được kiểm.

Nếu không xác định đủ artifactPaths (không có diff mới, danh sách bị cắt hoặc mất base), chỉ dùng đối chiếu **toàn cây tracked** với bản kiểm, không coi mảng path rỗng là “không có gì cần so”. Kiểm qua helper Git hiện có, tắt ext-diff/textconv, không shell eval. Chưa hỗ trợ submodule/nguồn không xác minh được thì báo unavailable thay vì thông qua.

Bàn giao lại cùng code và cùng định nghĩa có thể dùng lại hồ sơ đúng nguồn nếu mọi điều kiện trên vẫn đạt; PM vẫn phải gửi approval mới. Đổi định nghĩa cần check có TaskRef mới; có thể chủ động chạy run-command liên kết revision mới trên bản đã gộp/sạch. Không tự gán TaskRef mới vào record cũ. Ví dụ phục hồi khi đã gộp nhưng evidence stale: chủ task chạy đủ check có `tasks` trên workspace sạch đã đồng bộ main, rồi gửi lại review; main liên kết review mới với SHA đã kiểm đó. Không có diff mới vẫn lập được review, không yêu cầu commit rỗng. Prompt/lý do stale phải chỉ rõ cần kiểm lại và bàn giao lại, không chỉ ghi “thiếu bằng chứng”.

**Lỗi protocol:** giữ `CONFLICT/INVALID/DATA_ERROR`; thêm mã nội bộ `REVIEW_REQUIRED`, `EVIDENCE_REQUIRED`, `EVIDENCE_STALE`, `EVIDENCE_UNAVAILABLE`. Chat chỉ báo lý do và task liên quan; không làm CLI result thành lỗi khiến tự chạy lại lượt đã hoàn tất.

### 3.4 Khóa và kiểm lại ở thời điểm ghi

Hiện commit queue xảy ra trước parse task và `appendLogIndexed` tự kiểm revision. T47 phải nối policy vào **chính đường append**, không chỉ kiểm trong parser/prompt. Main chuẩn bị dữ kiện Git/hồ sơ khi giữ git lock; core kiểm lại board/revision và policy context do main cấp trong hàng ghi log nối tiếp. Helper chỉ được nhận context nội bộ, không lấy approval đã “được duyệt” từ JSON agent.

Thứ tự khóa thống nhất **Git → ghi log**, không giữ hàng log rồi chờ Git để tránh deadlock. Không giữ các khóa này trong lúc chạy check/CLI/dialog. Trước append phải phát hiện snapshot/policy đã đổi trong quá trình chuẩn bị; reject stale, không tự chấp thuận snapshot cũ. Các công cụ ngoài app vẫn có thể sửa repo nên đây là kiểm chứng tại thời điểm duyệt, không phải sandbox chống mọi tiến trình ngoài.

## 4. G3 — Cảnh báo sửa test/check

Main phân loại từ diff thật của bàn giao, không từ danh sách model kể. Dùng path cũ + mới khi rename để rename test ra khỏi thư mục không mất cảnh báo. Tối thiểu bao phủ:

- `check.js`; thư mục `test/`, `tests/`, `__tests__/`; tên `*.test.*`, `*.spec.*`.
- `jest.config.*`, `vitest.config.*`, `playwright.config.*`, `cypress.config.*`, `karma.conf.*`, `pytest.ini`, `tox.ini`, `conftest.py`, `.github/workflows/**`.
- `package.json` khi scripts thay đổi; file script tương đối được lệnh mergeChecks trỏ trực tiếp tới như `node check.js`/`sh scripts/check.sh`; thay đổi script npm tương ứng. Parse dữ liệu, không chạy shell để tìm file. Không parse được config thì cảnh báo thay vì kết luận không đổi.

Cảnh báo là heuristic các mẫu đã hỗ trợ, không tuyên bố phát hiện mọi test framework. Không cần bộ cấu hình glob mới. Giữ trust riêng cho agents/project config; không tự pin mergeChecks mới. Với task manual có code/test thay đổi trong lượt bàn giao, vẫn hiện cảnh báo; chưa đủ bằng chứng attribution thì ghi “chưa xác minh”, không gán file của main mang vào cho agent. Dùng lại lọc scope/diff sau T38.

## 5. IPC và FE — T48

Giữ `api.tasks(dir)` trả `{tasks,error}` trực tiếp. Mỗi task có thêm `acceptance`, `definitionRevision` và DTO sau; BE cũ không có field thì FE hiển thị “Chưa có dữ liệu kiểm”, không suy ready. DTO này cũng dùng trong prompt PM; core chỉ dựng phần task cơ bản, main bổ sung đánh giá Git/hồ sơ.

```ts
type VerificationView = {
  state: 'none'|'pending'|'failed'|'stale'|'ready'|'manual'|'legacy'|'unavailable';
  reason: string | null;
  reviewId: string | null; checkIds: string[];
  warnings: TestWarnings;
  approval: null | {
    kind: 'checks'|'manual'; reviewer: string; at: string;
    checkIds?: string[]; note?: string; reason?: string; report?: string | null;
  };
}; // Task.verification
// Mới, chỉ đọc; validSender + knownProject + đúng task/revision.
api.taskEvidence(dir, {taskId, expectedRevision})
// -> {ok:true, taskId, revision, verification, review:ReviewRecord|null,
//     checks:CheckRecord[], total:number, truncated:boolean}
// hoặc {ok:false,error:{code,message}}
```

Trả tối đa 20 hồ sơ mới nhất phù hợp task và luôn gồm hồ sơ đang được dùng duyệt; không thêm UI lịch sử vô hạn. Record trong DTO loại bỏ đường dẫn tuyệt đối nội bộ; log/excerpt là text. Không nhận raw path/check file từ renderer. `CONFLICT` → FE tải lại task, không âm thầm dùng chi tiết task cũ.

Ánh xạ badge: none “Chưa có bằng chứng”; pending “Chờ kiểm” (queue đang chờ/chạy); failed “Kiểm tra lỗi”; stale “Cần kiểm lại”; ready “Đã kiểm · chờ PM duyệt”; manual “Cần nghiệm thu”; legacy “Lịch sử cũ”; unavailable “Chưa xác minh được”. `review` vẫn tên cột “Chờ duyệt”; không thêm trạng thái task thứ năm. Queue bị chặn/paused vẫn pending có reason cụ thể, không giả là check đang chạy. Task done có approval mới hiện “Đã duyệt”; record lịch sử không bị đổi nhãn thất bại chỉ vì source tiếp tục phát triển sau khi đã đóng.

Mỗi dòng task có nút riêng mở vùng **Bằng chứng**, gồm nguồn/lệnh/mã thoát/thời điểm/SHA rút gọn, lý do stale, cảnh báo file test và thông tin PM duyệt. SHA đầy đủ xem/copy trong chi tiết. Không có nút đổi trạng thái/duyệt/chạy lệnh. Tên task/spec vẫn mở viewer; tách control spec khỏi control bằng chứng, không lồng button trong row có role button. Enter/Space mở, Esc đóng/trả focus; nhớ gập/mở theo task, dùng theme/icon sẵn có.

Main gọi `notifyProjectChanged(root,{tasks:true})` khi record/queue/task/config liên quan đổi, kể cả check kết thúc không có task-status. FE giữ guard dir + box + openSeq + taskGen khi tải bảng/chi tiết; không kéo chat xuống hay làm mất focus khi refresh. Giá trị verification phụ thuộc trạng thái repo: tải lại khi focus/refresh như hiện tại, và main luôn kiểm lại khi đóng, không tin badge đang hiển thị.

## 6. G4/G5 — Prompt và bàn giao

### Luật chia việc

Thêm luật chung ngắn: nhận việc thì làm trong phạm vi đã giao; cần vượt phạm vi thì báo PM; yêu cầu cụ thể của End-User có ưu tiên. PM có đoạn riêng ở cả prompt fresh/resume: đầu ra, cách nghiệm thu, chủ task rõ; việc nhỏ một nơi giao một agent; chỉ chạy song song khi các việc độc lập/interface đã chốt; agent khác có thể review/research; việc phát sinh vượt phạm vi tạo task mới. Mỗi task có cách nghiệm thu, không bắt script riêng. Giữ nguyên scope/CLI permissions; không đặt PM readOnly và không tự sửa agents.json.

Prompt task cập nhật đúng protocol mục 3, acceptance, definitionRevision, verification.state/reason/checkIds và cảnh báo test. PM thấy task chưa xong của nhóm, agent khác thấy task mình; giữ số task done như Sprint 7. Hướng dẫn PM cập nhật acceptance của task tài liệu/QA cũ đang mở trước khi duyệt; không migrate hàng loạt file task của PM.

### Dữ kiện do app điền

Main cung cấp `options.getAppContext()` cho `core.run`/`promptIndexed`, trả `{facts,taskVerification}`. Gọi sau chuẩn bị/sync workspace, trước prompt fresh/resume và khi cần dựng lại prompt do phiên lỗi. Main dùng cùng resolver đánh giá evidence cho IPC/prompt/đóng task, không viết ba thuật toán khác nhau. Summary job không thêm bản briefing của agent thường.

```ts
type AppFacts = {
  version: 1; capturedAt: string; runId: string;
  workspaceId: string | null; branch: string | null; headSha: string | null;
  source: 'main'|'worktree'|'no-git'|'unavailable';
  diff: null | {baseSha:string|null; files:number; insertions:number; deletions:number;
    untracked:number; binary:number; paths:string[]; truncated:boolean};
  tasks: Array<{id:string; revision:string; status:string}>;
  latestCheck: null | {id:string; sourceSha:string|null; candidateSha:string|null;
    finishedAt:string; outcome:string; current:boolean};
  error: string | null;
};
```

Diff tracked staged/unstaged tính theo nền main HEAD hoặc merge-base workspace với main; untracked đếm riêng, không bịa số dòng/binary. Tối đa 20 path và 8192 ký tự cho phần facts trong prompt; thiếu thì cắt danh sách kèm nhãn, không cắt SHA/revision thành giá trị giả. Task list có thẩm quyền vẫn ở phần Bảng task; không cần lặp cả title/spec trong facts. `taskVerification` là map theo task ID, kèm revision đã đánh giá; chỉ ghép vào board có cùng revision, lệch thì để chưa xác minh. “Check gần nhất” lấy trong đúng workspace/agent đang chạy (merge có nguồn workspace đó cũng được), luôn ghi nguồn/thời điểm, `current:false` nếu chưa khớp; null hiển thị “chưa có”. Không chạy check/CLI model để thu facts.

Sau commit và ghi task updates, main dựng snapshot facts cuối lượt, nối vào cùng kho userData mục 2: `{version:1,kind:'handoff-facts',id,agent,workspaceId,runId,facts:AppFacts}`. Snapshot có nguồn/thời điểm riêng; prompt phiên sau dựng lại facts hiện tại và có thể trích snapshot cuối lượt nếu cần, không gọi snapshot đó là hiện tại. Không đăng thêm bubble chat cho facts và không tăng totals. App ghi facts dù agent không trả handoff hợp lệ; lỗi lấy Git không làm mất lời trả lời/handoff, trả unavailable. Lỗi lưu snapshot chỉ báo lưu bàn giao thất bại, không biến check pass khác thành fail.

Giữ file handoff 3–5 dòng/version 1 và validation hiện có; chỉnh hướng dẫn agent tập trung quyết định, cách đã thử không thành, blocker và bước kế. Không nhồi JSON facts vào file đang giới hạn 4 KiB, không nối facts vào memory.md, không gọi thêm lượt AI để tóm tắt. Fresh/resume đều có facts mới; ghi rõ dữ kiện app và ghi chú model là hai nguồn khác nhau. Dự án không Git trả null/no-git, không coi chưa Git là lỗi blocking.

## 7. G6 — Chi phí lượt lỗi

Tách hạch toán khỏi nhánh `result.outcome==='success'` của `recordChainTurn`. Hạch toán đúng một lần theo job.runId cho **mọi terminal outcome**, trước khi xét tiến triển/route; kể cả lượt lỗi, bị Dừng, timeout, lỗi audit hay lỗi ghi terminal. `finishWaiting` không spawn có usage 0 đã biết; summary không có chain không tự tạo chain. Dùng tổng usage cuối của core (đã cộng retry/command continuation), không cộng từng phần rồi cộng tổng lần nữa.

Chỉ cộng số hữu hạn không âm. Null/thiếu/sai/partial làm `chain.costIncomplete=true`, không tính giá trị giả vào tổng. Thêm `{costUsd:number,costIncomplete:boolean}` vào `chainInfo`, cùng dữ liệu open.active/progress và metadata chain-stop. Giữ costCeiling so với **phần chi phí đã biết** trước route tiếp; không coi unknown là miễn phí. FE hiện “Chi phí chuỗi chưa đủ dữ liệu” trong chi tiết thanh chạy/thông báo dừng khi có cờ; không phát nhiều tin cảnh báo lặp.

Giữ ledger tổng box/timeline ở reducer log, không cộng thêm CheckRecord/handoff-facts. Không thay đổi hành vi không route sau error/Stop; chuỗi có nhánh khác còn chạy vẫn dùng tổng đã cập nhật. Trần hiện tại vẫn là trần mềm sau lượt, có thể vượt khi đang chạy song song; đặt trước ngân sách và cờ CLI là việc đợt sau. Tiếp tục giữ semantics tạo chuỗi mới có bộ đếm mới như hiện tại.

## 8. Phân công và tích hợp

| Task | Trách nhiệm |
| --- | --- |
| T47 dev-be | core/main/preload: parser/schema/reducer, kho hồ sơ, reorder review/queue, gate/trust/khóa, resolver verification + IPC, cảnh báo diff, prompt/facts, hạch toán cost. Không thêm dependency. |
| T48 dev-fe | renderer.js/index.html: badge và chi tiết bằng chứng, cảnh báo test, lý do duyệt, guard async/keyboard/theme; nhãn costIncomplete của chuỗi. Không sửa schema backend để tự bù thiếu dữ liệu. |
| T49 QA | Nghiệm thu sau cả hai đã gộp; kiểm hành vi qua main harness/repo tạm, không chỉ grep field và không dùng task/repo thật làm fixture. |

Trong check.js: BE sửa assertion task/runner/main/prompt/cost cũ bị đổi contract, thêm `sprint11CoreChecks` và phần harness main riêng; FE thêm `rendererS11Checks` và chỉ sửa assertion UI liên quan. Không cùng sửa block test của nhau; QA bổ sung sau gộp. Các fixture trước đây cho agent tự done/PM done không approval phải chuyển sang luật mới hoặc ghi rõ là **log lịch sử**. Không giữ xfail/BUG cho ca bắt buộc.

PM cần kiểm phạm vi dev-be có core/main/preload/check.js và dev-fe có renderer/index/check.js; không cần agent sửa vùng userData thật khi phát triển. T46 chỉ ghi thiết kế/memory trong worktree của mình, không chép spec hay sửa nhánh PM. Root đang bẩn chỉ chặn gộp, không chặn hoàn tất thiết kế. Code gộp xong phải khởi động lại app.

## 9. Ca QA bắt buộc

| Nhóm | Kỳ vọng |
| --- | --- |
| Quyền/status | Agent thường tự done có/không approval đều bị chặn; PM/PM viết hoa đúng quyền; sai revision hoặc một phần tử sai làm cả batch không đổi; lời trả lời không mất. |
| Kiểu task/manual | Task manual và code không-worktree đóng có reason/reviewer; code worktree không dùng manual; tắt worktree sau review không bypass; acceptance đổi làm revision đổi; không đoán loại task từ tên QA/report. |
| Liên kết | Một agent có hai task chỉ review một → task kia không được gắn; TaskRef khác id/createdAt/assignee/definitionRevision/box đều không dùng được; task xóa/tạo sai danh tính không tái dùng evidence. |
| Revision | doing→review không tự làm check vừa liên kết thành stale; sửa định nghĩa/reopen/bàn giao code mới làm cổng đòi dữ kiện phù hợp; hai PM request cùng revision chỉ một thành công. |
| Squash/sync | Source SHA không là ancestor main vẫn duyệt đúng candidate đã publish; sync worktree sạch sang main không báo stale sai; candidate chưa publish/queue alreadyMerged thiếu check không ready. |
| Freshness | Agent sửa thêm sau check (tracked/untracked/commit mới), main sửa artifact/test/config/deps, đổi policy, job/orphan đang chạy → không ready; main chỉ đổi file không liên quan không chặn vô cớ; paths thiếu phải so cả cây. |
| Runner | Có/không tasks; task sai quyền/revision không chạy; native CLI báo pass không tạo hồ sơ; dirty tree/lệnh sửa cây/orphan không đủ đóng code; record lưu trước model tiếp tục sửa; 3 lệnh cùng SHA mới được hợp bộ policy. |
| Queue | Review + queue chỉ chạy check một lần; queue fail/Stop/timeout lưu đúng; retry đổi HEAD không copy binding cũ; main tiến lên dựng candidate khác tạo record khác; không chọn pass cũ che fail mới. |
| Khôi phục | Crash giữa review record/task event/giải phóng queue; hồ sơ thiếu/hỏng/truncated; publish thành công nhưng ghi hồ sơ lỗi; append task lỗi. Không tự tạo pass, không kẹt pending vô hạn, không tăng totals sai. |
| Legacy | tasks.json/log/session/handoff/queue cũ đọc được; done cũ giữ done/legacy; review cũ không có bằng chứng hiển thị rõ; không sửa hàng loạt lịch sử hoặc quyền agent. |
| Test warning | Sửa/xóa/rename check.js; scripts package.json; test/config mẫu; path độc hại bị chặn; file main mang vào không gán nhầm; sửa test chỉ cảnh báo, không cấm. |
| Prompt/facts | Fresh/resume/fallback có luật đúng vai, task/evidence hiện tại; no-git null; diff binary/untracked; limits và timestamp; snapshot cuối lượt sau commit/task event; không ghi facts vào memory/handoff model. |
| Cost | success/error/stopped/timeout mỗi lượt chỉ cộng một lần; retry tổng không cộng đôi; null/NaN/âm/partial đánh dấu thiếu; summary/queued zero; lỗi audit/append vẫn hạch toán; nhánh song song dùng cost chung. |
| FE/IPC | Không có API/nút tự done; chỉ mainFrame đọc đúng project; output `<script>` là chữ; stale IPC đổi box bị bỏ; lỗi backend không hiện ready; spec/report mở viewer đúng scope; badge/cảnh báo/reviewer có chữ, dùng phím, theme sáng/tối. |

Dev chạy `npm run check` và `git diff --check`; QA chạy lại sau đủ hai nhánh, thử Electron thật cho tương tác/focus/theme. Không tự gọi CLI trả phí chỉ để có kết quả nghiệm thu. T46 chỉ kiểm tính nhất quán tài liệu/schema ví dụ và whitespace; không tuyên bố sản phẩm đã đạt.
