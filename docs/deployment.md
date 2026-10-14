# 배포 안내서 — CTRL+AI 베타 (`ctrlai-server`)

이 문서는 **처음 서버를 다루는 사람**이 위에서부터 차례대로 따라 하도록
썼습니다. 명령은 모두 그대로 복사해 붙여 넣으면 됩니다. 모르는 말이 나오면
바로 옆에 짧게 설명을 달아 두었습니다.

> **💳 표시** — 돈이 드는 단계입니다. 💳가 붙은 단계는 무엇에 얼마가
> 드는지 읽고 나서 하세요.

> **이 문서가 하지 않는 것** — 클라우드 자원을 새로 만들거나 지우는 일은
> 여기 없습니다. VM, 고정 IP, 방화벽은 이미 만들어져 있습니다(아래 표).
> 무엇이든 새로 만들어야 할 것 같으면 먼저 멈추고 상의하세요.

---

## 0. 한눈에 보기

### 무엇이 어디서 도나요

```text
회원의 브라우저
   │  https://ctrlai.my
   ▼
ctrlai-server (Google Cloud, 서울)
   ├─ caddy   80/443 — HTTPS 인증서를 스스로 받고, www를 ctrlai.my로 돌려보냄
   ├─ web     Next.js — 화면, 그리고 /api/* 요청을 api로 넘김
   ├─ api     FastAPI — 서버의 .env를 읽음 (비밀 값은 여기에만)
   └─ db      PostgreSQL 16 — 바깥에서 접속할 수 없음
```

네 개는 모두 **Docker Compose** 하나(`docker-compose.prod.yml`)로 함께
켜고 끕니다. 프로그램(이미지)은 GitHub Actions가 만들어 ghcr.io(GitHub의
이미지 저장소)에 올리고, 서버는 **받아 오기만** 합니다.

### 서버 정보

| 항목 | 값 |
| --- | --- |
| 이름 | `ctrlai-server` |
| 지역 / 영역 | `asia-northeast3` (서울) / `asia-northeast3-c` |
| 기종 | e2-medium — vCPU 2개, 메모리 4 GB (**유료**, 한 달 약 US$32) |
| 운영체제 | Debian 13 (trixie), x86_64 |
| 디스크 | 표준 영구 디스크 30 GB (10 GB에서 늘리는 중) |
| 고정 외부 IP | `34.47.78.228` |
| 방화벽 | HTTP(80), HTTPS(443) 허용 + 기본 SSH 규칙만 |
| 도메인 | `ctrlai.my` (`www.ctrlai.my`는 `ctrlai.my`로 이동) |
| 이미 해 둔 것 | `apt upgrade`, git, Docker Engine + Compose 플러그인, 사용자 `ctrlai_platform`의 docker 그룹 등록, 2 GB 스왑 |

### 꼭 기억할 날짜

| 날짜 | 할 일 |
| --- | --- |
| **2026-10-13 (오늘)** | Google Cloud 무료 체험 시작(₩407,626 크레딧). **예산 알림 설정** — 1단계 |
| **2027-01-04까지** | 💳 **결제 계정을 유료로 업그레이드** — 10단계. 체험은 2027-01-11쯤 끝나고, 업그레이드하지 않으면 VM이 멈춥니다 |

### 절대 하지 말 것

- **내 PC의 데이터베이스를 서버로 복사하지 마세요.** 개발용 계정(`dev` /
  `devpassword`)과 시험 데이터가 그대로 공개 사이트에 올라갑니다. 서버의
  데이터베이스는 **빈 상태에서 시작**하고, 관리자 계정 하나만 만듭니다(4단계).
  복사해 온 데이터베이스에는 `bootstrap` 명령이 아무것도 만들지 않고
  멈춥니다.
- **`.env`를 커밋하거나 다른 곳에 붙여 넣지 마세요.** 채팅, 메일, 이슈,
  스크린샷 모두 안 됩니다. 실수로 그랬다면 그 안의 키와 비밀번호는 모두
  바꿔야 합니다.
- **방화벽에 80, 443 말고 다른 포트를 열지 마세요.** 데이터베이스는 바깥에서
  닿지 않아야 합니다.

### 이 문서에서 쓰는 줄임말

서버에서 명령을 짧게 쓰려고 `dc`라는 줄임말을 만듭니다(3-5단계). 그 뒤로
나오는 `dc ...`는 모두 `docker compose -f docker-compose.prod.yml ...`과
같은 뜻입니다.

---

## 1. 첫날: Google Cloud 예산 알림 설정

예산 알림은 **돈을 막지는 않고 알려 주기만** 합니다. 그래도 첫날 해 두면
"생각보다 많이 나가고 있다"를 메일로 바로 압니다. 알림 설정 자체는 무료입니다.

1. https://console.cloud.google.com 에 로그인합니다.
2. 왼쪽 위 메뉴(☰) → **결제(Billing)** → **예산 및 알림(Budgets & alerts)**
   → **예산 만들기(Create budget)**.
3. 이름: `ctrlai-monthly`. 범위(Scope): 모든 프로젝트, 모든 서비스.
4. **크레딧(Credits) 체크를 해제합니다.** 체크해 두면 체험 크레딧이 비용을
   0으로 상쇄해서, 실제로 얼마를 쓰고 있는지 알림이 오지 않습니다.
5. 금액 유형: 지정 금액, **₩60,000** (한 달 예상 비용보다 조금 위).
6. 알림 기준: 50%, 90%, 100%. 받는 사람: 결제 관리자 이메일.
7. **완료**.

---

## 2. DNS 레코드 추가 (도메인 관리 화면에서)

`ctrlai.my`가 서버 IP를 가리키게 합니다. 정확한 레코드와 확인 방법은
[`dns-for-domain-owner.md`](dns-for-domain-owner.md)에 있습니다. 요약:

| 이름(호스트) | 종류 | 값 |
| --- | --- | --- |
| `@` | A | `34.47.78.228` |
| `www` | CNAME | `ctrlai.my` |
| `apps` | A | `34.47.78.228` |

`apps`는 회원이 만든 앱이 도는 주소(`apps.ctrlai.my`, builder-static-runtime)
입니다. 이 레코드가 아직 없으면 Caddy가 그 인증서만 받지 못하고 계속 다시
시도할 뿐, `ctrlai.my`는 그대로 돌아갑니다.

전 세계에 퍼지는 데 몇 분에서 몇 시간이 걸리므로 **가장 먼저** 해 두세요.
`api` 레코드는 만들지 않습니다 — 브라우저는 `ctrlai.my` 하나하고만 이야기합니다.

내 PC(PowerShell)에서 확인:

