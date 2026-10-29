"use strict";

const STORAGE_KEY = "sela.ideas.v1";
const ONBOARDING_KEY = "sela.onboarding.completed.v1";
const AUTH_STORAGE_KEY = "sela.auth.session.v1";
const SUPABASE = window.SELA_SUPABASE || { url: "", publishableKey: "" };
const SUPABASE_URL = typeof SUPABASE.url === "string" ? SUPABASE.url.replace(/\/+$/, "") : "";
const SUPABASE_API_KEY = typeof SUPABASE.publishableKey === "string"
  ? SUPABASE.publishableKey.trim()
  : typeof SUPABASE.anonKey === "string" ? SUPABASE.anonKey.trim() : "";
const STATUSES = {
  inbox: "Baru masuk",
  thinking: "Lagi dipikirkan",
  saved: "Selesai dikembangkan",
};
const ideaGrid = document.querySelector("#idea-grid");
const statusMessage = document.querySelector("#status-message");
const dialog = document.querySelector("#idea-dialog");
let activeFilter = "all";
let searchQuery = "";
let ideas = loadIdeas();
let deferredInstallPrompt = null;
let splashTimer;
let cloudSession = null;
let usingCloudIdeas = false;
let isSignUpMode = false;
let recoveryAccessToken = "";

