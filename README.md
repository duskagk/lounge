# >_ Lounge

> Terminal session manager with SSH, local shells, and AI agent integration.

Lounge는 단순한 터미널 에뮬레이터가 아닙니다.  
SSH 서버, 로컬 셸, AI 에이전트를 하나의 공간에서 관리하는 **터미널 세션 매니저**입니다.

공항 라운지처럼 — 에이전트들이 대기하고, 연결이 준비되며, 작업이 시작되는 곳.

<br />

## Features

### 세션 관리
- **프로필 저장** — SSH 서버 및 로컬 터미널을 이름과 함께 저장
- **자동 연결** — 앱 시작 시 지정한 세션을 자동으로 열기
- **멀티탭** — 여러 세션을 탭으로 동시에 관리
- **영구 저장** — SQLite 기반으로 재시작해도 프로필 유지

### SSH
- 비밀번호 / 개인 키 / 키 파일 경로 인증 지원
- `keyboard-interactive` 인증 자동 처리 (Ubuntu 등)
- 연결 프로필 저장 및 즉시 연결

### 로컬 터미널
- 시작 디렉토리 지정 (프로젝트별 터미널 저장)
- 폴더 탐색 다이얼로그

### 편의 기능
- `Ctrl+C` — 텍스트 선택 시 복사, 없으면 SIGINT
- `Ctrl+V` / 우클릭 — 붙여넣기
- 장시간 작업 완료 시 데스크탑 알림
- 한글 IME 지원

<br />

## Stack

| | |
|---|---|
| Shell | Electron |
| UI | React + Vite |
| Terminal | xterm.js |
| SSH | ssh2 |
| PTY | node-pty |
| DB | better-sqlite3 |

<br />

## Getting Started

```bash
# 의존성 설치
npm install

# 개발 모드 실행
npm run dev

# 빌드
npm run dist
```

> **Windows 환경 권장** — node-pty의 ConPTY를 활용합니다.

<br />

## Roadmap

- [ ] 커맨드 히스토리 북마크 / 매크로
- [ ] AI / MCP 에이전트 연동
- [ ] VSCode / IntelliJ 익스텐션
- [ ] 터미널 출력 렌더링 (Mermaid 다이어그램 등)
- [ ] 원격 접속 지원

<br />

## License

MIT © [duskagk](https://github.com/duskagk)
