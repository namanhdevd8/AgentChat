# Sprint 12 — nghiệm thu T52 lần 1, hoàn tất QA T56

PM · 2026-10-14. QA kiểm bản sản phẩm **`0a25c49`**; PM đối chiếu code và diff kiểm, chưa tự chạy lại sản phẩm.

## Kết luận và giới hạn bằng chứng

- **T52 chưa đạt:** T51 còn ba lỗi dưới đây, trong đó deadlock của thao tác Yêu cầu sửa chặn hàng chờ Git/worktree.
- **T56 đạt:** QA báo Electron thật đạt bố cục 240/300/635px ở sáng/tối, Enter/Space → Esc ngay, Esc trong panel và focus/aria. PM duyệt kết quả QA độc lập này bằng manual; T55 vẫn chờ bằng chứng code mới và phản hồi trên box thật.
- QA chạy mỗi bộ một lần: `npm run check` **exit 1, khoảng 19 giây** với chốt phát hiện harness kết thúc sớm; `node check.js --electron` **exit 0, khoảng 22 giây, 19/19 ca**.
- Lỗi deadlock làm Node hết công việc trong event loop khi vẫn còn Promise chưa giải quyết, nên tiến trình con thoát **0 trước khi chạy hết main harness**. Check hàng chờ cũ `86077420-e725-40ff-a792-68aa4f21b50e` có exit 0 thật nhưng không chứng minh các ca sau điểm treo đã chạy. Không dùng hồ sơ này để đóng T51/T54/T57, dù badge hiện ready.
- QA đã thử một bản sao vá tạm lỗi khóa để kiểm tiếp, không commit bản vá sản phẩm: phanh ba lượt, novelty A→B→A, squash, T38, S11, T49 và T57 đạt trên bản thử đó. Đây là dữ kiện chẩn đoán, chưa phải nghiệm thu lại bản sửa BE cuối cùng.
- Riêng Electron thật trên bản cần kiểm xác nhận T57 khôi phục maximized và đóng cửa sổ rồi đổi theme không còn exception. T57 giữ review để lấy hồ sơ kiểm đầy đủ trên bản tích hợp sau sửa T51.

## Ba lỗi trả T51 cho dev-be

### 1. Deadlock khi bấm Yêu cầu sửa

**Tái hiện của QA:** bật worktree, tạo mục merge thất bại có thể yêu cầu sửa, bấm Yêu cầu sửa. IPC không hoàn tất; các thao tác gộp/chạy cần chuẩn bị worktree trong cùng project bị giữ lại.

PM đọc `main.js` xác nhận chuỗi chờ: `requestMergeRepair` (khoảng dòng 2962) vào `withGitLock(root, ...)`, rồi `await ask(...)` ngay trong khóa; `ask` gọi `prepareWorkspace` (khoảng 1716), hàm này lại chờ `withGitLock(root, ...)` (khoảng 836). Khóa được triển khai bằng chuỗi Promise theo root và không cho vào lồng nhau, nên hai nhánh chờ nhau.

**Yêu cầu sửa:** kiểm mục queue/attempt và giữ claim chống cấp trùng trong đoạn được khóa; nhả khóa trước khi gọi `ask`/chuẩn bị worktree. Giữ đúng xử lý lỗi, claim qua restart và quyền/phạm vi của agent; không bỏ claim hoặc bỏ khóa toàn bộ để làm hết treo. Không tự gọi sửa khi nhận mergeEvent.

**Nghiệm thu bắt buộc:** IPC kết thúc trong thời gian hữu hạn; sau đó queue và lượt worktree khác vẫn chạy được; hai click/IPC đồng thời hoặc yêu cầu lặp chỉ cấp một lượt sửa. Ca lỗi chuẩn bị/dispatch không làm khóa kẹt hoặc báo đã cấp thành công khi chưa có job. Main harness phải chạy tới marker cuối, không chỉ có exit 0.

Trong thời gian chưa sửa, tránh bấm **Yêu cầu sửa** trên app đã chạy code Sprint 12 này. Nếu đã kẹt, cần khởi động lại app để giải phóng khóa trong bộ nhớ; không xóa registry/claim, không tự dừng các agent còn chạy. Restart chỉ gỡ trạng thái đang kẹt, không sửa nguyên nhân.

### 2. Tiếp tục lặp trả sai ID chuỗi

**Tái hiện:** gọi `continueChain` thành công, đợi response rồi gọi lại cùng messageId. Lần đầu trả childChainId mới, lần sau trả stopId/ID chuỗi cha. Ca IPC đồng thời từng đạt không phủ ca lặp tuần tự này.

