$ErrorActionPreference = "Stop"

$C1 = git rev-parse HEAD~1
$C2 = git rev-parse HEAD

git checkout $C1
$msg1 = @"
데이터 변조 차단 패치

- 로컬 스토리지 데이터 암호화
  - crypto-js 라이브러리를 이용한 AES 암호화 진행
- 무결성 검증용 해시 도입
  - 데이터의 내용과 클라이언트 내부에 숨겨둔 비밀 키를 조합하여 해시값을 생성하고, 내용 재계산 실패 시 데이터를 모두 초기화 함.
- 서버사이드 필터링 적용
  - DB상에서 불가능한 값이 입력되었을 경우 입력 차단 로직 구현
"@
git commit --amend -m $msg1
git tag -f v.0.7.0

git cherry-pick $C2
$msg2 = @"
게스트 계정 도전과제 UI 비활성화

- 백업 코드가 없는 계정에게 도전과제 기능을 비활성화 함
"@
git commit --amend -m $msg2
git tag -f v.0.7.1

git branch -f main HEAD
git checkout main
