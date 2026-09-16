/* ===== CONSTITUIÇÃO FEDERAL DO BRASIL — app.js ===== */
'use strict';

// ─── IndexedDB ───────────────────────────────────────────────────────────────
const DB_NAME    = 'CF_Anotacoes';
const DB_VERSION = 2;
const STORE_NAME = 'anotacoes';
const STORE_HL   = 'highlights';
let db          = null;
let currentUser = null;
let hlsCache    = {};   // { "elementoId::tipoTexto": [{id,start,end,formato,chave}, ...] }

function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) {
        d.createObjectStore(STORE_NAME, { keyPath: 'chave' });
      }
      if (!d.objectStoreNames.contains(STORE_HL)) {
        d.createObjectStore(STORE_HL, { keyPath: 'chave' });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ─── Anotações DB ────────────────────────────────────────────────────────────
function salvarAnotacao(elementoId, texto) {
  if (!db || !currentUser) return Promise.reject('Sem usuário/DB');
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const reg   = { chave: `${currentUser}::${elementoId}`, usuario: currentUser, elementoId, texto, atualizado: Date.now() };
    const req   = store.put(reg);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

function carregarTodasAnotacoes(usuario) {
  if (!db) return Promise.resolve({});
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req   = store.getAll();
    req.onsuccess = (e) => {
      const out = {};
      (e.target.result || []).forEach(r => {
        if (r.usuario === usuario) out[r.elementoId] = r.texto;
      });
      resolve(out);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

// ─── Highlights DB ────────────────────────────────────────────────────────────
function salvarHighlightDB(hl) {
  if (!db || !currentUser) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_HL, 'readwrite');
    const store = tx.objectStore(STORE_HL);
    const req   = store.put(hl);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

function removerHighlightDB(chave) {
  if (!db) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_HL, 'readwrite');
    const store = tx.objectStore(STORE_HL);
    const req   = store.delete(chave);
    req.onsuccess = () => resolve();
    req.onerror   = (e) => reject(e.target.error);
  });
}

function carregarHighlightsPorUsuario(usuario) {
  if (!db) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_HL, 'readonly');
    const store = tx.objectStore(STORE_HL);
    const req   = store.getAll();
    req.onsuccess = (e) => {
      resolve((e.target.result || []).filter(r => r.usuario === usuario));
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

// ─── Backup / Importação ─────────────────────────────────────────────────────
async function exportarBackup() {
  if (!currentUser) { mostrarToast('Selecione um usuário primeiro.', 'aviso'); return; }
  const anotacoes  = await carregarTodasAnotacoes(currentUser);
  const highlights = await carregarHighlightsPorUsuario(currentUser);
  const dados = {
    usuario: currentUser,
    exportadoEm: new Date().toISOString(),
    versao: '3.0',
    anotacoes,
    highlights
  };
  const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `cf_anotacoes_${currentUser.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  mostrarToast('Backup exportado com sucesso!', 'sucesso');
}

function importarBackup() {
  document.getElementById('import-file-input').click();
}

async function processarImportacao(file) {
  if (!file || !file.name.endsWith('.json')) { mostrarToast('Selecione um arquivo .json válido.', 'erro'); return; }
  try {
    const dados = JSON.parse(await file.text());
    if (!dados.anotacoes || typeof dados.anotacoes !== 'object') throw new Error('Formato inválido');
    if (!currentUser) { mostrarToast('Selecione um usuário antes de importar.', 'aviso'); return; }

    // Importar anotações
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    let count   = 0;
    for (const [elementoId, texto] of Object.entries(dados.anotacoes)) {
      if (texto && texto.trim()) {
        store.put({ chave: `${currentUser}::${elementoId}`, usuario: currentUser, elementoId, texto, atualizado: Date.now() });
        count++;
      }
    }
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = (e) => rej(e.target.error); });
    preencherCamposDaTela(await carregarTodasAnotacoes(currentUser));

    // Importar highlights (backup v3)
    if (Array.isArray(dados.highlights) && dados.highlights.length > 0) {
      const tx2  = db.transaction(STORE_HL, 'readwrite');
      const stHL = tx2.objectStore(STORE_HL);
      dados.highlights.forEach(hl => {
        const novo = Object.assign({}, hl, {
          usuario: currentUser,
          chave: `${currentUser}::hl::${hl.id}`
        });
        stHL.put(novo);
      });
      await new Promise((res, rej) => { tx2.oncomplete = res; tx2.onerror = (e) => rej(e.target.error); });
      await carregarEAplicarTodosHighlights();
    }

    mostrarToast(`${count} anotações importadas!`, 'sucesso');
  } catch (err) {
    console.error(err);
    mostrarToast('Erro ao importar: arquivo inválido.', 'erro');
  }
}

function preencherCamposDaTela(anotacoes) {
  document.querySelectorAll('.anotacao-wrapper').forEach(wrapper => {
    const id = wrapper.dataset.elementoId;
    if (!id) return;
    const texto = anotacoes[id];
    if (texto && texto.trim()) {
      const ta = wrapper.querySelector('.anotacao-textarea');
      if (ta) {
        ta.value = texto;
        atualizarContador(ta);
      }
      wrapper.classList.add('tem-conteudo');
      const btn = wrapper.querySelector('.btn-toggle-anotacao');
      if (btn) btn.innerHTML = '📝 Ver anotação';
    }
  });
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function mostrarToast(msg, tipo = '') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${tipo}`;
  const icons = { sucesso: '✅', erro: '❌', aviso: '⚠️' };
  toast.innerHTML = `${icons[tipo] || 'ℹ️'} ${msg}`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

// ─── Usuário ──────────────────────────────────────────────────────────────────
function mostrarModalUsuario() {
  document.getElementById('modal-usuario').classList.add('aberto');
  const input = document.getElementById('modal-usuario-input');
  input.value = currentUser || '';
  setTimeout(() => input.focus(), 50);
}

function fecharModalUsuario() {
  document.getElementById('modal-usuario').classList.remove('aberto');
}

async function confirmarUsuario() {
  const nome = document.getElementById('modal-usuario-input').value.trim();
  if (!nome) { mostrarToast('Digite um nome de usuário.', 'aviso'); return; }
  currentUser = nome;
  localStorage.setItem('cf_usuario', nome);
  document.getElementById('usuario-nome').textContent = nome;
  fecharModalUsuario();
  const anotacoes = await carregarTodasAnotacoes(currentUser);
  preencherCamposDaTela(anotacoes);
  await carregarEAplicarTodosHighlights();
  mostrarToast(`Bem-vindo(a), ${nome}!`, 'sucesso');
}

// ─── Referências Cruzadas ────────────────────────────────────────────────────
const refMap      = {};
const forwardRefs = {};
const backRefs    = {};

function buildRefMap(dados) {
  function addItem(item, tipo, extra) {
    refMap[item.id]      = Object.assign({ id: item.id, texto: item.texto, tipo }, extra || {});
    forwardRefs[item.id] = [];
    backRefs[item.id]    = [];
  }

  function processArt(art) {
    addItem(art, 'artigo', { numero: art.numero });
    (art.incisos || []).forEach(inc => {
      addItem(inc, 'inciso', { artNum: art.numero, artId: art.id });
      (inc.alineas || []).forEach(al => addItem(al, 'alinea', { artNum: art.numero, artId: art.id, incId: inc.id }));
    });
    (art.paragrafos || []).forEach(par => {
      addItem(par, 'paragrafo', { artNum: art.numero, artId: art.id });
      (par.incisos || []).forEach(inc => {
        addItem(inc, 'inciso', { artNum: art.numero, artId: art.id, parId: par.id });
        (inc.alineas || []).forEach(al => addItem(al, 'alinea', { artNum: art.numero, artId: art.id, parId: par.id, incId: inc.id }));
      });
      (par.subitens || []).forEach(sub => {
        addItem(sub, 'subinciso', { artNum: art.numero, artId: art.id, parId: par.id });
        (sub.alineas || []).forEach(al => addItem(al, 'alinea', { artNum: art.numero, artId: art.id, parId: par.id, subId: sub.id }));
      });
      (par.alineas || []).forEach(al => addItem(al, 'alinea', { artNum: art.numero, artId: art.id, parId: par.id }));
    });
  }

  function processSec(sec) { (sec.artigos || []).forEach(processArt); }
  function processCap(cap) { (cap.artigos || []).forEach(processArt); (cap.secoes || []).forEach(processSec); }
  dados.titulos.forEach(t => { (t.artigos || []).forEach(processArt); (t.capitulos || []).forEach(processCap); });
}

function detectarRefsNoTexto(texto) {
  // Remove parenthetical editorial notes (Vide, Redação dada, etc.) before parsing
  const textoLimpo = texto.replace(/\([^)]*\)/g, ' ');
  const ids = [];
  // Extended: also capture optional ", §N" or ", § único" after article number
  const re = /\bart(?:igo|s)?\.?\s*(\d+[\-A-Z]*)[ºo°]?(?:\s*,?\s*§\s*(ú|\d[\w\-]*)[ºo°]?)?/gi;
  let m;
  while ((m = re.exec(textoLimpo)) !== null) {
    // Skip references to ADCT articles
    const after = textoLimpo.slice(m.index + m[0].length, m.index + m[0].length + 50);
    if (/[-\u2013]\s*ADCT|\bADCT\b/.test(after)) continue;
    const artId = 'art_' + m[1].toLowerCase();
    if (!refMap[artId]) continue;
    // If §N was captured, try to resolve to specific paragraph
    if (m[2]) {
      const parId = encontrarParagrafoId(artId, m[2]);
      if (parId && !ids.includes(parId)) { ids.push(parId); continue; }
    }
    // Fall back to article-level ref
    if (!ids.includes(artId)) ids.push(artId);
  }
  return ids;
}

// Detect references to the article's OWN incisos (e.g. "nos incisos II e III")
function detectarIncisosPropriosNoTexto(texto, artId) {
  const ids = [];
  const textoLimpo = texto.replace(/\([^)]*\)/g, ' ');
  // Match patterns like "incisos II e III", "inciso IV", "incisos I, II e III"
  const re = /\b(?:incisos?|alíneas?)\s+([IVXLCDM]+(?:\s*,\s*[IVXLCDM]+)*(?:\s+e\s+[IVXLCDM]+)?)/gi;
  let m;
  while ((m = re.exec(textoLimpo)) !== null) {
    const nums = m[1].split(/\s*,\s*|\s+e\s+/).map(s => s.trim()).filter(Boolean);
    nums.forEach(num => {
      Object.values(refMap).forEach(it => {
        if (it.tipo === 'inciso' && it.artId === artId) {
          const mI = it.texto.match(/^([IVXLCDM]+)\s*[-\u2013]/);
          if (mI && mI[1] === num && !ids.includes(it.id)) ids.push(it.id);
        }
      });
    });
  }
  return ids;
}

function buildAllRefs() {
  Object.values(refMap).forEach(item => {
    const artProprio = ['inciso','paragrafo','subinciso','alinea'].includes(item.tipo) ? item.artId : item.id;
    const refs = detectarRefsNoTexto(item.texto).filter(id => id !== item.id && id !== artProprio);
    // For paragraphs/subitems, also detect references to own article's incisos
    if (['paragrafo','subinciso'].includes(item.tipo) && item.artId) {
      detectarIncisosPropriosNoTexto(item.texto, item.artId).forEach(id => {
        if (!refs.includes(id)) refs.push(id);
      });
    }
    forwardRefs[item.id] = refs;
    refs.forEach(refId => {
      if (!backRefs[refId]) backRefs[refId] = [];
      if (!backRefs[refId].includes(item.id)) backRefs[refId].push(item.id);
    });
  });
}

// ─── Manual / Override Forward References ────────────────────────────────────
// Applied after buildAllRefs() to complement auto-detected citations.
function applyManualRefs() {
  // Helper: add refs without duplicating; also registers backRefs
  function addFwdRefs(sourceId, idsToAdd) {
    if (!forwardRefs[sourceId]) forwardRefs[sourceId] = [];
    idsToAdd.forEach(refId => {
      if (!refId || !refMap[refId]) return; // skip unknown ids
      if (!forwardRefs[sourceId].includes(refId)) {
        forwardRefs[sourceId].push(refId);
      }
      if (!backRefs[refId]) backRefs[refId] = [];
      if (!backRefs[refId].includes(sourceId)) backRefs[refId].push(sourceId);
    });
  }
  // Helper: replace fwd refs entirely (remove old backRefs, set new)
  function setFwdRefs(sourceId, newIds) {
    const old = forwardRefs[sourceId] || [];
    old.forEach(refId => {
      if (backRefs[refId]) {
        backRefs[refId] = backRefs[refId].filter(x => x !== sourceId);
      }
    });
    forwardRefs[sourceId] = [];
    addFwdRefs(sourceId, newIds);
  }
  // Helper: remove a specific ref from forward refs
  function removeFwdRef(sourceId, refIdToRemove) {
    if (forwardRefs[sourceId]) {
      forwardRefs[sourceId] = forwardRefs[sourceId].filter(x => x !== refIdToRemove);
    }
    if (backRefs[refIdToRemove]) {
      backRefs[refIdToRemove] = backRefs[refIdToRemove].filter(x => x !== sourceId);
    }
  }

  const SUBSID = ['art_39_par_4','art_150_inc_2','art_153_inc_3','art_153_par_2_sub_1'];

  // Art. 28 §2
  addFwdRefs('art_28_par_2', SUBSID);
  // Art. 29 inc V (subsidios)
  addFwdRefs('art_29_inc_5', SUBSID);
  // Art. 29 inc XIV -> paragrafo unico do art.28
  addFwdRefs('art_29_inc_14', ['art_28_par_1']);
  // Art. 29-A caput
  addFwdRefs('art_29_a', ['art_153_par_5','art_159']);
  // Art. 37 inc X
  addFwdRefs('art_37_inc_10', ['art_37_inc_15'].concat(SUBSID));
  // Art. 37 §10
  addFwdRefs('art_37_par_10', ['art_142']);
  // Art. 37 §15 -> art.40 §14, §15, §16
  addFwdRefs('art_37_par_15', ['art_40_par_17','art_40_par_18','art_40_par_19']);
  // Art. 39 §3: replace generic art_7 ref with individual incisos cited in text
  removeFwdRef('art_39_par_3', 'art_7');
  addFwdRefs('art_39_par_3', [
    'art_7_inc_4','art_7_inc_7','art_7_inc_8','art_7_inc_9',
    'art_7_inc_12','art_7_inc_13','art_7_inc_15','art_7_inc_16',
    'art_7_inc_17','art_7_inc_18','art_7_inc_19','art_7_inc_20',
    'art_7_inc_22','art_7_inc_30'
  ]);
  // Art. 40 §2
  addFwdRefs('art_40_par_2', ['art_201_par_2']);
  // Art. 40 §7 (internal id: art_40_par_10)
  addFwdRefs('art_40_par_10', ['art_201_par_2']);
  // Art. 40 §4-B (internal id: art_40_par_6)
  addFwdRefs('art_40_par_6', [
    'art_51_inc_4','art_52_inc_13',
    'art_144_inc_1','art_144_inc_2','art_144_inc_3','art_144_inc_4'
  ]);
  // Art. 42 §1
  addFwdRefs('art_42_par_1', ['art_142_par_2','art_142_par_3_sub_10']);
  // Art. 42 §3
  addFwdRefs('art_42_par_3', ['art_37_inc_16']);
  // Art. 48 caput
  addFwdRefs('art_48', ['art_51','art_52']);
  // Art. 48 inc X -> alinea b do inc VI do art.84
  addFwdRefs('art_48_inc_10', ['art_84_inc_6_al_2']);
  // Art. 48 inc XV
  addFwdRefs('art_48_inc_15', SUBSID);
  // Art. 49 inc VII
  addFwdRefs('art_49_inc_7', SUBSID);
  // Art. 49 inc VIII
  addFwdRefs('art_49_inc_8', SUBSID);
  // Art. 62 §2
  addFwdRefs('art_62_par_2', ['art_154_inc_2']);
  // Art. 62 §3
  addFwdRefs('art_62_par_3', ['art_62_par_11','art_62_par_12','art_62_par_7']);
  // Art. 63 inc I
  addFwdRefs('art_63_inc_1', ['art_166_par_4']);
  // Art. 84 inc XXVIII
  addFwdRefs('art_84_inc_28', [
    'art_167_b','art_167_c','art_167_d','art_167_e','art_167_f','art_167_g'
  ]);
  // Art. 93 inc V - fix: ONLY art_93_inc_8
  setFwdRefs('art_93_inc_5', ['art_93_inc_8']);
  // Art. 95 inc II - fix: ONLY art_93_inc_8
  setFwdRefs('art_95_inc_2', ['art_93_inc_8']);
  // Art. 95 inc III
  addFwdRefs('art_95_inc_3', SUBSID);
  // Art. 100 §18
  addFwdRefs('art_100_par_18', ['art_20_par_1']);
  // Art. 100 §18 inc III (internal id: art_100_par_18_sub_3)
  addFwdRefs('art_100_par_18_sub_3', ['art_201_par_9']);
  // Art. 100 §19
  addFwdRefs('art_100_par_19', ['art_52_inc_6','art_52_inc_7','art_167_inc_4']);
  // Art. 105 inc I alinea j (internal id: art_105_inc_1_al_10)
  addFwdRefs('art_105_inc_1_al_10', ['art_156_a','art_195_inc_5']);
  // Art. 128 §5 inc I alinea c (internal id: art_128_par_5_sub_1_al_3)
  addFwdRefs('art_128_par_5_sub_1_al_3', SUBSID);
  // Art. 128 §6 -> paragrafo unico do art.95, inc V (internal: art_95_par_1_sub_5)
  addFwdRefs('art_128_par_6', ['art_95_par_1_sub_5']);
  // Art. 134 caput -> art.5 LXXIV
  addFwdRefs('art_134', ['art_5_inc_74']);

  // ── Lote 2 (set/2026) ───────────────────────────────────────────────────
  // Art. 134 §4
  addFwdRefs('art_134_par_4', ['art_96_inc_2']);
  // Art. 138 §1
  addFwdRefs('art_138_par_1', ['art_137_inc_2']);
  // Art. 142 §3 inc II -> art.37 XVI alinea "c"
  addFwdRefs('art_142_par_3_sub_2', ['art_37_inc_16_al_3']);
  // Art. 142 §3 inc III -> art.37 XVI alinea "c"
  addFwdRefs('art_142_par_3_sub_3', ['art_37_inc_16_al_3']);
  // Art. 142 §3 inc VIII -> desmembra todas as citações individuais
  addFwdRefs('art_142_par_3_sub_8', [
    'art_37_inc_16_al_3','art_37_inc_11','art_37_inc_13','art_37_inc_14','art_37_inc_15',
    'art_7_inc_8','art_7_inc_12','art_7_inc_17','art_7_inc_18','art_7_inc_19','art_7_inc_25'
  ]);
  // Art. 144 §9 (internal id: art_144_par_10)
  addFwdRefs('art_144_par_10', ['art_39_par_4']);
  // Art. 146 inc III alinea "c" (internal: art_146_inc_3_al_3)
  addFwdRefs('art_146_inc_3_al_3', ['art_156_a','art_195_inc_5']);
  // Art. 146 inc III alinea "d" (internal: art_146_inc_3_al_4)
  addFwdRefs('art_146_inc_3_al_4', ['art_156_a','art_195_par_12']);
  // Art. 146 §2
  addFwdRefs('art_146_par_2', ['art_156_a','art_195_inc_5']);
  // Art. 146 §3
  addFwdRefs('art_146_par_3', ['art_156_a','art_195_inc_5']);
  // Art. 148 inc II -> art.150 III alinea "b"
  addFwdRefs('art_148_inc_2', ['art_150_inc_3_al_2']);
  // Art. 149 caput -> art.150 I e III
  addFwdRefs('art_149', ['art_150_inc_1','art_150_inc_3']);
  // Art. 149-B caput
  addFwdRefs('art_149_b', ['art_156_a','art_195_inc_5']);
  // Art. 149-C caput
  addFwdRefs('art_149_c', ['art_156_a']);
  // Art. 149-C §3 -> art.150 VI alinea "a"
  addFwdRefs('art_149_c_par_3', ['art_150_inc_6_al_1']);
  // Art. 150 §1
  addFwdRefs('art_150_par_1', [
    'art_150_inc_3_al_2','art_150_inc_3_al_3',
    'art_153_inc_1','art_153_inc_2','art_153_inc_3','art_153_inc_4','art_153_inc_5',
    'art_154_inc_2','art_156_inc_1'
  ]);
  // Art. 150 §2 -> art.150 VI alinea "a"
  addFwdRefs('art_150_par_2', ['art_150_inc_6_al_1']);
  // Art. 150 §3 -> art.150 VI alinea "a"
  addFwdRefs('art_150_par_3', ['art_150_inc_6_al_1']);
  // Art. 150 §4 -> art.150 VI alineas "b" e "c"
  addFwdRefs('art_150_par_4', ['art_150_inc_6_al_2','art_150_inc_6_al_3']);
  // Art. 150 §6 -> art.155 §2 XII alinea "g"
  addFwdRefs('art_150_par_6', ['art_155_par_2_sub_12_al_7']);
  // Art. 153 §6 inc IV (internal: art_153_par_6_sub_4)
  addFwdRefs('art_153_par_6_sub_4', ['art_156_inc_3','art_156_a','art_195_inc_5']);
  // Art. 155 §3
  addFwdRefs('art_155_par_3', ['art_156_a']);
  // Art. 155 §4 inc IV alinea "c" (internal: art_155_par_4_sub_4_al_3) -> art.150 III-b
  addFwdRefs('art_155_par_4_sub_4_al_3', ['art_150_inc_3_al_2']);
  // Art. 155 §4 inc IV (internal: art_155_par_4_sub_4) -> art.155 §2 XII alinea "g"
  addFwdRefs('art_155_par_4_sub_4', ['art_155_par_2_sub_12_al_7']);

  // ── Lote 3 (set/2026) ───────────────────────────────────────────────────

  // Virtual/external refs (must be in refMap before addFwdRefs below)
  refMap['art_6_ec_126_22'] = {
    id: 'art_6_ec_126_22', tipo: 'externo',
    label: 'Art. 6º da EC 126/22',
    texto: 'Art. 6º O Presidente da República deverá encaminhar ao Congresso Nacional, até 31 de agosto de 2023, projeto de lei complementar com o objetivo de instituir regime fiscal sustentável para garantir a estabilidade macroeconômica do País e criar as condições adequadas ao crescimento socioeconômico, inclusive quanto à regra estabelecida no inciso III do caput do art. 167 da Constituição Federal.'
  };
  refMap['art_107_a_adct'] = {
    id: 'art_107_a_adct', tipo: 'externo',
    label: 'Art. 107-A do ADCT',
    texto: 'Art. 107-A. Até o fim de 2026, fica estabelecido, para cada exercício financeiro, limite para alocação na proposta orçamentária das despesas com pagamentos em virtude de sentença judiciária de que trata o art. 100 da Constituição Federal, equivalente ao valor da despesa paga no exercício de 2016, incluídos os restos a pagar pagos, corrigido, para o exercício de 2017, em 7,2% (sete inteiros e dois décimos por cento) e, para os exercícios posteriores, pela variação do Índice Nacional de Preços ao Consumidor Amplo (IPCA), publicado pela Fundação Instituto Brasileiro de Geografia e Estatística, ou de outro índice que vier a substituí-lo, apurado no exercício anterior a que se refere a lei orçamentária, devendo o espaço fiscal decorrente da diferença entre o valor dos precatórios expedidos e o respectivo limite ser destinado ao programa previsto no parágrafo único do art. 6º e à seguridade social, nos termos do art. 194, ambos da Constituição Federal, a ser calculado da seguinte forma: '
  };

  // Art. 156 §1
  addFwdRefs('art_156_par_1', ['art_182_par_4_sub_2']);
  removeFwdRef('art_156_par_1', 'art_156_inc_2');
  // Art. 156 §2
  addFwdRefs('art_156_par_2', ['art_150_inc_6_al_2']);
  // Art. 156-A §1 inc III
  addFwdRefs('art_156_a_par_1_sub_3', ['art_156_a_par_5_sub_3']);
  // Art. 156-A §1 inc IX
  addFwdRefs('art_156_a_par_1_sub_9', ['art_195_inc_1_al_2','art_195_inc_4','art_195_inc_5']);
  // Art. 156-A §2
  addFwdRefs('art_156_a_par_2', ['art_156_a_par_1_sub_5']);
  // Art. 156-A §6 inc I al. a
  addFwdRefs('art_156_a_par_6_sub_1_al_1', ['art_156_a_par_1_sub_5','art_156_a_par_1_sub_6','art_156_a_par_1_sub_7']);
  // Art. 156-A §6 inc I al. c
  addFwdRefs('art_156_a_par_6_sub_1_al_3', ['art_156_a_par_1_sub_8']);
  // Art. 156-A §6 inc II al. a
  addFwdRefs('art_156_a_par_6_sub_2_al_1', ['art_156_a_par_1_sub_8']);
  // Art. 156-A §6 inc II al. b
  addFwdRefs('art_156_a_par_6_sub_2_al_2', ['art_156_a_par_1_sub_5','art_156_a_par_1_sub_6','art_156_a_par_1_sub_7','art_156_a_par_1_sub_8']);
  // Art. 156-A §6 inc IV
  addFwdRefs('art_156_a_par_6_sub_4', ['art_156_a_par_1_sub_5','art_156_a_par_1_sub_6','art_156_a_par_1_sub_7','art_156_a_par_1_sub_8']);
  // Art. 156-A §6 inc VI
  addFwdRefs('art_156_a_par_6_sub_6', ['art_156_a_par_1_sub_5','art_156_a_par_1_sub_6','art_156_a_par_1_sub_7','art_156_a_par_1_sub_8']);
  // Art. 156-A §7 inc II
  addFwdRefs('art_156_a_par_7_sub_2', ['art_156_a_par_1_sub_11']);
  // Art. 156-A §9 inc I
  addFwdRefs('art_156_a_par_9_sub_1', ['art_156_a_par_1_sub_12']);
  // Art. 156-A §10
  addFwdRefs('art_156_a_par_10', ['art_156_a_par_1_sub_12']);
  // Art. 156-A §11
  addFwdRefs('art_156_a_par_11', ['art_156_a_par_1_sub_12']);
  // Art. 156-A §12
  addFwdRefs('art_156_a_par_12', [
    'art_156_a_par_5_sub_8','art_29_a','art_198_par_2','art_204_par_1',
    'art_212','art_212_a_inc_2','art_216_par_6','art_158_inc_4_al_2'
  ]);
  // Art. 156-A §13
  addFwdRefs('art_156_a_par_13', ['art_156_a_par_5_sub_8']);
  // Art. 156-B caput
  addFwdRefs('art_156_b', ['art_156_a']);
  // Art. 156-B §6
  addFwdRefs('art_156_b_par_6', ['art_156_a','art_195_inc_5']);
  // Art. 156-B §8
  addFwdRefs('art_156_b_par_8', ['art_156_a','art_195_inc_5']);
  // Art. 158 inc II
  addFwdRefs('art_158_inc_2', ['art_153_par_4_sub_3']);
  // Art. 158 inc IV al. b (internal: art_158_inc_4_al_2)
  addFwdRefs('art_158_inc_4_al_2', ['art_156_a']);
  // Art. 158 §1
  addFwdRefs('art_158_par_1', ['art_158_inc_4_al_1']);
  // Art. 158 §2
  addFwdRefs('art_158_par_2', ['art_158_inc_4_al_2']);
  // Art. 159 §1
  addFwdRefs('art_159_par_1', ['art_158_inc_1']);
  // Art. 160 §1 inc II
  addFwdRefs('art_160_par_1_sub_2', ['art_198_par_2_sub_2','art_198_par_2_sub_3']);
  // Art. 161 inc I
  addFwdRefs('art_161_inc_1', ['art_158_par_1_sub_1']);
  // Art. 161 inc III
  addFwdRefs('art_161_inc_3', ['art_158','art_159']);
  // Art. 163 §1
  addFwdRefs('art_163_par_1', ['art_167_a']);
  // Art. 164-A caput
  addFwdRefs('art_164_a', ['art_163_inc_8']);
  // Art. 165 §9 inc III
  addFwdRefs('art_165_par_9_sub_3', ['art_166_par_12','art_166_par_13']);
  // Art. 165 §13
  removeFwdRef('art_165_par_13', 'art_165_inc_3');
  addFwdRefs('art_165_par_13', ['art_165_par_9_sub_3','art_165_par_10','art_165_par_11','art_165_par_12']);
  // Art. 165 §16
  addFwdRefs('art_165_par_16', ['art_37_par_16']);
  // Art. 165 §17
  removeFwdRef('art_165_par_17', 'art_165_inc_1');
  addFwdRefs('art_165_par_17', ['art_165_par_11_sub_1']);
  // Art. 165 §18 (remove art_6 auto-ref; add external EC 126/22)
  removeFwdRef('art_165_par_18', 'art_6');
  addFwdRefs('art_165_par_18', ['art_6_ec_126_22']);
  // Art. 165 §19 (remove art_6 auto-ref; add external EC 126/22 + ADCT 107-A)
  removeFwdRef('art_165_par_19', 'art_6');
  addFwdRefs('art_165_par_19', ['art_6_ec_126_22','art_107_a_adct']);
  // Art. 165 §20 (remove art_6 auto-ref)
  removeFwdRef('art_165_par_20', 'art_6');
  // Art. 165 §22
  addFwdRefs('art_165_par_22', ['art_107_a_adct']);
  // Art. 166 §11
  addFwdRefs('art_166_par_11', ['art_198_par_2_sub_1']);
  // Art. 166 §12
  addFwdRefs('art_166_par_12', ['art_165_par_9']);
  // Art. 166-A §1
  addFwdRefs('art_166_a_par_1', ['art_166_par_17']);
  // Art. 166-A §5
  removeFwdRef('art_166_a_par_5', 'art_166_a_inc_2');
  addFwdRefs('art_166_a_par_5', ['art_166_a_par_1_sub_2']);
  // Art. 167 inc IV
  addFwdRefs('art_167_inc_4', ['art_37_inc_22','art_159','art_212']);
  // Art. 167 inc XI
  addFwdRefs('art_167_inc_11', ['art_195_inc_1_al_1','art_195_inc_2']);
  // Art. 167 inc XII
  addFwdRefs('art_167_inc_12', ['art_40_par_22']);
  // Art. 167 §3
  addFwdRefs('art_167_par_3', ['art_167_a_par_6']);
  // Art. 167 §4
  addFwdRefs('art_167_par_4', [
    'art_156','art_156_a','art_157','art_158',
    'art_159_inc_1_al_1','art_159_inc_1_al_2','art_159_inc_1_al_4',
    'art_159_inc_1_al_5','art_159_inc_1_al_6','art_159_inc_2'
  ]);
  // Art. 167 §7
  addFwdRefs('art_167_par_7', ['art_7_inc_4']);
  // Art. 167-A inc IV al. c
  addFwdRefs('art_167_a_inc_4_al_3', ['art_37_inc_9']);
  // Art. 167-A inc VIII
  addFwdRefs('art_167_a_inc_8', ['art_7_inc_4']);
  // Art. 167-C caput
  addFwdRefs('art_167_c', ['art_37_inc_9','art_169_par_1']);
  // Art. 167-E caput
  addFwdRefs('art_167_e', ['art_167_inc_3']);
  // Art. 167-F §2 inc II
  addFwdRefs('art_167_f_par_2_sub_2', ['art_198','art_201','art_212','art_212_a','art_239']);
  // Art. 167-G caput
  addFwdRefs('art_167_g', ['art_167_b','art_167_a']);
  // Art. 167-G §1
  addFwdRefs('art_167_g_par_1', [
    'art_167_a_inc_2','art_167_a_inc_4','art_167_a_inc_7','art_167_a_inc_9','art_167_a_inc_10'
  ]);
  // Art. 167-G §2
  addFwdRefs('art_167_g_par_2', ['art_167_b','art_159_inc_1_al_3']);
  // Art. 177 inc V
  addFwdRefs('art_177_inc_5', ['art_21_inc_23_al_2','art_21_inc_23_al_3']);
  // Art. 177 §1
  addFwdRefs('art_177_par_1', ['art_177_inc_2','art_177_inc_3','art_177_inc_4']);
  // Art. 177 §4 inc I al. b (internal: art_177_par_4_sub_1_al_2)
  addFwdRefs('art_177_par_4_sub_1_al_2', ['art_150_inc_3_al_2']);
  // Art. 195 §3
  setFwdRefs('art_195_par_3', ['art_198_par_2_sub_2','art_198_par_2_sub_3']);
  // Art. 195 §6
  addFwdRefs('art_195_par_6', ['art_150_inc_3_al_2']);
  // Art. 195 §11
  addFwdRefs('art_195_par_11', ['art_195_inc_1_al_1']);
  // Art. 195 §12
  addFwdRefs('art_195_par_12', ['art_195_inc_1_al_2','art_195_inc_4']);
  // Art. 195 §16
  addFwdRefs('art_195_par_16', [
    'art_156_a_par_1_sub_1','art_156_a_par_1_sub_2','art_156_a_par_1_sub_3',
    'art_156_a_par_1_sub_4','art_156_a_par_1_sub_5','art_156_a_par_1_sub_6',
    'art_156_a_par_1_sub_8','art_156_a_par_1_sub_10','art_156_a_par_1_sub_11',
    'art_156_a_par_1_sub_12','art_156_a_par_1_sub_13',
    'art_156_a_par_3',
    'art_156_a_par_5_sub_2','art_156_a_par_5_sub_3','art_156_a_par_5_sub_4',
    'art_156_a_par_5_sub_5','art_156_a_par_5_sub_6','art_156_a_par_5_sub_9',
    'art_156_a_par_6','art_156_a_par_7','art_156_a_par_8','art_156_a_par_9',
    'art_156_a_par_10','art_156_a_par_11','art_156_a_par_13'
  ]);
  // Art. 195 §17
  addFwdRefs('art_195_par_17', ['art_156_a','art_195_inc_1_al_2','art_195_inc_4']);
  // Art. 195 §19
  addFwdRefs('art_195_par_19', ['art_166_par_9','art_166_par_13','art_166_par_18','art_198_par_2']);
  // Art. 198 §2 inc I
  addFwdRefs('art_198_par_2_sub_1', ['art_156_a','art_159_inc_1_al_1','art_159_inc_2']);
  // Art. 198 §2 inc III
  addFwdRefs('art_198_par_2_sub_3', ['art_156_a','art_159_inc_1_al_2','art_159_par_3']);
  // Art. 198 §6
  addFwdRefs('art_198_par_6', ['art_41_par_1','art_169_par_4']);
  // Art. 201 §8
  setFwdRefs('art_201_par_8', ['art_201_par_7_sub_1']);
  // Art. 201 §10
  addFwdRefs('art_201_par_10', ['art_142','art_143']);
  // Art. 201 §17
  setFwdRefs('art_201_par_17', ['art_40_par_1_sub_2']);
  // Art. 212 §8
  addFwdRefs('art_212_par_8', ['art_212_a_inc_2']);
  // Art. 212-A inc II al. a
  addFwdRefs('art_212_a_inc_2_al_1', ['art_156_a']);
  // Art. 212-A inc II al. b
  addFwdRefs('art_212_a_inc_2_al_2', ['art_156_a','art_156_a_par_2']);
  // Art. 212-A inc II al. c
  setFwdRefs('art_212_a_inc_2_al_3', [
    'art_155_inc_1','art_155_inc_2','art_155_inc_3',
    'art_157_inc_2','art_158_inc_2','art_158_inc_3','art_158_inc_4',
    'art_159_inc_1_al_1','art_159_inc_1_al_2','art_159_inc_2'
  ]);
  // Art. 212-A inc III
  addFwdRefs('art_212_a_inc_3', ['art_211_par_2','art_211_par_3']);
  // Art. 212-A inc X
  addFwdRefs('art_212_a_inc_10', ['art_212_a_inc_1','art_212_a_inc_2','art_212_a_inc_3','art_212_a_inc_4','art_208_par_1']);
  // Art. 212-A inc XIII
  addFwdRefs('art_212_a_inc_13', ['art_212_par_5']);
  // Art. 225 §1 inc VIII
  addFwdRefs('art_225_par_1_sub_8', ['art_195_inc_1_al_2','art_195_inc_4','art_195_inc_5','art_156_a']);
  // Art. 231 §7
  addFwdRefs('art_231_par_7', ['art_174_par_4']);
  // Art. 247 caput
  addFwdRefs('art_247', ['art_41_par_1_sub_3','art_169_par_7']);
  // Art. 155 §4 inc II e III: remove todas as refs automáticas
  setFwdRefs('art_155_par_4_sub_2', []);
  setFwdRefs('art_155_par_4_sub_3', []);

  // ── Lote 4 (set/2026) ───────────────────────────────────────────────────

  // Art. 37 inc X: manter apenas art.39 §4º
  setFwdRefs('art_37_inc_10', ['art_39_par_4']);
  // Art. 37 inc XV: complementar
  addFwdRefs('art_37_inc_15', [
    'art_37_inc_11','art_37_inc_14','art_150_inc_2','art_153_inc_3','art_153_par_2_sub_1'
  ]);
  // Art. 93 inc V: substituir por art.37,XI e art.39 §4º
  setFwdRefs('art_93_inc_5', ['art_37_inc_11','art_39_par_4']);
  // Art. 159-A §4 inc II
  addFwdRefs('art_159_a_par_4_sub_2', ['art_159_inc_1_al_1']);
  // Art. 167 inc XII: retirar art.40 §19 (art_40_par_22 já adicionado no Lote 3)
  removeFwdRef('art_167_inc_12', 'art_40_par_19');
  // Art. 167 §7: retirar citação ao art.167,IV
  removeFwdRef('art_167_par_7', 'art_167_inc_4');
  // Art. 167-G §3: complementar com art.167-A §6º
  addFwdRefs('art_167_g_par_3', ['art_167_a_par_6']);
  // Art. 239 §5: complementar com art.166 §1º
  addFwdRefs('art_239_par_5', ['art_166_par_1']);
  // Art. 247: retirar citação ao art.41,III (art_41_par_1_sub_3 já adicionado no Lote 3)
  removeFwdRef('art_247', 'art_41_inc_3');
  removeFwdRef('art_247', 'art_41');

  // ── Correções de mapeamento JSON×CF ─────────────────────────────────────
  // Art. 167 inc XII: art_40_par_22 = CF §19 (errado no Lote 3); CF §22 = art_40_par_25
  removeFwdRef('art_167_inc_12', 'art_40_par_22');
  addFwdRefs('art_167_inc_12', ['art_40_par_25']);
  // Art. 239 §5 da CF = art_239_par_6 no JSON (art_239_par_5 = CF §4º)
  removeFwdRef('art_239_par_5', 'art_166_par_1');
  addFwdRefs('art_239_par_6', ['art_166_par_1']);

}


function getLabelRef(id) {
  const item = refMap[id];
  if (!item) return id;
  if (item.tipo === 'externo') return item.label;
  if (item.tipo === 'artigo') return 'Art. ' + item.numero + 'º';
  if (item.tipo === 'inciso' || item.tipo === 'subinciso') {
    const m = item.texto.match(/^([IVXLCDM]+)\s*[-–]/);
    return 'Art. ' + item.artNum + 'º, Inc. ' + (m ? m[1] : '?');
  }
  if (item.tipo === 'paragrafo') {
    const m = item.texto.match(/^(§\s*[\d\-A-Za-z]+[ºo°]?[\-A-Za-z]*|Parágrafo único)/);
    return 'Art. ' + item.artNum + 'º, ' + (m ? m[1] : 'Par.');
  }
  if (item.tipo === 'alinea') {
    const m = item.texto.match(/^([a-z])\)/);
    return 'Art. ' + item.artNum + 'º, al. ' + (m ? m[1] : '?');
  }
  return id;
}

