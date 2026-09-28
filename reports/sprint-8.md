# Sprint 8: Quyền công cụ của CLI theo agent (P) (chốt 2026-09-28)

End-User chốt: chỉ làm P. E, C, L để sau.

## Hiện trạng (PM đọc code)
Có hai lớp quyền tách rời. Cả hai đều mặc định cấm hết:
1. **Quyền của chính CLI:**
   - Claude chạy `-p --permission-mode acceptEdits` (core.js:97), nên sửa file thì được, còn Bash, WebFetch và MCP đều phải hỏi. Chạy ngầm không có ai trả lời nên bị từ chối.
   - codex chạy `sandbox_mode="workspace-write"`: không có mạng.
2. **"Lệnh được tự chạy"** (Sprint 5, block `run-command`): app chạy thay agent, phải khớp đúng từng argv.
   - Danh sách rỗng thì prompt ghi "(không có; không gửi block run-command)" (core.js:1254) và app từ chối mọi lệnh.
   - Mặc định chỉ có `npm run check`.
   - Danh sách này **không** được truyền cho CLI. Vì vậy dù có ghi `npm test` ở đây, Claude vẫn không được tự gọi Bash `npm test`.

Đính chính (techlead, T29): danh sách rỗng chỉ tắt app runner (block run-command). Nó không cấm các lệnh CLI tự chạy; những lệnh đó do chế độ quyền của từng CLI quyết định. Cách hiển thị hiện tại dễ gây hiểu lầm. Contract: reports/sprint-8-design.md.

## Phạm vi P
1. **Mục "Quyền" cho từng agent trong ⚙**, chọn một trong 3 mức:
   - **Chỉ sửa file**: như hiện tại, là mặc định.
   - **Tuỳ chỉnh**: mỗi dòng một quy tắc công cụ, ví dụ `Bash(npm test:*)`, `Bash(git status)`, `WebFetch`, `mcp__x`. Claude nhận qua `--allowedTools`.
   - **Toàn quyền**: Claude dùng `bypassPermissions`, codex dùng `danger-full-access`. Có cảnh báo đỏ, và phải bấm xác nhận khi bật.
2. **Gộp với "Lệnh được tự chạy"**: mỗi lệnh trong danh sách tự được cấp cho CLI dưới dạng `Bash(<lệnh>)`, để agent chạy trực tiếp được. Block run-command vẫn giữ để dùng khi CLI không tự chạy được, ví dụ agy. Nhãn trong ⚙ ghi rõ: "Để trống = agent không chạy được lệnh nào".
3. **Báo khi bị từ chối**:
   - Claude trả trường `permission_denials` trong kết quả. App hiện tin hệ thống, ví dụ "claude bị từ chối: Bash(pnpm i)", kèm nút **"Cho phép và chạy lại"**.
   - Bấm nút thì app thêm quy tắc vào mức Tuỳ chỉnh của agent, rồi gọi lại agent một lượt với cùng yêu cầu.
4. **codex**: thêm tuỳ chọn bật mạng. **agy**: techlead dò xem có cờ tương ứng không; nếu không có thì ghi rõ trong UI là không hỗ trợ.
5. Không đổi quyền toàn cục của CLI (không sửa `~/.claude/settings.json`), mọi thiết lập chỉ qua cờ dòng lệnh. Scope và khoá file vẫn giữ như cũ.

## Ngoài phạm vi
Trả lời hộp thoại xin quyền theo thời gian thực. Chế độ `-p` không hỗ trợ việc này, nên dùng cơ chế "từ chối → cho phép → chạy lại" thay thế.

## Phân công
1. techlead T29: thiết kế `reports/sprint-8-design.md`. Gồm: schema quyền trong agents.json, migration (mặc định Chỉ sửa file), cách map cờ cho claude/codex/agy, parse `permission_denials`, luồng nút "Cho phép và chạy lại", ảnh hưởng tới worktree/scope.
2. Sau thiết kế, làm song song: dev-be T30 (cờ CLI, parse bị từ chối, IPC cho phép và chạy lại, migration) và dev-fe T31 (mục Quyền trong ⚙, cảnh báo Toàn quyền, nút trên tin hệ thống).
3. PM nhận đủ hai bàn giao rồi gọi qa T32.

## Tiêu chí nghiệm thu
- Mức Chỉ sửa file cho ra cờ giống hệt hiện tại (không hồi quy).
- Mức Tuỳ chỉnh có `Bash(npm test:*)` → cờ `--allowedTools` đúng; CLI giả nhận được đủ các quy tắc.
- Lệnh trong "Lệnh được tự chạy" xuất hiện trong allowedTools dưới dạng `Bash(...)`.
- CLI giả trả `permission_denials` → có tin hệ thống, có nút. Bấm nút → quy tắc được lưu, agent chạy lại.
- Bật Toàn quyền phải xác nhận; tắt thì quay về như cũ.
- `npm run check` xanh.
