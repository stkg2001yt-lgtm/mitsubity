// ====== 1) Firebase 設定（あなたの値に置き換え） ======
const firebaseConfig = {
    apiKey: "AIzaSyBDEx6TnK_AbnkrGDUbWXGnu0WBwLku0N8",
    authDomain: "mitsuty-d9c2a.firebaseapp.com",
    databaseURL: "https://mitsuty-d9c2a-default-rtdb.firebaseio.com",
    projectId: "mitsuty-d9c2a",
    storageBucket: "mitsuty-d9c2a.firebasestorage.app",
    messagingSenderId: "1064899582432",
    appId: "1:1064899582432:web:8bc4a07f82d0783c793385",
    measurementId: "G-PDSY94BEH6"
};

// ====== 2) Gemini（デモ用：キーを直書き） ======
const GEMINI_API_KEY = "AIzaSyBVQeopQpfLbmYevQWVlWkmm1uLfJWYFa8";
const GEMINI_MODEL = "gemini-1.5-flash-latest";

// ====== 3) 初期化（SDK未読込でもUIが落ちないようガード） ======
// let db = null;

// const STATE = {
//     anonId: null,
//     displayName: null,
//     threads: {},
//     filters: { dorm: "", tag: "", text: "" }
// };

// $(function () {
//     safeInitFirebase(); // Firebaseが読めていなくても続行
//     boot();
// });

// function safeInitFirebase() {
//     try {
//         if (!window.firebase) throw new Error("Firebase SDK が読み込めていません");
//         firebase.initializeApp(firebaseConfig);
//         db = firebase.database();
//     } catch (err) {
//         console.warn("[Firebase init error]", err);
//         db = null; // 未接続で続行
//     }
// }

let db = null;

const STATE = {
    anonId: null,
    displayName: null,
    threads: {},
    filters: { dorm: "", tag: "", text: "" },
    _subscribed: false
};

$(function () {
    // Firebaseの読み込みが遅れても拾えるように最大5秒リトライ
    safeInitFirebaseWithRetry(10);  // 10回 × 500ms = 5秒
    boot();
});

function safeInitFirebaseWithRetry(retries = 10) {
    try {
        if (!window.firebase) throw new Error("Firebase SDK未読込");
        // 二重初期化を避ける
        if (firebase.apps && firebase.apps.length === 0) {
            firebase.initializeApp(firebaseConfig);
        }
        if (!firebase.database) throw new Error("database-compat未読込");
        db = firebase.database();
        console.log("[init] RTDB ready");

        // 初期化が遅れても購読を張り直す
        if (!STATE._subscribed) {
            subscribeThreads();
            STATE._subscribed = true;
        }
        return; // 成功
    } catch (e) {
        console.warn("[init warn]", e.message);
        if (retries > 0) {
            setTimeout(() => safeInitFirebaseWithRetry(retries - 1), 500);
        }
    }
}


// ====== 4) 起動処理 ======
function boot() {
    ensureAnonId();
    $("#userIdBox").text(`あなたのID: ${STATE.anonId}`);

    // タブ切替
    $(".tab-btn").on("click", function () {
        $(".tab-btn").removeClass("active"); $(this).addClass("active");
        $(".view").removeClass("active"); $($(this).data("target")).addClass("active");
    });
    $(".go-post, .back-home").on("click", function () {
        const target = $(this).hasClass("go-post") ? "#postView" : "#homeView";
        $(".tab-btn").removeClass("active");
        $(`.tab-btn[data-target="${target}"]`).addClass("active");
        $(".view").removeClass("active"); $(target).addClass("active");
    });

    // フィルタ
    $("#dormFilter").on("change", () => { STATE.filters.dorm = $("#dormFilter").val(); renderThreadList(); });
    $("#tagQuick").on("change", () => { STATE.filters.tag = $("#tagQuick").val(); renderThreadList(); });
    $("#textSearch").on("input", debounce(() => { STATE.filters.text = $("#textSearch").val().trim(); renderThreadList(); }, 200));

    // 投稿
    $("#postForm").on("submit", handleCreateThread);

    // スレ購読
    subscribeThreads();

    // 要約（初回＋3分おき）
    runSummary().catch(console.warn);
    setInterval(runSummary, 3 * 60 * 1000);
}