```powershell
nslookup ctrlai.my 8.8.8.8
nslookup www.ctrlai.my 8.8.8.8
nslookup apps.ctrlai.my 8.8.8.8
```

세 결과 모두 `34.47.78.228`이 보이면 됩니다.

---

## 3. 서버 처음 설정

### 3-1. 서버에 접속하기 (SSH)

Google Cloud 콘솔 → **Compute Engine** → **VM 인스턴스** → `ctrlai-server`
줄의 **SSH** 버튼. 검은 창(터미널)이 브라우저에 열립니다. 이 문서의 서버
명령은 모두 이 창에 붙여 넣습니다.

내가 누구인지 확인:

```bash
whoami          # ctrlai_platform
docker ps       # 오류 없이 빈 표가 나오면 docker 그룹이 적용된 것
```

`docker ps`가 `permission denied`를 내면 창을 닫고 SSH를 다시 여세요(그룹은
새로 로그인해야 적용됩니다). `docker: command not found`면 Docker가 아직 설치되지
않은 것입니다 — 2026-10-13 첫 배포 때 실제로 그랬고, Docker 공식 apt 저장소에서
설치했습니다.

**내 PC에서 `gcloud.cmd compute ssh`로 들어가면** 사용자 이름이 Windows 이름
(`user`)이 됩니다. 그 사용자는 앱 폴더를 읽을 수 없으니, 들어간 뒤
`sudo -iu ctrlai_platform`으로 바꿔서 명령을 실행합니다.

### 3-2. 디스크가 30 GB인지 확인 💳

디스크를 10 GB에서 30 GB로 늘렸다면(표준 디스크 30 GB는 서울에서 한 달
약 US$1.5), 서버 안에서도 늘어났는지 봅니다.

```bash
df -h /
```

`Size`가 `30G` 근처면 끝입니다. 아직 `10G`라면 먼저 콘솔(Compute Engine ›
디스크 › `ctrlai-server`)에서 크기가 정말 30 GB로 **저장**되었는지 봅니다.
`lsblk`의 `sda` 줄이 `30G`인데 `df`만 `10G`라면 파티션과 파일 시스템을 늘립니다
(데이터는 그대로입니다):

```bash
sudo growpart /dev/sda 1
sudo resize2fs /dev/sda1
df -h /
```

### 3-3. 저장소 받기

```bash
cd ~
git clone https://github.com/anoukkim/ctrl-ai-platform.git
cd ~/ctrl-ai-platform
```

이 폴더(`~/ctrl-ai-platform`)에서 앞으로 모든 명령을 실행합니다.

### 3-4. `.env` 만들기 (비밀 값은 여기에만)

```bash
cd ~/ctrl-ai-platform
cp .env.example .env
chmod 600 .env
ls -l .env      # -rw------- 1 ctrlai_platform ... 이어야 합니다
```

`chmod 600`은 "나만 읽고 쓸 수 있게"라는 뜻입니다. 베타 동안 비밀 값을 이
파일에 두는 것은 **조건부 예외**입니다(`CLAUDE.md` 8절, 예전 17절): 600 권한, 커밋 금지,
이미지에 넣지 않기, Anthropic 월 한도 설정, 베타 뒤 모든 키 교체.

먼저 무작위 비밀번호 두 개를 만듭니다. 나온 값을 바로 아래 편집에 씁니다:

```bash
openssl rand -hex 24     # 데이터베이스 비밀번호로
openssl rand -hex 12     # 관리자 비밀번호로 (또는 직접 정한 12자 이상 문장)
```

파일을 엽니다:

```bash
nano .env
```

`[SERVER]` 표시가 붙은 줄을 아래처럼 바꿉니다. (nano: 화살표로 이동, 고친 뒤
`Ctrl+O` → `Enter`로 저장, `Ctrl+X`로 나가기.)

| 줄 | 바꿀 값 | 왜 |
| --- | --- | --- |
| `APP_ENV=` | `beta` | 베타 배너, 개발 도구 끄기. `development`로 두면 서버가 켜지지 않습니다. (개인 충전은 어느 환경에서나 기본으로 꺼져 있습니다 — `PERSONAL_TOPUP_ENABLED`, personal-topup-off) |
| `POSTGRES_PASSWORD=` | 위에서 만든 48자리 값 | 데이터베이스 비밀번호. 영문·숫자만(주소 안에 들어갑니다). `ctrlai`면 서버가 켜지지 않습니다 |
| `SITE_DOMAIN=` | `ctrlai.my` | Caddy가 인증서를 받을 주소 |
| `CORS_ALLOW_ORIGINS=` | `https://ctrlai.my` | 브라우저가 부를 수 있는 출처 |
| `ADMIN_USERNAME=` | 관리자 아이디 (영문·숫자·`_`, 3자 이상) | 4단계에서 한 번 쓰입니다 |
| `ADMIN_EMAIL=` | 관리자 이메일 | 〃 |
| `ADMIN_PASSWORD=` | 위에서 만든 값 (12자 이상) | 〃. `change-me-before-deploying`, `admin`, `password` 등은 거절됩니다 |

그대로 두는 줄: `CLAUDE_PROVIDER=mock`(진짜 Claude는 7단계에서),
`IMAGE_PREFIX`, `IMAGE_TAG=latest`, 크기 설정(`WEB_CONCURRENCY=2`,
`DB_POOL_SIZE=5`, `DB_MAX_OVERFLOW=5`, `PG_SHARED_BUFFERS=256MB`,
`PG_MAX_CONNECTIONS=50`, `MAX_UPLOAD_MB=20` — e2-medium과 회원 약 40명에 맞춘
값), `SESSION_COOKIE_DOMAIN=`(비워 둠), `DATA_LOCATION_NOTICE`(회원가입
화면의 "서울 리전에 저장됩니다" 문구 — 바꾸려면 이 줄만 고칩니다).

무시되는 줄: `DATABASE_URL`, `BACKEND_ORIGIN`, `SESSION_COOKIE_SECURE`는
서버에서 `docker-compose.prod.yml`이 정합니다. 고치지 않아도 됩니다.

### 3-5. 줄임말 `dc` 만들기

```bash
echo "alias dc='docker compose -f docker-compose.prod.yml'" >> ~/.bashrc
source ~/.bashrc
```

### 3-6. ghcr.io 로그인 (이미지를 받아 오는 열쇠)

> **지금은 건너뜁니다.** 저장소가 공개라서 이미지도 공개로 올라갔고, 서버는
> 로그인 없이 받아 옵니다(2026-10-13 확인). 이미지에는 공개 저장소의 코드만
> 있고 `.env`는 들어 있지 않습니다. 나중에 GitHub › Packages에서 이미지를
> 비공개로 바꾸면 그때 아래처럼 토큰을 만들어 로그인합니다.

