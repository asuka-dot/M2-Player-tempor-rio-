// Player de Músicas: busca e streaming pela API pública do Internet Archive.
// Não precisa de chave nem cadastro. Cada item tem sua própria licença (veja o link no resultado).

const API_SEARCH = "https://archive.org/advancedsearch.php";
const API_META = "https://archive.org/metadata/";
const API_DOWNLOAD = "https://archive.org/download/";

const AUDIO_EXT = ["mp3", "ogg", "flac", "wav", "m4a", "aif", "aiff"];
// Ordem de preferência para tocar (formatos leves primeiro).
const STREAM_ORDER = ["mp3", "ogg", "m4a", "flac", "wav", "aif", "aiff"];
// Formatos oferecidos como botão de download, nesta ordem.
const DOWNLOAD_FORMATS = ["mp3", "flac", "wav"];
// Fontes preferidas para converter em WAV quando o item não tem WAV.
const WAV_SOURCE_ORDER = ["flac", "aif", "aiff", "wav", "mp3", "ogg", "m4a"];

const $ = (id) => document.getElementById(id);
const els = {
  form: $("search-form"),
  q: $("q"),
  status: $("status"),
  resultsSection: $("results-section"),
  results: $("results"),
  albumSection: $("album-section"),
  albumTitle: $("album-title"),
  albumMeta: $("album-meta"),
  tracks: $("tracks"),
  now: $("now"),
  audio: $("audio"),
  prev: $("prev"),
  next: $("next"),
};

let currentItem = null; // { id, title }
let queue = [];         // faixas do álbum aberto
let queueIndex = -1;

// ---------- utilidades ----------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) {
    node.append(child);
  }
  return node;
}

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.className = isError ? "error" : "";
}

function getExt(name) {
  const i = name.lastIndexOf(".");
  return i === -1 ? "" : name.slice(i + 1).toLowerCase();
}

function stripExt(name) {
  const i = name.lastIndexOf(".");
  return i === -1 ? name : name.slice(0, i);
}

function baseName(path) {
  return path.split("/").pop();
}