// ====== 5) 匿名ID ======
function ensureAnonId() {
    let id = localStorage.getItem("anonId");
    if (!id) { id = generateAnonId(); localStorage.setItem("anonId", id); }
    STATE.anonId = id;
    const savedName = localStorage.getItem("displayName") || "";
    if (savedName) STATE.displayName = savedName;
}
function generateAnonId(len = 8) {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let s = ""; for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

// ====== 6) スレ購読＆描画 ======
// function subscribeThreads() {
//     if (!db) {
//         $("#threadList").html('<div class="muted">（DB未接続：firebaseConfig やネットワークを確認）</div>');
//         return;
//     }
//     db.ref("threads").on("value", (snap) => {
//         STATE.threads = snap.val() || {};
//         renderThreadList();
//     });
// }

function subscribeThreads() {
    if (STATE._subscribed) return;
    if (!db) { setTimeout(subscribeThreads, 500); return; }
    db.ref("threads").on("value", (snap) => {
        STATE.threads = snap.val() || {};
        renderThreadList();
    });
    STATE._subscribed = true;
}

function renderThreadList() {
    const list = $("#threadList").empty();
    const rows = Object.entries(STATE.threads).map(([id, t]) => ({ id, ...t }));
    rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    const f = rows.filter(r => {
        if (STATE.filters.dorm && r.dorm !== STATE.filters.dorm) return false;
        if (STATE.filters.tag) {
            const tags = (r.tags || []).map(x => String(x).trim());
            if (!tags.includes(STATE.filters.tag)) return false;
        }
        if (STATE.filters.text) {
            const q = STATE.filters.text.toLowerCase();
            const title = (r.title || "").toLowerCase();
            const first = (r.firstPostPreview || "").toLowerCase();
            if (!title.includes(q) && !first.includes(q)) return false;
        }
        return true;
    });

    if (!rows.length) { list.append($("<div>").addClass("muted").text("まだ投稿がありません。最初の投稿をしてみましょう！")); return; }
    if (!f.length) { list.append($("<div>").addClass("muted").text("該当なし。フィルタ条件を見直してください。")); return; }

    f.forEach(t => {
        const card = $("<section>").addClass("card");
        const head = $("<div>").addClass("thread-head");
        const title = $("<h3>").addClass("thread-title").text(t.title || "（無題・雑談）");
        const badges = $("<div>").addClass("badges");
        badges.append($("<span>").addClass("badge accent").text(t.type === "free" ? "譲/求" : "雑談"));
        badges.append($("<span>").addClass("badge").text(t.dorm));
        (t.tags || []).forEach(tag => badges.append($("<span>").addClass("badge").text(tag)));

        const body = $("<div>").addClass("thread-body");
        const toggleBtn = $("<button>").addClass("ghost").text("展開").on("click", () => {
            body.toggleClass("active");
            toggleBtn.text(body.hasClass("active") ? "閉じる" : "展開");
            if (body.hasClass("active")) loadPosts(t.id, body.find(".posts"));
        });

        head.append(title, badges, toggleBtn);
        const meta = $("<div>").addClass("thread-meta")
            .text(`作成: ${nameOrId(t.createdBy)} / 更新: ${timeAgo(t.updatedAt)} / ID:${t.id.slice(-6)}`);

        const firstP = $("<div>").addClass("post").append(
            $("<div>").text(t.firstPostPreview || "(本文)"),
            t.firstImage ? $("<img>").attr("src", t.firstImage) : null
        );
        const postsWrap = $("<div>").addClass("posts").append(firstP);

        // 返信
        const replyBox = $("<div>").addClass("reply-box");
        const replyName = $("<input>").attr({ type: "text", placeholder: "表示名（任意）" }).val(localStorage.getItem("displayName") || "");
        const replyText = $("<textarea>").attr({ rows: 3, placeholder: "返信内容" });
        const replyImg = $("<input>").attr({ type: "file", accept: "image/*" });
        const replyDo = $("<button>").addClass("primary").text("返信する").on("click", async () => {
            const nameVal = replyName.val().trim();
            if (nameVal) { localStorage.setItem("displayName", nameVal); STATE.displayName = nameVal; }
            const content = replyText.val().trim();
            if (!content && !replyImg[0].files.length) { alert("本文か画像のどちらかは必要です"); return; }
            if (!db) { alert("Firebase未接続です。設定やネットワークを確認してください。"); return; }
            let imageData = null;
            if (replyImg[0].files.length) { imageData = await fileToDataURL(replyImg[0].files[0], 1280); }
            await addReply(t.id, { author: { anonId: STATE.anonId, name: nameVal || null }, content, image: imageData, createdAt: Date.now() });
            replyText.val(""); replyImg.val("");
        });
        replyBox.append(replyName, replyText, replyImg, $("<div>").addClass("reply-actions").append(replyDo));

        body.append($("<div>").addClass("muted").text("スレッドの投稿"), postsWrap, replyBox);
        card.append(head, meta, body);
        list.append(card);
    });
}

function nameOrId(user) { return user?.name ? `${user.name}（ID:${user.anonId.slice(0, 6)}）` : `ID:${(user?.anonId || STATE.anonId)}`; }
function timeAgo(ts) {
    if (!ts) return "-";
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}秒前`;
    const m = Math.floor(s / 60); if (m < 60) return `${m}分前`;
    const h = Math.floor(m / 60); if (h < 24) return `${h}時間前`;
    const d = Math.floor(h / 24); return `${d}日前`;
}

// ====== 7) 投稿/返信 ======
// async function handleCreateThread(e) {
//     e.preventDefault();
//     const name = $("#inputName").val().trim();
//     const dorm = $("#inputDorm").val();
//     const type = $("#inputType").val();
//     const title = $("#inputTitle").val().trim();
//     const content = $("#inputContent").val().trim();
//     const tags = ($("#inputTags").val().split(",").map(s => s.trim()).filter(Boolean)) || [];
//     if (!dorm) { alert("寮を選択してください"); return; }
//     if (type === "free" && !title) { alert("譲ります/求む はタイトル必須です"); return; }
//     if (!title && !content) { alert("タイトルか本文のどちらかは必要です"); return; }
//     if (!db) { alert("Firebase未接続です。firebaseConfig（databaseURL含む）とネットワークを確認してください。"); return; }

//     const fileInput = $("#inputImage")[0];
//     let imageData = null;
//     if (fileInput.files.length) { imageData = await fileToDataURL(fileInput.files[0], 1280); }
//     if (name) { localStorage.setItem("displayName", name); STATE.displayName = name; }

//     const firstPost = { author: { anonId: STATE.anonId, name: name || null }, content, image: imageData, createdAt: Date.now() };
//     const ref = db.ref("threads").push(); const threadId = ref.key;
//     const threadData = {
//         id: threadId, type, title: title || (content ? content.slice(0, 24) : "（無題）"),
//         dorm, tags, createdBy: { anonId: STATE.anonId, name: name || null },
//         firstPostPreview: content.slice(0, 100), firstImage: imageData || null,
//         createdAt: firstPost.createdAt, updatedAt: firstPost.createdAt
//     };
//     const updates = {};
//     updates[`threads/${threadId}`] = threadData;
//     updates[`threads/${threadId}/posts`] = { [db.ref().push().key]: firstPost };
//     await db.ref().update(updates);

//     // 画面戻し
//     $("#inputTitle, #inputContent, #inputTags").val(""); $("#inputImage").val("");
//     $(".tab-btn").removeClass("active"); $('.tab-btn[data-target="#homeView"]').addClass("active");
//     $(".view").removeClass("active"); $("#homeView").addClass("active");
// }

async function handleCreateThread(e) {
    e.preventDefault();
    try {
        console.log("[debug] submit fired");

        const name = $("#inputName").val().trim();
        const dorm = $("#inputDorm").val();
        const type = $("#inputType").val();
        const title = $("#inputTitle").val().trim();
        const content = $("#inputContent").val().trim();
        const tags = ($("#inputTags").val().split(",").map(s => s.trim()).filter(Boolean)) || [];

        if (!dorm) throw new Error("寮が未選択");
        if (type === "free" && !title) throw new Error("譲ります/求むはタイトル必須");
        if (!title && !content) throw new Error("タイトルか本文のどちらかは必要");
        if (!window.firebase || !firebase.database) throw new Error("Firebase SDK未読込");
        if (!db) throw new Error("DB_NOT_INITIALIZED: dbがnull（初期化/順序を確認）");

        // 画像
        const f = $("#inputImage")[0];
        let imageData = null;
        if (f.files.length) { imageData = await fileToDataURL(f.files[0], 1280); }
        if (name) { localStorage.setItem("displayName", name); STATE.displayName = name; }

        const now = Date.now();
        const threadRef = db.ref("threads").push();
        const threadId = threadRef.key;

        const threadData = {
            id: threadId,
            type,
            title: title || (content ? content.slice(0, 24) : "（無題）"),
            dorm,
            tags,
            createdBy: { anonId: STATE.anonId, name: name || null },
            firstPostPreview: content.slice(0, 100),
            firstImage: imageData || null,
            createdAt: now,
            updatedAt: now
        };

        const firstPost = {
            author: { anonId: STATE.anonId, name: name || null },
            content,
            image: imageData || null,
            createdAt: now
        };

        // ★ ここを「2回に分けて」書く（親→子）。ancestor衝突を回避
        await threadRef.set(threadData);
        await threadRef.child("posts").push(firstPost);

        alert("投稿しました");
        $("#inputTitle, #inputContent, #inputTags").val(""); $("#inputImage").val("");
        $('.tab-btn[data-target="#homeView"]').click();
    } catch (err) {
        console.error("[POST ERROR]", err);
        alert("投稿に失敗: " + (err?.message || err));
    }
}

async function addReply(threadId, post) {
    const pRef = db.ref(`threads/${threadId}/posts`).push();
    await pRef.set(post);
    await db.ref(`threads/${threadId}`).update({ updatedAt: Date.now() });
}

function loadPosts(threadId, container) {
    if (!db) return;
    db.ref(`threads/${threadId}/posts`).orderByChild("createdAt").limitToLast(50).on("value", (snap) => {
        const posts = snap.val() || {};
        const arr = Object.values(posts).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        container.find(".post.extra").remove();
        arr.slice(1).forEach(p => {
            const div = $("<div>").addClass("post extra");
            div.append($("<div>").text(`${p.author?.name || `ID:${(p.author?.anonId || "").slice(0, 6)}`} / ${timeAgo(p.createdAt)}`));
            if (p.content) div.append($("<div>").text(p.content));
            if (p.image) div.append($("<img>").attr("src", p.image));
            container.append(div);
        });
    });
}

// ====== 8) 画像DataURL化（圧縮あり） ======
function fileToDataURL(file, maxW = 1280) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, maxW / img.width);
                const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
                const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
                cv.getContext("2d").drawImage(img, 0, 0, w, h);
                resolve(cv.toDataURL("image/jpeg", 0.8));
            };
            img.onerror = reject; img.src = reader.result;
        };
        reader.onerror = reject; reader.readAsDataURL(file);
    });
}

// ====== 9) Gemini 要約 ======
async function runSummary() {
    try {
        if (!db) { $("#summaryContent").text("DB未接続のため要約できません。"); return; }
        const recent = await getRecentForSummary(20);
        if (!recent.length) { $("#summaryContent").text("投稿がまだありません。"); return; }
        const prompt = buildSummaryPrompt(recent);
        const text = await callGemini(prompt);
        $("#summaryContent").text(text || "要約に失敗しました。");
    } catch (err) {
        console.warn(err);
        $("#summaryContent").text("要約の取得でエラーが発生しました。");
    }
}
function buildSummaryPrompt(items) {
    const lines = items.map(x => {
        const ts = new Date(x.createdAt).toLocaleString("ja-JP");
        const tags = (x.tags || []).join("/");
        return `• [${x.dorm}](${x.type}) ${x.title || "（無題）"} / ${tags || "no-tags"} / ${ts}\n  ${x.content?.slice(0, 140) || ""}`;
    }).join("\n");
    return `以下は寮生掲示板の直近投稿です。寮別（神楽坂寮・高島平寮・木場寮）とカテゴリ（譲ります/雑談）ごとに、日本語で簡潔に要約してください。本文にある情報のみを使い、5〜10行の箇条書きでまとめてください。
==== 投稿一覧 ====
${lines}
`;
}
async function callGemini(prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
    const body = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) { console.warn("Gemini error:", res.status, await res.text()); return ""; }
    const data = await res.json();
    return (data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
}
async function getRecentForSummary(limit) {
    const snap = await db.ref("threads").orderByChild("updatedAt").limitToLast(limit).get();
    const val = snap.val() || {};
    const arr = Object.values(val).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const results = [];
    for (const t of arr) {
        const postsSnap = await db.ref(`threads/${t.id}/posts`).orderByChild("createdAt").limitToFirst(1).get();
        const posts = postsSnap.val() || {};
        const first = Object.values(posts)[0] || {};
        results.push({ type: t.type, dorm: t.dorm, title: t.title, tags: t.tags || [], createdAt: t.createdAt || t.updatedAt, content: first.content || "" });
    }
    return results;
}

// ====== 10) 小道具 ======
function debounce(fn, ms) { let h; return function (...a) { clearTimeout(h); h = setTimeout(() => fn.apply(this, a), ms); }; }
