# T57 — nativeTheme gọi cửa sổ đã bị hủy

PM · 2026-10-14. Lỗi End-User báo khi chạy kiểm Electron trong worktree FE.

## Hiện tượng và xác minh

```text
Uncaught Exception:
TypeError: Object has been destroyed
at NativeTheme.<anonymous> (.../agents/5bae4f12-6288-4325-9eb2-6da1358fe618/main.js:3146:39)
at NativeTheme.emit (node:events:514:28)
```

- Worktree FE đang ở `2d3468c`, đã tích hợp main và giữ code T53. Dòng gây lỗi là `nativeTheme.on('updated', () => win.setBackgroundColor(windowBg()))`.
- Cùng callback cũng có trong main của PM và worktree BE (khoảng dòng 3738 tại thời điểm đọc). Đây là code main hiện có, không phải lỗi riêng renderer T53.
- Callback không kiểm cửa sổ còn sống và không gỡ listener khi cửa sổ bị hủy. Sự kiện đổi theme đến sau đó vẫn gọi `setBackgroundColor` lên đối tượng cũ, phù hợp trực tiếp với stack End-User cung cấp.
- Harness Electron hiện đổi theme sáng/tối rồi trả `themeSource` về `system` ngay trước `app.exit`. Đây là đường có thể tạo sự kiện muộn; PM chưa chạy Electron để xác định chính xác thời điểm gây lỗi trên máy.
- Probe trong bộ nhớ trích đúng dòng callback từ code: khi cửa sổ còn sống, đổi màu được một lần; sau khi giả lập destroyed, emit updated ném `Object has been destroyed`, listener vẫn còn. Probe này không thay kiểm vòng đời cửa sổ trên Electron thật.

## Phân công và đầu ra

**T57 — dev-be, acceptance: code.** Sửa trong `main.js`, thêm kiểm hồi quy liên quan trong `check.js`. Đây là hotfix phát sinh riêng; ưu tiên trước khi nghiệm thu Electron T53/T56, không mở rộng phạm vi FE hoặc giao PM sửa sản phẩm.

Đầu ra: callback nativeTheme chỉ cập nhật cửa sổ còn sống, listener được dọn đúng vòng đời; không có uncaught exception lúc test đóng/hủy cửa sổ. Giữ hành vi đổi nền sáng/tối bình thường và quyết định không dừng agent khi đóng app.

Hướng sửa tối thiểu: dùng handler có thể gỡ, kiểm cửa sổ tồn tại/chưa destroyed trước khi gọi native API; gỡ đúng handler khi cửa sổ đã đóng (`closed`). Không gỡ ở `close` vì người dùng còn có thể hủy thao tác đóng. Không dùng catch toàn cục để nuốt exception hoặc bỏ bước đổi theme của test để làm xanh.

## Nghiệm thu

1. Cửa sổ còn sống nhận updated thì nền vẫn đổi đúng sáng/tối.
2. Sau khi hủy cửa sổ, phát updated không gọi phương thức trên đối tượng đã hủy, không ném lỗi và listener của cửa sổ đã được dọn.
3. Nếu thao tác đóng bị hủy, cửa sổ còn sống vẫn nhận cập nhật theme.
4. Có assert hồi quy kiểm hành vi trên đường đăng ký callback thật; ca destroyed phải bắt được bản cũ. Giữ các suite BE/FE/QA hiện có, không sửa chung phần test không liên quan.
5. Chạy `npm run check` sau sửa; kiểm Electron một lần trên bản có hotfix, lưu exit code và output, không mở vòng lặp toàn suite. Gặp lỗi thì báo đúng lỗi thay vì thử lặp.
6. Bàn giao review với task T57 và bằng chứng đúng bản sửa; chưa tự đóng task. PM chỉ gọi nghiệm thu tiếp khi bản cần kiểm đã có hotfix.

## Phối hợp

- FE tiếp tục hoàn thiện T53 trong scope, ghi nhận lần Electron này thất bại do T57; đợi bản sửa main được gộp/tích hợp rồi kiểm Electron lại. Không sửa main.js trong nhánh FE hay lặp test trên bản còn lỗi này.
- BE đang làm T51/T54: nhận thêm T57 trong cùng phạm vi main/check; hoàn tất sửa và kiểm trước khi báo đạt. Giữ các sửa Sprint 12 đang làm.
- QA vẫn đang dừng theo End-User; lượt này không gọi QA chạy lại. Kết quả T55/T56 giữ nguyên cho tới khi có bàn giao tiếp.
- PM chỉ xác minh callback bằng đọc code/probe trong bộ nhớ và tạo task/spec; chưa sửa sản phẩm hoặc chạy Electron. Hotfix chưa được nghiệm thu.
