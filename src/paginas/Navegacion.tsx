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
import * as Iconos from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './Navegacion.css';

import { Config, cargar } from '../nucleo/config';
import { Posicion, calidad, gps, nombreOrigen, precisionAproximada } from '../nucleo/gps';
import { ProblemaPuerto, TramaVista, hardware, hayHardware } from '../nucleo/hardware';
import { registro } from '../nucleo/registro';
import { Senal } from '../nucleo/lecturas';
import { calcular, nuevaTarjeta, texto, titulo } from '../nucleo/panel';
import { maqueta } from '../nucleo/maqueta';
import { guardado } from '../nucleo/servidor';

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

/**
 * La flecha de la maquina.
 *
 * Con el mapa girando, la flecha **no rota**: siempre apunta hacia arriba,
 * porque arriba es siempre hacia donde se va. Lleva delante un haz que abre en
 * la direccion de marcha, que es lo que da la sensacion de ir mirando la pista
 * y no un plano.
 */
const FLECHA = L.divIcon({
  className: '',
  iconSize: [72, 96],
  iconAnchor: [36, 62],
  html: `<div class="nav-yo">
    <svg viewBox="0 0 72 96" width="72" height="96">
      <defs>
        <linearGradient id="haz" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="#2ee6b0" stop-opacity="0.34"/>
          <stop offset="1" stop-color="#2ee6b0" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="M36 60 L4 6 A 46 46 0 0 1 68 6 Z" fill="url(#haz)"/>
      <circle cx="36" cy="62" r="17" fill="#07120f" opacity="0.55"/>
      <path d="M36 46 L48 74 L36 67 L24 74 Z" fill="#2ee6b0" stroke="#07120f" stroke-width="2.5"
        stroke-linejoin="round"/>
    </svg>
  </div>`,
});

/**
 * El icono de una tarjeta, buscado por nombre en lucide.
 *
 * Se resuelve aqui y no en el nucleo porque el nucleo no sabe de React. Si el
 * nombre no existe no se pinta nada: mejor sin icono que con uno equivocado.
 */
function IconoTarjeta({ nombre, size = 15 }: { nombre: string; size?: number }) {
  if (!nombre) return null;
  const Pieza = (Iconos as unknown as Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>>)[nombre];
  return Pieza ? <Pieza size={size} strokeWidth={2} /> : null;
}