function isSupabaseConfigured() {
  if (!SUPABASE_URL || !SUPABASE_API_KEY) return false;
  try {
    const url = new URL(SUPABASE_URL);
    return url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch (error) {
    return false;
  }
}

function accountMessage(message, type) {
  const element = document.querySelector("#account-message");
  element.textContent = message;
  element.classList.toggle("is-error", type === "error");
  element.classList.toggle("is-success", type === "success");
}

function authErrorMessage(payload, status) {
  const message = payload && typeof payload === "object"
    ? payload.msg || payload.message || payload.error_description || payload.error
    : "";
  if (typeof message === "string" && message) return message;
  return `Permintaan ke Supabase gagal (HTTP ${status}).`;
}

async function supabaseRequest(path, options) {
  const requestOptions = options || {};
  const headers = {
    apikey: SUPABASE_API_KEY,
    Accept: "application/json",
    ...requestOptions.headers,
  };
  if (requestOptions.accessToken) {
    headers.Authorization = `Bearer ${requestOptions.accessToken}`;
  }
  if (requestOptions.body !== undefined) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${SUPABASE_URL}${path}`, {
      method: requestOptions.method || "GET",
      headers,
      body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body),
    });
  } catch (error) {
    throw new Error("Tidak bisa terhubung ke Supabase. Periksa koneksi internet dan pengaturan CORS proyek.");
  }

  const responseText = await response.text();
  let payload = null;
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch (error) {
      throw new Error(`Supabase mengirim respons yang tidak dapat dibaca (HTTP ${response.status}).`);
    }
  }
  if (!response.ok) {
    const error = new Error(authErrorMessage(payload, response.status));
    error.status = response.status;
    throw error;
  }
  return payload;
}

function loadAuthSession() {
  try {
    const stored = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) return null;
    const session = JSON.parse(stored);
    if (!session || typeof session.access_token !== "string" || typeof session.refresh_token !== "string"
      || !session.user || typeof session.user.id !== "string") {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
    return session;
  } catch (error) {
    console.error("Sela auth session could not be read.", error);
    return null;
  }
}

function storeAuthSession(session) {
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    cloudSession = session;
    return true;
  } catch (error) {
    accountMessage("Sesi akun tidak bisa disimpan di browser ini. Periksa izin penyimpanan lalu coba lagi.", "error");
    return false;
  }
}

function clearAuthSession() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (error) {
    console.error("Sela auth session could not be cleared.", error);
  }
  cloudSession = null;
  usingCloudIdeas = false;
}

async function getValidAccessToken() {
  if (!cloudSession) cloudSession = loadAuthSession();
  if (!cloudSession) throw new Error("Sesi akun sudah berakhir. Silakan masuk kembali.");

  const expiresAt = Number(cloudSession.expires_at || 0);
  if (expiresAt > Math.floor(Date.now() / 1000) + 60) return cloudSession.access_token;

  const refreshed = await supabaseRequest("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: { refresh_token: cloudSession.refresh_token },
  });
  if (!refreshed || typeof refreshed.access_token !== "string" || typeof refreshed.refresh_token !== "string") {
    clearAuthSession();
    throw new Error("Sesi tidak dapat diperbarui. Silakan masuk kembali.");
  }
  const nextSession = {
    ...refreshed,
    expires_at: Math.floor(Date.now() / 1000) + Number(refreshed.expires_in || 3600),
  };
  if (!storeAuthSession(nextSession)) throw new Error("Sesi akun tidak tersimpan.");
  return nextSession.access_token;
}

function toIdeaRecord(idea, userId) {
  return {
    id: idea.id,
    user_id: userId,
    title: idea.title,
    note: idea.note,
    category: idea.category,
    status: idea.status,
    problem: idea.problem,
    audience: idea.audience,
    next_step: idea.nextStep,
    created_at: idea.createdAt,
  };
}

function fromIdeaRecord(record) {
  return {
    id: record.id,
    title: record.title,
    note: record.note,
    category: record.category,
    status: record.status,
    problem: record.problem,
    audience: record.audience,
    nextStep: record.next_step,
    createdAt: record.created_at,
  };
}

async function fetchCloudIdeas() {
  const accessToken = await getValidAccessToken();
  const records = await supabaseRequest(
    "/rest/v1/ideas?select=id,title,note,category,status,problem,audience,next_step,created_at&order=created_at.desc",
    { accessToken },
  );
  if (!Array.isArray(records) || !records.every(isValidIdeaRecord)) {
    throw new Error("Data ide dari database tidak sesuai format. Data lokal tetap aman.");
  }
  return records.map(fromIdeaRecord);
}

function isValidIdeaRecord(record) {
  return record !== null
    && typeof record === "object"
    && typeof record.id === "string"
    && typeof record.title === "string"
    && typeof record.note === "string"
    && typeof record.category === "string"
    && ["inbox", "thinking", "saved"].includes(record.status)
    && typeof record.problem === "string"
    && typeof record.audience === "string"
    && typeof record.next_step === "string"
    && typeof record.created_at === "string";
}

function sameIdea(first, second) {
  return first.title === second.title
    && first.note === second.note
    && first.category === second.category
    && first.status === second.status
    && first.problem === second.problem
    && first.audience === second.audience
    && first.nextStep === second.nextStep
    && first.createdAt === second.createdAt;
}

async function persistCloudChanges(previousIdeas, nextIdeas) {
  const accessToken = await getValidAccessToken();
  const previousById = new Map(previousIdeas.map((idea) => [idea.id, idea]));
  const nextById = new Map(nextIdeas.map((idea) => [idea.id, idea]));
  const changedIdeas = nextIdeas.filter((idea) => {
    const previous = previousById.get(idea.id);
    return !previous || !sameIdea(previous, idea);
  });

  if (changedIdeas.length > 0) {
    await supabaseRequest("/rest/v1/ideas?on_conflict=id", {
      method: "POST",
      accessToken,
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: changedIdeas.map((idea) => toIdeaRecord(idea, cloudSession.user.id)),
    });
  }

  const deletedIds = previousIdeas
    .filter((idea) => !nextById.has(idea.id))
    .map((idea) => idea.id);
  for (const id of deletedIds) {
    await supabaseRequest(`/rest/v1/ideas?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      accessToken,
      headers: { Prefer: "return=minimal" },
    });
  }
}

function localIdeasForImport() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === null) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed) || !parsed.every(isValidIdea)) {
      throw new Error("Ide lokal tidak valid. Data lokal tidak diubah atau diunggah.");
    }
    return parsed;
  } catch (error) {
    throw new Error(error instanceof SyntaxError
      ? "Ide lokal tidak bisa dibaca. Data lokal tidak diubah atau diunggah."
      : error.message);
  }
}

async function importLocalIdeas() {
  const localIdeas = localIdeasForImport();
  if (localIdeas.length === 0) {
    accountMessage("Tidak ada ide tersimpan di browser ini untuk digabung.", "success");
    return;
  }
  const alreadySyncedIds = new Set(ideas.map((idea) => idea.id));
  const newLocalIdeas = localIdeas.filter((idea) => !alreadySyncedIds.has(idea.id));
  if (newLocalIdeas.length === 0) {
    accountMessage("Semua ide lokal sudah ada di akun. Tidak ada perubahan yang dibuat.", "success");
    updateAccountUI();
    return;
  }
  const accessToken = await getValidAccessToken();
  await supabaseRequest("/rest/v1/ideas?on_conflict=id", {
    method: "POST",
    accessToken,
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: newLocalIdeas.map((idea) => toIdeaRecord({
      ...idea,
      id: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idea.id)
        ? idea.id
        : makeId(),
    }, cloudSession.user.id)),
  });
  ideas = await fetchCloudIdeas();
  usingCloudIdeas = true;
  updateAccountUI();
  render();
  accountMessage(`${newLocalIdeas.length} ide lokal baru berhasil digabung ke akun. Ide akun yang sudah ada tidak ditimpa.`, "success");
}

