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
import { ArrowRight, Crosshair, Settings, TerminalSquare } from 'lucide-react';
import * as Iconos from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './Navegacion.css';

import { Config, alCambiar, cargar, guardar } from '../nucleo/config';
import { Posicion, calidad, gps, nombreOrigen, precisionAproximada } from '../nucleo/gps';
import { ProblemaPuerto, TramaVista, hardware, hayHardware } from '../nucleo/hardware';
import { registro } from '../nucleo/registro';
import { Senal } from '../nucleo/lecturas';
import { calcular, nuevaTarjeta, texto, titulo } from '../nucleo/panel';
import { maqueta } from '../nucleo/maqueta';
import { guardado } from '../nucleo/servidor';
import { comoVoy, geocercaDe, recomendacionDe } from '../nucleo/geo';
import { planoGuardado } from '../nucleo/plano';
import { canal } from '../nucleo/canal';
import { movimiento } from '../nucleo/movimiento';
import { revisarSola } from '../nucleo/actualizacion';

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


/**
 * Un deposito que se ve llenarse.
 *
 * Un numero de litros no dice si queda mucho o poco sin saber cuanto cabe. Un
 * tanque dibujado si: de reojo se ve la altura del liquido y ya esta, sin
 * dividir nada mentalmente.
 */
function Tanque({ fraccion, alerta }: { fraccion: number; alerta: boolean }) {
  const f = Math.min(1, Math.max(0, fraccion));
  const alto = 62 * f;

  return (
    <svg className="nav-tanque" viewBox="0 0 46 78" width="46" height="78" aria-hidden="true">
      <rect x="3" y="6" width="40" height="66" rx="9" className="nav-tanque__hueco" />
      <clipPath id="dentro">
        <rect x="3" y="6" width="40" height="66" rx="9" />
      </clipPath>
      <g clipPath="url(#dentro)">
        <rect
          x="3"
          y={70 - alto}
          width="40"
          height={alto + 2}
          className={alerta ? 'nav-tanque__liquido alerta' : 'nav-tanque__liquido'}
        />
      </g>
      {/* Las marcas de un cuarto, para leer la altura sin contar. */}
      {[0.25, 0.5, 0.75].map((m) => (
        <line key={m} x1="3" x2="43" y1={70 - 64 * m} y2={70 - 64 * m} className="nav-tanque__marca" />
      ))}
      <rect x="3" y="6" width="40" height="66" rx="9" className="nav-tanque__borde" />
    </svg>
  );
}

/**
 * Aguja sobre un arco, como el cuentarrevoluciones del tablero.
 *
 * El arco abarca 220 grados y empieza abajo a la izquierda, que es como se
 * dibujan los cuadrantes de un carro: la posicion de la aguja se reconoce sin
 * leer el numero, que es de lo que se trata cuando se conduce.
 */
/**
 * Un termometro, que es como se lee una temperatura desde siempre.
 *
 * Un radial no vale aqui: la aguja de un cuadrante dice «cuanto de lo que
 * cabe», y una temperatura no se piensa asi. Se piensa como una columna que
 * sube.
 */
function Termometro({ fraccion, alerta }: { fraccion: number; alerta: boolean }) {
  const f = Math.min(1, Math.max(0, fraccion));
  const alto = 44 * f;

  return (
    <svg className="nav-termo" viewBox="0 0 30 78" width="30" height="78" aria-hidden="true">
      <rect x="11" y="6" width="8" height="50" rx="4" className="nav-termo__hueco" />
      <rect
        x="11"
        y={54 - alto}
        width="8"
        height={alto + 8}
        rx="4"
        className={alerta ? 'nav-termo__liquido alerta' : 'nav-termo__liquido'}
      />
      <circle cx="15" cy="62" r="10" className={alerta ? 'nav-termo__bulbo alerta' : 'nav-termo__bulbo'} />
      {/* Las rayas del lado, para leer la altura sin contar. */}
      {[0.25, 0.5, 0.75, 1].map((m) => (
        <line key={m} x1="21" x2="25" y1={54 - 46 * m} y2={54 - 46 * m} className="nav-termo__raya" />
      ))}
    </svg>
  );
}

