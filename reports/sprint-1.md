# Sprint 1: Kiểm soát agent

Người viết: @pm · 2026-09-26. End-User đã chốt các mục #1, #3, #4 trong [roadmap.md](roadmap.md).

## Phạm vi

### #1 Nút Dừng agent và giới hạn thời gian
- Khi một agent đang chạy, có nút Dừng ở cột Thành viên và ở dòng "đang làm…". Bấm vào thì tiến trình CLI bị dừng ngay.
- Có giới hạn thời gian cho mỗi lượt. Mặc định 30 phút, chỉnh được cho từng agent trong ⚙.
- Khi agent bị dừng hoặc quá giờ, chat hiện tin nhắn hệ thống "@x đã bị dừng" hoặc "@x quá giờ". Chuỗi agent gọi nhau không được chạy tiếp từ lượt đó.
- Các việc khác đang xếp hàng của agent đó vẫn chạy bình thường.
- **Phải giữ nguyên phiên:** lượt tới agent vẫn resume đúng phiên cũ.

### #3 Hiện tiến độ trực tiếp
- Trong khi agent chạy, dòng "đang làm…" hiện bước gần nhất, ví dụ `@dev-be · sửa core.js`, `@qa · chạy npm run check`.
- Dùng đầu ra dạng stream của từng CLI:
  - claude: `--output-format stream-json --verbose`
  - codex: `--json` (đang dùng sẵn)
  - agy: `--output-format stream-json`
- Không ghi các bước tiến độ vào `log.jsonl`. Chat chỉ lưu câu trả lời cuối.

### #4 Chi phí và token mỗi lượt
- Dưới mỗi tin nhắn của agent hiện dòng nhỏ: số token vào/ra, chi phí USD nếu CLI có trả về, và thời gian chạy.
- Header của box hiện tổng chi phí và tổng token của box đó.
- Lưu số liệu vào `log.jsonl` như một trường của tin nhắn (ví dụ `usage`) để tính tổng khi mở lại box.

## Ngoài phạm vi
Khóa file thật (#2), diff, kanban. Sẽ làm ở sprint sau.

## Phân công (làm theo thứ tự)
1. **@techlead:** thiết kế interface giữa main và renderer: sự kiện `progress` và `usage`, IPC `stop`, cấu trúc `usage` trong log, và cách parse stream của 3 CLI. Ghi vào `reports/sprint-1-design.md`.
2. **@dev-be:** phần `core.js`, `main.js`, `preload.js` theo thiết kế.
3. **@dev-fe:** phần `index.html` theo thiết kế. Làm sau khi dev-be xong interface.
4. **@qa:** bổ sung `check.js` cho các hàm parse stream và usage; kiểm tra tay nút Dừng.

## Tiêu chí nghiệm thu
- `npm run check` qua hết.
- Dừng một agent đang chạy lâu: sau tối đa 2 giây không còn tiến trình CLI nào, và lượt sau vẫn resume đúng phiên.
- Cả 3 CLI đều hiện tiến độ và hiện usage sau mỗi lượt.

## Trạng thái (2026-09-27)
- **Đã xong:** BE, FE, `npm run check` qua (End-User xác nhận).
- **Chưa nghiệm thu:** 2 mục cần mở app thật. Chưa đóng sprint cho tới khi xong:
  1. Nút Dừng trên giao diện: End-User bấm Dừng một agent đang chạy, và lượt sau agent đó vẫn resume đúng phiên.
  2. Claude thật: **token và thời gian đã đạt** (qa kiểm tra log). Lượt đầu chưa có chi phí vì phiên pm có từ trước bản mới, đúng thiết kế. Lượt tiếp theo của pm phải có chi phí USD. Tiến độ trực tiếp cần End-User nhìn trên app để xác nhận.
- **Nút Dừng (2026-09-27):** End-User đã bấm Dừng qa; chat hiện "@qa đã bị dừng". Sau khi dừng, `sessions.json` vẫn giữ nguyên phiên `eb8cfc7e` của qa. Chỉ còn chờ lượt trả lời hiện tại của qa để xác nhận qa resume đúng phiên đó.
- **Dừng agent khi tắt app:** End-User quyết định không làm.
- **ĐÃ ĐÓNG (2026-09-27):** qa xác nhận lượt sau Dừng resume đúng phiên. Rủi ro còn mở: chưa kiểm tra trên máy thật (bằng `ps`) rằng không còn tiến trình con nào sau khi Dừng; ý này mới được kiểm tra bằng CLI giả.
