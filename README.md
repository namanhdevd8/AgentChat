# Agent Chat

Một nhóm agent AI (Claude Code, Codex, agy) làm việc chung trong một box chat, mỗi box gắn với một folder dự án.
Bạn nhắn việc như trong nhóm chat: `@tên` để gọi agent, không `@` thì PM nhận. PM chia việc thành task, các agent
cập nhật bảng task, ghi báo cáo vào folder và báo lại trong chat. Việc cần bạn quyết sẽ hiện ở mục **Cần bạn**.

## Cần có

- Node.js và npm (để chạy từ mã nguồn)
- Ít nhất một CLI đã cài và đăng nhập: `claude`, `codex` hoặc `agy`
- Git, nếu bật worktree riêng cho từng agent (Cài đặt nhóm › Worktree & Git)

## Chạy

```sh
npm install
npm start
npm run check   # bộ kiểm tra
```

## Đóng gói

```sh
npm run dist      # macOS .dmg
npm run dist:win  # Windows, bộ cài NSIS
```

Bản build chưa ký số: macOS chặn lần mở đầu (chuột phải › Open), Windows SmartScreen cảnh báo (More info › Run anyway).

Mỗi lần phát hành: nâng phiên bản (`npm version minor --no-git-tag-version` cho tính năng mới, `patch` cho bản sửa lỗi),
thêm mục cho phiên bản đó vào `CHANGELOG.md` (`npm run check` báo lỗi nếu thiếu), rồi mới build. Trong app, danh sách thay
đổi nằm ở mục Giới thiệu (chân sidebar hoặc menu).

## Dữ liệu nằm ở đâu

- Trong folder dự án: `.chat/` gồm log, bảng task, `memory.md` (bộ nhớ chung), `agents.json` (nhóm), `attachments/` (ảnh gửi trong chat). Box thứ hai của
  cùng folder là `.chat2/`, rồi `.chat3/`…
- Của riêng app (danh sách không gian, quyền đã tin, việc đã bỏ qua, kích thước cửa sổ): thư mục userData,
  trên macOS là `~/Library/Application Support/Agent Chat`.

## Phím tắt

| Phím | Việc |
| --- | --- |
| ⌘K | Chuyển không gian (gõ để lọc, không cần dấu) |
| ⌘1 … ⌘9 | Mở không gian thứ 1 … 9 |
| ⌘J | Tới box tiếp theo đang cần bạn |
| ⌘F | Tìm trong lịch sử |
| ⌘⇧T | Timeline: agent nào chạy lúc nào, bao lâu; chi phí của box |
| ⌘, | Cài đặt nhóm |
| Enter · Shift+Enter | Gửi · xuống dòng |

Trên Windows dùng Ctrl thay cho ⌘.

## Icon

`build/icon.svg` là bản gốc. Sửa xong thì render lại `build/icon.png` (1024px), electron-builder tự tạo `.icns`/`.ico` từ đó:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --default-background-color=00000000 --window-size=1024,1024 --screenshot=build/icon.png build/icon.svg
```
