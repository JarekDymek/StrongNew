const VOICES = {
  'pl_PL-darkman-medium': { name: 'Darkman', license: 'CC0', tone: 'niski â€¢ mocny' },
  'pl_PL-mc_speech-medium': { name: 'MC Speech', license: 'CC0', tone: 'konferansjer â€¢ wyraÅºny' },
  'pl_PL-mls_6892-low': { name: 'MLS 6892', license: 'CC BY 4.0', tone: 'alternatywny â€¢ lÅ¼ejszy' }
};
const PIPER_MODULE = 'https://esm.sh/@mintplex-labs/piper-tts-web@1.0.5?bundle';
const LAME_MODULE = 'https://esm.sh/lamejs@1.2.1?bundle';
const TRANSFORMERS_MODULE = 'https://esm.sh/@huggingface/transformers@4.2.0?bundle';
const LOCAL_LLM = 'onnx-community/Qwen2-0.5B-Instruct-ONNX';
const DB_NAME = 'strongman-speaker-db';
const DB_VERSION = 1;
const STORE = 'ads';

const $ = id => document.getElementById(id);
let mode = 'exact';
let selectedVoice = localStorage.getItem('speakerVoice') || 'pl_PL-darkman-medium';
let selectedMusic = localStorage.getItem('speakerMusic') || 'pulse';
let current = null;
let installPrompt = null;
let ttsModule = null;
let localAiPipe = null;
let eventAudio = null;
let eventPlayingId = null;
let musicPreviewAudio = null;

