/**
 * Pestaña Bluetooth: buscar equipos, ver lo que anuncian, conectarse y
 * escuchar sus características. Es para reconocer qué manda el beacon antes
 * de decidir cómo se lee.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Anuncio, Caracteristica, Dato, Emparejado, EstadoBt, Servicio, ascii, bluetooth, esMac, hayBluetooth,
  leerIBeacon, nombreFabricante, nombreUuid, uuidCorto,
} from '../nucleo/bluetooth';
import { Aviso, Bloque, Boton, Campo, Entrada, Interruptor, Modal, Nota, Selector, Vacio } from './piezas';

const DURACIONES = [
  { s: 10, nombre: '10 segundos' },
  { s: 30, nombre: '30 segundos' },
  { s: 0, nombre: 'Sin parar' },
];
const MAX_DATOS = 150;
const NOMBRE_TIPO: Record<Emparejado['tipo'], string> = {
  clasico: 'clásico', le: 'baja energía', dual: 'clásico y baja energía', desconocido: 'tipo desconocido',
};

interface Visto extends Anuncio { paquetes: number }

const hora = (t: number) => new Date(t).toLocaleTimeString('es-PE', { hour12: false });
const error = (e: unknown) => String((e as Error)?.message ?? e);

export function Bluetooth() {
  const [estado, setEstado] = useState<EstadoBt | null>(null);
  const [eco, setEco] = useState<string | null>(null);
  const [duracion, setDuracion] = useState(10);
  const [filtro, setFiltro] = useState('');
  const [vistos, setVistos] = useState<Visto[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [conectando, setConectando] = useState<string | null>(null);
  const [conexion, setConexion] = useState<{ mac: string; servicios: Servicio[] } | null>(null);
  const [escuchando, setEscuchando] = useState<Set<string>>(new Set());
  const [datos, setDatos] = useState<Dato[]>([]);
  const [escribiendo, setEscribiendo] = useState<{ servicio: string; c: Caracteristica } | null>(null);
  const [emparejados, setEmparejados] = useState<Emparejado[]>([]);
  const [emparejando, setEmparejando] = useState<Anuncio | null>(null);
  const [serie, setSerie] = useState<string | null>(null);
  const [escribiendoSerie, setEscribiendoSerie] = useState(false);

  const pendientes = useRef(new Map<string, Visto>());

  const refrescar = () => {
    bluetooth.estado().then(setEstado).catch((e) => setEco(error(e)));
    bluetooth.emparejados().then(setEmparejados).catch(() => undefined);
  };

  useEffect(() => {
    if (!hayBluetooth()) return;
    refrescar();

    const quitar = [
      bluetooth.alAnuncio((a) => {
        const antes = pendientes.current.get(a.mac);
        pendientes.current.set(a.mac, { ...a, paquetes: (antes?.paquetes ?? 0) + 1 });
      }),
      bluetooth.alTerminarEscaneo(refrescar),
      bluetooth.alDato((d) => setDatos((l) => [d, ...l].slice(0, MAX_DATOS))),
      bluetooth.alEmparejar(refrescar),
      bluetooth.alConexion((c) => {
        if (c.estado === 'desconectado') {
          setConexion(null);
          setSerie(null);
          setEscuchando(new Set());
          setEco(`Se desconectó ${c.mac} (código ${c.codigo}).`);
        }
        refrescar();
      }),
    ];

    /* Los anuncios llegan a decenas por segundo: se pintan dos veces por segundo. */
    const t = setInterval(() => {
      if (!pendientes.current.size) return;
      setVistos([...pendientes.current.values()]);
    }, 500);

    return () => {
      clearInterval(t);
      quitar.forEach((q) => q());
      bluetooth.detener().catch(() => undefined);
    };
  }, []);

  const lista = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return vistos
      .filter((v) => !f || v.mac.toLowerCase().includes(f) || (v.nombre ?? '').toLowerCase().includes(f))
      .sort((a, b) => b.rssi - a.rssi);
  }, [vistos, filtro]);

  if (!hayBluetooth()) {
    return <Vacio>El Bluetooth solo se puede usar en la tablet.</Vacio>;
  }

  const intentar = async (fn: () => Promise<unknown>) => {
    setEco(null);
    try {
      await fn();
    } catch (e) {
      setEco(error(e));
    }
    refrescar();
  };

  const buscar = () =>
    intentar(async () => {
      pendientes.current.clear();
      setVistos([]);
      await bluetooth.escanear(duracion, 200, esMac(filtro) ? [filtro.trim()] : undefined);
    });

  const conectar = async (mac: string) => {
    setConectando(mac);
    await intentar(async () => {
      const r = await bluetooth.conectar(mac);
      setConexion(r);
      setEscuchando(new Set());
    });
    setConectando(null);
  };

  const conectarSerie = async (mac: string) => {
    setConectando(mac);
    await intentar(async () => {
      await bluetooth.conectarSerie(mac);
      setSerie(mac);
    });
    setConectando(null);
  };

  const emparejar = (a: Anuncio, pin: string) =>
    intentar(async () => {
      setEmparejando(null);
      setConectando(a.mac);
      try {
        await bluetooth.emparejar(a.mac, pin.trim() || undefined);
        setEco(`Emparejado con ${a.nombre || a.mac}.`);
      } finally {
        setConectando(null);
      }
    });

  const ruta = (servicio: string, c: Caracteristica) => ({ servicio, caracteristica: c.uuid });

  const leer = (servicio: string, c: Caracteristica) =>
    intentar(async () => {
      const r = await bluetooth.leer(ruta(servicio, c));
      setDatos((l) => [
        { mac: conexion?.mac ?? '', servicio, caracteristica: c.uuid, hex: r.hex, at: Date.now() },
        ...l,
      ].slice(0, MAX_DATOS));
    });

  const alternarEscucha = (servicio: string, c: Caracteristica) =>
    intentar(async () => {
      const ya = escuchando.has(c.uuid);
      if (ya) await bluetooth.dejarDeEscuchar(ruta(servicio, c));
      else await bluetooth.escuchar(ruta(servicio, c));
      setEscuchando((s) => {
        const n = new Set(s);
        if (ya) n.delete(c.uuid);
        else n.add(c.uuid);
        return n;
      });
    });

  return (
    <>
      <Bloque titulo="Bluetooth del equipo">
        {estado && !estado.soportado && <Aviso tono="bad">Este equipo no tiene Bluetooth.</Aviso>}
        {estado?.soportado && (
          <p className="m-0 font-mono text-[12px] text-ink2">
            {estado.encendido ? 'Encendido' : 'Apagado'} · permiso {estado.permiso ? 'concedido' : 'pendiente'}
            {estado.conectado && ` · conectado a ${estado.conectado}`}
          </p>
        )}
        {estado?.soportado && !estado.ubicacionActiva && (
          <Aviso tono="warn">
            La ubicación del sistema está apagada. Hasta Android 11, sin ella la búsqueda no
            encuentra nada.
          </Aviso>
        )}
        <div className="flex flex-wrap gap-2">
          {estado?.soportado && !estado.permiso && (
            <Boton variante="fuerte" onClick={() => intentar(bluetooth.pedirPermisos)}>Dar permiso</Boton>
          )}
          {estado?.soportado && !estado.encendido && (
            <Boton variante="fuerte" onClick={() => intentar(bluetooth.encender)}>Encender Bluetooth</Boton>
          )}
        </div>
        {eco && <Aviso tono="warn">{eco}</Aviso>}
      </Bloque>

      <Bloque titulo="Emparejados">
        {emparejados.length === 0 ? (
          <Nota>Todavía no hay ninguno. Se empareja desde «Buscar equipos», abriendo el equipo.</Nota>
        ) : emparejados.map((e) => (
          <div key={e.mac} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-sur2 px-3.5 py-2.5">
            <span className="min-w-0 flex-1">
              <b className="block truncate text-[13px] text-ink">{e.nombre || '(sin nombre)'}</b>
              <span className="font-mono text-[11px] text-ink3">{e.mac} · {NOMBRE_TIPO[e.tipo]}</span>
            </span>
            {e.tipo !== 'clasico' && (
              <Boton disabled={conectando !== null} onClick={() => conectar(e.mac)}>
                {conectando === e.mac ? 'Conectando…' : 'Conectar'}
              </Boton>
            )}
            {e.tipo !== 'le' && (
              <Boton disabled={conectando !== null || serie === e.mac} onClick={() => conectarSerie(e.mac)}>
                {serie === e.mac ? 'Por serie' : 'Conectar por serie'}
              </Boton>
            )}
            <Boton variante="peligro" onClick={() => intentar(() => bluetooth.olvidar(e.mac))}>Olvidar</Boton>
          </div>
        ))}
      </Bloque>

      {serie && (
        <Bloque
          titulo={`Conectado por serie a ${serie}`}
          accion={<Boton variante="peligro" onClick={() => intentar(async () => {
            await bluetooth.desconectarSerie();
            setSerie(null);
          })}>Desconectar</Boton>}
        >
          <Nota>Todo lo que mande llega a «Datos recibidos».</Nota>
          <div>
            <Boton onClick={() => setEscribiendoSerie(true)}>Escribir</Boton>
          </div>
        </Bloque>
      )}

      <Bloque titulo="Buscar equipos">
        <Nota>
          Lista lo que anuncia cada equipo cercano. Los beacons con acelerómetro suelen mandar sus
          lecturas aquí, en los datos de fabricante o de servicio, sin necesidad de conectarse.
          Con una MAC completa en el filtro, la búsqueda sigue con la pantalla apagada.
        </Nota>
        <div className="grid grid-cols-[1fr_180px] gap-3">
          <Campo etiqueta="Filtrar por nombre o MAC">
            <Entrada value={filtro} placeholder="ej. af:20:24" onChange={(e) => setFiltro(e.target.value)} />
          </Campo>
          <Campo etiqueta="Durante">
            <Selector value={duracion} onChange={(e) => setDuracion(Number(e.target.value))}>
              {DURACIONES.map((d) => <option key={d.s} value={d.s}>{d.nombre}</option>)}
            </Selector>
          </Campo>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {estado?.escaneando ? (
            <Boton onClick={() => intentar(bluetooth.detener)}>Detener</Boton>
          ) : (
            <Boton variante="fuerte" disabled={!estado?.encendido || !estado?.permiso} onClick={buscar}>
              Buscar
            </Boton>
          )}
          <span className="font-mono text-[11px] text-ink3">
            {estado?.escaneando ? 'Buscando… ' : ''}{lista.length} equipo{lista.length === 1 ? '' : 's'}
          </span>
        </div>

        {lista.map((v) => (
          <article key={v.mac} className="rounded-xl border border-line bg-sur2">
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left"
              onClick={() => setAbierto(abierto === v.mac ? null : v.mac)}
            >
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[13px] text-ink">{v.nombre || '(sin nombre)'}</b>
                <span className="font-mono text-[11px] text-ink3">{v.mac}</span>
              </span>
              <span className="text-right font-mono text-[11px] text-ink2">
                {v.rssi} dBm
                <br />
                <span className="text-ink3">{v.paquetes} paq · {hora(v.at)}</span>
              </span>
            </button>

            {abierto === v.mac && (
              <DetalleAnuncio
                v={v}
                conectando={conectando}
                emparejado={emparejados.some((e) => e.mac === v.mac)}
                alConectar={conectar}
                alEmparejar={() => setEmparejando(v)}
              />
            )}
          </article>
        ))}
      </Bloque>

      {conexion && (
        <Bloque
          titulo={`Conectado a ${conexion.mac}`}
          accion={<Boton variante="peligro" onClick={() => intentar(async () => {
            await bluetooth.desconectar();
            setConexion(null);
          })}>Desconectar</Boton>}
        >
          {conexion.servicios.map((s) => (
            <div key={s.uuid} className="flex flex-col gap-1.5">
              <p className="rotulo m-0 text-[9.5px]">
                {nombreUuid(s.uuid) ?? 'Servicio'} · {uuidCorto(s.uuid)}
              </p>
              {s.caracteristicas.map((c) => (
                <div key={c.uuid} className="flex flex-wrap items-center gap-2 rounded-lg bg-sur2 px-3 py-2">
                  <span className="min-w-0 flex-1 font-mono text-[11.5px] text-ink2">
                    {nombreUuid(c.uuid) && <b className="mr-1.5 text-ink">{nombreUuid(c.uuid)}</b>}
                    {uuidCorto(c.uuid)}
                    <span className="ml-2 text-ink3">{c.propiedades.join(', ')}</span>
                  </span>
                  {c.propiedades.includes('leer') && <Boton onClick={() => leer(s.uuid, c)}>Leer</Boton>}
                  {(c.propiedades.includes('notificar') || c.propiedades.includes('indicar')) && (
                    <Boton variante={escuchando.has(c.uuid) ? 'fuerte' : 'normal'} onClick={() => alternarEscucha(s.uuid, c)}>
                      {escuchando.has(c.uuid) ? 'Escuchando' : 'Escuchar'}
                    </Boton>
                  )}
                  {(c.propiedades.includes('escribir') || c.propiedades.includes('escribirSinRespuesta')) && (
                    <Boton onClick={() => setEscribiendo({ servicio: s.uuid, c })}>Escribir</Boton>
                  )}
                </div>
              ))}
            </div>
          ))}
        </Bloque>
      )}

      <Bloque
        titulo="Datos recibidos"
        accion={datos.length > 0 && <Boton variante="tenue" onClick={() => setDatos([])}>Limpiar</Boton>}
      >
        {datos.length === 0 ? (
          <Nota>Lo que se lea o llegue por notificación aparece aquí, lo último arriba.</Nota>
        ) : (
          <div className="flex max-h-[320px] flex-col gap-1 overflow-y-auto font-mono text-[11px]">
            {datos.map((d, i) => (
              <div key={`${d.at}-${i}`} className="grid grid-cols-[64px_70px_1fr] gap-2 border-b border-line py-1">
                <span className="text-ink3">{hora(d.at)}</span>
                <span className="text-ink3">{uuidCorto(d.caracteristica).slice(0, 8)}</span>
                <span className="break-all text-ink">
                  {d.hex || '(vacío)'}
                  <span className="ml-2 text-ink3">{ascii(d.hex)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Bloque>

      {escribiendo && (
        <Escribir
          subtitulo={uuidCorto(escribiendo.c.uuid)}
          sinRespuestaInicial={!escribiendo.c.propiedades.includes('escribir')}
          alCerrar={() => setEscribiendo(null)}
          alEnviar={(hex, sinRespuesta) => intentar(async () => {
            await bluetooth.escribir(ruta(escribiendo.servicio, escribiendo.c), hex, sinRespuesta);
            setEscribiendo(null);
          })}
        />
      )}

      {escribiendoSerie && serie && (
        <Escribir
          subtitulo={`Por serie a ${serie}`}
          alCerrar={() => setEscribiendoSerie(false)}
          alEnviar={(hex) => intentar(async () => {
            await bluetooth.escribirSerie(hex);
            setEscribiendoSerie(false);
          })}
        />
      )}

      {emparejando && (
        <Emparejar a={emparejando} alCerrar={() => setEmparejando(null)} alAceptar={(pin) => emparejar(emparejando, pin)} />
      )}
    </>
  );
}

function DetalleAnuncio({ v, conectando, emparejado, alConectar, alEmparejar }: {
  v: Visto; conectando: string | null; emparejado: boolean;
  alConectar: (mac: string) => void; alEmparejar: () => void;
}) {
  const fila = (k: string, valor: string) => (
    <div key={k} className="grid grid-cols-[130px_1fr] gap-2">
      <span className="text-ink3">{k}</span>
      <span className="break-all text-ink">{valor}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-1.5 border-t border-line px-3.5 py-3 font-mono text-[11px]">
      {Object.entries(v.fabricante).map(([id, hex]) => {
        const ib = id === '004c' ? leerIBeacon(hex) : null;
        return (
          <div key={id} className="flex flex-col gap-1.5">
            {fila(`Fabricante ${id}`, `${hex}${nombreFabricante(id) ? `  (${nombreFabricante(id)})` : ''}`)}
            {ib && fila('iBeacon', `${ib.uuid} · major ${ib.major} · minor ${ib.minor} · tx ${ib.tx} dBm`)}
          </div>
        );
      })}
      {Object.entries(v.datosServicio).map(([u, hex]) => fila(`Servicio ${uuidCorto(u)}`, hex))}
      {v.servicios.length > 0 && fila('Servicios', v.servicios.map(uuidCorto).join(', '))}
      {v.tx !== undefined && v.tx > -128 && fila('Potencia', `${v.tx} dBm`)}
      {v.crudo && fila('Anuncio crudo', v.crudo)}
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {v.conectable === false ? (
          <span className="text-ink3">Solo anuncia: no acepta conexiones.</span>
        ) : (
          <>
            <Boton variante="fuerte" disabled={conectando !== null} onClick={() => alConectar(v.mac)}>
              {conectando === v.mac ? 'Conectando…' : 'Conectar'}
            </Boton>
            {emparejado ? (
              <span className="text-ink3">Ya está emparejado.</span>
            ) : (
              <Boton disabled={conectando !== null} onClick={alEmparejar}>Emparejar</Boton>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Emparejar({ a, alCerrar, alAceptar }: { a: Anuncio; alCerrar: () => void; alAceptar: (pin: string) => void }) {
  const [pin, setPin] = useState('');
  return (
    <Modal
      titulo={`Emparejar ${a.nombre || ''}`.trim()}
      subtitulo={a.mac}
      alCerrar={alCerrar}
      pie={<Boton variante="fuerte" onClick={() => alAceptar(pin)}>Emparejar</Boton>}
    >
      <Campo
        etiqueta="PIN (si lo pide)"
        ayuda="Suele ser 0000 o 1234. Con el PIN aquí no sale el diálogo de Android, que con el kiosco puesto puede no verse."
      >
        <Entrada value={pin} autoFocus inputMode="numeric" onChange={(e) => setPin(e.target.value)} placeholder="vacío si no pide" />
      </Campo>
    </Modal>
  );
}

function Escribir({ subtitulo, sinRespuestaInicial, alCerrar, alEnviar }: {
  subtitulo: string;
  /** Sin esto no se ofrece elegir: la serie no espera respuesta. */
  sinRespuestaInicial?: boolean;
  alCerrar: () => void;
  alEnviar: (hex: string, sinRespuesta: boolean) => void;
}) {
  const [hex, setHex] = useState('');
  const [sinRespuesta, setSinRespuesta] = useState(sinRespuestaInicial ?? true);
  const limpio = hex.replace(/[^0-9a-f]/gi, '');
  const valido = limpio.length > 0 && limpio.length % 2 === 0;

  return (
    <Modal
      titulo="Escribir"
      subtitulo={subtitulo}
      alCerrar={alCerrar}
      pie={<Boton variante="fuerte" disabled={!valido} onClick={() => alEnviar(limpio, sinRespuesta)}>Enviar</Boton>}
    >
      <Campo etiqueta="Valor en hexadecimal" ayuda="Pares de cifras, con o sin espacios: 01 a0 ff">
        <Entrada value={hex} autoFocus onChange={(e) => setHex(e.target.value)} placeholder="01 a0 ff" />
      </Campo>
      {sinRespuestaInicial !== undefined && (
        <Interruptor activo={sinRespuesta} alCambiar={setSinRespuesta} etiqueta="Sin esperar respuesta" />
      )}
    </Modal>
  );
}
