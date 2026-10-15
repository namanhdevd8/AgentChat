# T52 — Electron lượt 3: embedded và fallback đạt

Techlead · 2026-10-15 · theo phân công PM sau khi QA chấp nhận tám nhóm xanh của lượt 2 và xác minh lỗi fixture dùng chung chainId.

## Kết quả

**Hai ca còn thiếu đều đạt trên Electron 44.4.5, exit 0.** Chạy đúng một lần, chỉ embedded và fallback; không chạy lại tám nhóm đã được QA chấp nhận, bộ Node hoặc bố cục T56.

```text
node reports/sprint-12-electron-comparison-round-3.cjs
```

| Dữ kiện | Kết quả |
| --- | --- |
| Nguồn | `fa626c1d84768086f0953a7bd23dbadc65a49886` |
| Worktree | Sạch trước khi tạo probe lượt 3; chỉ thêm file bằng chứng dưới `reports/`. Code sản phẩm, `check.js`, package/lockfile không đổi so với `7b30ac8`. |
| Bắt đầu | `2026-10-15T02:58:44.822Z` — 09:58:44 Việt Nam |
| Thời lượng | 1.354 giây |
| Runtime | Electron 44.4.5, Chromium 152.0.7977.130, arm64; parent Node v26.8.1 |
| Quyền/cách chạy | Quyền techlead hiện có; gọi trực tiếp binary Electron của worktree, `SHELL=/nonexistent`, dữ liệu tạm độc lập; không đổi quyền/dependency hay thêm `--no-sandbox`. |
| Timeout | Parent 60 giây, fixture 45 giây; không chạm timeout |
| Exit/signal | Parent và Electron exit 0, signal `null`, không uncaught exception; stderr rỗng |
| Mốc | Vào JavaScript `02:58:45.066Z`, app ready `02:58:45.311Z`, vào fixture `02:58:46.089Z` |

## Phạm vi sửa fixture

Tạo file riêng lượt 3 từ probe lượt 2, giữ đoạn thiết lập trả `void 0`. Bỏ các bước chạy tám nhóm đã đạt khỏi bản lượt 3; bản gốc lượt 2 và assertion của nó vẫn giữ nguyên.

Event “chuỗi khác” trong hai ca còn lại đổi **cả stopId và chainId**:

```js
const unrelated = {
  ...state,
  stopId: 'other-' + mode,
  chainId: 'other-chain-' + mode,
  revision: '100'
}
assert.notStrictEqual(unrelated.stopId, state.stopId)
assert.notStrictEqual(unrelated.chainId, state.chainId)
assert.ok([unrelated.stopId, unrelated.chainId].every(
  id => ![state.stopId, state.chainId].includes(id)))
```

Ba assert này chạy **trước khi emit**, bảo đảm không trùng cả khóa stop lẫn alias chain. Giữ nguyên assert nút vẫn khóa sau event và mở lại sau xác minh đúng; thêm assert xác minh không gửi thêm request Tiếp tục. Không đổi điều kiện sản phẩm để nhận fixture sai.

## Hai ca thực sự chạy

| Ca | Fixture | Hành vi được assert | Kết quả |
| --- | --- | --- | --- |
| Embedded | `item.chainView`, xóa cache/callback chat; stop/chain `probe-embedded`; event khác dùng `other-embedded` / `other-chain-embedded` | Lỗi API được giữ; event khác khiến render lại vẫn khóa; Kiểm tra lại trả đúng state mới mở; không gửi thêm Tiếp tục | Đạt |
| Fallback | State nằm trên item, không có `chainView` hay cache chat; stop/chain `probe-fallback`; event khác dùng `other-fallback` / `other-chain-fallback` | Các điều kiện khóa/mở và không gửi thêm Tiếp tục như trên | Đạt |

Mỗi ca được ghi thành một record độc lập trong JSON/stdout; cả hai đã đi qua assertion cuối. Không gộp nhánh fallback chưa chạy của lượt 2 thành kết quả đạt cũ.

Phần chuẩn bị vẫn mở app thật trên snapshot claim reserved, lấy stop con seq 3 và state recovery qua BE/preload/IPC thật. Hai ca dùng state đó với ID fixture riêng để kiểm UI độc lập. Khi thử lỗi/xác minh, hai handler `continueChain`/`chainState` được thay trong tiến trình probe; cửa sổ, DOM, renderer, preload và vận chuyển IPC giữ thật. Nút được kích hoạt bằng `HTMLElement.click()`. Không chạy CLI agent, không thử chuột/phím vật lý hay dữ liệu box thật.

## Bằng chứng

- [Probe đã thực thi](sprint-12-electron-comparison-round-3.cjs)
- [JSON: metadata và hai kết quả](sprint-12-electron-comparison-round-3.json)
- [stdout nguyên văn](sprint-12-electron-comparison-round-3.stdout.txt)
- [stderr nguyên văn — rỗng](sprint-12-electron-comparison-round-3.stderr.txt)
- [Lượt 1](sprint-12-electron-comparison.md) và [lượt 2](sprint-12-electron-comparison-round-2.md) giữ nguyên. Đã đối chiếu SHA-256 trước/sau cho toàn bộ script/JSON/báo cáo/stdout/stderr của hai lượt; không file nào bị ghi đè.

Không sửa code sản phẩm, metadata chung hoặc hồ sơ task. Chỉ kiểm cú pháp probe và nội dung thay đổi trước phép chạy này; không chạy lại `npm run check`.

## Bàn giao và giới hạn

PM chuyển QA đánh giá kết quả hai ca còn thiếu này cùng tám nhóm QA đã chấp nhận từ lượt 2. Không tự đóng T52/T53/T55 hoặc Sprint 12. Bằng chứng hiện tại vẫn không thay thế phản hồi trên box thật; chưa kết luận nguyên nhân SIGABRT ở bối cảnh QA.
