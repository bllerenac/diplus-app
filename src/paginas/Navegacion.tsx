/**
 * Pantalla principal: el mapa manda y los datos van encima.
 *
 * El orden de importancia esta pensado para mirarse de reojo desde una cabina:
 * primero donde estoy, luego con que precision —RTK fijo no es lo mismo que GPS
 * suelto y confundirlos es creer que se sabe la posicion al centimetro cuando se
 * sabe a metros—, y despues las lecturas que uno haya elegido ver.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { IonPage, useIonRouter } from '@ionic/react';
import { Crosshair, Settings, TerminalSquare } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './Navegacion.css';

import { Config, cargar } from '../nucleo/config';
import { Posicion, calidad, gps, nombreOrigen, precisionAproximada } from '../nucleo/gps';
import { ProblemaPuerto, TramaVista, hardware, hayHardware } from '../nucleo/hardware';
import { registro } from '../nucleo/registro';
import { Senal } from '../nucleo/lecturas';

/**
 * Sin posicion no se pinta ninguna.
 *
 * El mapa arranca alejado sobre el pais y **la flecha no aparece hasta que hay
 * fix de verdad**. Poner un punto por defecto es lo que hacia la version
 * anterior —unas coordenadas fijas de Lima— y es peor que no ensenar nada: una
 * posicion inventada no se distingue de una buena, y quien la mire va a creer
 * que sabe donde esta la maquina.
 */
const VISTA_SIN_FIX: [number, number] = [-9.2, -75.0];
const ZOOM_SIN_FIX = 5;

const flechaDe = (rumbo: number) =>
  L.divIcon({
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    html: `<div class="nav-flecha"><svg width="26" height="26" viewBox="0 0 24 24"
      style="transform: rotate(${rumbo}deg)">
      <path d="M12 2 L19.5 21 L12 16.5 L4.5 21 Z" fill="#2ee6b0" stroke="#07120f" stroke-width="1.2"/>
    </svg></div>`,
  });