function trunc(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }

function detectarIncisosEspecificos(artId, sourceTexto) {
  const artNum = artId.replace('art_', '');
  const re = new RegExp(
    '\\bart(?:igo|s)?\\.?\\s*' + artNum + '[\\-A-Z]*[ºo°]?\\s*,\\s*((?:[IVXLCDM]+(?:\\s*,\\s*|\\s+e\\s+))*[IVXLCDM]+)',
    'gi'
  );
  const found = [];
  let m;
  while ((m = re.exec(sourceTexto)) !== null) {
    const nums = m[1].split(/\s*,\s*|\s+e\s+/).map(s => s.trim()).filter(Boolean);
    nums.forEach(incNum => {
      Object.values(refMap).forEach(it => {
        if (it.tipo === 'inciso' && it.artId === artId) {
          const mI = it.texto.match(/^([IVXLCDM]+)\s*[-–]/);
          if (mI && mI[1] === incNum && !found.includes(it.id)) found.push(it.id);
        }
      });
    });
  }
  return found.slice(0, 8);
}

function encontrarParagrafoId(artId, parNumStr) {
  // parNumStr: "3", "único", "1-A" etc. (from text "§3º" → "3")
  const norm = parNumStr.toLowerCase().replace(/[ºo°]/g, '').trim();
  for (const it of Object.values(refMap)) {
    if (it.tipo !== 'paragrafo' || it.artId !== artId) continue;
    const m = it.texto.match(/^§\s*([úÚ\d][\w\-]*)[ºo°]?/i);
    if (!m) continue;
    if (m[1].toLowerCase().replace(/[ºo°]/g, '').trim() === norm) return it.id;
  }
  return null;
}