function updateAccountUI() {
  const signedIn = Boolean(cloudSession && cloudSession.user);
  const trigger = document.querySelector("#account-trigger");
  const badge = document.querySelector("#privacy-badge");
  trigger.textContent = signedIn ? "Akun" : "Masuk / sinkronisasi";
  trigger.setAttribute("aria-label", signedIn ? "Pengaturan akun dan sinkronisasi" : "Masuk atau buat akun untuk sinkronisasi");
  badge.innerHTML = signedIn
    ? '<span aria-hidden="true">●</span> Tersinkron'
    : '<span aria-hidden="true">●</span> Tersimpan lokal';
  document.querySelector("#auth-form").hidden = signedIn || Boolean(recoveryAccessToken);
  document.querySelector("#recovery-form").hidden = !recoveryAccessToken;
  document.querySelector("#signed-in-panel").hidden = !signedIn || Boolean(recoveryAccessToken);
  document.querySelector("#account-description").hidden = signedIn && !recoveryAccessToken;

  if (signedIn) {
    document.querySelector("#signed-in-email").textContent = cloudSession.user.email || "Akun Sela";
    const migrationCard = document.querySelector("#migration-card");
    const importButton = document.querySelector("#import-local-ideas");
    try {
      const localIdeas = localIdeasForImport();
      const cloudIdeaIds = new Set(ideas.map((idea) => idea.id));
      const pendingIdeas = localIdeas.filter((idea) => !cloudIdeaIds.has(idea.id));
      migrationCard.hidden = pendingIdeas.length === 0;
      importButton.disabled = false;
      document.querySelector("#migration-description").textContent =
        `Ada ${pendingIdeas.length} ide lokal yang belum ada di akun cloud. Ide akun yang sudah ada tidak akan ditimpa.`;
    } catch (error) {
      migrationCard.hidden = false;
      importButton.disabled = true;
      document.querySelector("#migration-description").textContent = error.message;
    }
  }
}

function sessionFromResponse(response) {
  if (!response || typeof response.access_token !== "string"
    || typeof response.refresh_token !== "string" || !response.user
    || typeof response.user.id !== "string") {
    throw new Error("Supabase tidak mengirim sesi akun yang lengkap.");
  }
  return {
    ...response,
    expires_at: Math.floor(Date.now() / 1000) + Number(response.expires_in || 3600),
  };
}

async function activateCloudSession(session) {
  if (!storeAuthSession(session)) throw new Error("Sesi akun tidak tersimpan.");
  try {
    const cloudIdeas = await fetchCloudIdeas();
    cloudSession = session;
    ideas = cloudIdeas;
    usingCloudIdeas = true;
    updateAccountUI();
    render();
  } catch (error) {
    cloudSession = null;
    usingCloudIdeas = false;
    updateAccountUI();
    throw error;
  }
}

async function restoreCloudSession() {
  if (!isSupabaseConfigured()) return;
  const savedSession = loadAuthSession();
  if (!savedSession) return;
  cloudSession = savedSession;
  try {
    const cloudIdeas = await fetchCloudIdeas();
    ideas = cloudIdeas;
    usingCloudIdeas = true;
    updateAccountUI();
    render();
  } catch (error) {
    if (error.status === 400 || error.status === 401) {
      clearAuthSession();
    } else {
      cloudSession = null;
      usingCloudIdeas = false;
    }
    ideas = loadIdeas();
    updateAccountUI();
    render();
    showStatus(`Sinkronisasi akun tidak berhasil; ide lokal tetap digunakan. ${error.message}`);
  }
}

