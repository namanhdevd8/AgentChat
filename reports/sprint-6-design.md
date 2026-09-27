# Sprint 6 — Contract T14: lịch sử và Git worktree

Tech Lead · 2026-09-27 · Theo [spec PM](sprint-6.md). BE làm T15/T17, FE làm T16/T18 song song theo mục 5; QA làm T19 sau hai bàn giao. Đây là thiết kế, chưa phải kết quả nghiệm thu tính năng.

## 1. Các quyết định chung

- Giữ `log.jsonl` nguyên bản làm nguồn lịch sử, usage và sự kiện task. Chỉ mục trong bộ nhớ, đọc tăng dần và phân trang; không thêm database, search service hay dependency.
- Tách `projectRoot` (realpath box, dữ liệu chung) khỏi `cwd` (nơi CLI/command sửa code). Không gọi `core.run(worktree, agent)` rồi vô tình tạo một box khác.
- H mặc định tắt. Không khởi tạo Git trong lượt thiết kế/triển khai này. Dự án hiện chưa có Git; nút trong Cài đặt phải được người dùng chủ động xác nhận sau khi xem thao tác cụ thể.
- H bật: source mỗi agent ghi nằm riêng, metadata `.chat` vẫn chung. Giữ scope/audit; đây không phải sandbox ngăn tuyệt đối mọi công cụ ghi ngoài scope. Giữ quyết định **không kill agent khi thoát app**, reservation và kiểm tra orphan qua restart.
- Dùng lại runner exact-allowlist, Stop/process group, usage, task revision, Markdown viewer và scheduler hiện có. Giữ task dạng cây chỉ xem; không khôi phục `setTaskStatus` hay kéo thả.

## 2. Dữ liệu và quyền ghi

| Nơi lưu | Chủ ghi | Nội dung |
|---|---|---|
| `.chat/log.jsonl` | main/app | Giữ schema cũ; thêm metadata summary/workspace/merge do app tạo |
| `.chat/summary.md` | main/app, kết quả lượt PM | Checkpoint và Markdown tóm tắt, ghi nguyên tử |
| `.chat/project.json` | main qua Cài đặt | Cấu hình box dưới đây |
| `.chat/worktrees.json` | main/app | Target ref, workspace registry và merge queue bền vững |
| `.chat/worktree-sessions.json` | core/app | Phiên CLI theo workspace; không ghi đè phiên cũ ở root |
| `.chat/locks.json` | main/app | Migration v2 thêm loại workspace/pgid, vẫn đọc v1 |
| `.chat/memory.md`, `.chat/tasks.json` | Quyền như hiện tại | Chung cho mọi worktree; tasks vẫn do PM ghi định nghĩa |

```json
{"version":1,"autoSummary":true,"worktreesEnabled":false,"mergeChecks":["npm run check"]}
```

Thiếu file/field dùng mặc định; sai kiểu báo lỗi cấu hình, không âm thầm bật H hoặc mở quyền. `mergeChecks` dùng validator S5, không rỗng khi bật H, tối đa 20 lệnh; mỗi lệnh phải nằm trong `allowedCommands` của agent có commit được gộp. Từ chối đổi H/checks khi còn job, orphan sống/chưa rõ hoặc integration đang chạy. Tắt autoSummary được ngay, hủy lượt summary chờ/chạy bằng Stop hiện có.

App ghi JSON qua temp cùng thư mục rồi rename; không tự phục hồi file hỏng bằng cấu hình rỗng. Những file app sở hữu và temp tương ứng được loại khỏi scope snapshot. Không loại `memory.md`/`tasks.json` khỏi audit. Không thêm quyền trực tiếp sửa registry cho agent. PM không cần scope ghi `summary.md`: PM sinh nội dung, app kiểm tra và lưu.

## 3. F — Lịch sử, tìm kiếm, tóm tắt

### 3.1. Một chỉ mục dùng chung

Đặt `getLogIndex(root)` tại core. Lần đầu scan bất đồng bộ bằng stream một lần, sau đó đọc phần append; `appendLog` chỉ cập nhật cache sau khi append đĩa thành công. Dùng `original-fs` trong Electron như snapshot hiện tại. Không thêm sidecar index bền vững ở Sprint này.

