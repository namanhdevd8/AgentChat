# Sprint 12 — Nghiệm thu bản tích hợp của techlead

PM · 2026-10-15. Thực hiện theo yêu cầu End-User giao techlead sửa toàn bộ phần BE/FE còn vướng sau khi dừng hai dev.

## Bản bàn giao và bằng chứng đã xác minh

- Nguồn techlead: `bf8f57867d08fd6f5e50f6e8b1df46f2152921f1`; đã gộp thành main **`51b3909cf5b892a95996301421c7a73e25e93758`**.
- Queue `25db43c8-c382-494e-8cc3-e216110ccc58` ở trạng thái `merged`. Hồ sơ `960d0c8f-d711-4f44-9b29-7af2c1e447ad`: `npm run check`, exit 0, 99,45 giây, `treeStable:true`, nguồn/candidate khớp. Hồ sơ này chỉ liên kết **T55**, review `8348d764-20ea-4b31-b8b4-9bd6a6767dc6`.
- Techlead báo kiểm Electron thật **19/19**, đầy đủ Node suite; còn cảnh báo backlog `T49-nhan-queue-bi-chan`. Đây là kết quả của người viết code, chưa phải nghiệm thu độc lập T52. Chi tiết và giới hạn: [báo cáo tích hợp](sprint-12-techlead-integration.md).
- PM đã đọc báo cáo, đối chiếu registry/hồ sơ kiểm và diff test: giữ marker cuối main harness, nhận test QA `388c8e1`, làm chặt ca reserved thành stop con có nguồn/task và chạy sau thao tác mới; bổ sung tracking-limit, coalesce, orphan/draining và các biến thể claim. FE đổi hai đường đăng ký listener thành loại trừ nhau. PM chưa tự chạy lại bộ kiểm sản phẩm, chưa kết luận toàn bộ logic đạt.

## Phân công hiện tại

**Techlead phụ trách bản sửa tích hợp theo quyết định End-User.** Không gọi hai dev quay lại sửa song song. T51/T53 vẫn là hai đầu ra code cần nghiệm thu, T52 do QA kiểm độc lập; T55 chưa đóng vì còn bước duyệt bố cục trên box thật. T54/T57/T56 đã Xong, giữ nguyên.

App hiện coi `assignee` và `createdAt` là phần bất biến của ID task: `core.taskBoard` từ chối nếu đổi người nhận đã được cache, khóa sự kiện cũng chứa người nhận. Vì vậy PM **không đổi trực tiếp assignee của T51/T53 trong tasks.json**; việc đổi vai triển khai được ghi ở báo cáo này. Không xóa/tạo lại ID, không đổi acceptance sang manual để vượt cổng bằng chứng.

T52 chuyển Đang làm cho đợt nghiệm thu này. T51/T53 tạm giữ trạng thái hiện tại cho đến khi có bàn giao/hồ sơ đúng bản mới; trạng thái đó không có nghĩa hai dev cần tiếp tục viết code.

## QA — đầu ra và tiêu chí đạt

Đồng bộ nguồn kiểm với main `51b3909` (hoặc main mới hơn chỉ thêm báo cáo, ghi rõ SHA thực tế). Bản tích hợp đã chứa test QA cũ và fixture atomic được chỉnh; khi xử lý khác biệt trong nhánh QA, giữ các assertion mới mạnh hơn và marker cuối. Không thay bằng bản fixture cũ chỉ để hết xung đột.

Đọc đối chiếu contract mục 9 và [yêu cầu recovery](sprint-12-claim-recovery.md), kiểm độc lập các nhóm sau trên code thật:

