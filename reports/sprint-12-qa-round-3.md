# Sprint 12 — T52 lần 3: sửa listener FE và bổ sung phần nghiệm thu còn thiếu

PM · 2026-10-15. Bản QA kiểm: **`c0efdd0`**. PM đối chiếu code và test QA; chưa tự chạy lại sản phẩm.

## Kết quả và quyết định

- QA báo `npm run check` exit 1 sau khoảng 7 giây vì ca FE mới, trước main harness. Main harness chạy riêng một lần trên cùng code đạt exit 0 sau khoảng 63 giây và chạy tới marker cuối. Không chạy lại Electron vì lần này không thay FE/vòng đời cửa sổ.
- Các lỗi BE đã trả từ hai lần trước đều đạt trên code thật: legacy UNAVAILABLE không cấp lại, tin điều phối không có runId, tổng lượt thật khớp reducer, childChainId đúng khi lặp/restart, repair đồng thời một lượt, chống tin trùng, bất biến mergeEvent trong các tình huống harness đã tạo.
- **T51 chưa đủ nghiệm thu toàn bộ:** nhóm ca contract mục 9 liệt kê dưới đây còn thiếu. Câu “BE đã đạt” trong bàn giao chỉ được hiểu là những ca đã chạy; chưa chốt toàn S1–S3 hoặc Sprint 12.
- **T53 → Đang làm** để sửa listener. **T52 → Đang làm** để bổ sung ca BE còn thiếu, độc lập với sửa FE. **T56 giữ Xong**, T55 còn chờ bằng chứng mới và phản hồi box thật.
- **Đủ điều kiện đóng riêng T54/T57:** validator manual/report đã được kiểm trong main harness thật; nativeTheme/maximized có main harness và Electron thật đã đạt, bản sửa tiếp không đổi vòng đời cửa sổ. Dùng check `8f6f2639-d855-42a3-97de-2a8a25fee33a`, nguồn `290f4bf`, candidate `c0efdd0`, liên kết đúng task/review hiện hành. Lỗi listener và nhóm ca S1–S3 còn thiếu không thuộc đầu ra hai hotfix này. Không dùng quyết định này để đóng T51 hoặc T53.

## T53 — dev-fe sửa đăng ký listener trùng

`renderer.js` khoảng 5359–5366 có hai nhánh `if` độc lập gọi `api.onChainChanged` và `api.on('chain-changed', ...)`. `preload.js` đưa cả hai vào cùng kênh IPC. Vì cả hai API đều tồn tại, một sự kiện gọi `handleChainChanged` hai lần; chốt revision hiện làm giảm tác động nhưng không thay yêu cầu listener chỉ đăng ký một lần.

Đầu ra: chỉ một đăng ký cho chain-changed; nếu giữ đường tương thích thì hai đường phải loại trừ nhau. Giữ guard box/openingDir/revision và cách dọn listener hiện có, không sửa preload/main hoặc bỏ chốt chống callback cũ.

Test QA đã được lưu thành [sprint-12-qa-round-3-fe-checks.patch](sprint-12-qa-round-3-fe-checks.patch). Patch chỉ gồm hàm `rendererT52Checks` và lời gọi suite, tách khỏi assertion reducer của QA. Nền QA `df6a862`; SHA-256 patch `33a9850c095f8f6e3bfe945f57142c6ab792b9239ca1ba48eb8a03469bcd3d84` (3.086 byte). PM kiểm file nguồn không đổi trong lúc chụp; không sửa worktree QA.

FE đồng bộ main mới nhất, lấy hai hunk test này rồi sửa renderer. Test mô phỏng đúng preload có đồng thời hai API và kiểm một event chỉ được áp dụng một lần. Nếu cần chỉnh test để khớp cách tổ chức code, giữ nguyên ý nghĩa kiểm hành vi; không đổi assertion thành hai lần hoặc bỏ suite. Kiểm bằng `npm run check` có liên kết **T53**, bàn giao review mới và SHA/checkId, block ở cuối.

## T52 — QA bổ sung các ca bắt buộc còn thiếu

Đây là phần nghiệm thu đã có trong contract mục 9, không mở rộng phạm vi sản phẩm. QA giữ assertion reducer mới trong nhánh mình và bổ sung vào vùng core/main harness. Mỗi nhóm cần kiểm hành vi thật, không chỉ tìm chuỗi source.

