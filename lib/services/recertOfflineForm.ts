// Sprint 20: offline / email tenant completion form.
//
// PROBLEM: the tenant completion form previously only lived at a localhost
// Next.js route (/recertification/[caseId]/tenant-completion). Tenants can't
// reach localhost. Management needs to EMAIL the form to a tenant, have them
// fill it out on their own device with NO server, and send back ONE html file.
//
// SOLUTION (two halves):
//   1. OUTBOUND — renderTenantOfflineHtml(schema) serializes the exact same
//      buildTenantFormSchema() the localhost form uses into a single, fully
//      self-contained .html document: inline CSS + vanilla JS, no network, no
//      CDN, no framework. It replicates the conditional follow-up show/hide,
//      requiredWhenVisible validation, and FIELD-DRIVEN signature capture
//      (drawn signature canvas for `signature`, typed initials for `initial`,
//      typed written name for `name`). A "Download my filled form" button
//      bakes the answers into a machine-readable JSON payload embedded in the
//      same html and re-saves it as one file the tenant emails back.
//
//   2. INBOUND — parseOfflineFormPayload(htmlText) reads that embedded JSON
//      WITHOUT executing any script from the (untrusted) returned file, and
//      commitImportedAnswers() validates each answer against the live schema
//      and writes it via the SAME persistence path the localhost form uses
//      (recert_packet_field_values, packet_id "tenant_completion"). Drawn
//      signatures route to recert_packet_signatures so the existing PDF merge
//      overlays them. Unknown field names are ignored; orphaned follow-ups are
//      skipped. Signatures are only written when the tenant actually drew one
//      in the form — nothing is auto-filled.
//
// No "use client": renderTenantOfflineHtml is pure string-building and the
// only browser-only API (DOMParser, in parseOfflineFormPayload) is guarded at
// call time. Client components import this freely; server code can import the
// pure renderer too.

import {
  buildTenantFormSchema,
  saveCompletionResponse,
  loadSavedResponses,
  clearOrphanedFollowups,
  submitCompletionSession,
  isFieldVisible,
  computeDynamicRequired,
  type CompletionFormSchema,
  type CompletionFormField,
} from "./recertCompletionForms";
import { saveRecertPacketSignature } from "./recertPacket";

// ─────────────────────────────────────────────────────────────────────────────
// Escaping helpers — defense in depth even though the file runs offline.
// ─────────────────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escAttr(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** JSON for embedding in a <script> tag: escape "<" so a value containing
 *  "</script>" can never break out of the element. JSON.parse restores it. */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/</g, "\\u003c");
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-field control rendering
// ─────────────────────────────────────────────────────────────────────────────

function fieldDataAttrs(f: CompletionFormField): string {
  const req = f.required ? "1" : "0";
  const reqVis = f.requiredWhenVisible ? "1" : "0";
  // children clear by default unless explicitly preserved
  const clears = f.clearsValueWhenHidden === false ? "0" : (f.parentFieldName ? "1" : "0");
  return [
    ` data-field="${escAttr(f.pdfFieldName)}"`,
    ` data-type="${escAttr(f.fieldType)}"`,
    ` data-page="${f.pageNumber}"`,
    ` data-required="${req}"`,
    ` data-required-visible="${reqVis}"`,
    ` data-clears="${clears}"`,
    ` data-parent="${escAttr(f.parentFieldName ?? "")}"`,
    ` data-trigger="${escAttr(f.parentTriggerValue ?? "")}"`,
    f.resolverPair?.yes ? ` data-resolver-yes="${escAttr(f.resolverPair.yes)}"` : "",
    f.resolverPair?.no ? ` data-resolver-no="${escAttr(f.resolverPair.no)}"` : "",
  ].join("");
}