function detectarParagrafoEspecifico(artId, sourceTexto) {
  // Detect "art. N, §M" or "art. N §M" patterns in sourceTexto
  const artNum = refMap[artId] ? refMap[artId].numero : artId.replace('art_', '');
  // Escape for regex: art num can be "5", "5-A" etc.
  const artEsc = artNum.replace(/[-A-Z]/gi, m => '\\' + m);
  const re = new RegExp(
    '\\bart(?:igo|s)?\\.?\\s*' + artEsc + '[ºo°]?\\s*,?\\s*§\\s*([úú\\d][\\w\\-]*)[ºo°]?',
    'gi'
  );
  const found = [];
  let m;
  while ((m = re.exec(sourceTexto)) !== null) {
    const parId = encontrarParagrafoId(artId, m[1]);
    if (parId && !found.includes(parId)) found.push(parId);
  }
  return found;
}

function getTooltipTexto(refId, sourceTexto) {
  const item = refMap[refId];
  if (!item) return '';
  const label = getLabelRef(refId);
  sourceTexto = sourceTexto || '';

  if (item.tipo === 'externo') {
    return '<strong>' + item.label + '</strong>' + trunc(item.texto, 400);
  }

  if (item.tipo === 'inciso' || item.tipo === 'paragrafo' || item.tipo === 'subinciso') {
    const artItem = refMap[item.artId];
    const caput = artItem ? trunc(artItem.texto, 200) : '';
    const sub   = trunc(item.texto, 240);
    return '<strong>' + label + '</strong><em class="tooltip-caput">' + caput + '</em><span class="tooltip-sep">▸</span>' + sub;
  }

  if (item.tipo === 'artigo') {
    let html = '<strong>' + label + '</strong>' + trunc(item.texto, 220);
    if (sourceTexto) {
      // Show specific paragraphs referenced (e.g. "art. 37, §3")
      const parIds = detectarParagrafoEspecifico(refId, sourceTexto);
      if (parIds.length > 0) {
        parIds.forEach(parId => {
          const par = refMap[parId];
          if (par) {
            const mP = par.texto.match(/^(§\s*[\dúÚ][\w\-]*[ºo°]?|Parágrafo único)/i);
            const parLabel = mP ? mP[1] : '§?';
            html += '<div class="tooltip-para-citado"><strong class="tooltip-inc-num">' + parLabel + '</strong> ' + trunc(par.texto.slice((mP ? mP[0].length : 0)).replace(/^\s*[-–]\s*/, ''), 200) + '</div>';
          }
        });
      }
      // Show specific incisos referenced (e.g. "art. 7, incisos I e II")
      const incIds = detectarIncisosEspecificos(refId, sourceTexto);
      if (incIds.length > 0) {
        html += '<div class="tooltip-incisos-citados' + (incIds.length > 5 ? ' tooltip-incisos-multi' : '') + '">';
        incIds.forEach(incId => {
          const inc = refMap[incId];
          if (inc) {
            const mN = inc.texto.match(/^([IVXLCDM]+)\s*[-–]\s*/);
            const resto = mN ? inc.texto.slice(mN[0].length) : inc.texto;
            html += '<div class="tooltip-inc-row"><strong class="tooltip-inc-num">' + (mN ? mN[1] : '?') + '</strong>' + trunc(resto, 100) + '</div>';
          }
        });
        html += '</div>';
      }
    }
    return html;
  }

  if (item.tipo === 'alinea') {
    const artItem = refMap[item.artId];
    const caput = artItem ? trunc(artItem.texto, 180) : '';
    return '<strong>' + label + '</strong><em class="tooltip-caput">' + caput + '</em><span class="tooltip-sep">▸</span>' + trunc(item.texto, 160);
  }

  return '<strong>' + label + '</strong>' + trunc(item.texto, 240);
}