PM xác nhận hai nhánh ngắn `continuedChains.has(legacyKey)` và tra `chain-continue` trong log đều trả `{chainId: stopId, alreadyContinued:true}` trước nhánh đọc claim. Sửa để mọi đường đã tiếp tục lấy đúng childChainId đã ghi, kể cả sau restart/legacy. Thiếu hoặc lệch dữ kiện phải báo không khả dụng theo contract, không tự cấp một chuỗi mới.

**Nghiệm thu:** lần đầu, lần lặp tuần tự, hai IPC đồng thời và lần gọi sau restart cùng trả một childChainId; chỉ một tin continue/một lần cấp các job tương ứng. Giữ kiểm draining và tin nguồn của công việc chờ.

### 3. Tin trùng bị đưa vào pending khi chuỗi đã dừng

**Tái hiện:** các agent trả lại cùng nội dung/người nhận/ngữ cảnh cho tới khi chain dừng. Yêu cầu đã gửi vẫn bị thêm pending và tạo thẻ có nút Tiếp tục.

PM xác nhận `routeTargets` xử lý halting/stopped và thêm toàn bộ targets vào pending (khoảng 1607) **trước** bộ lọc S2 (khoảng 1626). Vì vậy nhánh dừng bỏ qua chống trùng.

**Yêu cầu sửa:** lọc đúng yêu cầu/người nhận đã xử lý trước khi thêm pending hoặc tạo thẻ dừng; giữ tin trong log. Nếu toàn bộ bị lọc và không còn công việc chờ/nhánh đang chạy thì kết thúc im lặng theo contract mục 4. Không xóa pending hợp lệ đã có, không bỏ kết quả đến muộn chưa trùng, không chặn tin mới của End-User hay ngữ cảnh code/task mới.

## Lấy các ca kiểm của QA vào bản sửa

QA worktree sạch, HEAD **`a097c78`**; code kiểm đã lưu dù app báo từ chối Bash sau bàn giao. Nhánh QA chưa gộp vì check đã đỏ đúng. Không cần gọi QA lặp lại để có một lần xanh.

- BE lấy **toàn bộ phần thay đổi `check.js` giữa `0a25c49` và `a097c78`**, đối chiếu với nhánh hiện tại và giữ suites của mình. Có thể xem bằng `git diff 0a25c49 a097c78 -- check.js`; không lấy bản vá sản phẩm tạm của QA.
- Giữ chốt `mainChecks` yêu cầu stdout có `ok (main harness end)` và marker chỉ xuất hiện sau toàn bộ ca main. Không di chuyển marker lên trước, không in giả marker hoặc bỏ assert để vượt queue.
- Giữ các ca T52 tuần tự Tiếp tục/chống trùng/novelty, chờ queue ổn định sau lượt sửa, và các ca Electron T57. Diff cũng có cách chạy binary Electron trực tiếp với timeout/kill hữu hạn và chờ focus hữu hạn của T56.
- Nếu thay đổi fixture/chờ ổn định thì giải thích trong bàn giao; các ca phải còn bắt được hành vi lỗi. Không chuyển assert thành BUG/xfail hoặc bỏ qua kết quả tiến trình.
- Kiểm sau khi sửa bằng `npm run check`; phải thấy toàn bộ harness hoàn tất. Chỉ chạy lại sau thay đổi có lý do, không chạy lặp nguyên bộ để tìm lần xanh. BE không cần lặp Electron cho ba lỗi điều phối này nếu không thay vòng đời cửa sổ/harness Electron; QA sẽ kiểm hồi quy một lượt sau gộp.

## Trạng thái và bước kế tiếp

1. **T51 → Đang làm**, dev-be sửa ba lỗi và tích hợp chốt/các ca QA. Đây là sửa thiếu sót trong contract T51, không thêm phạm vi sản phẩm.
2. **T56 → Xong** bằng approval manual dựa trên báo cáo Electron của QA. Phản hồi trên box thật vẫn thuộc điều kiện đóng T55, chưa được suy từ kết quả này.
3. **T52 giữ Chờ duyệt** với kết luận chưa đạt; sau bản sửa BE gộp, PM gọi QA nghiệm thu lại trên code thật, không vá tạm. T53/T54/T55/T57 giữ Chờ duyệt, chưa đóng code từ check cũ.
4. BE chạy check qua app có taskRefs đúng, rồi gửi review mới cho **T51/T54/T57** để hồ sơ gắn bản tích hợp đã chạy hết main harness. Chạy lệnh và gửi review ở hai kết quả riêng; block task-status phải ở cuối. Không sửa metadata chung để làm lại bằng chứng.
5. PM sẽ điều phối làm mới bằng chứng T53/T55 khi code và test ổn định. QA kiểm lại contract mục 9 còn thiếu, giữ kết quả T56 riêng; không coi việc sửa ba lỗi là bằng chứng tự động rằng toàn Sprint 12 đạt.

