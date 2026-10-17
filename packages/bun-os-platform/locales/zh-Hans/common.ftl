-product = Bun OS
common-unknown-value = -
common-on = 开
common-off = 关
common-cancel = 取消
common-close = 关闭
common-retry = 重试
common-open = 打开

## Language and theme pickers

platform-language = 语言
platform-language-system = 系统语言（{ $name }）
platform-theme = 主题
platform-theme-baseline = { -product } 基础主题
platform-theme-dynamic = 取自游戏插图的颜色
platform-contrast = 对比度
platform-contrast-standard = 标准
platform-contrast-high = 高
platform-contrast-system = 跟随系统
platform-mode-light = 浅色
platform-mode-dark = 深色
platform-mode-system = 系统

## Plugins

plugins-title = 插件
plugins-count = { $count ->
   *[other] { $count } 个插件
}
plugins-blocked = { $name } 已被阻止：{ $reason }
plugins-unpinned = { $name } 尚未固定。运行 bun-os-platform plugins pin { $name } 以信任它。
plugins-permission = { $name } 请求 { $permission }

## File types (open, preview, import)

files-open = 打开
files-import = 导入
files-preview = 预览
files-kind-image = 图片
files-kind-video = 视频
files-kind-audio = 音频
files-kind-rom = 游戏镜像
files-kind-firmware = 固件
files-kind-save = 存档数据
files-kind-archive = 压缩包
files-kind-package = 软件包
files-kind-executable = 程序
files-kind-document = 文档
files-kind-font = 字体
files-kind-theme = 主题
files-kind-plugin = 插件
files-kind-unknown = 未知文件
files-detected = { $format }（{ $platform }），由 { $by } 检测

## Transfers (downloads and uploads)

transfer-title = 传输
transfer-queued = 排队中
transfer-running = { $percent }，速度 { $rate }
transfer-paused = 已暂停于 { $percent }
transfer-done = 已完成
transfer-failed = 失败：{ $error }
transfer-verifying = 正在校验 { $algorithm }
transfer-mirror = 来自 { $host }
transfer-lancache = 通过局域网缓存
transfer-pause = 暂停
transfer-resume = 继续
transfer-remaining = { $done } / { $total }
transfer-limit = 限速 { $rate }
transfer-unlimited = 不限速

## Built-in plugins

plugin-bun-engine-free-roms = 免费 ROM 包