async function submitAuth(event) {
  event.preventDefault();
  if (!isSupabaseConfigured()) {
    accountMessage("Supabase belum dikonfigurasi. Isi URL proyek dan publishable/anon key di supabase-config.js, lalu deploy ulang.", "error");
    return;
  }

  const email = document.querySelector("#auth-email").value.trim();
  const password = document.querySelector("#auth-password").value;
  const submitButton = document.querySelector("#auth-submit");
  submitButton.disabled = true;
  accountMessage(isSignUpMode ? "Membuat akun..." : "Memeriksa akun...", "");
  try {
    const response = await supabaseRequest(
      isSignUpMode ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password",
      { method: "POST", body: { email, password } },
    );
    if (!response || typeof response.access_token !== "string") {
      if (isSignUpMode) {
        isSignUpMode = false;
        updateAuthMode();
        accountMessage("Akun dibuat. Periksa email untuk verifikasi, lalu masuk setelah email dikonfirmasi.", "success");
        return;
      }
      throw new Error("Login berhasil diproses tetapi sesi tidak diterima. Periksa pengaturan autentikasi Supabase.");
    }
    await activateCloudSession(sessionFromResponse(response));
    document.querySelector("#auth-form").reset();
    accountMessage("Berhasil masuk. Ide akunmu sekarang tersinkron.", "success");
  } catch (error) {
    accountMessage(error.message, "error");
  } finally {
    submitButton.disabled = false;
  }
}

function updateAuthMode() {
  document.querySelector("#auth-submit").textContent = isSignUpMode ? "Buat akun" : "Masuk";
  document.querySelector("#toggle-auth-mode").textContent = isSignUpMode
    ? "Sudah punya akun? Masuk"
    : "Belum punya akun? Daftar";
  document.querySelector("#auth-password").autocomplete = isSignUpMode ? "new-password" : "current-password";
  document.querySelector("#reset-password").hidden = isSignUpMode;
}

async function requestPasswordReset() {
  if (!isSupabaseConfigured()) {
    accountMessage("Supabase belum dikonfigurasi. Isi URL proyek dan publishable/anon key di supabase-config.js, lalu deploy ulang.", "error");
    return;
  }
  const email = document.querySelector("#auth-email").value.trim();
  if (!email) {
    document.querySelector("#auth-email").focus();
    accountMessage("Masukkan email akun terlebih dahulu.", "error");
    return;
  }
  try {
    const redirectTo = encodeURIComponent(window.location.href.split("#")[0]);
    await supabaseRequest(`/auth/v1/recover?redirect_to=${redirectTo}`, {
      method: "POST",
      body: { email },
    });
    accountMessage("Jika email terdaftar, tautan untuk mengatur ulang password akan dikirim.", "success");
  } catch (error) {
    accountMessage(error.message, "error");
  }
}

function startPasswordRecovery() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  if (hash.get("type") !== "recovery") return;
  recoveryAccessToken = hash.get("access_token") || "";
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  if (!document.querySelector("#onboarding-overlay").hidden) finishOnboarding();
  updateAccountUI();
  accountDialog.showModal();
  if (recoveryAccessToken) {
    accountMessage("Masukkan password baru untuk akunmu.", "");
  } else {
    accountMessage("Tautan pemulihan tidak lengkap. Minta tautan baru melalui menu lupa password.", "error");
  }
}

async function submitPasswordRecovery(event) {
  event.preventDefault();
  if (!recoveryAccessToken) {
    accountMessage("Tautan pemulihan tidak tersedia. Minta tautan baru melalui menu lupa password.", "error");
    return;
  }
  const password = document.querySelector("#recovery-password").value;
  const confirmation = document.querySelector("#recovery-password-confirm").value;
  if (password !== confirmation) {
    accountMessage("Kedua password belum sama.", "error");
    document.querySelector("#recovery-password-confirm").focus();
    return;
  }
  const button = document.querySelector("#recovery-submit");
  button.disabled = true;
  try {
    await supabaseRequest("/auth/v1/user", {
      method: "PUT",
      accessToken: recoveryAccessToken,
      body: { password },
    });
    recoveryAccessToken = "";
    document.querySelector("#recovery-form").reset();
    updateAccountUI();
    accountMessage("Password berhasil diperbarui. Silakan masuk dengan password baru.", "success");
  } catch (error) {
    accountMessage(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

async function signOut() {
  let remoteError = null;
  if (cloudSession && isSupabaseConfigured()) {
    try {
      const accessToken = await getValidAccessToken();
      await supabaseRequest("/auth/v1/logout", { method: "POST", accessToken });
    } catch (error) {
      remoteError = error;
    }
  }
  clearAuthSession();
  ideas = loadIdeas();
  updateAccountUI();
  render();
  accountMessage(remoteError
    ? `Keluar di perangkat ini berhasil, tetapi Supabase tidak dapat mengakhiri sesi di server: ${remoteError.message}`
    : "Kamu sudah keluar. Ide di perangkat ini tetap tersimpan lokal.",
  remoteError ? "error" : "success");
}

function showStatus(message) {
  statusMessage.textContent = message;
}

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.random() * 16 | 0;
    return (character === "x" ? random : (random & 3 | 8)).toString(16);
  });
}

