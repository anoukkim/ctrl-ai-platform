/**
 * /help/apps — 앱 기능 상자 안내 (app-platform P4b).
 *
 * 회원이 Builder로 만든 앱이 로그인·AI·저장·데이터를 어떻게 쓰는지,
 * 돈이 언제 누구에게서 나가는지, 복사해 쓸 수 있는 코드 예제까지. 글만
 * 있는 Server Component이고, 로그인 전에도 읽을 수 있습니다. 규칙의
 * 출처는 docs/architecture.md › Member app platform — 숫자를 바꾸면 여기도.
 */

import type { Metadata } from "next";

import LegalPage from "@/app/components/LegalPage";

import styles from "@/app/components/legal.module.css";

export const metadata: Metadata = {
  title: "앱 기능 상자 안내 — CTRL+AI",
};

export default function HelpAppsPage() {
  return (
    <LegalPage title="앱 기능 상자 안내" effective="2026-10-16 · 기능 상자 v4">
      <p className={styles.lead}>
        Builder로 만든 앱은 방문자의 브라우저 안, CTRL+AI 계정과 분리된 칸에서 돌아가요. 그 칸 안에서 앱이
        쓸 수 있는 것이 <strong>기능 상자</strong>예요 — 저장, 로그인, AI, 앱 데이터베이스. Claude가 앱을 만들
        때 이미 알고 쓰니, 회원은 &ldquo;회원이 로그인해서 글을 올리는 게시판&rdquo;처럼 말하면 돼요. 이 글은
        무엇이 되는지와 돈이 언제 나가는지를 적어 둔 거예요.
      </p>

      <h2>1. 한눈에</h2>
      <table>
        <thead>
          <tr>
            <th>기능</th>
            <th>무엇</th>
            <th>로그인</th>
            <th>비용</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>ctrlai.storage</code>
            </td>
            <td>앱마다 · 방문자마다 약 1MB. 설정, 초안, 내 기록.</td>
            <td>필요 없음</td>
            <td>없음</td>
          </tr>
          <tr>
            <td>
              <code>ctrlai.user</code> / <code>login</code>
            </td>
            <td>CTRL+AI 회원 로그인. 앱은 표시 이름과 앱별 id만 받아요(이메일·아이디·잔액은 못 봐요).</td>
            <td>회원만</td>
            <td>없음</td>
          </tr>
          <tr>
            <td>
              <code>ctrlai.ai</code>
            </td>
            <td>Claude. 글, 사진 읽기, JSON 답.</td>
            <td>회원만</td>
            <td>쓰는 사람(방문자)의 동아리 지원금 · 1회 최대 1,000원 · 하루 상한 있음</td>
          </tr>
          <tr>
            <td>
              <code>ctrlai.db</code>
            </td>
            <td>앱의 데이터베이스. 개인 목록(각자 자기 것만) · 공유 목록(모두 읽고, 회원이 씀).</td>
            <td>읽기는 공유 목록만 누구나, 쓰기는 회원만</td>
            <td>없음</td>
          </tr>
        </tbody>
      </table>

      <h2>2. 로그인과 허용</h2>
      <p>
        앱이 로그인·AI·데이터 저장을 처음 쓰면 CTRL+AI 창이 열려요: 어느 앱이, 누가 만들었고, 무엇을 할 수
        있는지(&ldquo;이 앱에서 Claude를 써요 — 1회 약 N원&rdquo;, &ldquo;이 앱에 데이터를 저장해요&rdquo;)를 보고{" "}
        <strong>허용</strong>하면 돼요. 허용은 앱마다 한 번이고, Profile › 연결된 앱에서 언제든 끊을 수 있어요.
        끊으면 그 앱의 로그인이 바로 끝나요.
      </p>
      <p>로그인하지 않은 방문자도 앱을 열고 공유 목록을 읽을 수 있어요. AI, 저장, 쓰기는 &ldquo;CTRL+AI 회원만 쓸 수 있어요&rdquo;와 로그인 버튼이 보여요.</p>

      <h2>3. AI — 돈은 언제 나가나</h2>
      <ul>
        <li>
          <strong>쓰는 사람이 내요.</strong> 앱 안에서 AI를 쓰면 그 방문자의 동아리 지원금에서 나가요. 만든 사람이 아니라요.
          Builder 미리보기에서는 만든 사람이 방문자라 만든 사람의 지원금에서 나가요(Usage에 &ldquo;앱 미리보기 · 앱 이름&rdquo;).
        </li>
        <li>
          <strong>버튼을 눌렀을 때만.</strong> 앱을 열거나 실제 AI로 바꾸는 것만으로는 0원이에요. 잘 만든 앱은 버튼 옆에 &ldquo;1회 약 N원 · 최대 M원&rdquo;을 먼저
          보여 주고, 부른 뒤에 실제 금액을 보여 줘요. 그 최대 금액은 넘지 않아요 — AI가 형식에 안 맞는 답을 해서 서버가 한 번 더 묻는
          경우까지 포함해서요.
        </li>
        <li>
          <strong>상한.</strong> 1회 1,000원, 하루에 앱 전체에서 쓸 수 있는 금액(관리자 설정, 기본 2,000원), 1분에 10번. 넘으면 한국어로 이유가 보여요.
        </li>
        <li>
          <strong>웹 검색.</strong> 새로 나온 영화나 요즘 가격처럼 AI가 모를 수 있는 것은 앱이 웹 검색을 켜고 물어볼 수 있어요 — 한 번에
          최대 3번 검색하고, 검색 한 번에 약 15원과 찾은 내용만큼이 더 들어요. 그래도 1회 1,000원을 넘지 않고, 버튼 옆 최대 금액에 미리
          들어가 있어요.
        </li>
        <li>
          <strong>데모와 실제 AI.</strong> 앱을 게시할 때 만든 사람이 다른 회원에게 AI를 <strong>데모만</strong> 열지 <strong>전체 기능</strong>으로 열지
          골라요(나중에 게시 메뉴에서 바꿀 수 있어요). 데모에서는 AI를 부르지 않아서 0원이고, 앱은 미리 적어 둔 답을 보여 줘요. 전체 기능인 앱에서도
          앱 맨 위 CTRL+AI 줄의 스위치로 언제든 데모로 볼 수 있어요. 관리자는 앱의 기능 상자를 통째로 멈출 수 있어요. 앱 코드에서는 호출이
          <code>error.code === &quot;demo&quot;</code>로 실패하고, <code>ctrlai.ai.mode()</code>가 지금 어느 쪽인지 알려 줘요.
        </li>
        <li>
          <strong>모델.</strong> &ldquo;fast&rdquo;(기본, 짧은 답 약 10원)와 &ldquo;smart&rdquo;(약 30원). 사진은 한 장에 몇 원이 더 들어요.
        </li>
      </ul>

      <h2>4. 앱 데이터베이스 — 개인 목록과 공유 목록</h2>
      <p>
        목록 이름은 같아도 <strong>개인</strong>과 <strong>공유</strong>는 다른 목록이에요. 개인 목록은 로그인한 각자가 자기 것만 보고(일기, 내 점수),
        공유 목록은 모두가 읽고 로그인한 회원이 써요(게시판, 투표, 랭킹). 공유 목록의 항목에는 쓴 사람의 표시 이름이 붙어요.
      </p>
      <ul>
        <li>쓴 사람이 자기 항목을 고치고 지워요. 앱을 만든 사람은 공유 항목을 모두 지울 수 있어요.</li>
        <li>이상한 항목은 앱의 신고 버튼으로 운영진에게 알려요. 운영진이 숨기거나 지우면 모두에게 사라져요.</li>
        <li>
          <strong>목록은 앱을 만든 사람이 정해요.</strong> 프로젝트의 <code>ctrlai.json</code>에 적혀 있고(Claude가 써요), 거기 없는 목록에는 방문자가
          저장할 수 없어요.
        </li>
        <li>항목 하나 4KB, 앱마다 2,000개 · 5MB · 목록 20개, 한 사람이 1분에 30번까지.</li>
        <li>Builder 미리보기의 데이터는 따로예요 — 미리보기에서 써 본 글이 게시된 앱에 보이지 않아요.</li>
      </ul>

      <h2>5. 코드 — Claude에게 말할 때 참고</h2>
      <p>보통은 Claude에게 한국어로 말하면 돼요. 직접 고치고 싶을 때 쓰는 모양이에요(모두 Promise).</p>
      <pre>{`// 저장 (앱마다 · 방문자마다, 로그인 없이)
await ctrlai.storage.set("settings", { theme: "dark" });
const settings = await ctrlai.storage.get("settings"); // 없으면 null

// 로그인한 회원인지
const user = await ctrlai.user(); // { displayName, appUserId } 또는 null
if (!user) await ctrlai.login();  // CTRL+AI 창이 열려요

// AI — 버튼을 눌렀을 때만. 가격을 먼저 보여 주세요.
const options = { prompt: "이 영수증을 읽어 줘", images: [dataUrl], json: SCHEMA, maxTokens: 700 };
const price = await ctrlai.ai.estimate(options); // { typicalKrw, maxKrw } — 무료
button.textContent = \`읽기 · 1회 약 \${price.typicalKrw}원 · 최대 \${price.maxKrw}원\`;
const result = await ctrlai.ai.ask(options);     // { text, json, chargedKrw }

// 앱 데이터베이스 — ctrlai.json에 적은 목록만
const post = await ctrlai.db.save("posts", { title: "안녕" }, { shared: true });
const page = await ctrlai.db.list("posts", { shared: true, limit: 20 }); // { items, nextCursor }
await ctrlai.db.update("posts", post.id, { title: "수정" }, { shared: true });
await ctrlai.db.report("posts", post.id, "광고예요");`}</pre>
      <pre>{`// ctrlai.json — 이 앱이 쓰는 목록 (없는 이름에는 방문자가 저장 못 해요)
{ "db": [ { "name": "posts", "shared": true }, { "name": "notes" } ] }`}</pre>
      <p>
        오류는 <code>error.code</code>로 알 수 있어요: <code>login_required</code>(로그인 필요), <code>no_collection</code>(ctrlai.json에
        없는 목록), <code>wallet</code>(지원금 부족), <code>day_cap</code>(하루 상한), <code>rate</code>(너무 자주).
      </p>

      <h2>6. CTRL+AI 밖에서 열면</h2>
      <p>
        내려받은 파일을 직접 열면 <code>window.ctrlai</code>가 없어요. Claude가 만든 앱은 그때 저장을 localStorage로 바꾸고, AI는 데모 답을 보여 주고,
        목록은 비어 있는 것으로 돌아가요. 진짜로 쓰려면 직접 서버를 붙여야 해요 — 내려받은 ZIP의 README와 CLAUDE.md에 적혀 있어요.
      </p>

      <h2>7. 템플릿과 쇼케이스</h2>
      <p>
        Builder의 새 프로젝트 칸에 있는 AI 챗봇 · 투표·설문 · 랭킹 게임 · 동아리 게시판은 이 기능 상자를 올바르게 쓴 작은 앱이에요. CtrlAIApps의
        쇼케이스 세 개(출장·여행 준비 도우미, 여행 일정 메이커, 문서 챗봇 메이커)는 위쪽 CTRL+AI 줄의 스위치를 켜면 실제 AI로, 아니면 데모로 돌아가요.
        출장·여행 준비 도우미는 날씨·환율을, 여행 일정 메이커는 지도와 장소 검색을 바깥 서비스에서 받아 와요 — 내 앱에서도 같은 방법을 쓸 수 있어요.
      </p>
    </LegalPage>
  );
}