export default function Navegacion() {
  const router = useIonRouter();
  const [cfg, setCfg] = useState<Config>(cargar());
  const [pos, setPos] = useState<Posicion | null>(gps.posicion());
  const [valores, setValores] = useState<Map<string, Senal>>(new Map());
  const [frescura, setFrescura] = useState<Map<string, number>>(new Map());
  const [seguir, setSeguir] = useState(true);
  const [problema, setProblema] = useState<ProblemaPuerto | null>(null);
  const [, refrescar] = useState(0);

  const divMapa = useRef<HTMLDivElement | null>(null);
  const mapa = useRef<L.Map | null>(null);
  const marca = useRef<L.Marker | null>(null);
  const traza = useRef<L.Polyline | null>(null);
  const seguirRef = useRef(seguir);
  seguirRef.current = seguir;

  /* ── Mapa ─────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!divMapa.current || mapa.current) return;

    const m = L.map(divMapa.current, {
      center: VISTA_SIN_FIX,
      zoom: ZOOM_SIN_FIX,
      zoomControl: false,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(m);

    traza.current = L.polyline([], { color: '#2ee6b0', weight: 3, opacity: 0.55 }).addTo(m);

    /* Si el usuario arrastra el mapa, deja de seguirle la pista: estara mirando
       otra cosa a proposito. */
    m.on('dragstart', () => setSeguir(false));

    mapa.current = m;
    /* El contenedor acaba de aparecer y Leaflet midio antes de tiempo. */
    setTimeout(() => m.invalidateSize(), 250);

    return () => {
      m.remove();
      mapa.current = null;
    };
  }, []);

  /* ── GPS ──────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (cfg.gps.activo) gps.arrancar(cfg.gps.ruta, cfg.gps.baudios).catch(() => undefined);

    return gps.alMoverse((p) => {
      setPos(p);
      const punto: [number, number] = [p.lat, p.lon];

      /* La flecha nace con la primera posicion buena, no antes. */
      if (!marca.current && mapa.current) {
        marca.current = L.marker(punto, { icon: flechaDe(p.rumbo) }).addTo(mapa.current);
        mapa.current.setView(punto, 17);
      }
      marca.current?.setLatLng(punto);
      marca.current?.setIcon(flechaDe(p.rumbo));
      traza.current?.setLatLngs(gps.camino());
      if (seguirRef.current) mapa.current?.panTo(punto, { animate: true, duration: 0.4 });
    });
  }, [cfg.gps.activo, cfg.gps.ruta, cfg.gps.baudios]);

  /* ── Sensores ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    for (const f of cfg.fuentes) hardware.arrancar(f).catch(() => undefined);

    /* El guardado en la base va con la aplicacion, no con la pantalla de
       ajustes: si solo arrancara al guardar la configuracion, un equipo que se
       enciende y nadie toca no registraria nada. */
    registro.aplicar(cfg.registro);

    const quitarTramas = hardware.alRecibir((t: TramaVista) => {
      setValores((prev) => {
        const m = new Map(prev);
        for (const s of t.senales) m.set(`${t.fuenteId}.${s.clave}`, s);
        return m;
      });
      setFrescura((prev) => {
        const m = new Map(prev);
        for (const s of t.senales) m.set(`${t.fuenteId}.${s.clave}`, t.at);
        return m;
      });
    });

    const quitarFallos = hardware.alFallar(setProblema);
    return () => {
      quitarTramas();
      quitarFallos();
    };
  }, [cfg.fuentes]);

  /* La frescura envejece sola aunque no llegue nada: un valor de hace un minuto
     tiene que dejar de parecer actual. */
  useEffect(() => {
    const t = setInterval(() => refrescar((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, []);

  /* Al volver de ajustes, se recoge lo que se haya cambiado. */
  useEffect(() => {
    const alVolver = () => setCfg({ ...cargar() });
    window.addEventListener('focus', alVolver);
    document.addEventListener('ionViewWillEnter', alVolver);
    return () => {
      window.removeEventListener('focus', alVolver);
      document.removeEventListener('ionViewWillEnter', alVolver);
    };
  }, []);

  const cal = calidad(pos?.calidad ?? 0);
  const velocidad = Math.max(0, Math.round((pos?.velocidad ?? 0) * 3.6));

  /**
   * Las lecturas, agrupadas por la fuente de la que salen.
   *
   * Sueltas no se sabia si un numero venia del RS485 o del bus CAN, y con dos
   * fuentes dando magnitudes parecidas eso se confunde. Cada grupo lleva
   * ademas su propio estado: una fuente puede estar muda mientras la otra va.
   */
  const grupos = useMemo(() => {
    const elegidas = new Set(cfg.panel);

    return cfg.fuentes.map((f) => {
      const claves = [...valores.keys()].filter((c) => c.startsWith(`${f.id}.`));
      const suyas = elegidas.size ? claves.filter((c) => elegidas.has(c)) : claves;
      const ultima = claves.reduce((max, c) => Math.max(max, frescura.get(c) ?? 0), 0);

      return {
        fuente: f,
        viva: ultima > 0 && Date.now() - ultima < 15000,
        nunca: ultima === 0,
        lecturas: suyas.map((c) => ({ clave: c, senal: valores.get(c), visto: frescura.get(c) })),
      };
    });
  }, [cfg.fuentes, cfg.panel, valores, frescura]);

  return (
    <IonPage>
      <div className="nav-pantalla">
        <div className="nav-izquierda">
          <div className="nav-mapa" ref={divMapa} />

        <div className="nav-barra">
          <span className="nav-marca">DiPlus</span>

          <span className={`nav-rtk ${pos?.origen === 'interno' ? 'warn' : cal.tono}`}>
            <i className="nav-punto" />
            {pos?.origen === 'interno' ? 'GPS EQUIPO' : cal.corto}
            {pos?.origen === 'rtk' && <span style={{ opacity: 0.65 }}>{pos.satelites} sat</span>}
          </span>

          <span className="nav-hueco" />

          <button
            className={`nav-boton ${seguir ? 'puesto' : ''}`}
            onClick={() => {
              setSeguir(true);
              if (pos) mapa.current?.setView([pos.lat, pos.lon], 17, { animate: true });
            }}
            aria-label="Centrar en mi posición"
          >
            <Crosshair size={18} strokeWidth={1.9} />
          </button>

          <button className="nav-boton" onClick={() => router.push('/monitor')} aria-label="Monitor del bus">
            <TerminalSquare size={18} strokeWidth={1.9} />
          </button>

          <button className="nav-boton" onClick={() => router.push('/ajustes')} aria-label="Configuración">
            <Settings size={18} strokeWidth={1.9} />
          </button>
        </div>

        {!pos && (
          <div className="nav-sinfix">
            <b>Sin posición</b>
            <span>
              El receptor está buscando satélites. Hasta que enganche no se pinta
              ninguna ubicación: una posición inventada no se distingue de una buena.
            </span>
          </div>
        )}

        {pos && (
          <div className="nav-velocidad">
            <b>{velocidad}</b>
            <span>KM/H</span>
          </div>
        )}
        {pos && (
          <span className="nav-precision">
            {nombreOrigen(pos.origen)} · {precisionAproximada(pos)}
          </span>
        )}

        </div>
        <aside className="nav-panel">
          <div className="nav-panel__cab">
            <span className="nav-rotulo">Sensores</span>
            <span className="nav-panel__cuenta">{grupos.length}</span>
          </div>

          {problema && (
            <p className="nav-aviso">
              {problema.port}: {problema.message}
            </p>
          )}

          <div className="nav-panel__cuerpo">
            {grupos.length === 0 && (
              <p className="nav-vacio">
                Todavía no hay ninguna fuente.
                <br />
                {hayHardware()
                  ? 'Da de alta el RS485 o el bus CAN en Configuración.'
                  : 'Esto es una vista previa: los puertos solo existen en el equipo.'}
              </p>
            )}

            {grupos.map(({ fuente, viva, nunca, lecturas }) => (
              <section className="nav-grupo" key={fuente.id}>
                <header className="nav-grupo__cab">
                  <span className="nav-grupo__nombre">{fuente.nombre}</span>
                  <span className={`nav-estado ${viva ? 'vivo' : nunca ? 'mudo' : 'viejo'}`}>
                    {viva ? 'recibiendo' : nunca ? 'sin datos' : 'callado'}
                  </span>
                </header>

                {lecturas.length === 0 ? (
                  <p className="nav-grupo__vacio">
                    {nunca
                      ? 'Nada ha llegado por aquí todavía.'
                      : 'Sin señales elegidas para esta fuente.'}
                  </p>
                ) : (
                  lecturas.map(({ clave, senal, visto }) => {
                    const edad = visto ? Date.now() - visto : Infinity;
                    const viejo = edad > 10000;
                    const sinDato = senal?.valor === null || senal?.valor === undefined;

                    return (
                      <article
                        key={clave}
                        className={`nav-lectura ${viejo ? 'viejo' : ''} ${sinDato ? 'sin' : ''}`}
                      >
                        <p className="nav-lectura__nombre">{senal?.nombre ?? clave}</p>
                        <p className="nav-lectura__valor">
                          {sinDato ? (
                            senal?.ambiguo ? 'cero o sin dato' : 'sin dato'
                          ) : (
                            <>
                              {typeof senal!.valor === 'number'
                                ? (senal!.valor as number).toFixed(2)
                                : String(senal!.valor)}
                              {senal!.unidad && <small>{senal!.unidad}</small>}
                            </>
                          )}
                        </p>
                        {visto && (
                          <p className="nav-lectura__pie">
                            {viejo ? `HACE ${Math.round(edad / 1000)} S` : 'AHORA'}
                          </p>
                        )}
                      </article>
                    );
                  })
                )}
              </section>
            ))}
          </div>
        </aside>
      </div>
    </IonPage>
  );
}
