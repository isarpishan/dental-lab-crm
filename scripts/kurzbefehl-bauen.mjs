// Kurzbefehle für den «Handy-Scanner» bauen und signieren (nur auf dem Mac: `shortcuts sign` braucht macOS).
// خواستهٔ کاربر (۲۵ اکتبر ۲۰۲۶): ساختن دستی Kurzbefehl روی آیفون دو بار نشد؛ حالا فایل آماده از CRM دانلود می‌شود.
//
// «Beleg scannen»: دوربین (`takephoto`) ← کوچک‌کردن تا ۲۴۰۰ پیکسل (Claude عکس بالای ۵ MB را نمی‌خواند) ← JPEG
// (HEIC را Claude نمی‌خواند). کلید دستگاه هنگام نصب پرسیده می‌شود (Import-Frage روی عمل «Text»)، فایل با POST به
// `api/ausgaben/scan` می‌رود و جواب CRM به‌صورت «Mitteilung» دیده می‌شود. نام عمل‌ها و کلیدها از خود macOS
// (WorkflowKit و Kurzbefehl‌های نمونهٔ Apple در Gallery.bundle) خوانده شده‌اند.
//
// ⚠️ عمل اسکن اپ «Dateien» (`com.apple.DocumentsApp.ScanDocument`) امتحان شد و به کار نمی‌آید: فقط اسکنر
// Dateien را باز می‌کند و هیچ فایلی به Kurzbefehl برنمی‌گرداند (روی آیفون کاربر: «Empfangen: 0 Byte»، ۲۵ اکتبر ۲۰۲۶).
//
// اجرا: node scripts/kurzbefehl-bauen.mjs [https://crm.ddl-pishan.at]
// خروجی: src/lib/ausgaben/kurzbefehle/*.shortcut (در git؛ route `api/ausgaben/scan/kurzbefehl` آن‌ها را می‌دهد)
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASIS = process.argv[2] ?? 'https://crm.ddl-pishan.at';
const ZIEL = path.resolve('src/lib/ausgaben/kurzbefehle');
const OBJ = '￼'; // Platzhalter für eine Variable im Text

// ── kleiner Plist-Schreiber (XML; danach mit plutil in binär) ──
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function plist(v, t = '') {
  if (v === true) return `${t}<true/>`;
  if (v === false) return `${t}<false/>`;
  if (typeof v === 'number') return Number.isInteger(v) ? `${t}<integer>${v}</integer>` : `${t}<real>${v}</real>`;
  if (typeof v === 'string') return `${t}<string>${esc(v)}</string>`;
  if (Array.isArray(v)) return v.length ? `${t}<array>\n${v.map((x) => plist(x, t + '\t')).join('\n')}\n${t}</array>` : `${t}<array/>`;
  const k = Object.keys(v);
  return k.length ? `${t}<dict>\n${k.map((x) => `${t}\t<key>${esc(x)}</key>\n${plist(v[x], t + '\t')}`).join('\n')}\n${t}</dict>` : `${t}<dict/>`;
}

// ── Bausteine ──
const ausgabe = (uuid, name) => ({ OutputName: name, OutputUUID: uuid, Type: 'ActionOutput' });
const anhang = (uuid, name) => ({ Value: ausgabe(uuid, name), WFSerializationType: 'WFTextTokenAttachment' });
const text = (s) => ({ Value: { attachmentsByRange: {}, string: s }, WFSerializationType: 'WFTextTokenString' });
const textMit = (uuid, name) => ({ Value: { attachmentsByRange: { '{0, 1}': ausgabe(uuid, name) }, string: OBJ }, WFSerializationType: 'WFTextTokenString' });
const aktion = (id, p) => ({ WFWorkflowActionIdentifier: id, WFWorkflowActionParameters: p });

