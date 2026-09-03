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
import { useEffect, useMemo, useState } from 'react';
import {
  IonBackButton, IonButtons, IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
} from '@ionic/react';

import { Config, Servidor, cargar, guardar, nuevaFuente } from '../nucleo/config';
import { Fuente, Hallazgo, PuertoDelEquipo, TramaVista, hardware, hayHardware } from '../nucleo/hardware';
import { CampoProtocolo, SenalManual, defectosDe, protocolo, protocolosDe } from '../nucleo/protocolos';
import { TIPOS_LECTURA } from '../nucleo/lecturas';
import { hayBase, podar, resumen, vaciar } from '../nucleo/base';
import { registro } from '../nucleo/registro';
import { maqueta } from '../nucleo/maqueta';
import { Descargado, descargar, entrar, guardado } from '../nucleo/servidor';
import { guardarPlano } from '../nucleo/plano';
import { Tarjeta, VISTAS, VistaTarjeta, nuevaTarjeta, panelDeCamion, vista } from '../nucleo/panel';
import {
  Descarga, VersionInstalada, actualizador, arreglarDireccion, esMasNueva, hayActualizador, reparo,
} from '../nucleo/actualizacion';
import {
  Aviso, Bloque, Boton, Campo, Entrada, Interruptor, Nota, Pestanas, Selector, Vacio,
} from './piezas';

type Pestana = 'fuentes' | 'panel' | 'posicion' | 'datos' | 'servidor';

const PESTANAS: { id: Pestana; nombre: string }[] = [
  { id: 'fuentes', nombre: 'Fuentes' },
  { id: 'panel', nombre: 'Panel' },
  { id: 'posicion', nombre: 'Posición' },
  { id: 'datos', nombre: 'Datos' },
  { id: 'servidor', nombre: 'Servidor' },
];

const PUERTOS: { id: Fuente['puerto']; nombre: string }[] = [
  { id: 'rs485', nombre: 'RS485 (serie)' },
  { id: 'can1', nombre: 'Bus CAN 1' },
  { id: 'can2', nombre: 'Bus CAN 2' },
];

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