function sampleIdeas() {
  const now = Date.now();
  return [
    {
      id: makeId(),
      title: "Bikin daftar tempat tenang buat kerja dari luar",
      note: "Kafe yang colokannya enak, tidak terlalu ramai, dan harganya masuk akal.",
      category: "Personal",
      status: "thinking",
      problem: "Susah cari tempat nyaman untuk fokus tanpa harus coba satu-satu.",
      audience: "Aku dan teman-teman yang kerja remote.",
      nextStep: "",
      createdAt: new Date(now - 3600000 * 3).toISOString(),
    },
    {
      id: makeId(),
      title: "Bikin rangkuman buku dari catatan yang ditandai",
      note: "Kadang selesai baca buku, catatan pentingnya tercecer di banyak tempat.",
      category: "Belajar",
      status: "inbox",
      problem: "",
      audience: "",
      nextStep: "",
      createdAt: new Date(now - 86400000).toISOString(),
    },
    {
      id: makeId(),
      title: "Konten pendek: hal kecil yang bikin hari lebih ringan",
      note: "Mungkin formatnya satu hal sederhana per hari, tidak perlu selalu produktif.",
      category: "Kreatif",
      status: "saved",
      problem: "Banyak konten terasa menuntut orang untuk selalu maksimal.",
      audience: "Orang yang sedang butuh pengingat kecil yang realistis.",
      nextStep: "Coba tulis lima topik untuk minggu pertama.",
      createdAt: new Date(now - 86400000 * 3).toISOString(),
    },
  ];
}

function isValidIdea(idea) {
  return idea !== null
    && typeof idea === "object"
    && typeof idea.id === "string"
    && typeof idea.title === "string"
    && typeof idea.note === "string"
    && typeof idea.category === "string"
    && ["inbox", "thinking", "saved"].includes(idea.status)
    && typeof idea.problem === "string"
    && typeof idea.audience === "string"
    && typeof idea.nextStep === "string"
    && typeof idea.createdAt === "string";
}

function loadIdeas() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return sampleIdeas();
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed) || !parsed.every(isValidIdea)) {
      showStatus("Data ide yang tersimpan tidak valid. Data belum diubah.");
      return [];
    }
    return parsed;
  } catch (error) {
    showStatus("Data tidak dapat dibaca dari penyimpanan browser. Periksa izin penyimpanan lalu muat ulang.");
    return sampleIdeas();
  }
}

async function saveIdeas(nextIdeas, message) {
  if (cloudSession && usingCloudIdeas) {
    try {
      await persistCloudChanges(ideas, nextIdeas);
    } catch (error) {
      showStatus(`Perubahan belum tersinkron: ${error.message}`);
      return false;
    }
    ideas = nextIdeas;
    showStatus(message);
    render();
    return true;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextIdeas));
  } catch (error) {
    showStatus("Perubahan belum tersimpan. Periksa ruang penyimpanan atau izin browser, lalu coba lagi.");
    return false;
  }
  ideas = nextIdeas;
  showStatus(message);
  render();
  return true;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Tanggal tidak diketahui";
  const now = new Date();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((startOfToday - startOfDate) / 86400000);
  if (days === 0) return "Hari ini";
  if (days === 1) return "Kemarin";
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(date);
}

function visibleIdeas() {
  return ideas
    .filter((idea) => {
      if (activeFilter !== "all" && idea.status !== activeFilter) return false;
      if (!searchQuery) return true;
      return `${idea.title} ${idea.note} ${idea.category} ${idea.problem} ${idea.audience} ${idea.nextStep}`
        .toLocaleLowerCase("id-ID")
        .includes(searchQuery);
    })
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt));
}