function kurzbefehl({ aufnahme, dateiUuid, dateiName }) {
  const schluessel = randomUUID().toUpperCase();
  const laden = randomUUID().toUpperCase();
  const aktionen = [
    // 0: Schlüssel (wird beim Hinzufügen gefragt)
    aktion('is.workflow.actions.gettext', { UUID: schluessel, WFTextActionText: '' }),
    ...aufnahme,
    aktion('is.workflow.actions.downloadurl', {
      UUID: laden,
      ShowHeaders: true,
      WFURL: `${BASIS}/api/ausgaben/scan`,
      WFHTTPMethod: 'POST',
      WFHTTPBodyType: 'File',
      WFRequestVariable: anhang(dateiUuid, dateiName),
      WFHTTPHeaders: {
        Value: {
          WFDictionaryFieldValueItems: [{ UUID: randomUUID().toUpperCase(), WFItemType: 0, WFKey: text('Authorization'), WFValue: textMit(schluessel, 'Text') }],
        },
        WFSerializationType: 'WFDictionaryFieldValue',
      },
    }),
    aktion('is.workflow.actions.notification', {
      WFNotificationActionTitle: 'Beleg',
      WFNotificationActionBody: textMit(laden, 'Inhalte von URL'),
      WFNotificationActionSound: true,
    }),
  ];
  return {
    WFQuickActionSurfaces: [],
    WFWorkflowActions: aktionen,
    WFWorkflowClientVersion: '4018.0.4',
    WFWorkflowHasOutputFallback: false,
    WFWorkflowHasShortcutInputVariables: false,
    WFWorkflowIcon: { WFWorkflowIconGlyphNumber: 59726, WFWorkflowIconStartColor: 4282601983 },
    WFWorkflowImportQuestions: [
      {
        ActionIndex: 0,
        Category: 'Parameter',
        DefaultValue: '',
        ParameterKey: 'WFTextActionText',
        Text: 'Schlüssel aus dem CRM einfügen (Einstellungen → Handy-Scanner → »Schlüssel kopieren«, beginnt mit »Bearer ddls_«).',
      },
    ],
    WFWorkflowInputContentItemClasses: [],
    WFWorkflowMinimumClientVersion: 900,
    WFWorkflowMinimumClientVersionString: '900',
    WFWorkflowOutputContentItemClasses: [],
    WFWorkflowTypes: [],
  };
}

const foto = randomUUID().toUpperCase();
const klein = randomUUID().toUpperCase();
const jpeg = randomUUID().toUpperCase();
const VARIANTEN = {
  'Beleg scannen': kurzbefehl({
    aufnahme: [
      aktion('is.workflow.actions.takephoto', { UUID: foto, WFCameraCaptureShowPreview: true, WFPhotoCount: 1 }),
      aktion('is.workflow.actions.image.resize', {
        UUID: klein,
        WFImage: anhang(foto, 'Foto'),
        WFImageResizeKey: 'Longest Edge',
        WFImageResizeLength: '2400',
      }),
      aktion('is.workflow.actions.image.convert', {
        UUID: jpeg,
        WFInput: anhang(klein, 'Bild mit geänderter Größe'),
        WFImageFormat: 'JPEG',
        WFImageCompressionQuality: 0.85,
        WFImagePreserveMetadata: false,
      }),
    ],
    dateiUuid: jpeg,
    dateiName: 'Konvertiertes Bild',
  }),
};

mkdirSync(ZIEL, { recursive: true });
const tmp = mkdtempSync(path.join(tmpdir(), 'kurzbefehl-'));
try {
  for (const [name, inhalt] of Object.entries(VARIANTEN)) {
    const xml = path.join(tmp, `${name}.plist`);
    const roh = path.join(tmp, `${name}.shortcut`);
    writeFileSync(xml, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${plist(inhalt)}\n</plist>\n`);
    execFileSync('plutil', ['-lint', xml], { stdio: 'inherit' });
    execFileSync('plutil', ['-convert', 'binary1', '-o', roh, xml]);
    const aus = path.join(ZIEL, `${name.replace(/ /g, '-')}.shortcut`);
    execFileSync('shortcuts', ['sign', '--mode', 'anyone', '--input', roh, '--output', aus], { stdio: 'inherit' });
    chmodSync(aus, 0o644); // im Image liest der Benutzer `node` die Datei
    console.log(`✓ ${aus}`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