export default function Ajustes() {
  const [cfg, setCfg] = useState<Config>({ ...cargar() });
  const [pestana, setPestana] = useState<Pestana>('fuentes');
  const [avanzado, setAvanzado] = useState(false);
  const [vistas, setVistas] = useState<Map<string, { nombre: string; unidad: string }>>(() => {
    const m = new Map<string, { nombre: string; unidad: string }>();
    for (const s of hardware.senales()) m.set(s.clave, { nombre: s.nombre, unidad: s.unidad });
    return m;
  });
  const [eco, setEco] = useState<string | null>(null);
  const [peso, setPeso] = useState<{ filas: number; desde: number | null } | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [probando, setProbando] = useState<{ port: string; baudrate: number } | null>(null);
  const [hallazgos, setHallazgos] = useState<Hallazgo[] | null>(null);
  const [puertos, setPuertos] = useState<PuertoDelEquipo[]>([]);

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

  const mirarPeso = async () => {
    try {
      setPeso(await resumen());
    } catch {
      setPeso(null);
    }
  };

  useEffect(() => {
    if (pestana === 'datos') mirarPeso();
  }, [pestana]);

  useEffect(() =>
    hardware.alRecibir((t: TramaVista) => {
      setVistas((prev) => {
        const m = new Map(prev);
        for (const s of t.senales) m.set(`${t.fuenteId}.${s.clave}`, { nombre: s.nombre, unidad: s.unidad });
        return m;
      });
    }), []);

  const aplicar = (c: Config) => {
    setCfg(c);
    guardar(c);
    registro.aplicar(c.registro);
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

  /**
   * Pone o quita una señal de una tarjeta.
   *
   * Cuando la tarjeta ya esta llena se sustituye la mas antigua en vez de no
   * hacer nada: pulsar y que no pase nada parece que la pantalla se colgo.
   */
  const elegirSenal = (t: Tarjeta, clave: string) => {
    const cabe = vista(t.vista).senales;
    if (t.claves.includes(clave)) {
      cambiarTarjeta(t.id, { claves: t.claves.filter((c) => c !== clave) });
      return;
    }
    const claves = [...t.claves, clave];
    cambiarTarjeta(t.id, { claves: claves.slice(-cabe) });
  };
  const disponibles = useMemo(() => [...vistas.entries()], [vistas]);

  return (
    <IonPage>
      <IonHeader className="ion-no-border">
        <IonToolbar style={{ '--background': 'var(--sur)', '--border-width': '0' } as never}>
          <IonButtons slot="start"><IonBackButton defaultHref="/" text="" /></IonButtons>
          <IonTitle className="font-titulo text-[16px] font-bold">Configuración</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent scrollY={false} style={{ '--background': 'var(--bg)' } as never}>
        <div className="flex h-full">
          <Pestanas opciones={PESTANAS} puesta={pestana} alElegir={setPestana} />

          {/* El contenido se para en 900 px: una línea de texto de 1100 px de
              ancho no se lee, se recorre. */}
          <div className="flex min-w-0 flex-1 flex-col gap-4 p-5 pb-12" style={{ maxWidth: 900 }}>

          {!hayHardware() && (
            <Aviso>
              Estás fuera del equipo: se puede configurar todo, pero los puertos no existen aquí
              y no llegará ninguna lectura.
            </Aviso>
          )}

          {/* ── Fuentes ────────────────────────────────────────────────── */}
          {pestana === 'fuentes' && (
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
                </div>
              }
            >
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
                            const nuevo = protocolosDe(puerto === 'rs485' ? 'serie' : 'can')[0];
                            cambiarFuente(i, { ...f, puerto, protocoloId: nuevo.id, config: defectosDe(nuevo) });
                          }}
                        >
                          {PUERTOS.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                        </Selector>
                      </Campo>

                      {esSerie ? (
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
                          {protocolosDe(esSerie ? 'serie' : 'can').map((p) => (
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

          {/* ── Panel ──────────────────────────────────────────────────── */}
          {pestana === 'panel' && (
            <Bloque titulo="Qué se ve en la pantalla principal">
              <Nota>
                El panel se arma con tarjetas. Cada una toma las señales que se le digan y las
                presenta de una forma: un número suelto, la resta de dos caudalímetros, un nivel
                con su barra. Sin ninguna tarjeta se enseña todo lo que llegue.
              </Nota>

              {disponibles.length === 0 && (
                <Vacio>
                  Todavía no ha llegado ninguna señal. Se pueden crear tarjetas igual, pero hasta
                  que el equipo lea algo no hay nada que elegirles.
                </Vacio>
              )}

              {cfg.panel.map((t, i) => {
                const forma = vista(t.vista);
                const completa = t.claves.length >= forma.senales;

                return (
                  <div key={t.id} className="rounded-xl border border-line bg-bg px-3.5 py-3">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="rotulo flex-1">
                        Tarjeta {i + 1} · {forma.nombre}
                        {!completa && <em className="ml-2 not-italic text-warn">le faltan señales</em>}
                      </span>
                      <Boton variante="tenue" onClick={() => mover(i, -1)} disabled={i === 0}>↑</Boton>
                      <Boton variante="tenue" onClick={() => mover(i, 1)} disabled={i === cfg.panel.length - 1}>↓</Boton>
                      <Boton variante="peligro" onClick={() => cambiarPanel(cfg.panel.filter((x) => x.id !== t.id))}>
                        Quitar
                      </Boton>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <Campo etiqueta="Nombre">
                        <Entrada
                          value={t.titulo}
                          placeholder="el de la señal"
                          onChange={(e) => cambiarTarjeta(t.id, { titulo: e.target.value })}
                        />
                      </Campo>

                      <Campo etiqueta="Cómo se ve">
                        <Selector
                          value={t.vista}
                          onChange={(e) => {
                            const v = e.target.value as VistaTarjeta;
                            /* Al pasar a una forma que toma menos señales se recortan las
                               que sobran, para no dejar una resta con tres sumandos. */
                            cambiarTarjeta(t.id, { vista: v, claves: t.claves.slice(0, vista(v).senales) });
                          }}
                        >
                          {VISTAS.map((v) => (
                            <option key={v.id} value={v.id}>{v.nombre}</option>
                          ))}
                        </Selector>
                      </Campo>
                    </div>

                    <p className="mb-2 mt-2 text-[11.5px] leading-relaxed text-ink3">{forma.ayuda}</p>

                    <p className="rotulo mb-1.5">
                      {forma.senales === 1 ? 'Señal' : 'Señales, en orden: la primera y la segunda'}
                    </p>

                    {disponibles.length === 0 ? (
                      <p className="m-0 text-[11.5px] text-ink3">Nada ha llegado todavía.</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {disponibles.map(([clave, s]) => {
                          const puesto = t.claves.indexOf(clave);
                          return (
                            <button
                              key={clave}
                              onClick={() => elegirSenal(t, clave)}
                              className={`rounded-full border px-3 py-1.5 text-[12px] transition ${
                                puesto >= 0 ? 'border-acc bg-acc/10 text-acc' : 'border-line2 text-ink2'
                              }`}
                            >
                              {forma.senales > 1 && puesto >= 0 && (
                                <b className="mr-1.5 font-mono">{puesto + 1}</b>
                              )}
                              {s.nombre}
                              {s.unidad && (
                                <em className="ml-1.5 font-mono text-[10.5px] not-italic opacity-60">{s.unidad}</em>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <div className="mt-3 grid grid-cols-2 gap-3">
                      {forma.usa.includes('unidad') && (
                        <Campo etiqueta="Unidad">
                          <Entrada
                            value={t.unidad}
                            placeholder="la de la señal"
                            onChange={(e) => cambiarTarjeta(t.id, { unidad: e.target.value })}
                          />
                        </Campo>
                      )}

                      {forma.usa.includes('decimales') && (
                        <Campo etiqueta="Decimales">
                          <Entrada
                            type="number" min={0} max={4} value={t.decimales}
                            onChange={(e) => cambiarTarjeta(t.id, { decimales: Number(e.target.value) })}
                          />
                        </Campo>
                      )}

                      {forma.usa.includes('rango') && (
                        <>
                          <Campo etiqueta="Mínimo de la barra">
                            <Entrada
                              type="number" value={t.min}
                              onChange={(e) => cambiarTarjeta(t.id, { min: Number(e.target.value) })}
                            />
                          </Campo>
                          <Campo etiqueta="Máximo de la barra">
                            <Entrada
                              type="number" value={t.max}
                              onChange={(e) => cambiarTarjeta(t.id, { max: Number(e.target.value) })}
                            />
                          </Campo>
                        </>
                      )}

                      {forma.usa.includes('umbrales') && (
                        <>
                          <Campo etiqueta="Avisa por debajo de">
                            <Entrada
                              type="number" value={t.bajo ?? ''} placeholder="sin límite"
                              onChange={(e) =>
                                cambiarTarjeta(t.id, { bajo: e.target.value === '' ? null : Number(e.target.value) })
                              }
                            />
                          </Campo>
                          <Campo etiqueta="Avisa por encima de">
                            <Entrada
                              type="number" value={t.alto ?? ''} placeholder="sin límite"
                              onChange={(e) =>
                                cambiarTarjeta(t.id, { alto: e.target.value === '' ? null : Number(e.target.value) })
                              }
                            />
                          </Campo>
                        </>
                      )}
                    </div>

                    <div className="mt-3">
                      <Interruptor
                        activo={t.grande}
                        alCambiar={(v) => cambiarTarjeta(t.id, { grande: v })}
                        etiqueta="Ocupa el ancho entero"
                      />
                    </div>
                  </div>
                );
              })}

              <div className="flex flex-wrap gap-2">
                {VISTAS.map((v) => (
                  <Boton key={v.id} onClick={() => cambiarPanel([...cfg.panel, nuevaTarjeta(v.id)])}>
                    + {v.nombre}
                  </Boton>
                ))}
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

                <Campo etiqueta="Dirección del APK">
                  <Entrada
                    value={cfg.actualizacion.url}
                    placeholder="https://…/diplus.apk"
                    onChange={(e) => aplicar({ ...cfg, actualizacion: { url: e.target.value } })}
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
            </>
          )}

          {eco && (
            <p className="m-0 text-center font-mono text-[11.5px] text-acc" role="status">{eco}</p>
          )}
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
