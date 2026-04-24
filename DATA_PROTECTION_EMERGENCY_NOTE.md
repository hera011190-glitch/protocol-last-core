# 긴급 캐릭터 데이터 보호 패치

## 포함 파일
- server.js
- client/src/ShopPage.js
- client/src/SDPage.js

## 핵심
- updateCharacter가 빈 프로필/이미지/BGM으로 기존 값을 덮어쓰지 못하게 막았습니다.
- 캐릭터 찾기를 id뿐 아니라 ownerId + name 기준으로도 찾게 보강했습니다.
- 상점 구매/판매가 배포 환경에서 localhost를 보지 않도록 수정했습니다.
- SD 이미지 후보가 실패했을 때 깨진 이미지로 멈추지 않게 수정했습니다.

## 이미 사라진 데이터
이전에 적용한 data-protection-fix 이후라면 DATA_DIR/_backups 안에 characters.json 백업이 남아 있을 수 있습니다.
