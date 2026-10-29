"use strict";

const STORAGE_KEY = "sela.ideas.v1";
const ONBOARDING_KEY = "sela.onboarding.completed.v1";
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

function showStatus(message) {
  statusMessage.textContent = message;
}

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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

function saveIdeas(nextIdeas, message) {
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

document.querySelector("#quick-form").addEventListener("submit", (event) => {
  event.preventDefault();
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
  if (saveIdeas([idea, ...ideas], "Ide tersimpan. Kamu bisa memikirkannya lagi kapan saja.")) {
    event.currentTarget.reset();
    titleField.focus();
  }
});

document.querySelector("#detail-form").addEventListener("submit", (event) => {
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
  if (saveIdeas(ideas.map((idea) => idea.id === id ? nextIdea : idea), "Perkembangan ide berhasil disimpan.")) {
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

document.querySelector("#delete-idea").addEventListener("click", () => {
  const id = document.querySelector("#detail-id").value;
  if (saveIdeas(ideas.filter((idea) => idea.id !== id), "Ide berhasil dihapus.")) closeDialog();
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
render();
