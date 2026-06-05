# 🎯 Daily Arrow (데일리 애로우)

매일 자정마다 갱신되는 50개의 무작위 방향키를 가장 빠르게 입력하여 전 세계 사람들과 겨루는 반응속도 웹 미니게임입니다.

## 🚀 주요 기능 (Features)

- **일일 고정 패턴 (Daily Seed)**: 매일 자정을 기준으로 시드가 변경되어, 하루 동안은 모든 유저에게 완벽하게 동일한 패턴의 50개 방향키가 주어집니다.
- **글로벌 리더보드 (Global Leaderboard)**: Firebase Cloud Firestore를 활용하여 전 세계 플레이어들의 최고 기록을 실시간으로 랭킹표에 보여줍니다.
- **무로그인 시스템 (Anonymous Auth)**: 기기 고유 식별자(UUID)를 활용하여 번거로운 회원가입 및 로그인 과정 없이 닉네임만으로 랭킹 등록이 가능합니다.
- **아름다운 UI/UX**: 글래스모피즘(Glassmorphism) 기반의 트렌디한 다크 테마, 매끄러운 타이핑 오답 진동 피드백, 클리어 시 축하 폭죽(Confetti) 이펙트가 적용되어 있습니다.

## 🛠️ 기술 스택 (Tech Stack)

- **Frontend**: React.js, Vite
- **Styling**: Vanilla CSS (다크 모드, 반응형 레이아웃)
- **Database (BaaS)**: Firebase Cloud Firestore
- **Icons & Effects**: `lucide-react`, `canvas-confetti`

## ⚙️ 로컬 실행 방법 (Running Locally)

1. 저장소(Repository) 클론
```bash
git clone https://github.com/본인아이디/저장소이름.git
```
2. 패키지 의존성 설치
```bash
npm install
```
3. 개발 서버 실행
```bash
npm run dev
```

## 📝 라이선스
MIT License