function ideaMarkup(idea) {
  const note = idea.note || idea.problem || "Belum ada catatan tambahan—bisa kamu lengkapi nanti.";
  const promptAnswers = [idea.problem, idea.audience, idea.nextStep].filter(Boolean).length;
  return `
    <article class="idea-card" data-open-id="${escapeHtml(idea.id)}" tabindex="0" role="button" aria-label="Buka ide: ${escapeHtml(idea.title)}">
      <div class="idea-card-top">
        <span class="category-chip ${escapeHtml(idea.category)}">${escapeHtml(idea.category)}</span>
        <span class="idea-date">${formatDate(idea.createdAt)}</span>
        <span class="idea-status ${idea.status}">${STATUSES[idea.status]}</span>
      </div>
      <h3 class="idea-title">${escapeHtml(idea.title)}</h3>
      <p class="idea-note">${escapeHtml(note)}</p>
      <div class="idea-card-bottom">
        <span>${promptAnswers ? `${promptAnswers} dari 3 pertanyaan terisi` : "Pikiran awal tersimpan"}</span>
        <span class="develop-link">Buka ide →</span>
      </div>
    </article>`;
}

function render() {
  const visible = visibleIdeas();
  document.querySelector("#idea-count").textContent = String(ideas.length);
  document.querySelector("#visible-count").textContent = `${visible.length} ide`;
  if (visible.length === 0) {
    const hasIdeas = ideas.length > 0;
    ideaGrid.innerHTML = `
      <div class="empty-state">
        <span class="empty-state-mark" aria-hidden="true">${hasIdeas ? "⌕" : "✳"}</span>
        <strong>${hasIdeas ? "Belum ada ide yang cocok" : "Ruang ini masih kosong"}</strong>
        <p>${hasIdeas ? "Coba kata kunci atau filter yang lain." : "Tulis satu hal yang sedang kepikiran di kotak atas."}</p>
      </div>`;
  } else {
    ideaGrid.innerHTML = visible.map(ideaMarkup).join("");
  }
}

function openIdea(id) {
  const idea = ideas.find((item) => item.id === id);
  if (!idea) return;
  document.querySelector("#detail-id").value = idea.id;
  document.querySelector("#detail-idea-title").value = idea.title;
  document.querySelector("#detail-status").value = idea.status;
  document.querySelector("#detail-note").value = idea.note;
  document.querySelector("#detail-problem").value = idea.problem;
  document.querySelector("#detail-audience").value = idea.audience;
  document.querySelector("#detail-next").value = idea.nextStep;
  dialog.showModal();
  document.querySelector("#detail-idea-title").focus();
}

document.querySelector("#quick-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const titleField = document.querySelector("#quick-title");
  const title = titleField.value.trim();
  if (!title) {
    titleField.focus();
    return;
  }
  const idea = {
    id: makeId(),
    title,
    note: document.querySelector("#quick-note").value.trim(),
    category: document.querySelector("#quick-category").value,
    status: "inbox",
    problem: "",
    audience: "",
    nextStep: "",
    createdAt: new Date().toISOString(),
  };
  const submitButton = form.querySelector('[type="submit"]');
  submitButton.disabled = true;
  const saved = await saveIdeas([idea, ...ideas], cloudSession && usingCloudIdeas
    ? "Ide tersimpan dan tersinkron."
    : "Ide tersimpan. Kamu bisa memikirkannya lagi kapan saja.");
  submitButton.disabled = false;
  if (saved) {
    form.reset();
    titleField.focus();
  }
});

document.querySelector("#detail-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = document.querySelector("#detail-id").value;
  const title = document.querySelector("#detail-idea-title").value.trim();
  if (!title) return;
  const oldIdea = ideas.find((idea) => idea.id === id);
  if (!oldIdea) return;
  const problem = document.querySelector("#detail-problem").value.trim();
  const audience = document.querySelector("#detail-audience").value.trim();
  const nextStep = document.querySelector("#detail-next").value.trim();
  const nextIdea = {
    ...oldIdea,
    title,
    status: document.querySelector("#detail-status").value,
    note: document.querySelector("#detail-note").value.trim(),
    problem,
    audience,
    nextStep,
  };
  const submitButton = event.currentTarget.querySelector('[type="submit"]');
  submitButton.disabled = true;
  const saved = await saveIdeas(ideas.map((idea) => idea.id === id ? nextIdea : idea),
    cloudSession && usingCloudIdeas ? "Perkembangan ide berhasil disinkronkan." : "Perkembangan ide berhasil disimpan.");
  submitButton.disabled = false;
  if (saved) {
    dialog.close();
  }
});

function closeDialog() {
  dialog.close();
}

document.querySelector("#close-dialog").addEventListener("click", closeDialog);
document.querySelector("#cancel-detail").addEventListener("click", closeDialog);
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) closeDialog();
});

