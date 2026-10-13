# Sprint 10 — Contract V1 / V2 / V3

Techlead · T42 · 2026-10-13. Nền code **`179ad05` / Electron 44.4.5**. Theo [spec Sprint 10](sprint-10.md), đã đọc bản PM trong thư mục dự án chính vì commit spec chưa có trong worktree lúc bắt đầu. Đây là bàn giao thiết kế; không sửa code sản phẩm.

## 1. Quyết định

| Mục | Thiết kế đã chốt |
| --- | --- |
| V1 | Giữ dialog hiện có; đổi cỡ, phóng to/khôi phục; lưu bố cục trong localStorage của app. |
| V2 | PNG/JPEG/GIF/WebP/SVG dùng `<img>` và blob; `readImage` dùng cùng định tuyến workspace của T40. SVG không được chèn vào DOM của app. |
| V3 | Iframe `sandbox=""`, `src` là protocol nội bộ **`agent-preview:`**, CSP trong response header; main chỉ phục vụ HTML được mở và tài nguyên ảnh/CSS trong phạm vi đã chốt. |
| Phụ thuộc | Dùng API Electron/Chromium/Node đã đóng gói; không thêm thư viện, không mở server localhost. Mermaid, PDF/Office, JS trong preview để sau. |

Protocol tiêu chuẩn giải quyết URL tương đối trong HTML, CSS `@import` và `url(...)` bằng trình duyệt, tránh tự viết bộ sửa HTML/CSS. Đăng ký scheme trước `app.ready`, handler trên đúng session của cửa sổ app. [Electron protocol](https://www.electronjs.org/docs/latest/api/protocol).

Giữ `readProjectFile` và dạng trả về Markdown/text của T40. Thêm API cho HTML preview; không biến mọi lần đọc text thành một phiên preview. Nút mở HTML ra ngoài là hành động riêng của người dùng, không phát sinh khi bấm link bên trong trang xem trước.

## 2. Những chỗ cần nối đủ

- **BE:** `core.js` (`resolveProjectFile`, đọc bytes có giới hạn, nhận diện ảnh), `main.js` (`viewerTarget`, IPC, protocol, chặn điều hướng/request, vòng đời preview, kiểm tra sender), `preload.js`.
- **FE:** `index.html` (CSP riêng cho iframe, dialog, toolbar), `renderer.js` (`openFileViewer`, `loadImages`, reload/watch/close/đổi box, xử lý blob, nhánh hiện tại).
- **Check:** giữ toàn bộ ca T40/T41. Main harness hiện chỉ có `event.sender`, cần bổ sung `senderFrame` và frame chính; stub session/protocol theo API thực, không bỏ kiểm tra sender để test chạy.
- Main hiện chỉ chặn `will-navigate` và so `event.sender === win.webContents`; khi có iframe cần chặn cả điều hướng frame và xác minh frame gửi IPC. `loadImages` hiện truyền cả object workspace vào tham số `workspaceId`; FE phải sửa thành `workspace?.id`.

## 3. V1 — Cỡ dialog và thao tác

LocalStorage key **`viewer-layout:v1`**, dùng chung giữa các dự án/box trên máy:

```ts
type ViewerLayout = { width: number; height: number; maximized: boolean };
```

- `width/height` là cỡ **bình thường**, tính theo CSS px, mặc định 880 × 720. Phóng to gần đầy vùng nội dung cửa sổ, chừa 16 px mỗi cạnh; nút đổi giữa “Phóng to” / “Thu nhỏ”, có title/accessible name và `aria-pressed`.
- Clamp vào viewport khi mở, kéo cỡ, đổi màn hình hoặc resize cửa sổ: minWidth = min(480, availableWidth), minHeight = min(320, availableHeight); max = viewport trừ lề. Luôn nhìn thấy Đóng. Toolbar được xuống dòng, body `min-height:0; overflow:auto`.
- Thu nhỏ trả về cỡ bình thường đã lưu, có clamp. Không ghi đè cỡ bình thường bằng cỡ phóng to hoặc cỡ bị ép do cửa sổ tạm hẹp.
- Kéo góc để đổi cỡ ở chế độ bình thường; có thao tác bằng phím trên tay nắm focus được: phím mũi tên đổi mỗi chiều 32 px, ghi rõ hướng dẫn qua accessible description. Có thể dùng CSS `resize:both` cho thao tác chuột cùng handler phím. Phóng to thì khóa kéo cỡ.
- Ghi localStorage sau resize (debounce khoảng 150 ms) và khi đổi chế độ; dữ liệu thiếu/sai/NaN, JSON hỏng hoặc storage bị chặn thì dùng mặc định, không làm hỏng viewer. Bỏ qua thay đổi do programmatic layout khi lưu cỡ người dùng.
- Esc/Đóng đều gọi một hàm cleanup, trả focus về phần tử đã mở viewer. Giữ phần tử đó trong cả lần reload/đổi tab, không thay thành nút Đóng. Chỉ layout được nhớ; file mới mặc định ảnh “Vừa khung”, HTML “Xem trước”.

## 4. V2 — Đọc và xem ảnh/SVG

### 4.1 Nhận diện và giới hạn

`readImage` giữ PNG/JPEG/GIF/WebP hiện có, thêm MIME **`image/svg+xml`**. Căn cứ nội dung bytes, không chỉ đuôi file. Với các đuôi ảnh được hỗ trợ, kiểu nhận diện phải tương ứng (`jpg/jpeg` là một kiểu); file giả đuôi trả `UNSUPPORTED`. Không cho `.svg` chứa HTML chỉ vì có chuỗi `<svg>` ở giữa.

SVG tối thiểu cần UTF-8 hợp lệ; cho phép BOM, XML declaration và comment trước phần tử gốc. Phần tử gốc phải là `svg`, namespace `http://www.w3.org/2000/svg`; từ chối DOCTYPE/entity declaration và processing instruction ngoài XML declaration, gồm `xml-stylesheet`. Không dùng regex này như bộ khử mã độc: đây chỉ là nhận diện; **ranh giới thực thi là chế độ ảnh của Chromium**. XML hỏng sâu bên trong hoặc bitmap hỏng phải đi vào `img.onerror` với thông báo “Ảnh lỗi hoặc không được hỗ trợ”, không spinner vô hạn.

SVG chỉ xuất hiện dưới dạng `<img src=blob:…>` trong viewer/chat/Markdown. Không `innerHTML`, không `<object>`, `<embed>`, iframe SVG hay đưa SVG vào `shell.openPath`. Trong HTML preview, tài nguyên SVG cũng chỉ được phục vụ theo loại request `image`. Chế độ ảnh không thực thi JS và không tải tài nguyên ngoài của SVG; điều này khác với mở SVG như tài liệu. [MDN: SVG as an image](https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image).

Giữ giới hạn **10 MiB/ảnh**, gồm SVG; text/HTML/CSS **2 MiB/file**. BE dùng `resolveProjectFile` + đọc descriptor có giới hạn thật (cap+1), kiểm tra file thường, `O_NOFOLLOW`, stat/realpath trước-sau như `readProjectFile`; không chỉ stat rồi `readFile` không giới hạn. Dùng `original-fs` như code hiện tại. Nếu tách helper đọc bytes thì giữ nguyên hành vi/lỗi của text reader. `saveImage`/clipboard tiếp tục chỉ nhận bitmap; không vô tình mở rộng endpoint ghi ảnh khi thêm bộ nhận SVG vào read path.

### 4.2 IPC `readImage` mở rộng, tương thích caller cũ

```ts
api.readImage(dir, href, fromFile = null, workspaceId = null): Promise<
  | { ok: true; path: string; name: string; mime: string; bytes: Uint8Array;
      version: string; canOpenExternal: boolean; workspace: Workspace | null }
  | { ok: false; code: string; message: string; workspace?: Workspace | null }
>;
type Workspace = { id: string; branch: string };
```

- Giữ `path/mime/bytes` ở cấp hiện tại. `path` là đường dẫn tương đối **chưa mã hóa URL**, `version` là SHA-256 của bytes. `workspace` là kết quả main đã xác minh qua `viewerTarget`, không tin object caller tự gửi.
- Dùng `viewerTarget` cho readImage giống readProjectFile: link tuyệt đối/file URL của worktree cũ vẫn mở đúng nhánh; `.chat` dùng chung về root; không tự tìm worktree khác khi file không tồn tại.
- Các kiểm tra T41 về symlink, `..`, host lạ, workspace giả/integration vẫn áp dụng. `canOpenExternal` giữ luật của T40 cho bitmap; SVG luôn false.

### 4.3 FE

- Viewer phân luồng theo đuôi đã decode: `.png/.jpg/.jpeg/.gif/.webp/.svg` → readImage, `.html/.htm` → mục 5; các file còn lại → readProjectFile cũ. MIME cuối cùng do BE quyết định, đuôi chỉ chọn luồng UI.
- Blob tạo trong renderer từ bytes + MIME được BE trả, gán vào `<img>`. “Vừa khung” giữ tỉ lệ và cho xem toàn ảnh, “100%” dùng kích thước tự nhiên và cho cuộn hai chiều, không đổi cỡ dialog. SVG không có kích thước cố định dùng kích thước tự nhiên Chromium tính từ SVG/viewBox, không tự đoán tỷ lệ khác.
- Ảnh trong chat/Markdown bấm được để mở viewer này, kể cả SVG và file ngoài `reports/`; không gọi `openFile` trực tiếp như hiện tại. Dùng path đã URL-encode từng segment + `res.workspace`, giữ alt và vị trí cuộn cũ. Ảnh đã nằm trong link thì giữ đích link đó.
- Revoke blob khi thay ảnh, đóng viewer, đổi box; xử lý cả response đến muộn theo `viewerGen`. Chat có thể revoke sau decode như hiện tại. Không đưa bytes vào log/localStorage.

## 5. V3 — HTML preview

### 5.1 IPC và dữ liệu FE/BE

```ts
api.createHtmlPreview(dir, href, fromFile = null, workspaceId = null): Promise<
  | { ok: true;
      file: { path: string; name: string; format: 'text'; content: string; version: string };
      workspace: Workspace | null;
      preview: { id: string; url: string } }
  | { ok: false; code: string; message: string }
>;
api.closeHtmlPreview(previewId: string): Promise<{ ok: true }>;
api.openHtmlExternal(dir, href, workspaceId = null): Promise<
  | { ok: true; opened: boolean }
  | { ok: false; code: string; message: string }
>;
// main → renderer, chỉ khi cần đóng viewer đang có preview:
api.on('html-preview-escape', (previewId: string) => { /* đóng nếu vẫn là preview này */ });
```

Mã lỗi dùng nhóm hiện có `INVALID_PATH`, `OUTSIDE_PROJECT`, `NOT_FOUND`, `UNSUPPORTED`, `TOO_LARGE`, `FILE_CHANGED`, `IO_ERROR`; lỗi phiên không còn hiệu lực thêm `PREVIEW_EXPIRED`. Envelope lỗi các API mới không ném exception cho lỗi file dự kiến; FE vẫn catch lỗi IPC/vận chuyển.

`createHtmlPreview` đọc `.html/.htm` UTF-8 ≤2 MiB qua T40, trả text **nguyên bản** cho tab Mã nguồn và lưu cùng snapshot làm HTML entry của phiên. Không cho FE gửi arbitrary HTML string/CSP/root vào main. Sử dụng workspace BE đã xác minh cho title/watch/reload/open-external; file.path được encode một lần khi dùng lại làm href.

### 5.2 Protocol và phân giải tài nguyên

Scheme đăng ký một lần: `agent-preview`, privileges **`{ standard: true, secure: true }`**. Không `bypassCSP`, `allowServiceWorkers`, `supportFetchAPI`, không tắt `webSecurity`. `session.protocol.handle` trả `Response` từ bytes đã kiểm tra; không `net.fetch(file://…)`, không proxy HTTP và không static-directory handler bỏ qua resolver.

URL do main sinh:

```text
agent-preview://<random-token>/files/<relative-path-encoded-by-segment>
Ví dụ: agent-preview://<token>/files/design/index.html
  ./assets/a.png → /files/design/assets/a.png
  ../style.css  → /files/style.css
  ../../secret  → /secret       → bị chặn vì mất prefix /files/
```

Token ngẫu nhiên ≥128 bit, chỉ ở RAM; record gắn owner webContents, root/box và workspace đã xác minh, entry path, snapshot HTML, trạng thái tạo/tải, bộ đếm tài nguyên. FE không chọn token hoặc đường dẫn vật lý. Một preview hoạt động/cửa sổ; request tạo mới nhất thắng, kể cả đọc file async hoàn tất đảo thứ tự.

Mọi request phải thỏa:

1. GET, token còn hiệu lực, đúng owner và frame preview; URL không credentials/port, đúng host token. Không căn cứ riêng vào `referrer` để xác minh. Request của frame chính, token cũ/box khác, hoặc loại không xác định bị từ chối.
2. Đúng prefix `/files/`. Tách path thành segment, decode **một lần**, từ chối NUL/control, separator được encode (`%2f`, `%5c`), backslash và segment còn là `.`/`..`; không decode vòng hai. Query dùng như cache key phụ nhưng không là đường dẫn/địa chỉ fetch; hash do trình duyệt xử lý.
3. Resolve phần sau `/files/` vào root/workspace đã chốt, qua kiểm tra lexical + realpath + đọc descriptor như mục 4.1. Không nhận một đường dẫn tuyệt đối/file URL từ asset URL để chuyển sang workspace khác. `.chat*` có thể ánh xạ canonical root giống T40, sau khi đã loại traversal; đích vẫn phải nằm trong canonical root.
4. Chỉ entry HTML được phục vụ dưới `subFrame`. Tài nguyên: `.css` UTF-8 với request `stylesheet`; bitmap/SVG đã xác minh với request `image`. Không phục vụ HTML khác, JS, JSON, font, media, document download. `@import` và `url(...)` được Chromium phân giải theo URL file CSS; mọi lần đọc vẫn qua cùng kiểm tra. CSS vòng lặp/loạt tài nguyên bị giới hạn bên dưới.

Giới hạn phiên: tối đa **128 path tài nguyên khác nhau, 32 MiB bytes tổng** (gồm HTML entry), mỗi CSS ≤2 MiB, mỗi ảnh ≤10 MiB; tính cả request đang đọc để không vượt cap khi song song. Có thể cache snapshot theo path trong phiên để tránh đọc lặp; query khác nhau không tạo bản cache/cap riêng cho cùng path. Token bị đóng thì không gửi kết quả đọc đang chờ. Không persist HTML/assets/token.

URL bắt đầu `/assets/...` không có `/files/` bị từ chối; Sprint này hỗ trợ URL tương đối chuẩn. Font ngoài, CSS framework CDN, JS và file thiếu có thể làm trang khác bản chạy đầy đủ. Thanh viewer ghi ngắn: **“Xem trước tĩnh · Không chạy JavaScript hoặc tải tài nguyên mạng”**. Asset bị lỗi không làm mất tab Mã nguồn hoặc làm viewer treo.

### 5.3 Các lớp cô lập bắt buộc

**FE:** iframe có `sandbox=""`, `referrerpolicy="no-referrer"`, title mô tả file. Gán sandbox **trước** src; không `allow-scripts`, `allow-same-origin`, allow-forms/popups/downloads/top-navigation; không `srcdoc`, DOMParser hay innerHTML để xử lý HTML lạ trong renderer chính.

**Header do main gắn trước khi Chromium parse**, với `<origin>` là `agent-preview://<token>` chính xác:

```text
Content-Type: text/html; charset=utf-8
Content-Security-Policy: default-src 'none'; script-src 'none';
  style-src 'unsafe-inline' <origin>; img-src <origin>;
  font-src 'none'; connect-src 'none'; media-src 'none';
  object-src 'none'; frame-src 'none'; worker-src 'none';
  base-uri 'none'; form-action 'none'; sandbox
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cache-Control: no-store
X-DNS-Prefetch-Control: off
```

CSS/ảnh nhận MIME đúng, nosniff/no-store/no-referrer; response lỗi chỉ text/plain, không echo HTML lạ. Không nhận header/CSP từ file dự án. Meta CSP của HTML chỉ có thể siết thêm. `sandbox` CSP phải nằm trong response header; không dựa vào meta để bật nó. `base-uri 'none'` chặn `<base>` đổi gốc tài nguyên. [MDN sandbox](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox), [MDN base-uri](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/base-uri).

**CSP của app:** chỉ thêm `frame-src agent-preview:`; giữ script-src, img-src blob và các rule cũ. Không thêm `file:`, `http:`, `https:`, wildcard hay `unsafe-inline` cho script để iframe hoạt động. Chính sách iframe không kế thừa quyền tải Google Fonts của trang app.

**Main điều hướng/request:**

- Giữ deny `setWindowOpenHandler` và chặn điều hướng main. Thêm `will-frame-navigate` và chặn redirect: chỉ cho initial entry từ frame chính đáng tin vào iframe con trực tiếp, đúng token còn chờ; sau đó chặn mọi điều hướng tài liệu từ preview, kể cả đổi sang entry khác/cùng URL. Anchor cùng tài liệu không ra mạng có thể giữ. Không cho `javascript:`, `data:`, `blob:`, `file:`, HTTP hay custom OS scheme thoát ra ngoài. Event này bao phủ subframe, khác `will-navigate` chỉ bao phủ main. [Electron webContents](https://www.electronjs.org/docs/latest/api/web-contents#event-will-frame-navigate).
- Cài một `webRequest.onBeforeRequest` trên session hiện tại: với request từ mọi frame con của cửa sổ app, mặc định cancel; chỉ mở ngoại lệ token/entry/assets đã nêu ở 5.2, GET, đúng resourceType. Không tin `initiatorOrigin='null'` hay referrer rỗng là request an toàn. Nếu frame chưa rõ hoặc đã bị hủy thì từ chối. Gắn token vào frame khi điều hướng entry được main cho phép; không chỉ so URL của frame vì lúc bắt đầu nó có thể còn `about:blank`. Header CSP chặn từ bước parse; request gate là lớp phụ trước I/O. Không chặn request hiện có của frame chính như font UI. Listener phải được cài một lần, không thay listener khác theo mỗi lần mở viewer. [Electron WebRequest](https://www.electronjs.org/docs/latest/api/web-request).
- Không cấp permission cho preview, chặn download của frame con; không bật preload/Node cho subframes. Ghi rõ `nodeIntegration:false`, `nodeIntegrationInSubFrames:false`, `contextIsolation:true`, `sandbox:true` cho cửa sổ. `validSender` bắt buộc sender là webContents app **và senderFrame chính là mainFrame app**, áp dụng toàn bộ IPC, không chỉ API preview. Preload chỉ expose bridge ở main frame. [Electron security](https://www.electronjs.org/docs/latest/tutorial/security).

Không coi sandbox đơn lẻ là bằng chứng “không mạng”: CSS/ảnh/điều hướng phải được thử ở Electron thật. SVG inline bên trong HTML chỉ tồn tại trong iframe đã cô lập, không trong DOM app; JS/events và URL ngoài vẫn bị các lớp trên chặn.

### 5.4 Vòng đời, reload và Esc

- FE giữ `preview.id` bên cạnh `viewerGen/currentViewerWorkspace`. Đổi file, Tải lại, đóng, đổi project/box: tháo iframe, đóng **đúng id**, revoke blob, bỏ response cũ. `closeHtmlPreview` idempotent, token không thuộc sender không được tác động phiên khác.
- Main thu hồi token khi tạo phiên mới, đổi project/box, main reload/navigate, cửa sổ bị hủy/app thoát. Kiểm generation sau mọi await; không để một create hoàn tất muộn hồi sinh token đã bị hủy. Không TTL làm một file đang đọc tự mất giữa chừng; giới hạn một phiên + thu hồi theo vòng đời là đủ.
- Watch entry bằng API cũ; Tải lại tạo snapshot/token mới, nạp lại CSS/ảnh. Sprint này không thêm watcher cho mọi asset: thay riêng asset thì bấm Tải lại. Đổi tab giữ source và snapshot cùng version, không tự đọc hai bản HTML khác nhau.
- Esc phải đóng được khi focus nằm trong iframe. Giữ native dialog cancel/close; BE hỗ trợ `before-input-event` khi Escape và có preview hiện hành: gửi `html-preview-escape(id)` về main renderer; FE kiểm id rồi cleanup. Không inject JS vào iframe để bắt phím. Dedupe với native cancel để không đóng hai lần/hỏng focus.

### 5.5 “Mở bằng trình duyệt”

Nút chỉ ở toolbar HTML của app. `openHtmlExternal` dùng `viewerTarget` + resolver T40, chỉ file thường `.html/.htm` thuộc dự án/worktree hợp lệ; không shell command và không mở URL từ nội dung trang. Đây là quyền riêng cho HTML, **không thêm HTML/SVG vào allowlist chung của openFile/openLink**.

Main hiện native confirm với đường dẫn thật/nhánh: “Mở HTML bằng ứng dụng mặc định? JavaScript và truy cập mạng có thể hoạt động.” Huỷ trả `{ok:true, opened:false}`; đồng ý thì resolve/kiểm phạm vi lại trước `shell.openPath`, trả opened:true khi thành công. Đây là bước thiết kế cho hành động người dùng yêu cầu mở ngoài, không hỏi thêm để triển khai sprint. Hệ điều hành dùng app mặc định cho `.html` (thường là trình duyệt); không gọi executable trình duyệt cụ thể. Cảnh báo không xuất hiện khi chỉ xem preview trong app.

## 6. Phân công để FE/BE làm song song

| Người / task | Phần phải bàn giao |
| --- | --- |
| dev-be / T43 | core/main/preload: reader ảnh/SVG, metadata và định tuyến workspace, IPC mới, protocol + CSP + request/navigation gate + lifecycle, senderFrame, mở HTML ngoài và event Esc. Không thêm dependency. |
| dev-fe / T44 | index.html/renderer.js: V1, ảnh fit/100%, click ảnh trong chat, hai tab HTML, iframe attributes/CSP app, source textContent, IPC và cleanup/late-response đúng contract. |
| qa / T45 | Nghiệm thu độc lập cả Node harness lẫn Electron thật, nhất là không có mạng/JS và thoát iframe. PM nhận đủ hai bàn giao rồi mới gọi QA. |

Trong `check.js`, BE sở hữu ca core/main/IPC/protocol và cập nhật fake Electron + senderFrame của main harness; FE sở hữu renderer VM/DOM/layout/cleanup và assertion HTML/CSS. Mỗi người thêm hàm kiểm riêng và nối vào chuỗi hiện có; khi merge chỉ giữ cả hai lời gọi. BE phải giữ `npm run check` xanh cả khi FE chưa gộp; không thêm assertion buộc UI mới đã có. FE dùng fixture đúng envelope mục 4.2/5.1, không đoán shape rồi sửa contract ngầm.

## 7. Nghiệm thu

### 7.1 Tự động (`npm run check`)

1. **V1:** JSON sai/NaN/cỡ cũ lớn hơn viewport; max→restore không mất cỡ thường; mở lại nhớ chế độ; debounce không ghi liên tục; Esc/Đóng/đổi box cleanup một lần, trả đúng focus.
2. **Ảnh:** đủ năm kiểu, SVG BOM/XML declaration/comment, tên Unicode/space/%/#; fake-extension/UTF-8 hỏng/DOCTYPE/entity/file >10 MiB; mã onload/script/foreignObject và URL ngoài trong SVG; load/decode lỗi có message. `saveImage` vẫn từ chối SVG.
3. **Workspace:** link file:// của tin cũ, main/worktree có cùng tên ảnh nhưng khác bytes; reload đúng nhánh, `.chat` chung; metadata workspace.id không phải object. Giữ nguyên 20 ca T41; lặp lại cho API mới và protocol asset.
4. **Protocol:** entry snapshot = source tab; CSS tương đối, import CSS cấp hai và ảnh trong CSS đúng thư mục; ../ hợp lệ trong root mở được, vượt `/files/`/encoded separator/double encode/symlink ra ngoài không được; fake token, token cũ, owner/box/workspace khác, integration/worktree giả bị chặn; không phục vụ HTML thứ hai/script/JSON/font/POST.
5. **Lifecycle/tải lớn:** hai create trả đảo thứ tự, close lúc đang đọc, đổi box khi tải, late-response không hồi sinh iframe/token/blob; request đồng thời không vượt 128/32 MiB; reload dùng token mới, cap reset.
6. **IPC/open ngoài:** senderFrame con bị chặn ở mọi API; main frame vẫn chạy IPC cũ. Huỷ không gọi shell; đồng ý chỉ mở file HTML đã xác minh, symlink thay trước lúc xác nhận bị chặn; openFile/openLink không tự được mở HTML/SVG.

### 7.2 Electron thật — bắt buộc trước khi báo V3 đạt

Node VM/stub không chứng minh CSP/sandbox/request blocking. QA chạy trên Electron đóng gói hiện có, dùng fixture dự án/worktree tạm và server HTTP loopback **chỉ phục vụ đo trong test** (không thêm server vào sản phẩm). Ghi số request phía server = **0** cho preview; lưu kết quả phiên bản Electron và các ca dưới đây vào báo cáo.

- Trang có inline CSS + stylesheet ngoài tương đối, @import, PNG/SVG, ảnh nền CSS phải hiện đúng. Tab Mã nguồn hiện nguyên `<script>` bằng text, không chạy. File SVG trong chat/Markdown/viewer chỉ hiện ảnh; file lỗi không kẹt.
- Thử `<script>`, inline event, javascript link, meta refresh, form submit, target `_top/_blank/_self`, download, object/embed/iframe/srcdoc lồng, SVG inline, `<base>`, external img/srcset/CSS import/url, link prefetch/preconnect/dns-prefetch; không JS/IPC/điều hướng/network ra ngoài. Không chỉ xem message CSP: kiểm request counter và navigation event thực.
- Thử link bằng chuột, Enter, middle-click; iframe không mở OS protocol/app khác hoặc tải file. Header CSP không bị meta trong trang làm lỏng. Preview không có `window.api/require`, không đọc được parent DOM.
- Tải lại/đổi box khi preview đang mở không rò token hoặc đọc root mới bằng token cũ. Nút mở ngoài chỉ chạy sau thao tác toolbar + confirm của user, đúng nhánh; request ngoài sau xác nhận không tính vào ca cấm mạng của preview.
- V1: kéo góc, bàn phím, phóng/thu, Esc khi đang focus iframe/ảnh/nút, cửa sổ nhỏ và resize, theme sáng/tối; nút Đóng luôn hiện. Ảnh fit/100% giữ tỷ lệ, cuộn không làm nhảy chat. `.md`, link file:// T40/T41 và iframe không làm hỏng font/UI chính.

Nếu không chạy được Electron thật thì báo rõ phần chưa kiểm; không ghi V3 đạt chỉ từ harness giả. Sửa core/main/preload cần khởi động lại app sau khi gộp.

## 8. Kiểm chứng ở bước thiết kế

Đã đối chiếu code nền, spec, type definitions của Electron 44.4.5 đang cài và tài liệu API chính thức (link ở các mục trên). Đã chạy probe độc lập trên Electron 44.4.5 với cửa sổ ẩn, protocol standard+secure, iframe sandbox rỗng, CSP response: HTML và CSS tương đối được đọc, SVG hình chữ nhật đỏ hiện, CSS inline đổi chữ thành xanh, stylesheet đổi cỡ chữ; console xác nhận script/meta refresh/external img/frame/CSS URL bị chặn; không có HTTP request tới gate. Probe bổ sung preconnect/dns-prefetch/prefetch và stylesheet trỏ server HTTP loopback tạm: **0 kết nối, 0 request phía server**. Main thấy `iframe.contentDocument === null`, không có thay đổi parent do trang con.

Probe chỉ kiểm chứng lựa chọn nền tảng, chưa triển khai resolver/token/gate đầy đủ hay kiểm hết ca bảo mật/UX ở mục 7. File probe tạm đã dọn; lượt này chỉ ghi contract và memory, kiểm whitespace. Hai dev và QA vẫn phải triển khai/kiểm đầy đủ theo contract.