| Nhóm còn thiếu | Kỳ vọng phải kiểm |
| --- | --- |
| Mốc tiến triển task | doing→review lần đầu có tiến triển; review mới chỉ khác UUID/thời gian hay vòng doing↔review không tạo tiến triển mãi; done hợp lệ tính đúng một lần; thay đổi định nghĩa/code thật phân biệt được với việc báo lại cùng kết quả. |
| Độ mới của bằng chứng check | Cùng task/nguồn/policy/kết quả nhưng ID/log/thời gian khác không tính lại; fail→pass mới tính, vòng kết quả đã thấy không reset; nguồn/policy sai hoặc chưa xác minh không tính, kết quả muộn không mở chain đã halt. |
| Giữ chỗ lượt khi song song | Hai route sát giới hạn chỉ cấp đúng số slot; ask đang await gặp halt không thêm job; coalesce cùng chain không tính hai lần, khác chain không gộp nhầm; người nhận chưa cấp vẫn được giữ đúng. |
| Claim sau crash/restart | reserved/dispatching/admitted/uncertain không gây replay job chưa rõ kết quả; phần chắc chắn chưa cấp còn đường xử lý, orphan chặn đúng. Đọc stop/pending còn đủ tham chiếu tin nguồn; báo sai lệch/thiếu dữ kiện thay vì cấp mù. |
| tracking-limit | Chạm trần theo dõi thì phanh theo contract; không xóa seen/baseline để vòng lặp cũ được tính lại là tiến triển. |
| Publish/superseded/cleanup | Lỗi publish sau check pass giữ đúng candidate/checkIds nhưng không gán lệnh pass thành lệnh lỗi; retry/attempt mới, superseded/contained và cleanup không phát lại lỗi cũ hoặc tạo tin trùng. |

Chuẩn bị các nhóm còn thiếu trước khi chạy; nếu fail-fast chặn nhóm sau, dùng phép kiểm độc lập có giới hạn để chẩn đoán và báo rõ bản/nhóm đã chạy, không kết luận nhóm chưa tới là đạt. Không vá sản phẩm trong QA để nghiệm thu hoặc giảm yêu cầu cho xanh; lỗi mới báo PM kèm tái hiện để trả đúng task.

## Chia vùng làm song song và bước nghiệm thu chung

- **FE:** `renderer.js`; `rendererT52Checks` và lời gọi của nó ở chuỗi suites. Giữ các suite cũ và bố cục hai tầng/Esc. Không sửa phần core/main harness QA đang bổ sung.
- **QA:** các assertion core/main harness, gồm assertion đếm tổng lượt thực đã có trong nhánh QA. Không sửa `rendererT52Checks` hoặc dòng nối suites cuối file trong đợt song song này; FE đang đưa chúng vào main. Nếu cần điểm gọi mới, đặt trong vùng harness đã được gọi hoặc báo PM trước khi cùng sửa dòng đó.
- QA đang có `check.js` chưa commit đúng phạm vi; app có thể ghi nhận đầu lượt. Giữ test của mình khi đồng bộ main và giữ các assertion mạnh hơn của BE. Cảnh báo report ngoài phạm vi chưa xác định tác nhân không cho phép hoàn tác report hay dữ liệu chung.
- QA có thể kiểm phần core/main liên quan một lần trong lúc FE làm; chưa cần chạy lại toàn suite đang đỏ vì listener. Gửi các phát hiện và bảng phạm vi đã kiểm; không mở vòng lặp toàn suite. Sau đủ hai bàn giao, PM gọi kiểm tích hợp trên cùng SHA để xác nhận toàn bộ phần được nghiệm thu.
- Không cần lặp Electron bố cục/T57 cho thay đổi đăng ký listener nếu không xuất hiện rủi ro mới liên quan; kết quả Electron trước đó vẫn phải ghi đúng nguồn/phạm vi, không đổi thành kết quả của bản chưa chạy.

Sprint 12 vẫn mở. T54/T57 đóng bằng bằng chứng riêng; các task còn lại chỉ đóng sau đủ phạm vi kiểm và bằng chứng tương ứng. Chưa có xác nhận bố cục trên box thật để đóng T55.
