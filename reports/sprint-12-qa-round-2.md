# Sprint 12 — T52 nghiệm thu lần 2 chưa đạt

PM · 2026-10-14. Bản sản phẩm QA kiểm: **`db0ea6a`**. Kết quả do QA bàn giao; PM đọc code/diff xác minh, chưa chạy lại bộ kiểm sản phẩm.

## Đã đạt và còn thiếu

- Ba lỗi lần 1 đã được QA kiểm trên code thật và báo đạt: repair đồng thời chỉ cấp một lượt/một tin, queue tiếp tục chạy; Tiếp tục tuần tự và sau restart trả cùng childChainId; tin trùng kết thúc im lặng. Chốt cuối harness đã hoạt động.
- Những mergeEvent tạo trong harness đạt bất biến eventId/category/phase, đúng một tin cho mỗi lỗi và không lộ đường dẫn nội bộ. Kết quả này chỉ bao phủ các tình huống harness đã tạo, chưa thay mọi ca contract chưa được chạy.
- Lần chính thức: `npm run check` **exit 1, khoảng 73 giây**, dừng ở assertion tin điều phối mang runId. `node check.js --electron` **exit 0, khoảng 22 giây, 19/19 ca**.
- Ca legacy nằm sau assertion lỗi nên chưa chạy tới trong lần chính thức. QA xác nhận lỗi legacy trên bản sao chạy chẩn đoán; PM đọc đúng nhánh dự phòng trong main xác nhận nó vẫn trả ID tin dừng. Sau sửa phải chạy cả hai ca trên bản chính thức, không dùng bản vá tạm để nghiệm thu.
- **Trả T51 về Đang làm.** T52 giữ Chờ duyệt với kết luận chưa đạt; T56 đã Xong. T53/T54/T55/T57 giữ review, chưa đóng code dựa trên hồ sơ của bản còn lỗi này.

## T51 — hai lỗi BE cần sửa

### 1. Stop legacy không xác định được chuỗi con vẫn báo thành công

Fixture: stop legacy không có claim/stopId; log đã có `chain-continue.continuedFrom` trỏ đúng tin đó nhưng thiếu childChainId. Gọi Tiếp tục trả `{ok:true,chainId:"174"}` — số thứ tự tin dừng bị dùng làm ID chuỗi con.

Trong `continueChain`, nếu không giải được `resolvedChildId` nhưng thấy cache/log đã tiếp tục thì nhánh fallback trả `chainId:stopId`. Theo contract mục 5.3, dữ kiện thiếu phải báo **không khả dụng**, không được báo chuỗi cha/tin dừng là chuỗi con hoặc cấp thêm việc.

Yêu cầu:

- Trường hợp fixture trên trả lỗi rõ ràng (`ok:false`), không tạo claim/job/tin continue mới. Giữ đường đã có childChainId hợp lệ, lặp tuần tự/đồng thời và sau restart trả đúng cùng ID.
- Đối chiếu log thật nếu cần khôi phục liên kết. PM lưu ý `core.addIndexedRecord` hiện không giữ `stopId`/`childChainId` trong `index.records`; không coi việc đọc `continueRecord.childChainId` từ index là đã đọc đủ bản ghi gốc. Khi không có dữ kiện đáng tin để khôi phục thì từ chối, không đoán ID.
- Siết assertion legacy của QA thành lỗi không khả dụng đúng contract: bản test hiện còn cho qua một nhánh `ok:true, alreadyContinued:true, chainId:null`; không dùng nhánh nới này làm tiêu chí hoàn thành.

### 2. Tin điều phối bị tính vào số lượt và làm sai cờ thiếu dữ liệu

`haltChain` vẫn ghi `runId:chain.id` vào `chain-stop`; `chain-continue` ghi `runId:childChainId`. `core.addIndexedRecord` khoảng dòng 984 coi tin system có runId hoặc usage là một lượt. Hai tin trên không có usage nên còn bật `tokensIncomplete`/`costIncomplete` cho box.

