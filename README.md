# Discord → WhatsApp Sticker Converter

A Chrome Extension (Manifest V3) that converts Discord stickers into WhatsApp-compatible WebP stickers.

## Features

- **Single Sticker Conversion** — Right-click any Discord sticker → "Convert to WhatsApp Sticker"
- **Full Sticker Pack Export** — Download all stickers from the current Discord page as a ZIP file
- **Format Support** — PNG, APNG (animated), and Lottie JSON stickers
- **WhatsApp Compatible** — Output is 512×512 WebP with transparency preserved

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer Mode** (toggle in top-right corner)
4. Click **"Load unpacked"**
5. Select the `discord-wa-sticker-extension` folder
6. The extension icon will appear in your toolbar

## Usage

### Convert a Single Sticker

1. Open [discord.com](https://discord.com) in Chrome
2. Find a sticker in any chat
3. **Right-click** the sticker image
4. Select **"Convert to WhatsApp Sticker"**
5. The converted `.webp` file will download automatically

### Export a Full Sticker Pack

1. Open [discord.com](https://discord.com) in Chrome
2. Navigate to a channel with stickers visible
3. Click the **extension icon** in the toolbar
4. Click **"Download Entire Sticker Pack"**
5. A `.zip` file containing all detected stickers will download

## File Structure

```
discord-wa-sticker-extension/
├── manifest.json        # Manifest V3 configuration
├── background.js        # Service worker (context menu, download pipeline)
├── content.js           # Content script (sticker detection on Discord)
├── converter.js         # Conversion logic (PNG/APNG/Lottie → WebP)
├── apngHandler.js       # APNG frame extraction and processing
├── lottieHandler.js     # Lottie animation rendering via canvas
├── zipExporter.js       # ZIP file creation for pack export
├── popup.html           # Extension popup interface
├── popup.js             # Popup button handlers and status display
├── styles.css           # Popup styling (dark theme)
├── icons/               # Extension icons
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Technical Details

- **Manifest V3** — Uses service worker background, no persistent background page
- **No Backend** — Everything runs locally in the browser
- **Canvas API** — Used for image resizing and format conversion
- **OffscreenCanvas** — Used in service worker for image processing
- **Custom ZIP** — Built-in ZIP implementation (no external dependencies required)

## Permissions

| Permission | Purpose |
|---|---|
| `activeTab` | Access the current Discord tab |
| `downloads` | Save converted sticker files |
| `scripting` | Inject content scripts |
| `contextMenus` | "Convert to WhatsApp Sticker" right-click menu |
| `storage` | Store extension settings |

## License

MIT