function criarSecaoReferencias(itemId) {
  const fwd = (forwardRefs[itemId] || []).slice(0, 35);
  const bck = (backRefs[itemId]    || []).slice(0, 12);
  if (fwd.length === 0 && bck.length === 0) return null;

  const sourceItem = refMap[itemId];
  const sourceTxt  = sourceItem ? sourceItem.texto : '';

  const sec = document.createElement('div');
  sec.className = 'referencias-section';

  function criarChip(refId, back) {
    const chip = document.createElement('a');
    chip.className   = 'ref-chip' + (back ? ' ref-chip-back' : '');
    chip.href        = '#' + refId;
    chip.textContent = getLabelRef(refId);
    chip.dataset.tooltipHtml = getTooltipTexto(refId, back ? '' : sourceTxt);
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      const el = document.getElementById(refId);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return chip;
  }

  if (fwd.length > 0) {
    const row = document.createElement('div');
    row.className = 'refs-forward';
    const lbl = document.createElement('span');
    lbl.className = 'ref-label';
    lbl.textContent = '📎 Ref.:';
    row.appendChild(lbl);
    fwd.forEach(id => row.appendChild(criarChip(id, false)));
    if ((forwardRefs[itemId] || []).length > 35) {
      const mais = document.createElement('span');
      mais.className = 'ref-chip';
      mais.style.cursor = 'default';
      mais.textContent = '+' + ((forwardRefs[itemId] || []).length - 35);
      row.appendChild(mais);
    }
    sec.appendChild(row);
  }

  if (bck.length > 0) {
    const row = document.createElement('div');
    row.className = 'refs-back';
    const lbl = document.createElement('span');
    lbl.className = 'ref-label ref-label-back';
    lbl.textContent = '⬅ Citado por:';
    row.appendChild(lbl);
    bck.forEach(id => row.appendChild(criarChip(id, true)));
    if ((backRefs[itemId] || []).length > 12) {
      const mais = document.createElement('span');
      mais.className = 'ref-chip ref-chip-back';
      mais.style.cursor = 'default';
      mais.textContent = '+' + ((backRefs[itemId] || []).length - 12);
      row.appendChild(mais);
    }
    sec.appendChild(row);
  }

  return sec;
}

