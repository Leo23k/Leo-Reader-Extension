# Leo Reader

![Leo Reader icon](icons/icon48.png)

[Tiếng Việt](#tiếng-việt) · [English](#english)

## Tiếng Việt

Leo Reader là extension đọc bài viết và văn bản được chọn theo kiểu chế độ đọc trên Chrome và Microsoft Edge. Extension có bảng điều khiển bên và chế độ hiển thị toàn bộ trang, kèm tính năng đọc thành tiếng và tô sáng nội dung đang đọc.

### Tính năng

- Lấy nội dung bài viết đang hiển thị trên trang; hỗ trợ các trang chương truyện khi nội dung đã được tải và tài khoản hiện tại có quyền xem.
- Đọc đoạn văn bản được chọn hoặc đọc toàn bộ nội dung đã trích xuất.
- Hiển thị trong bảng điều khiển bên hoặc toàn bộ trang.
- Đọc thành tiếng bằng giọng Chrome, giọng hệ thống và giọng tiếng Việt Edge Read Aloud.
- Chia nội dung dài thành chunk để phát; tô sáng theo câu hoặc từ và theo dõi vị trí đọc.
- Điều chỉnh tốc độ đọc, cỡ chữ, phông chữ, chủ đề, khoảng cách dòng và chữ; bật/tắt hình ảnh, liên kết và hiệu ứng tô sáng dòng.
- Lưu tùy chỉnh và vị trí đọc trên thiết bị.

### Cài extension

Yêu cầu Chrome 116 trở lên hoặc trình duyệt Chromium có hỗ trợ Side Panel.

1. Tải hoặc clone repository này về máy.
2. Mở `chrome://extensions` trên Chrome hoặc `edge://extensions` trên Edge.
3. Bật **Developer mode** (Chế độ dành cho nhà phát triển).
4. Chọn **Load unpacked** (Tải tiện ích đã giải nén) và chọn thư mục `Leo-Reader-Extension`.
5. Mở trang cần đọc rồi chọn biểu tượng Leo Reader trên thanh công cụ. Có thể nhấp phải trang và chọn **Mở trong chế độ đọc**.

Khi đọc một website lần đầu, trình duyệt có thể yêu cầu quyền truy cập website đó. Cấp quyền trên từng website cần đọc. Extension không vượt qua đăng nhập, paywall hoặc quyền truy cập của website; nội dung cần được hiển thị cho tài khoản của bạn trước khi extension có thể trích xuất.

### Giọng đọc

**Chrome và giọng hệ thống**

Chrome dùng các giọng do trình duyệt cung cấp, ví dụ Google Tiếng Việt 2 (Natural) nếu có trên máy. Giọng hệ thống dùng danh sách giọng mà hệ điều hành và trình duyệt cung cấp. Danh sách có thể khác theo máy và phiên bản trình duyệt.

Extension không gọi Google Cloud Text-to-Speech, không cần API key và không yêu cầu bật billing.

**Microsoft Edge Read Aloud**

Giọng Edge tiếng Việt chạy qua helper Python cục bộ. Cài Python 3, mở PowerShell trong thư mục repository và chạy:

```powershell
py -m pip install -r requirements.txt
py edge_tts_helper.py
```

Giữ cửa sổ helper chạy trong khi dùng giọng Edge. Helper chỉ lắng nghe trên `127.0.0.1:17843`; nội dung gửi để tổng hợp giọng Edge được xử lý qua dịch vụ giọng nói của Microsoft. Nếu helper không chạy, các giọng Chrome và hệ thống vẫn dùng được.

### Quyền và dữ liệu

- Extension dùng quyền tab và script để lấy nội dung trang sau khi bạn mở reader và cấp quyền cho website.
- Tùy chỉnh và phiên đọc gần nhất được lưu trong `chrome.storage.local` trên thiết bị.
- Văn bản gửi đến helper chỉ phục vụ yêu cầu tổng hợp giọng Edge. Các giọng Chrome và giọng hệ thống được gọi qua API của trình duyệt.
- Helper chỉ chấp nhận yêu cầu từ trang extension và chỉ bind vào địa chỉ loopback của máy.

### Khắc phục sự cố

- **Không thấy nội dung:** kiểm tra trang đã tải xong và tài khoản có quyền xem nội dung; mở reader lại hoặc chọn **Tải lại nội dung trang**. Nếu trình duyệt hỏi quyền website, hãy cấp quyền rồi thử lại.
- **Không thấy giọng Edge:** khởi động `py edge_tts_helper.py`, sau đó tải lại reader để làm mới danh sách giọng.
- **Giọng Chrome hoặc hệ thống không có trong danh sách:** kiểm tra giọng tiếng Việt đã được cài/được trình duyệt cung cấp; danh sách voice tùy thuộc môi trường.
- **Cài phiên bản mới:** mở trang quản lý extension và nhấn **Reload/Tải lại**.

## English

Leo Reader is a Chrome and Microsoft Edge reading-mode extension for articles and selected text. It offers a side panel and a full-page reader, with text-to-speech and reading highlights.

### Features

- Extracts visible article content, including story chapters when the page has loaded the content and your account can access it.
- Reads selected text or the extracted page.
- Displays the reader in a side panel or as a full page.
- Supports Chrome voices, system voices, and Microsoft Edge Read Aloud Vietnamese voices.
- Splits long text into playback chunks, highlights the current sentence or word, and tracks reading progress.
- Adjusts speech speed, font size, font family, theme, line height, and letter spacing; toggles links, images, and line highlighting.
- Saves reader settings and the latest reading position on the device.

### Install the extension

Requires Chrome 116 or later, or a Chromium browser that supports the Side Panel API.

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
3. Turn on **Developer mode**.
4. Select **Load unpacked** and choose the `Leo-Reader-Extension` folder.
5. Open a page and select the Leo Reader toolbar icon. You can also right-click the page and choose **Mở trong chế độ đọc** (Open in reading mode).

The browser may request access to a website the first time you read it. Grant access per website. The extension does not bypass sign-in, paywalls, or website access controls; the content must be available to your account and rendered on the page before it can be extracted.

### Voices

**Chrome and system voices**

Chrome uses voices exposed by the browser, such as Google Vietnamese 2 (Natural) when available. System voices come from the operating system and browser. Available voices vary by device and browser version.

The extension does not call Google Cloud Text-to-Speech, so it needs no API key or billing account.

**Microsoft Edge Read Aloud**

Vietnamese Edge voices use a local Python helper. Install Python 3, open PowerShell in the repository folder, and run:

```powershell
py -m pip install -r requirements.txt
py edge_tts_helper.py
```

Keep the helper running while using an Edge voice. It listens only on `127.0.0.1:17843`; text sent for Edge voice synthesis is processed by Microsoft's speech service. Chrome and system voices remain available when the helper is stopped.

### Permissions and data

- The extension uses tab and scripting permissions to read page content after you open the reader and grant access to the website.
- Reader settings and the latest reading session are stored in `chrome.storage.local` on your device.
- Text sent to the helper is used for Edge voice synthesis. Chrome and system voices are accessed through browser APIs.
- The helper accepts requests only from the extension page and binds to the local loopback interface.

### Troubleshooting

- **No page content:** make sure the page has finished loading and your account can access the content. Reopen the reader or select **Tải lại nội dung trang** (Reload page content). Grant website access if prompted.
- **No Edge voices:** start `py edge_tts_helper.py`, then reload the reader to refresh its voice list.
- **A Chrome or system voice is missing:** check that a Vietnamese voice is installed or exposed by the browser. The list depends on your environment.
- **After updating the extension:** open the extensions page and select **Reload**.
