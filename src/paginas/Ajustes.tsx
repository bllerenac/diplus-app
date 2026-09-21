/**
 * Configuracion, por pestañas.
 *
 * Van separadas porque son decisiones distintas y en una sola columna habia que
 * bajar mucho para llegar a lo de abajo. El orden es el que se sigue al montar
 * un equipo: de donde se lee, que se ve, la posicion, que se guarda y a donde
 * se manda.
 *
 * Los formularios de cada protocolo **no estan escritos aqui**: se dibujan a
 * partir de los `campos` que el propio protocolo declara necesitar. Añadir un
 * protocolo no obliga a tocar esta pantalla.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CLAVE_KIOSCO, cerrarApp, desbloquear, reiniciarApp } from '../nucleo/kiosco';
import {
  IonBackButton, IonButtons, IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
} from '@ionic/react';

import { Config, Servidor, cargar, guardar, nuevaFuente } from '../nucleo/config';
import { Fuente, Hallazgo, PuertoDelEquipo, TramaVista, hardware, hayHardware } from '../nucleo/hardware';
import { CampoProtocolo, SenalManual, defectosDe, protocolo, protocolosDe } from '../nucleo/protocolos';
import { TIPOS_LECTURA } from '../nucleo/lecturas';
import {
  Calibracion, calibraciones, guardarCalibracion, hayBase, podar, resumen, vaciar,
} from '../nucleo/base';
import { registro } from '../nucleo/registro';
import { rumbo } from '../nucleo/rumbo';
import { envio } from '../nucleo/envio';
import { maqueta } from '../nucleo/maqueta';
import { AjustesMovimiento, movimiento } from '../nucleo/movimiento';
import { Senal } from '../nucleo/lecturas';
import { Descargado, descargar, entrar, guardado } from '../nucleo/servidor';
import { revisar } from '../nucleo/curva';
import { AjustesSenal, ajustar, ajustesDe } from '../nucleo/senales';
import {
  ICONOS, Tarjeta, VISTAS, VistaTarjeta, esPrincipal, iconoSugerido, nuevaTarjeta, panelFijo, vista,
} from '../nucleo/panel';
import {
  Descarga, VersionInstalada, actualizador, arreglarDireccion, esMasNueva, hayActualizador, reparo,
} from '../nucleo/actualizacion';
import {
  Aviso, Bloque, Boton, Campo, Entrada, Interruptor, Modal, Nota, Pestanas, Selector, Vacio,
} from './piezas';
import { Montaje } from './montaje';
import { Envio } from './envio';

type Pestana =
  'sensores' | 'inercial' | 'panel' | 'posicion' | 'datos' | 'envio' | 'servidor' | 'kiosco';

const PESTANAS: { id: Pestana; nombre: string }[] = [
  { id: 'sensores', nombre: 'Sensores' },
  { id: 'inercial', nombre: 'Inercial' },
  { id: 'panel', nombre: 'Panel' },
  { id: 'posicion', nombre: 'Posición' },
  { id: 'datos', nombre: 'Datos' },
  { id: 'envio', nombre: 'Envío' },
  { id: 'servidor', nombre: 'Servidor' },
  { id: 'kiosco', nombre: 'Kiosco' },
];

const PUERTOS: { id: Fuente['puerto']; nombre: string }[] = [
  { id: 'rs485', nombre: 'RS485 (serie)' },
  { id: 'can1', nombre: 'Bus CAN 1' },
  { id: 'can2', nombre: 'Bus CAN 2' },
  { id: 'red', nombre: 'Por red (escucha)' },
];

/** El nombre corto de cada puerto, para decir de donde viene una señal. */
const NOMBRE_PUERTO: Record<string, string> = {
  rs485: 'RS485',
  can1: 'CAN 1',
  can2: 'CAN 2',
  red: 'red',
};

const BAUDIOS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
const BITRATES = [125000, 250000, 500000, 1000000];

