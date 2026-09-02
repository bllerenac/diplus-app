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
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './Navegacion.css';

import { Config, cargar } from '../nucleo/config';
import { Posicion, calidad, gps, precisionAproximada } from '../nucleo/gps';
import { ProblemaPuerto, TramaVista, hardware, hayHardware } from '../nucleo/hardware';
import { Senal } from '../nucleo/lecturas';

/** Sin señal, el mapa arranca sobre la mina en vez de en mitad del oceano. */
const INICIO: [number, number] = [-15.4, -75.1];

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
  const [panelAbierto, setPanelAbierto] = useState(true);
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
      center: INICIO,
      zoom: 16,
      zoomControl: false,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(m);

    traza.current = L.polyline([], { color: '#2ee6b0', weight: 3, opacity: 0.55 }).addTo(m);
    marca.current = L.marker(INICIO, { icon: flechaDe(0) }).addTo(m);

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
    if (cfg.gps.activo) gps.arrancar(cfg.gps.ruta).catch(() => undefined);

    return gps.alMoverse((p) => {
      setPos(p);
      const punto: [number, number] = [p.lat, p.lon];
      marca.current?.setLatLng(punto);
      marca.current?.setIcon(flechaDe(p.rumbo));
      traza.current?.setLatLngs(gps.camino());
      if (seguirRef.current) mapa.current?.panTo(punto, { animate: true, duration: 0.4 });
    });
  }, [cfg.gps.activo, cfg.gps.ruta]);

  /* ── Sensores ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    for (const f of cfg.fuentes) hardware.arrancar(f).catch(() => undefined);

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

  const elegidas = useMemo(() => {
    /* Sin nada elegido se enseña lo que haya llegado, para que la pantalla no
       aparezca vacia la primera vez. */
    const claves = cfg.panel.length ? cfg.panel : [...valores.keys()];
    return claves.map((c) => ({ clave: c, senal: valores.get(c), visto: frescura.get(c) }));
  }, [cfg.panel, valores, frescura]);

  return (
    <IonPage>
      <div className="nav-pantalla">
        <div className="nav-mapa" ref={divMapa} />

        <div className="nav-barra">
          <span className="nav-marca">DiPlus</span>

          <span className={`nav-rtk ${cal.tono}`}>
            <i className="nav-punto" />
            {cal.corto}
            {pos && <span style={{ opacity: 0.65 }}>{pos.satelites} sat</span>}
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
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
              <circle cx="12" cy="12" r="3.2" />
              <circle cx="12" cy="12" r="8.2" />
              <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" strokeLinecap="round" />
            </svg>
          </button>

          <button
            className={`nav-boton ${panelAbierto ? 'puesto' : ''}`}
            onClick={() => setPanelAbierto((v) => !v)}
            aria-label="Mostrar u ocultar las lecturas"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <path d="M3 12h4l2-5 3 10 2.5-7 1.8 4H21" />
            </svg>
          </button>

          <button className="nav-boton" onClick={() => router.push('/monitor')} aria-label="Monitor del bus">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <rect x="3" y="4.5" width="18" height="13" rx="2" />
              <path d="M8 21h8M12 17.5V21" />
            </svg>
          </button>

          <button className="nav-boton" onClick={() => router.push('/ajustes')} aria-label="Configuración">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2 2M7.3 16.7l-2 2M18.7 18.7l-2-2M7.3 7.3l-2-2" />
            </svg>
          </button>
        </div>

        <div className="nav-velocidad">
          <b>{velocidad}</b>
          <span>KM/H</span>
        </div>
        <span className="nav-precision">
          {pos ? `${cal.nombre} · ${precisionAproximada(pos.calidad, pos.hdop)}` : 'esperando posición'}
        </span>

        <aside className={`nav-panel ${panelAbierto ? '' : 'oculto'}`}>
          <div className="nav-panel__cab">
            <span className="nav-rotulo">Sensores</span>
            <button className="nav-boton" style={{ width: 30, height: 30 }} onClick={() => setPanelAbierto(false)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          {problema && (
            <p className="nav-aviso">
              {problema.port}: {problema.message}
            </p>
          )}

          <div className="nav-panel__cuerpo">
            {elegidas.length === 0 && (
              <p className="nav-vacio">
                Todavía no hay lecturas.
                <br />
                {hayHardware()
                  ? 'Da de alta una fuente en Configuración y elige qué señales ver aquí.'
                  : 'Esto es una vista previa: los puertos solo existen en el equipo.'}
              </p>
            )}

            {elegidas.map(({ clave, senal, visto }) => {
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
            })}
          </div>
        </aside>
      </div>
    </IonPage>
  );
}