- Mỗi dòng JSON không rỗng có `seq` từ 0; `total` là số record. `seq` chỉ là field trả IPC, không rewrite log cũ. Index giữ byte range, from/at, chuỗi tìm đã chuẩn hóa và hash prefix; đọc JSON đầy đủ bằng range khi cần page/prompt. Đọc UTF-8 đúng cả khi buffer cắt giữa ký tự.
- `prefixHash(n)` dùng SHA-256 trên chuỗi record có length prefix, không gồm separator/blank line; lưu digest ở mỗi n. Như vậy thêm newline vào record cuối cũ không làm sai seenHash/summary, vẫn phát hiện thay nội dung; cập nhật hash bằng stream tăng dần, không hash lại từ đầu mỗi lượt.
- `generation` là token của một phiên bản log, giữ qua append; thay file/truncate/sửa phần đã index thì đổi generation, rebuild, báo FE tải lại. Dùng file identity/size/mtime và watcher; append ngoài app phải xác minh prefix, không giả định mọi thay đổi dài hơn đều là append. App tự append không hash lại toàn file.
- Dòng cuối là JSON hợp lệ dù thiếu newline vẫn tính một record để tương thích log/seen cũ; app thêm separator trước append tiếp theo. Fragment JSON chưa hoàn tất: chờ refresh, chưa cấp seq và chưa cho app append đè/nối lên fragment. JSON lỗi đã hoàn tất: báo vị trí byte/seq lỗi, chặn append/prompt/task mutation trên log đó; không bỏ dòng, biến log thành `[]` hoặc dồn lại seq. Giao diện hiển thị prefix đọc được kèm `LogPage.error`, totals đánh dấu partialLog, không giả đây là toàn bộ lịch sử.
- Search tuyến tính trên text index cho 10.000 tin, yield giữa các batch để không chặn main. `ponytail:` chưa cần inverted index; chỉ thay khi đo thấy 10.000 tin không đạt ngân sách mục 7.
- Dùng index cho **mọi** caller: `open`, `prompt`, `exec`, `run`, `useSession`, task board và fallback lỗi; không chỉ sửa `open` rồi để các caller còn `readLog(root)` toàn bộ mỗi lượt. Giữ `readLog` như helper tương thích/check, không gọi nó trong đường nóng.

`sessions.seen` vẫn là **số record đã nhận**, không là byte offset. Chụp N ngay trước CLI đầu tiên: fresh/adopted nhận memory + summary hợp lệ + `[max(0,N-30),N)`; resume nhận **tất cả** `[seen,N)`, kể cả phần đã tóm tắt. Không đẩy `seen` đến cuối log sau command/retry: giữ `jobSeen` đầu lượt để không mất tin đến trong lúc agent chạy. Khi lưu seen, thêm `seenHash` của prefix đó để phát hiện rewrite cả sau restart; session cũ thiếu hash vẫn đọc tương thích và bổ sung ở lần lưu tới. `seen > total` hoặc hash sai: không đoán lại vị trí, đánh dấu phiên cần mở mới, giữ ID cũ để phục hồi thủ công. Không thay cách giữ phiên và checkpoint chi phí Claude.

Index duy trì hai reducer tăng dần:

1. **Usage cả box:** `{turns,tokens,costUsd,hasTokens,hasCost,tokensIncomplete,costIncomplete}` theo đúng `calcBoxTotals` hiện tại, 0 là số hợp lệ; lượt cũ thiếu usage vẫn làm tổng chưa đầy đủ. Task/system note không thành lượt tốn token. FE format số; không cộng lại từ page hoặc event `usage`.
2. **Task:** latest event theo `(id,createdAt,assignee)`, kể cả định nghĩa chưa được tải. Giữ validator metadata, anti-reuse ID, quyền PM, revision và last-good/error như S3/S4. Event assignee sai không che event đúng trước đó. `taskBoard` đọc definitions và chiếu reducer, không replay log. Validate revision → append sự kiện vẫn không có `await` chen giữa.

### 3.2. Tìm kiếm và cửa sổ chat

- Tìm substring literal trên `text`, không regex; trim query, tối đa 256 ký tự. NFD → bỏ Unicode marks → lowercase → `đ` thành `d`. Query rỗng trả trang kết quả rỗng; lọc sender bằng tên chính xác, gồm cả sender cũ không còn trong team.
- Kết quả mới nhất trước; cursor là vị trí log, không offset trong tập kết quả. Chụp `upper=total` ở query đầu; các trang tiếp theo cùng upper nên tin mới không làm trùng/bỏ kết quả. Đổi query/filter thì bỏ cursor. FE debounce 200 ms, dùng requestId + box để bỏ response cũ.
- Mapping highlight từ text chuẩn hóa về khoảng UTF-16 của text gốc, gồm grapheme dấu tổ hợp/emoji (`Intl.Segmenter`). Excerpt tối đa khoảng 240 grapheme, range tương đối với excerpt, end exclusive. FE dùng text node + `<mark>`, không nhúng HTML từ excerpt.
- `open` lấy 100 tin cuối; page giới hạn 1–100. FE giữ tối đa 300 tin/DOM, có tải trước/sau và “Về tin mới nhất”. Bấm search dùng page `around:seq`, gắn `data-seq` cho **mọi loại tin**, reset grouping, cuộn/tô sáng đúng tin.
- Duy trì viewport bằng seq anchor + offset khi thêm/bớt page. Chỉ theo tin mới nếu đang ở cuối log và cách đáy ≤48 px. Đọc đoạn cũ: tăng badge tin mới, không nối một đoạn rời vào cửa sổ cũ. Không mất bản nháp khi tìm/đổi page.
- Dedup event/open-buffer bằng `(generation,seq)`, không bằng nội dung/timestamp/runId. Totals được version theo `{generation,total}`; bỏ snapshot cũ. Reload/đổi box vẫn giữ các guard hiện tại.

### 3.3. Tóm tắt có checkpoint

