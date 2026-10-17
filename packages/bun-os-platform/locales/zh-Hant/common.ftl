-product = Bun OS
common-unknown-value = -
common-on = 開
common-off = 關
common-cancel = 取消
common-close = 關閉
common-retry = 重試
common-open = 開啟

## Language and theme pickers

platform-language = 語言
platform-language-system = 系統語言（{ $name }）
platform-theme = 主題
platform-theme-baseline = { -product } 基礎主題
platform-theme-dynamic = 取自遊戲插圖的色彩
platform-contrast = 對比
platform-contrast-standard = 標準
platform-contrast-high = 高
platform-contrast-system = 跟隨系統
platform-mode-light = 淺色
platform-mode-dark = 深色
platform-mode-system = 系統

## Plugins

plugins-title = 外掛程式
plugins-count = { $count ->
   *[other] { $count } 個外掛程式
}
plugins-blocked = { $name } 已遭封鎖：{ $reason }
plugins-unpinned = { $name } 尚未釘選。執行 bun-os-platform plugins pin { $name } 以信任它。
plugins-permission = { $name } 要求 { $permission }

## File types (open, preview, import)

files-open = 開啟
files-import = 匯入
files-preview = 預覽
files-kind-image = 圖片
files-kind-video = 影片
files-kind-audio = 音訊
files-kind-rom = 遊戲映像檔
files-kind-firmware = 韌體
files-kind-save = 存檔資料
files-kind-archive = 壓縮檔
files-kind-package = 套件
files-kind-executable = 程式
files-kind-document = 文件
files-kind-font = 字型
files-kind-theme = 主題
files-kind-plugin = 外掛程式
files-kind-unknown = 未知檔案
files-detected = { $format }（{ $platform }），由 { $by } 偵測

## Transfers (downloads and uploads)

transfer-title = 傳輸
transfer-queued = 排隊中
transfer-running = { $percent }，速度 { $rate }
transfer-paused = 已暫停於 { $percent }
transfer-done = 已完成
transfer-failed = 失敗：{ $error }
transfer-verifying = 正在驗證 { $algorithm }
transfer-mirror = 來自 { $host }
transfer-lancache = 透過區域網路快取
transfer-pause = 暫停
transfer-resume = 繼續
transfer-remaining = { $done } / { $total }
transfer-limit = 限速 { $rate }
transfer-unlimited = 不限速

## Built-in plugins

plugin-bun-engine-free-roms = 免費 ROM 套件