function renderControl(f: CompletionFormField): string {
  const dv = f.defaultValue ?? "";
  switch (f.fieldType) {
    case "longtext":
      return `<textarea class="fld-area" rows="3" placeholder="Optional">${escHtml(dv)}</textarea>`;
    case "date":
      return `<input class="fld" type="date" value="${escAttr(dv)}">`;
    case "amount":
      return `<input class="fld" type="number" inputmode="decimal" step="0.01" min="0" value="${escAttr(dv)}" placeholder="$ amount">`;
    case "initial":
      return `<input class="fld initial" type="text" maxlength="6" value="${escAttr(dv)}" placeholder="e.g. JD">`;
    case "name":
      return `<input class="fld" type="text" value="${escAttr(dv)}" placeholder="Full legal name">`;
    case "yesno":
      return (
        `<div class="seg">` +
        `<button type="button" class="seg-btn" data-opt="yes">Yes</button>` +
        `<button type="button" class="seg-btn" data-opt="no">No</button>` +
        `</div>` +
        `<input type="hidden" class="seg-value" value="${escAttr(dv)}">`
      );
    case "tristate":
      return (
        `<div class="seg">` +
        `<button type="button" class="seg-btn" data-opt="yes">Yes</button>` +
        `<button type="button" class="seg-btn" data-opt="no">No</button>` +
        `<button type="button" class="seg-btn" data-opt="unknown">Unsure</button>` +
        `</div>` +
        `<input type="hidden" class="seg-value" value="${escAttr(dv)}">`
      );
    case "checkbox":
      return (
        `<label class="cbx"><input type="checkbox"${dv === "true" || dv === "1" || dv === "yes" ? " checked" : ""}> ` +
        `<span>I confirm</span></label>`
      );
    case "select": {
      const opts = (f.options ?? [])
        .map(o => `<option value="${escAttr(o)}"${o === dv ? " selected" : ""}>${escHtml(o)}</option>`)
        .join("");
      return `<select class="fld-select"><option value="">— Select —</option>${opts}</select>`;
    }
    case "signature":
      // Drawn signature. The hidden input always starts empty — we never
      // pre-seed a signature from stored data (signature protection).
      return (
        `<div class="sigwrap">` +
        `<canvas class="sigpad" width="600" height="150"></canvas>` +
        `<div class="sigrow">` +
        `<button type="button" class="sig-clear">Clear signature</button>` +
        `<span class="sig-note">Draw your signature with your mouse or finger.</span>` +
        `</div>` +
        `<input type="hidden" class="sig-data" value="">` +
        `</div>`
      );
    case "text":
    default:
      return `<input class="fld" type="text" value="${escAttr(dv)}" placeholder="Type here">`;
  }
}

function renderField(f: CompletionFormField): string {
  const isChild = Boolean(f.parentFieldName);
  const star = (f.required || f.requiredWhenVisible) ? `<span class="req" title="Required">*</span>` : "";
  return (
    `<div class="field${isChild ? " field-child" : ""}${isChild ? " hidden" : ""}"${fieldDataAttrs(f)}>` +
    `<label class="field-label">${escHtml(f.label)}${star}</label>` +
    (f.context ? `<p class="field-context">${escHtml(f.context)}</p>` : "") +
    renderControl(f) +
    `</div>`
  );
}