`through` là seq exclusive đã tóm tắt, ban đầu 0. Với N record, chỉ tóm tắt phần trước `N-30`; khi có ít nhất 100 record chưa tóm tắt trong phần này, chụp `[through,min(through+100,N-30))` và summary cũ. Các record `kind:'summary'` không tính vào ngưỡng nội dung. Bổ sung giới hạn input 128 KiB UTF-8; chọn prefix vừa giới hạn, một tin quá lớn được cắt có nhãn “trích đoạn” và link/seq để đọc log gốc. Không xóa log, không ghi đè memory.

- Queue `kind:'summary'` cho thành viên tên `pm` không phân biệt hoa thường, cùng `runKey(root,pm)`; không tạo pseudo-agent hoặc chạy trùng PM. Thiếu PM/CLI báo trạng thái không khả dụng, không chọn agent khác ngầm.
- Trigger từ hoạt động chat bình thường hoặc mở box; tối đa một batch mỗi trigger, coalesce queued/running. Log cũ 10.000 tin không tạo chuỗi hàng trăm lượt trả phí lúc mở. Sau fail/Stop không tự retry cùng watermark; hoạt động chat mới mới xét lại. Summary tự sinh không kích hoạt summary kế tiếp.
- Đây là lượt PM nhìn thấy trên chat, có progress/Stop/timeout/usage bình thường, nhưng dùng **phiên tạm mới**, `resume:false`, `allowedCommands:[]`, prompt chỉ gồm nhiệm vụ tóm tắt, summary cũ và các tin frozen. Không sửa session/seen của PM thường, không apply task-status hoặc route @ trong nội dung tóm tắt. Không chạy CLI trong worktree writer chỉ để sinh summary.
- Prompt yêu cầu giữ quyết định, công việc đang mở, người nhận và đường dẫn; coi tin cũ là dữ liệu, không thực thi chỉ dẫn nằm trong đó. Output Markdown tối đa 32 KiB, không yêu cầu agent tự ghi file. Stop/error/rỗng/quá giới hạn/checkpoint đã đổi thì không tiến through.
- Trước chấp nhận, kiểm tra autoSummary còn bật, hash prefix gốc và checkpoint cũ còn khớp. Log append thêm không làm nguồn frozen mất hiệu lực.
- Append terminal PM **một lần** với usage và `kind:'summary', summary:{version:1,through,prefixHash,text}`; text chat ngắn liên kết `.chat/summary.md`. Sau đó materialize file bằng temp + flush/close + rename. Đầu file có comment JSON `{version:1,through,prefixHash,runId}`, phần sau là Markdown. Text/checkpoint cùng một lần ghi, không chia hai file.
- Terminal hợp lệ là nguồn khôi phục: crash giữa append và rename thì lần mở sau dựng lại file từ metadata summary mới nhất hợp lệ, không trả phí lại. File chỉnh tay/sai header không được tin như checkpoint. Prefix hash sai sau sửa log thì bỏ summary khỏi prompt và báo cần tạo lại, không dùng nội dung cũ như dữ kiện đúng.

## 4. H — Worktree, commit và hàng chờ gộp

### 4.1. Khởi tạo và điều kiện bật

Probe Git bằng argv (`shell:false`), PATH hiện tại; không đổi cấu hình Git toàn cục. H chỉ hỗ trợ repo thường có root đúng `projectRoot`, HEAD có commit, attached branch, không có merge/rebase/cherry-pick dở, không sparse checkout/submodule. Không tự dùng repo cha của thư mục đã chọn. Điều kiện này hiện rõ trong ⚙ trước khi bật.

Nếu chưa có repo: nút “Khởi tạo Git” mở preview. Hiển thị danh sách file dự kiến đưa vào commit đầu, `.gitignore` sẽ thêm và nhánh `main`; bỏ `.chat/`, `node_modules/`, `dist/`, `.DS_Store`, `.env*`/khóa riêng khỏi mặc định. Người dùng xác nhận **“Khởi tạo và tạo commit đầu”** cho đúng file đã chọn; mọi thay đổi từ lúc preview làm token hết hạn. Thực thi `git init`, stage literal file đã duyệt và commit đầu; không `git add .`, không thêm secret/build/runtime ngầm. Không sửa/xóa `.gitignore` cũ: hợp nhất phần thiếu, preview nội dung trước. Dùng identity cục bộ cho mỗi lệnh commit nếu máy chưa có identity. Lỗi giữ repo/files để người dùng xử lý, không xóa `.git` để giả rollback. Init không tự bật H.

Repo có sẵn: yêu cầu sạch cả index, tracked và untracked (ngoại trừ ignored), không file `.chat` đang tracked. `.chat` tracked → chặn với hướng dẫn, không tự `git rm --cached`. Probe ban đầu bỏ qua đúng runtime app sẽ exclude; khi người dùng bật, thêm/kiểm chứng exclude **trước** kiểm tra sạch cuối cùng, để `.chat` do `core.init` tạo không tự làm mọi repo bị từ chối. Bật H chỉ khi không có job/orphan/integration; lưu **branch hiện đang checkout** làm `targetRef`, không giả định tên main. Đổi branch ngoài app làm hàng chờ dừng, không tự checkout lại.

