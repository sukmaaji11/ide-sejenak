"use strict";

const STORAGE_KEY = "sela.ideas.v1";
const ONBOARDING_KEY = "sela.onboarding.completed.v1";
const AUTH_STORAGE_KEY = "sela.auth.session.v1";
const SUPABASE = window.SELA_SUPABASE || { url: "", publishableKey: "" };
const SUPPORT_WHATSAPP = typeof SUPABASE.supportWhatsApp === "string"
  ? SUPABASE.supportWhatsApp.replace(/\D/g, "")
  : "";
const SUPABASE_URL = typeof SUPABASE.url === "string" ? SUPABASE.url.replace(/\/+$/, "") : "";
const SUPABASE_API_KEY = typeof SUPABASE.publishableKey === "string"
  ? SUPABASE.publishableKey.trim()
  : typeof SUPABASE.anonKey === "string" ? SUPABASE.anonKey.trim() : "";
const STATUSES = {
  inbox: "Baru masuk",
  thinking: "Lagi dipikirkan",
  saved: "Selesai dikembangkan",
};
const PRIORITIES = {
  do_now: "Kerjakan sekarang",
  schedule: "Jadwalkan",
  delegate: "Delegasikan",
  release: "Kurangi atau lepaskan",
};
const ideaGrid = document.querySelector("#idea-grid");
const statusMessage = document.querySelector("#status-message");
const dialog = document.querySelector("#idea-dialog");
let activeFilter = "all";
let activePriorityFilter = "all";
let searchQuery = "";
let titleBeforePrint = "";
let reopenDialogAfterPrint = false;
let ideas = loadIdeas();
let deferredInstallPrompt = null;
let splashTimer;
let cloudSession = null;
let usingCloudIdeas = false;
let hasPlusLicense = null;
let licenseCheckError = "";
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
  hasPlusLicense = null;
  licenseCheckError = "";
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
    priority: idea.priority,
    action_completed: idea.actionCompleted,
    blueprint: idea.blueprint,
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
    priority: record.priority,
    actionCompleted: record.action_completed,
    blueprint: record.blueprint,
    createdAt: record.created_at,
  };
}

async function fetchCloudIdeas() {
  const accessToken = await getValidAccessToken();
  const records = await supabaseRequest(
    "/rest/v1/ideas?select=id,title,note,category,status,problem,audience,next_step,priority,action_completed,blueprint,created_at&order=created_at.desc",
    { accessToken },
  );
  if (!Array.isArray(records) || !records.every(isValidIdeaRecord)) {
    throw new Error("Data ide dari database tidak sesuai format. Data lokal tetap aman.");
  }
  return records.map(fromIdeaRecord);
}

async function fetchPlusLicense() {
  const accessToken = await getValidAccessToken();
  const result = await supabaseRequest("/rest/v1/rpc/has_sela_plus_lifetime", {
    method: "POST",
    accessToken,
    body: {},
  });
  if (typeof result !== "boolean") {
    throw new Error("Status lisensi dari server tidak valid.");
  }
  return result;
}

async function redeemPlusLicenseCode(event) {
  event.preventDefault();
  const codeInput = document.querySelector("#license-code");
  const button = document.querySelector("#redeem-license");
  button.disabled = true;
  accountMessage("Memeriksa kode lisensi...", "");
  try {
    const accessToken = await getValidAccessToken();
    const result = await supabaseRequest("/functions/v1/redeem-license", {
      method: "POST",
      accessToken,
      body: { code: codeInput.value.trim() },
    });
    if (!result || result.activated !== true) {
      throw new Error("Server belum mengonfirmasi aktivasi lisensi.");
    }

    hasPlusLicense = await fetchPlusLicense();
    if (!hasPlusLicense) {
      throw new Error("Kode diterima, tetapi status lisensi belum aktif. Hubungi admin sebelum mencoba lagi.");
    }
    ideas = await fetchCloudIdeas();
    usingCloudIdeas = true;
    licenseCheckError = "";
    document.querySelector("#license-code-form").reset();
    updateAccountUI();
    render();
    accountMessage("Sela Plus Lifetime berhasil diaktifkan. Ide akun sekarang tersinkron.", "success");
  } catch (error) {
    accountMessage(error.message, "error");
  } finally {
    button.disabled = false;
  }
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
    && (record.priority === null || Object.hasOwn(PRIORITIES, record.priority))
    && typeof record.action_completed === "boolean"
    && (record.blueprint === null || isValidBlueprint(record.blueprint))
    && typeof record.created_at === "string";
}