T56 dùng approval manual có reason dẫn tên báo cáo; chưa cần trường report tùy chọn vì chưa xác nhận app đang chạy đã nạp hotfix T54. Không đổi acceptance hoặc dùng manual cho task code.

## Nhận bản sửa và giao QA lần 2 (2026-10-14)

**Nền nghiệm thu mới: main `db0ea6ad2520a575dfe3b56c17a4b89e0257ac8f` (`db0ea6a`).** Nguồn BE `f74675e639ded7a9b1b1fa06455ca0b6317d0c2f` đã gộp vào 16:48:20 UTC, queue `a276e849-94c2-4582-a4da-108d9b4e0d89` ở trạng thái merged.

- Check app trên nguồn: `251cd6b1-63b9-48a7-8466-1c87770c64f1`, exit 0, 71.944 giây. Check bản gộp: **`66ab6944-e5ef-4d2a-a568-b9304c3d89ae`**, exit 0, 72.499 giây, treeStable=true. Hồ sơ gộp liên kết đủ T51/T54/T57 và đúng reviewIds/source/candidate lần này.
- PM đối chiếu `check.js` với nhánh QA `a097c78`: giữ toàn bộ ca QA, chốt yêu cầu marker cuối và marker sau T57. Chỉ đổi fixture pingPong từ lời nhắn cố định thành `lượt {n}` để ca phanh chạy độc lập với bộ lọc tin trùng; ca S2 lời nhắn giống nhau vẫn còn. Không có assert bị bỏ hoặc chuyển xfail.
- PM đọc diff thấy `ask` được đưa ra ngoài Git lock, claim vẫn được tạo trong khóa; Tiếp tục tra childChainId từ claim/cache/store/log; S2 lọc trước khi thêm pending. Đây là đối chiếu bản sửa, chưa phải kết luận toàn contract đạt. PM không chạy lại bộ kiểm sản phẩm.

### Giao T52 kiểm lại

QA đồng bộ main `db0ea6a`, giữ các assertion và fixture đã được tích hợp; hoàn tất xung đột trong lượt nếu có. Không dùng bản sao vá tạm của lần 1. Mục queue QA cũ check-failed không phải bản sửa sản phẩm mới; không bấm Yêu cầu sửa để xử lý mục đó.

1. Kiểm lại cả ba lỗi trên code thật: repair kết thúc và queue/worktree tiếp tục được; Tiếp tục tuần tự/đồng thời cùng childChainId; tin trùng khi halt không tạo pending/thẻ rỗng. Bổ sung kiểm quanh sửa khóa: double click, lỗi trước khi có job, yêu cầu đến lúc claim đã tạo nhưng chưa dispatch, restart không cấp trùng hoặc che mất việc chưa chạy.
2. **Điểm cần soát thêm:** trong bản sửa vẫn có fallback trả `chainId: stopId` nếu tìm thấy bản ghi continue nhưng không giải ra childChainId. Kiểm bằng log legacy/mất trường liên kết và đối chiếu contract mục 5.3; không chỉ thử đường claim hiện hành. Dữ kiện không đủ phải báo không khả dụng thay vì báo chuỗi cha là chuỗi tiếp tục thành công.
3. Hoàn tất các ca bắt buộc còn lại của contract mục 9, đặc biệt pending giữ tin nguồn, nhánh đến muộn, restart/claim, bằng chứng kiểm và merge attempt. Ghi từng nhóm đạt/chưa đạt/chưa kiểm; không suy toàn contract đạt chỉ từ ba regression đã xanh.
4. Kiểm T54 và T57 cùng hồi quy Sprint 11 trên harness chạy tới cuối. Chạy `npm run check` và `node check.js --electron` mỗi bộ một lần sau khi chuẩn bị ca kiểm, lưu SHA/exit/output; lỗi hoặc timeout thì báo, không chạy vòng lặp tìm lần xanh. Ca mới chỉ chạy lại khi có thay đổi hoặc giả thuyết cụ thể cần xác minh.
5. Gửi kết luận T52 và review bằng block cuối cùng. **T56 đã Xong, không mở lại**; hồi quy giao diện trong lần này thuộc nghiệm thu tích hợp T52. T51/T53/T54/T55/T57 giữ review trong thời gian chờ.

PM chuyển T52 sang Đang làm. Sau QA, mới làm mới bằng chứng T53/T55 và xét đóng các task code; không dùng hồ sơ cũ trước chốt cuối harness. Phản hồi trên box thật của T55 vẫn chưa có.