export default function Navegacion() {
  const router = useIonRouter();
  const [cfg, setCfg] = useState<Config>(cargar());
  const [pos, setPos] = useState<Posicion | null>(gps.posicion());
  const [valores, setValores] = useState<Map<string, Senal>>(new Map());
  const [frescura, setFrescura] = useState<Map<string, number>>(new Map());
  const [seguir, setSeguir] = useState(true);
  const [problema, setProblema] = useState<ProblemaPuerto | null>(null);
  const [, refrescar] = useState(0);
  const [mapaListo, setMapaListo] = useState(false);
  const [recargarMapa] = useState(0);
  const [cuantasGeocercas, setCuantasGeocercas] = useState(0);

  const lienzo = useRef<HTMLDivElement | null>(null);
  const rumboPuesto = useRef(0);

  /**
   * Gira el mapa para que arriba sea siempre hacia donde se va.
   *
   * Es lo que hace que un navegador se sienta como un navegador y no como un
   * plano: uno no traduce «voy al sur» mirando un norte fijo, mira hacia
   * delante. Se toca el CSS directamente y no el estado de React porque esto
   * cambia con cada posicion y volver a dibujar la pantalla entera por un
   * angulo seria un desperdicio.
   *
   * El camino corto: de 350 a 10 grados se gira 20, no 340.
   */
  const girar = (rumbo: number) => {
    if (!lienzo.current) return;
    let d = rumbo - rumboPuesto.current;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    rumboPuesto.current += d;
    lienzo.current.style.setProperty('--giro', `${-rumboPuesto.current}deg`);
    /* Los nombres de las geocercas se desgiran, o quedarian del reves. */
    lienzo.current.style.setProperty('--desgiro', `${rumboPuesto.current}deg`);
  };
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
    setMapaListo(true);
    /* El contenedor acaba de aparecer y Leaflet midio antes de tiempo. */
    setTimeout(() => m.invalidateSize(), 250);

    return () => {
      m.remove();
      mapa.current = null;
    };
  }, []);

  /* ── Plano de la mina y geocercas ─────────────────────────────────────── */

  /**
   * Se pintan una sola vez, al arrancar, desde lo guardado en el equipo.
   *
   * Un mapa de calles no dice nada dentro de una mina: no hay calles. Lo que
   * orienta es el plano propio y las geocercas dibujadas encima, que es lo que
   * deja ver si uno esta entrando en la zona de descarga o pasando de largo.
   */
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;

    const d = guardado();
    if (!d) return;

    const puestos: L.Layer[] = [];

    if (d.plano) {
      /* Debajo de todo y algo apagado, para que las geocercas y la flecha se
         lean por encima sin competir con el dibujo del plano. */
      puestos.push(
        L.imageOverlay(d.plano.url, d.plano.limites, { opacity: 0.75, zIndex: 200 }).addTo(m),
      );
    }

    for (const g of d.geocercas) {
      const pinta = { color: g.color, weight: 2, opacity: 0.9, fillColor: g.color, fillOpacity: 0.12 };

      const capa =
        g.tipo === 'circulo'
          ? L.circle(g.puntos[0], { ...pinta, radius: g.radio })
          : L.polygon(g.puntos, pinta);

      capa.bindTooltip(g.nombre, {
        permanent: true,
        direction: 'center',
        className: 'nav-geocerca__nombre',
      });
      capa.addTo(m);
      puestos.push(capa);
    }

    /* Sin posicion todavia, se encuadra la mina: es mas util que el pais
       entero, y en cuanto haya fix el mapa sigue a la maquina. */
    if (!marca.current && d.plano) m.fitBounds(d.plano.limites, { padding: [20, 20] });

    setCuantasGeocercas(d.geocercas.length);

    return () => {
      for (const c of puestos) m.removeLayer(c);
    };
  }, [mapaListo, recargarMapa]);

  /* ── GPS ──────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (cfg.gps.activo) gps.arrancar(cfg.gps.ruta, cfg.gps.baudios).catch(() => undefined);

    return gps.alMoverse((p) => {
      setPos(p);
      const punto: [number, number] = [p.lat, p.lon];

      /* La flecha nace con la primera posicion buena, no antes. */
      if (!marca.current && mapa.current) {
        marca.current = L.marker(punto, { icon: FLECHA, zIndexOffset: 1000 }).addTo(mapa.current);
        mapa.current.setView(punto, 17);
      }
      marca.current?.setLatLng(punto);
      girar(p.rumbo);
      traza.current?.setLatLngs(gps.camino());
      if (seguirRef.current) mapa.current?.panTo(punto, { animate: true, duration: 0.4 });
    });
  }, [cfg.gps.activo, cfg.gps.ruta, cfg.gps.baudios]);

  /* La maqueta se enciende y se apaga con la configuracion, y no sobrevive a
     un reinicio de la aplicacion: son datos de mentira y no deben quedarse
     puestos sin que nadie se acuerde. */
  useEffect(() => {
    if (cfg.maqueta) maqueta.encender();
    else maqueta.apagar();
    return () => maqueta.apagar();
  }, [cfg.maqueta]);

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
   * Las tarjetas ya resueltas.
   *
   * Sin ninguna configurada se enseña todo lo que va llegando, cada señal en su
   * numero: un equipo recien puesto tiene que enseñar algo sin que nadie lo
   * configure, y de ahi se arma el panel a gusto.
   */
  const tarjetas = useMemo(() => {
    const puestas = cfg.panel.length
      ? cfg.panel
      : /* Lo que no es un numero se enseña como texto: si no, un estado o un
           codigo apareceria como «sin dato», que es mentira. */
        [...valores.entries()].map(([c, s]) => ({
          ...nuevaTarjeta(typeof s.valor === 'string' ? 'texto' : 'numero'),
          id: `auto.${c}`,
          claves: [c],
          decimales: 2,
        }));

    return puestas.map((t) => ({ t, v: calcular(t, valores, frescura) }));
  }, [cfg.panel, valores, frescura]);

  /** El estado de cada fuente, que en las tarjetas no se ve. */
  const estados = useMemo(
    () =>
      cfg.fuentes.map((f) => {
        const claves = [...frescura.keys()].filter((c) => c.startsWith(`${f.id}.`));
        const ultima = claves.reduce((max, c) => Math.max(max, frescura.get(c) ?? 0), 0);
        return { fuente: f, viva: ultima > 0 && Date.now() - ultima < 15000, nunca: ultima === 0 };
      }),
    [cfg.fuentes, frescura],
  );

  return (
    <IonPage>
      <div className="nav-pantalla">
        <div className="nav-izquierda">
          {/* El mapa vive dentro de un lienzo mas grande que la pantalla: al
              girarlo, si midiera lo mismo se verian las esquinas vacias. */}
          <div className="nav-lienzo" ref={lienzo}>
            <div className="nav-mapa" ref={divMapa} />
          </div>

        <div className="nav-barra">
          <span className="nav-marca">DiPlus</span>

          <span className={`nav-rtk ${pos?.origen === 'interno' ? 'warn' : cal.tono}`}>
            <i className="nav-punto" />
            {pos?.origen === 'interno' ? 'GPS EQUIPO' : cal.corto}
            {pos?.origen === 'rtk' && <span style={{ opacity: 0.65 }}>{pos.satelites} sat</span>}
          </span>

          {cuantasGeocercas > 0 && (
            <span className="nav-geocercas">{cuantasGeocercas} geocercas</span>
          )}

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
          {/* Se anuncia siempre. Un caudal inventado no se distingue de uno
              leido, y una posicion inventada tampoco: eso es exactamente lo
              que hacia mal la version anterior. */}
          {cfg.maqueta && <p className="nav-maqueta">Datos de prueba · nada de esto es real</p>}

          {/* Sin rótulo. «Sensores» encima de unos sensores no dice nada, y ese
              renglón vale más ocupado por el estado de cada bus: una fuente
              puede estar muda mientras la otra va, y en las tarjetas eso no se
              ve. */}
          {estados.length > 0 && (
            <div className="nav-fuentes">
              {estados.map((e) => (
                <span
                  key={e.fuente.id}
                  className={`nav-chip ${e.viva ? 'vivo' : e.nunca ? 'mudo' : 'viejo'}`}
                  title={e.viva ? 'recibiendo' : e.nunca ? 'sin datos' : 'callado'}
                >
                  <i />
                  <span>{e.fuente.nombre}</span>
                </span>
              ))}
            </div>
          )}

          {problema && (
            <p className="nav-aviso">
              {problema.port}: {problema.message}
            </p>
          )}

          <div className="nav-panel__cuerpo">
            {cfg.fuentes.length === 0 && tarjetas.length === 0 && (
              <p className="nav-vacio">
                Todavía no hay ninguna fuente.
                <br />
                {hayHardware()
                  ? 'Da de alta el RS485 o el bus CAN en Configuración.'
                  : 'Esto es una vista previa: los puertos solo existen en el equipo.'}
              </p>
            )}

            {cfg.fuentes.length > 0 && tarjetas.length === 0 && (
              <p className="nav-vacio">
                Nada ha llegado todavía.
                <br />
                En cuanto entren lecturas se ven aquí, y en Configuración → Panel se arma
                cómo mostrarlas.
              </p>
            )}

            <div className="nav-rejilla">
              {tarjetas.map(({ t, v }) => {
                const edad = v.visto ? Date.now() - v.visto : Infinity;
                const viejo = edad > 10000;

                return (
                  <article
                    key={t.id}
                    className={`nav-tarjeta ${t.grande ? 'ancha' : ''} ${viejo ? 'viejo' : ''} est-${v.estado}`}
                  >
                    <header className="nav-tarjeta__cab">
                      <span className="nav-tarjeta__icono">
                        <IconoTarjeta nombre={t.icono} size={t.grande ? 16 : 13} />
                      </span>
                      <p className="nav-tarjeta__nombre">{titulo(t, v)}</p>
                    </header>

                    <p className="nav-tarjeta__valor">
                      <b>{texto(v, t.decimales)}</b>
                      {v.valor !== null && v.unidad && <small>{v.unidad}</small>}
                    </p>

                    {/* La barra de un nivel va debajo y a todo lo ancho, como el
                        indicador de combustible de un tablero: de reojo se lee
                        la posición, no el número. */}
                    {v.fraccion !== null && (
                      <div className="nav-nivel">
                        <i style={{ width: `${Math.round(v.fraccion * 100)}%` }} />
                      </div>
                    )}

                    {v.partes.length > 1 && (
                      <p className="nav-tarjeta__partes">
                        {v.partes.map((p) => `${p.nombre} ${p.valor ?? '—'}`).join('   ·   ')}
                      </p>
                    )}

                    {(viejo || !v.visto) && (
                      <p className="nav-tarjeta__pie">
                        {v.visto ? `hace ${Math.round(edad / 1000)} s` : 'sin datos'}
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </IonPage>
  );
}
