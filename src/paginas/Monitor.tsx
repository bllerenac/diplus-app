/**
 * Monitor del bus: lo que pasa por el cable, tal cual.
 *
 * Es la pantalla con la que se empieza cuando no se sabe todavia que hay al
 * otro lado. Enseña la trama en crudo y, al lado, lo que el protocolo elegido
 * ha sacado de ella: asi se ve de un vistazo si la configuracion esta bien o si
 * se estan leyendo bytes en el sitio equivocado.
 */
import { useEffect, useRef, useState } from 'react';
import {
  IonBackButton, IonButtons, IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
} from '@ionic/react';

import { cargar } from '../nucleo/config';
import { ProblemaPuerto, TramaVista, hardware, hayHardware } from '../nucleo/hardware';
import { Aviso, Bloque, Boton, Vacio } from './piezas';

const MAX_EN_PANTALLA = 120;

export default function Monitor() {
  const [tramas, setTramas] = useState<TramaVista[]>(hardware.tramas());
  const [pausa, setPausa] = useState(false);
  const [problema, setProblema] = useState<ProblemaPuerto | null>(null);
  const pausaRef = useRef(pausa);
  pausaRef.current = pausa;

  const consola = useRef<HTMLDivElement | null>(null);
  const abajo = useRef(true);

  useEffect(() => {
    hardware.ajustarSenales(cargar().senales);
    for (const f of cargar().fuentes) hardware.arrancar(f).catch(() => undefined);

    const quitar = hardware.alRecibir(() => {
      if (!pausaRef.current) setTramas([...hardware.tramas()]);
    });
    const quitarFallos = hardware.alFallar(setProblema);
    return () => {
      quitar();
      quitarFallos();
    };
  }, []);

  /* Solo sigue al final si el usuario ya estaba abajo: si esta mirando una
     trama de hace un rato, el desplazamiento se la quitaria de delante. */
  useEffect(() => {
    const c = consola.current;
    if (c && abajo.current) c.scrollTop = c.scrollHeight;
  }, [tramas]);

  const ultimas = tramas.slice(-MAX_EN_PANTALLA);

  return (
    <IonPage>
      <IonHeader className="ion-no-border">
        <IonToolbar style={{ '--background': 'var(--sur)', '--border-width': '0' } as never}>
          <IonButtons slot="start"><IonBackButton defaultHref="/" text="" /></IonButtons>
          <IonTitle className="font-titulo text-[16px] font-bold">Monitor del bus</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent scrollY={false} style={{ '--background': 'var(--bg)' } as never}>
        {/* Ancho completo: una trama en hexadecimal es una linea larga, y
            en una columna estrecha se parte y deja de leerse de corrido. */}
        <div className="flex h-full flex-col gap-4 p-5">
          {!hayHardware() && (
            <Aviso>Los puertos solo existen en el equipo. Aquí no va a llegar nada.</Aviso>
          )}
          {problema && (
            <Aviso tono="bad">{problema.port}: {problema.message}</Aviso>
          )}

          <Bloque
            className="flex min-h-0 flex-1 flex-col"
            titulo={`${tramas.length.toLocaleString('es-PE')} tramas`}
            accion={
              <div className="flex gap-2">
                <Boton onClick={() => setPausa((v) => !v)}>{pausa ? 'Reanudar' : 'Pausar'}</Boton>
                <Boton
                  variante="tenue"
                  onClick={() => {
                    hardware.limpiar();
                    setTramas([]);
                  }}
                >
                  Limpiar
                </Boton>
              </div>
            }
          >
            <div
              ref={consola}
              onScroll={(e) => {
                const el = e.currentTarget;
                abajo.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
              }}
              className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
            >
              {ultimas.length === 0 && (
                <Vacio>
                  Esperando tramas. Si no llega nada, revisa el cable, los baudios o el bitrate
                  en Configuración.
                </Vacio>
              )}

              {ultimas.map((t) => (
                <article key={t.n} className="rounded-xl border border-line bg-sur2 px-3.5 py-3">
                  <header className="mb-1.5 flex items-center gap-2.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink3">
                    <span className="font-semibold text-acc">{t.puerto}</span>
                    {t.pgn !== undefined && (
                      <span className="text-ink2">
                        PGN 0x{t.pgn.toString(16).toUpperCase()} · SA {t.sa}
                      </span>
                    )}
                    <time className="ml-auto">
                      {new Date(t.at).toLocaleTimeString('es-PE', { hour12: false })}
                    </time>
                  </header>

                  <p className="m-0 break-all font-mono text-[11.5px] leading-relaxed text-ink2">
                    {t.hex}
                  </p>

                  {t.senales.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-line pt-2.5">
                      {t.senales.map((s) => (
                        <span
                          key={s.clave}
                          className="inline-flex items-baseline gap-1.5 rounded-full border border-line2 px-2.5 py-1 text-[11px] text-ink3"
                        >
                          {s.nombre}
                          <b className="cifra text-[12.5px] font-semibold text-ink">
                            {s.valor === null || s.valor === undefined
                              ? s.ambiguo ? 'cero o sin dato' : '—'
                              : typeof s.valor === 'number' ? s.valor.toFixed(3) : String(s.valor)}
                          </b>
                          {s.unidad && <em className="font-mono text-[10px] not-italic">{s.unidad}</em>}
                        </span>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </Bloque>
        </div>
      </IonContent>
    </IonPage>
  );
}