Khi bật, thêm ignore runtime cần thiết vào `.git/info/exclude` theo block idempotent, giữ nội dung cũ; kiểm tra hiệu lực với Git trước khi tạo symlink. Ignore không cho phép âm thầm bỏ qua một source vốn tracked. Main bẩn chỉ chặn gộp; các lượt agent độc lập vẫn có thể tiếp tục làm việc khi H đã bật.

### 4.2. Workspace và dữ liệu chung

```text
app.getPath('userData')/worktrees/<sha256(realProjectRoot)>/
  agents/<workspaceId>/       # worktree bền vững, một writer/agent
  integration/<queueId>/      # worktree detached kiểm tra, từng cái một
```

Branch app quản lý: `agent-chat/<boxKey>/<workspaceId>`; validate ref, không force chiếm nhánh/trùng đường dẫn của người dùng. `workspaceId` ổn định theo registry, không lấy raw tên agent làm đường dẫn. Dùng `git worktree add`, xác minh common git dir và realpath của workspace lúc mở/restart. [Git worktree](https://git-scm.com/docs/git-worktree) hỗ trợ nhiều working tree của cùng repo và detached worktree để thử thay đổi.

- Mọi writer kể cả PM/QA nhận workspace riêng; readOnly dùng root, không auto commit. Registry lưu `{id,agent,branch,path,baseSha}`. Không tạo workspace của mọi người trước khi cần.
- Writer workspace có `.chat` symlink tới **canonical `.chat` duy nhất**, là runtime ignored, không commit symlink hay nội dung này. Link có sẵn sai target thì chặn, không thay ngầm. Scope vẫn normalize theo projectRoot để không bị cơ chế chặn symlink hiểu nhầm quyền PM.
- CLI cwd và app `run-command` là workspace; prompt ghi rõ code ở cwd, `.chat` dùng chung, link report là relative trong workspace. Với CLI giới hạn write roots, chỉ thêm canonical `.chat` bằng khả năng `--add-dir` của adapter, không thêm cả projectRoot hoặc tắt sandbox. Help local của Claude/Codex/agy đều có `--add-dir`; Codex đặt option ở phần `exec` **trước** subcommand `resume`. BE phải smoke cả fresh/resume, không chỉ nối cờ vào sau resume. Quyền này không thay scope/app-owned-file rules.
- Không đưa symlink live `.chat` vào integration workspace chạy test. Nếu check cần `.chat`, nó phải dùng thư mục test riêng/fixture; không sửa chat thật để làm check xanh.
- Không share mutable `node_modules` bằng symlink giữa source/check. Với dự án npm hiện tại, bootstrap bản sao riêng từ root khi `package.json` và lockfile khớp nội dung commit; dùng copy native/reflink nếu có, giữ relative symlink nội bộ. Link ra ngoài dependency tree phải báo cần chuẩn bị dependencies, không lặng lẽ trỏ root. Không network install tự phát. Lock/manifest đổi hoặc thiếu deps: trạng thái `needs-deps`, cho cấu hình lệnh chuẩn bị được phép (ví dụ `npm ci` trước `npm run check`) trong mergeChecks/allowlist. Không báo check thành công chỉ vì chưa có deps.
- Session root hiện tại giữ nguyên trong `sessions.json`; session H lưu theo workspaceId ở `worktree-sessions.json`, gồm ID/seen/CLI/cost checkpoint như hiện tại. Bật H lần đầu tạo phiên mới (memory + summary + 30 tin), không resume phiên root trong cwd mới. `sessions`, `cliSessions`, `useSession`, `resetSession` thao tác context đang chọn; tắt H trở về phiên root, không xóa hai bên.

### 4.3. Khóa, audit, commit

H tắt giữ S2. H bật bỏ xung đột **source lock giữa các workspace khác nhau**; cùng agent/workspace vẫn chạy tuần tự. Ngoại lệ cần thiết cho spec: `.chat` không được Git tách ra, nên giữ khóa theo các path metadata dùng chung (`memory.md`, `tasks.json`/temp…) mà agent được quyền ghi. Không lấy cả `.chat/**` làm khóa cho mọi agent khiến FE/BE lại tuần tự. App vẫn là writer duy nhất cho log/session/status/summary.

Snapshot source trong cwd (loại `.git` cả file lẫn directory, `.chat` symlink, node_modules/dist/.DS_Store như cũ); audit metadata từ canonical root riêng. Báo vi phạm vẫn “chưa xác định tác nhân” với shared metadata có tác nhân khác. Snapshot lỗi chỉ cảnh báo như S2, **nhưng không tự commit/gộp khi chưa xác minh được tập file và scope**.

Trước lượt: branch đúng, không Git operation dở, không dirty lạ/staging sẵn. Nếu workspace sạch và HEAD đã là ancestor của target, fast-forward workspace đến target mới. Nếu có commit riêng chưa gộp, giữ nguyên, không rebase/reset. Dirty do lượt trước được app ghi nhận có thể giao cùng agent sửa tiếp; dirt chưa rõ nguồn thì chặn publish và báo để người dùng xem.

Sau lượt:

1. Chỉ thao tác Git khi mọi process group của lượt đã chết; alive/unknown thành orphan. Xác minh HEAD/branch không bị agent/editor đổi bất ngờ và đối chiếu thay đổi với snapshot/scope.
2. Stage **chỉ** các path nguồn hợp lệ thuộc lượt, gồm xóa/rename (kiểm tra cả đầu cũ/mới), dùng NUL/literal pathspec, không nhận option Git từ tên file. Không stage `.chat`, ignored artifacts hoặc thay đổi của End-User ở root.
3. Commit nếu có thay đổi nguồn; message `agent <name> [task ids]: <mô tả ngắn>`, lấy task ID có thật, không đoán task chỉ từ một token trong prose. Ghi runId trong trailer để phục hồi/dedup. Không commit rỗng khi chỉ chat hoặc cập nhật task chung.
4. Success → enqueue **SHA vừa commit** (hoặc HEAD chưa gộp của lượt sửa tiếp), không enqueue một tên branch có thể đổi sau đó. Stop/error có thay đổi hợp lệ → checkpoint commit riêng, đánh dấu chưa được duyệt, **không tự merge**. Ngoài scope/audit lỗi → giữ nguyên file và báo, không auto commit một phần rồi công bố cả lượt đã gộp.
5. Lượt sau có thể tiếp tục nhánh khi SHA cũ đang chờ check; checker chỉ dùng SHA frozen. Không tự xóa branch, reset hard, clean hay bỏ commit của agent/User.

Khóa v2 thêm `{workspaceId,kind:'agent'|'integration',cwd}`; derive/verify cwd từ registry và managed base, không tin đường dẫn ngoài root bất kỳ từ JSON. V1 còn sống/chưa rõ vẫn chặn chuyển mode. Thoát app không kill; startup không commit/merge lại khi pgid chưa xác minh chết. Git journal và runId giúp không tạo hai commit sau crash.

### 4.4. Merge queue

Registry `worktrees.json` schema v1 chứa `{targetRef,agents,queue}`. Entry tối thiểu: `{id,agent,runId,workspaceId,headSha,checks,state,baseSha,candidateSha,error,pgid,createdAt,updatedAt}`. Một worker integration cho mỗi repo; mọi mutation Git do app phát ra được tuần tự hóa với prepare/commit cùng workspace. Persist state **trước** spawn/mutation có thể bị crash.

Luồng `queued → merging → checking → publishing → merged`; trạng thái dừng gồm `blocked-dirty`, `blocked-config`, `needs-deps`, `conflict`, `check-failed`, `paused`, `error`. Entry lỗi không cản entry độc lập tiếp theo; mỗi entry frozen vẫn theo thứ tự enqueue khi đủ điều kiện. Bỏ job duplicate theo `(runId,headSha)`.

1. Xác minh target branch vẫn checkout, tree/index sạch, không untracked chưa ignore. Chụp **B = target SHA**, **H = entry.headSha**, đóng băng check list và quyền. H đã được chứa trong target → mark merged không tạo commit lại. Kiểm tra toàn bộ phần diff riêng của H kể từ merge-base với target còn trong scope được duyệt; không chỉ kiểm tra commit cuối rồi cho lọt commit ngoài scope có sẵn trên nhánh.
2. Tạo integration worktree detached ở B. Merge H bằng `--no-ff --no-commit` (không autostash), tạo candidate commit **M** nếu không conflict. Identity app cục bộ; không chạy shell tùy ý lấy từ metadata. Conflict giữ target/User hoàn toàn nguyên, lưu file xung đột và báo owner.
3. Chạy tuần tự **đúng** entry.checks bằng runner S5 trong integration cwd, quyền còn nằm trong allowlist hiện tại của owner. Không dùng câu trả lời LLM để suy ra exit code. Giới hạn output 32 KiB/lệnh, drain đủ, timeout theo cấu hình agent, lưu bằng chứng exit/signal/duration. Check không tốn token CLI.
4. Tất cả exit 0 **và** HEAD vẫn M, source/index không phát sinh thay đổi tracked hoặc untracked ngoài ignore → mới được publish. Check sửa source thì `CHECK_MUTATED_TREE`; không tự commit phần vừa sửa mà chưa test. Thiếu/lỗi command/Stop/timeout/config thay đổi → không publish.
5. Trước publish, xác minh lại targetRef, clean tree/index, B và cấu hình kiểm tra. Target đã tiến lên → dựng candidate mới, **chạy check lại**; không dùng kết quả xanh của M cũ. Root bẩn → `blocked-dirty`, giữ kết quả nhưng phải kiểm tra lại điều kiện khi retry.
6. Cập nhật root bằng `git merge --ff-only --no-edit --no-overwrite-ignore --no-autostash M`. Không `reset --hard`, force, tự stash hoặc `update-ref` riêng khiến HEAD và working tree lệch nhau. Kiểm tra branch/HEAD/kết quả sau lệnh rồi mới ghi merged. `--ff-only` từ chối lịch sử phân nhánh; `--no-overwrite-ignore` từ chối đè file ignored cản checkout. [Git merge](https://git-scm.com/docs/git-merge) mô tả các điều kiện này.

Không hứa khóa được editor/Git bên ngoài: kiểm tra sạch trước/sau và để Git từ chối overwrite. Nếu external write/branch switch xảy ra trong cửa sổ publish, giữ nguyên dữ liệu, đánh dấu cần kiểm tra và dừng worker; không rollback tự động để che race. Không bật hooks/bypass quyền mới; repo scripts/checks vẫn là code của dự án với quyền app như S5.

Crash recovery: nếu candidate đã là ancestor của target thì hoàn tất journal, không merge lần hai. Nếu check đang chạy trước crash, đợi pgid chết/được xử lý rồi coi kết quả cũ chưa xác định, chạy lại. Giữ worktree lỗi để xem; chỉ dọn integration app sở hữu khi hết process, state cuối và không có thay đổi cần giữ. Không auto prune/xóa worktree của User.

**Thông báo và sửa lỗi:** post system event có `kind:'merge'`, queueId, owner, SHA, lý do, file/log excerpt; hiển thị `@owner` ở đầu dòng và không lặp cùng lỗi/HEAD/base. Giữ quy tắc S5: system text không tự route. Có nút **“Gọi agent sửa”** tạo một lượt thường của đúng owner kèm diagnostic; đây là hành động rõ ràng, không một vòng AI tự sửa conflict ngoài phạm vi sprint. Agent/User sửa trên branch của owner, xong lượt mới tạo SHA mới; không copy nguyên integration tree đè workspace, không chọn ours/theirs tự động. Nếu cần hoàn tất một merge thủ công đang dở, BE chỉ nhận khi index không còn unmerged paths và scope hợp lệ; nhắc agent/User thực hiện bước Git đó, không âm thầm abort công việc đang làm.

FE có “Thử gộp lại” cho lỗi điều kiện/check đã khắc phục, enqueue lại SHA hiện tại hợp lệ sau validation, không ép dùng một candidate cũ. `stopMerge` hủy entry đang chờ hoặc dừng process group check và chuyển `paused`; không Stop/rollback giữa thao tác Git đang commit/publish, khi đó trả `BUSY` và canStop=false. Tắt H khi idle: pause queue, giữ mọi workspace/commit/session; bật lại xác minh target rồi resume, không bỏ commit chưa gộp. Không đổi/xóa tên agent có workspace/pending queue chưa xử lý mà không chỉ rõ nhánh còn lại; v1 từ chối thao tác đó và hiện lý do.

## 5. Contract FE/BE

API mới trả `{ok:true,...payload}` hoặc `{ok:false,error:{code,message}}`; không trả stack/env/absolute managed paths trong lỗi. Validate sender và knownProject cho tất cả IPC; enum/limit/cursor/ref do BE kiểm tra. Mọi event tiếp tục có `dir` canonical, không đổi box theo cwd.

### 5.1. Log/search

```ts
// Message = schema log hiện tại + seq:number; seq không ghi ngược vào log.
type LogPage = {
  generation:string, total:number, start:number, end:number, // [start,end)
  messages:Message[], hasBefore:boolean, hasAfter:boolean,
  error:null|{code:'LOG_CORRUPT'|'LOG_INCOMPLETE',message:string,byteOffset:number,seq:number}
}
type Totals = {
  generation:string, total:number, turns:number, tokens:number, costUsd:number,
  hasTokens:boolean, hasCost:boolean, tokensIncomplete:boolean, costIncomplete:boolean,
  partialLog:boolean
}
api.open(dir)
// Giữ các field team/active/orphanLocks; bỏ log toàn bộ, thêm:
// {history:LogPage, totals:Totals, settings:ProjectSettings, settingsRevision:string}
// open giữ kiểu success hiện tại; lỗi không đọc được file reject;
// log có prefix đọc được trả history.error, total là count của prefix, partialLog=true.
// FE/BE thay cùng release.

api.logPage(dir, {generation?, before?, after?, around?, limit?:number})
// => {ok:true,page:LogPage}; tối đa 1 position; không có position = mới nhất.
// before b lấy seq < b; after a lấy seq > a; around a phải chứa a; limit mặc định 100.

api.searchLog(dir, {generation?,query,from?:string|null,before?,upper?,limit?:number})
// => {ok:true,generation,upper,results:[{seq,from,at,excerpt,matches:[start,end][]}],
//     nextBefore:number|null, senders:string[]}
// before/upper exclusive; mặc định upper=current total; limit 1..50, mặc định 50.
```

Lỗi chung `LOG_CHANGED`, `LOG_CORRUPT`, `INVALID_ARGUMENT`; `LOG_CHANGED` làm FE tải lại cursor, không tự nhảy sang tin khác. Khi log lỗi, page cho xem prefix kèm error; search/append/prompt trả lỗi cho tới khi log hợp lệ, không trả kết quả tìm thiếu như đầy đủ. `message(dir,msg,meta)` thêm arg thứ ba `{generation,total,totals}` và `msg.seq`; signature hai arg cũ vẫn không làm listener vỡ. `log-reset(dir,{generation})` yêu cầu invalidate page/search/totals. `progress/status/usage` giữ contract; totals chỉ từ history/message, không từ usage.

### 5.2. Cài đặt, Git, viewer

```ts
type ProjectSettings = {version:1,autoSummary:boolean,worktreesEnabled:boolean,mergeChecks:string[]}
api.projectSettings(dir) // => {ok:true,settings,revision}
api.saveProjectSettings(dir, {expectedRevision,settings}) // => như trên
api.worktreeState(dir) // => {ok:true,state:WorktreeState}
api.prepareGitInit(dir) // => {ok:true,token,files:string[],ignoreText:string,branch:'main'}
api.initGit(dir, {token,files:string[]}) // chỉ subset đã preview => {ok:true,state}
api.retryMerge(dir, {queueId}) // => {ok:true,state}
api.stopMerge(dir, {queueId}) // => {ok:true,state}; khi canStop=true
api.requestMergeRepair(dir, {queueId}) // => {ok:true,runId}; dedup request khi owner đã nhận
api.cliSessions(cli, dir, agentName) // giữ kiểu trả hiện có, lọc theo cwd của agent
api.useSession(dir, name, cli, id, workspaceId) // workspaceId=null khi H tắt

type WorktreeState = {
  revision:number, enabled:boolean, available:boolean, reason:string|null,
  targetBranch:string|null, targetSha:string|null, dirty:boolean,
  agents:{name:string,workspaceId:string,branch:string,ahead:number,busy:boolean}[],
  queue:{id:string,agent:string,headSha:string,state:string,label:string,
         error:null|{code:string,message:string,files:string[],log:string},
         canRetry:boolean,canRepair:boolean,canStop:boolean}[]
}
// ahead = số commit HEAD riêng chưa thuộc target, không là số file.
// state không lộ pgid/env/token hay đường dẫn tùy ý từ registry.
```

Settings revision là hash nội dung; `CONFLICT` → reload, không ghi đè cấu hình mới. Các lỗi thao tác gồm `BUSY`, `GIT_MISSING`, `NOT_REPO`, `UNBORN_HEAD`, `UNSUPPORTED_REPO`, `DIRTY_ROOT`, `TARGET_CHANGED`, `TRACKED_RUNTIME`, `CHECK_NOT_ALLOWED`, `NEEDS_DEPS`, `STALE_PREVIEW`. FE hiển thị message BE; không suy đoán lỗi từ exit text.

Picker phiên trong ⚙ cache theo `(dir,agentName,cli,workspaceId)`, không còn chỉ theo CLI. BE derive cwd từ tên agent/registry; nhận session do CLI liệt kê đúng context đó và kiểm tra workspaceId còn đúng khi adopt. Client cũ thiếu agentName chỉ được dùng khi H tắt, không tự chọn một workspace bất kỳ. `useSession` không được đưa session root sang writer workspace khác.

`worktree-state(dir,state)` phát sau mutation/debounce thay đổi Git; revision tăng đơn điệu trong một lần app chạy, FE chỉ dùng snapshot mới cho box hiện tại, reset khi reopen. `project-settings(dir,{settings,revision})` cập nhật toggle. Settings bật H thành công cũng phát state; mở popup/queue luôn tải state mới. Không chạy Git full-status đồng bộ mỗi progress token.

Viewer mở report chưa gộp: terminal writer thêm `workspace:{id,branch,headSha}` do app tạo. Mở link từ tin đó truyền `workspaceId` optional vào `readProjectFile(dir,href,fromFile,workspaceId)`, `openFile(dir,file,workspaceId)`, `watchProject(dir,file,workspaceId)`. BE chỉ map ID đã đăng ký của box tới cwd, giữ containment/realpath/size/UTF-8 validator S3; không nới ra mọi file ngoài project. `.chat/...` luôn map canonical metadata bằng whitelist hiện có. Link tương đối tiếp tục trong cùng workspace, viewer ghi “Nhánh … · chưa gộp”; đây là file hiện tại trên nhánh, không cam kết nội dung lịch sử tại SHA. Danh sách file chung vẫn là root đã gộp. External http/https giữ IPC hiện có.

## 6. FE, migration và chia việc

- T16: header search + sender filter + list kết quả, đọc page/anchor/badge, stats từ totals, toggle autoSummary. Result dùng list/button focus được, Enter mở, Esc đóng; aria-live cho loading/error, không đọc 10.000 kết quả. Không để search nuốt Enter của composer/IME.
- T18: H toggle và mergeChecks trong ⚙, preview init rõ thao tác; popup avatar thêm branch/ahead. “Hàng chờ merge” là một disclosure gọn trong sidebar hiện tại, không thay checklist bằng một bảng lớn nữa. Trạng thái lỗi có chi tiết file/log, Thử gộp lại/Gọi agent sửa/Dừng kiểm tra theo cờ BE, disable khi đang gửi; guard box/request cho mọi promise. Picker session dùng context workspace như mục 5.
- T15: index/reducers, paging/search, summary lifecycle và config; giữ check S1–S5. T17: cwd/session split, Git/workspace/queue, ignore/bootstrap dependencies, safe viewer context và IPC. Triển khai trong `core.js`, `main.js`, `preload.js` hiện tại; chưa cần module/framework mới. Nếu sau này tách module, phải bổ sung electron-builder `build.files` và phạm vi tương ứng.
- Mở dữ liệu cũ không rewrite log/session/agents/tasks. Config defaults dùng khi đọc; lần lưu đầu mới tạo project.json. H tắt không tạo Git/worktree. Locks v1 được đọc bảo thủ; ghi v2 khi có mutation hợp lệ. Summary thiếu thì prompt giữ hành vi cũ. Log index build lại từ dữ liệu gốc sau restart.
- H migration không tự chuyển trạng thái task sang done khi merge thành công; agent/PM vẫn quyết định review/done qua protocol như S4. Scope của fixture song song phải cho cả hai agent sửa file thử; không tự cấp BE quyền index.html thật chỉ để demo.
- BE bàn giao F IPC sớm để FE ráp, tiếp tục H; FE có thể mock đúng schema mục 5 trong khi BE làm. Mỗi bên báo PM một lần khi xong toàn phần, tự chuyển task sang review. PM nhận đủ T15–T18 rồi gọi QA T19; không gọi QA từ từng bàn giao nhỏ.

## 7. Kiểm chứng cần có trước nghiệm thu

QA tiếp tục `node check.js`/`npm run check`, dùng thư mục Git tạm ngoài dự án; không init/commit repo người dùng chỉ để chạy test. Dùng CLI giả cho lifecycle và check script giả exit 0/1 có marker cwd; không cần token/network cho các ca tự động.

| Nhóm | Ca bắt buộc |
|---|---|
| Index | 10.000 record UTF-8, append trong lúc page/search, same from/time/text vẫn khác seq; truncate/replace/corrupt/partial line; page không lệch seq, không đọc full log mỗi send/run/taskBoard |
| Search/UI | “khóa file” = “KHOA FILE”, đ/Đ, dấu tổ hợp/emoji đúng highlight; sender đã xóa; XSS excerpt; search trang sau không lặp khi có tin mới; bấm ra đúng loại tin system lẫn agent |
| Prompt/stats/task | Fresh đủ memory+summary+30, resume đủ unseen; tin tới giữa command/retry không mất; tổng full box không đổi theo page, không double usage; task revision/assignee/last-good giữ đúng |
| Summary | Ngưỡng giữ lại 30 tin; chỉ một PM job; đang bận/Stop/error/tắt toggle; restart giữa terminal/rename; prefix đổi; 10k backlog không sinh chuỗi trả phí; PM regular session không bị đổi |
| Git baseline | Off không tạo .git; init chỉ sau preview+confirm, preview stale bị chặn, secret không stage mặc định; repo dirty/unborn/parent repo/tracked .chat bị từ chối đúng lý do |
| Isolation | Hai writer cùng owns/file chạy đồng thời, source worktree độc lập; .chat chung, metadata scope vẫn đúng; fresh/resume mỗi CLI cwd đúng, context session/cost không lẫn; command check không chạy root |
| Commit/queue | Hai vùng cùng file merge qua check; cùng dòng conflict; check exit1/timeout/missing/deps lỗi giữ target; check sửa source bị chặn; queue SHA frozen dù owner tạo commit mới |
| Publish | Main dirty tracked/untracked, ignored file cản checkout, target tiến lên trong lúc check → không overwrite và phải recheck; User commit giữ nguyên; journal restart không gộp hai lần |
| Lifecycle | Stop trước commit/during CLI, orphan còn sống qua app exit, lock v1/v2, disable/re-enable giữ nhánh/phiên/queue; report chưa merge vẫn mở đúng workspace và chặn symlink escape |

Đo bằng log fixture 10.000 tin khoảng 1 KiB/tin trên máy nghiệm thu, không tính thời gian CLI/network: mở lạnh history ≤1 giây, append + trả IPC khi index nóng ≤100 ms, query ≤200 ms; DOM không quá 300 tin. Ghi số đo thực tế vào báo cáo QA; đây là mục tiêu nghiệm thu, chưa phải số đo đã đạt. Nếu không đạt, tối ưu đúng điểm đo trước khi đổi kiến trúc.

Thử tay sau restart app: tìm/bấm tin Sprint 2; đọc tin cũ khi có tin mới; tắt/mở summary và xem usage; H trên repo fixture với FE/BE cùng file, check đỏ, dirty root; popup/ahead/queue/report link. Kiểm tra `npm run dist` đóng gói đủ source và dependency hiện có khi phát hành; không thêm mạng/runtime dependency cho F/H.

## 8. Ghi nhớ chung

`Sprint 6 contract reports/sprint-6-design.md: log index append-only + seq/generation, page100/DOM300, totals/task reducer chung; PM summary app ghi checkpoint không xóa log; H opt-in, canonical .chat + cwd/session riêng, commit SHA frozen → check trong integration → ff-only khi root sạch; source lock tách theo worktree, metadata chung vẫn khóa; không tự git init/kill-on-exit/AI sửa conflict. BE T15/T17 và FE T16/T18 song song, PM nhận đủ rồi QA T19.`

Tech Lead đã nối dòng này vào `.chat/memory.md` khi bàn giao T14.

PM cập nhật hai điểm triển khai vào spec: khóa metadata chung là ngoại lệ cần thiết khi bật H; lỗi merge gọi đúng owner bằng thông báo và nút gọi lượt sửa, không sinh vòng AI giải conflict tự động. Không cần End-User quyết thêm để viết/ráp các phần đã giao; thao tác Git thực tế vẫn chờ xác nhận tại Cài đặt.
