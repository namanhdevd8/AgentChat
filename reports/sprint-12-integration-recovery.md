# Sprint 12 — bàn giao BE và khôi phục lượt FE

PM · 2026-10-14. Đối chiếu main `432a7e0` và trạng thái thực của hai worktree. Chỉ đọc code/Git, chưa chạy kiểm sản phẩm, chưa thay file hay Git trong worktree dev.

## 1. BE: T51/T54 chưa bàn giao hợp lệ

- Bảng task vẫn để T51/T54 Đang làm, chưa có bằng chứng. Agent gửi một câu sau block task-status nên parser từ chối cả block. PM không tự chuyển review thay chủ task, vì cần ReviewRecord gắn đúng worktree/SHA.
- Worktree BE `659f0a54-88dc-407a-b9a2-fae96e9754aa` ở `38c2710`; chỉ có bốn file thay đổi: `core.js`, `main.js`, `preload.js`, `check.js`; không có merge conflict. App có đường ghi nhận thay đổi còn lại ở đầu lượt khi mọi file thuộc scope. Có thể gọi BE lại để hoàn thiện và bàn giao; không xóa code đã làm.
- Cảnh báo `.chat/memory.md`/`.chat/tasks.json` là thay đổi metadata chung, ghi rõ tác nhân chưa xác minh. Code main hiện đưa metadata ngoài scope vào điều kiện từ chối commit, kể cả khi source trong worktree hợp lệ. Không đủ căn cứ quy kết BE sửa hai file này. Không rollback metadata hoặc bỏ cổng kiểm.
- T54 đã có export `validTaskSpec` trong diff, nhưng PM chưa nghiệm thu main harness; vẫn cần bằng chứng sau khi gộp.

### Các điểm T51 phải bổ sung trước khi gửi lại

1. `worktreeState` trong bản BE hiện tại vẫn chỉ trả `error`, `canRetry`, `canRepair` theo state và `canStop`; **chưa trả `queue[].mergeEvent`, chưa xét claim trong `canRepair`**. Phải theo spec Sprint 12 mục 8: payload mergeEvent đã lọc; canRepair=false sau khi claim đã nhận hoặc mục không còn hiệu lực, giữ qua restart. FE đã dựa vào hai trường này.
2. Khi sửa điều kiện canRepair, giữ tính lặp an toàn của IPC: request lặp cho một claim đã nhận trả lại cùng chain/run, không tạo lượt mới; đừng để canRepair=false làm đường trả kết quả claim cũ không bao giờ tới được. Đối chiếu contract mục 6.3 về kiểm queue/claim dưới Git lock.
3. `requestMergeRepair` hiện vẫn đăng `from:'user'`. Contract mục 6.3 quy định system note có `initiatedBy:'user'`, sau đó cấp việc trực tiếp; không route nội dung chẩn đoán. Đổi đúng nguồn/metadata và giữ việc tính lượt/chi phí của chain sửa.
4. Đồng bộ main có hotfix T55 và các check QA hiện tại trong worktree BE, giữ suites hai phía khi có xung đột `check.js`. Thêm assertion cho payload worktreeState thật, claim/restart/request lặp và nguồn system của repair; không chỉ kiểm object helper tự tạo.
5. Chạy lại `npm run check` sau các thay đổi. Khi bàn giao, đặt block task-status của T51/T54 **cuối cùng tuyệt đối**, dùng revision mới nhất từ prompt; không thêm lời kết/handoff/run-command sau block đó. Run-command và task-status gửi ở các kết quả riêng. Queue phải check đúng bản bàn giao trước khi PM gọi QA.

## 2. FE: gọi lại không mở được CLI

Worktree bị kẹt:

`/Users/namanh/Library/Application Support/Agent Chat/worktrees/3ced195b5bc66b7d24fda40a16c70bf6b7a031d998ce9c9b359432e9ff40815e/agents/5bae4f12-6288-4325-9eb2-6da1358fe618`

Trạng thái PM đã đọc:

- HEAD = ORIG_HEAD = `6318ecc5aaa1647cc91fc3b9a48e31b242556286`. Commit này đã giữ code T53 trong `check.js`, `index.html`, `renderer.js` (781 dòng thêm, 27 dòng bỏ).
- MERGE_HEAD = `b7288a8fe453a0d5c7f4d48799fc6a8cecf464cd`.
- Index còn conflict `check.js`, `index.html`; các thay đổi merge khác là `renderer.js` và hai report hotfix từ main. Chưa thấy file untracked mới.
- `startWorkspace` kiểm conflict trước khi spawn CLI và trả `DIRTY_WORKSPACE`. Vì vậy lời giao FE giải quyết conflict trong lượt trước không thể thực thi: agent chưa được chạy. Không tiếp tục gọi lại cùng lời nhắn để thử may rủi.

### Phương án phục hồi cần End-User cho phép