/** Un campo dibujado a partir de lo que el protocolo declara necesitar. */
function CampoDeclarado({
  campo, valor, alCambiar,
}: {
  campo: CampoProtocolo;
  valor: unknown;
  alCambiar: (v: string) => void;
}) {
  if (campo.tipo === 'seleccion') {
    return (
      <Campo etiqueta={campo.etiqueta} ayuda={campo.ayuda}>
        <Selector value={String(valor ?? '')} onChange={(e) => alCambiar(e.target.value)}>
          {(campo.opciones ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </Selector>
      </Campo>
    );
  }
  return (
    <Campo etiqueta={campo.etiqueta} ayuda={campo.ayuda}>
      <Entrada
        type={campo.tipo === 'numero' ? 'number' : 'text'}
        min={campo.min}
        max={campo.max}
        value={String(valor ?? '')}
        onChange={(e) => alCambiar(e.target.value)}
      />
    </Campo>
  );
}

/** Editor de señales a mano: de qué byte sale cada valor y con qué escala. */
function EditorSenales({
  lista, alCambiar,
}: {
  lista: SenalManual[];
  alCambiar: (l: SenalManual[]) => void;
}) {
  const cambiar = (i: number, k: keyof SenalManual, v: unknown) =>
    alCambiar(lista.map((s, j) => (j === i ? { ...s, [k]: v } : s)));

  return (
    <div className="flex flex-col gap-3">
      {lista.map((s, i) => (
        <div key={i} className="rounded-xl border border-line bg-bg p-3.5">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Campo etiqueta="Clave">
              <Entrada value={s.clave ?? ''} placeholder="presion"
                onChange={(e) => cambiar(i, 'clave', e.target.value)} />
            </Campo>
            <Campo etiqueta="Nombre">
              <Entrada value={s.nombre ?? ''} placeholder="Presión"
                onChange={(e) => cambiar(i, 'nombre', e.target.value)} />
            </Campo>
            <Campo etiqueta="Unidad">
              <Entrada value={s.unidad ?? ''} placeholder="bar"
                onChange={(e) => cambiar(i, 'unidad', e.target.value)} />
            </Campo>
            <Campo etiqueta="PGN" ayuda="Vacío = cualquiera">
              <Entrada value={String(s.pgn ?? '')} placeholder="65262"
                onChange={(e) => cambiar(i, 'pgn', e.target.value)} />
            </Campo>
            <Campo etiqueta="Byte">
              <Entrada type="number" min={0} value={s.desde ?? 0}
                onChange={(e) => cambiar(i, 'desde', Number(e.target.value))} />
            </Campo>
            <Campo etiqueta="Tamaño">
              <Selector value={s.tipo ?? 'u16le'} onChange={(e) => cambiar(i, 'tipo', e.target.value)}>
                {TIPOS_LECTURA.map((t) => <option key={t} value={t}>{t}</option>)}
              </Selector>
            </Campo>
            <Campo etiqueta="Escala">
              <Entrada value={String(s.escala ?? 1)} onChange={(e) => cambiar(i, 'escala', e.target.value)} />
            </Campo>
            <Campo etiqueta="Desplazamiento">
              <Entrada value={String(s.desplazamiento ?? 0)}
                onChange={(e) => cambiar(i, 'desplazamiento', e.target.value)} />
            </Campo>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <Nota>valor = (crudo × {String(s.escala ?? 1)}) + {String(s.desplazamiento ?? 0)}</Nota>
            <Boton variante="peligro" onClick={() => alCambiar(lista.filter((_, j) => j !== i))}>
              Quitar
            </Boton>
          </div>
        </div>
      ))}
      <Boton
        onClick={() => alCambiar([...lista, {
          clave: '', nombre: '', unidad: '', desde: 0, tipo: 'u16le', escala: 1, desplazamiento: 0,
        }])}
        className="self-start"
      >
        Añadir señal
      </Boton>
    </div>
  );
}

/**
 * Todo lo que se decide de una señal, en una ventana aparte.
 *
 * Son cinco decisiones —como se llama, en que unidad, si se corrige, si se
 * guarda, si sale fuera— y por veinte señales no caben en una columna sin que
 * la pantalla se vuelva interminable. Aparte, la lista de fuera queda corta y
 * cada señal se toca cuando toca.
 *
 * Arriba siempre se ve **lo que marca ahora y en que queda** despues de la
 * curva y del factor. Sin eso hay que guardar, salir, mirar el panel y volver,
 * y calibrar asi es adivinar.
 */
function DetalleSenal({
  clave, senal, ajustes, alCambiar, alCerrar,
}: {
  clave: string;
  senal: Senal | undefined;
  ajustes: AjustesSenal;
  alCambiar: (a: AjustesSenal) => void;
  alCerrar: () => void;
}) {
  const crudo = typeof senal?.valor === 'number' ? senal.valor : null;
  const aviso = revisar(ajustes.curva);
  const resultado = senal ? ajustar(ajustes, senal) : null;

  const cambiar = (c: Partial<AjustesSenal>) => alCambiar({ ...ajustes, ...c });
  const puntos = ajustes.curva;

  return (
    <Modal
      titulo={ajustes.alias.trim() || senal?.nombre || clave}
      subtitulo={<span className="font-mono">{clave}</span>}
      alCerrar={alCerrar}
      pie={<Boton variante="fuerte" onClick={alCerrar}>Listo</Boton>}
    >
      {/* Lo que marca y en qué queda, siempre a la vista. */}
      <div className="flex items-center gap-4 rounded-xl border border-line bg-bg px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="rotulo">Marca ahora</div>
          <b className="tabular-nums text-[19px] text-ink2">
            {crudo === null ? (senal?.valor ?? '—') : crudo}
          </b>
          {senal?.unidad && <em className="ml-1 not-italic text-[12px] text-ink3">{senal.unidad}</em>}
        </div>
        <span className="text-ink3">→</span>
        <div className="min-w-0 flex-1 text-right">
          <div className="rotulo">Se ve como</div>
          <b className="tabular-nums text-[19px] text-acc">
            {resultado === null || resultado.valor === null
              ? '—'
              : typeof resultado.valor === 'number'
                ? Number(resultado.valor.toFixed(3))
                : resultado.valor}
          </b>
          {resultado?.unidad && (
            <em className="ml-1 not-italic text-[12px] text-ink3">{resultado.unidad}</em>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Cómo se llama" ayuda="Vacío = el nombre que trae.">
          <Entrada
            value={ajustes.alias}
            placeholder={senal?.nombre ?? clave}
            onChange={(e) => cambiar({ alias: e.target.value })}
          />
        </Campo>
        <Campo etiqueta="Unidad" ayuda="Vacía = la que trae.">
          <Entrada
            value={ajustes.unidad}
            placeholder={senal?.unidad || 'la que trae'}
            onChange={(e) => cambiar({ unidad: e.target.value })}
          />
        </Campo>
      </div>

      <Campo
        etiqueta="Multiplicar por"
        ayuda="Para cambiar de unidad. De litros a galones, 0.264. Con 1 se deja tal cual."
      >
        <Entrada
          type="number"
          step="any"
          value={ajustes.factor}
          onChange={(e) => cambiar({ factor: Number(e.target.value) || 1 })}
        />
      </Campo>

      <div className="grid grid-cols-2 gap-3">
        <Interruptor
          activo={ajustes.guardar}
          alCambiar={(v) => cambiar({ guardar: v })}
          etiqueta="Guardar en el equipo"
        />
        <Interruptor
          activo={ajustes.enviar}
          alCambiar={(v) => cambiar({ enviar: v })}
          etiqueta="Mandar hacia fuera"
        />
      </div>

      {/* ── La curva ─────────────────────────────────────────────────────── */}
      <p className="rotulo mb-1.5 mt-2">Curva de calibración</p>
      <Nota>
        Pares «lo que marca → lo que es», tomados con un equipo de referencia. Entre dos puntos
        se interpola en línea recta; fuera de lo medido se mantiene el valor del extremo en vez
        de inventar. Con menos de dos puntos no se aplica nada.
      </Nota>

      {aviso && <Aviso tono="warn">{aviso}</Aviso>}

      {puntos.map((p, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
          <Campo etiqueta={i === 0 ? 'Lo que marca' : ''}>
            <Entrada
              type="number" step="any" value={p.crudo}
              onChange={(e) =>
                cambiar({ curva: puntos.map((x, j) => (j === i ? { ...x, crudo: Number(e.target.value) } : x)) })
              }
            />
          </Campo>
          <Campo etiqueta={i === 0 ? 'Lo que es de verdad' : ''}>
            <Entrada
              type="number" step="any" value={p.real}
              onChange={(e) =>
                cambiar({ curva: puntos.map((x, j) => (j === i ? { ...x, real: Number(e.target.value) } : x)) })
              }
            />
          </Campo>
          <Boton variante="tenue" onClick={() => cambiar({ curva: puntos.filter((_, j) => j !== i) })}>
            −
          </Boton>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <Boton onClick={() => cambiar({ curva: [...puntos, { crudo: crudo ?? 0, real: 0 }] })}>
          Añadir punto{crudo !== null ? ` (marca ${crudo})` : ''}
        </Boton>
        {puntos.length > 0 && (
          <Boton variante="peligro" onClick={() => cambiar({ curva: [] })}>
            Quitar la curva
          </Boton>
        )}
      </div>
    </Modal>
  );
}

export default function Ajustes() {
  const [cfg, setCfg] = useState<Config>({ ...cargar() });
  const [pestana, setPestana] = useState<Pestana>('sensores');
  const [avanzado, setAvanzado] = useState(false);
  /* Se guarda tambien el valor, no solo el nombre: al elegir el sensor de un
     cuadro hay que poder ver lo que vale ahora mismo, que es lo unico que
     distingue una clave util de una que ya no llega. */
  /* Se siembra con lo que el aparato ya tenga leído, para no abrir la pantalla
     en blanco esperando la primera trama.

     Va por la clave completa, que es la que trae el mapa del hardware. Antes se
     sembraba con la clave corta —la que viene dentro de la trama— mientras que
     lo que llegaba después entraba con la completa, así que cada señal aparecía
     **dos veces**: una con «imu.vibracion» y otra con «vibracion», y las dos
     con su interruptor de guardar y de mandar. Se vio en el equipo: dieciocho
     señales donde solo hay nueve. */
  const [vistas, setVistas] = useState<Map<string, Senal>>(
    () => new Map(hardware.senalesPorClave()),
  );
  const [eco, setEco] = useState<string | null>(null);
  const [peso, setPeso] = useState<{ filas: number; desde: number | null } | null>(null);
  const [calibs, setCalibs] = useState<Calibracion[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [probando, setProbando] = useState<{ port: string; baudrate: number } | null>(null);
  const [hallazgos, setHallazgos] = useState<Hallazgo[] | null>(null);
  const [puertos, setPuertos] = useState<PuertoDelEquipo[]>([]);
  /** La señal cuyo detalle esta abierto, o null. */
  const [detalle, setDetalle] = useState<string | null>(null);

  /* Kiosco: estado del modal de desbloqueo */
  const [clave, setClave] = useState('');
  const [claveError, setClaveError] = useState(false);
  const [menuKiosco, setMenuKiosco] = useState(false);
  const claveRef = useRef<HTMLInputElement>(null);

  const validarClave = () => {
    if (clave === CLAVE_KIOSCO) {
      setClaveError(false);
      setClave('');
      setMenuKiosco(true);
      desbloquear().catch(() => undefined);
    } else {
      setClaveError(true);
      setClave('');
      setTimeout(() => setClaveError(false), 2000);
    }
  };

  /* Que trae este equipo y que esta midiendo ahora, para poder calibrar
     mirando numeros de verdad en vez de a ciegas. */
  const [imu, setImu] = useState<Awaited<ReturnType<typeof movimiento.queHay>> | null>(null);
  const [vivo, setVivo] = useState<Senal[] | null>(null);

  useEffect(() => {
    if (movimiento.hay()) movimiento.queHay().then(setImu).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!cfg.movimiento.activo) { setVivo(null); return; }
    movimiento.aplicar(cfg.movimiento, setVivo);
  }, [cfg.movimiento]);

  /* El numero de ttyUSB puede cambiar entre arranques, asi que la lista se le
     pide al equipo en vez de escribirla a fuego. */
  useEffect(() => {
    hardware.puertos().then(setPuertos).catch(() => undefined);
  }, []);

  const buscar = async () => {
    setBuscando(true);
    setHallazgos(null);
    try {
      const r = await hardware.buscarPuertos(setProbando);
      setHallazgos(r.found);
      /* El escaneo paro los hilos de lectura; hay que devolverlos a su sitio. */
      /* Los ajustes de las señales antes de arrancar: si una fuente entrega su primera trama
         entre las dos lineas, se leeria sin sus ajustes. */
      hardware.ajustarSenales(cfg.senales);
      for (const f of cfg.fuentes) hardware.arrancar(f).catch(() => undefined);
    } catch (e: unknown) {
      setHallazgos([]);
      setEco(e instanceof Error ? e.message : 'No se pudo buscar');
      setTimeout(() => setEco(null), 4000);
    } finally {
      setBuscando(false);
      setProbando(null);
    }
  };

  /* Las calibraciones guardadas, para poder enseñar cuando se tomo la de ahora
     y volver a una anterior si alguien la repitio en mal sitio. */
  const mirarCalibraciones = async () => {
    try {
      setCalibs(await calibraciones('imu', 5));
    } catch {
      setCalibs([]);
    }
  };

  const mirarPeso = async () => {
    try {
      setPeso(await resumen());
    } catch {
      setPeso(null);
    }
  };

  useEffect(() => {
    if (pestana === 'datos') mirarPeso();
    if (pestana === 'inercial') mirarCalibraciones();
  }, [pestana]);

  useEffect(() =>
    hardware.alRecibir((t: TramaVista) => {
      setVistas((prev) => {
        const m = new Map(prev);
        for (const s of t.senales) m.set(`${t.fuenteId}.${s.clave}`, s);
        return m;
      });
    }), []);

  const aplicar = (c: Config) => {
    setCfg(c);
    guardar(c);
    registro.aplicar(c.registro);
    envio.aplicar(c.envio);
    rumbo.aplicar(c.rumbo);
    setEco(`Guardado a las ${new Date().toLocaleTimeString('es-PE')}`);
    setTimeout(() => setEco(null), 2500);
  };

  const cambiarFuente = (i: number, f: Fuente) => {
    aplicar({ ...cfg, fuentes: cfg.fuentes.map((x, j) => (j === i ? f : x)) });
    hardware.arrancar(f).catch(() => undefined);
  };

  const cambiarServidor = (s: Partial<Servidor>) =>
    aplicar({ ...cfg, servidor: { ...cfg.servidor, ...s } });

  /* ── Actualización de la aplicación ───────────────────────────────────── */
  const [instalada, setInstalada] = useState<VersionInstalada | null>(null);
  const [bajada, setBajada] = useState<Descarga | null>(null);
  const [bajando, setBajando] = useState(false);
  const [avance, setAvance] = useState(0);
  const [avanceTotal, setAvanceTotal] = useState(0);

  useEffect(() => {
    if (!hayActualizador()) return;
    actualizador.version().then(setInstalada).catch(() => undefined);
  }, []);

  const avisoUrl = cfg.actualizacion.url.trim() ? reparo(cfg.actualizacion.url) : null;

  const buscarActualizacion = async () => {
    if (!hayActualizador()) {
      setEco('Actualizar solo funciona en el equipo.');
      return;
    }
    setBajando(true);
    setBajada(null);
    setAvance(0);
    setAvanceTotal(0);
    try {
      const d = await actualizador.descargar(cfg.actualizacion.url, (bytes, total) => {
        setAvance(bytes);
        setAvanceTotal(total);
      });
      setBajada(d);
      /* El permiso puede haberse concedido entre medias. */
      actualizador.version().then(setInstalada).catch(() => undefined);
    } catch (e) {
      setEco(String((e as Error).message ?? e));
    } finally {
      setBajando(false);
    }
  };
  /* ── Plano y geocercas ────────────────────────────────────────────────── */
  const [loMio, setLoMio] = useState<Descargado | null>(() => guardado());
  const [bajandoMapa, setBajandoMapa] = useState(false);

  /**
   * Baja el plano y las geocercas.
   *
   * Se entra primero para tener token fresco: el guardado caduca y renovarlo
   * en silencio es mejor que enseñar un 401 que nadie sabe interpretar.
   */
  const bajarMapa = async () => {
    const { url, usuario, clave } = cfg.servidor;
    if (!url.trim()) {
      setEco('Falta la dirección del servidor.');
      return;
    }
    setBajandoMapa(true);
    try {
      let token = cfg.servidor.token;
      if (usuario.trim() && clave) {
        token = await entrar(url, usuario.trim(), clave);
        aplicar({ ...cfg, servidor: { ...cfg.servidor, token } });
      }
      const d = await descargar(url, token);
      setLoMio(d);
      setEco(`${d.geocercas.length} geocercas${d.plano ? ' y el plano' : ''}`);
    } catch (e) {
      setEco(String((e as Error).message ?? e));
    } finally {
      setBajandoMapa(false);
      setTimeout(() => setEco(null), 5000);
    }
  };

  const cambiarPanel = (panel: Config['panel']) => aplicar({ ...cfg, panel });

  const cambiarTarjeta = (id: string, cambio: Partial<Tarjeta>) =>
    cambiarPanel(cfg.panel.map((t) => (t.id === id ? { ...t, ...cambio } : t)));

  const mover = (i: number, paso: number) => {
    const j = i + paso;
    if (j < 0 || j >= cfg.panel.length) return;
    const p = [...cfg.panel];
    [p[i], p[j]] = [p[j], p[i]];
    cambiarPanel(p);
  };

  const disponibles = useMemo(() => [...vistas.entries()], [vistas]);
  /* La inercial va en su pestaña: no llega por ningun cable, la mide el propio
     equipo, y mezclarla con los sensores del camion confundia las dos cosas. */
  const deCable = useMemo(() => disponibles.filter(([c]) => !c.startsWith('imu.')), [disponibles]);
  const deLaInercial = useMemo(() => disponibles.filter(([c]) => c.startsWith('imu.')), [disponibles]);

  return (
    <IonPage>
      <IonHeader className="ion-no-border">
        <IonToolbar style={{ '--background': 'var(--sur)', '--border-width': '0' } as never}>
          <IonButtons slot="start"><IonBackButton defaultHref="/" text="" /></IonButtons>
          <IonTitle className="font-titulo text-[16px] font-bold">Configuración</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent scrollY={false} style={{ '--background': 'var(--bg)' } as never}>
        <div className="flex h-full min-h-0">
          <Pestanas opciones={PESTANAS} puesta={pestana} alElegir={setPestana} />

          {/* El contenido se para en 900 px: una línea de texto de 1100 px de
              ancho no se lee, se recorre. */}
          <div className="desplazable flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5 pb-16" style={{ maxWidth: 900 }}>

          {!hayHardware() && (
            <Aviso>
              Estás fuera del equipo: se puede configurar todo, pero los puertos no existen aquí
              y no llegará ninguna lectura.
            </Aviso>
          )}

          {/* ── Fuentes ────────────────────────────────────────────────── */}
          {pestana === 'sensores' && (
            <Bloque
              titulo="De dónde se lee"
              accion={
                <div className="flex gap-2">
                  <Boton onClick={() => aplicar({ ...cfg, fuentes: [...cfg.fuentes, nuevaFuente('rs485')] })}>
                    + RS485
                  </Boton>
                  <Boton onClick={() => aplicar({ ...cfg, fuentes: [...cfg.fuentes, nuevaFuente('can1')] })}>
                    + CAN
                  </Boton>
                  <Boton onClick={() => aplicar({ ...cfg, fuentes: [...cfg.fuentes, nuevaFuente('red')] })}>
                    + Por red
                  </Boton>
                </div>
              }
            >
              <Nota>
                <b className="text-ink2">Por el cable de red no hay nada que configurar aparte
                del puerto.</b> El equipo se pone su dirección solo al arrancar y se queda
                escuchando; el HelperBox empuja sus lecturas sin esperar respuesta. Se hace así
                porque esta boca de red <b className="text-ink2">recibe pero no transmite</b>, y
                con eso no se puede pedir nada ni contestar a nadie.
              </Nota>

              <div className="flex flex-col gap-2.5 rounded-xl bg-sur2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="rotulo">¿No sabes dónde está conectado?</span>
                  <Boton variante="fuerte" onClick={buscar} disabled={buscando}>
                    {buscando ? 'Buscando…' : 'Buscar puertos'}
                  </Boton>
                </div>
                <Nota>
                  Prueba cada puerto con cada velocidad y escucha un momento. Tarda cerca de un
                  minuto y <b className="text-ink2">para la lectura mientras dura</b>: dos
                  lectores sobre el mismo puerto se pisan.
                </Nota>

                {probando && (
                  <p className="m-0 font-mono text-[11px] text-ink3">
                    probando {probando.port} a {probando.baudrate}…
                  </p>
                )}

                {hallazgos && (
                  hallazgos.length === 0 ? (
                    <Aviso tono="warn">
                      No contestó nada en ningún puerto. Revisa que el aparato esté alimentado y
                      el cable conectado.
                    </Aviso>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {hallazgos.map((h) => (
                        <div
                          key={`${h.port}-${h.baudrate}`}
                          className="flex flex-col gap-2 rounded-lg border border-acc/40 bg-acc/10 px-3.5 py-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-mono text-[12.5px] text-acc">
                              {h.port} · {h.baudrate} bd
                              {h.kind && (
                                <span className="ml-2 uppercase text-ink2">{h.kind}</span>
                              )}
                            </span>
                            <Boton
                              onClick={() => {
                                const f = nuevaFuente('rs485');
                                aplicar({
                                  ...cfg,
                                  fuentes: [...cfg.fuentes, {
                                    ...f,
                                    nombre: h.kind ? `${h.kind.toUpperCase()} en ${h.port}` : f.nombre,
                                    ruta: h.port,
                                    baudios: h.baudrate,
                                  }],
                                });
                              }}
                            >
                              Usar
                            </Boton>
                          </div>

                          <p className="m-0 font-mono text-[10.5px] leading-relaxed text-ink3">
                            {h.score} {h.score === 1 ? 'trama cuadró' : 'tramas cuadraron'}
                            {h.sample && ` · ${h.sample.slice(0, 46)}`}
                          </p>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>

              {cfg.fuentes.length === 0 && (
                <Vacio>
                  Todavía no hay ninguna fuente. Añade el RS485 por donde llega el HelperBox,
                  o el bus CAN si lees los sensores directamente.
                </Vacio>
              )}

              {cfg.fuentes.map((f, i) => {
                const proto = protocolo(f.protocoloId);
                const esSerie = f.puerto === 'rs485';
                /* La red trae las mismas tramas que el cable serie —lineas de
                   texto, no tramas del bus—, asi que se le ofrecen esos
                   protocolos. Estaba cayendo en la rama del CAN y el selector
                   enseñaba un protocolo que no era el suyo. */
                const familia = f.puerto === 'can1' || f.puerto === 'can2' ? 'can' : 'serie';

                return (
                  <div key={f.id} className="flex flex-col gap-3.5 rounded-xl border border-line bg-sur2 p-4">
                    <div className="grid grid-cols-2 gap-3">
                      <Campo etiqueta="Nombre">
                        <Entrada value={f.nombre} onChange={(e) => cambiarFuente(i, { ...f, nombre: e.target.value })} />
                      </Campo>
                      <Campo etiqueta="Puerto">
                        <Selector
                          value={f.puerto}
                          onChange={(e) => {
                            const puerto = e.target.value as Fuente['puerto'];
                            const nuevo = protocolosDe(puerto === 'can1' || puerto === 'can2' ? 'can' : 'serie')[0];
                            cambiarFuente(i, { ...f, puerto, protocoloId: nuevo.id, config: defectosDe(nuevo) });
                          }}
                        >
                          {PUERTOS.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </Selector>
                      </Campo>

                      {f.puerto === 'red' ? (
                        <Campo
                          etiqueta="Puerto en el que se escucha"
                          ayuda="Tiene que ser el mismo al que emite el HelperBox. Por defecto, el 9977."
                        >
                          <Entrada
                            type="number"
                            min={1}
                            max={65535}
                            value={f.baudios}
                            onChange={(e) => cambiarFuente(i, { ...f, baudios: Number(e.target.value) })}
                          />
                        </Campo>
                      ) : esSerie ? (
                        <>
                          <Campo
                            etiqueta="Dispositivo"
                            ayuda={puertos.find((p) => p.ruta === f.ruta)?.papel}
                          >
                            {puertos.length > 0 ? (
                              <Selector
                                value={f.ruta}
                                onChange={(e) => cambiarFuente(i, { ...f, ruta: e.target.value })}
                              >
                                {/* Si lo guardado ya no existe se deja en la lista, para
                                    no cambiarle el puerto a nadie por la espalda. */}
                                {!puertos.some((p) => p.ruta === f.ruta) && (
                                  <option value={f.ruta}>{f.ruta} · no está</option>
                                )}
                                {puertos.map((p) => (
                                  <option key={p.ruta} value={p.ruta}>
                                    {p.papel} · {p.ruta}
                                    {p.rama && p.rama !== 'SoC' ? ` (${p.rama})` : ''}
                                  </option>
                                ))}
                              </Selector>
                            ) : (
                              <Entrada
                                value={f.ruta}
                                onChange={(e) => cambiarFuente(i, { ...f, ruta: e.target.value })}
                              />
                            )}
                          </Campo>
                          <Campo etiqueta="Baudios">
                            <Selector value={f.baudios}
                              onChange={(e) => cambiarFuente(i, { ...f, baudios: Number(e.target.value) })}>
                              {BAUDIOS.map((b) => <option key={b} value={b}>{b}</option>)}
                            </Selector>
                          </Campo>
                        </>
                      ) : (
                        <Campo etiqueta="Bitrate del bus">
                          <Selector value={f.bitrate}
                            onChange={(e) => cambiarFuente(i, { ...f, bitrate: Number(e.target.value) })}>
                            {BITRATES.map((b) => <option key={b} value={b}>{b}</option>)}
                          </Selector>
                        </Campo>
                      )}

                      <Campo etiqueta="Qué habla por ahí">
                        <Selector
                          value={f.protocoloId}
                          onChange={(e) => {
                            const p = protocolo(e.target.value);
                            cambiarFuente(i, { ...f, protocoloId: p.id, config: defectosDe(p) });
                          }}
                        >
                          {protocolosDe(familia).map((p) => (
                            <option key={p.id} value={p.id}>{p.nombre}</option>
                          ))}
                        </Selector>
                      </Campo>
                    </div>

                    <Nota>{proto.descripcion}</Nota>

                    <div className="grid grid-cols-2 gap-3">
                      {proto.campos
                        .filter((c) => c.tipo !== 'senales' && (avanzado || !c.avanzado))
                        .map((c) => (
                          <CampoDeclarado
                            key={c.clave}
                            campo={c}
                            valor={f.config[c.clave]}
                            alCambiar={(v) => cambiarFuente(i, { ...f, config: { ...f.config, [c.clave]: v } })}
                          />
                        ))}
                    </div>

                    {proto.campos.filter((c) => c.tipo === 'senales').map((c) => (
                      <div key={c.clave} className="flex flex-col gap-2">
                        <span className="rotulo">{c.etiqueta}</span>
                        <Nota>{c.ayuda}</Nota>
                        <EditorSenales
                          lista={(f.config[c.clave] as SenalManual[]) ?? []}
                          alCambiar={(l) => cambiarFuente(i, { ...f, config: { ...f.config, [c.clave]: l } })}
                        />
                      </div>
                    ))}

                    <div className="flex items-center justify-between gap-3 border-t border-line pt-3.5">
                      <Interruptor
                        activo={f.activa}
                        alCambiar={(v) => cambiarFuente(i, { ...f, activa: v })}
                        etiqueta="Leer de esta fuente"
                      />
                      <Boton
                        variante="peligro"
                        onClick={() => {
                          hardware.quitar(f.id);
                          aplicar({ ...cfg, fuentes: cfg.fuentes.filter((_, j) => j !== i) });
                        }}
                      >
                        Quitar
                      </Boton>
                    </div>
                  </div>
                );
              })}

              {cfg.fuentes.length > 0 && (
                <Interruptor
                  activo={avanzado}
                  alCambiar={setAvanzado}
                  etiqueta="Mostrar los valores del manual del fabricante"
                />
              )}
            </Bloque>
          )}

          {/* ── Las señales que llegan ─────────────────────────────────── */}
          {pestana === 'sensores' && (
            <Bloque titulo="Las señales que llegan">
              <Nota>
                Una por cada cosa que el equipo está midiendo. Pulsa <b>Detalles</b> para ponerle
                nombre, unidad, curva de calibración y decidir si se guarda y si sale hacia
                fuera. Lo que se ve aquí es el valor ya ajustado.
              </Nota>

              {deCable.length === 0 ? (
                <Vacio>
                  Todavía no llega nada por cable ni por red. Da de alta una fuente arriba, o
                  enciende los datos de prueba en la pestaña Panel. Lo que mide el propio
                  equipo está en la pestaña Inercial.
                </Vacio>
              ) : (
                <div className="overflow-hidden rounded-xl border border-line">
                  {deCable.map(([clave, s], i) => {
                    const a = ajustesDe(cfg.senales, clave);
                    const f = cfg.fuentes.find((x) => clave.startsWith(`${x.id}.`));
                    const de = clave.startsWith('imu.')
                      ? 'inercial'
                      : f
                        ? NOMBRE_PUERTO[f.puerto] ?? f.puerto
                        : '—';

                    return (
                      <div
                        key={clave}
                        className={`flex items-center gap-3 px-3.5 py-2.5 ${i % 2 ? 'bg-bg' : 'bg-sur2'}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] text-ink">
                            {a.alias.trim() || s.nombre}
                            {a.curva.length >= 2 && (
                              <em className="ml-2 not-italic text-[10.5px] text-acc">calibrada</em>
                            )}
                            {a.factor !== 1 && (
                              <em className="ml-2 not-italic text-[10.5px] text-ink3">×{a.factor}</em>
                            )}
                          </div>
                          <div className="truncate font-mono text-[10.5px] text-ink3">
                            {clave} · {de}
                            {!a.guardar && ' · no se guarda'}
                            {!a.enviar && ' · no sale'}
                          </div>
                        </div>

                        <div className="shrink-0 text-right">
                          <b className="tabular-nums text-[15px] text-ink">
                            {s.valor === null || s.valor === undefined ? '—' : String(s.valor)}
                          </b>
                          {(a.unidad.trim() || s.unidad) && (
                            <em className="ml-1 font-mono text-[11px] not-italic text-ink3">
                              {a.unidad.trim() || s.unidad}
                            </em>
                          )}
                        </div>

                        <Boton variante="tenue" onClick={() => setDetalle(clave)}>
                          Detalles
                        </Boton>
                      </div>
                    );
                  })}
                </div>
              )}
            </Bloque>
          )}

          {/* ── Los huecos del panel ───────────────────────────────────── */}
          {pestana === 'panel' && (
            <Bloque titulo="Qué va en cada cuadro del panel">
              <Nota>
                Los cuatro primeros son los principales y van arriba del todo: combustible,
                revoluciones, temperatura y aire de ruedas. Ya vienen con su instrumento, su
                icono y su unidad; lo único que hay que decirles es <b>qué señal leen</b>. Debajo
                quedan cuadros libres para lo que traiga cada instalación.
              </Nota>

              <Nota>
                Aquí se decide <b>cómo se ve</b> cada señal. Cómo se llama, en qué unidad y su
                curva de calibración son de la señal, no del cuadro, y se tocan en{' '}
                <b>Sensores → Detalles</b>: así siguen siendo las mismas se enseñen donde se
                enseñen. Lo que se ponga aquí de nombre o unidad solo cambia este cuadro.
              </Nota>

              {cfg.panel.map((t, i) => {
                const forma = vista(t.vista);
                const puesta = t.claves[0] ? vistas.get(t.claves[0]) : undefined;
                const principal = esPrincipal(t);
                const primerSuelto = !principal && cfg.panel.slice(0, i).every(esPrincipal);

                return (
                  <div key={t.id}>
                    {i === 0 && <p className="rotulo mb-2">Los cuatro principales</p>}
                    {primerSuelto && <p className="rotulo mb-2 mt-4">Los de debajo</p>}

                  <div className={`rounded-xl border bg-bg px-3.5 py-3 ${
                    principal ? 'border-acc/40' : 'border-line'
                  }`}>
                    <div className="mb-3 flex items-center gap-2">
                      <span className="rotulo flex-1">
                        {principal ? t.titulo || `Principal ${i + 1}` : `Cuadro ${i + 1}`}
                        {t.claves.length === 0 && (
                          <em className="ml-2 not-italic text-ink3">sin señal</em>
                        )}
                      </span>
                      <Boton variante="tenue" onClick={() => mover(i, -1)} disabled={i === 0}>↑</Boton>
                      <Boton variante="tenue" onClick={() => mover(i, 1)} disabled={i === cfg.panel.length - 1}>↓</Boton>
                      {cfg.panel.length > 1 && (
                        <Boton variante="peligro" onClick={() => cambiarPanel(cfg.panel.filter((x) => x.id !== t.id))}>
                          Quitar
                        </Boton>
                      )}
                    </div>

                    <Campo
                      etiqueta="Sensor que se muestra"
                      ayuda={
                        forma.senales > 1
                          ? 'Esta forma usa dos señales; la segunda se elige más abajo.'
                          : undefined
                      }
                    >
                      <Selector
                        value={t.claves[0] ?? ''}
                        onChange={(e) => {
                          const c = e.target.value;
                          const s = c ? vistas.get(c) : undefined;
                          cambiarTarjeta(t.id, {
                            claves: c ? [c, ...t.claves.slice(1, forma.senales)] : [],
                            /* Se propone el icono que le pega al nombre de la señal, pero
                               solo si no habia uno elegido: si el usuario ya puso el suyo,
                               cambiar de sensor no tiene por que quitarselo. */
                            icono: t.icono || (s ? iconoSugerido(s.nombre) : ''),
                            vista: !t.claves.length && s && typeof s.valor === 'string' ? 'texto' : t.vista,
                          });
                        }}
                      >
                        <option value="">— ninguno, el cuadro queda vacío —</option>
                        {disponibles.map(([clave, s]) => (
                          <option key={clave} value={clave}>
                            {s.nombre}{s.unidad ? ` (${s.unidad})` : ''}
                          </option>
                        ))}
                      </Selector>
                    </Campo>

                    {puesta && (
                      <p className="mb-2 mt-1 text-[11.5px] text-ink3">
                        Ahora vale{' '}
                        <b className="tabular-nums text-ink2">
                          {puesta.valor === null || puesta.valor === undefined ? '—' : String(puesta.valor)}
                        </b>
                        {puesta.unidad ? ` ${puesta.unidad}` : ''}
                      </p>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      <Campo etiqueta="Nombre" ayuda="Vacío = el de la señal.">
                        <Entrada
                          value={t.titulo}
                          placeholder={puesta?.nombre ?? 'el de la señal'}
                          onChange={(e) => cambiarTarjeta(t.id, { titulo: e.target.value })}
                        />
                      </Campo>

                      <Campo etiqueta="Icono">
                        <Selector
                          value={t.icono}
                          onChange={(e) => cambiarTarjeta(t.id, { icono: e.target.value })}
                        >
                          <option value="">— sin icono —</option>
                          {ICONOS.map((ic) => (
                            <option key={ic.id} value={ic.id}>{ic.nombre}</option>
                          ))}
                        </Selector>
                      </Campo>

                      <Campo etiqueta="Cómo se ve">
                        <Selector
                          value={t.vista}
                          onChange={(e) => {
                            const v = e.target.value as VistaTarjeta;
                            cambiarTarjeta(t.id, { vista: v, claves: t.claves.slice(0, vista(v).senales) });
                          }}
                        >
                          {VISTAS.map((v) => (
                            <option key={v.id} value={v.id}>{v.nombre}</option>
                          ))}
                        </Selector>
                      </Campo>

                      {forma.usa.includes('unidad') && (
                        <Campo etiqueta="Unidad" ayuda="Vacía = la de la señal.">
                          <Entrada
                            value={t.unidad}
                            placeholder={puesta?.unidad || 'la de la señal'}
                            onChange={(e) => cambiarTarjeta(t.id, { unidad: e.target.value })}
                          />
                        </Campo>
                      )}

                      {forma.usa.includes('decimales') && (
                        <Campo etiqueta="Decimales">
                          <Selector
                            value={String(t.decimales)}
                            onChange={(e) => cambiarTarjeta(t.id, { decimales: Number(e.target.value) })}
                          >
                            {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                          </Selector>
                        </Campo>
                      )}

                      {forma.usa.includes('rango') && (
                        <>
                          <Campo etiqueta="Mínimo">
                            <Entrada
                              type="number"
                              value={t.min}
                              onChange={(e) => cambiarTarjeta(t.id, { min: Number(e.target.value) })}
                            />
                          </Campo>
                          <Campo etiqueta="Máximo">
                            <Entrada
                              type="number"
                              value={t.max}
                              onChange={(e) => cambiarTarjeta(t.id, { max: Number(e.target.value) })}
                            />
                          </Campo>
                        </>
                      )}
                    </div>

                    {forma.senales > 1 && (
                      <>
                        <p className="rotulo mb-1.5 mt-3">Segunda señal, la que se resta o se suma</p>
                        <Selector
                          value={t.claves[1] ?? ''}
                          onChange={(e) => {
                            const c = e.target.value;
                            cambiarTarjeta(t.id, {
                              claves: c ? [t.claves[0] ?? '', c].filter(Boolean) : t.claves.slice(0, 1),
                            });
                          }}
                        >
                          <option value="">— ninguna —</option>
                          {disponibles.map(([clave, s]) => (
                            <option key={clave} value={clave}>
                              {s.nombre}{s.unidad ? ` (${s.unidad})` : ''}
                            </option>
                          ))}
                        </Selector>
                      </>
                    )}

                    <div className="mt-3">
                      <Interruptor
                        activo={t.grande}
                        alCambiar={(v) => cambiarTarjeta(t.id, { grande: v })}
                        etiqueta="Ocupa el ancho entero"
                      />
                    </div>
                  </div>
                  </div>
                );
              })}

              <div className="flex flex-wrap gap-2">
                <Boton onClick={() => cambiarPanel([...cfg.panel, nuevaTarjeta('numero')])}>
                  + Añadir un cuadro
                </Boton>
                <Boton variante="tenue" onClick={() => cambiarPanel(panelFijo())}>
                  Dejarlo como de fábrica
                </Boton>
              </div>
            </Bloque>
          )}

          {pestana === 'panel' && (
            <Bloque titulo="Ver la pantalla sin hardware">
              <Nota>
                Genera un camión de mentira que recorre una ruta y da caudales, nivel,
                revoluciones y temperatura. Sirve para decidir cómo se ve el panel mientras
                no haya sensores conectados.
              </Nota>

              <Interruptor
                activo={cfg.maqueta}
                alCambiar={(v) => {
                  aplicar({ ...cfg, maqueta: v });
                  if (v) maqueta.encender();
                  else maqueta.apagar();
                }}
                etiqueta="Datos de prueba"
              />

              {cfg.maqueta && (
                <Aviso tono="warn">
                  Mientras esté puesto, la pantalla principal enseña datos inventados y lo
                  avisa. No se guardan en la base ni se mandan a ningún sitio, y se apaga
                  sola al reiniciar la aplicación.
                </Aviso>
              )}
            </Bloque>
          )}

          {/* ── Inercial ───────────────────────────────────────────────── */}
          {pestana === 'inercial' && (
            <>
              <Bloque titulo="Movimiento e inclinación">
                <Nota>
                  El equipo lleva dentro una unidad inercial. No hace falta cable ni que el
                  camión hable ningún protocolo: mide cómo está inclinado, cómo se conduce y
                  cómo está la vía. Eso último es lo que luego permite cruzar los baches con
                  el consumo y ver si una rampa mal mantenida está costando combustible.
                </Nota>

                {imu && !imu.acelerometro && (
                  <Aviso tono="bad">Este equipo no tiene acelerómetro.</Aviso>
                )}

                {imu && imu.acelerometro && (
                  <Nota>
                    {imu.nombre} · hasta {imu.maxHz} Hz
                    {imu.giroscopo ? ' · con giróscopo' : ' · sin giróscopo'}
                    {imu.barometro ? ' · con barómetro' : ''}
                  </Nota>
                )}

                <Interruptor
                  activo={cfg.movimiento.activo}
                  alCambiar={(v) =>
                    aplicar({ ...cfg, movimiento: { ...cfg.movimiento, activo: v } })
                  }
                  etiqueta="Usar la unidad inercial"
                />

                {cfg.movimiento.activo && (
                  <>
                    <div className="rounded-xl border border-line bg-bg p-3.5">
                      <div className="mb-2 text-[11px] uppercase tracking-wide text-ink3">
                        Referencia
                      </div>

                      {cfg.movimiento.ref ? (
                        <Nota>
                          Calibrado. La inclinación se mide contra esta posición.
                          {calibs[0] && (
                            <>
                              {' '}Guardada en la base del equipo el{' '}
                              <b>{new Date(calibs[0].at).toLocaleString('es-PE')}</b>.
                            </>
                          )}
                        </Nota>
                      ) : (
                        <Aviso tono="warn">
                          Sin calibrar. Hasta que no se calibre, la inclinación no se puede
                          calcular: el aparato no sabe cuál es el suelo.
                        </Aviso>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-3">
                        <Boton
                          onClick={() => {
                            const r = movimiento.referenciaDeAhora();
                            if (!r) {
                              setEco('Todavía no llegan lecturas del sensor.');
                              return;
                            }
                            const m = { ...cfg.movimiento, ref: r };
                            aplicar({ ...cfg, movimiento: m });
                            /* Y a la base, que es lo único que sobrevive a
                               borrar los datos de la aplicación. Tomarla nueva
                               obliga a llevar el camión a llano otra vez. */
                            guardarCalibracion('imu', m)
                              .then(() => mirarCalibraciones())
                              .catch(() => undefined);
                            setEco('Calibrado con la posición actual, y guardado en la base.');
                          }}
                        >
                          Calibrar aquí
                        </Boton>

                        {cfg.movimiento.ref && (
                          <Boton
                            variante="peligro"
                            onClick={() =>
                              aplicar({ ...cfg, movimiento: { ...cfg.movimiento, ref: null } })
                            }
                          >
                            Borrar
                          </Boton>
                        )}

                        {/* Volver a una anterior sin bajar a llano otra vez: es
                            para cuando alguien la repite en una rampa. */}
                        {calibs.length > 1 && (
                          <Boton
                            onClick={() => {
                              const previa = calibs[1].datos as AjustesMovimiento;
                              if (!previa?.ref) return;
                              aplicar({ ...cfg, movimiento: previa });
                              setEco(
                                `Recuperada la del ${new Date(calibs[1].at).toLocaleString('es-PE')}.`,
                              );
                            }}
                          >
                            Volver a la anterior
                          </Boton>
                        )}
                      </div>

                      <Nota>
                        Con el camión <b>parado y en llano</b>. Eso fija qué es «derecho»; todo
                        lo demás se mide contra ello.
                      </Nota>
                    </div>

                    <Montaje
                      eje={cfg.movimiento.ejeAvance}
                      invertido={cfg.movimiento.avanceInvertido}
                      referencia={cfg.movimiento.ref}
                      alCambiar={(ejeAvance, avanceInvertido) =>
                        aplicar({
                          ...cfg,
                          movimiento: { ...cfg.movimiento, ejeAvance, avanceInvertido },
                        })
                      }
                    />

                    <Campo etiqueta="Lecturas por segundo">
                      <Selector
                        value={String(cfg.movimiento.cadaMs)}
                        onChange={(e) =>
                          aplicar({
                            ...cfg,
                            movimiento: { ...cfg.movimiento, cadaMs: Number(e.target.value) },
                          })
                        }
                      >
                        <option value="200">5 · suave</option>
                        <option value="100">10 · normal</option>
                        <option value="50">20 · fino</option>
                        <option value="20">50 · muy fino</option>
                      </Selector>
                    </Campo>

                    <div className="grid grid-cols-3 gap-3">
                      <Campo etiqueta="Frenada (m/s²)">
                        <Entrada
                          type="number" step="0.5"
                          value={cfg.movimiento.umbralFrenada}
                          onChange={(e) =>
                            aplicar({
                              ...cfg,
                              movimiento: {
                                ...cfg.movimiento, umbralFrenada: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </Campo>

                      <Campo etiqueta="Bache (m/s²)">
                        <Entrada
                          type="number" step="0.5"
                          value={cfg.movimiento.umbralBache}
                          onChange={(e) =>
                            aplicar({
                              ...cfg,
                              movimiento: {
                                ...cfg.movimiento, umbralBache: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </Campo>

                      <Campo etiqueta="Motor (m/s²)">
                        <Entrada
                          type="number" step="0.05"
                          value={cfg.movimiento.umbralMotor}
                          onChange={(e) =>
                            aplicar({
                              ...cfg,
                              movimiento: {
                                ...cfg.movimiento, umbralMotor: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </Campo>
                    </div>

                    {vivo && (
                      <div className="rounded-xl border border-line bg-bg p-3.5">
                        <div className="mb-2 text-[11px] uppercase tracking-wide text-ink3">
                          Ahora mismo
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-3">
                          {vivo.map((s) => (
                            <div key={s.clave} className="flex justify-between gap-2">
                              <span className="text-ink3">{s.nombre}</span>
                              <b className="tabular-nums">
                                {s.valor === null ? '—' : s.valor} {s.unidad}
                              </b>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3">
                          <Boton onClick={() => movimiento.reiniciarCuentas()}>
                            Poner los contadores a cero
                          </Boton>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </Bloque>

              <Bloque titulo="Lo que mide la inercial">
                <Nota>
                  Las mismas opciones que cualquier otra señal: nombre, unidad, curva, y si se
                  guarda y si sale hacia fuera. Están aquí y no en Sensores porque no llegan por
                  ningún cable — las mide el propio equipo.
                </Nota>

                {deLaInercial.length === 0 ? (
                  <Vacio>
                    La inercial no está publicando. Enciéndela arriba con «Usar la unidad
                    inercial».
                  </Vacio>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-line">
                    {deLaInercial.map(([clave, s], i) => {
                      const a = ajustesDe(cfg.senales, clave);
                      return (
                        <div
                          key={clave}
                          className={`flex items-center gap-3 px-3.5 py-2.5 ${i % 2 ? 'bg-bg' : 'bg-sur2'}`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] text-ink">
                              {a.alias.trim() || s.nombre}
                              {a.curva.length >= 2 && (
                                <em className="ml-2 not-italic text-[10.5px] text-acc">calibrada</em>
                              )}
                              {a.factor !== 1 && (
                                <em className="ml-2 not-italic text-[10.5px] text-ink3">×{a.factor}</em>
                              )}
                            </div>
                            <div className="truncate font-mono text-[10.5px] text-ink3">
                              {clave}
                              {!a.guardar && ' · no se guarda'}
                              {!a.enviar && ' · no sale'}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <b className="tabular-nums text-[15px] text-ink">
                              {s.valor === null || s.valor === undefined ? '—' : String(s.valor)}
                            </b>
                            {(a.unidad.trim() || s.unidad) && (
                              <em className="ml-1 font-mono text-[11px] not-italic text-ink3">
                                {a.unidad.trim() || s.unidad}
                              </em>
                            )}
                          </div>
                          <Boton variante="tenue" onClick={() => setDetalle(clave)}>
                            Detalles
                          </Boton>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Bloque>
            </>
          )}

          {/* ── Posición ───────────────────────────────────────────────── */}
          {pestana === 'posicion' && (
            <>

            <Bloque titulo="GPS y RTK">
              <div className="grid grid-cols-2 gap-3">
                <Campo etiqueta="Dispositivo del receptor">
                  <Entrada
                    value={cfg.gps.ruta}
                    onChange={(e) => aplicar({ ...cfg, gps: { ...cfg.gps, ruta: e.target.value } })}
                  />
                </Campo>
                <Campo
                  etiqueta="Baudios"
                  ayuda="En este equipo el receptor va a 921600. A otra velocidad sólo llega basura."
                >
                  <Selector
                    value={cfg.gps.baudios}
                    onChange={(e) =>
                      aplicar({ ...cfg, gps: { ...cfg.gps, baudios: Number(e.target.value) } })
                    }
                  >
                    {[9600, 38400, 57600, 115200, 230400, 460800, 921600].map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </Selector>
                </Campo>
              </div>

              <Interruptor
                activo={cfg.gps.activo}
                alCambiar={(v) => aplicar({ ...cfg, gps: { ...cfg.gps, activo: v } })}
                etiqueta="Leer la posición"
              />

              <Nota>
                La calidad sale de la sentencia GGA del propio receptor. <b className="text-ink2">RTK
                fijo</b> son unos 2 cm; <b className="text-ink2">GPS autónomo</b>, varios metros.
                La pantalla principal lo enseña siempre, porque no es lo mismo y de lejos se confunde.
              </Nota>

              <Aviso>
                Si no hay posición, lo primero es la antena. El RTK no <i>da</i> la posición: afina
                una que el receptor ya tiene con satélites. Sin satélites no hay posición, con
                correcciones o sin ellas.
              </Aviso>
            </Bloque>

            <Bloque titulo="Cuándo gira el mapa">
              <Nota>
                Arriba es siempre hacia donde se va, y para eso el mapa gira con la marcha. Pero
                el rumbo del receptor sale de comparar dos posiciones, así que{' '}
                <b>parado no significa nada</b>: devuelve cero, o el último valor, o ruido, y el
                mapa se ponía a girar solo con el camión detenido.
              </Nota>

              <div className="grid grid-cols-2 gap-3">
                <Campo
                  etiqueta="Se queda quieto por debajo de (km/h)"
                  ayuda="Ahí el camión maniobra o está parado, y su rumbo no dice nada."
                >
                  <Entrada
                    type="number" step="0.5" min={0}
                    value={Number((cfg.rumbo.minima * 3.6).toFixed(1))}
                    onChange={(e) =>
                      aplicar({
                        ...cfg,
                        rumbo: { ...cfg.rumbo, minima: (Number(e.target.value) || 0) / 3.6 },
                      })
                    }
                  />
                </Campo>
                <Campo
                  etiqueta="Y vuelve a girar pasando de (km/h)"
                  ayuda="Más alto que el anterior a propósito; si no, se enciende y apaga solo."
                >
                  <Entrada
                    type="number" step="0.5" min={0}
                    value={Number((cfg.rumbo.suelta * 3.6).toFixed(1))}
                    onChange={(e) =>
                      aplicar({
                        ...cfg,
                        rumbo: { ...cfg.rumbo, suelta: (Number(e.target.value) || 0) / 3.6 },
                      })
                    }
                  />
                </Campo>
              </div>

              {cfg.rumbo.suelta <= cfg.rumbo.minima && (
                <Aviso tono="warn">
                  El segundo tiene que ser mayor que el primero. Con los dos iguales, un camión
                  que oscile alrededor de esa velocidad engancha y suelta el giro sin parar.
                </Aviso>
              )}

              <Campo
                etiqueta="Suavizado"
                ayuda="Cuánto pesa el rumbo anterior. Más suave aguanta mejor los tirones y llega un poco más tarde a las curvas."
              >
                <Selector
                  value={String(cfg.rumbo.suavizado)}
                  onChange={(e) =>
                    aplicar({
                      ...cfg,
                      rumbo: { ...cfg.rumbo, suavizado: Number(e.target.value) },
                    })
                  }
                >
                  <option value="0">Ninguno · el rumbo tal cual</option>
                  <option value="0.3">Poco</option>
                  <option value="0.55">Normal</option>
                  <option value="0.75">Mucho</option>
                </Selector>
              </Campo>

              <Nota>
                Se ajusta en el camión, no aquí: sal a dar una vuelta y mira si el mapa persigue
                los tirones —súbelo— o si llega tarde a las curvas —bájalo—.
              </Nota>
            </Bloque>

            <Bloque titulo="Plano de la mina y geocercas">
                <Nota>
                  Un mapa de calles no dice nada dentro de una mina. Esto baja el plano de la
                  empresa y las geocercas, y los deja guardados en el equipo: se descargan
                  cuando hay cobertura y se siguen viendo cuando no la hay.
                </Nota>

                <div className="grid grid-cols-2 gap-3">
                  <Campo etiqueta="Usuario">
                    <Entrada
                      type="email"
                      value={cfg.servidor.usuario}
                      placeholder="admin@…"
                      onChange={(e) => cambiarServidor({ usuario: e.target.value })}
                    />
                  </Campo>
                  <Campo etiqueta="Contraseña">
                    <Entrada
                      type="password"
                      value={cfg.servidor.clave}
                      onChange={(e) => cambiarServidor({ clave: e.target.value })}
                    />
                  </Campo>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Boton variante="fuerte" disabled={bajandoMapa} onClick={bajarMapa}>
                    {bajandoMapa ? 'Bajando…' : 'Descargar plano y geocercas'}
                  </Boton>

                  {loMio && (
                    <span className="font-mono text-[11.5px] text-ink2">
                      {loMio.geocercas.length} geocercas
                      {loMio.plano ? ' · plano puesto' : ' · sin plano'}
                      {' · '}
                      {new Date(loMio.at).toLocaleString('es-PE')}
                    </span>
                  )}
                </div>

                {!loMio && (
                  <Vacio>
                    Todavía no se ha bajado nada. Hasta que se baje, el mapa enseña calles en
                    vez del plano de la mina.
                  </Vacio>
                )}
            </Bloque>
            </>
          )}

          {/* ── Datos ──────────────────────────────────────────────────── */}
          {pestana === 'datos' && (
            <Bloque titulo="Lo que se guarda en el equipo">
              <Nota>
                Las lecturas se guardan aquí, en el propio equipo, con la posición del momento.
                Así queda histórico aunque no haya red — y un consumo sin saber dónde se produjo
                sirve para la mitad de las preguntas.
              </Nota>

              <div className="grid grid-cols-2 gap-3">
                <Campo
                  etiqueta="Guardar cada (ms)"
                  ayuda="El bus va a su ritmo; esto manda sobre lo que baja a la base."
                >
                  <Entrada
                    type="number"
                    min={500}
                    step={500}
                    value={cfg.registro.cadaMs}
                    onChange={(e) =>
                      aplicar({ ...cfg, registro: { ...cfg.registro, cadaMs: Number(e.target.value) } })
                    }
                  />
                </Campo>
                <Campo etiqueta="Conservar (horas)" ayuda="Pasado ese tiempo se borra solo.">
                  <Entrada
                    type="number"
                    min={1}
                    max={8760}
                    value={cfg.registro.retencionHoras}
                    onChange={(e) =>
                      aplicar({
                        ...cfg,
                        registro: { ...cfg.registro, retencionHoras: Number(e.target.value) },
                      })
                    }
                  />
                </Campo>
              </div>

              <Interruptor
                activo={cfg.registro.activo}
                alCambiar={(v) => aplicar({ ...cfg, registro: { ...cfg.registro, activo: v } })}
                etiqueta="Guardar histórico"
              />

              <p className="rotulo mb-1.5 mt-4">Qué señales se guardan</p>
              <Nota>
                Se decide en cada señal, en <b>Sensores → Detalles</b> o en <b>Inercial</b>. Aquí solo se ve el
                resultado y lo que va a quedar en la base.
              </Nota>

              {(() => {
                const guardadas = disponibles.filter(([c]) => ajustesDe(cfg.senales, c).guardar);
                const fuera = disponibles.length - guardadas.length;

                if (disponibles.length === 0) {
                  return <Vacio>Todavía no llega ninguna señal que se pueda guardar.</Vacio>;
                }

                return (
                  <>
                    <p className="m-0 font-mono text-[11.5px] text-ink3">
                      {guardadas.length} de {disponibles.length} señales
                      {fuera > 0 && ` · ${fuera} apagada${fuera > 1 ? 's' : ''}`}
                    </p>

                    <p className="rotulo mb-1.5 mt-3">Lo que queda guardado, en cada muestra</p>
                    <pre className="desplazable overflow-x-auto rounded-xl border border-line bg-bg p-3 font-mono text-[11px] leading-relaxed text-ink2">
{JSON.stringify(
  {
    at: Date.now(),
    posicion: { lat: -12.10347, lon: -77.02451 },
    valores: Object.fromEntries(guardadas.map(([c, s]) => [c, s.valor ?? null])),
  },
  null,
  2,
)}
                    </pre>
                  </>
                );
              })()}

              <div className="rounded-xl border border-line bg-bg px-4 py-3">
                <p className="rotulo mb-1.5">Ocupación</p>
                <p className="m-0 font-mono text-[13px] text-ink">
                  {peso === null
                    ? '—'
                    : `${peso.filas.toLocaleString('es-PE')} lecturas`}
                  {peso?.desde && (
                    <span className="ml-2 text-[11px] text-ink3">
                      desde {new Date(peso.desde).toLocaleString('es-PE')}
                    </span>
                  )}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Boton onClick={mirarPeso}>Actualizar</Boton>
                <Boton
                  onClick={async () => {
                    const n = await podar(cfg.registro.retencionHoras);
                    await mirarPeso();
                    setEco(`Podadas ${n.toLocaleString('es-PE')} lecturas viejas`);
                    setTimeout(() => setEco(null), 3000);
                  }}
                >
                  Podar ahora
                </Boton>
                <Boton
                  variante="peligro"
                  onClick={async () => {
                    await vaciar();
                    await mirarPeso();
                    setEco('Histórico borrado');
                    setTimeout(() => setEco(null), 3000);
                  }}
                >
                  Borrar todo
                </Boton>
              </div>

              {!hayBase() && (
                <Aviso tono="bad">
                  Este navegador no tiene almacén de datos, así que no se puede guardar nada.
                </Aviso>
              )}
            </Bloque>
          )}

          {/* ── Envío ──────────────────────────────────────────────────── */}
          {pestana === 'envio' && (
            <Envio
              ajustes={cfg.envio}
              alCambiar={(envio) => aplicar({ ...cfg, envio })}
              salen={disponibles.filter(([c]) => ajustesDe(cfg.senales, c).enviar)}
              alDetalle={setDetalle}
            />
          )}

          {/* ── Servidor ───────────────────────────────────────────────── */}
          {pestana === 'servidor' && (
            <>
            <Bloque titulo="Servidor">
              <Nota>
                Para mandar lo leído y traer lo que haga falta. Si el equipo se queda sin red,
                sigue leyendo y midiendo igual: esto no es imprescindible para trabajar.
              </Nota>

              <div className="grid grid-cols-2 gap-3">
                <Campo etiqueta="Dirección" ayuda="Por ejemplo https://marcobre-back.diplus.io/api">
                  <Entrada value={cfg.servidor.url} placeholder="https://…"
                    onChange={(e) => cambiarServidor({ url: e.target.value })} />
                </Campo>
                <Campo etiqueta="Nombre de este equipo" ayuda="Con qué nombre aparece allá.">
                  <Entrada value={cfg.servidor.equipo} placeholder="CA-14"
                    onChange={(e) => cambiarServidor({ equipo: e.target.value })} />
                </Campo>
                <Campo etiqueta="Token">
                  <Entrada type="password" value={cfg.servidor.token}
                    onChange={(e) => cambiarServidor({ token: e.target.value })} />
                </Campo>
                <Campo etiqueta="Mandar cada (s)">
                  <Entrada type="number" min={5} value={cfg.servidor.cadaSeg}
                    onChange={(e) => cambiarServidor({ cadaSeg: Number(e.target.value) })} />
                </Campo>
              </div>

              <Interruptor
                activo={cfg.servidor.activo}
                alCambiar={(v) => cambiarServidor({ activo: v })}
                etiqueta="Hablar con el servidor"
              />

              <Aviso tono="warn">
                El envío todavía no está hecho: la configuración se guarda, pero de momento no
                sale nada hacia el servidor.
              </Aviso>
            </Bloque>

              <Bloque titulo="Actualizar la aplicación">
                <Nota>
                  El equipo se baja el APK de donde le digas y abre el instalador de Android.
                  Sin Google Play y sin cable. El último paso —pulsar «Instalar»— lo da una
                  persona delante de la máquina: para que entre sola haría falta quitarle la
                  cuenta de Google al equipo.
                </Nota>

                <Campo etiqueta="Dirección del APK de DiPlus">
                  <Entrada
                    value={cfg.actualizacion.url}
                    placeholder="https://…/diplus.apk"
                    onChange={(e) => aplicar({ ...cfg, actualizacion: { ...cfg.actualizacion, url: e.target.value } })}
                  />
                </Campo>

                <Campo etiqueta="Dirección del APK de Tailscale" ayuda="Si está en tu servidor, la tablet lo descargará e instalará automáticamente junto con DiPlus.">
                  <Entrada
                    value={cfg.actualizacion.urlTailscale ?? ''}
                    placeholder="https://…/tailscale.apk"
                    onChange={(e) => aplicar({ ...cfg, actualizacion: { ...cfg.actualizacion, urlTailscale: e.target.value } })}
                  />
                </Campo>

                {/* Vale el enlace de compartir de Drive tal cual: se traduce al de
                    descarga directa al pulsar, porque el de compartir devuelve una
                    página web y es el error que va a cometer todo el mundo. */}
                {cfg.actualizacion.url.includes('drive.google.com') && (
                  <p className="m-0 font-mono text-[10.5px] leading-relaxed text-ink3">
                    Se pedirá como {arreglarDireccion(cfg.actualizacion.url)}
                  </p>
                )}

                {avisoUrl && <Aviso tono="warn">{avisoUrl}</Aviso>}

                <div className="flex flex-wrap items-center gap-4">
                  <Interruptor
                    activo={cfg.actualizacion.automatica}
                    alCambiar={(v) =>
                      aplicar({ ...cfg, actualizacion: { ...cfg.actualizacion, automatica: v } })
                    }
                    etiqueta="Buscarla sola"
                  />

                  {cfg.actualizacion.automatica && (
                    <Campo etiqueta="Cada (horas)">
                      <Entrada
                        type="number" min={1} max={168}
                        value={cfg.actualizacion.cadaHoras}
                        onChange={(e) =>
                          aplicar({
                            ...cfg,
                            actualizacion: { ...cfg.actualizacion, cadaHoras: Number(e.target.value) },
                          })
                        }
                      />
                    </Campo>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Boton
                    variante="fuerte"
                    disabled={bajando || !cfg.actualizacion.url.trim()}
                    onClick={buscarActualizacion}
                  >
                    {bajando ? 'Bajando…' : 'Buscar actualización'}
                  </Boton>

                  {instalada && (
                    <span className="font-mono text-[11.5px] text-ink3">
                      instalada {instalada.versionName} ({instalada.versionCode})
                    </span>
                  )}
                </div>

                {bajando && avance > 0 && (
                  <p className="m-0 font-mono text-[11.5px] text-ink2">
                    {(avance / 1048576).toFixed(1)} MB
                    {avanceTotal > 0 && ` de ${(avanceTotal / 1048576).toFixed(1)} MB`}
                  </p>
                )}

                {bajada && instalada && (
                  <div className="rounded-xl border border-acc/40 bg-acc/10 px-3.5 py-3">
                    <p className="m-0 font-mono text-[12.5px] text-acc">
                      {bajada.versionName} ({bajada.versionCode}) ·{' '}
                      {(bajada.bytes / 1048576).toFixed(1)} MB
                    </p>

                    <p className="m-0 mt-1 text-[11.5px] leading-relaxed text-ink2">
                      {esMasNueva(bajada.versionCode, instalada.versionCode)
                        ? 'Es más nueva que la instalada.'
                        : bajada.versionCode === instalada.versionCode
                          ? 'Es la misma que ya está puesta. Instalarla no cambia nada.'
                          : 'Es más vieja que la instalada, y Android no deja instalar hacia atrás: ' +
                            'primero habría que desinstalar, y eso se lleva la base de datos por delante.'}
                    </p>

                    <div className="mt-2.5">
                      <Boton
                        variante="fuerte"
                        disabled={!esMasNueva(bajada.versionCode, instalada.versionCode)}
                        onClick={async () => {
                          try {
                            await actualizador.instalar(bajada.ruta);
                          } catch (e) {
                            setEco(String((e as Error).message ?? e));
                          }
                        }}
                      >
                        Instalar
                      </Boton>
                    </div>
                  </div>
                )}

                {instalada && !instalada.puedeInstalar && (
                  <Aviso tono="warn">
                    Android todavía no deja instalar desde esta aplicación. Al pulsar «Instalar»
                    sale la pantalla del permiso; se concede una vez y ya queda.
                  </Aviso>
                )}
              </Bloque>

              <Bloque titulo="Acceso remoto">
                <Nota>
                  Abre una puerta en el equipo para poder mirarlo de lejos sin cable. No
                  depende del ADB, que muere en cada reinicio, así que sigue en pie después
                  de un corte de energía.
                </Nota>

                <Aviso tono="warn">
                  <b>Solo deja mirar.</b> Se puede ver el estado, los puertos y lo que entra
                  por ellos, y pedir que busque una versión nueva. No se puede cambiar la
                  configuración desde fuera. Aun así es una puerta: sin token no se abre, y
                  conviene que solo sea alcanzable por la red privada.
                </Aviso>

                <div className="grid grid-cols-2 gap-3">
                  <Campo etiqueta="Puerto">
                    <Entrada
                      type="number"
                      value={cfg.canal.puerto}
                      onChange={(e) =>
                        aplicar({ ...cfg, canal: { ...cfg.canal, puerto: Number(e.target.value) } })
                      }
                    />
                  </Campo>

                  <Campo etiqueta="Token" ayuda="Sin esto no se abre.">
                    <Entrada
                      value={cfg.canal.token}
                      placeholder="una palabra larga"
                      onChange={(e) =>
                        aplicar({ ...cfg, canal: { ...cfg.canal, token: e.target.value } })
                      }
                    />
                  </Campo>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Boton
                    onClick={() =>
                      aplicar({
                        ...cfg,
                        canal: { ...cfg.canal, token: Math.random().toString(36).slice(2)
                          + Math.random().toString(36).slice(2) },
                      })
                    }
                  >
                    Generar token
                  </Boton>

                  <Interruptor
                    activo={cfg.canal.activo}
                    alCambiar={(v) => aplicar({ ...cfg, canal: { ...cfg.canal, activo: v } })}
                    etiqueta="Dejar la puerta abierta"
                  />
                </div>

                {cfg.canal.activo && !cfg.canal.token.trim() && (
                  <Aviso tono="bad">
                    Falta el token. Sin él la puerta no se abre, por mucho que esté encendida.
                  </Aviso>
                )}
              </Bloque>
            </>
          )}

          {pestana === 'kiosco' && (
            <>
              <Bloque titulo="Control de acceso">
                <Nota>
                  La tablet está en modo kiosco: los botones del sistema (atrás, inicio, recientes)
                  están bloqueados. Para salir o reiniciar la app hay que introducir la contraseña.
                </Nota>

                <div className="flex flex-col gap-3">
                  <Campo
                    etiqueta="Contraseña maestra"
                    ayuda="Introduce la contraseña y pulsa Desbloquear."
                  >
                    <input
                      ref={claveRef}
                      id="kiosco-clave"
                      type="password"
                      value={clave}
                      placeholder="••••••••"
                      autoComplete="off"
                      onChange={(e) => { setClave(e.target.value); setClaveError(false); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') validarClave(); }}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: claveError ? '2px solid var(--ion-color-danger)' : '1px solid var(--ion-color-medium)',
                        background: 'var(--ion-color-light)',
                        color: 'var(--ion-color-dark)',
                        fontSize: '16px',
                        outline: 'none',
                        transition: 'border-color 0.2s',
                      }}
                    />
                  </Campo>

                  {claveError && (
                    <Aviso tono="bad">Contraseña incorrecta. Inténtalo de nuevo.</Aviso>
                  )}

                  <Boton onClick={validarClave}>Desbloquear</Boton>
                </div>
              </Bloque>

              {menuKiosco && (
                <Modal alCerrar={() => setMenuKiosco(false)} titulo="Opciones de sistema">
                  <div className="flex flex-col gap-3 p-2">
                    <p style={{ margin: 0, color: 'var(--ion-color-medium)', fontSize: '13px' }}>
                      Kiosco desactivado temporalmente. Elige una acción.
                    </p>

                    <Boton
                      onClick={() => {
                        setMenuKiosco(false);
                        reiniciarApp().catch(() => undefined);
                      }}
                    >
                      Reiniciar aplicación
                    </Boton>

                    <Boton
                      onClick={() => {
                        setMenuKiosco(false);
                        cerrarApp().catch(() => undefined);
                      }}
                    >
                      Cerrar aplicación
                    </Boton>

                    <Boton
                      onClick={() => {
                        setMenuKiosco(false);
                        /* No llamamos a bloquear() aquí: el plugin se activa
                           solo al arrancar. El usuario puede cerrar este menú
                           y seguir navegando por Ajustes con normalidad. */
                      }}
                    >
                      Cancelar (volver a Ajustes)
                    </Boton>
                  </div>
                </Modal>
              )}
            </>
          )}

          {eco && (
            <p className="m-0 text-center font-mono text-[11.5px] text-acc" role="status">{eco}</p>
          )}
          </div>
        </div>

        {detalle && (
          <DetalleSenal
            clave={detalle}
            senal={vistas.get(detalle)}
            ajustes={ajustesDe(cfg.senales, detalle)}
            alCambiar={(a) => aplicar({ ...cfg, senales: { ...cfg.senales, [detalle]: a } })}
            alCerrar={() => setDetalle(null)}
          />
        )}
      </IonContent>
    </IonPage>
  );
}