// ─── Tooltip flutuante ────────────────────────────────────────────────────────
function setupTooltip() {
  const tip = document.createElement('div');
  tip.id = 'ref-tooltip';
  document.body.appendChild(tip);

  document.addEventListener('mouseover', (e) => {
    const chip = e.target.closest('.ref-chip');
    if (!chip || !chip.dataset.tooltipHtml) return;
    tip.innerHTML  = chip.dataset.tooltipHtml;
    tip.style.display = 'block';
  });

  document.addEventListener('mousemove', (e) => {
    if (tip.style.display === 'none') return;
    const tx = Math.min(e.clientX + 14, window.innerWidth - 390);
    const ty = e.clientY - tip.offsetHeight - 8;
    tip.style.left = tx + 'px';
    tip.style.top  = (ty < 4 ? e.clientY + 18 : ty) + 'px';
  });

  document.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget || !e.relatedTarget.closest('.ref-chip')) {
      tip.style.display = 'none';
    }
  });
}

// ─── Campo de Anotação — Colapsável ──────────────────────────────────────────
function atualizarContador(textarea) {
  const id   = textarea.dataset.elementoId;
  const cont = document.getElementById('cont_' + id);
  if (cont) cont.textContent = textarea.value.length + ' / 1000';
}

function criarCampoAnotacao(elementoId, textoLabel) {
  const wrapper = document.createElement('div');
  wrapper.className          = 'anotacao-wrapper collapsed';
  wrapper.dataset.elementoId = elementoId;

  const collapsedDiv = document.createElement('div');
  collapsedDiv.className = 'anotacao-collapsed';

  const btnToggle = document.createElement('button');
  btnToggle.className          = 'btn-toggle-anotacao';
  btnToggle.dataset.elementoId = elementoId;
  btnToggle.innerHTML          = '✏️ Anotar';
  collapsedDiv.appendChild(btnToggle);

  const expandedDiv = document.createElement('div');
  expandedDiv.className = 'anotacao-expanded';
  expandedDiv.innerHTML =
    '<div class="anotacao-label">✏️ ' + textoLabel +
    ' <span class="anotacao-contador" id="cont_' + elementoId + '">0 / 1000</span></div>' +
    '<textarea class="anotacao-textarea" data-elemento-id="' + elementoId +
    '" id="ta_' + elementoId + '" maxlength="1000" placeholder="Adicione sua anotação aqui…" rows="3"></textarea>' +
    '<div class="anotacao-rodape">' +
    '<button class="btn-fechar-anotacao">↑ Fechar</button>' +
    '<span class="salvo-feedback" id="fb_' + elementoId + '">✔ Salvo</span>' +
    '<button class="btn-salvar-nota" data-elemento-id="' + elementoId + '">💾 Salvar</button>' +
    '</div>';

  wrapper.appendChild(collapsedDiv);
  wrapper.appendChild(expandedDiv);

  const textarea  = expandedDiv.querySelector('.anotacao-textarea');
  const feedback  = expandedDiv.querySelector('.salvo-feedback');
  const btnSalvar = expandedDiv.querySelector('.btn-salvar-nota');
  const btnFechar = expandedDiv.querySelector('.btn-fechar-anotacao');

  btnToggle.addEventListener('click', () => {
    wrapper.classList.remove('collapsed');
    wrapper.classList.add('expandido');
    textarea.focus();
  });

  btnFechar.addEventListener('click', () => {
    wrapper.classList.remove('expandido');
    wrapper.classList.add('collapsed');
  });

  textarea.addEventListener('input', () => {
    atualizarContador(textarea);
    const tem = textarea.value.trim().length > 0;
    wrapper.classList.toggle('tem-conteudo', tem);
    btnToggle.innerHTML = tem ? '📝 Ver anotação' : '✏️ Anotar';
  });

  btnSalvar.addEventListener('click', async () => {
    if (!currentUser) { mostrarToast('Selecione um usuário antes de salvar.', 'aviso'); return; }
    try {
      await salvarAnotacao(elementoId, textarea.value);
      feedback.classList.add('visivel');
      setTimeout(() => feedback.classList.remove('visivel'), 2000);
      const tem = textarea.value.trim().length > 0;
      wrapper.classList.toggle('tem-conteudo', tem);
      btnToggle.innerHTML = tem ? '📝 Ver anotação' : '✏️ Anotar';
    } catch (e) {
      mostrarToast('Erro ao salvar anotação.', 'erro');
    }
  });

  textarea.addEventListener('blur', async () => {
    if (!currentUser || !textarea.value) return;
    try { await salvarAnotacao(elementoId, textarea.value); } catch (_) {}
  });

  return wrapper;
}

