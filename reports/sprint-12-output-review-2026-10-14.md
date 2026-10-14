# Sprint 12 — kiểm output thực của dev và lượt QA bị dừng

PM · 2026-10-14, đối chiếu đến khoảng 21:46 giờ Việt Nam. Main đang ở `b9b15cc`.

Thay đổi được kiểm: BE bổ sung phanh chuỗi, Tiếp tục bền qua restart, sự kiện merge và hotfix duyệt manual; FE bổ sung giao diện tương ứng. PM đọc transcript/lệnh thực, code trong hai worktree và contract, không lấy lời báo “đã pass” làm kết quả cho bản code mới hơn. Giả định sử dụng: một app Electron, nhiều agent chạy song song và có thể nhận hai IPC liên tiếp.

## 1. Kết luận điều phối

**Chưa thể nhận bàn giao T51/T53/T54 hoặc gọi QA T52.** BE đã có thay đổi mới nhưng lần kiểm cuối thất bại; FE chưa tích hợp main sau phục hồi. QA có kết quả đạt ở một lần chạy, nhưng lượt kiểm lại chưa kết thúc bằng bàn giao hợp lệ.

| Người / task | Code đang giữ | Output thực gần nhất | Kết luận |
| --- | --- | --- | --- |
| dev-be / T51, T54 | `1674bb1eaf0891beb3d11372b5c56f419600966a`, worktree sạch | Hai lần `SHELL=/nonexistent node check.js --main` mới nhất đều exit 1; sau đó hết quota agy | Chưa đạt; code được giữ lại, chưa có review/bằng chứng cho bản này |
| dev-fe / T53 | `6318ecc5aaa1647cc91fc3b9a48e31b242556286`, worktree sạch | Sau phục hồi chỉ đọc Git và thử đọc report chưa có trên nhánh; tiếp đó lỗi mạng | Chưa tích hợp hotfix T55 vào T53, chưa có check mới |
| qa / T56 | `606144580e7e9aced6df1ad835c53b5bab876457`, worktree sạch | Một lần Electron đạt; chạy lặp tiếp rồi bị dừng, tiến trình lệnh cuối exit 137 | Giữ Đang làm; chưa coi toàn bộ lượt kiểm lại đã hoàn tất |

T55 tiếp tục Chờ duyệt; T52 chưa bắt đầu. PM không đổi task hoặc gọi lại agent trong lượt đọc output này. Cấu hình hiện tại vẫn là agy cho cả hai dev, Claude cho QA; không suy lỗi mạng FE thành lỗi quota BE.

## 2. BE: kết quả đạt cũ không áp dụng cho commit hiện tại

Transcript session `4b80cd07-a2ff-412f-a87c-d9e961c40e5e` cho thấy:

- 21:32:09 chạy `SHELL=/nonexistent node check.js --main`; output bước 1868 **exit 1**, assert tại `check.js:2664`: `worktreeState queue item must include mergeEvent`, actual `null`.
- Sau đó agent sửa cách lưu mergeEvent. Lần sửa này vô tình bỏ dòng `} catch (e) {` trước xử lý lỗi merge.
- 21:33:29 chạy lại cùng lệnh; output bước 1890 lúc 21:34:44 **exit 1**: `DIRTY_ROOT`, rồi `Hết giờ chờ: merge dev-a (thư mục bẩn)` tại `check.js:2344`.
- Đây là ca repo tạm của main harness. Không được diễn giải lỗi này thành yêu cầu End-User commit thư mục thật để “làm test xanh”.
- Khoảng 21:35 agent hết quota trước khi sửa tiếp hoặc gửi review. Bản `1674bb1` vẫn chứa lỗi trên. Lời báo đạt lúc 21:22 thuộc bản trước các sửa đổi này.

Điểm đã có tiến triển: T54 đã export `validTaskSpec`; BE đã thêm kiểm report manual trong core/main, thêm queue.mergeEvent/canRepair và đổi nguồn tin repair sang system. Những thay đổi này vẫn cần kiểm đạt sau khi sửa các lỗi bên dưới.

## 3. Các lỗi phải sửa trong phạm vi task hiện có

### 1. T51 — mất xử lý lỗi của hàng chờ merge (chặn bàn giao)

- **Vị trí:** worktree BE `main.js:1274–1287`, hàm `processMerge`.
- **Tình huống và lỗi:** `repoProbe` gặp thư mục bẩn thì lỗi thoát thẳng ra `pumpMerge`; entry còn `merging`, không được ghi lỗi/payload. Phần dùng biến `e` lại nằm trong nhánh thành công, nơi không khai báo biến đó.
- **Bằng chứng:** output kiểm thật đã thất bại như mục 2. PM còn chạy probe trong bộ nhớ, trích nguyên hàm hiện tại và giả lập `repoProbe` ném `DIRTY_ROOT`: kết quả `state=merging`, `mergeEvent=null`, không gọi `mergeError`/`postOnce`.
- **Sửa nhỏ nhất:** khôi phục ranh giới `catch (e)`; lưu payload lỗi trong callback registry như dự định, giữ cleanup/finally và đường thành công riêng. Chạy lại đúng ca dirty-root và mergeEvent vừa thất bại rồi mới chạy toàn bộ check một lần.
- **Nếu bỏ qua:** queue có thể kẹt, không báo đúng lỗi; đường publish thành công cũng có thể ném `ReferenceError` sau khi đã gộp.