| Nhóm | Kết quả cần chứng minh |
| --- | --- |
| Claim atomic sau crash | Cha continued cùng claim; reserved giữ đúng người nhận, tin nguồn/task trong một stop con. Đọc/restart/gọi lại claim cũ không chạy việc. Chỉ thao tác mới trên stop con mới cấp phần chắc chắn chưa chạy; không tạo stop/job trùng. |
| Trạng thái chưa rõ và đã hoàn tất | dispatching/admitted/uncertain, terminal có/không có checkpoint route; không replay lượt không chắc chắn hay lượt đã xong. State trả từ Tiếp tục nhất quán với chainState của đúng thẻ; nguồn thiếu/hỏng/thu hồi trả trạng thái không khả dụng. |
| Restart, draining, orphan | Thử ít nhất một restart main thật trong harness với snapshot đầy đủ; phân biệt với ca chỉ seed store rồi gọi IPC trong cùng tiến trình. Orphan còn sống/không rõ chặn cấp lượt; phần chưa chạy còn đường xử lý; chi phí terminal muộn/partial cộng đúng một lần. |
| Tiến triển | Mốc doing/review/done, lặp cùng kết quả và thay định nghĩa; bằng chứng đúng task/nguồn/policy/tree, fail→pass, pass khác ID không tạo tiến triển giả; bằng chứng muộn không mở lại chain đã dừng. |
| Slot, gộp yêu cầu và tracking-limit | Sát trần không cấp thừa; ask đang await gặp halt trả slot và giữ pending; cùng chain được gộp đủ nguồn, khác chain không gộp; seed gần 8192 rồi gọi evaluator/route thật, phanh và không xóa tập đã thấy. |
| Hồi quy BE | Repair không deadlock, Tiếp tục đồng thời/tuần tự/restart cùng child ID, legacy UNAVAILABLE, tin điều phối không làm sai tổng lượt/chi phí; mergeEvent đúng attempt/phase/checkId, publish/retry/superseded/cleanup không phát lỗi trùng. |
| FE | Cả hai API có mặt vẫn chỉ đăng ký một listener; đường tương thích và dọn listener đúng; guard box/revision còn hiệu lực; thẻ Tiếp tục dùng seq, không cần runId, hiển thị được stop con phục hồi với dữ liệu BE thật. |

Chạy `npm run check` **một lần** trên bản tích hợp, xác nhận harness tới marker cuối. Timeout cần đủ cho baseline hàng chờ khoảng 100 giây; nếu lỗi/timeout thì lưu output và báo, không chạy lặp tìm lần xanh. Nếu fail-fast chặn nhóm sau, chỉ chạy chẩn đoán riêng phần chưa tới khi cần và phân biệt kết quả đó với lượt kiểm toàn bộ.

Electron: techlead đã chạy 19/19; QA không cần lặp bộ bố cục T56 đã đạt. Chỉ kiểm bổ sung luồng UI stop con/Tiếp tục hoặc phần listener liên quan nếu test hiện có chưa chứng minh được; ghi rõ phần dùng harness và phần dùng Electron thật. Không dùng bản vá tạm của sản phẩm để tuyên bố nghiệm thu đạt.

Đầu ra QA: SHA, lệnh/exit code/thời lượng, ma trận đạt/chưa đạt/chưa kiểm, lỗi kèm tái hiện; gửi `review` T52 ở cuối câu trả lời. Chỉ bổ sung test có khoảng trống thật, tránh thêm bản sao các ca techlead đã có. Chưa có bằng chứng trên box thật của End-User.

## Liên kết bằng chứng và bước đóng task

- QA đạt mới chốt bản code/test cuối và làm mới hồ sơ T51/T53; không chạy lại check chỉ để liên kết trên bản còn có thể phải sửa.
- Giao thức hiện tại chỉ tạo review record khi người gửi là assignee; run-command của PM liên kết được task bất kỳ nhưng vẫn phải khớp source SHA/workspace của review hiện hành. Vì vậy không thể dùng riêng lần check PM hoặc T55 để thay review đúng bản của T51/T53.
- Sau QA, PM điều phối bàn giao bằng chứng trên bản cuối: chủ task hiện hữu chỉ đồng bộ bản đã nghiệm thu, gửi check có liên kết task và review đúng SHA; phần viết/sửa code tiếp tục do techlead phụ trách. Đây là bước ghi nhận bàn giao, không mở lại hai nhánh triển khai. Nếu app không thực hiện được, báo rõ giới hạn, giữ task mở; không tự sửa hồ sơ userData hay nới cổng done.
- T55 có hồ sơ mới nêu trên nhưng còn chờ phản hồi bố cục trên box thật; nếu QA đổi code/test, kiểm lại tính hiệu lực của hồ sơ trước khi duyệt. Sprint 12 chưa đóng và chưa yêu cầu End-User thử bản mới trong lúc QA đang nghiệm thu.

## Kết quả QA sau bản tích hợp

QA báo toàn suite trên `51b3909` đạt và tới marker cuối; probe mới dùng payload BE thật phát hiện FE khóa Tiếp tục của stop con `interrupted/canContinue:true`. T52 chưa đạt; techlead sửa tiếp T53 theo [yêu cầu recovery UI](sprint-12-recovery-ui.md), có patch test QA đã tách khỏi lịch sử nhánh đang xung đột. QA chưa chạy lại Electron hoặc thử box thật trong lượt này.