이미지가 비공개라면 서버가 받아 오려면 **읽기 전용 토큰**이 필요합니다. (이
토큰은 서버가 이미지를 받는 데만 씁니다. 회원에게 토큰을 받는 일은 여전히
없습니다.)

**토큰 만들기 — 내 PC의 브라우저에서:**

1. GitHub 로그인 → 오른쪽 위 프로필 사진 → **Settings**.
2. 왼쪽 맨 아래 **Developer settings** → **Personal access tokens** →
   **Tokens (classic)** → **Generate new token** → **Generate new token (classic)**.
3. Note: `ctrlai-server pull`. Expiration: **90 days** (만료되면 같은 방법으로
   새로 만들어 다시 로그인합니다).
4. 권한(scopes)은 **`read:packages` 하나만** 체크합니다. 다른 것은 체크하지
   마세요.
5. **Generate token** → 나온 `ghp_...` 값을 복사합니다. 이 화면을 벗어나면
   다시 볼 수 없습니다. 어디에도 저장하지 말고 바로 다음 명령에 붙여 넣으세요.

**서버에서 로그인:**

```bash
docker login ghcr.io -u anoukkim
# Password: 에 토큰을 붙여 넣고 Enter (화면에 보이지 않는 것이 정상)
# Login Succeeded 가 나오면 됩니다
```

> **이미지가 아직 없다면** — 이미지는 이 작업(`feat-prep-beta-launch`)이
> `main`에 합쳐진 뒤 GitHub Actions가 처음 만듭니다. GitHub 저장소 →
> **Actions** → **images**가 초록 체크가 된 뒤에 다음 단계로 가세요.

### 3-7. 이미지 받고 데이터베이스 켜기

```bash
cd ~/ctrl-ai-platform
dc pull                 # 네 개의 이미지를 받습니다 (처음엔 몇 분)
dc up -d db             # 데이터베이스만 먼저 켭니다
dc ps                   # db 가 (healthy) 가 될 때까지 몇 초 기다립니다
```

### 3-8. 데이터베이스 표 만들기 (마이그레이션)

```bash
dc run --rm api alembic upgrade head
```

`Running upgrade ... -> ...` 줄이 여러 개 나오고 오류 없이 끝나면 됩니다.
이 명령은 **빈 데이터베이스에 표만** 만듭니다. 회원, 프로젝트, 사용 기록은
하나도 없습니다.

---

## 4. 관리자 계정 만들기

```bash
dc run --rm api python -m app.db.bootstrap
```

`.env`의 `ADMIN_*`로 **관리자 한 명**과 영상 모델 목록(Admin › Video Models가
고치는 목록)을 만들고, 그 밖에는 아무것도 만들지 않습니다. 두 번 실행해도
안전합니다 — 이미 있는 계정은 비밀번호까지 그대로 둡니다.

끝나면 `.env`에서 `ADMIN_PASSWORD=` 뒤의 값을 지워도 됩니다(데이터베이스에는
해시만 남습니다). 지우는 것을 권합니다:

```bash
nano .env      # ADMIN_PASSWORD= 뒤를 비우고 저장
```

이제 전체를 켭니다:

```bash
dc up -d
dc ps          # 네 개 모두 Up, api 와 db 는 (healthy)
```

`api`가 계속 다시 시작된다면 `dc logs api | tail -20`을 보세요. `Refusing to
start:` 뒤에 이유가 영어로 적혀 있습니다(12단계 표).

---

## 5. HTTPS 확인

Caddy는 DNS가 서버를 가리키는 것을 확인하면 Let's Encrypt에서 인증서를
**저절로** 받고, 만료 전에 저절로 갱신합니다. 설치하거나 갱신할 것은 없습니다.

```bash
dc logs caddy | grep -i "certificate obtained"
```

`certificate obtained successfully` 가 `ctrlai.my`와 `www.ctrlai.my` 두 번
보이면 됩니다. 내 PC(PowerShell)에서도 확인:

```powershell
curl.exe -I https://ctrlai.my          # HTTP/1.1 200 또는 HTTP/2 200
curl.exe -I http://ctrlai.my           # 308 → https://ctrlai.my/
curl.exe -I https://www.ctrlai.my      # 301 → https://ctrlai.my/
```

브라우저로 https://ctrlai.my 를 열면: 주소창에 자물쇠, 맨 위에 노란 **베타**
배너, 로그인 화면. 4단계의 관리자로 로그인해 봅니다.

**인증서가 안 나올 때:** 거의 언제나 DNS가 아직 퍼지지 않은 것입니다
(2단계의 `nslookup` 확인). Caddy는 스스로 다시 시도하니 **`dc restart`를
반복하지 마세요** — Let's Encrypt는 짧은 시간에 실패가 많으면 한 시간 동안
막습니다. 10~20분 기다린 뒤 다시 `dc logs caddy`를 봅니다.

### 회원에게 주소를 알리기 전에

- **가입에는 초대 코드가 필요합니다.** 관리자로 로그인해 Admin › Members 아래의
  **초대 코드**에서 코드를 만듭니다(자동 생성 또는 직접 정한 코드, 몇 명까지,
  언제까지). **가입 링크 복사**를 누르면 `https://ctrlai.my/signup?code=…`
  링크가 복사되니, 그 링크를 회원에게 보내면 됩니다. 코드가 새어 나가면
  **사용 중지** — 새 가입만 막히고 이미 가입한 계정은 그대로입니다.
- 관리자로 분기를 만들고(Admin › Quarters), 신청을 엽니다.
- Video Generator, Project Builder, CtrlAIApps, CtrlAITube에 "테스트 모드"
  표시가 보이는지 봅니다. 아직 목업이라는 뜻이고, 정상입니다.

---

## 6. 매일 도는 작업 (cron)