### 2. T51 — Tiếp tục vẫn cấp trùng và bỏ qua trạng thái đang chạy (chặn nghiệm thu S1/S2)

- **Vị trí:** worktree BE `main.js:2996–3053`, IPC `continueChain`.
- **Tình huống và lỗi:** kiểm claim trước `await core.getLogIndex`, nhưng không kiểm lại khi ghi claim. Hai yêu cầu đồng thời đều đi tiếp và tạo hai childChainId. Handler cũng không kiểm `draining`/running trước cấp việc; lấy `stop.targets` cũ thay cho pending hiện tại và route một tin chỉ chứa tên agent.
- **Bằng chứng:** probe trích nguyên handler, dùng log/store trong bộ nhớ với stop đang `draining`, pending có a/b nhưng tin stop ban đầu chỉ có a. Hai IPC đồng thời trả `child-1` và `child-2`, cùng `alreadyContinued=false`, gọi route hai lần với `@a`; claim cuối chỉ còn child-2. Đây là probe IPC với dependency giả lập, không phải kiểm Electron/restart đầy đủ.
- **Sửa:** theo contract mục 5: xác minh trạng thái và nguồn pending hiện tại; kiểm/ghi claim trong cùng đoạn đồng bộ sau các await; lưu trạng thái cấp theo người nhận và không xóa claim đã có side effect. Dùng childChainId cũ cho yêu cầu lặp, chuyển stop gốc sang continued, giữ tin nguồn và người nhận đến muộn. Thêm assert hai IPC đồng thời, draining, pending đến muộn và crash/restart.
- **Nếu bỏ qua:** người dùng có thể trả phí hai lượt cho cùng thao tác; việc đang chờ từ nhánh đến muộn có thể bị mất. Chỉ vô hiệu nút ở FE không sửa được IPC này.

### 3. T51 — hồ sơ kiểm chưa đi vào phép đo tiến triển

- **Vị trí:** worktree BE `main.js:623–725`, `main.js:1912–1920`; kết quả `core.run` trong `core.js`.
- **Tình huống và lỗi:** `recordChainTurn` chỉ đọc `result.checkRecords`. Runner thực lưu CheckRecord rồi trả `checkId`; core trả `commandResults`, không tạo `checkRecords`. Tìm toàn bộ core/main chỉ thấy hai chỗ đọc trường `checkRecords`, không có chỗ gán. Kết quả merge check đến muộn cũng chưa được nối về chain.
- **Bằng chứng:** đối chiếu caller `executeCommand → runCommandWithVerification → core.run → recordChainTurn`; đây là kết luận đọc luồng dữ liệu, chưa chạy end-to-end cho ca này.
- **Sửa:** resolve checkId từ kết quả lệnh và record của queue theo run/chain nguồn, kiểm liên kết bằng resolver Sprint 11 rồi tiêu thụ proof một lần ở ranh giới lượt. Khóa novelty phải dùng nội dung cây đã kiểm như contract mục 3.4, không dùng commit SHA làm đại diện cho nội dung.
- **Nếu bỏ qua:** lượt QA/readOnly vừa tạo bằng chứng kiểm mới vẫn bị tính là không tiến triển, có thể phanh sai sau ba lượt. Không được thay bằng việc tin câu “test pass” từ native CLI.

### 4. T53 — phần Chi tiết merge đọc sai tên trường SHA

- **Vị trí:** worktree FE `renderer.js:1487–1490`; fixture `check.js:1925–1937`.
- **Tình huống và lỗi:** renderer đọc `ev.headSha`, còn MergeFailure của contract và BE trả `sourceSha`, `candidateSha`. Test FE tự tạo `headSha` nên xanh mà không kiểm đúng payload BE.
- **Bằng chứng:** PM trích nguyên `renderMergeDetails` và truyền payload đúng contract trong probe DOM tối giản: chỉ hiện bước/loại lỗi, không hiện SHA nguồn hoặc candidate.
- **Sửa nhỏ nhất:** đọc các trường SHA đúng contract và đổi fixture sang payload BE thật; vẫn giữ toàn bộ output dạng text. Đồng thời tích hợp main có bố cục hai tầng/sửa Esc trước khi kiểm T53 lại.
- **Nếu bỏ qua:** người dùng không biết lỗi merge đang nói tới bản code nào trong vùng Chi tiết.