Yêu cầu theo contract mục 5.2:

- Tin điều phối mới dùng chainId/stopId/childChainId/continuedFrom và eventId thích hợp, **không có runId hoặc usage**. Giữ nhận diện thẻ/nút Tiếp tục, chống trùng, log cũ và đúng tin nguồn.
- Kiểm chuỗi đọc `chainState`/`continueChain`/Cần bạn sau khi bỏ runId; không để việc sửa tổng làm hỏng tra cứu stop bằng seq hoặc ID. Không xóa/sửa log thật để làm cờ thống kê biến mất.
- Thêm kiểm qua reducer thật: ghi một lượt có usage đầy đủ, lấy tổng trước/sau khi thêm tin điều phối; turns/tokens/cost và các cờ completeness không đổi do tin đó. Giữ ca terminal hệ thống cho lượt lỗi/partial để bảo đảm chi phí G6 vẫn được tính. Assertion chỉ kiểm trường runId vắng mặt chưa đủ chứng minh thống kê đúng.

Phạm vi BE: `main.js`, `core.js` nếu cần và các assertion liên quan trong `check.js`; không giao FE sửa triệu chứng trên UI.

## Bản test QA đã lưu để chuyển cho BE

App chặn tự commit QA vì cảnh báo thay đổi report chưa rõ tác nhân. Khi PM đọc, QA HEAD là **`1b9beb6473f0c46f895df72397e6fcc4596a613d`**, worktree chỉ còn `check.js` thay đổi; PM không sửa hay hoàn tác worktree QA và không quy tác nhân từ cảnh báo.

Đã chụp nguyên diff `git diff --binary HEAD -- check.js` thành [sprint-12-qa-round-2-checks.patch](sprint-12-qa-round-2-checks.patch), chỉ chứa `check.js`, 7.286 byte. SHA-256 bản patch: `22f7fbf954fc68c73ee43db7a2d0bf3d9dac51e8a8c6e86219f77ec008ba8f41`. Kiểm file nguồn không đổi trong lúc chụp; không có bản vá sản phẩm tạm trong patch.

BE nhận patch này trên nền main mới nhất, đọc/kiểm áp dụng trước và giữ mọi sửa của nhánh mình. Patch gồm repair đồng thời, bất biến mergeEvent/tin điều phối, legacy và restart. Không cần chờ QA được commit hoặc gọi QA chạy lại chỉ để gộp test; không chép đè toàn file `check.js`, không sửa metadata chung để gỡ cảnh báo phạm vi.

## Bàn giao và nghiệm thu lại

1. BE sửa hai lỗi, lấy test patch, giữ chốt `ok (main harness end)` ở cuối và toàn bộ suites. Bổ sung ca reducer và làm chặt ca legacy như trên; không xfail/BUG hoặc bỏ assert.
2. Chạy `npm run check` sau sửa với liên kết T51/T54/T57 qua app; cần chạy tới cuối trên code thật. Chỉ chạy lại sau thay đổi cần xác minh, không lặp để tìm lần xanh.
3. Bàn giao review mới cả T51/T54/T57, báo SHA/checkId; block task-status ở cuối. PM đợi gộp đạt rồi gọi QA kiểm lại T52, bao gồm cả ca chưa chạy tới và phần contract còn thiếu.
4. Lần này không thay vòng đời cửa sổ/FE: giữ kết quả Electron đã ghi; QA chỉ mở lại kiểm liên quan khi có thay đổi hoặc nghi ngờ cụ thể. T56 không mở lại; T55 vẫn chờ bằng chứng mới và phản hồi box thật.

PM chỉ lưu test dưới dạng tài liệu patch và ghi quyết định giao sửa; không áp dụng patch vào code sản phẩm hoặc chạy lại kiểm thay BE/QA.

## Nhận bản sửa và giao T52 lần 3 — 2026-10-15

