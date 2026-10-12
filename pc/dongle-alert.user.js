// ==UserScript==
// @name         동글 시세 자동 전송
// @namespace    https://github.com/kpar03004-droid/dongle
// @version      1.0.0
// @description  디스코드 웹에서 상점알리미(#연금술사-변동상점 · #요리사-변동상점) 알림을 읽어 시세 저장소로 보냅니다.
// @match        https://discord.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      api.github.com
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/kpar03004-droid/dongle/main/pc/dongle-alert.user.js
// @downloadURL  https://raw.githubusercontent.com/kpar03004-droid/dongle/main/pc/dongle-alert.user.js
// ==/UserScript==

/* 하는 일
 *  - 지금 열려 있는 디스코드 채널이 「…변동상점」일 때만 동작
 *  - 화면에 뜬 메시지 중 「[이름] | 숫자 → 숫자」 모양의 상점 알림을 찾아
 *  - GitHub 저장소(dongle)에 보내면, 저장소가 시세 기록에 더하고 사이트가 바로 반영
 *  디스코드에 글을 쓰거나 무언가를 누르지 않고, 화면에 표시된 글을 읽기만 합니다.
 */
(function () {
  "use strict";

  var REPO = "kpar03004-droid/dongle";
  var ITEM_RE = /\[\s*[^\]]+?\s*\]\s*\|\s*\d+\s*(?:→|->|>)\s*\d+/;   // 상점 알림 한 줄 모양
  var MAX_AGE_DAYS = 30;                                               // 이보다 오래된 알림은 안 보냄

  var sent = {};
  (GM_getValue("sent", []) || []).forEach(function (id) { sent[id] = 1; });
  var queue = {};
  var timer = null;

  /* ---------- 상태 표시 (화면 오른쪽 아래 작은 상자) ---------- */
  var box = null;
  function status(msg, bad) {
    if (!box) {
      box = document.createElement("div");
      box.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:99999;max-width:320px;" +
        "background:#1B2430;color:#F1F5F7;border:1px solid #33424F;border-radius:10px;" +
        "padding:8px 12px;font:13px/1.5 sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);cursor:pointer";
      box.title = "누르면 숨김";
      box.addEventListener("click", function () { box.style.display = "none"; });
      document.body.appendChild(box);
    }
    box.style.display = "block";
    box.style.borderColor = bad ? "#FF8A7A" : "#33424F";
    box.innerHTML = "🧪 <b>동글 시세</b> · " + msg;
  }

  /* ---------- GitHub 토큰 ---------- */
  function token() { return (GM_getValue("token", "") || "").trim(); }
  function askToken() {
    var t = prompt("동글 시세: GitHub 토큰을 붙여넣으세요.\n(github_pat_ 로 시작하는 긴 글자)");
    if (t && t.trim()) { GM_setValue("token", t.trim()); status("토큰 저장됨 ✅"); scanAll(); }
  }
  GM_registerMenuCommand("GitHub 토큰 넣기 / 바꾸기", askToken);

  /* ---------- 화면에서 알림 찾기 ---------- */
  function onShopChannel() { return /변동상점/.test(document.title); }

  function snowflakeTime(id) {   // 디스코드 메시지 ID 안에 작성 시각이 들어 있음
    return Number(BigInt(id) >> 22n) + 1420070400000;
  }

  function scan(root) {
    if (!onShopChannel() || !root.querySelectorAll) return;
    var els = root.querySelectorAll('div[id^="message-content-"]');
    if (root.id && root.id.indexOf("message-content-") === 0) els = [root];
    Array.prototype.forEach.call(els, function (el) {
      var id = el.id.slice("message-content-".length);
      if (!/^\d+$/.test(id) || sent[id] || queue[id]) return;
      if (Date.now() - snowflakeTime(id) > MAX_AGE_DAYS * 86400000) return;
      var text = el.innerText || "";
      if (!ITEM_RE.test(text)) return;
      queue[id] = { id: id, content: text };
    });
    if (Object.keys(queue).length) { clearTimeout(timer); timer = setTimeout(flush, 1500); }
  }
  function scanAll() { scan(document); }

  /* ---------- GitHub 로 보내기 ---------- */
  function flush() {
    var alerts = Object.keys(queue).map(function (k) { return queue[k]; });
    if (!alerts.length) return;
    if (!token()) { status("GitHub 토큰이 없어요 — 여기를 누르고 Tampermonkey 메뉴에서 「GitHub 토큰 넣기」", true); return; }
    GM_xmlhttpRequest({
      method: "POST",
      url: "https://api.github.com/repos/" + REPO + "/dispatches",
      headers: {
        "Authorization": "Bearer " + token(),
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json"
      },
      data: JSON.stringify({ event_type: "shop-alert", client_payload: { alerts: alerts.slice(0, 100) } }),
      timeout: 20000,
      onload: function (r) {
        if (r.status === 204) {
          alerts.forEach(function (a) { sent[a.id] = 1; delete queue[a.id]; });
          GM_setValue("sent", Object.keys(sent).slice(-1000));
          var when = new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
          status(when + " 알림 " + alerts.length + "개 보냄 ✅ (30초쯤 뒤 사이트에 반영)");
        } else if (r.status === 401 || r.status === 403 || r.status === 404) {
          status("토큰이 틀렸거나 권한이 없어요 (" + r.status + ") — Tampermonkey 메뉴에서 토큰을 다시 넣어 주세요", true);
        } else {
          status("보내기 실패 (" + r.status + ") — 1분 뒤 다시 시도", true);
          setTimeout(flush, 60000);
        }
      },
      onerror: function () { status("인터넷 연결 실패 — 1분 뒤 다시 시도", true); setTimeout(flush, 60000); },
      ontimeout: function () { status("응답 없음 — 1분 뒤 다시 시도", true); setTimeout(flush, 60000); }
    });
  }

  /* ---------- 새 메시지 지켜보기 ---------- */
  new MutationObserver(function (muts) {
    muts.forEach(function (m) {
      Array.prototype.forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1) scan(n); });
    });
  }).observe(document.body, { childList: true, subtree: true });
  setInterval(scanAll, 30000);   // 혹시 놓친 게 있으면 30초마다 다시 훑음
  setTimeout(function () {
    scanAll();
    if (onShopChannel()) status(token() ? "지켜보는 중 👀 이 탭을 열어 두세요" : "GitHub 토큰을 넣어 주세요 (Tampermonkey 메뉴)", !token());
  }, 3000);
  if (!token()) setTimeout(function () { if (onShopChannel() && !token()) askToken(); }, 4000);
})();