document.querySelector("#delete-idea").addEventListener("click", async (event) => {
  const id = document.querySelector("#detail-id").value;
  const button = event.currentTarget;
  button.disabled = true;
  const saved = await saveIdeas(ideas.filter((idea) => idea.id !== id),
    cloudSession && usingCloudIdeas ? "Ide dihapus dari akun." : "Ide berhasil dihapus.");
  button.disabled = false;
  if (saved) closeDialog();
});

ideaGrid.addEventListener("click", (event) => {
  const card = event.target.closest("[data-open-id]");
  if (card) openIdea(card.dataset.openId);
});
ideaGrid.addEventListener("keydown", (event) => {
  const card = event.target.closest("[data-open-id]");
  if (card && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    openIdea(card.dataset.openId);
  }
});

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((filter) => {
      const selected = filter === button;
      filter.classList.toggle("active", selected);
      filter.setAttribute("aria-pressed", String(selected));
    });
    render();
  });
});

document.querySelector("#idea-search").addEventListener("input", (event) => {
  searchQuery = event.currentTarget.value.trim().toLocaleLowerCase("id-ID");
  render();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !document.querySelector("#onboarding-overlay").hidden) {
    finishOnboarding();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !dialog.open) {
    event.preventDefault();
    document.querySelector("#quick-form").requestSubmit();
  }
});

function getInstallInstructions() {
  const userAgent = navigator.userAgent;
  const isAppleMobile = /iPad|iPhone|iPod/.test(userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isAppleMobile) {
    return {
      title: "Tambahkan lewat Safari",
      steps: [
        "Buka Sela di Safari, bukan di browser dalam aplikasi lain.",
        "Ketuk tombol Bagikan (ikon kotak dengan panah ke atas).",
        "Pilih “Tambahkan ke Layar Utama”, lalu ketuk “Tambah”.",
      ],
    };
  }
  if (/Android/i.test(userAgent)) {
    return {
      title: "Tambahkan lewat browser",
      steps: [
        "Buka Sela di Chrome, lalu ketuk menu ⋮ di kanan atas.",
        "Pilih “Tambahkan ke layar utama” atau “Install app”.",
        "Konfirmasi dengan mengetuk “Tambah” atau “Install”.",
      ],
    };
  }
  const isSafari = /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|Edg/i.test(userAgent);
  if (isSafari && /Macintosh|Mac OS/i.test(userAgent)) {
    return {
      title: "Tambahkan lewat Safari",
      steps: [
        "Buka Sela di Safari pada Mac.",
        "Pilih menu File di bar menu atas.",
        "Pilih “Add to Dock”, lalu konfirmasi.",
      ],
    };
  }
  return {
    title: "Tambahkan lewat browser",
    steps: [
      "Buka Sela di Chrome atau Edge.",
      "Pilih ikon Install di bilah alamat, atau buka menu browser.",
      "Pilih “Install Sela” / “Install page as app”, lalu konfirmasi.",
    ],
  };
}

function renderInstallGuide() {
  const instructions = getInstallInstructions();
  const isServedSecurely = window.location.protocol === "https:"
    || window.location.hostname === "localhost"
    || window.location.hostname === "127.0.0.1";
  document.querySelector("#install-instructions-title").textContent = isServedSecurely
    ? instructions.title
    : "Setelah Sela tersedia online";
  document.querySelector("#install-instructions-list").innerHTML = instructions.steps
    .map((step) => `<li>${escapeHtml(step)}</li>`)
    .join("");

  document.querySelector("#install-requirement").hidden = isServedSecurely;
  document.querySelector("#install-app").hidden = !deferredInstallPrompt;
}

function finishOnboarding() {
  try {
    localStorage.setItem(ONBOARDING_KEY, "true");
  } catch (error) {
    console.error("Sela onboarding preference could not be saved.", error);
    document.querySelector("#install-feedback").textContent =
      "Preferensi tidak dapat disimpan. Panduan mungkin muncul kembali saat halaman dibuka.";
  }
  window.clearTimeout(splashTimer);
  document.querySelector("#onboarding-overlay").hidden = true;
  document.body.classList.remove("is-onboarding");
  document.querySelector(".app-shell").inert = false;
}