Đề nghị cho PM thao tác đúng worktree FE bên trên, chỉ để **sao lưu rồi hủy lần merge dở**, trả về commit T53 đã được giữ. Không xóa worktree, không reset --hard/clean, không sửa main hoặc dữ liệu `.chat`.

Các bước sau khi được phép:

1. Kiểm lại agent/process không đang ghi, HEAD/ORIG_HEAD/MERGE_HEAD còn đúng và liệt kê thay đổi mới nếu có. Nếu khác snapshot này, đánh giá lại trước khi thao tác; không bỏ thay đổi mới.
2. Sao lưu riêng năm file đang thay đổi (gồm bản có marker conflict), status/diff, các stage index và tham chiếu Git hiện tại vào một thư mục phục hồi riêng; xác minh bản sao đủ. Giữ một ref dự phòng trỏ `6318ecc` để code T53 vẫn truy cập được.
3. Chạy `git merge --abort` trong **worktree FE**. Kiểm không còn MERGE_HEAD/conflict, HEAD vẫn `6318ecc` và bản code T53 còn nguyên. Nếu Git không hủy được an toàn thì dừng, không dùng reset để ép.
4. Khi worktree đã mở được, giao FE tiếp tục T53: tích hợp main mới có `d1543f3`, giữ hotfix bảng task/Esc và suites QA, hoàn tất mọi conflict ngay trong cùng lượt, kiểm rồi gửi review. Dữ liệu đã sao lưu được giữ để phục hồi nếu cần.

PM chưa thực hiện bước nào thay Git/file ở worktree FE. Cần phép riêng vì phạm vi PM chỉ gồm reports và một số file `.chat`, đồng thời chỉ được sửa code trong worktree của mình; chủ worktree FE hiện lại bị app chặn trước CLI. Đây là xin phép thao tác phục hồi cụ thể, không xin mở rộng quyền toàn dự án.

## 3. Tiếp tục điều phối

- Gọi BE hoàn thiện T51/T54 theo mục 1; không thay trạng thái bằng lời báo hoàn tất khi app chưa nhận review.
- Chờ quyết định phục hồi FE, T53 giữ Đang làm. Chưa gọi lại FE trong lúc cổng startWorkspace vẫn chặn.
- T56 vẫn đang do QA kiểm lại Esc trên main có `d1543f3`; T55 vẫn chờ kết quả và thử trên box thật. T52 chỉ bắt đầu sau khi BE/FE đã gộp và có bằng chứng phù hợp.
- Chỉ cập nhật báo cáo trong lượt PM này; không sửa tasks.json/memory.md trong khi dev tiếp tục kiểm để giảm thay đổi metadata chung không cần thiết. Đây là biện pháp điều phối tạm, không phải bản sửa nguyên nhân audit.

## 4. Đã phục hồi FE theo phê duyệt End-User (2026-10-14)

End-User đã duyệt đích danh yêu cầu sao lưu/hủy merge dở trong worktree FE ở tin 21:27. PM thực hiện đúng ngoại lệ được duyệt; không đổi scope/quyền hay dữ liệu `.chat`.

- Kiểm lại trước thao tác: HEAD/ORIG_HEAD/MERGE_HEAD và năm file còn đúng mục 2; không có file untracked mới, job FE trong locks.json, queue FE đang chạy hoặc process có cwd trong worktree FE. Không có MERGE_AUTOSTASH.
- Sao lưu lúc **2026-10-14T14:32:37Z** vào `/Users/namanh/Library/Application Support/Agent Chat/recovery/fe-merge-20261014T143237Z`: năm file hiện tại, status, diff working/index, toàn bộ stage index, sáu blob của conflict và các file Git metadata. `manifest.json` lưu SHA-256/kích thước; đã so khớp bản sao và kiểm source không đổi trước abort.
- Ref dự phòng: `recovery/fe-t53-20261014T143237Z` trỏ `6318ecc5aaa1647cc91fc3b9a48e31b242556286`.
- Đã chạy `git merge --abort` đúng worktree FE, **exit 0**. Sau đó không còn MERGE_HEAD, không còn file unmerged; Git status sạch. Không dùng reset --hard/clean hoặc xóa worktree.
- HEAD vẫn `6318ecc5aaa1647cc91fc3b9a48e31b242556286`, tree vẫn `eab894d7cc72301da5fdf5674a22de1be78169cb`: code T53 đã commit được giữ nguyên. Kết quả lưu thêm tại `recovery-result.json` trong thư mục sao lưu.
- Đủ điều kiện gọi FE lại để tiếp tục T53 trên worktree của mình. FE tích hợp main mới có T55, giữ CSS hai tầng và sửa Esc, giữ suites QA cùng rendererS12Checks; hoàn tất conflict và commit merge trước khi kết thúc lượt. Chạy kiểm sau tích hợp rồi gửi review với block cuối cùng.
- T53 vẫn Đang làm. Đây là phục hồi trạng thái Git, chưa nghiệm thu code T53; PM không chạy lại bộ kiểm sản phẩm vì chưa thay nội dung commit T53. T52 vẫn chờ đủ BE/FE.