**Bản cần nghiệm thu: main `c0efdd0885764e5267b5c213625e19307a30b2d3` (`c0efdd0`).** Nguồn `290f4bfca601eb3496999d6572ece884ad2ee1a0` đã gộp sau check đạt lúc 17:09:36 UTC ngày 14/10 (00:09:36 ngày 15/10 giờ Việt Nam).

- PM xác minh queue `76b57494-f40a-4b82-8c9c-dfc039cd51fb` đã merged, không có lỗi. Check nguồn `87c4dd30-4169-44ae-bf62-a63c273facc4` đạt exit 0 trong 73.469 giây; check bản gộp **`8f6f2639-d855-42a3-97de-2a8a25fee33a`** đạt exit 0 trong 73.937 giây, treeStable=true, gắn đúng T51/T54/T57 và ba review hiện hành.
- PM đọc diff: fallback legacy ném UNAVAILABLE; index giữ stopId/childChainId; chain-stop và chain-continue bỏ runId. Giữ test patch QA, siết ca legacy thành `ok:false` và `error.code=UNAVAILABLE`. Thêm kiểm reducer thật trước/sau tin điều phối, rebuild index và lượt lỗi system có partial cost. Chốt cuối harness còn sau ca restart.
- PM chỉ đọc code/hồ sơ, chưa tự kiểm lại sản phẩm. Chưa đóng task code vì vẫn chờ QA độc lập trên bản này.

### Việc QA cần hoàn tất

1. Đồng bộ main `c0efdd0` vào nhánh QA. Hiện QA HEAD `1b9beb6`, chỉ `check.js` chưa commit; các ca đó đã được BE tích hợp và làm chặt. Giữ ca UNAVAILABLE/reducer mới, không đưa assertion legacy lỏng trở lại. Phần còn lại nằm đúng phạm vi QA, app có đường ghi nhận thay đổi trong phạm vi ở đầu lượt; nếu vẫn bị chặn trước CLI thì báo nguyên lỗi, không gọi lặp hoặc hoàn tác dữ liệu chung.
2. Kiểm hai lỗi lần 2 trên code thật: legacy thiếu liên kết trả UNAVAILABLE và không cấp thêm việc; tổng lượt/token/chi phí/cờ completeness không đổi do tin điều phối. Kiểm rebuild index và chi phí lỗi G6 vẫn cộng đúng.
3. Xác minh thẻ Tiếp tục/chainState với **payload BE mới không có runId**: tra đúng bằng stopId/chainId, lặp tuần tự/đồng thời/restart trả cùng childChainId; không biến lỗi unavailable thành nút được phép chạy. Giữ hồi quy repair không deadlock, tin trùng và chốt cuối harness.
4. Đối chiếu mục 9 của contract và ghi rõ từng nhóm đã kiểm/chưa kiểm, nhất là pending/tin nguồn, nhánh đến muộn, claim qua crash/restart và merge attempt. Các ca nằm sau điểm dừng của lần 2 phải được chạy trên code thật; không dùng kết quả bản chẩn đoán vá tạm để đóng T52.
5. Chạy `npm run check` một lần sau khi chuẩn bị ca kiểm; lưu SHA/exit/output và xác nhận harness tới cuối. Không cần lặp toàn bộ Electron bố cục/T57 đã đạt nếu các phần đó không đổi; nếu cần Electron để xác minh thẻ Tiếp tục vừa đổi payload thì kiểm đúng luồng đó, ghi rõ phạm vi. Lỗi/timeout thì báo; chỉ chạy lại sau thay đổi hay giả thuyết cụ thể.

PM chuyển T52 sang Đang làm. QA xong gửi review cuối câu trả lời, kết luận và giới hạn rõ ràng. T56 giữ Xong; T51/T53/T54/T55/T57 giữ review. Sau nghiệm thu mới làm mới bằng chứng T53/T55; T55 vẫn còn phản hồi trên box thật của End-User.