하루 한 번: **데이터베이스 백업**(서버에 최근 14개 보관), **그 백업을 서버
밖 버킷으로 복사**(8단계의 "백업을 서버 밖으로" — 버킷을 만들기 전에는 "아직
설정되지 않았습니다"라고만 적고 넘어갑니다), 그리고 탈퇴하고 30일이 지난
계정의 이름·이메일 지우기. 여러 번 돌거나 하루 빠져도 문제없게 만들어져
있습니다.

```bash
chmod +x ~/ctrl-ai-platform/deploy/*.sh
~/ctrl-ai-platform/deploy/daily-jobs.sh      # 한 번 손으로 돌려 봅니다
crontab -e
```

(처음이면 편집기를 고르라고 합니다 — `nano`를 고르세요.) 맨 아래에 이 한 줄을
붙이고 저장합니다:

```cron
15 19 * * * $HOME/ctrl-ai-platform/deploy/daily-jobs.sh >> $HOME/ctrlai-jobs.log 2>&1
```

서버 시계는 UTC입니다(`timedatectl`로 확인). 19:15 UTC는 **한국 시각 새벽
4:15**입니다. 다음 날 `tail ~/ctrlai-jobs.log`로 돌았는지 봅니다.

---

## 6-1. 모니터링 — 사이트가 멈추거나 오류가 나면 메일로 (monitoring)

두 가지를 Google Cloud Monitoring으로 겁니다. 알림은
**ctrlai.platform@gmail.com** 으로 옵니다.

| 무엇 | 어떻게 | 비용 |
| --- | --- | --- |
| **사이트가 살아 있는지** | 업타임 체크가 5분마다 `https://ctrlai.my/api/health`를 열어 데이터베이스까지 `ok`인지 봅니다 | 업타임 체크는 프로젝트당 월 100만 번까지 무료(5분마다면 월 약 5만 번) |
| **서버 오류** | 서버의 `deploy/error-watch.sh`가 5분마다 api·web 로그에서 오류를 세어, 있으면 Cloud Logging에 한 줄(`ctrlai-app-errors`)을 남기고, 알림 정책이 그 줄을 보면 메일을 보냅니다 | 로그는 월 50 GiB까지 무료(이 기록은 몇 KB). 💳 **알림 조건은 2026년 5월부터 조건 하나에 월 약 $0.10** — 두 개면 월 약 $0.20(300원 안팎) |

> 더 싼 방법은 없습니다: 메일을 보내는 무료 수단 중 이 서버에서 키 없이
> 쓸 수 있는 것이 Cloud Monitoring 하나입니다(VM이 이미 로그·모니터링 쓰기
> 권한을 갖고 있습니다). 알림 조건 요금이 싫으면 업타임 체크 하나만 남기고
> 오류 알림은 빼도 됩니다.

**1. 알림 받을 메일** (콘솔 › Monitoring › 알림(Alerting) › 알림 채널 수정
(Edit notification channels))

- **이메일 › 새로 추가**: `ctrlai.platform@gmail.com`, 표시 이름 `CTRL+AI 운영`.

**2. 업타임 체크** (Monitoring › 업타임 체크 › 업타임 체크 만들기)

1. 프로토콜 **HTTPS**, 리소스 유형 **URL**, 호스트 이름 `ctrlai.my`, 경로
   `/api/health`.
2. 확인 빈도 **5분**.
3. 응답 확인: **콘텐츠 일치(Content matching) 사용** → 응답 콘텐츠에
   `"database":{"status":"ok"` 가 **포함**.
4. 알림: **알림 정책 만들기**를 켜고, 알림 채널에 1번의 메일. 이름
   `CTRL+AI 사이트 다운`.
5. **테스트**를 눌러 성공인지 본 뒤 만들기.

**3. 오류 알림** (서버 쪽은 이미 들어 있습니다 — cron 한 줄과 콘솔 설정)

먼저 VM이 로그를 쓸 수 있게 **역할 하나**를 줍니다(2026-10-14에 확인: 권한
범위는 있지만 IAM 역할이 없어 `IAM_PERMISSION_DENIED`가 났습니다). 콘솔 ›
IAM 및 관리자 › IAM › **액세스 권한 부여**: 주 구성원
`1051698999469-compute@developer.gserviceaccount.com` (VM의 기본 서비스
계정), 역할 **로그 작성자(Logs Writer)** → 저장. 비용은 없습니다.

서버에서(`ctrlai_platform`으로):

```bash
crontab -e
```

맨 아래에 한 줄을 더 붙입니다(5분마다):

```cron
*/5 * * * * $HOME/ctrl-ai-platform/deploy/error-watch.sh >> $HOME/ctrlai-errors.log 2>&1
```

콘솔에서 (Logging › 로그 탐색기):

1. 쿼리에 아래를 붙여 넣고 **실행**:

   ```text
   logName="projects/<프로젝트ID>/logs/ctrlai-app-errors"
   ```

   (`<프로젝트ID>`는 콘솔 위쪽 프로젝트 선택에 보이는 ID.) 처음에는 결과가
   없어도 됩니다.
2. 서버에서 `~/ctrl-ai-platform/deploy/error-watch.sh --test` → 로그 탐색기에서
   다시 **실행**하면 "테스트: 오류 알림이…" 한 줄이 보입니다.
3. 그 화면에서 **작업(Actions) › 로그 알림 만들기(Create log alert)**:
   이름 `CTRL+AI 서버 오류`, 알림 사이 최소 시간 **30분**(같은 문제로 메일이
   쏟아지지 않게), 알림 채널은 1번의 메일 → 저장.
4. `error-watch.sh --test`를 한 번 더 돌려 **몇 분 안에 메일이 오는지** 확인합니다.

**메일이 오면:** 사이트 다운이면 `dc ps`와 12단계(문제가 생겼을 때). 오류
메일이면 그 시각 전후의 로그를 봅니다: `dc logs --since 30m api | tail -100`.
메일에는 오류의 첫 줄만 들어 있습니다(회원 정보가 담길 수 있는 전체 내용은
보내지 않습니다).

---

## 7. 진짜 Claude 켜기 💳

지금까지 Chat은 목업(가짜 답)입니다. 진짜 Claude로 바꾸면 **답 하나마다 돈이
듭니다**(기본 모델 Sonnet 5.5에서 답 하나에 약 20원). 회원에게는 동아리
지원금에서 차감되고, 실제 돈은 동아리의 Anthropic 선불 크레딧에서 나갑니다.

**Anthropic Console에서 (https://console.anthropic.com):**

1. 💳 **Settings › Billing**에서 작은 선불 크레딧(usage credits)을 삽니다 —
   가입 무료 크레딧이 있으면 그것, 없으면 **US$5–10**.
2. 같은 Billing 화면에서 **자동 충전(Auto-reload)이 꺼져 있는지** 확인합니다.
   켜 두면 잔액이 기준 아래로 떨어질 때마다 카드에서 저절로 다시 충전됩니다.
3. Billing 화면 아래쪽(화면에 따라 **Limits**)의 **Spend limits**에서 **월 사용
   한도**를 정합니다 — 예: US$20. 이것은 `.env` 예외의 조건이기도 합니다.
4. **API Keys** → **Create Key** → 이름 `ctrlai-beta` → 키(`sk-ant-...`)를
   복사합니다. 이 화면을 벗어나면 다시 볼 수 없습니다.

**서버에서:**

```bash
cd ~/ctrl-ai-platform
nano .env
#   CLAUDE_PROVIDER=anthropic
#   ANTHROPIC_API_KEY=sk-ant-... (방금 복사한 키)
dc up -d --force-recreate api
dc ps                                   # api 가 (healthy)
```

**확인:** 관리자로 로그인 → Admin › System → Claude **연결 확인**. 그다음
Chat에서 짧은 메시지 하나를 보내 답이 한 글자씩 나오는지, Usage에 사용 기록이
생기는지 봅니다. Chat 입력창 위의 "테스트 모드" 표시는 사라집니다.
(이것이 BACKLOG의 *Phase 2 point 10* 확인입니다 — 기본 모델과 Haiku 4.5로 한
번씩 보내 보세요.)

키를 잘못 넣으면 서버는 켜지지만 Chat이 한국어로 "API 키가 거부되었습니다"를
보여 주고, 아무것도 차감하지 않습니다.

### 진짜 Claude에서 서버 도구(웹 검색 등)는 돈이 듭니다

Chat의 서버 도구(웹 검색 · 페이지 읽기 · 코드 실행, chat-plus-tools)는
목업에서는 공짜 흉내지만, `CLAUDE_PROVIDER=anthropic`이 되는 순간 **실제
요금**이 됩니다:

- **웹 검색** — 검색 1회당 약 $0.01 (요금은 Admin › AI Models의 모델
  설정에서 바꿉니다) **더하기** 그 답장에 들어오는 검색 결과 토큰. 한
  답장의 검색 횟수는 Admin › System › 채팅 한도의 **웹 검색**(기본 5회,
  1–10)으로 정합니다. 도구는 기본 버전(`web_search_20250305`,
  `web_fetch_20250910`)을 씁니다 — 더 새 버전은 코드 실행 안에서
  검색해 결과를 JSON으로 다루는데, 그 과정이 회원에게 그대로
  드러났습니다(fix-real-web-search, 2026-10-14).
  회원 지갑에는 토큰 + 검색 요금이 한 번에 차감되고, Anthropic
  청구서에도 같은 구조로 나옵니다. token-guard의 1회 비용 한도는 검색
  요금과 결과 토큰의 최대치까지 미리 셈에 넣습니다.
- **페이지 읽기** — 따로 요금은 없지만 읽은 본문이 그 답장의 입력
  토큰이 됩니다 (기본 답장당 1회 × 10,000토큰 — Admin › System › 채팅
  한도에서 조절). 기본 1회 비용 한도 200원 안에 들어가므로(Sonnet 기준
  예약 약 35원) 그대로 쓸 수 있고, 관리자가 한도를 많이 낮추면 거절
  문구가 끄는 법을 안내합니다.
- **코드 실행** — Anthropic 서버에서 실행됩니다(우리 서버에서는 아무것도
  실행되지 않습니다). 조직의 무료 사용량(월 1,550 컨테이너-시간) 안에서
  돌아갑니다.

**끄는 법:** 도구는 **기본으로 꺼져** 있습니다 — 모델마다 Admin › AI
Models에서 관리자가 열고, 회원이 대화마다 또 켜야 돌아갑니다. 실제
요금이 걱정되면 Admin › AI Models에서 모든 모델의 도구를 꺼 두면 그걸로
끝입니다.

---

## 8. 백업과 복원

### 백업 — 업데이트 전마다 (update.sh가 자동으로 함)

```bash
cd ~/ctrl-ai-platform
./deploy/backup.sh
# 백업 완료: /home/ctrlai_platform/backups/ctrlai-20261013-101500.sql.gz (48K)
```

**백업은 서버 밖으로 꺼내야 백업입니다.** 디스크가 망가지거나 VM이 지워지면
같은 디스크의 백업도 함께 사라집니다. 둘 중 하나로 내 PC에 받아 둡니다:

- **브라우저 SSH 창에서:** 창 오른쪽 위 **파일 다운로드(DOWNLOAD FILE)** →
  경로에 `/home/ctrlai_platform/backups/ctrlai-...sql.gz` (위에 나온 그대로) →
  다운로드.
- **내 PC에 gcloud가 있다면 (PowerShell):**

  ```powershell
  gcloud compute scp ctrlai-server:~/backups/ctrlai-20261013-101500.sql.gz . --zone asia-northeast3-c
  ```

백업 파일에는 회원 정보가 들어 있습니다. 내 PC에서도 아무 데나 두지 말고,
저장소 폴더 안에는 절대 두지 마세요(`.gitignore`가 막아 두긴 했습니다).

서버의 백업은 매일 밤 작업(6단계)이 **최근 14개만** 남기고 지웁니다.

### 백업을 서버 밖으로 — Cloud Storage 버킷 (offsite-backups) 💳

매일 밤의 백업이 서울 리전의 버킷에도 복사되고, 버킷은 **30일이 지난 사본을
저절로 지웁니다.** VM이 통째로 사라져도 최근 30일 중 어느 날로든 돌아갈 수
있습니다. 비용: 백업 하나가 수십 KB라 30일치가 수 MB — 한 달 **몇 원** 수준
(Standard 저장 GB당 약 $0.023). 아래는 **주인(owner)이 하는 일**입니다 — 이
저장소의 코드는 버킷을 만들지 않습니다.

**1. 버킷 만들기** (Google Cloud 콘솔 › Cloud Storage › 버킷 › 만들기)

1. 이름: 전 세계에서 하나뿐이어야 합니다. 예: `ctrlai-backups-` 뒤에 아무
   숫자 몇 개(예: `ctrlai-backups-7381`).
2. 위치 유형 **Region**, 위치 **asia-northeast3 (서울)**.
3. 스토리지 클래스 **Standard**.
4. 액세스 제어 **균일(Uniform)**, **공개 액세스 방지 사용(Enforce public
   access prevention)** 체크.
5. 데이터 보호: 소프트 삭제는 기본값 그대로 둬도 됩니다(7일). 객체 버전 관리는
   끕니다.
6. 만들기.

**2. 30일 수명 규칙** (만든 버킷 › 수명 주기(Lifecycle) › 규칙 추가)

- 작업: **객체 삭제(Delete object)**, 조건: **기간(Age) 30일** → 만들기.

**3. 백업만 하는 서비스 계정** (IAM 및 관리자 › 서비스 계정 › 만들기)

1. 이름 `ctrlai-backup`. 프로젝트 전체 역할은 **주지 않습니다**(그냥 완료).
2. 버킷으로 돌아가 › 권한(Permissions) › 액세스 권한 부여: 주 구성원에
   `ctrlai-backup@<프로젝트ID>.iam.gserviceaccount.com`, 역할
   **Storage 객체 생성자(Storage Object Creator)** 와 **Storage 객체
   뷰어(Storage Object Viewer)** 두 개 → 저장. (만들기와 읽기만 됩니다 — 이
   키로는 백업을 지우거나 덮어쓸 수 없습니다.)
3. 서비스 계정 › `ctrlai-backup` › 키 › 키 추가 › 새 키 › **JSON** → 내 PC에
   파일이 받아집니다. **이 파일은 비밀번호와 같습니다** — 저장소에 넣지 말고,
   서버에 올린 뒤 내 PC의 사본은 지웁니다.

> VM 자신의 계정은 쓰지 않습니다: 지금 VM의 Cloud Storage 권한 범위가
> **읽기 전용**이라 쓰려면 VM을 멈추고 범위를 바꿔야 합니다. 키 하나가
> 더 간단하고, 그 키는 이 버킷 하나에만 쓸 수 있습니다.

**4. 서버에 놓기** (브라우저 SSH 창 › 파일 업로드로 키를 올린 뒤)

```bash
sudo mkdir -p /home/ctrlai_platform/.config
sudo mv ~/<받은키>.json /home/ctrlai_platform/.config/ctrlai-backup-key.json
sudo chown -R ctrlai_platform: /home/ctrlai_platform/.config
sudo chmod 600 /home/ctrlai_platform/.config/ctrlai-backup-key.json
sudo -iu ctrlai_platform
cat > ~/.ctrlai-offsite <<'EOF'
BACKUP_BUCKET=ctrlai-backups-7381
BACKUP_KEY_FILE=/home/ctrlai_platform/.config/ctrlai-backup-key.json
EOF
chmod 600 ~/.ctrlai-offsite
~/ctrl-ai-platform/deploy/offsite-backup.sh
# 서버 밖 백업 완료: gs://ctrlai-backups-7381/db/ctrlai-....sql.gz (... bytes)
```

(`BACKUP_BUCKET`에는 1단계에서 지은 이름을 `gs://` 없이 적습니다.) 그다음부터는
매일 밤 작업이 알아서 올립니다. `tail ~/ctrlai-jobs.log`에 `서버 밖 백업
완료`가 보이면 됩니다. 키를 바꾸거나 없앨 때는 서비스 계정에서 키를 삭제하고
위 4단계를 다시 합니다(베타가 끝나 Secret Manager로 옮길 때도 교체).

### 복원 시험 — 한 달에 한 번

백업은 **복원해 봐야** 백업입니다. 매달 첫 주에 한 번, 진짜 데이터베이스는
건드리지 않는 시험용 컨테이너에 복원해 봅니다:

```bash
cd ~/ctrl-ai-platform
./deploy/restore-test.sh bucket     # 버킷의 가장 최근 사본으로 (버킷을 만든 뒤)
./deploy/restore-test.sh            # 또는 서버에 있는 가장 최근 백업으로
```

시험용 PostgreSQL 컨테이너를 잠깐 띄워(포트도 볼륨도 없음) 복원하고, 회원 ·
사용 기록 · 프로젝트 수를 지금 데이터베이스와 비교한 뒤 컨테이너를 지웁니다.
**`복원 시험 통과`** 가 나오면 끝입니다. `실패`가 나오면 그 출력과 함께
개발자에게 알려 주세요. 결과는 달력이나 메모에 날짜와 함께 적어 둡니다.

### 복원 — 되돌려야 할 때만

복원하면 **지금 데이터베이스의 내용이 백업 시점의 내용으로 바뀝니다.** 백업
이후에 생긴 가입, 대화, 사용 기록은 사라집니다. 먼저 지금 상태를 한 번 더
백업해 두세요.

```bash
cd ~/ctrl-ai-platform
./deploy/backup.sh                              # 지금 상태도 남겨 둡니다
dc stop web api                                 # 복원 중에 아무도 쓰지 않게
gunzip -c ~/backups/ctrlai-20261013-101500.sql.gz \
  | dc exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
dc run --rm api alembic upgrade head            # 백업이 이전 버전이었다면 표를 맞춥니다
dc up -d
```

내 PC에 있는 백업으로 복원하려면, 먼저 브라우저 SSH 창의 **파일
업로드(UPLOAD FILE)**로 올립니다(홈 폴더에 올라갑니다).

---

## 9. 업데이트 — 작업 하나가 `main`에 합쳐질 때마다

1. GitHub → **Actions** → **images**: 방금 합친 커밋이 **초록 체크**인지
   봅니다(테스트 → 이미지 만들기, 10분 안쪽). 빨간 X면 새 이미지가 없습니다 —
   업데이트하지 말고 원인을 먼저 고칩니다.
2. 서버에서:

   ```bash
   cd ~/ctrl-ai-platform
   ./deploy/update.sh
   ```

   백업 → `git pull` → 새 이미지 받기 → 마이그레이션 → 다시 시작을 차례로
   합니다. 사이트는 api와 web이 바뀌는 몇 초 동안만 멈춥니다.
3. https://ctrlai.my 를 열어 로그인해 봅니다.

**되돌리기:** 새 버전에 문제가 있으면 `.env`의 `IMAGE_TAG=`를 이전 커밋의
SHA(Actions 기록에 나옵니다)로 바꾸고 `dc up -d`. 그 업데이트가 마이그레이션을
했다면 8단계로 업데이트 직전 백업을 복원합니다.

---

## 10. 비용과 결제 계정 업그레이드 💳

### 지금 (무료 체험)

| | |
| --- | --- |
| 크레딧 | ₩407,626 |
| 시작 | 2026-10-13 |
| 끝 | **2027-01-11쯤** (90일) 또는 크레딧을 다 썼을 때 중 먼저 |
| 이 서버가 쓰는 양 | **어림값** 한 달 약 US$37–40 (e2-medium 약 $32 + 30 GB 표준 디스크 약 $1.5 + 사용 중 고정 IP 약 $3.6 + 약간의 트래픽). 1달러 1,400원이면 약 ₩52,000–56,000. 정확한 값은 첫 달의 결제 → 보고서(Reports)로 확인하고, 1단계의 예산 금액을 그에 맞춰 고칩니다 |

세 달이면 약 ₩160,000으로, 크레딧 안에 들어갑니다. 실제 금액은 결제 → **보고서
(Reports)**에서 봅니다.

### 💳 2027-01-04까지: 유료 계정으로 업그레이드

체험이 끝나는 날(2027-01-11쯤)보다 **일주일 먼저** 합니다.

1. 콘솔의 **시작(Welcome)** 페이지 → 위쪽 막대의 **활성화(Activate)** 버튼.
   (콘솔 위쪽에 무료 체험 안내 띠가 보이면 그 안의 같은 버튼을 눌러도 됩니다.)
2. 결제 수단(카드)을 확인하고 유료 결제 계정으로 업그레이드합니다.

업그레이드해도 **남은 크레딧은 처음 90일이 끝날 때까지 그대로 쓰입니다.** 그
뒤부터, 또는 크레딧이 덮지 않는 사용분은 카드로 청구됩니다 — 한 달 약
₩52,000–56,000(Anthropic 비용은 별도).

### 업그레이드하지 않으면

체험이 끝나는 순간(90일이 지나거나 크레딧을 다 쓰거나) **모든 자원이 멈추고
사이트가 꺼집니다.** Compute Engine에 저장된 데이터는 삭제 대상으로 표시됩니다.
그 뒤 **30일의 유예 기간** 안에 업그레이드하면 되살릴 수 있지만, 유예 기간이
지나면 **VM과 디스크 — 데이터베이스 전체 — 가 지워질 수 있습니다.** 날짜를
놓쳤다면 바로 업그레이드하고, 서버 밖에 둔 최신 백업(8단계)이 있는지
확인하세요. (Google Cloud 문서 "Free cloud features"의 무료 체험 종료 항목,
2026-10-13 확인.)

---

## 11. 보안 점검표

키 하나로 여러 회원이 쓰는 구조와 그 보호 장치(동시 호출 한도, 월 예산
막대, 크레딧 소진 시의 동작, Console 쪽 규칙)는
[`api-distribution.md`](api-distribution.md)에 따로 정리되어 있습니다.


- [ ] `ls -l ~/ctrl-ai-platform/.env`가 `-rw-------`
- [ ] `git -C ~/ctrl-ai-platform status`에 `.env`가 보이지 않음(무시되는 파일)
- [ ] 방화벽은 80, 443, SSH뿐. `dc ps`에서 `db`에 `0.0.0.0:5432` 같은 표시 없음
- [ ] `.env`의 `SESSION_COOKIE_DOMAIN=`은 비어 있고, `CORS_ALLOW_ORIGINS`에
      `apps.`가 없음 — 회원 앱(`apps.ctrlai.my`)은 같은 사이트라서 둘 중 하나만
      어긋나도 로그인 쿠키에 닿을 수 있습니다(서버가 시작을 거부합니다)
- [ ] `curl -sI https://apps.ctrlai.my/` 가 404이고 `content-security-policy`에
      `frame-ancestors https://ctrlai.my`, `set-cookie`는 없음
- [ ] Anthropic: 자동 충전 OFF, 월 한도 설정
- [ ] Google Cloud 예산 알림 설정
- [ ] 로컬 데이터베이스를 서버로 복사한 적 없음
- [ ] **베타가 끝나 비밀 값을 Secret Manager로 옮길 때 모든 키를 교체** —
      Anthropic 키, `POSTGRES_PASSWORD`, ghcr.io 토큰

---

## 12. 문제가 생겼을 때

| 증상 | 볼 것 |
| --- | --- |
| 사이트가 안 열림 | `dc ps` — 네 개 모두 Up인가? 아니면 `dc logs <이름> \| tail -30` |
| `502 Bad Gateway` | web이나 api가 아직 켜지는 중이거나 꺼짐. `dc ps`, `dc logs web` |
| api가 계속 재시작 | `dc logs api \| tail -20`의 `Refusing to start:` 뒤 이유 (아래) |
| 인증서 오류 | 5단계 — DNS 확인, 재시작 반복 금지 |
| 디스크가 꽉 참 | `df -h /`, `docker system df`. 오래된 이미지는 `docker image prune -f`, 오래된 백업은 8단계 |
| 느림 | `free -h`(메모리), `docker stats --no-stream` |

`Refusing to start:` 뒤의 영어 이유:

| 문구 | 고칠 곳 |
| --- | --- |
| `APP_ENV is development on a deployed server` | `.env`의 `APP_ENV=beta` |
| `POSTGRES_PASSWORD is the development default` | `.env`의 `POSTGRES_PASSWORD` — 단, **db를 처음 켠 뒤에 바꾸면 접속이 안 됩니다.** 처음부터 다시 하는 중이 아니라면 상의하세요 |
| `ADMIN_PASSWORD is a known default` / `is shorter than 12 characters` | `.env`의 `ADMIN_PASSWORD`를 12자 이상의 진짜 비밀번호로 바꾸거나 비웁니다 |
| `...this setting is missing: ANTHROPIC_API_KEY` | 7단계 — 키를 넣거나 `CLAUDE_PROVIDER=mock`으로 |

고친 뒤에는 `dc up -d --force-recreate api`.

### 비밀번호를 잊었을 때 (관리자든 회원이든, 또는 잠겼을 때)

이용약관 §3은 "비밀번호를 잊으면 운영진에게 알려 주세요"입니다. 회원이
알려 오면 운영진이 서버에서 아래 한 줄을 실행합니다(2026-10-14부터 관리자
계정뿐 아니라 **모든 계정**에 동작합니다).

1. 그 회원이 정말 본인인지 먼저 확인합니다(동아리 채널 등 평소 연락처로).
2. 서버에서:

   ```bash
   dc run --rm api python -m app.db.set_password <아이디>
   ```

   새 비밀번호를 **숨겨진 입력**으로 두 번 묻습니다. 명령줄에도, 셸
   기록에도, 로그에도 비밀번호가 남지 않습니다. 12자 이상, 알려진
   기본값(`devpassword` 등)은 거절합니다.
3. 바꾸면 그 계정은 모든 기기에서 로그아웃되고, 로그인 시도 제한 잠금도
   풀립니다. 감사 기록(Admin › Audit Log)에 "서버 운영자가 셸에서 …의
   비밀번호를 재설정"이 남습니다 — 비밀번호 자체는 어디에도 남지 않습니다.
4. 새 비밀번호는 본인에게 직접 전하고, 로그인한 뒤 Profile에서 바로
   바꾸게 합니다.

탈퇴한 계정(탈퇴 회원)은 로그인할 수 없으므로 바꾸지 않습니다. 예전 이름
`python -m app.db.set_admin_password <아이디>`도 똑같이 동작합니다.

(내 PC에서는 `backend` 폴더에서 `python -m app.db.set_password <아이디>`.)

---

### 예시 앱 세 개를 CtrlAIApps에 올리기 (example-apps)

동아리 출석 체크 · 오늘의 할 일 + 집중 타이머 · AI 상식 퀴즈를 **관리자의
이름으로** 게시합니다. AI를 부르지 않고 지원금도 쓰지 않습니다. 두 번
실행해도 이미 있는 앱은 그대로 둡니다(감사 기록은 새로 올린 것이 있을
때만 남습니다).

```bash
cd ~/ctrl-ai-platform
dc exec api python -m app.db.import_example_apps <관리자 아이디>
```

`게시함: …` 세 줄이 나오면 https://ctrlai.my/ctrlaistore 에 보입니다.
내리려면 Builder에서 그 프로젝트의 **게시 취소**, 또는 Admin › Content의
**게시 내리기**.

## 13. 나중에 키울 때 (지금은 하지 않음) 💳

같은 이미지를 그대로 쓰므로 코드를 고치지 않고 옮길 수 있습니다. 어느 쪽이든
비용이 더 들고, 시작하기 전에 상의합니다.

- **데이터베이스를 Cloud SQL로:** 8단계 백업을 Cloud SQL에 복원하고 api의
  `DATABASE_URL`만 바꿉니다.
- **Cloud Run으로:** web과 api 이미지를 Cloud Run에 올립니다.
- **VM 크게:** 콘솔에서 VM 중지 → 기종 변경 → 시작. 몇 분 멈춥니다.
- **베타 뒤:** 비밀 값을 Secret Manager로 옮기고 모든 키를 교체합니다.

---

## 14. Google 로그인 켜기 (나중에 — 도메인이 살아난 뒤)

회원은 **Google로 계속하기**로 들어옵니다(google-login). 서버에서는
`GOOGLE_LOGIN_PROVIDER=google`로 바꾸기 전까지 Google 버튼이 보이지 않고,
지금처럼 아이디·비밀번호로 로그인합니다. 아래는 모두 **내가 Google Cloud
콘솔에서 직접 하는** 단계입니다(비용 없음).

### 14-1. OAuth 동의 화면

1. 콘솔 → **API 및 서비스** → **OAuth 동의 화면**(화면에 따라 **Google 인증
   플랫폼**).
2. 사용자 유형 **외부(External)**.
3. 앱 이름 `CTRL+AI`, 사용자 지원 이메일, 개발자 연락처 이메일.
4. **승인된 도메인**에 `ctrlai.my`.
5. 범위(Scopes)는 **`openid`, `email`, `profile`만** 추가합니다. YouTube
   범위는 지금 넣지 않습니다(Phase 7에서 따로 묻습니다).
6. 게시 상태:
   - **테스트(Testing)** 상태에서는 **테스트 사용자**로 등록한 Google 계정만
     로그인할 수 있습니다. 처음엔 이렇게 시작하고 내 계정과 몇 명을 넣어
     확인합니다.
   - 확인이 끝나면 **앱 게시(Publish app)**. 이 세 범위는 민감하지 않은 범위라
     Google의 앱 심사가 필요 없습니다. (YouTube 업로드 범위는 심사가 필요하고,
     심사 전에는 업로드가 비공개로만 됩니다 — Phase 7.)

### 14-2. OAuth 클라이언트 ID

1. **사용자 인증 정보** → **사용자 인증 정보 만들기** → **OAuth 클라이언트 ID**.
2. 애플리케이션 유형 **웹 애플리케이션**, 이름 `ctrlai-web`.
3. **승인된 리디렉션 URI**: `https://ctrlai.my/api/auth/google/callback`
   (한 글자도 다르면 Google이 거절합니다). 자바스크립트 원본은 필요 없습니다.
4. 만들면 나오는 **클라이언트 ID**와 **클라이언트 보안 비밀번호**를 복사합니다.
   보안 비밀번호는 어디에도 붙여 넣지 말고 바로 서버의 `.env`에만 적습니다.

### 14-3. 서버의 `.env`

```bash
cd ~/ctrl-ai-platform
nano .env
#   GOOGLE_LOGIN_PROVIDER=google
#   GOOGLE_CLIENT_ID=....apps.googleusercontent.com
#   GOOGLE_CLIENT_SECRET=(복사한 보안 비밀번호)
#   GOOGLE_REDIRECT_URI=https://ctrlai.my/api/auth/google/callback
dc up -d --force-recreate api
```

셋 중 하나라도 비어 있으면 api가 켜지지 않고 `Refusing to start:` 뒤에 빠진
이름이 적힙니다(12단계 표).

### 14-4. 관리자 계정에 Google 연결 — 순서가 중요합니다

관리자 계정(`ADMIN_EMAIL`, 지금은 ctrlai.platform@gmail.com)은 이미
있습니다. 같은 이메일로 **새로 가입하려 하면 막힙니다** — 이메일이 같다는
이유로 남의 계정에 들어가게 하지 않기 때문입니다. 그래서:

1. `https://ctrlai.my/login`에서 관리자 아이디·비밀번호로 로그인
   (Google 단추 아래 칸).
2. **Profile → 로그인 방법 → Google 계정 → 연결하기**.
3. 그 Google 계정을 고르면 "연결됨". 다음부터는 Google 단추로도, 아이디와
   비밀번호로도 들어올 수 있습니다.

비밀번호로 먼저 가입한 회원이 있다면 같은 방법으로 연결하라고 안내합니다.
새 회원은 Google로 들어와 아이디·이름·초대 코드를 적으면 가입됩니다.

---

## 부록 — 내 PC에서 운영 구성 그대로 띄워 보기 (개발자용)

서버에 올리기 전에 네 개 서비스가 함께 켜지는지 PC에서 확인하는 방법입니다.
HTTPS는 Caddy가 PC 전용 인증서를 쓰므로 브라우저가 경고합니다(정상).

```powershell
# 저장소 폴더에서. prodtest.env 는 .env.example 을 복사해 APP_ENV=beta,
# POSTGRES_PASSWORD(무작위), SITE_DOMAIN=localhost, ADMIN_* 를 채우고
# HTTP_PORT=8080, HTTPS_PORT=8443, API_ENV_FILE=<그 파일의 전체 경로> 를
# 덧붙인 파일입니다. 저장소 밖에 두세요.
docker compose -p ctrlai-prodtest --env-file C:\path\to\prodtest.env -f docker-compose.prod.yml -f docker-compose.build.yml up -d --build
docker compose -p ctrlai-prodtest --env-file C:\path\to\prodtest.env -f docker-compose.prod.yml run --rm api alembic upgrade head
docker compose -p ctrlai-prodtest --env-file C:\path\to\prodtest.env -f docker-compose.prod.yml run --rm api python -m app.db.bootstrap
curl.exe -k https://localhost:8443/api/site
# 끝나면 (이 시험용 데이터만 지웁니다)
docker compose -p ctrlai-prodtest --env-file C:\path\to\prodtest.env -f docker-compose.prod.yml down -v
```