function renderSection(s: CompletionFormSchema["sections"][number]): string {
  return (
    `<section class="card">` +
    `<h2 class="section-title">${escHtml(s.title)}</h2>` +
    (s.description ? `<p class="section-desc">${escHtml(s.description)}</p>` : "") +
    `<div class="fields">${s.fields.map(renderField).join("")}</div>` +
    `</section>`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline CSS (no external fonts / no CDN — must work from a file:// attachment)
// ─────────────────────────────────────────────────────────────────────────────

const FORM_CSS = `
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f1f5f9;color:#0f172a;line-height:1.45;-webkit-text-size-adjust:100%}
.wrap{max-width:760px;margin:0 auto;padding:16px 16px 120px}
.topbar{position:sticky;top:0;z-index:20;background:#fff;border-bottom:1px solid #e2e8f0;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.topbar-inner{max-width:760px;margin:0 auto;padding:10px 16px}
.topbar h1{font-size:16px;margin:0;font-weight:700}
.topbar .sub{font-size:12px;color:#64748b;margin-top:2px}
.pbar-track{height:6px;background:#e2e8f0}
.pbar{height:6px;background:#059669;width:0;transition:width .25s}
.plabel{font-size:11px;color:#475569;margin-top:4px;font-variant-numeric:tabular-nums}
.banner{border:1px solid #c4b5fd;background:#f5f3ff;color:#5b21b6;border-radius:8px;padding:12px 14px;font-size:13px;margin:14px 0}
.banner strong{color:#4c1d95}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin:14px 0}
.section-title{font-size:17px;font-weight:700;margin:0 0 4px}
.section-desc{font-size:12.5px;color:#64748b;margin:0 0 12px}
.fields{display:flex;flex-direction:column;gap:14px}
.field{border:1px solid #e2e8f0;background:#f8fafc;border-radius:8px;padding:12px}
.field-child{margin-left:14px;border-left:3px solid #6ee7b7;background:#f0fdf4}
.field-label{display:block;font-size:14px;font-weight:600;margin-bottom:6px}
.req{color:#e11d48;margin-left:3px}
.field-context{font-size:12px;color:#64748b;margin:0 0 8px}
.fld,.fld-area,.fld-select{width:100%;padding:11px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:16px;background:#fff;color:#0f172a}
.fld:focus,.fld-area:focus,.fld-select:focus{outline:2px solid #93c5fd;border-color:#3b82f6}
.fld.initial{max-width:140px;text-transform:uppercase;letter-spacing:.18em;text-align:center;font-weight:700}
.fld-area{resize:vertical;min-height:74px}
.seg{display:flex;gap:8px}
.seg-btn{flex:1;padding:12px;border:1px solid #cbd5e1;background:#fff;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;color:#334155}
.seg-btn.active{background:#047857;border-color:#047857;color:#fff}
.cbx{display:inline-flex;align-items:center;gap:8px;font-size:14px;cursor:pointer}
.cbx input{width:20px;height:20px}
.sigwrap{display:flex;flex-direction:column;gap:8px}
.sigpad{width:100%;height:150px;border:2px dashed #94a3b8;border-radius:8px;background:#fff;touch-action:none;cursor:crosshair}
.sigrow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.sig-clear{padding:7px 12px;border:1px solid #cbd5e1;background:#fff;border-radius:7px;font-size:13px;cursor:pointer}
.sig-note{font-size:11.5px;color:#64748b}
.hidden{display:none !important}
.missing-flag{outline:2px solid #f43f5e;outline-offset:2px}
.footer-bar{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #e2e8f0;box-shadow:0 -2px 8px rgba(0,0,0,.06);padding:12px 16px;z-index:25}
.footer-inner{max-width:760px;margin:0 auto;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.btn-primary{flex:1;min-width:200px;padding:14px;background:#0f172a;color:#fff;border:none;border-radius:9px;font-size:15px;font-weight:700;cursor:pointer}
.btn-primary:hover{background:#1e293b}
#save-state{font-size:12px;color:#475569}
.legal{font-size:11px;color:#94a3b8;margin:18px 4px 0;line-height:1.5}
.gmail-warn{border:2px solid #f59e0b;background:#fef3c7;border-radius:8px;padding:12px 14px;font-size:13px;margin:0 0 14px;color:#78350f}
.gmail-warn strong{display:block;font-size:14px;font-weight:700;margin-bottom:4px}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Inline client JS. IMPORTANT: written WITHOUT template literals and without
// the "${" sequence so it survives being embedded in this TS template literal,
// and contains no literal "</script>" so it serializes cleanly on re-save.
// ─────────────────────────────────────────────────────────────────────────────

const CLIENT_JS = `
(function(){
  "use strict";
  var META = window.__RECERT_META__ || {};
  function all(sel, root){ return Array.prototype.slice.call((root||document).querySelectorAll(sel)); }
  var wraps = all("[data-field]");
  var byName = {};
  wraps.forEach(function(w){ byName[w.getAttribute("data-field")] = w; });

  function getVal(w){
    var t = w.getAttribute("data-type");
    if (t === "yesno" || t === "tristate"){ var h = w.querySelector("input.seg-value"); return h ? h.value : ""; }
    if (t === "checkbox"){ var c = w.querySelector("input[type=checkbox]"); return c && c.checked ? "true" : "false"; }
    if (t === "select"){ var s = w.querySelector("select"); return s ? s.value : ""; }
    if (t === "longtext"){ var a = w.querySelector("textarea"); return a ? a.value : ""; }
    if (t === "signature"){ var d = w.querySelector("input.sig-data"); return d ? d.value : ""; }
    var i = w.querySelector("input.fld"); return i ? i.value : "";
  }
  function setSeg(w, val){
    var h = w.querySelector("input.seg-value"); if (h) h.value = val || "";
    all(".seg-btn", w).forEach(function(b){
      if (b.getAttribute("data-opt") === val) b.classList.add("active"); else b.classList.remove("active");
    });
  }
  function setVal(w, val){
    var t = w.getAttribute("data-type");
    if (t === "yesno" || t === "tristate"){ setSeg(w, val); return; }
    if (t === "checkbox"){ var c = w.querySelector("input[type=checkbox]"); if (c) c.checked = (val === "true" || val === "1" || val === "yes"); return; }
    if (t === "select"){ var s = w.querySelector("select"); if (s) s.value = val || ""; return; }
    if (t === "longtext"){ var a = w.querySelector("textarea"); if (a) a.value = val || ""; return; }
    if (t === "signature"){ var d = w.querySelector("input.sig-data"); if (d) d.value = val || ""; drawSig(w, val); return; }
    var i = w.querySelector("input.fld"); if (i) i.value = val || "";
  }

  function drawSig(w, data){
    var canvas = w.querySelector("canvas.sigpad"); if (!canvas) return;
    var ctx = canvas.getContext("2d"); ctx.clearRect(0,0,canvas.width,canvas.height);
    if (!data || data.indexOf("data:image") !== 0) return;
    var img = new Image();
    img.onload = function(){ ctx.drawImage(img, 0, 0, canvas.width, canvas.height); };
    img.src = data;
  }
  function initSig(w){
    var canvas = w.querySelector("canvas.sigpad");
    var hidden = w.querySelector("input.sig-data");
    var clearBtn = w.querySelector(".sig-clear");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0f172a";
    var drawing = false, last = null, dirty = false;
    function pos(e){
      var r = canvas.getBoundingClientRect();
      var t = (e.touches && e.touches[0]) ? e.touches[0] : e;
      return { x: (t.clientX - r.left) * (canvas.width / r.width), y: (t.clientY - r.top) * (canvas.height / r.height) };
    }
    function start(e){ drawing = true; last = pos(e); if (e.cancelable) e.preventDefault(); }
    function move(e){
      if (!drawing) return; var p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p; dirty = true; if (e.cancelable) e.preventDefault();
    }
    function end(){ if (!drawing) return; drawing = false; if (dirty){ hidden.value = canvas.toDataURL("image/png"); onChange(); } }
    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start, {passive:false});
    canvas.addEventListener("touchmove", move, {passive:false});
    canvas.addEventListener("touchend", end);
    if (clearBtn) clearBtn.addEventListener("click", function(){ ctx.clearRect(0,0,canvas.width,canvas.height); hidden.value = ""; onChange(); });
  }

  function refreshVisibility(){
    wraps.forEach(function(w){
      var parent = w.getAttribute("data-parent"); if (!parent) return;
      var trigger = w.getAttribute("data-trigger");
      var pw = byName[parent]; var pv = pw ? getVal(pw) : "";
      if (pv === trigger){ w.classList.remove("hidden"); }
      else { w.classList.add("hidden"); if (w.getAttribute("data-clears") === "1" && getVal(w) !== "") setVal(w, ""); }
    });
  }
  function updateProgress(){
    var total = 0, done = 0;
    wraps.forEach(function(w){
      if (w.classList.contains("hidden")) return;
      var req = w.getAttribute("data-required") === "1" || w.getAttribute("data-required-visible") === "1";
      if (!req) return; total++;
      if (getVal(w) !== "") done++;
    });
    var pct = total === 0 ? 100 : Math.round(done / total * 100);
    var bar = document.getElementById("pbar"); if (bar) bar.style.width = pct + "%";
    var lbl = document.getElementById("plabel"); if (lbl) lbl.textContent = done + " of " + total + " required fields complete (" + pct + "%)";
  }
  function onChange(){ refreshVisibility(); updateProgress(); }

  function collect(){
    var answers = {}; var missing = [];
    wraps.forEach(function(w){
      if (w.classList.contains("hidden")) return;
      var name = w.getAttribute("data-field");
      var val = getVal(w);
      var req = w.getAttribute("data-required") === "1" || w.getAttribute("data-required-visible") === "1";
      if (req && val === "") missing.push(w);
      if (val !== ""){
        var y = w.getAttribute("data-resolver-yes"); var n = w.getAttribute("data-resolver-no");
        var pair = (y || n) ? { yes: y || null, no: n || null } : null;
        answers[name] = {
          value: val,
          fieldType: w.getAttribute("data-type"),
          pageNumber: parseInt(w.getAttribute("data-page"), 10) || 0,
          parentFieldName: w.getAttribute("data-parent") || null,
          parentTriggerValue: w.getAttribute("data-trigger") || null,
          resolverPair: pair,
          isSignature: w.getAttribute("data-type") === "signature"
        };
      }
    });
    return { answers: answers, missing: missing };
  }

  function download(){
    all(".missing-flag").forEach(function(e){ e.classList.remove("missing-flag"); });
    var res = collect();
    var complete = res.missing.length === 0;
    if (!complete){
      res.missing.forEach(function(w){ w.classList.add("missing-flag"); });
      var ok = window.confirm(res.missing.length + " required field(s) are still empty. Save as a DRAFT anyway? You can reopen this file later, finish it, and download again.");
      if (!ok){ if (res.missing[0]) res.missing[0].scrollIntoView({behavior:"smooth", block:"center"}); return; }
    }
    var payload = { caseId: META.caseId, templateId: META.templateId, role: META.role, complete: complete, savedAt: new Date().toISOString(), answers: res.answers };
    var scriptEl = document.getElementById("recert-tenant-payload");
    scriptEl.textContent = JSON.stringify(payload, null, 2).replace(/</g, "\\\\u003c");
    var statusEl = document.getElementById("save-state");
    if (statusEl) statusEl.textContent = complete ? "\\u2713 Completed \\u2014 email this file back to your property manager." : "Draft saved \\u2014 some required fields are still empty.";
    var html = "<!DOCTYPE html>\\n" + document.documentElement.outerHTML;
    var blob = new Blob([html], {type: "text/html;charset=utf-8"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a"); a.href = url;
    var safe = (META.tenantName || "tenant").replace(/[^a-z0-9]+/gi, "_");
    a.download = "LAHD-recert-" + safe + (complete ? "-COMPLETED" : "-DRAFT") + ".html";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
  }

  function wire(){
    wraps.forEach(function(w){
      var t = w.getAttribute("data-type");
      if (t === "yesno" || t === "tristate"){
        all(".seg-btn", w).forEach(function(b){
          b.addEventListener("click", function(){ setSeg(w, b.getAttribute("data-opt")); onChange(); });
        });
        setSeg(w, getVal(w));
      } else if (t === "signature"){ initSig(w); }
      else if (t === "checkbox"){ var c = w.querySelector("input[type=checkbox]"); if (c) c.addEventListener("change", onChange); }
      else if (t === "select"){ var s = w.querySelector("select"); if (s) s.addEventListener("change", onChange); }
      else if (t === "longtext"){ var a = w.querySelector("textarea"); if (a) a.addEventListener("input", onChange); }
      else {
        var i = w.querySelector("input.fld");
        if (i){
          if (t === "initial") i.addEventListener("input", function(){ var p = i.selectionStart; i.value = i.value.toUpperCase(); try { i.setSelectionRange(p, p); } catch(e){} });
          i.addEventListener("input", onChange);
          i.addEventListener("change", onChange);
        }
      }
    });
    var dl = document.getElementById("download-btn"); if (dl) dl.addEventListener("click", download);
  }

  function hydrate(){
    var scriptEl = document.getElementById("recert-tenant-payload"); var data = null;
    try { data = JSON.parse(scriptEl.textContent || "{}"); } catch(e){ data = null; }
    if (data && data.answers){
      Object.keys(data.answers).forEach(function(name){
        var w = byName[name]; if (!w) return;
        var a = data.answers[name];
        setVal(w, (a && typeof a === "object") ? a.value : a);
      });
    }
    refreshVisibility(); updateProgress();
  }

  wire(); hydrate();
})();
`;

// ─────────────────────────────────────────────────────────────────────────────
// Outbound: full self-contained HTML document
// ─────────────────────────────────────────────────────────────────────────────

export function renderTenantOfflineHtml(schema: CompletionFormSchema): string {
  const cs = schema.caseSummary;
  const meta = {
    caseId: schema.caseId,
    templateId: schema.templateId,
    role: schema.role,
    tenantName: cs.tenantName,
    unitNumber: cs.unitNumber ?? "",
    propertyName: cs.propertyName,
  };
  const initialPayload = {
    caseId: schema.caseId,
    templateId: schema.templateId,
    role: schema.role,
    complete: false,
    savedAt: null as string | null,
    answers: {} as Record<string, unknown>,
  };
  const sectionsHtml = schema.sections.map(renderSection).join("");
  const unitLine = cs.unitNumber ? ` &middot; Unit ${escHtml(cs.unitNumber)}` : "";

  return (
    `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LAHD Recertification — ${escHtml(cs.tenantName)}</title>
<style>${FORM_CSS}</style>
</head>
<body>
<div class="topbar">
  <div class="topbar-inner">
    <h1>LAHD Recertification — ${escHtml(cs.tenantName)}${unitLine}</h1>
    <div class="sub">${escHtml(cs.propertyName)}</div>
    <div class="plabel" id="plabel">0 required fields complete</div>
  </div>
  <div class="pbar-track"><div class="pbar" id="pbar"></div></div>
</div>

<div class="wrap">
  <div class="gmail-warn">
    <strong>&#x26A0; Seeing code or scrambled text?</strong>
    Your email app may be showing the raw file instead of the form.
    Please <strong>save this attachment to your device</strong>, then open it in Chrome, Safari, or Firefox.
    The form works fully offline once open &#x2014; no internet needed.
  </div>
  <div class="banner">
    <strong>How this works.</strong> Fill out the form below on your own device &#x2014; no internet needed.
    When you are done, tap <strong>Download my filled form</strong> at the bottom and email the saved
    file back to your property manager. Your answers stay on your device until you send the file.
  </div>

  ${sectionsHtml}

  <p class="legal">
    This form collects information for your LAHD affordable-housing recertification. Your property
    manager will review every answer. Drawing your signature here authorizes it to be placed on your
    recertification packet. This is not legal advice.
  </p>
</div>

<div class="footer-bar">
  <div class="footer-inner">
    <span id="save-state">Not yet saved.</span>
    <button type="button" class="btn-primary" id="download-btn">Download my filled form &darr;</button>
  </div>
</div>

<script type="application/json" id="recert-tenant-payload">${jsonForScript(initialPayload)}</script>
<script>window.__RECERT_META__ = ${jsonForScript(meta)};</script>
<script>${CLIENT_JS}</script>
</body>
</html>`
  );
}

/** Build the full offline HTML for a case, plus a suggested filename. */
export async function buildTenantOfflineHtml(
  caseId: string,
): Promise<{ html: string; filename: string; schema: CompletionFormSchema } | null> {
  const schema = await buildTenantFormSchema(caseId);
  if (!schema) return null;
  const html = renderTenantOfflineHtml(schema);
  const safe = (schema.caseSummary.tenantName || "tenant").replace(/[^a-z0-9]+/gi, "_");
  return { html, filename: `LAHD-recert-${safe}-FILLABLE.html`, schema };
}

// ─────────────────────────────────────────────────────────────────────────────
// Inbound: parse the returned file + commit answers
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedOfflineForm {
  caseId: string;
  templateId: string;
  role: string;
  complete: boolean;
  savedAt: string | null;
  answers: Record<string, { value: string; fieldType?: string; isSignature?: boolean }>;
}

/**
 * Parse the embedded JSON payload from a returned form file. Uses DOMParser,
 * which does NOT execute scripts in the parsed document, so opening an
 * untrusted returned file is safe. We only read the known payload <script>.
 */
export function parseOfflineFormPayload(htmlText: string): ParsedOfflineForm {
  if (typeof DOMParser === "undefined") {
    throw new Error("Form import is only available in the browser.");
  }
  const doc = new DOMParser().parseFromString(htmlText, "text/html");
  const el = doc.getElementById("recert-tenant-payload");
  if (!el) {
    throw new Error("No recertification data found in this file. Make sure you uploaded the returned LAHD form (the .html the tenant sent back).");
  }
  let data: unknown;
  try {
    data = JSON.parse(el.textContent || "{}");
  } catch {
    throw new Error("The embedded form data is corrupted and could not be read.");
  }
  const d = data as Record<string, unknown>;
  if (!d || typeof d !== "object" || !d.caseId) {
    throw new Error("This file is missing its case identifier — it may not be a returned LAHD form.");
  }
  const rawAnswers = (d.answers && typeof d.answers === "object" ? d.answers : {}) as Record<string, unknown>;
  const answers: ParsedOfflineForm["answers"] = {};
  for (const k of Object.keys(rawAnswers)) {
    const a = rawAnswers[k];
    if (a && typeof a === "object") {
      const o = a as Record<string, unknown>;
      answers[k] = {
        value: String(o.value ?? ""),
        fieldType: typeof o.fieldType === "string" ? o.fieldType : undefined,
        isSignature: Boolean(o.isSignature),
      };
    } else {
      answers[k] = { value: String(a ?? "") };
    }
  }
  return {
    caseId: String(d.caseId),
    templateId: String(d.templateId ?? ""),
    role: String(d.role ?? "tenant"),
    complete: Boolean(d.complete),
    savedAt: typeof d.savedAt === "string" ? d.savedAt : null,
    answers,
  };
}

export interface ImportResult {
  ok: boolean;
  written: number;
  signatures: number;
  skippedOrphans: number;
  skippedUnknown: number;
  clearedOrphans: number;
  error?: string;
}

/**
 * Validate the parsed answers against the LIVE tenant schema and write them
 * with the same persistence path the localhost form uses. Only fields that
 * exist in the schema are written (the file cannot inject arbitrary keys).
 * Orphaned follow-ups are skipped. Drawn signatures route to the signature
 * overlay table — and only when the tenant actually drew one.
 */
export async function commitImportedAnswers(args: {
  caseId: string;
  parsed: ParsedOfflineForm;
  actorName?: string;
}): Promise<ImportResult> {
  const base: ImportResult = { ok: false, written: 0, signatures: 0, skippedOrphans: 0, skippedUnknown: 0, clearedOrphans: 0 };

  if (args.parsed.caseId !== args.caseId) {
    return { ...base, error: `This form is for case "${args.parsed.caseId}", but you are importing into "${args.caseId}". Open the matching case and try again.` };
  }

  const schema = await buildTenantFormSchema(args.caseId);
  if (!schema) return { ...base, error: "Case not found, or you do not have access." };

  const fieldByName = new Map<string, CompletionFormField>();
  for (const s of schema.sections) for (const f of s.fields) fieldByName.set(f.pdfFieldName, f);

  const ans = args.parsed.answers;
  const answerValue = (name: string) => ans[name]?.value ?? "";
  const actorName = args.actorName ?? "Offline import";

  let written = 0, signatures = 0, skippedOrphans = 0, skippedUnknown = 0;

  for (const name of Object.keys(ans)) {
    const def = fieldByName.get(name);
    if (!def) { skippedUnknown += 1; continue; }          // ignore unknown keys
    const value = ans[name].value;
    if (value === "" || value == null) continue;

    // Orphan guard: a follow-up whose parent isn't at its trigger is skipped.
    if (def.parentFieldName && def.parentTriggerValue) {
      if (answerValue(def.parentFieldName) !== def.parentTriggerValue) { skippedOrphans += 1; continue; }
    }

    if (def.fieldType === "signature") {
      // Only a real drawn PNG counts as a signature — never auto-filled.
      if (value.startsWith("data:image/")) {
        await saveRecertPacketSignature({
          caseId: args.caseId, packetId: "exact_form", sectionKey: "applicant_statement",
          signerRole: "tenant", signerName: answerValue("11-HouseholdMemberName") || actorName, signatureDataUrl: value,
        });
        await saveRecertPacketSignature({
          caseId: args.caseId, packetId: "exact_form", sectionKey: "conflict_of_interest",
          signerRole: "tenant", signerName: answerValue("16-HHMbrName") || actorName, signatureDataUrl: value,
        });
        signatures += 1;
        // Record a marker so progress + audit reflect a captured signature.
        await saveCompletionResponse({
          caseId: args.caseId, role: "tenant", pdfFieldName: name, pageNumber: def.pageNumber, fieldType: "signature",
          valueText: "[drawn signature captured]",
          valueJson: { fieldType: "signature", pageNumber: def.pageNumber, label: def.label, source: "offline_import", importedAt: new Date().toISOString(), actorRole: "tenant", actorName },
          actorRole: "tenant", actorName,
        });
        written += 1;
      }
      continue;
    }

    const res = await saveCompletionResponse({
      caseId: args.caseId, role: "tenant", pdfFieldName: name, pageNumber: def.pageNumber, fieldType: def.fieldType,
      valueText: value,
      valueJson: {
        fieldType: def.fieldType, pageNumber: def.pageNumber, label: def.label,
        resolverPair: def.resolverPair, parentFieldName: def.parentFieldName, parentTriggerValue: def.parentTriggerValue,
        source: "offline_import", importedAt: new Date().toISOString(), actorRole: "tenant", actorName,
      },
      actorRole: "tenant", actorName,
    });
    if (res.ok) written += 1;
  }

  // Clean up any previously-stored follow-ups now orphaned by this import.
  let clearedOrphans = 0;
  try {
    const responses = await loadSavedResponses(args.caseId, "tenant");
    const cleared = await clearOrphanedFollowups({ caseId: args.caseId, role: "tenant", schema, responses });
    clearedOrphans = cleared.length;
  } catch { /* non-fatal */ }

  // If the tenant marked the form complete, record a submitted session + audit.
  if (args.parsed.complete) {
    try {
      const responses = await loadSavedResponses(args.caseId, "tenant");
      const totalRequired = computeDynamicRequired(schema.sections, responses);
      let completed = 0;
      for (const s of schema.sections) for (const f of s.fields) {
        if (!isFieldVisible(f, responses)) continue;
        if (!(f.required || f.requiredWhenVisible)) continue;
        if ((responses.get(f.pdfFieldName) ?? "") !== "") completed += 1;
      }
      await submitCompletionSession({ caseId: args.caseId, role: "tenant", submittedBy: actorName, totalRequired, completed });
    } catch { /* non-fatal */ }
  }

  return { ok: true, written, signatures, skippedOrphans, skippedUnknown, clearedOrphans };
}