// ─── Utilitários de Highlight ─────────────────────────────────────────────────
function gerarId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getRangeOffsets(range, textEl) {
  function charOffset(container, offset, root) {
    let total = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node === container) return total + offset;
      total += node.nodeValue.length;
    }
    return total + offset; // fallback
  }
  return {
    start: charOffset(range.startContainer, range.startOffset, textEl),
    end:   charOffset(range.endContainer,   range.endOffset,   textEl)
  };
}

const HL_CLASSES = ['artigo-texto','inciso-texto','paragrafo-texto','subinciso-texto','alinea-texto','preambulo-texto'];

function encontrarTextEl(range) {
  let node = range.commonAncestorContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  for (const cls of HL_CLASSES) {
    const el = node.closest('.' + cls);
    if (el && el.dataset.textoOriginal !== undefined) return el;
  }
  return null;
}

function aplicarHighlightsAoEl(textEl) {
  const elId      = textEl.dataset.elementoId;
  const tipoTexto = textEl.dataset.tipoTexto;
  const textoOrig = textEl.dataset.textoOriginal;
  if (textoOrig === undefined) return;

  const key = elId + '::' + tipoTexto;
  const hls = (hlsCache[key] || []).slice().sort((a, b) => a.start - b.start);

  if (hls.length === 0) {
    textEl.textContent = textoOrig;
    return;
  }

  let html = '';
  let pos  = 0;
  hls.forEach(hl => {
    const s = Math.max(hl.start, pos);
    const e = Math.min(hl.end, textoOrig.length);
    if (s >= e) return;
    if (s > pos) html += escHtml(textoOrig.slice(pos, s));
    const cls = hl.formato === 'underline' ? 'hl-underline' : 'hl-' + hl.formato;
    html += '<span class="' + cls + '" data-hl-id="' + hl.id + '">'
          + escHtml(textoOrig.slice(s, e)) + '</span>';
    pos = e;
  });
  if (pos < textoOrig.length) html += escHtml(textoOrig.slice(pos));
  textEl.innerHTML = html;
}

// ─── Variáveis de estado do popup de highlight ────────────────────────────────
let hlPendingRange  = null;
let hlPendingTextEl = null;

function adicionarHighlight(formato) {
  if (!currentUser) { mostrarToast('Selecione um usuário antes de marcar.', 'aviso'); return; }
  if (!hlPendingRange || !hlPendingTextEl) return;

  const { start, end } = getRangeOffsets(hlPendingRange, hlPendingTextEl);
  if (start >= end) return;

  const elId      = hlPendingTextEl.dataset.elementoId;
  const tipoTexto = hlPendingTextEl.dataset.tipoTexto;
  const key       = elId + '::' + tipoTexto;
  const id        = gerarId();
  const hl = {
    chave: `${currentUser}::hl::${id}`,
    usuario: currentUser,
    id,
    elementoId: elId,
    tipoTexto,
    start, end, formato,
    atualizado: Date.now()
  };

  if (!hlsCache[key]) hlsCache[key] = [];
  hlsCache[key].push(hl);
  aplicarHighlightsAoEl(hlPendingTextEl);
  salvarHighlightDB(hl).catch(console.error);
}

function removerHighlightsNoRange() {
  if (!hlPendingTextEl) return;
  const elId      = hlPendingTextEl.dataset.elementoId;
  const tipoTexto = hlPendingTextEl.dataset.tipoTexto;
  const key       = elId + '::' + tipoTexto;

  let toRemove;
  if (hlPendingRange) {
    const { start, end } = getRangeOffsets(hlPendingRange, hlPendingTextEl);
    toRemove = (hlsCache[key] || []).filter(hl => hl.end > start && hl.start < end);
  } else {
    toRemove = (hlsCache[key] || []);
  }

  if (toRemove.length === 0) { mostrarToast('Nenhuma marcação nesta seleção.', 'aviso'); return; }

  const toRemoveIds = new Set(toRemove.map(h => h.id));
  hlsCache[key] = (hlsCache[key] || []).filter(h => !toRemoveIds.has(h.id));
  aplicarHighlightsAoEl(hlPendingTextEl);
  toRemove.forEach(hl => removerHighlightDB(hl.chave).catch(console.error));
  mostrarToast(toRemove.length + ' marcação(ões) removida(s).', 'sucesso');
}

async function carregarEAplicarTodosHighlights() {
  if (!currentUser) return;
  hlsCache = {};
  const hls = await carregarHighlightsPorUsuario(currentUser);
  hls.forEach(hl => {
    const key = hl.elementoId + '::' + hl.tipoTexto;
    if (!hlsCache[key]) hlsCache[key] = [];
    hlsCache[key].push(hl);
  });
  // Apply to all text elements that have textoOriginal stored
  document.querySelectorAll('[data-texto-original]').forEach(el => {
    const key = (el.dataset.elementoId || '') + '::' + (el.dataset.tipoTexto || '');
    if (hlsCache[key] && hlsCache[key].length > 0) {
      aplicarHighlightsAoEl(el);
    }
  });
}

