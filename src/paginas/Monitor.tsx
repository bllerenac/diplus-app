/**
 * Monitor del bus: lo que pasa por el cable, tal cual.
 *
 * Es la pantalla con la que se empieza cuando no se sabe todavia que hay al
 * otro lado. Enseña la trama en crudo y, al lado, lo que el protocolo elegido
 * ha sacado de ella: asi se ve de un vistazo si la configuracion esta bien o
 * si se estan leyendo bytes en el sitio equivocado.
 */
import { useEffect, useRef, useState } from 'react';
import {
  IonBackButton, IonButtons, IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
} from '@ionic/react';
import './Ajustes.css';
import './Monitor.css';

import { cargar } from '../nucleo/config';
import { ProblemaPuerto, TramaVista, hardware, hayHardware } from '../nucleo/hardware';

export default function Monitor() {
  const [tramas, setTramas] = useState<TramaVista[]>(hardware.tramas());
  const [pausa, setPausa] = useState(false);
  const [problema, setProblema] = useState<ProblemaPuerto | null>(null);
  const pausaRef = useRef(pausa);
  pausaRef.current = pausa;

  const consola = useRef<HTMLDivElement | null>(null);
  const abajo = useRef(true);

  useEffect(() => {
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

  const ultimas = tramas.slice(-120);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar className="aj-toolbar">
          <IonButtons slot="start"><IonBackButton defaultHref="/" text="" /></IonButtons>
          <IonTitle>Monitor</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="aj-contenido">
        {!hayHardware() && (
          <p className="aj-aviso">
            Los puertos solo existen en el equipo. Aquí no va a llegar nada.
          </p>
        )}
        {problema && (
          <p className="aj-aviso" style={{ borderLeftColor: 'var(--bad)' }}>
            {problema.port}: {problema.message}
          </p>
        )}

        <section className="aj-bloque">
          <header className="aj-bloque__cab">
            <span className="aj-rotulo">
              {tramas.length.toLocaleString('es-PE')} tramas
            </span>
            <div className="aj-acciones">
              <button className="aj-btn" onClick={() => setPausa((v) => !v)}>
                {pausa ? 'Reanudar' : 'Pausar'}
              </button>
              <button
                className="aj-btn"
                onClick={() => {
                  hardware.limpiar();
                  setTramas([]);
                }}
              >
                Limpiar
              </button>
            </div>
          </header>

          <div
            className="mon-consola"
            ref={consola}
            onScroll={(e) => {
              const el = e.currentTarget;
              abajo.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
            }}
          >
            {ultimas.length === 0 && (
              <p className="aj-vacio" style={{ border: 0 }}>
                Esperando tramas. Si no llega nada, revisa el cable, los baudios o el
                bitrate en Configuración.
              </p>
            )}

            {ultimas.map((t) => (
              <div className="mon-trama" key={t.n}>
                <div className="mon-trama__cab">
                  <span className="mon-puerto">{t.puerto}</span>
                  {t.pgn !== undefined && (
                    <span className="mon-pgn">
                      PGN 0x{t.pgn.toString(16).toUpperCase()} · SA {t.sa}
                    </span>
                  )}
                  <span className="mon-hora">
                    {new Date(t.at).toLocaleTimeString('es-PE', { hour12: false })}
                  </span>
                </div>

                <p className="mon-hex">{t.hex}</p>

                {t.senales.length > 0 && (
                  <div className="mon-senales">
                    {t.senales.map((s) => (
                      <span className="mon-senal" key={s.clave}>
                        {s.nombre}
                        <b>
                          {s.valor === null || s.valor === undefined
                            ? s.ambiguo ? 'cero o sin dato' : '—'
                            : typeof s.valor === 'number'
                              ? s.valor.toFixed(3)
                              : String(s.valor)}
                        </b>
                        {s.unidad && <em>{s.unidad}</em>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </IonContent>
    </IonPage>
  );
}
