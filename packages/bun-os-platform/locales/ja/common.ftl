-product = Bun OS
common-unknown-value = -
common-on = オン
common-off = オフ
common-cancel = キャンセル
common-close = 閉じる
common-retry = 再試行
common-open = 開く

## Language and theme pickers

platform-language = 言語
platform-language-system = システムの言語（{ $name }）
platform-theme = テーマ
platform-theme-baseline = { -product } 標準
platform-theme-dynamic = ゲームアートの色
platform-contrast = コントラスト
platform-contrast-standard = 標準
platform-contrast-high = 高
platform-contrast-system = システムに従う
platform-mode-light = ライト
platform-mode-dark = ダーク
platform-mode-system = システム

## Plugins

plugins-title = プラグイン
plugins-count = { $count ->
   *[other] { $count } 個のプラグイン
}
plugins-blocked = { $name } はブロックされています：{ $reason }
plugins-unpinned = { $name } は固定されていません。信頼するには bun-os-platform plugins pin { $name } を実行してください。
plugins-permission = { $name } が { $permission } を要求しています

## File types (open, preview, import)

files-open = 開く
files-import = インポート
files-preview = プレビュー
files-kind-image = 画像
files-kind-video = 動画
files-kind-audio = オーディオ
files-kind-rom = ゲームイメージ
files-kind-firmware = ファームウェア
files-kind-save = セーブデータ
files-kind-archive = アーカイブ
files-kind-package = パッケージ
files-kind-executable = プログラム
files-kind-document = ドキュメント
files-kind-font = フォント
files-kind-theme = テーマ
files-kind-plugin = プラグイン
files-kind-unknown = 不明なファイル
files-detected = { $format }（{ $platform }）、{ $by } が検出

## Transfers (downloads and uploads)

transfer-title = 転送
transfer-queued = 待機中
transfer-running = { $percent }（{ $rate }）
transfer-paused = { $percent } で一時停止中
transfer-done = 完了
transfer-failed = 失敗：{ $error }
transfer-verifying = { $algorithm } を検証中
transfer-mirror = { $host } から
transfer-lancache = LAN キャッシュ経由
transfer-pause = 一時停止
transfer-resume = 再開
transfer-remaining = { $done } / { $total }
transfer-limit = 制限 { $rate }
transfer-unlimited = 制限なし

## Built-in plugins

plugin-bun-engine-free-roms = 無料ROMパック