// ─── Popup de seleção / highlight ─────────────────────────────────────────────
function setupSelecaoHighlight() {
  const popup = document.createElement('div');
  popup.id = 'hl-popup';
  popup.innerHTML =
    '<button class="hl-btn" data-formato="yellow" title="Marcador amarelo">🟡</button>' +
    '<button class="hl-btn" data-formato="green"  title="Marcador verde">🟢</button>' +
    '<button class="hl-btn" data-formato="red"    title="Marcador vermelho">🔴</button>' +
    '<button class="hl-btn hl-btn-u" data-formato="underline" title="Sublinhar">U̲</button>' +
    '<div class="hl-sep"></div>' +
    '<button class="hl-btn hl-btn-rm" id="hl-btn-rm" title="Remover marcação">✕</button>';
  document.body.appendChild(popup);

  function esconderPopup() {
    popup.style.display = 'none';
    hlPendingRange  = null;
    hlPendingTextEl = null;
  }

  // Show popup on text selection
  document.addEventListener('mouseup', (e) => {
    if (e.target.closest('#hl-popup')) return;

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      esconderPopup();
      return;
    }

    const range   = sel.getRangeAt(0);
    const textEl  = encontrarTextEl(range);
    if (!textEl) { esconderPopup(); return; }

    hlPendingRange  = range.cloneRange();
    hlPendingTextEl = textEl;

    const rect   = range.getBoundingClientRect();
    const popupW = 196;
    const xRaw   = rect.left + rect.width / 2 - popupW / 2;
    const x      = Math.max(4, Math.min(xRaw, window.innerWidth - popupW - 4));
    const yAbove = rect.top - 52 + window.scrollY;
    const yBelow = rect.bottom + 8 + window.scrollY;
    popup.style.left    = x + 'px';
    popup.style.top     = (yAbove < window.scrollY + 4 ? yBelow : yAbove) + 'px';
    popup.style.display = 'flex';
  });

  // Hide popup on outside click
  document.addEventListener('mousedown', (e) => {
    if (!e.target.closest('#hl-popup')) esconderPopup();
  });

  // Prevent selection loss on button click
  popup.querySelectorAll('.hl-btn').forEach(btn => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
  });

  // Color/underline buttons
  popup.querySelectorAll('.hl-btn[data-formato]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (hlPendingRange && hlPendingTextEl) adicionarHighlight(btn.dataset.formato);
      esconderPopup();
      window.getSelection().removeAllRanges();
    });
  });

  // Remove button
  document.getElementById('hl-btn-rm').addEventListener('click', (e) => {
    e.stopPropagation();
    if (hlPendingTextEl) removerHighlightsNoRange();
    esconderPopup();
    window.getSelection().removeAllRanges();
  });

  // Click on existing highlight span → select + show popup with remove focused
  document.addEventListener('click', (e) => {
    if (e.target.closest('#hl-popup')) return;
    const span = e.target.closest('span[data-hl-id]');
    if (!span) return;
    // Find parent text element
    let textEl = null;
    for (const cls of HL_CLASSES) {
      const found = span.closest('.' + cls);
      if (found && found.dataset.textoOriginal !== undefined) { textEl = found; break; }
    }
    if (!textEl) return;

    hlPendingRange  = null;
    hlPendingTextEl = textEl;

    // Temporarily mock a range covering just this span for removal
    const sel = window.getSelection();
    const r   = document.createRange();
    r.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(r);
    hlPendingRange = r.cloneRange();

    const rect   = span.getBoundingClientRect();
    const popupW = 196;
    const x      = Math.max(4, Math.min(rect.left, window.innerWidth - popupW - 4));
    popup.style.left    = x + 'px';
    popup.style.top     = (rect.top - 52 + window.scrollY) + 'px';
    popup.style.display = 'flex';
  });
}

// ─── Renderização dos elementos ───────────────────────────────────────────────

function criarTextDiv(className, texto, elementoId) {
  const div = document.createElement('div');
  div.className = className;
  div.textContent = texto;
  div.dataset.textoOriginal = texto;
  div.dataset.elementoId    = elementoId;
  div.dataset.tipoTexto     = className;
  return div;
}

function renderizarAlinea(alinea, container, label) {
  const el = document.createElement('div');
  el.className = 'alinea-item';
  el.id        = alinea.id;
  el.appendChild(criarTextDiv('alinea-texto', alinea.texto, alinea.id));
  const refs = criarSecaoReferencias(alinea.id);
  if (refs) el.appendChild(refs);
  el.appendChild(criarCampoAnotacao(alinea.id, label));
  container.appendChild(el);
}

function renderizarSubinciso(sub, container, artNumStr) {
  const el = document.createElement('div');
  el.className = 'subinciso-item';
  el.id        = sub.id;
  const mNum = sub.texto.match(/^([IVXLCDM]+)\s*[-–]/);
  el.appendChild(criarTextDiv('subinciso-texto', sub.texto, sub.id));
  const refs = criarSecaoReferencias(sub.id);
  if (refs) el.appendChild(refs);
  el.appendChild(criarCampoAnotacao(sub.id, 'Inc. ' + (mNum ? mNum[1] : '?') + ' — ' + artNumStr));
  if ((sub.alineas || []).length > 0) {
    const alList = document.createElement('div');
    alList.className = 'alineas-list';
    sub.alineas.forEach(al => {
      const mAl = al.texto.match(/^([a-z])\)/);
      renderizarAlinea(al, alList, 'Alínea ' + (mAl ? mAl[1] : '?') + ' — ' + artNumStr);
    });
    el.appendChild(alList);
  }
  container.appendChild(el);
}

function renderizarInciso(inc, container, numStr) {
  const incItem = document.createElement('div');
  incItem.className = 'inciso-item';
  incItem.id        = inc.id;
  const mInc = inc.texto.match(/^([IVXLCDM]+)\s*[-–]/);
  incItem.appendChild(criarTextDiv('inciso-texto', inc.texto, inc.id));
  const refs = criarSecaoReferencias(inc.id);
  if (refs) incItem.appendChild(refs);
  incItem.appendChild(criarCampoAnotacao(inc.id, 'Inciso ' + (mInc ? mInc[1] : '?') + ' — ' + numStr));
  if ((inc.alineas || []).length > 0) {
    const alList = document.createElement('div');
    alList.className = 'alineas-list';
    inc.alineas.forEach(al => {
      const mAl = al.texto.match(/^([a-z])\)/);
      renderizarAlinea(al, alList, 'Alínea ' + (mAl ? mAl[1] : '?') + ' — ' + numStr);
    });
    incItem.appendChild(alList);
  }
  container.appendChild(incItem);
}

function renderizarParagrafo(par, container, numStr) {
  const parItem = document.createElement('div');
  parItem.className = 'paragrafo-item';
  parItem.id        = par.id;
  const mPar = par.texto.match(/^(§\s*[\d\-A-Za-z]+[ºo°]?[\-A-Za-z]*|Parágrafo único)/);
  parItem.appendChild(criarTextDiv('paragrafo-texto', par.texto, par.id));
  const refs = criarSecaoReferencias(par.id);
  if (refs) parItem.appendChild(refs);
  parItem.appendChild(criarCampoAnotacao(par.id, (mPar ? mPar[1] : 'Parágrafo') + ' — ' + numStr));
  if ((par.incisos || []).length > 0) {
    const incList = document.createElement('div');
    incList.className = 'incisos-list';
    par.incisos.forEach(inc => renderizarInciso(inc, incList, numStr));
    parItem.appendChild(incList);
  }
  if ((par.subitens || []).length > 0) {
    const subList = document.createElement('div');
    subList.className = 'subitens-list';
    par.subitens.forEach(sub => renderizarSubinciso(sub, subList, numStr));
    parItem.appendChild(subList);
  }
  if ((par.alineas || []).length > 0) {
    const alList = document.createElement('div');
    alList.className = 'alineas-list';
    par.alineas.forEach(al => {
      const mAl = al.texto.match(/^([a-z])\)/);
      renderizarAlinea(al, alList, 'Alínea ' + (mAl ? mAl[1] : '?') + ' — ' + numStr);
    });
    parItem.appendChild(alList);
  }
  container.appendChild(parItem);
}

function renderizarArtigo(artigo, container) {
  const artDiv = document.createElement('div');
  artDiv.className = 'artigo-container';
  artDiv.id        = artigo.id;

  const numMatch = artigo.texto.match(/^Art\.\s*(\d+[\-A-Z]*)/);
  const numStr   = numMatch ? 'Art. ' + numMatch[1] + 'º' : 'Artigo';

  artDiv.innerHTML =
    '<div class="artigo-header"><span class="artigo-numero-badge">' + numStr + '</span></div>' +
    '<div class="artigo-body"></div>';

  const body = artDiv.querySelector('.artigo-body');

  // Caput com dataset para highlighting
  body.appendChild(criarTextDiv('artigo-texto', artigo.texto, artigo.id));

  // Referências e anotação do artigo — logo após o caput
  const refsArt = criarSecaoReferencias(artigo.id);
  if (refsArt) body.appendChild(refsArt);
  body.appendChild(criarCampoAnotacao(artigo.id, numStr));

  // Incisos
  if ((artigo.incisos || []).length > 0) {
    const lista = document.createElement('div');
    lista.className = 'incisos-list';
    artigo.incisos.forEach(inc => renderizarInciso(inc, lista, numStr));
    body.appendChild(lista);
  }

  // Parágrafos
  if ((artigo.paragrafos || []).length > 0) {
    const listaPars = document.createElement('div');
    listaPars.className = 'paragrafos-list';
    artigo.paragrafos.forEach(par => renderizarParagrafo(par, listaPars, numStr));
    body.appendChild(listaPars);
  }

  container.appendChild(artDiv);
}

function renderizarSecao(sec, container) {
  const secDiv = document.createElement('div');
  secDiv.className = 'sec-section';
  secDiv.id        = sec.id;
  secDiv.innerHTML =
    '<div class="sec-header"><div class="sec-numero">' + (sec.numero || '') + '</div>' +
    '<div class="sec-nome">' + sec.nome + '</div>' +
    (sec.subtitulo ? '<div class="sec-subtitulo">' + sec.subtitulo + '</div>' : '') +
    '</div>';
  (sec.artigos || []).forEach(art => renderizarArtigo(art, secDiv));
  container.appendChild(secDiv);
}

