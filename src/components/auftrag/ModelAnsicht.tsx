'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { endungVon, groesseText } from '@/lib/dateien/regeln';

/**
 * پیش‌نمایش سه‌بعدی اسکن‌ها (Spec فاز ۱، بخش F، «ModelViewer»): STL، PLY و OBJ با three.js،
 * زمینهٔ Carbon و مدل Ivory مات؛ چرخاندن، زوم و جابه‌جایی. three.js فقط وقتی بار می‌شود که
 * کسی واقعاً «3D-Ansicht» را باز کند. هر نمایش در Data-Access-Log ثبت می‌شود (`?ansicht=1`).
 */

const ANZEIGBAR = ['stl', 'ply', 'obj'];
const WARNUNG_AB = 100 * 1024 * 1024;

export const istAnzeigbar = (name: string) => ANZEIGBAR.includes(endungVon(name));

export function ModelAnsicht({ dateiId, name, groesse }: { dateiId: string; name: string; groesse: number }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [offen, setOffen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOffen(true);
          dialog.current?.showModal();
        }}
        aria-label={`3D-Ansicht ${name}`}
        className="border-b border-current pb-0.5 text-[13px] text-muted hover:text-white"
      >
        3D-Ansicht
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOffen(false)}
        aria-label={`3D-Ansicht ${name}`}
        className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-black p-0 text-white backdrop:bg-black"
      >
        {offen ? <Betrachter dateiId={dateiId} name={name} groesse={groesse} onSchliessen={() => dialog.current?.close()} /> : null}
      </dialog>
    </>
  );
}

type Zustand = { art: 'warnung' } | { art: 'laedt'; anteil: number | null } | { art: 'fertig' } | { art: 'fehler'; text: string };

