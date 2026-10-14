# T51 — khôi phục công việc sau khi Tiếp tục bị gián đoạn

PM · 2026-10-15. Phát hiện từ phần bổ sung T52 vòng 3, trên code BE **`c0efdd0`**. Contract áp dụng: [Sprint 12 mục 5.3 và 9](sprint-12-design.md).

## Kết quả đã nhận

- QA main harness exit 1 sau khoảng 80 giây, dừng ở ca crash sau claim. Không chạy lại toàn suite vì listener FE T53 vẫn chưa sửa; FE vừa lỗi mạng trước khi hoàn tất lượt.
- Những ca mới đã chạy và đạt: doing→review có tiến triển còn vòng lặp trạng thái không tính mãi; hồ sơ check linked T908 failed→passed→passed được phân biệt; trần hai lượt với ba người nhận chỉ cấp hai và giữ người còn lại kèm tin nguồn; publish lỗi sau check pass giữ đúng candidate/checkId, commandResult null, retry thành công không đăng lại lỗi cũ, mục bị thay thế không được yêu cầu sửa.
- Đây là các tình huống cụ thể đã kiểm, không thay toàn bộ biến thể của từng nhóm contract. Chưa có test cho tracking-limit, coalesce cùng/khác chain, draining sau restart và orphan chặn claim. T52 chưa đạt, Sprint 12 tiếp tục mở.

## Lỗi cần trả T51

App đã ghi claim Tiếp tục với childChainId và dispatch `reserved`, rồi bị gián đoạn trước khi cấp job. Sau restart, `continueChain` thấy childChainId nên trả `alreadyContinued`; `chainState` thấy claim nên coi thẻ cha đã continued. Nhưng không có stop của chuỗi con giữ người nhận chưa được cấp, nên người dùng không còn đường tiếp tục phần việc đó.

PM đọc code xác nhận đường tìm `resolvedChildId` chỉ trả dữ liệu đang có; đường `chainState` đổi trạng thái cha khi thấy claim, không khôi phục stop/pending của child. Lưu claim để chống cấp trùng chưa đủ đáp ứng yêu cầu giữ công việc qua restart.

### Lưu ý về fixture và chênh lệch trạng thái

QA hiện thêm claim trực tiếp vào control store nhưng giữ nguyên snapshot cha `ready`. Trong code thật, callback `updateControlStore` ghi claim **và** đặt cha `continued/canContinue:false` trong cùng một lần atomicWrite. Vì vậy cần chỉnh ca crash chính để phản ánh đúng snapshot này, hoặc chặn tại ranh giới ghi thực tế; không lấy trạng thái cha ready do fixture tạo làm bằng chứng duy nhất của một lỗi riêng.

Điều đó không loại bỏ lỗi mất công việc: ngay cả khi cha đã continued đúng, người nhận reserved vẫn cần stop con và tin nguồn. Với dữ liệu cũ/lệch snapshot, response và chainState phải được đối chiếu theo cùng stopId/revision, không đưa nút về ready sai. Báo rõ kết quả trên snapshot hợp lệ và trên dữ liệu lệch, không gộp hai ca thành một.

## Đầu ra BE phải đáp ứng

1. Khôi phục từ dữ kiện được lưu của đúng project/box/stop/childChainId. Người chắc chắn chưa được cấp (`reserved`, chưa có run) được giữ trong **một stop của chuỗi con**, kèm đủ người nhận, tin nguồn và task liên quan. Cha continued trỏ đúng child; không chỉ đổi nhãn cha để ca test qua.
2. Mở app/đọc trạng thái/gọi lặp claim cũ không tự dispatch công việc. Stop con chỉ cấp phần được phép sau một thao tác Tiếp tục mới của người dùng. Không cấp thêm childChainId cho cùng claim cũ, không đăng lặp stop khi đọc/restart nhiều lần.
3. Các trạng thái dispatching/admitted/uncertain phải đối chiếu terminal/lock/orphan: không tự chạy lại lượt chưa rõ đã bắt đầu hay chưa; phần đã có kết quả không chạy lại, phần chưa rõ hiện gián đoạn và giữ đường xử lý. Không xóa claim để làm như chưa bấm Tiếp tục.
4. State trả qua IPC và state đọc lại phải nhất quán theo stopId/chainId tương ứng, revision tăng đúng quy ước. Thẻ cha không tự bật lại; stop con mang đúng pending và lý do. Store/log thiếu hoặc hỏng phải báo lỗi rõ, không bịa người nhận hay bỏ mất nguồn.
5. Giữ hành vi đã đạt: không deadlock repair, lặp Tiếp tục dùng cùng childChainId, legacy thiếu dữ kiện trả UNAVAILABLE, tin điều phối không có runId/usage và không làm sai tổng. Không đổi interface FE chỉ để sửa riêng triệu chứng; nếu cần đổi contract thì báo PM trước.