function Cuadrante({ fraccion, alerta }: { fraccion: number; alerta: boolean }) {
  const f = Math.min(1, Math.max(0, fraccion));
  const R = 27;
  const ABRE = 220;
  const DESDE = 160;

  const punto = (grados: number) => {
    const r = ((grados) * Math.PI) / 180;
    return [34 + R * Math.cos(r), 34 + R * Math.sin(r)];
  };
  const [x0, y0] = punto(DESDE);
  const [x1, y1] = punto(DESDE + ABRE);
  const largo = (Math.PI * R * ABRE) / 180;

  return (
    <svg className="nav-cuadrante" viewBox="0 0 68 60" width="68" height="60" aria-hidden="true">
      <path
        d={`M ${x0} ${y0} A ${R} ${R} 0 1 1 ${x1} ${y1}`}
        className="nav-cuadrante__hueco"
      />
      <path
        d={`M ${x0} ${y0} A ${R} ${R} 0 1 1 ${x1} ${y1}`}
        className={alerta ? 'nav-cuadrante__lleno alerta' : 'nav-cuadrante__lleno'}
        strokeDasharray={`${largo * f} ${largo}`}
      />
    </svg>
  );
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
         lean por encima sin competir con el dibujo del plano.

         Primero el guardado en el equipo, que entra al instante y funciona sin
         cobertura. El del servidor es el respaldo: son 34 MB y en una mina eso
         puede no llegar nunca. */
      const limites = d.plano.limites;
      const remoto = d.plano.url;
      let capa: L.ImageOverlay | null = null;
      let local: string | null = null;

      planoGuardado().then((u) => {
        if (!mapa.current) return;
        local = u;
        capa = L.imageOverlay(u ?? remoto, limites, { opacity: 0.75, zIndex: 200 });
        capa.addTo(mapa.current);
      });

      puestos.push({
        remove: () => {
          if (capa) m.removeLayer(capa);
          if (local) URL.revokeObjectURL(local);
        },
      } as unknown as L.Layer);
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
      for (const c of puestos) {
        /* El plano se quita solo, que ademas tiene que soltar su direccion. */
        if ((c as unknown as { remove?: () => void }).remove && !(c as L.Layer).addTo) {
          (c as unknown as { remove: () => void }).remove();
        } else {
          m.removeLayer(c);
        }
      }
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

  /**
   * El canal remoto y la revisión de versiones.
   *
   * Van con la aplicación y no con la pantalla de ajustes: un equipo que se
   * enciende y nadie toca tiene que quedar accesible y al día igual.
   */
  useEffect(() => {
    canal.aplicar(cfg, {
      alActualizar: () => revisarSola(cfg.actualizacion, true),
      alConfigurar: (nueva) => {
        guardar(nueva);
        setCfg({ ...nueva });
      },
    });
    revisarSola(cfg.actualizacion);
  }, [cfg.canal.activo, cfg.canal.puerto, cfg.canal.token, cfg.actualizacion.automatica]);

  /**
   * La unidad inercial, como una fuente mas.
   *
   * Las señales las inyecta el propio módulo, no esta pantalla: si no, al
   * entrar en Configuración se dejaban de publicar. Entran donde lo que llega
   * por cable, así que se pueden poner en el panel, mandar por RS485 o
   * guardar en la base igual que las demás.
   */
  useEffect(() => {
    movimiento.aplicar(cfg.movimiento);
  }, [cfg.movimiento]);

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

  /**
   * Los cambios de configuración llegan solos.
   *
   * Antes esto dependía de eventos de foco y de `ionViewWillEnter`, y no se
   * disparaban: se tocaba un ajuste, se volvía, y la pantalla seguía con la
   * configuración de cuando se abrió. Una fuente recién dada de alta no se
   * leía. Ahora avisa la propia configuración cuando se guarda.
   */
  useEffect(() => alCambiar((c) => setCfg({ ...c })), []);

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

  /* ── Viaje, geocerca y recomendación ──────────────────────────────────── */

  const camion = useMemo(() => guardado()?.camion ?? null, [recargarMapa]);
  const geocercas = useMemo(() => guardado()?.geocercas ?? [], [recargarMapa]);

  /** En qué geocerca está la máquina ahora. */
  const donde = useMemo(
    () => (pos ? geocercaDe([pos.lat, pos.lon], geocercas) : null),
    [pos, geocercas],
  );

  const consejo = recomendacionDe(donde, cfg.recomendaciones, cfg.recomendacionGeneral);

  /**
   * El consumo en galones por hora.
   *
   * Sale de la primera tarjeta que mida caudal. Si el equipo lo da en litros
   * —que es lo normal en los caudalímetros de aquí— se convierte, porque la
   * recomendación viene en galones y comparar dos unidades distintas sería
   * peor que no comparar nada.
   */
  const galones = useMemo(() => {
    const t = cfg.panel.find((x) => x.vista === 'diferencia' || /caudal|consumo/i.test(x.titulo));
    if (!t) return null;
    const v = calcular(t, valores, frescura);
    if (typeof v.valor !== 'number') return null;
    return /l\/h|litro/i.test(v.unidad) ? v.valor / 3.785 : v.valor;
  }, [cfg.panel, valores, frescura]);

  const vaVelocidad = comoVoy(velocidad, consejo.velocidad);
  const vaConsumo = galones === null ? 'bien' : comoVoy(galones, consejo.galonesHora);

  /**
   * Las tarjetas que caben sin desplazar.
   *
   * El panel no tiene barra de desplazamiento a propósito: conduciendo no se
   * desplaza nada. Lo que no cabe, no se enseña, así que el orden de las
   * tarjetas en Configuración decide qué se ve.
   */
  const vitales = useMemo(() => tarjetas.slice(0, 6), [tarjetas]);

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
          <div className={`nav-velocidad ${vaVelocidad}`}>
            <b>{velocidad}</b>
            <span>KM/H</span>

            {/* El limite, en el circulito de la esquina. Es el idioma de
                cualquier navegador: dentro lo que llevas, al lado lo que
                toca, y el color dice si vas bien. */}
            <span className="nav-limite">{consejo.velocidad}</span>
          </div>
        )}
        {pos && (
          <span className="nav-precision">
            {nombreOrigen(pos.origen)} · {precisionAproximada(pos)}
          </span>
        )}
        {/* Lo que hay que mantener aquí, flotando sobre el mapa abajo a la
            derecha: es lo último que se mira antes de volver la vista a la
            pista, así que va sobre el terreno y no en el panel. */}
        <footer className="nav-consejo">
          {donde && <p className="nav-consejo__donde">{donde.nombre}</p>}

          <div className={`nav-consejo__dato ${vaConsumo}`}>
            <em>Consumo</em>
            <b>
              {galones === null ? '—' : galones.toFixed(1)}
              <small>de {consejo.galonesHora} gal/h</small>
            </b>
          </div>
        </footer>

        </div>
        <aside className="nav-panel">
          {/* Se anuncia siempre. Un caudal inventado no se distingue de uno
              leído, y una posición inventada tampoco. */}
          {cfg.maqueta && <p className="nav-maqueta">Datos de prueba · nada de esto es real</p>}

          {/* ── Quién conduce y qué viaje lleva ───────────────────────────── */}
          <header className="nav-viaje">
            <div className="nav-viaje__quien">
              <span className="nav-unidad">{camion?.unidad || cfg.servidor.equipo || '—'}</span>
              <span className="nav-operador">{camion?.operador || 'Sin operador asignado'}</span>
            </div>

            <div className="nav-viaje__tramo">
              <span className="nav-tramo__punta">
                <em>desde</em>
                <b>{camion?.desde || '—'}</b>
              </span>
              <ArrowRight size={15} strokeWidth={2.4} className="nav-tramo__flecha" />
              <span className="nav-tramo__punta">
                <em>hacia</em>
                <b>{camion?.hacia || '—'}</b>
              </span>
            </div>
          </header>

          {problema && (
            <p className="nav-aviso">
              {problema.port}: {problema.message}
            </p>
          )}

          {/* ── Cuántos viajes y ciclos llevo ─────────────────────────────── */}
          <div className="nav-cuenta">
            <div className="nav-cuenta__uno">
              <em>Ciclos</em>
              <b>{camion ? camion.ciclos : '—'}</b>
            </div>
            <div className="nav-cuenta__uno">
              <em>Tonelaje movido</em>
              <b>
                {camion ? camion.tonelaje.toFixed(0) : '—'}
                {camion && <small>t</small>}
              </b>
            </div>
          </div>

          {/* ── Los instrumentos ──────────────────────────────────────────── */}
          <div className="nav-vitales">
            {vitales.map(({ t, v }) => {
              const edad = v.visto ? Date.now() - v.visto : Infinity;
              const viejo = edad > 10000;
              const alerta = v.estado === 'bajo' || v.estado === 'alto';
              const clases =
                `nav-vital ${viejo ? 'viejo' : ''} est-${v.estado} forma-${t.vista}`
                + (t.grande ? ' ancha' : '');

              /* Un tanque o un cuadrante ocupan su propia caja: el dibujo manda
                 y el numero va debajo, que es como se lee un tablero. */
              if (t.vista === 'tanque' || t.vista === 'cuadrante' || t.vista === 'termometro') {
                return (
                  <article key={t.id} className={clases}>
                    {t.vista === 'tanque' && <Tanque fraccion={v.fraccion ?? 0} alerta={alerta} />}
                    {t.vista === 'cuadrante' && <Cuadrante fraccion={v.fraccion ?? 0} alerta={alerta} />}
                    {t.vista === 'termometro' && <Termometro fraccion={v.fraccion ?? 0} alerta={alerta} />}
                    <span className="nav-vital__texto">
                      <em>{titulo(t, v)}</em>
                      <b>
                        {texto(v, t.decimales)}
                        {v.valor !== null && v.unidad && <small>{v.unidad}</small>}
                      </b>
                    </span>
                  </article>
                );
              }

              return (
                <article key={t.id} className={clases}>
                  <span className="nav-vital__icono">
                    <IconoTarjeta nombre={t.icono} size={14} />
                  </span>
                  <span className="nav-vital__texto">
                    <em>{titulo(t, v)}</em>
                    <b>
                      {texto(v, t.decimales)}
                      {v.valor !== null && v.unidad && <small>{v.unidad}</small>}
                    </b>
                  </span>
                  {v.fraccion !== null && (
                    <span className="nav-vital__barra">
                      <i style={{ width: `${Math.round(v.fraccion * 100)}%` }} />
                    </span>
                  )}
                </article>
              );
            })}

            {vitales.length === 0 && (
              <p className="nav-vacio">
                Todavía no llega ninguna lectura.
                <br />
                Da de alta una fuente, o enciende los datos de prueba.
              </p>
            )}
          </div>

        </aside>
      </div>
    </IonPage>
  );
}