function Betrachter({ dateiId, name, groesse, onSchliessen }: { dateiId: string; name: string; groesse: number; onSchliessen: () => void }) {
  const flaeche = useRef<HTMLDivElement>(null);
  const zuruecksetzen = useRef<(() => void) | null>(null);
  const [zustand, setZustand] = useState<Zustand>(groesse > WARNUNG_AB ? { art: 'warnung' } : { art: 'laedt', anteil: 0 });
  // eigener Schalter: der Fortschritt ändert `zustand`, darf das Modell aber nicht neu laden oder abbauen
  const [laden, setLaden] = useState(groesse <= WARNUNG_AB);

  useEffect(() => {
    if (!laden) return;
    let aus = false;
    let aufraeumen = () => {};

    (async () => {
      try {
        // Datei mit Fortschritt laden
        const antwort = await fetch(`/api/dateien/${dateiId}?ansicht=1`);
        if (!antwort.ok || !antwort.body) throw new Error('laden');
        const gesamt = Number(antwort.headers.get('content-length')) || groesse;
        const leser = antwort.body.getReader();
        const teile: Uint8Array[] = [];
        let geladen = 0;
        for (;;) {
          const { done, value } = await leser.read();
          if (done || aus) break;
          teile.push(value);
          geladen += value.length;
          setZustand({ art: 'laedt', anteil: gesamt ? geladen / gesamt : null });
        }
        if (aus) return;
        const daten = new Uint8Array(geladen);
        let pos = 0;
        for (const t of teile) {
          daten.set(t, pos);
          pos += t.length;
        }

        const THREE = await import('three');
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
        const endung = endungVon(name);
        let objekt: InstanceType<typeof THREE.Object3D>;
        const material = new THREE.MeshStandardMaterial({ color: 0xf4f2ef, roughness: 0.78, metalness: 0, side: THREE.DoubleSide });
        if (endung === 'obj') {
          const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
          objekt = new OBJLoader().parse(new TextDecoder().decode(daten));
          objekt.traverse((k) => {
            if (k instanceof THREE.Mesh) {
              k.material = material;
              k.geometry.computeVertexNormals();
            }
          });
        } else {
          let geometrie =
            endung === 'ply'
              ? new (await import('three/examples/jsm/loaders/PLYLoader.js')).PLYLoader().parse(daten.buffer)
              : new (await import('three/examples/jsm/loaders/STLLoader.js')).STLLoader().parse(daten.buffer);
          // STL hat jede Ecke pro Dreieck einzeln: zusammenführen, damit der Scan glatt statt facettiert aussieht
          if (endung === 'stl') {
            const { mergeVertices } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
            geometrie.deleteAttribute('normal');
            geometrie = mergeVertices(geometrie, 1e-4);
          }
          // manche Scanner schreiben leere Normalen (0,0,0): dann bliebe das Modell schwarz
          geometrie.computeVertexNormals();
          objekt = new THREE.Mesh(geometrie, material);
        }

        const box = new THREE.Box3().setFromObject(objekt);
        const groesseBox = box.getSize(new THREE.Vector3());
        const radius = groesseBox.length() / 2;
        if (!Number.isFinite(radius) || radius <= 0) throw new Error('leer');
        objekt.position.sub(box.getCenter(new THREE.Vector3()));

        const huelle = flaeche.current;
        if (!huelle || aus) return;
        const szene = new THREE.Scene();
        szene.background = new THREE.Color(0x050505);
        szene.add(objekt);
        szene.add(new THREE.HemisphereLight(0xf4f2ef, 0x151515, 0.9));
        const kamera = new THREE.PerspectiveCamera(35, huelle.clientWidth / huelle.clientHeight, radius / 100, radius * 200);
        // das Licht folgt der Kamera, damit die angesehene Seite immer hell ist
        const licht = new THREE.DirectionalLight(0xffffff, 1.6);
        licht.position.set(0.4, 0.6, 1);
        kamera.add(licht);
        szene.add(kamera);

        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(huelle.clientWidth, huelle.clientHeight);
        renderer.domElement.setAttribute('role', 'img');
        renderer.domElement.setAttribute('aria-label', `3D-Modell ${name}`);
        huelle.appendChild(renderer.domElement);

        const steuerung = new OrbitControls(kamera, renderer.domElement);
        steuerung.enableDamping = true;
        // Abstand so, dass das ganze Modell mit etwas Rand ins Bild passt
        const abstand = (radius / Math.sin(THREE.MathUtils.degToRad(kamera.fov / 2))) * 1.15;
        const start = () => {
          kamera.position.set(0, -abstand * 0.3, abstand * 0.95);
          kamera.lookAt(0, 0, 0);
          steuerung.target.set(0, 0, 0);
          steuerung.update();
        };
        start();
        zuruecksetzen.current = start;

        let bild = 0;
        const zeichnen = () => {
          steuerung.update();
          renderer.render(szene, kamera);
          bild = requestAnimationFrame(zeichnen);
        };
        zeichnen();
        const beobachter = new ResizeObserver(() => {
          kamera.aspect = huelle.clientWidth / huelle.clientHeight;
          kamera.updateProjectionMatrix();
          renderer.setSize(huelle.clientWidth, huelle.clientHeight);
        });
        beobachter.observe(huelle);
        aufraeumen = () => {
          cancelAnimationFrame(bild);
          beobachter.disconnect();
          steuerung.dispose();
          objekt.traverse((k) => {
            if (k instanceof THREE.Mesh) k.geometry.dispose();
          });
          material.dispose();
          renderer.dispose();
          renderer.domElement.remove();
        };
        setZustand({ art: 'fertig' });
      } catch {
        if (!aus) setZustand({ art: 'fehler', text: 'Die Datei konnte nicht angezeigt werden. Sie können sie herunterladen und in Ihrer Software öffnen.' });
      }
    })();

    return () => {
      aus = true;
      aufraeumen();
    };
    // nur einmal pro Öffnen laden
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laden]);

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto]">
      <div className="page flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-line py-4">
        <p className="min-w-0 truncate text-[15px]">
          {name} <span className="text-[13px] text-muted">· {groesseText(groesse)}</span>
        </p>
        <div className="flex items-center gap-6">
          {zustand.art === 'fertig' ? (
            <Button variant="text" onClick={() => zuruecksetzen.current?.()}>
              Ansicht zurücksetzen
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onSchliessen} autoFocus>
            Schließen
          </Button>
        </div>
      </div>
      <div ref={flaeche} className="relative min-h-0 touch-none">
        {zustand.art !== 'fertig' ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            {zustand.art === 'warnung' ? (
              <div className="max-w-[460px]">
                <p className="text-[18px] font-light">Große Datei ({groesseText(groesse)}).</p>
                <p className="mt-2 text-[15px] text-muted">Das Laden der Vorschau kann einige Zeit dauern.</p>
                <div className="mt-6">
                  <Button
                    onClick={() => {
                      setZustand({ art: 'laedt', anteil: 0 });
                      setLaden(true);
                    }}
                  >
                    Trotzdem laden
                  </Button>
                </div>
              </div>
            ) : zustand.art === 'fehler' ? (
              <p role="alert" className="max-w-[460px] text-[15px]">
                <span className="mr-2 text-rose">!</span>
                {zustand.text}
              </p>
            ) : (
              <p role="status" className="text-[15px] text-muted">
                Wird geladen{zustand.anteil !== null ? ` … ${Math.round(zustand.anteil * 100)} %` : ' …'}
              </p>
            )}
          </div>
        ) : null}
      </div>
      <p className="page border-t border-line py-3 text-[12px] text-muted">Ziehen: drehen · Scrollen oder zwei Finger: zoomen · Rechte Maustaste: verschieben</p>
    </div>
  );
}
