# PROTOCOL LAST CORE Render 배포 가이드

이 버전은 **Render 웹서비스 1개로 바로 배포하기 쉽게** 정리한 버전이야.
프론트 React를 `client/build`로 빌드하고, `server.js`가 그 정적 파일을 같이 서빙해.

## 이번 배포용 수정
- `localhost:3001` 고정 호출이 배포 환경에서 현재 사이트 주소를 따라가게 보정
- `server.js`가 `0.0.0.0` / `PORT` 환경변수로 실행되게 보정
- `/health` 헬스체크 라우트 추가
- `DATA_DIR` 환경변수로 JSON 데이터를 영구 디스크에 저장할 수 있게 정리
- `render.yaml`을 **단일 Web Service + Persistent Disk** 구조로 정리

## Render에서 만드는 방식
### 1) GitHub에 업로드
이 폴더 전체를 GitHub 저장소에 올려.

### 2) Render에서 Blueprint 또는 Web Service 생성
가장 쉬운 방법은 저장소 루트의 `render.yaml`을 그대로 쓰는 거야.

#### Blueprint 방식
- Render → New → Blueprint
- GitHub 저장소 연결
- `render.yaml` 확인 후 생성

#### 수동 Web Service 방식
- Render → New → Web Service
- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Health Check Path: `/health`
- Environment Variables:
  - `NODE_ENV=production`
  - `DATA_DIR=/var/data`
  - `CLIENT_URL=https://너의서비스주소.onrender.com`
- Persistent Disk:
  - Mount Path: `/var/data`
  - Size: 10GB 이상

## 왜 Persistent Disk가 필요한가
지금 프로젝트는 `users.json`, `characters.json`, `designConfig.json` 같은 파일에 데이터를 저장해.
Render 기본 파일시스템은 재배포/재시작 때 사라질 수 있어서, **반드시 `/var/data` 같은 디스크 경로**를 써야 데이터가 유지돼.

## 로컬 실행
### 서버 + 프론트 빌드 실행
```bash
npm install
npm run build
npm start
```

### 프론트 개발 모드만 따로 실행
```bash
cd client
npm install
npm start
```
이 경우 서버는 루트에서 별도로 실행:
```bash
npm install
npm start
```

## 배포 후 확인할 것
- `https://너의서비스주소.onrender.com/health` 가 `{ ok: true }` 형태로 열리는지
- 로그인/캐릭터/조사/상점이 정상으로 뜨는지
- 디자인 수정/캐릭터 생성 후 재배포해도 데이터가 남는지

## 나중에 더 안정적으로 바꾸려면
지금 구조로도 바로 공개는 가능하지만, 사람이 많아지면 JSON 파일 저장 대신 DB로 옮기는 게 좋아.
일단은 이 버전으로 Render에 올려서 운영 시작하기엔 충분하게 정리해둔 상태야.