function showInstallGuide() {
  window.clearTimeout(splashTimer);
  document.querySelector("#splash-screen").hidden = true;
  document.querySelector("#onboarding-guide").hidden = false;
  document.querySelector("#onboarding-overlay").hidden = false;
  document.body.classList.add("is-onboarding");
  document.querySelector(".app-shell").inert = true;
  renderInstallGuide();
  document.querySelector("#continue-to-app").focus();
}

function promptInstall() {
  const installPrompt = deferredInstallPrompt;
  if (!installPrompt) {
    showInstallGuide();
    return;
  }
  deferredInstallPrompt = null;
  document.querySelector("#install-app").hidden = true;
  installPrompt.prompt()
    .then(() => installPrompt.userChoice)
    .then((choice) => {
      if (choice.outcome === "accepted") {
        finishOnboarding();
        return;
      }
      document.querySelector("#install-feedback").textContent =
        "Tidak apa-apa—kamu bisa memasang Sela nanti dari menu browser.";
    })
    .catch((error) => {
      console.error("Sela install prompt could not be shown.", error);
      document.querySelector("#install-feedback").textContent =
        "Browser belum bisa membuka dialog pemasangan. Ikuti langkah manual di atas.";
    });
}

function startInstallExperience() {
  const overlay = document.querySelector("#onboarding-overlay");
  let onboardingCompleted = false;
  try {
    onboardingCompleted = localStorage.getItem(ONBOARDING_KEY) === "true";
  } catch (error) {
    console.error("Sela onboarding preference could not be read.", error);
  }

  const isInstalled = window.matchMedia("(display-mode: standalone)").matches
    || navigator.standalone === true;
  const forcePreview = new URLSearchParams(window.location.search).get("intro") === "1";
  if ((onboardingCompleted || isInstalled) && !forcePreview) {
    overlay.hidden = true;
    return;
  }

  document.body.classList.add("is-onboarding");
  document.querySelector(".app-shell").inert = true;
  renderInstallGuide();
  const splashDelay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 250 : 1100;
  splashTimer = window.setTimeout(showInstallGuide, splashDelay);
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  document.querySelector("#install-app").hidden = false;
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  document.querySelector("#install-app").hidden = true;
  finishOnboarding();
});

document.querySelector("#skip-splash").addEventListener("click", showInstallGuide);
document.querySelector("#close-onboarding").addEventListener("click", finishOnboarding);
document.querySelector("#continue-to-app").addEventListener("click", finishOnboarding);
document.querySelector("#install-app").addEventListener("click", promptInstall);
document.querySelector("#open-install-guide").addEventListener("click", showInstallGuide);

const accountDialog = document.querySelector("#account-dialog");
document.querySelector("#account-trigger").addEventListener("click", () => {
  updateAccountUI();
  accountDialog.showModal();
  if (!cloudSession && isSupabaseConfigured()) {
    accountMessage("Masuk atau buat akun untuk mulai menyinkronkan ide.", "");
  } else if (!isSupabaseConfigured()) {
    accountMessage("Akun cloud belum aktif. Pengaturan Supabase perlu dilengkapi terlebih dahulu.", "");
  }
});
document.querySelector("#close-account").addEventListener("click", () => accountDialog.close());
accountDialog.addEventListener("click", (event) => {
  if (event.target === accountDialog) accountDialog.close();
});
document.querySelector("#auth-form").addEventListener("submit", submitAuth);
document.querySelector("#recovery-form").addEventListener("submit", submitPasswordRecovery);
document.querySelector("#toggle-auth-mode").addEventListener("click", () => {
  isSignUpMode = !isSignUpMode;
  updateAuthMode();
  accountMessage("", "");
});
document.querySelector("#reset-password").addEventListener("click", requestPasswordReset);
document.querySelector("#import-local-ideas").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  accountMessage("Menggabungkan ide lokal...", "");
  try {
    await importLocalIdeas();
  } catch (error) {
    accountMessage(error.message, "error");
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#sign-out").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  await signOut();
  button.disabled = false;
});

if ("serviceWorker" in navigator
  && (window.location.protocol === "https:"
    || window.location.hostname === "localhost"
    || window.location.hostname === "127.0.0.1")) {
  navigator.serviceWorker.register("./sw.js")
    .catch((error) => {
      console.error("Sela service worker registration failed.", error);
      showStatus("Sela belum bisa menyiapkan akses offline. Muat ulang halaman untuk mencoba lagi.");
    });
}

startInstallExperience();
updateAuthMode();
updateAccountUI();
render();
startPasswordRecovery();
restoreCloudSession();
