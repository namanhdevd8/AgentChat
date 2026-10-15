# T52 — đối chứng Electron một lượt

Techlead · 2026-10-15 · theo kế hoạch PM trong [acceptance-status](sprint-12-acceptance-status.md).

## Kết luận

**Electron khởi tạo được bằng quyền hiện có của techlead, không SIGABRT. Chưa nghiệm thu UI.** Lượt probe kết thúc **exit 1**, signal `null`, sau 1.098 giây vì lỗi thiết lập probe: `Error: An object could not be cloned.` Chưa có assertion UI nào chạy (`results: []`). Không coi kết quả khởi tạo hoặc payload BE trả được là Tiếp tục/Kiểm tra lại đã đạt.

Đã dừng sau đúng một lần khởi chạy Electron, không chạy lại Node suite, không đổi dependency, quyền CLI/OS hay cấu hình máy. Không sửa worktree QA hoặc code sản phẩm.

## Nguồn và môi trường

| Mục | Dữ kiện |
| --- | --- |
| HEAD/main khi bắt đầu | `72b737a3fbb0672e38540b01d28a454734be27b3` |
| Worktree trước probe | Sạch. So với `7b30ac8` chỉ khác hai báo cáo `sprint-12-acceptance-status.md`, `sprint-12-api-error-rerender.md`; code/test sản phẩm giống bản QA đã nghiệm thu tự động. |
| Thay đổi riêng của lượt này | Thêm probe và bằng chứng trong `reports/`; không đổi `main.js`, `core.js`, `preload.js`, `renderer.js`, `index.html`, `check.js`. |
| Nền tảng | macOS 27.0.1, build 26A434; arm64; `launchctl managername` trả `Aqua`. |
| Node gọi probe | v26.8.1 |
| Electron thực chạy | 44.4.5; Chromium 152.0.7977.130 |
| Quyền lượt techlead | `danger-full-access`, dùng quyền đã có; không yêu cầu hoặc thực hiện nâng quyền. BrowserWindow của sản phẩm vẫn `sandbox:true`, `contextIsolation:true`. |
| Cách gọi | `node reports/sprint-12-electron-comparison.cjs`; script gọi trực tiếp binary Electron trong `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron` của worktree techlead, không qua `.bin` wrapper. Đường dẫn đầy đủ và realpath ở JSON. |
| Giới hạn | Parent timeout 60 giây, killSignal SIGKILL; fixture timeout 45 giây. Không chạm timeout. |
| Môi trường child | Kế thừa môi trường hiện tại, đặt `SHELL=/nonexistent` như harness QA để main không thay PATH; thêm đường dẫn fixture qua biến `PROBE_*`. Không thêm cờ `--no-sandbox`. |
| Dữ liệu | Dự án và userData tạm độc lập, hai box, không chạy CLI agent; đã dọn thư mục tạm sau khi lưu output. |

## Output và mốc thực thi

- [Metadata/exit/signal/payload kết quả](sprint-12-electron-comparison.json)
- [stdout nguyên văn](sprint-12-electron-comparison.stdout.txt)
- [stderr nguyên văn](sprint-12-electron-comparison.stderr.txt) — rỗng.
- [Probe đúng phiên bản đã thực thi](sprint-12-electron-comparison.cjs) — giữ nguyên để QA đối chiếu lỗi; **chưa phải một bộ kiểm UI đã đạt**.

Thời gian dưới đây là UTC; cộng 7 giờ để đối chiếu giờ Việt Nam:

| Mốc | Thời điểm/kết quả |
| --- | --- |
| Parent bắt đầu | `2026-10-15T02:41:51.213Z` (09:41:51 Việt Nam) |
| Vào JavaScript entry | `02:41:51.454Z` |
| `app.whenReady()` hoàn tất | `02:41:51.666Z` |
| Vào phần fixture sau khi cửa sổ/renderer nạp và đọc recovery | `02:41:52.265Z` |
| Kết quả | Electron exit 1, không signal; parent exit 1; `enteredJavaScript:true`, `enteredFixture:true`; danh sách ca UI rỗng. |

Fixture ban đầu ghi một snapshot atomic: stop cha đã `continued`, claim con `reserved`, chưa dispatch. App thật đọc snapshot khi mở project. Qua preload/IPC thật, `logPage` trả stop con có **seq 3**, `chainState` trả **phase interrupted, canContinue true, revision 2**, pending có người nhận với `uncertain:false`. Đây là dữ kiện đã quan sát, chưa phải thao tác nút UI đã kiểm.

## Lỗi probe và phạm vi chưa kiểm

Lỗi xảy ra ở `executeJavaScript` thiết lập các hàm quan sát DOM, trước lời gọi `check(...)` đầu tiên. Biểu thức cuối của đoạn script là phép gán `window.__both = (disabled) => …`, nên giá trị trả về là **function**; cầu nối kết quả từ renderer không sao chép được giá trị đó. Stack trong output nằm tại `IpcRendererInternal.send`. Đây là lỗi trong probe mới, chưa có bằng chứng lỗi sản phẩm tại điểm này.

Cách sửa tối thiểu cho lượt kiểm kế tiếp: kết thúc đoạn thiết lập bằng `void 0` hoặc giá trị có thể sao chép, thay vì trả function. Chưa áp dụng rồi chạy lại trong lượt này để giữ nguyên bằng chứng và giới hạn **một lần** PM giao.

Các ca dưới đây **đều chưa chạy**, dù đã được viết trong probe:

- Recovery có quyền thì nút chat/Cần bạn bật.
- Bấm trùng giữa hai vị trí chỉ gửi một request đúng seq.
- Lỗi API giữ khóa qua render lại, event stop khác và revision cũ/sai box.
- Kiểm tra lại sai stop/box/lỗi không mở; xác nhận mới hợp lệ mở cả hai khi được phép, chưa chạy agent.
- Phản hồi thành công hiện Đã tiếp tục; lỗi từ chat đồng bộ sang Cần bạn.
- Đổi box khi request còn chờ; response/nút cũ không tác động box mới có cùng seq.
- Cần bạn dạng embedded/fallback khi không có cache chat.

Probe dự kiến giữ cửa sổ, renderer, preload và truyền IPC thật; sau khi lấy payload recovery BE thật mới thay handler `continueChain`/`chainState` trong tiến trình probe để chủ động trả lỗi/chậm. Lượt này dừng **trước** bước thay handler đó. Không kiểm lại bố cục T56, không dùng tổng số ca Electron cũ làm kết quả của lượt này, chưa thử box thật của End-User.

## So với lượt QA và bàn giao

Theo báo cáo QA/PM, các lượt QA trước dừng ở `_RegisterApplication`/`NSApplication` trước JavaScript. Lượt techlead này vượt qua khởi tạo macOS, nạp renderer và lấy được dữ liệu qua IPC. Có khác biệt giữa hai bối cảnh thực thi; **chưa kết luận sandbox là nguyên nhân SIGABRT**: chưa đối chứng có kiểm soát cùng thời điểm/worktree/quyền và cùng entry, dù cùng Electron 44.4.5 và cách gọi binary trực tiếp.

PM chuyển bằng chứng cho QA đọc; còn cần sửa phép trả về của probe rồi điều phối một lượt kiểm UI mới. T52 chưa đủ nghiệm thu Electron, T53/T55 vẫn chờ phạm vi UI/box thật; không thay đổi bằng chứng hay trạng thái các task trong lượt này. Sprint 12 chưa đóng.