function isValidBlueprint(blueprint) {
  return blueprint !== null
    && typeof blueprint === "object"
    && typeof blueprint.refinedIdea === "string"
    && blueprint.refinedIdea.length <= 600
    && typeof blueprint.problem === "string"
    && blueprint.problem.length <= 500
    && typeof blueprint.audience === "string"
    && blueprint.audience.length <= 300
    && Array.isArray(blueprint.assumptions)
    && blueprint.assumptions.length <= 4
    && blueprint.assumptions.every((item) => typeof item === "string" && item.length <= 240)
    && Array.isArray(blueprint.firstSteps)
    && blueprint.firstSteps.length <= 4
    && blueprint.firstSteps.every((item) => typeof item === "string" && item.length <= 240)
    && Array.isArray(blueprint.validationQuestions)
    && blueprint.validationQuestions.length <= 4
    && blueprint.validationQuestions.every((item) => typeof item === "string" && item.length <= 240)
    && typeof blueprint.updatedAt === "string";
}

function sameIdea(first, second) {
  return first.title === second.title
    && first.note === second.note
    && first.category === second.category
    && first.status === second.status
    && first.problem === second.problem
    && first.audience === second.audience
    && first.nextStep === second.nextStep
    && first.priority === second.priority
    && first.actionCompleted === second.actionCompleted
    && JSON.stringify(first.blueprint) === JSON.stringify(second.blueprint)
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
    return parsed.map(normalizeIdea);
  } catch (error) {
    throw new Error(error instanceof SyntaxError
      ? "Ide lokal tidak bisa dibaca. Data lokal tidak diubah atau diunggah."
      : error.message);
  }
}

