# Protocol LAST CORE 영구 저장 / 배포 가이드

## 1. 지금 구조에서 실제로 저장되는 기준 위치

서버는 `DATA_DIR` 환경변수를 우선 사용합니다.

- Render 배포 권장값: `/var/data`
- 로컬 개발 권장값: 프로젝트 바깥의 별도 폴더
  - 예: `../protocol-last-core-data`

`DATA_DIR`를 지정하지 않으면 서버는 기본적으로 프로젝트 바깥의 `../protocol-last-core-data` 폴더를 사용하도록 되어 있습니다.

---

## 2. 저장되는 주요 파일

아래 파일들은 전부 `DATA_DIR` 아래에 저장됩니다.

- `users.json` : 유저 계정
- `characters.json` : 캐릭터, 스탯, 코인, 아이템, 일일 횟수 등
- `investigations.json` : 조사 진행 상태, 참가자, 리더, 현재 위치, 공유 로그 등
- `customInvestigations.json` : 운영이 만든 커스텀 조사 템플릿
- `designConfig.json` : 홈페이지 디자인 설정
- `shopItems.json` : 상점 아이템
- `shopConfig.json` : 상점 설정
- `relations.json` : 관계 데이터
- `relationRequests.json` : 관계 신청 데이터
- `mails.json` : 우편 데이터
- `roomChats.json` : 조사 채팅 로그

조사 이미지/커스텀 업로드 파일도 서버 런타임 데이터 경로 아래 자산 폴더에 같이 보관되는 구조를 기준으로 사용합니다.

---

## 3. 수정해도 남는 것 / 안 남는 것

### 남는 것

- 유저 계정
- 유저 캐릭터 전체 정보
- 일일 조사 횟수
- 조사 진행 상태
- 운영이 수정한 디자인/상점/조사 설정
- 조사 채팅 로그
- 우편 / 관계 / 커스텀 조사

### 재시작 시 다시 계산되는 것

- 현재 접속 중 표시
- 소켓 연결 상태
- 일시적인 메모리 정보

즉, **데이터 자체는 남고**, 접속 중/실시간 연결 같은 상태만 다시 잡히는 구조입니다.

---

## 4. Render 배포 체크리스트

### render.yaml 기준

현재 배포 설정은 아래 조건을 만족해야 합니다.

- 서비스 타입: `web`
- 런타임: `node`
- `DATA_DIR=/var/data`
- 디스크 마운트 경로: `/var/data`
- 헬스체크 경로: `/health`

### Render 대시보드에서 꼭 확인할 것

1. 서비스가 **Free가 아닌 유료 Web Service**인지 확인
2. **Persistent Disk**가 붙어 있는지 확인
3. 디스크의 **mount path가 `/var/data`인지 확인**
4. 환경변수 `DATA_DIR` 값이 **반드시 `/var/data`인지 확인**
5. `CLIENT_URL`에 실제 홈페이지 주소를 넣었는지 확인
6. 서비스를 새로 만들어 갈아끼우지 말고, **같은 서비스 + 같은 디스크를 유지**하면서 배포할 것

---

## 5. 수정/배포할 때 안전한 방법

### 안전한 방식

- 기존 Render 서비스 유지
- 기존 Persistent Disk 유지
- Git 푸시 → 같은 서비스 재배포
- `DATA_DIR`와 디스크 mount path 그대로 유지

### 위험한 방식

- Free 서비스로 새로 만들기
- 디스크 없이 다시 만들기
- `DATA_DIR`를 다른 경로로 바꾸기
- 기존 서비스를 지우고 새 서비스로 교체하기
- 디스크 mount path를 바꾸기

이렇게 하면 기존 데이터가 안 보이거나 사실상 새 데이터처럼 시작될 수 있습니다.

---

## 6. 로컬 개발할 때 권장

로컬에서는 `.env` 또는 실행 환경에 아래처럼 두는 걸 권장합니다.

```env
PORT=3001
CLIENT_URL=http://localhost:3000
DATA_DIR=../protocol-last-core-data
```

이렇게 하면 프로젝트 폴더를 덮어써도 데이터 폴더가 바깥에 남아서 비교적 안전합니다.

---

## 7. 가장 중요한 한 줄

**코드는 바뀌어도 괜찮지만, `DATA_DIR`와 Render Persistent Disk는 절대 끊기면 안 됩니다.**