function renderizarCapitulo(cap, container) {
  const capDiv = document.createElement('div');
  capDiv.className = 'cap-section';
  capDiv.id        = cap.id;
  capDiv.innerHTML =
    '<div class="cap-header"><div class="cap-nome">' + cap.nome + '</div>' +
    (cap.subtitulo ? '<div class="cap-subtitulo">' + cap.subtitulo + '</div>' : '') +
    '</div><div class="cap-body"></div>';
  container.appendChild(capDiv);
  const body = capDiv.querySelector('.cap-body');
  (cap.artigos || []).forEach(art => renderizarArtigo(art, body));
  (cap.secoes  || []).forEach(sec => renderizarSecao(sec, body));
}

// ─── Índice ───────────────────────────────────────────────────────────────────
function renderizarIndice(dados) {
  const tree = document.getElementById('indice-tree');
  tree.innerHTML = '';

  const preamb = document.createElement('div');
  preamb.className = 'indice-titulo-row';
  preamb.innerHTML = '<span class="indice-seta"></span><a href="#preambulo" class="indice-titulo-link" style="font-weight:400;font-style:italic;">Preâmbulo</a>';
  tree.appendChild(preamb);

  dados.titulos.forEach(titulo => {
    const item = document.createElement('div');
    item.className = 'indice-titulo-item';
    const temFilhos = (titulo.capitulos || []).length > 0;

    const row = document.createElement('div');
    row.className = 'indice-titulo-row';
    row.innerHTML =
      '<span class="indice-seta">' + (temFilhos ? '▶' : '') + '</span>' +
      '<a href="#' + titulo.id + '" class="indice-titulo-link" onclick="event.stopPropagation()">' +
      titulo.nome +
      (titulo.subtitulo ? ' <span class="indice-titulo-nome">' + titulo.subtitulo + '</span>' : '') +
      '</a>';

    const capList = document.createElement('div');
    capList.className = 'indice-cap-list';

    if (temFilhos) {
      const seta = row.querySelector('.indice-seta');
      row.addEventListener('click', (e) => {
        if (e.target.tagName === 'A') return;
        const ab = capList.classList.toggle('aberto');
        seta.classList.toggle('aberto', ab);
      });

      titulo.capitulos.forEach(cap => {
        const capItem = document.createElement('div');
        capItem.className = 'indice-cap-item';
        const temSec = (cap.secoes || []).length > 0;

        const capRow = document.createElement('div');
        capRow.className = 'indice-cap-row';
        capRow.innerHTML =
          '<span class="indice-seta">' + (temSec ? '▶' : '') + '</span>' +
          '<a href="#' + cap.id + '" class="indice-cap-link" onclick="event.stopPropagation()">' +
          cap.nome +
          (cap.subtitulo ? ' <span class="indice-cap-nome">' + cap.subtitulo + '</span>' : '') +
          '</a>';

        const secList = document.createElement('div');
        secList.className = 'indice-sec-list';

        if (temSec) {
          const capSeta = capRow.querySelector('.indice-seta');
          capRow.addEventListener('click', (e) => {
            if (e.target.tagName === 'A') return;
            const ab = secList.classList.toggle('aberto');
            capSeta.classList.toggle('aberto', ab);
          });
          (cap.secoes || []).forEach(sec => {
            const secRow = document.createElement('div');
            secRow.className = 'indice-sec-row';
            secRow.innerHTML =
              '<a href="#' + sec.id + '" class="indice-sec-link" onclick="event.stopPropagation()">' +
              sec.nome +
              (sec.subtitulo ? ' <span class="indice-sec-nome">' + sec.subtitulo + '</span>' : '') +
              '</a>';
            secList.appendChild(secRow);
          });
        }

        capItem.appendChild(capRow);
        capItem.appendChild(secList);
        capList.appendChild(capItem);
      });
    }

    item.appendChild(row);
    item.appendChild(capList);
    tree.appendChild(item);
  });
}

// ─── Renderização geral ───────────────────────────────────────────────────────
function renderizarConteudo(dados) {
  const conteudo = document.getElementById('conteudo');
  conteudo.innerHTML = '';

  const buscaDiv = document.createElement('div');
  buscaDiv.id = 'busca-container';
  buscaDiv.innerHTML =
    '<span style="font-family:var(--fonte-ui);font-size:0.8rem;color:#888;white-space:nowrap;">🔍</span>' +
    '<input type="text" id="busca-input" placeholder="Pesquise na Constituição…" />' +
    '<button class="btn-busca" id="btn-busca-exec">Buscar</button>' +
    '<button class="btn-busca" id="btn-busca-limpar" style="background:#888;">✕</button>';
  conteudo.appendChild(buscaDiv);

  if (dados.preambulo) {
    const preamb = document.createElement('div');
    preamb.className = 'preambulo-section';
    preamb.id        = 'preambulo';
    const preambTitulo = document.createElement('div');
    preambTitulo.className = 'preambulo-titulo';
    preambTitulo.textContent = '📜 Preâmbulo';
    preamb.appendChild(preambTitulo);
    preamb.appendChild(criarTextDiv('preambulo-texto', dados.preambulo, 'preambulo'));
    preamb.appendChild(criarCampoAnotacao('preambulo', 'Anotação — Preâmbulo'));
    conteudo.appendChild(preamb);
  }

  dados.titulos.forEach(titulo => {
    const tDiv = document.createElement('div');
    tDiv.className = 'titulo-section';
    tDiv.id        = titulo.id;
    tDiv.innerHTML =
      '<div class="titulo-header"><div>' +
      '<div class="titulo-nome">' + titulo.nome + '</div>' +
      (titulo.subtitulo ? '<div class="titulo-subtitulo">' + titulo.subtitulo + '</div>' : '') +
      '</div></div><div class="titulo-body"></div>';
    conteudo.appendChild(tDiv);

    const body = tDiv.querySelector('.titulo-body');
    (titulo.artigos   || []).forEach(art => renderizarArtigo(art, body));
    (titulo.capitulos || []).forEach(cap => renderizarCapitulo(cap, body));
  });

  const buscaInput = document.getElementById('busca-input');
  document.getElementById('btn-busca-exec').addEventListener('click', () => executarBusca(buscaInput.value));
  buscaInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') executarBusca(buscaInput.value); });
  document.getElementById('btn-busca-limpar').addEventListener('click', () => { buscaInput.value = ''; limparBusca(); });
}

// ─── Busca ────────────────────────────────────────────────────────────────────
function executarBusca(termo) {
  limparBusca();
  const t = termo.trim();
  if (!t) return;
  const escapedT = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escapedT, 'gi');
  const els = document.querySelectorAll(
    '.artigo-texto, .inciso-texto, .paragrafo-texto, .subinciso-texto, .alinea-texto, .preambulo-texto'
  );
  let n = 0;
  els.forEach(el => {
    const textoBase = el.dataset.textoOriginal || el.textContent;
    re.lastIndex = 0;
    if (!re.test(textoBase)) { re.lastIndex = 0; return; }
    re.lastIndex = 0;
    // Build HTML by scanning positions in plain text
    let html = '';
    let pos  = 0;
    let m;
    while ((m = re.exec(textoBase)) !== null) {
      html += escHtml(textoBase.slice(pos, m.index));
      html += '<mark class="highlight">' + escHtml(m[0]) + '</mark>';
      pos = m.index + m[0].length;
    }
    html += escHtml(textoBase.slice(pos));
    el.innerHTML = html;
    n++;
    if (n === 1) {
      const target = el.closest('.artigo-container, .preambulo-section');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    re.lastIndex = 0;
  });
  if (n === 0) mostrarToast('Nenhum resultado para "' + t + '"', 'aviso');
  else mostrarToast(n + ' trecho(s) encontrado(s)', 'sucesso');
}

function limparBusca() {
  // Restore all text elements from their stored original text + user highlights
  document.querySelectorAll('[data-texto-original]').forEach(el => {
    const key = (el.dataset.elementoId || '') + '::' + (el.dataset.tipoTexto || '');
    if (hlsCache[key] && hlsCache[key].length > 0) {
      aplicarHighlightsAoEl(el);
    } else {
      const orig = el.dataset.textoOriginal;
      if (orig !== undefined) el.textContent = orig;
    }
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await abrirDB();
  buildRefMap(CF_DATA);
  buildAllRefs();
  applyManualRefs();

  document.getElementById('loading').style.display = 'none';
  document.getElementById('app').style.display     = 'grid';

  renderizarIndice(CF_DATA);
  renderizarConteudo(CF_DATA);
  setupTooltip();
  setupSelecaoHighlight();

  const usuarioSalvo = localStorage.getItem('cf_usuario');
  if (usuarioSalvo) {
    currentUser = usuarioSalvo;
    document.getElementById('usuario-nome').textContent = usuarioSalvo;
    const anotacoes = await carregarTodasAnotacoes(currentUser);
    preencherCamposDaTela(anotacoes);
    await carregarEAplicarTodosHighlights();
    mostrarToast('Olá, ' + usuarioSalvo + '! Anotações carregadas.', 'sucesso');
  } else {
    setTimeout(() => mostrarModalUsuario(), 500);
  }

  document.getElementById('btn-backup').addEventListener('click', exportarBackup);
  document.getElementById('btn-importar').addEventListener('click', importarBackup);
  document.getElementById('btn-usuario').addEventListener('click', mostrarModalUsuario);
  document.getElementById('btn-confirmar-usuario').addEventListener('click', confirmarUsuario);
  document.getElementById('modal-usuario-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') confirmarUsuario(); });
  document.getElementById('modal-usuario').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-usuario')) fecharModalUsuario();
  });
  document.getElementById('import-file-input').addEventListener('change', (e) => {
    if (e.target.files[0]) processarImportacao(e.target.files[0]);
    e.target.value = '';
  });

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    const alvo = document.querySelector(a.getAttribute('href'));
    if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

document.addEventListener('DOMContentLoaded', init);