async function importLocalIdeas() {
  if (!hasPlusLicense || !usingCloudIdeas) {
    throw new Error("Lisensi Sela Plus Lifetime aktif diperlukan untuk menggabungkan ide ke cloud.");
  }
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
    ? usingCloudIdeas
      ? '<span aria-hidden="true">●</span> Tersinkron'
      : '<span aria-hidden="true">●</span> Cloud dikunci'
    : '<span aria-hidden="true">●</span> Tersimpan lokal';
  document.querySelector("#auth-form").hidden = signedIn || Boolean(recoveryAccessToken);
  document.querySelector("#recovery-form").hidden = !recoveryAccessToken;
  document.querySelector("#signed-in-panel").hidden = !signedIn || Boolean(recoveryAccessToken);
  document.querySelector("#account-description").hidden = signedIn && !recoveryAccessToken;

  if (signedIn) {
    document.querySelector("#signed-in-email").textContent = cloudSession.user.email || "Akun Sela";
    const licenseCard = document.querySelector("#license-card");
    const licenseTitle = document.querySelector("#license-title");
    const licenseDescription = document.querySelector("#license-description");
    const checkLicenseButton = document.querySelector("#check-license");
    const contactAdminLink = document.querySelector("#contact-admin-whatsapp");
    const licenseCodeForm = document.querySelector("#license-code-form");
    document.querySelector("#cloud-note").hidden = !usingCloudIdeas;
    licenseCard.hidden = false;
    checkLicenseButton.hidden = hasPlusLicense === true;
    contactAdminLink.hidden = hasPlusLicense !== false || !/^[1-9]\d{7,14}$/.test(SUPPORT_WHATSAPP);
    if (!contactAdminLink.hidden) {
      const message = [
        "Halo Admin Sela, saya ingin membeli Sela Plus Lifetime.",
        `Email akun Sela saya: ${cloudSession.user.email || "(belum tercantum)"}`,
      ].join("\n");
      contactAdminLink.href = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(message)}`;
    }
    licenseCodeForm.hidden = hasPlusLicense !== false;
    if (hasPlusLicense === true) {
      licenseTitle.textContent = "Sela Plus Lifetime aktif";
      licenseDescription.textContent = "Akun ini dapat menyimpan dan menyinkronkan ide di cloud.";
    } else if (licenseCheckError) {
      licenseTitle.textContent = "Lisensi atau sinkronisasi bermasalah";
      licenseDescription.textContent = licenseCheckError;
    } else if (hasPlusLicense === false) {
      licenseTitle.textContent = "Lisensi Sela Plus Lifetime belum aktif";
      licenseDescription.textContent =
        "Ide tetap bisa digunakan secara lokal. Masukkan kode dari admin setelah pembelian untuk mengaktifkan sinkronisasi cloud.";
    } else {
      licenseTitle.textContent = "Memeriksa lisensi Sela Plus Lifetime";
      licenseDescription.textContent = "Akses cloud hanya tersedia untuk akun dengan lisensi aktif.";
    }

    const migrationCard = document.querySelector("#migration-card");
    const importButton = document.querySelector("#import-local-ideas");
    if (!usingCloudIdeas) {
      migrationCard.hidden = true;
      return;
    }
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
    cloudSession = session;
    licenseCheckError = "";
    hasPlusLicense = await fetchPlusLicense();
    if (!hasPlusLicense) {
      usingCloudIdeas = false;
      ideas = loadIdeas();
      updateAccountUI();
      render();
      return false;
    }

    const cloudIdeas = await fetchCloudIdeas();
    ideas = cloudIdeas;
    usingCloudIdeas = true;
    updateAccountUI();
    render();
    return true;
  } catch (error) {
    usingCloudIdeas = false;
    hasPlusLicense = null;
    licenseCheckError = error.message;
    ideas = loadIdeas();
    updateAccountUI();
    render();
    throw error;
  }
}

async function restoreCloudSession() {
  if (!isSupabaseConfigured()) return;
  const savedSession = loadAuthSession();
  if (!savedSession) return;
  cloudSession = savedSession;
  try {
    licenseCheckError = "";
    hasPlusLicense = await fetchPlusLicense();
    if (!hasPlusLicense) {
      usingCloudIdeas = false;
      ideas = loadIdeas();
      updateAccountUI();
      render();
      return;
    }

    const cloudIdeas = await fetchCloudIdeas();
    ideas = cloudIdeas;
    usingCloudIdeas = true;
    updateAccountUI();
    render();
  } catch (error) {
    if (error.status === 400 || error.status === 401) {
      clearAuthSession();
    } else {
      usingCloudIdeas = false;
      hasPlusLicense = null;
      licenseCheckError = error.message;
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
    const hasLicense = await activateCloudSession(sessionFromResponse(response));
    document.querySelector("#auth-form").reset();
    accountMessage(hasLicense
      ? "Berhasil masuk. Ide akunmu sekarang tersinkron."
      : "Berhasil masuk. Ide tetap tersimpan lokal; sinkronisasi cloud memerlukan lisensi Sela Plus Lifetime aktif.",
    hasLicense ? "success" : "");
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

async function checkPlusLicenseStatus() {
  const button = document.querySelector("#check-license");
  button.disabled = true;
  accountMessage("Memeriksa status lisensi...", "");
  try {
    licenseCheckError = "";
    hasPlusLicense = await fetchPlusLicense();
    if (hasPlusLicense) {
      ideas = await fetchCloudIdeas();
      usingCloudIdeas = true;
      accountMessage("Sela Plus Lifetime aktif. Ide akun berhasil disinkronkan.", "success");
    } else {
      usingCloudIdeas = false;
      ideas = loadIdeas();
      accountMessage("Lisensi Sela Plus Lifetime belum aktif untuk akun ini. Ide tetap tersimpan lokal.", "");
    }
    updateAccountUI();
    render();
  } catch (error) {
    hasPlusLicense = null;
    licenseCheckError = `Status lisensi gagal dimuat: ${error.message}`;
    usingCloudIdeas = false;
    ideas = loadIdeas();
    updateAccountUI();
    render();
    accountMessage(`Status lisensi gagal diperiksa: ${error.message}`, "error");
  } finally {
    button.disabled = false;
  }
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
      priority: null,
      actionCompleted: false,
      blueprint: null,
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
      priority: null,
      actionCompleted: false,
      blueprint: null,
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
      priority: "schedule",
      actionCompleted: false,
      blueprint: null,
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
    && (idea.priority === undefined || idea.priority === null || Object.hasOwn(PRIORITIES, idea.priority))
    && (idea.actionCompleted === undefined || typeof idea.actionCompleted === "boolean")
    && (idea.blueprint === undefined || idea.blueprint === null || isValidBlueprint(idea.blueprint))
    && typeof idea.createdAt === "string";
}

function normalizeIdea(idea) {
  return {
    ...idea,
    priority: idea.priority || null,
    actionCompleted: idea.actionCompleted === true,
    blueprint: idea.blueprint || null,
  };
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
    return parsed.map(normalizeIdea);
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
      if (activePriorityFilter === "unprioritized" && idea.priority) return false;
      if (activePriorityFilter !== "all" && activePriorityFilter !== "unprioritized"
        && idea.priority !== activePriorityFilter) return false;
      if (!searchQuery) return true;
      const blueprintText = idea.blueprint
        ? [
          idea.blueprint.refinedIdea,
          idea.blueprint.problem,
          idea.blueprint.audience,
          ...idea.blueprint.assumptions,
          ...idea.blueprint.firstSteps,
          ...idea.blueprint.validationQuestions,
        ].join(" ")
        : "";
      return `${idea.title} ${idea.note} ${idea.category} ${idea.problem} ${idea.audience} ${idea.nextStep} ${blueprintText}`
        .toLocaleLowerCase("id-ID")
        .includes(searchQuery);
    })
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt));
}

function ideaMarkup(idea) {
  const note = idea.note || idea.problem || "Belum ada catatan tambahan—bisa kamu lengkapi nanti.";
  const promptAnswers = [idea.problem, idea.audience, idea.nextStep].filter(Boolean).length;
  const progress = idea.nextStep
    ? idea.actionCompleted ? "Action selesai" : "Action belum selesai"
    : `${promptAnswers} dari 2 pertanyaan terisi`;
  const priority = idea.priority
    ? `<span class="idea-priority">${escapeHtml(PRIORITIES[idea.priority])}</span>`
    : "";
  const blueprint = idea.blueprint ? '<span class="blueprint-indicator">Blueprint siap</span>' : "";
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
        <span>${idea.nextStep && idea.actionCompleted ? "✓ " : ""}${progress}</span>
        ${priority}
        ${blueprint}
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

function updateBlueprintPrintMetadata() {
  const activeIdea = ideas.find((idea) => idea.id === document.querySelector("#detail-id").value);
  const priority = document.querySelector("#detail-priority").value;
  const action = document.querySelector("#detail-next").value.trim();
  const completed = document.querySelector("#detail-action-completed").checked;
  const metadata = [
    ["Kategori", activeIdea ? activeIdea.category : ""],
    ["Tahap ide", document.querySelector("#detail-status").selectedOptions[0].textContent],
    ["Prioritas", priority ? PRIORITIES[priority] : "Belum diprioritaskan"],
    ["Action", action ? (completed ? "Selesai" : "Belum selesai") : "Belum dibuat"],
    ["Dibuat", activeIdea ? formatDate(activeIdea.createdAt) : ""],
  ].filter((item) => item[1]);
  document.querySelector("#blueprint-print-title").textContent =
    document.querySelector("#detail-idea-title").value.trim() || "Blueprint Ide";
  const metadataContainer = document.querySelector("#blueprint-print-meta");
  metadataContainer.replaceChildren();
  metadata.forEach(([label, value]) => {
    const badge = document.createElement("span");
    badge.className = "blueprint-print-badge";
    const badgeLabel = document.createElement("span");
    badgeLabel.className = "blueprint-print-badge-label";
    badgeLabel.textContent = label;
    const badgeValue = document.createElement("strong");
    badgeValue.textContent = value;
    badge.append(badgeLabel, badgeValue);
    metadataContainer.append(badge);
  });
  const actionDescription = document.querySelector("#blueprint-print-action");
  actionDescription.hidden = !action;
  actionDescription.textContent = action ? `Langkah berikutnya: ${action}` : "";
}

function updateBlueprintPrintContent() {
  document.querySelector("#print-refined").textContent =
    document.querySelector("#blueprint-refined").value.trim() || "Belum diisi.";
  document.querySelector("#print-problem").textContent =
    document.querySelector("#blueprint-problem").value.trim() || "Belum diisi.";
  document.querySelector("#print-audience").textContent =
    document.querySelector("#blueprint-audience").value.trim() || "Belum diisi.";
  [
    ["#print-assumptions", "#blueprint-assumptions"],
    ["#print-first-steps", "#blueprint-first-steps"],
    ["#print-validation", "#blueprint-validation"],
  ].forEach(([listSelector, inputSelector]) => {
    const list = document.querySelector(listSelector);
    list.replaceChildren();
    const items = document.querySelector(inputSelector).value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (items.length === 0) {
      if (listSelector === "#print-validation") {
        const empty = document.createElement("li");
        empty.textContent = "Belum diisi.";
        list.append(empty);
      }
      return;
    }
    items.forEach((item) => {
      const listItem = document.createElement("li");
      listItem.textContent = item;
      list.append(listItem);
    });
  });
}

function setBlueprintFields(blueprint) {
  const editor = document.querySelector("#blueprint-editor");
  editor.hidden = !blueprint;
  document.querySelector("#blueprint-refined").value = blueprint ? blueprint.refinedIdea : "";
  document.querySelector("#blueprint-problem").value = blueprint ? blueprint.problem : "";
  document.querySelector("#blueprint-audience").value = blueprint ? blueprint.audience : "";
  document.querySelector("#blueprint-assumptions").value =
    blueprint ? blueprint.assumptions.join("\n") : "";
  document.querySelector("#blueprint-first-steps").value =
    blueprint ? blueprint.firstSteps.join("\n") : "";
  document.querySelector("#blueprint-validation").value =
    blueprint ? blueprint.validationQuestions.join("\n") : "";
  document.querySelector("#export-blueprint").disabled = !blueprint;
  document.querySelector("#use-blueprint-action").disabled =
    !blueprint || blueprint.firstSteps.length === 0;
  updateBlueprintPrintMetadata();
  updateBlueprintPrintContent();
}

function blueprintFromFields() {
  const readList = (selector) => document.querySelector(selector).value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  const blueprint = {
    refinedIdea: document.querySelector("#blueprint-refined").value.trim(),
    problem: document.querySelector("#blueprint-problem").value.trim(),
    audience: document.querySelector("#blueprint-audience").value.trim(),
    assumptions: readList("#blueprint-assumptions"),
    firstSteps: readList("#blueprint-first-steps"),
    validationQuestions: readList("#blueprint-validation"),
    updatedAt: new Date().toISOString(),
  };
  if (!isValidBlueprint(blueprint)) {
    throw new Error("Periksa Blueprint: tiap daftar maksimal 4 baris dan setiap baris maksimal 240 karakter.");
  }
  if (!blueprint.refinedIdea) {
    throw new Error("Ringkasan ide di Blueprint tidak boleh kosong.");
  }
  return blueprint;
}

function openIdea(id) {
  const idea = ideas.find((item) => item.id === id);
  if (!idea) return;
  document.querySelector("#ai-message").textContent = "";
  document.querySelector("#ai-message").classList.remove("is-error");
  document.querySelector("#develop-idea-ai").disabled = false;
  document.querySelector("#detail-id").value = idea.id;
  document.querySelector("#detail-idea-title").value = idea.title;
  document.querySelector("#detail-status").value = idea.status;
  document.querySelector("#detail-note").value = idea.note;
  document.querySelector("#detail-problem").value = idea.problem;
  document.querySelector("#detail-audience").value = idea.audience;
  document.querySelector("#detail-next").value = idea.nextStep;
  document.querySelector("#detail-action-completed").checked = idea.actionCompleted;
  document.querySelector("#detail-action-completed").disabled = !idea.nextStep;
  document.querySelector("#action-summary").textContent = idea.nextStep
    ? `Langkahmu: ${idea.nextStep}`
    : "Tulis langkah kecil di bagian pengembangan ide terlebih dahulu.";
  setIdeaPriority(idea.priority);
  setBlueprintFields(idea.blueprint);
  document.querySelector("#ai-message").textContent = idea.blueprint
    ? `Blueprint tersimpan pada ide ini. Terakhir diperbarui ${formatDate(idea.blueprint.updatedAt)}.`
    : "";
  dialog.showModal();
  document.querySelector("#detail-idea-title").focus();
}

function setIdeaPriority(priority) {
  const validPriority = Object.hasOwn(PRIORITIES, priority) ? priority : "";
  document.querySelector("#detail-priority").value = validPriority;
  document.querySelectorAll(".priority-option").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.priority === validPriority));
  });
  updateBlueprintPrintMetadata();
}

async function saveCurrentIdeaWithBlueprint(blueprint, successMessage) {
  const id = document.querySelector("#detail-id").value;
  const oldIdea = ideas.find((idea) => idea.id === id);
  const title = document.querySelector("#detail-idea-title").value.trim();
  if (!oldIdea || !title) throw new Error("Judul ide wajib diisi sebelum Blueprint disimpan.");
  const nextStep = document.querySelector("#detail-next").value.trim();
  const nextIdea = {
    ...oldIdea,
    title,
    status: document.querySelector("#detail-status").value,
    note: document.querySelector("#detail-note").value.trim(),
    problem: document.querySelector("#detail-problem").value.trim(),
    audience: document.querySelector("#detail-audience").value.trim(),
    nextStep,
    priority: document.querySelector("#detail-priority").value || null,
    actionCompleted: nextStep.length > 0
      && document.querySelector("#detail-action-completed").checked,
    blueprint,
  };
  const saved = await saveIdeas(
    ideas.map((idea) => idea.id === id ? nextIdea : idea),
    successMessage,
  );
  if (saved) {
    setBlueprintFields(blueprint);
    updateBlueprintPrintMetadata();
  }
  return saved;
}

document.querySelector("#save-blueprint").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const message = document.querySelector("#ai-message");
  button.disabled = true;
  message.classList.remove("is-error");
  try {
    const blueprint = blueprintFromFields();
    const saved = await saveCurrentIdeaWithBlueprint(blueprint, "Blueprint berhasil disimpan.");
    if (saved) {
      message.textContent = "Blueprint tersimpan. Kamu bisa menutup lalu membukanya lagi nanti.";
    } else {
      message.textContent = "Blueprint belum tersimpan. Periksa pesan penyimpanan di halaman.";
      message.classList.add("is-error");
    }
  } catch (error) {
    message.textContent = error.message;
    message.classList.add("is-error");
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#export-blueprint").addEventListener("click", () => {
  if (document.querySelector("#blueprint-editor").hidden) return;
  updateBlueprintPrintMetadata();
  updateBlueprintPrintContent();
  titleBeforePrint = document.title;
  document.title = `Blueprint - ${document.querySelector("#detail-idea-title").value.trim() || "Ide Sela"}`;
  reopenDialogAfterPrint = dialog.open && dialog.matches(":modal");
  if (reopenDialogAfterPrint) {
    dialog.close();
    dialog.setAttribute("open", "");
  }
  document.body.classList.add("printing-blueprint");
  window.print();
});
window.addEventListener("afterprint", () => {
  document.body.classList.remove("printing-blueprint");
  if (titleBeforePrint) document.title = titleBeforePrint;
  titleBeforePrint = "";
  if (reopenDialogAfterPrint) {
    dialog.removeAttribute("open");
    dialog.showModal();
  }
  reopenDialogAfterPrint = false;
});
document.querySelector("#use-blueprint-action").addEventListener("click", () => {
  const firstStep = document.querySelector("#blueprint-first-steps").value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find(Boolean);
  if (!firstStep) return;
  const actionInput = document.querySelector("#detail-next");
  actionInput.value = firstStep;
  actionInput.dispatchEvent(new Event("input", { bubbles: true }));
  actionInput.focus();
});

document.querySelectorAll(".priority-option").forEach((button) => {
  button.addEventListener("click", () => setIdeaPriority(button.dataset.priority));
});
document.querySelector("#clear-priority").addEventListener("click", () => setIdeaPriority(""));
document.querySelector("#detail-next").addEventListener("input", (event) => {
  const completed = document.querySelector("#detail-action-completed");
  const idea = ideas.find((item) => item.id === document.querySelector("#detail-id").value);
  const nextStep = event.currentTarget.value.trim();
  completed.disabled = !nextStep;
  if (!nextStep) completed.checked = false;
  document.querySelector("#action-summary").textContent = nextStep
    ? `Langkahmu: ${nextStep}`
    : "Tulis langkah kecil di bagian pengembangan ide terlebih dahulu.";
  if (idea && nextStep !== idea.nextStep) completed.checked = false;
  updateBlueprintPrintMetadata();
});
["#detail-idea-title", "#detail-status", "#detail-priority", "#detail-action-completed"].forEach((selector) => {
  document.querySelector(selector).addEventListener("input", updateBlueprintPrintMetadata);
  document.querySelector(selector).addEventListener("change", updateBlueprintPrintMetadata);
});
document.querySelectorAll(".blueprint-input").forEach((input) => {
  input.addEventListener("input", () => {
    document.querySelector("#ai-message").textContent = "Ada perubahan Blueprint yang belum disimpan.";
    document.querySelector("#ai-message").classList.remove("is-error");
    updateBlueprintPrintContent();
  });
});

document.querySelector("#develop-idea-ai").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  const message = document.querySelector("#ai-message");
  message.textContent = "";
  message.classList.remove("is-error");

  if (!cloudSession) {
    message.textContent = "Masuk dengan akun Sela Plus Lifetime untuk mencoba fitur ini.";
    message.classList.add("is-error");
    return;
  }
  if (!isSupabaseConfigured()) {
    message.textContent = "Koneksi Sela belum dikonfigurasi.";
    message.classList.add("is-error");
    return;
  }

  const activeIdea = ideas.find((idea) => idea.id === document.querySelector("#detail-id").value);
  if (!activeIdea) {
    message.textContent = "Ide ini tidak ditemukan. Tutup lalu buka kembali ide tersebut.";
    message.classList.add("is-error");
    return;
  }
  if (activeIdea.blueprint
    && !window.confirm("Blueprint yang tersimpan akan diganti dengan hasil analisis baru. Lanjutkan?")) {
    return;
  }

  button.disabled = true;
  message.textContent = "Sedang membantu mengembangkan idemu...";
  try {
    const accessToken = await getValidAccessToken();
    const response = await supabaseRequest("/functions/v1/develop-idea", {
      method: "POST",
      accessToken,
      body: {
        title: document.querySelector("#detail-idea-title").value.trim(),
        note: document.querySelector("#detail-note").value.trim(),
        category: activeIdea ? activeIdea.category : "",
        problem: document.querySelector("#detail-problem").value.trim(),
        audience: document.querySelector("#detail-audience").value.trim(),
        nextStep: document.querySelector("#detail-next").value.trim(),
      },
    });
    if (!response || !response.result || typeof response.remaining !== "number") {
      throw new Error("Respons AI tidak lengkap. Coba lagi nanti.");
    }

    const blueprint = {
      ...response.result,
      updatedAt: new Date().toISOString(),
    };
    if (!isValidBlueprint(blueprint) || !blueprint.refinedIdea.trim()) {
      throw new Error("Hasil AI tidak sesuai format Blueprint. Coba lagi nanti.");
    }
    setBlueprintFields(blueprint);
    const saved = await saveCurrentIdeaWithBlueprint(blueprint, "Blueprint AI berhasil disimpan.");
    if (saved) {
      message.textContent =
        `Blueprint tersimpan pada ide ini. Sisa percobaan AI hari ini: ${response.remaining} dari 10.`;
    } else {
      message.textContent =
        `Blueprint berhasil dibuat, tetapi belum tersimpan. Periksa pesan penyimpanan di halaman. Sisa percobaan hari ini: ${response.remaining} dari 10.`;
      message.classList.add("is-error");
    }
  } catch (error) {
    message.textContent = error.message || "Fitur AI belum dapat digunakan. Coba lagi nanti.";
    message.classList.add("is-error");
  } finally {
    button.disabled = false;
  }
});

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
    priority: null,
    actionCompleted: false,
    blueprint: null,
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
  let blueprint = oldIdea.blueprint;
  if (!document.querySelector("#blueprint-editor").hidden) {
    try {
      blueprint = blueprintFromFields();
    } catch (error) {
      document.querySelector("#ai-message").textContent = error.message;
      document.querySelector("#ai-message").classList.add("is-error");
      document.querySelector("#blueprint-refined").focus();
      return;
    }
  }
  const nextIdea = {
    ...oldIdea,
    title,
    status: document.querySelector("#detail-status").value,
    note: document.querySelector("#detail-note").value.trim(),
    problem,
    audience,
    nextStep,
    priority: document.querySelector("#detail-priority").value || null,
    actionCompleted: nextStep.length > 0
      && document.querySelector("#detail-action-completed").checked,
    blueprint,
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

document.querySelector("#priority-filter").addEventListener("change", (event) => {
  activePriorityFilter = event.currentTarget.value;
  render();
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
document.querySelector("#license-code-form").addEventListener("submit", redeemPlusLicenseCode);
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
document.querySelector("#check-license").addEventListener("click", checkPlusLicenseStatus);

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
