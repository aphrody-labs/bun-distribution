-product = Bun OS
common-unknown-value = -
common-on = 켬
common-off = 끔
common-cancel = 취소
common-close = 닫기
common-retry = 다시 시도
common-open = 열기

## Language and theme pickers

platform-language = 언어
platform-language-system = 시스템 언어({ $name })
platform-theme = 테마
platform-theme-baseline = { -product } 기본
platform-theme-dynamic = 게임 아트 색상
platform-contrast = 대비
platform-contrast-standard = 표준
platform-contrast-high = 높음
platform-contrast-system = 시스템 설정 따르기
platform-mode-light = 라이트
platform-mode-dark = 다크
platform-mode-system = 시스템

## Plugins

plugins-title = 플러그인
plugins-count = { $count ->
   *[other] 플러그인 { $count }개
}
plugins-blocked = { $name } 차단됨: { $reason }
plugins-unpinned = { $name }이(가) 고정되지 않았습니다. 신뢰하려면 bun-os-platform plugins pin { $name }을(를) 실행하세요.
plugins-permission = { $name }이(가) { $permission } 권한을 요청합니다

## File types (open, preview, import)

files-open = 열기
files-import = 가져오기
files-preview = 미리 보기
files-kind-image = 이미지
files-kind-video = 동영상
files-kind-audio = 오디오
files-kind-rom = 게임 이미지
files-kind-firmware = 펌웨어
files-kind-save = 저장 데이터
files-kind-archive = 압축 파일
files-kind-package = 패키지
files-kind-executable = 프로그램
files-kind-document = 문서
files-kind-font = 글꼴
files-kind-theme = 테마
files-kind-plugin = 플러그인
files-kind-unknown = 알 수 없는 파일
files-detected = { $format }({ $platform }), { $by }에서 감지

## Transfers (downloads and uploads)

transfer-title = 전송
transfer-queued = 대기 중
transfer-running = { $percent }, { $rate }
transfer-paused = { $percent }에서 일시 정지됨
transfer-done = 완료
transfer-failed = 실패: { $error }
transfer-verifying = { $algorithm } 확인 중
transfer-mirror = 출처: { $host }
transfer-lancache = LAN 캐시 경유
transfer-pause = 일시 정지
transfer-resume = 재개
transfer-remaining = { $done } / { $total }
transfer-limit = 제한 { $rate }
transfer-unlimited = 제한 없음

## Built-in plugins

plugin-bun-engine-free-roms = 무료 ROM 팩