## Nhận test QA và nghiệm thu sau sửa

QA đã commit test tại **`388c8e1ee98005ee3c67906387572897a0f8bdee`**, worktree sạch. Commit này chỉ đổi fixture/main harness trong `check.js`; PM kiểm `git show --format= 388c8e1 -- check.js` áp dụng được bằng `git apply --check` trên nền hiện tại. Không cần sao lưu patch mới hay sửa worktree QA.

- BE lấy phần test của commit này, giữ các ca A–D đã đạt và sửa ca E theo snapshot atomic thật. Giữ assertion tổng lượt QA đã thêm ở nhánh trước khi đồng bộ đầy đủ; không bỏ test chỉ vì chưa gộp vào main.
- Ca E hiện cho qua nếu có stop con **hoặc** cha vẫn còn pending và canContinue/interrupted. Làm chặt ca nghiệm thu theo contract: có stop con hợp lệ, đọc được pending/tin nguồn, thao tác tiếp tục mới xử lý được người nhận đó, đọc/restart lặp không tạo thêm stop/job. Không chỉ kiểm sự tồn tại của một tin rỗng.
- Bổ sung kiểm các ranh giới recovery liên quan: trước/sau post continue, reserved, dispatching, admitted, terminal đã có và orphan/draining. Giữ marker cuối harness sau tất cả ca; không dùng bản vá tạm làm kết quả nghiệm thu sản phẩm.
- tracking-limit vẫn là yêu cầu kiểm, không tự chuyển backlog vì khó tạo fixture. Có thể seed tập proof/milestone gần ngưỡng trong test có kiểm soát rồi chạy một lần đánh giá thật; không cần chạy 8192 lượt CLI. Không giảm ngưỡng sản phẩm hoặc thêm API công khai chỉ để test. Ca coalesce cùng/khác chain cũng còn trong danh sách nghiệm thu QA sau tích hợp.
- BE kiểm phần sửa, rồi chạy check qua app có liên kết **T51** và gửi review mới ở cuối câu trả lời. T54/T57 đã Xong, không mở lại hoặc gửi review lại hai hotfix đó trong đợt sửa T51 này.

## Phối hợp với FE và trạng thái

- T51 → Đang làm, giao dev-be sửa recovery và ca liên quan. T52 giữ Chờ duyệt với kết luận chưa đạt, chờ bản sửa và các ca còn thiếu.
- T53 đang Đang làm; gọi dev-fe tiếp tục sau lỗi mạng. FE worktree hiện sạch, HEAD `0b17f86`, đã có [phân công listener và patch test](sprint-12-qa-round-3.md). Giữ phạm vi rendererT52Checks và lời gọi suite; BE giữ vùng fixture/main harness để hai bên không sửa cùng khối.
- Nếu FE gặp lại lỗi mạng, báo nguyên lỗi và SHA/phần đã lưu; không tự thử vòng lặp. Lượt gọi tiếp này không yêu cầu đổi CLI hoặc nới quyền.
- Sau đủ bản BE/FE gộp và kiểm đạt, PM gọi QA kiểm tích hợp, kèm danh sách các nhóm chưa có bằng chứng. Không gọi QA lặp toàn suite trên bản còn lỗi đã biết.

PM lượt này chỉ đối chiếu code, test và ghi giao việc; chưa chạy lại sản phẩm. T54/T57/T56 giữ Xong; T55 vẫn chờ bằng chứng mới và phản hồi bố cục trên box thật.
