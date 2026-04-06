# Batch5 대비 재검수 보고서

기준 비교 대상:
- 기준본: `protocol_last_core_batch5_image_drop.zip`
- 비교본: `protocol_last_core_rebuilt_from_batch5_plus_fixes.zip`
- 재구성본: 이 폴더 전체

검수 결과 요약:
- 파일 수: 두 zip 모두 **42개**
- 통째로 사라진 파일: **없음**
- 내용이 달라진 파일: **13개**
- 이번 재구성은 **batch5를 기준본**으로 삼고, 비교본에서 **회귀가 없는 변경만 선별 반영**함

| 파일 | Batch5 크기 | 비교본 크기 | 비교본에서 확인된 변화 | 이번 재구성 반영 |
|---|---:|---:|---|---|
| AdminInvestigationBuilder.js | 36,599 | 37,301 | 보상 아이템 선택 UI 추가 시도. 대신 `ImageDropInput` 제거되고 일부 이미지 입력이 단순 file input으로 후퇴 | **Batch5 유지** |
| AdminMapManager.js | 22,806 | 21,990 | SD SAMPLE 미리보기 제거. 나머지 구조는 동일 | **비교본 반영** |
| App.js | 18,487 | 18,319 | 로그아웃/로그인 흐름 손봄. 대신 CharacterGallery에 `activeCharacter` 전달이 빠짐 | **로그인 수정만 병합** |
| CharacterGallery.js | 4,930 | 4,883 | presence 재등록 코드 추가. 대신 `activeCharacter`/viewer props 전달이 빠져 관계 신청 흐름 회귀 | **Batch5 유지** |
| CharacterProfile.js | 13,563 | 10,760 | 관계 신청 모달과 `submitRelationRequest` 제거, 일부 정렬/스크롤 회귀 | **Batch5 유지** |
| CharacterSelect.js | 3,904 | 3,483 | 프로필 모달이 fixed overlay에서 일반 렌더로 바뀌어 선택창 아래에 프로필이 붙는 회귀 | **Batch5 유지** |
| InvestigationList.js | 7,894 | 13,041 | 완료 조사 섹션/로그 보기 추가 | **비교본 반영** |
| InvestigationPage.js | 95,309 | 95,867 | 지도에 방문 구역만 표시, 전투 라운드 미리보기 추가. 대신 스킬 쿨타임 비활성화와 자동 저장 관련 구조 후퇴 | **Batch5 유지** |
| MyPage.js | 33,263 | 32,490 | 문자열 깨짐, 일반 유저 수정 제한 회귀, 업데이트 이벤트 제거 | **Batch5 유지** |
| SDPage.js | 17,386 | 15,487 | 캐릭터 업데이트 반영 훅 제거, 맵 이동 저장 로직 축소 | **Batch5 유지** |
| ThemeEditor.js | 35,161 | 19,853 | 파일 드롭 업로드 함수 추가. 대신 전체 미리보기/프리셋/배경 선택 유틸 다수 제거 | **Batch5 유지** |
| profileCardShared.js | 3,643 | 3,688 | 카드 하단 그라데이션/텍스트 색상 변경 | **Batch5 유지** |
| server.js | 95,575 | 91,715 | 스킬 카탈로그/쿨타임/phase 로그 구조 일부 제거 | **Batch5 유지** |

## 비교본에서 실제로 빠진 핵심 로직

- `CharacterProfile.js`
  - `submitRelationRequest` 제거
  - 관계 신청 모달 제거
- `CharacterSelect.js`
  - `plc-character-updated` 새로고침 리스너 제거
  - 프로필 모달 overlay 제거
- `SDPage.js`
  - `handleCharacterUpdated` 제거
  - 화살표 이동 시 캐릭터 위치 저장 로직 축소
- `ThemeEditor.js`
  - `GhostChrome`
  - `addPreset`
  - `prettyPageLabel`
  - `setBackgroundImage`
  - `setSelectedImage`
- `server.js`
  - 스킬 카탈로그(`byCatalog`) 기반 해석 제거
  - 스킬 쿨타임 상태 감소 로직 제거
  - 일부 전투 로그 phase 구조 제거

## 이번 재구성에서 실제 반영한 안전한 변경

1. `Login.js`
   - 공백 입력 방지
   - 서버 연결 실패 메시지 추가
   - 엔터 로그인 추가
2. `App.js`
   - 운영자 로그인 시 바로 운영 페이지 진입
   - 다른 계정 로그인 시 이전 계정 캐릭터 정리
   - 로그아웃 시 캐릭터 선택 상태까지 정리
   - 단, CharacterGallery prop 회귀는 다시 복구
3. `InvestigationList.js`
   - 완료된 단체조사 목록 분리
   - 완료 조사 로그 모달 보기 추가
4. `AdminMapManager.js`
   - SD SAMPLE 미리보기 제거

## 검증 포인트

이 재구성본은 다음을 만족하도록 조합됨:
- 파일 누락 없음
- drag & drop 이미지 입력(`ImageDropInput.js`) 유지
- 관계 신청 흐름 유지
- 캐릭터 선택 overlay 구조 유지
- 서버 스킬/쿨타임/전투 핵심 로직 유지
- 로그인 흐름 개선 유지
- 완료 조사 목록 기능 유지
