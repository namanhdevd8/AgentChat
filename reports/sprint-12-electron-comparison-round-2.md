# T52 — Electron lượt 2: 8 ca đạt, ca cuối chưa đạt

Techlead · 2026-10-15 · theo lượt PM cho phép sau lỗi thiết lập probe lần đầu.

## Kết quả

**Electron 44.4.5 khởi tạo và chạy được UI thật. Có 8 nhóm ca đạt; nhóm cuối đỏ, nên toàn probe exit 1.** Không SIGABRT, không timeout, không có uncaught exception. Không chuyển kết quả này thành nghiệm thu toàn bộ T52; chưa thử trên box thật.

Chạy đúng **một** lượt mới:

```text
node reports/sprint-12-electron-comparison-round-2.cjs
```

- HEAD: `b2fd22174853972e253e42e7e8caf3328797f1f9`. Worktree sạch trước khi thêm probe lượt 2; code sản phẩm và `check.js` không đổi so với `7b30ac8`.
- Bắt đầu `2026-10-15T02:46:40.458Z` (09:46:40 Việt Nam); thời lượng 1.346 giây.
- Electron 44.4.5 / Chromium 152.0.7977.130, arm64, parent Node v26.8.1; cùng binary và quyền hiện có như lượt 1. Không đổi cấu hình/quyền/dependency.
- Parent timeout 60 giây; fixture timeout 45 giây; exit 1, signal `null`.
- Vào JavaScript `02:46:40.684Z`, app ready `02:46:40.927Z`, fixture `02:46:41.555Z`.
- Không chạy lại `npm run check`, main harness hay bộ bố cục T56.

## Sửa probe, giữ bằng chứng lượt đầu

Lượt 2 là bản sao riêng của probe lượt 1, chỉ đổi tên lệnh/prefix output và thêm `void 0` ở cuối đoạn thiết lập DOM. Như vậy `executeJavaScript` không còn phải chuyển một function về main. Giữ toàn bộ assertion.

Đã rà các điểm còn lại: điều kiện trả boolean/số; thao tác `.click()`, render và mở project trả `undefined`; `api.logPage`/`api.chainState` trả DTO qua Promise. Các biến giữ DOM/function vẫn ở renderer, không được dùng làm giá trị trả về của script.

Giữ nguyên cả năm file lượt đầu (`.cjs`, `.json`, `.md`, `.stdout.txt`, `.stderr.txt`); đã đối chiếu SHA-256 trước/sau, không ghi đè. Probe gốc vẫn có SHA-256 `903a1cba56b23f01a646d22463c3187c5e2cb42c86066738af57899f83564a4c`.

## Từng nhóm ca thực sự chạy

| Ca | Kết quả |
| --- | --- |
| Snapshot `reserved` được BE thật khôi phục, `logPage` trả seq 3, `chainState` trả `interrupted/canContinue:true`; hai nút UI bật | Đạt |
| Bấm trùng ở chat/Cần bạn chỉ gửi một request, đúng root và seq | Đạt |
| Lỗi API giữ khóa qua render và event khác stop; event cũ/sai box không mở khóa; chat/Cần bạn đồng bộ | Đạt |
| Kiểm tra lại sai stop, sai box hoặc API lỗi không mở khóa, không tạo request Tiếp tục | Đạt |
| Event mới `canContinue:false` vẫn khóa; event mới `true` mở cả hai; lỗi từ chat giữ khóa khi Cần bạn render lại | Đạt |
| Kiểm tra lại đúng stop, cùng revision, mở cả hai; chỉ đọc, chưa gửi Tiếp tục | Đạt |
| Response thành công làm cả hai nơi hiện Đã tiếp tục và khóa nút | Đạt |
| Đổi box khi request còn chờ: response/nút cũ không ghi lỗi hoặc gửi thêm vào box mới có cùng seq | Đạt |
| Cần bạn embedded/fallback không có cache chat | **Chưa đạt**: nhánh embedded dừng ở assert mở lại sau Kiểm tra lại; nhánh fallback phía sau chưa chạy |

Đây là cửa sổ/DOM/renderer/preload và vận chuyển IPC thật. Bước recovery đầu tiên lấy dữ liệu từ BE thật. Từ ca bấm trùng trở đi, probe thay hai handler `continueChain`/`chainState` trong tiến trình thử để điều khiển lỗi/chậm/thành công; không chạy CLI agent. Kích hoạt nút bằng `HTMLElement.click()` qua `executeJavaScript`, không phải thử chuột/phím vật lý hoặc kiểm bố cục.

## Chẩn đoán ca cuối sau khi dừng — đọc code, không chạy lại

Trong fixture nhánh embedded:

```js
state = { ...recovered.state, stopId: 'probe-embedded', chainId: 'probe-embedded', revision: '1' }
await emit({ ...state, stopId: 'other-embedded', revision: '100' })
```

Event định mô phỏng “chuỗi khác” đã đổi `stopId` nhưng **giữ `chainId: probe-embedded`**. Vì renderer lưu ChainView theo cả stopId và chainId (`renderer.js:1635–1636`), event này đặt state của `other-embedded` vào khóa cache `probe-embedded`. `chainViewFor` ưu tiên revision 100 đó hơn dữ liệu embedded revision 1. Sau đó Kiểm tra lại nhận state `probe-embedded` revision 1, khác stop đã thấy và cũ hơn, nên giữ khóa.

Đây là lỗi dựng event độc lập trong probe, có thể giải thích assertion đỏ bằng đường code hiện hành; không phải bằng chứng rằng response xác nhận hợp lệ của đúng stop bị renderer từ chối. Tuy nhiên **không ghi ca cuối là đạt**, vì chưa chạy với fixture sửa. Ca event khác stop ở nhóm 3 đã đổi **cả hai ID**, nên đã đạt độc lập.

Sửa tối thiểu cần áp dụng cho phép kiểm tiếp theo tại đoạn emit cuối, giữ assertion:

```js
await emit({ ...state, stopId: 'other-' + mode, chainId: 'other-chain-' + mode, revision: '100' })
```

Nên assert trước khi emit rằng cả stopId lẫn chainId đều khác stop đang kiểm. Không sửa code sản phẩm để chấp nhận fixture sai này. Giữ nguyên script đã thực thi của lượt 2 và không chạy thêm vì lượt PM giao chỉ cho phép một lần mới.

## Bằng chứng và phần còn thiếu

- [Probe đúng phiên bản lượt 2](sprint-12-electron-comparison-round-2.cjs)
- [Metadata và toàn bộ kết quả từng ca](sprint-12-electron-comparison-round-2.json)
- [stdout nguyên văn](sprint-12-electron-comparison-round-2.stdout.txt)
- [stderr nguyên văn](sprint-12-electron-comparison-round-2.stderr.txt)
- [Báo cáo lượt 1 giữ nguyên](sprint-12-electron-comparison.md)

stderr có dòng `sandbox_extension_issue_file failed … Electron Helper.app/Contents/Resources: 1 (Operation not permitted)`. Đã giữ nguyên; dòng này không ngăn app vào fixture và chạy tám ca. Chưa xác định quan hệ với SIGABRT của QA, không kết luận sandbox là nguyên nhân.

PM chuyển QA đánh giá tám nhóm đã đạt và chẩn đoán fixture. Còn thiếu phép kiểm embedded/fallback với hai ID độc lập, nghiệm thu box thật và những mục UI ngoài phạm vi probe này. T52 chưa được chốt; không đổi trạng thái/hồ sơ T53/T55 trong lượt kiểm. Chỉ thêm tài liệu, probe và output dưới `reports/`.