## 4. FE: lượt sau phục hồi chưa thực hiện tích hợp

Session `14aaab83-8c46-4b19-b019-1335889609f7` chỉ có các bước cuối:

1. `git status`: sạch; `git log`: HEAD còn `6318ecc`.
2. Đọc các commit chưa có từ main, trong đó có `d1543f3` sửa Esc.
3. `cat reports/sprint-12-integration-recovery.md`: exit 1, file chưa có trong nhánh cũ.
4. CLI lỗi mạng, không có lệnh merge hoặc kiểm mới sau phục hồi.

Không mất code T53, không tái phát merge dở ở thời điểm kiểm. Báo cáo phục hồi có trên main; khi chạy lại có thể đọc `git show main:reports/sprint-12-integration-recovery.md`. Tránh lấy origin/main đang cũ làm nền tích hợp. Không cần PM hủy merge lần nữa.

## 5. QA: có kết quả hữu ích, nhưng cách lặp/chờ làm kéo dài lượt

Đọc transcript Claude session `6632268d-9bc0-4dd0-b4b1-71a5df14b402`:

- 21:13 chạy Node check và Electron: Node đạt; Electron đạt các ca sửa Esc T55, nhưng ca focus trở về tên sau đóng spec có lúc chưa đạt.
- 21:15 chạy Electron hai lần để xem tính ổn định; lệnh kéo dài tới timeout 600 giây. QA tìm thấy wrapper Electron và process con còn chạy, rồi dừng các probe.
- 21:25 chạy riêng một lần; output lúc 21:28 có **toàn bộ ca đạt**, thời gian thực khoảng 25,4 giây.
- Sau đó QA mở thêm vòng `for i in 1 2 3`, mỗi vòng gọi Electron **hai lần**, trong đó một lần pipe vào `true` làm mất kết quả. Lệnh chờ `until ! pgrep -f "check.js --electron"` có thể khớp chính shell chứa chuỗi đó; không phải cách chờ PID của một test cụ thể. Lệnh chờ lại vượt 400 giây.
- 21:35 QA sửa harness: gọi binary Electron trực tiếp với timeout/SIGKILL thay wrapper; đợi focus tối đa hai giây trước assert. Đây là bốn dòng diff giữ trong `6061445`, chưa gộp.
- Sau sửa, QA lại mở ba lần chạy. Output nhận trước lúc End-User dừng chỉ xác nhận **`run 1: exit 0 fails=0`**; lệnh toàn vòng exit **137**. Không được báo ba lần đạt.

Thời điểm PM kiểm, locks.json chỉ còn lượt PM; danh sách tiến trình không còn node/Electron probe QA. PM không khởi chạy lại hoặc kill thêm tiến trình nào.

Lần tiếp theo của T56 chỉ cần nhận kết quả hiện có, soát thay đổi harness và thực hiện kiểm còn thiếu có giới hạn rõ; không lặp toàn bộ suite khi không có thay đổi/failure mới. Nếu cần chạy nền, chờ đúng PID/task đã tạo, giữ exit code và output; không dùng tìm theo chuỗi lệnh để chờ, không pipe kết quả vào `true`. T52 vẫn phải chờ code Sprint 12 đủ BE/FE.

## 6. Bước tiếp theo và giới hạn kiểm

- Không kích hoạt lại QA đang được End-User dừng. T55/T56 chưa đóng; còn phản hồi trên box thật.
- BE hết quota agy (thông báo lúc 21:35 ghi còn khoảng 4 giờ 57 phút); FE bị lỗi mạng riêng. Nếu End-User muốn tiếp tục ngay, cần đổi CLI phù hợp trong cài đặt cho hai dev hoặc báo phương án chờ. PM không sửa agents.json trong phạm vi hiện tại.
- Khi CLI sẵn sàng: BE sửa các mục 1–3 của phần lỗi, FE tích hợp main và sửa mục 4. Sau sửa chạy kiểm cần thiết một lần, xử lý failure cụ thể; bàn giao review bằng block cuối cùng. PM nhận đủ và có code được gộp mới gọi T52.
- PM chỉ đọc log/code và chạy ba probe nhỏ trong bộ nhớ; không sửa code sản phẩm, Git của dev, cấu hình agent hay dữ liệu task/memory chung. Không chạy lại `npm run check`/Electron trong lượt này.
- **Kết luận:** sửa các lỗi 1–4 trước khi nghiệm thu các phần tương ứng; trạng thái “đã hoàn tất” trong tin dev trước không phản ánh bản code đang giữ.
- **Chưa kiểm:** toàn bộ persistence/crash/restart, mọi ca contract Sprint 12 và UI trên box End-User. Các probe nhỏ không thay bằng chứng check đúng SHA của app.