function setMessage(text = '', type = '') {
  const el = $('message');
  el.textContent = text;
  el.className = `message ${type}`.trim();
}
function setProgress(percent, visible = true) {
  $('progress').hidden = !visible;
  $('progressBar').style.width = `${Math.max(0, Math.min(100, percent))}%`;
}
function escapeHtml(s='') { return String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function safeFilename(s='nagranie') { return s.normalize('NFKD').replace(/[^\w\s-]/g,'').trim().replace(/\s+/g,'-').toLowerCase() || 'nagranie'; }
function formatDuration(sec=0) { const m=Math.floor(sec/60), s=Math.round(sec%60); return `${m}:${String(s).padStart(2,'0')}`; }
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function currentFormat() { return document.querySelector('input[name="fmt"]:checked')?.value || 'mp3'; }
function musicName(id=selectedMusic) { return ({pulse:'Arena Pulse',glow:'Sponsor Glow',victory:'Victory Bed'})[id] || 'Arena Pulse'; }
function voiceInfo(id=selectedVoice) { return VOICES[id] || VOICES['pl_PL-darkman-medium']; }

async function loadTTS() {
  if (ttsModule) return ttsModule;
  setMessage('Åadowanie lokalnego silnika mowyâ€¦');
  try {
    ttsModule = await import(PIPER_MODULE);
    return ttsModule;
  } catch (e) {
    throw new Error(navigator.onLine ? 'Nie udaÅ‚o siÄ™ zaÅ‚adowaÄ‡ silnika Piper.' : 'Silnik Piper nie jest jeszcze zapisany offline. Uruchom aplikacjÄ™ raz z internetem.');
  }
}

async function checkModels() {
  try {
    const tts = await loadTTS();
    const stored = await tts.stored();
    document.querySelectorAll('[data-ready]').forEach(dot => dot.classList.toggle('ready', stored.includes(dot.dataset.ready)));
    const ready = stored.includes(selectedVoice);
    $('modelState').textContent = ready ? `âœ“ ${voiceInfo().name} jest gotowy offline` : `${voiceInfo().name} wymaga pierwszego pobrania`;
    $('modelState').className = `model-state ${ready ? 'ready' : 'warn'}`;
    $('downloadModelBtn').textContent = ready ? 'âœ“ Wybrany gÅ‚os zapisany' : 'â¬‡ Pobierz wybrany gÅ‚os';
    return stored;
  } catch (e) {
    $('modelState').textContent = navigator.onLine ? 'Nie udaÅ‚o siÄ™ sprawdziÄ‡ modeli' : 'Offline â€” status zostanie sprawdzony przy generowaniu';
    $('modelState').className = 'model-state warn';
    return [];
  }
}

async function downloadVoice(voiceId, progressStart=0, progressSpan=100) {
  const tts = await loadTTS();
  const stored = await tts.stored();
  if (stored.includes(voiceId)) return;
  if (!navigator.onLine) throw new Error('Pierwsze pobranie gÅ‚osu wymaga internetu.');
  await tts.download(voiceId, p => {
    const inner = p.total ? p.loaded / p.total : 0.05;
    const percent = progressStart + inner * progressSpan;
    setProgress(percent, true);
    setMessage(`Pobieranie ${VOICE_INFO_NAME(voiceId)}â€¦ ${Math.round(inner*100)}%`);
  });
}
function VOICE_INFO_NAME(id){ return VOICES[id]?.name || id; }

async function downloadSelectedModel() {
  const btn = $('downloadModelBtn');
  btn.disabled = true;
  try {
    setProgress(1, true);
    await downloadVoice(selectedVoice, 0, 100);
    setProgress(100, true);
    setMessage(`${voiceInfo().name} zapisany. MoÅ¼esz uÅ¼ywaÄ‡ go offline.`, 'ok');
    await checkModels();
  } catch (e) {
    setMessage(`BÅ‚Ä…d pobierania: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    setTimeout(() => setProgress(0, false), 1000);
  }
}

async function downloadAllModels() {
  const btn = $('downloadAllBtn');
  btn.disabled = true; $('downloadModelBtn').disabled = true;
  try {
    const ids = Object.keys(VOICES);
    for (let i=0;i<ids.length;i++) await downloadVoice(ids[i], (i/ids.length)*100, 100/ids.length);
    setProgress(100, true);
    setMessage('Wszystkie trzy gÅ‚osy zapisane offline.', 'ok');
    await checkModels();
  } catch (e) {
    setMessage(`Nie udaÅ‚o siÄ™ pobraÄ‡ wszystkich gÅ‚osÃ³w: ${e.message}`, 'error');
  } finally {
    btn.disabled = false; $('downloadModelBtn').disabled = false;
    setTimeout(() => setProgress(0, false), 1200);
  }
}

function normalizeAdText(text, sponsor, pronunciation, style) {
  let out = text.trim().replace(/\s+/g, ' ');
  if (!out) return out;
  if (mode === 'radio') out = radioPolish(out, sponsor, style);
  if (pronunciation && sponsor) out = out.replace(new RegExp(escapeRegExp(sponsor), 'gi'), pronunciation);
  return out;
}

function radioPolish(text, sponsor='', style='strongman') {
  let s = text.trim().replace(/\s+/g, ' ')
    .replace(/\s*([,;:])\s*/g, '$1 ')
    .replace(/\s*([.!?])\s*/g, '$1 ')
    .replace(/([.!?])(?=[A-ZÄ„Ä†Ä˜ÅÅƒÃ“ÅšÅ¹Å»])/g, '$1 ');
  if (s && !/[.!?]$/.test(s)) s += '.';
  if (sponsor) s = s.replace(new RegExp(escapeRegExp(sponsor), 'gi'), sponsor.toUpperCase());
  if (style === 'arena') s = s.replace(/\. /g, '! ').replace(/, /g, ' â€” ');
  if (style === 'radio') s = s.replace(/; /g, '. ');
  if (style === 'strongman') s = s.replace(/, /g, ',  ');
  return s;
}

function localTemplate({ sponsor, industry, facts, slogan, seconds, style }) {
  const name = (sponsor || 'NASZ PARTNER').trim();
  const fact = (facts || '').trim();
  const trade = (industry || '').trim();
  const end = slogan?.trim() ? ` ${slogan.trim()}.` : '';
  const openings = {
    sport: `Partnerem dzisiejszych zawodÃ³w Strongman jest ${name}.`,
    premium: `Dzisiejsze zawody Strongman wspiera ${name}.`,
    direct: `${name} â€” partner zawodÃ³w Strongman.`
  };
  let body = openings[style] || openings.sport;
  if (trade) body += ` ${trade.charAt(0).toUpperCase()+trade.slice(1)}.`;
  if (fact) body += ` ${fact.replace(/[.!?]+$/,'')}.`;
  if (Number(seconds) >= 20) body += ' DziÄ™kujemy za wsparcie sportu siÅ‚owego i pomoc w organizacji wydarzenia.';
  if (Number(seconds) >= 45) body += ' DziÄ™ki naszym partnerom moÅ¼emy tworzyÄ‡ widowisko na wysokim poziomie i rozwijaÄ‡ polski Strongman.';
  return radioPolish(body + end, name, 'strongman');
}

async function localAiGenerate(input) {
  if (!navigator.onLine && !localAiPipe) throw new Error('Pierwsze pobranie lokalnego modelu AI wymaga internetu.');
  const btn = $('localAiBtn'); btn.disabled = true; btn.textContent = 'Åadowanie AIâ€¦';
  try {
    if (!localAiPipe) {
      const tf = await import(TRANSFORMERS_MODULE);
      localAiPipe = await tf.pipeline('text-generation', LOCAL_LLM, { dtype: 'q4' });
    }
    const prompt = `Napisz tylko gotowy tekst krÃ³tkiej polskiej reklamy sponsora zawodÃ³w Strongman. Nie wymyÅ›laj faktÃ³w. Nazwa: "${input.sponsor}". BranÅ¼a: "${input.industry}". Fakty: "${input.facts}". HasÅ‚o: "${input.slogan}". OkoÅ‚o ${input.seconds} sekund. Styl: ${input.style}. Nie dodawaj naÅ‚owÃ³wi ani komentarzy.€;
    const result = await localAiPipe(prompt, { max_new_tokens: 180, temperature: 0.7, do_sample: true });
    let text = (result[0]?.generated_text || '').trim();
    if (text.includes(prompt)) text = text.slice(text.indexOf(prompt)+prompt.length).trim();
    return text.replace(/^["`]+È˜JÉÙË	ÉÊNÂ‚ˆHš[˜[HÈ‹™\ØX›YH˜[ÙNÈ‹^ÛÛ[H	ĞRHÚØ[šYH8 %ÜÚ›Û˜[™IÎÈBŸB‚˜\Ş[˜È[˜İ[ÛˆÙ[™\˜]TÜYXÚ

^ÈÛÛœİÜÛœÛÜI
	ÜÜÛœÛÜ‰ÊK˜[YKš[J
NØÛÛœİ[œ]I
	İ^	ÊK˜[YKš[J
NÚYŠZ[œ]
\™]\›ˆÙ]Y\ÜØYÙJ	ÕÜ\ŞˆZÜİ™ZÛ[^K‰Ë	Ù\œ›Ü‰ÊNØÛÛœİI
	ÙÙ[™\˜]P‰ÊNØ‹™\ØX›Y]YNÉ
	Ü™\İ[Ø\™	ÊKšY[]YNİ^ÜÙ]›ÙÜ™\ÜÊKYJNØ]ØZ]İÛ›ØY›ÚXÙJÙ[XİY›ÚXÙKŒŠNÜÙ]›ÙÜ™\ÜÊKYJNØÛÛœİÏX]ØZ]ØYÊ
NØÛÛœİ^[›Ü›X[^™PY^
[œ]ÜÛœÛÜ‹k¢{§r&­Š‰ïj[²Ü¥zö¥¹ë-®‰à™©Ü¢{-­¬