function fileUrl(id, name) {
  const path = name.split("/").map(encodeURIComponent).join("/");
  return API_DOWNLOAD + encodeURIComponent(id) + "/" + path;
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Erro " + res.status + " ao acessar o servidor.");
  return res.json();
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------- busca ----------

function cleanTerm(term) {
  // Remove caracteres especiais da sintaxe de busca do Archive.
  return term.replace(/[+\-&|!(){}\[\]^"~*?:\\\/]/g, " ").replace(/\s+/g, " ").trim();
}

async function searchItems(term) {
  const clean = cleanTerm(term);
  if (!clean) return [];
  const params = new URLSearchParams();
  params.set("q", "(" + clean + ") AND mediatype:audio AND collection:opensource_audio");
  for (const field of ["identifier", "title", "creator", "licenseurl"]) {
    params.append("fl[]", field);
  }
  params.append("sort[]", "downloads desc");
  params.set("rows", "20");
  params.set("page", "1");
  params.set("output", "json");
  const data = await getJson(API_SEARCH + "?" + params.toString());
  return data.response.docs;
}

function renderResults(docs) {
  els.results.replaceChildren();
  els.resultsSection.hidden = false;
  if (docs.length === 0) {
    els.results.append(el("li", { textContent: "Nenhum resultado." }));
    return;
  }
  for (const doc of docs) {
    const creator = Array.isArray(doc.creator) ? doc.creator.join(", ") : doc.creator;
    const openBtn = el("button", { type: "button", textContent: "Abrir faixas" });
    openBtn.addEventListener("click", () => openItem(doc.identifier, doc.title));
    const li = el(
      "li",
      {},
      el("div", { className: "item-title", textContent: doc.title || doc.identifier }),
      el("div", { className: "item-sub", textContent: creator || "Artista desconhecido" }),
      el("div", { className: "actions" }, openBtn)
    );
    els.results.append(li);
  }
}

// ---------- faixas de um item ----------

async function loadTracks(id) {
  const meta = await getJson(API_META + encodeURIComponent(id));
  const files = (meta.files || []).filter((f) => AUDIO_EXT.includes(getExt(f.name)));

  // Agrupa arquivos com o mesmo nome base (01.flac, 01.mp3, 01.ogg viram uma faixa).
  const groups = new Map();
  for (const file of files) {
    const key = stripExt(file.name);
    if (!groups.has(key)) {
      groups.set(key, { key, title: "", track: Infinity, files: {}, original: null });
    }
    const group = groups.get(key);
    group.files[getExt(file.name)] = file;
    if (file.source === "original") group.original = file;
    if (file.title && !group.title) group.title = file.title;
    const n = parseInt(file.track, 10);
    if (!Number.isNaN(n) && n < group.track) group.track = n;
  }

  const tracks = [...groups.values()].map((g) => ({
    ...g,
    title: g.title || baseName(g.key),
  }));
  tracks.sort((a, b) => a.track - b.track || a.key.localeCompare(b.key, undefined, { numeric: true }));
  return { meta, tracks };
}

async function openItem(id, title) {
  setStatus("Carregando faixas...");
  try {
    const { meta, tracks } = await loadTracks(id);
    currentItem = { id, title: title || id };
    queue = tracks;
    queueIndex = -1;
    renderTracks(meta);
    setStatus(tracks.length ? "" : "Este item não tem faixas de áudio.");
    els.albumSection.scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    setStatus("Não foi possível carregar as faixas. " + err.message, true);
  }
}

function renderTracks(meta) {
  els.albumSection.hidden = false;
  els.albumTitle.textContent = currentItem.title;
  const license = meta.metadata && meta.metadata.licenseurl;
  els.albumMeta.replaceChildren();
  if (license) {
    els.albumMeta.append("Licença: ", el("a", { href: license, target: "_blank", rel: "noopener", textContent: license }));
  } else {
    els.albumMeta.append("Licença não informada: confira a página do item antes de reutilizar.");
  }
  els.tracks.replaceChildren();

  queue.forEach((track, index) => {
    const playBtn = el("button", { type: "button", textContent: "Tocar" });
    playBtn.addEventListener("click", () => playIndex(index));

    const actions = el("div", { className: "actions" }, playBtn);

    for (const ext of DOWNLOAD_FORMATS) {
      if (track.files[ext]) {
        actions.append(makeDownloadButton(ext.toUpperCase(), (btn) => downloadFile(track.files[ext], btn)));
      }
    }
    if (!track.files.wav) {
      actions.append(
        makeDownloadButton("WAV sem compressão (convertido)", (btn) => downloadAsWav(track, btn))
      );
    }
    if (track.original) {
      const label = "Original (" + getExt(track.original.name).toUpperCase() + ")";
      actions.append(makeDownloadButton(label, (btn) => downloadFile(track.original, btn)));
    }

    const li = el(
      "li",
      {},
      el("div", { className: "item-title", textContent: track.title }),
      el("div", { className: "item-sub", textContent: Object.keys(track.files).join(", ").toUpperCase() }),
      actions
    );
    li.dataset.index = String(index);
    els.tracks.append(li);
  });
}

// ---------- reprodução ----------

function pickStreamFile(track) {
  for (const ext of STREAM_ORDER) {
    if (track.files[ext]) return track.files[ext];
  }
  return null;
}

function playIndex(index) {
  if (index < 0 || index >= queue.length) return;
  const track = queue[index];
  const file = pickStreamFile(track);
  if (!file) return;
  queueIndex = index;
  els.audio.src = fileUrl(currentItem.id, file.name);
  els.audio.play().catch(() => setStatus("Toque em play para iniciar a reprodução.", true));
  els.now.textContent = track.title + " , " + currentItem.title;
  for (const li of els.tracks.children) {
    li.classList.toggle("playing", li.dataset.index === String(index));
  }
}

els.audio.addEventListener("ended", () => playIndex(queueIndex + 1));
els.audio.addEventListener("error", () => {
  if (els.audio.src) setStatus("Não foi possível tocar esta faixa. Tente a próxima.", true);
});
els.prev.addEventListener("click", () => playIndex(queueIndex - 1));
els.next.addEventListener("click", () => playIndex(queueIndex + 1));

// ---------- downloads ----------

function makeDownloadButton(label, handler) {
  const btn = el("button", { type: "button", textContent: "Baixar " + label });
  btn.addEventListener("click", async () => {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Baixando...";
    try {
      await handler(btn);
    } catch (err) {
      setStatus("Falha no download: " + err.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
  return btn;
}

// Baixa o arquivo exatamente como está no servidor (sem recompressão).
async function downloadFile(file, btn) {
  const url = fileUrl(currentItem.id, file.name);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Erro " + res.status);
    saveBlob(await res.blob(), baseName(file.name));
  } catch (err) {
    // Se o navegador bloquear a leitura direta, abre o link para salvar manualmente.
    window.open(url, "_blank", "noopener");
  }
}

// Gera um WAV PCM 16-bit sem compressão a partir da melhor fonte disponível.
// Observação: se a fonte for MP3, o WAV é grande mas não recupera qualidade perdida.
async function downloadAsWav(track, btn) {
  const ext = WAV_SOURCE_ORDER.find((e) => track.files[e]);
  if (!ext) throw new Error("Nenhuma fonte disponível.");
  const url = fileUrl(currentItem.id, track.files[ext].name);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Erro " + res.status);
  const data = await res.arrayBuffer();
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    const audioBuffer = await ctx.decodeAudioData(data);
    const wav = encodeWav(audioBuffer);
    saveBlob(new Blob([wav], { type: "audio/wav" }), baseName(track.key) + ".wav");
  } finally {
    ctx.close();
  }
}

function encodeWav(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const rate = audioBuffer.sampleRate;
  const frames = audioBuffer.length;
  const dataBytes = frames * channels * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeText = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, dataBytes, true);

  const channelData = [];
  for (let c = 0; c < channels; c++) channelData.push(audioBuffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, channelData[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return buffer;
}

// ---------- início ----------

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const term = els.q.value.trim();
  if (!term) return;
  setStatus("Buscando...");
  try {
    const docs = await searchItems(term);
    renderResults(docs);
    setStatus(docs.length ? docs.length + " resultados." : "");
  } catch (err) {
    setStatus("A busca falhou. " + err.message, true);
  }
});
