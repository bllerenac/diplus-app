/**
 * Configuracion: de donde se lee, como se interpreta y que se enseña.
 *
 * Los formularios de cada protocolo **no estan escritos aqui**: se dibujan a
 * partir de los `campos` que declara el propio protocolo. Añadir un protocolo
 * nuevo no obliga a tocar esta pantalla.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  IonBackButton, IonButtons, IonContent, IonHeader, IonPage, IonTitle, IonToolbar,
} from '@ionic/react';
import './Ajustes.css';

import { Config, Servidor, cargar, guardar, nuevaFuente } from '../nucleo/config';
import { Fuente, TramaVista, hardware, hayHardware } from '../nucleo/hardware';
import {
  CampoProtocolo, PROTOCOLOS, SenalManual, defectosDe, protocolo, protocolosDe,
} from '../nucleo/protocolos';
import { TIPOS_LECTURA } from '../nucleo/lecturas';

const PUERTOS: { id: Fuente['puerto']; nombre: string }[] = [
  { id: 'rs485', nombre: 'RS485 (serie)' },
  { id: 'can1', nombre: 'Bus CAN 1' },
  { id: 'can2', nombre: 'Bus CAN 2' },
];

const BAUDIOS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
const BITRATES = [125000, 250000, 500000, 1000000];

/* ── Piezas ───────────────────────────────────────────────────────────────── */

const Bloque = ({ titulo, accion, children }: any) => (
  <section className="aj-bloque">
    <header className="aj-bloque__cab">
      <span className="aj-rotulo">{titulo}</span>
      {accion}
    </header>
    <div className="aj-bloque__cuerpo">{children}</div>
  </section>
);

const Campo = ({ etiqueta, ayuda, children }: any) => (
  <label className="aj-campo">
    <span className="aj-campo__et">{etiqueta}</span>
    {children}
    {ayuda && <span className="aj-campo__ayuda">{ayuda}</span>}
  </label>
);

/** Un campo dibujado a partir de lo que el protocolo declara necesitar. */
function CampoDeclarado({
  campo, valor, alCambiar,
}: {
  campo: CampoProtocolo;
  valor: any;
  alCambiar: (v: any) => void;
}) {
  if (campo.tipo === 'seleccion') {
    return (
      <Campo etiqueta={campo.etiqueta} ayuda={campo.ayuda}>
        <select className="aj-entrada" value={valor ?? ''} onChange={(e) => alCambiar(e.target.value)}>
          {(campo.opciones ?? []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      </Campo>
    );
  }

  return (
    <Campo etiqueta={campo.etiqueta} ayuda={campo.ayuda}>
      <input
        className="aj-entrada"
        type={campo.tipo === 'numero' ? 'number' : 'text'}
        min={campo.min}
        max={campo.max}
        value={valor ?? ''}
        onChange={(e) => alCambiar(e.target.value)}
      />
    </Campo>
  );
}

/** Editor de señales a mano: byte, tamaño, escala y unidad. */
function EditorSenales({ lista, alCambiar }: { lista: SenalManual[]; alCambiar: (l: SenalManual[]) => void }) {
  const cambiar = (i: number, k: keyof SenalManual, v: any) =>
    alCambiar(lista.map((s, j) => (j === i ? { ...s, [k]: v } : s)));

  return (
    <div className="aj-senales">
      {lista.map((s, i) => (
        <div className="aj-senal" key={i}>
          <div className="aj-rejilla">
            <Campo etiqueta="Clave">
              <input className="aj-entrada" value={s.clave ?? ''} placeholder="presion"
                onChange={(e) => cambiar(i, 'clave', e.target.value)} />
            </Campo>
            <Campo etiqueta="Nombre">
              <input className="aj-entrada" value={s.nombre ?? ''} placeholder="Presión"
                onChange={(e) => cambiar(i, 'nombre', e.target.value)} />
            </Campo>
            <Campo etiqueta="Unidad">
              <input className="aj-entrada" value={s.unidad ?? ''} placeholder="bar"
                onChange={(e) => cambiar(i, 'unidad', e.target.value)} />
            </Campo>
            <Campo etiqueta="PGN" ayuda="Vacío = cualquiera">
              <input className="aj-entrada" value={s.pgn ?? ''} placeholder="65262"
                onChange={(e) => cambiar(i, 'pgn', e.target.value)} />
            </Campo>
            <Campo etiqueta="Byte">
              <input className="aj-entrada" type="number" min={0} value={s.desde ?? 0}
                onChange={(e) => cambiar(i, 'desde', Number(e.target.value))} />
            </Campo>
            <Campo etiqueta="Tamaño">
              <select className="aj-entrada" value={s.tipo ?? 'u16le'}
                onChange={(e) => cambiar(i, 'tipo', e.target.value)}>
                {TIPOS_LECTURA.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Campo>
            <Campo etiqueta="Escala">
              <input className="aj-entrada" value={s.escala ?? 1}
                onChange={(e) => cambiar(i, 'escala', e.target.value)} />
            </Campo>
            <Campo etiqueta="Desplazamiento">
              <input className="aj-entrada" value={s.desplazamiento ?? 0}
                onChange={(e) => cambiar(i, 'desplazamiento', e.target.value)} />
            </Campo>
          </div>
          <div className="aj-senal__pie">
            <span className="aj-nota">valor = (crudo × {s.escala ?? 1}) + {s.desplazamiento ?? 0}</span>
            <button className="aj-btn aj-btn--peligro" onClick={() => alCambiar(lista.filter((_, j) => j !== i))}>
              Quitar
            </button>
          </div>
        </div>
      ))}
      <button
        className="aj-btn"
        onClick={() => alCambiar([...lista, {
          clave: '', nombre: '', unidad: '', desde: 0, tipo: 'u16le', escala: 1, desplazamiento: 0,
        }])}
      >
        Añadir señal
      </button>
    </div>
  );
}

/* ── Pantalla ─────────────────────────────────────────────────────────────── */

export default function Ajustes() {
  const [cfg, setCfg] = useState<Config>({ ...cargar() });
  const [avanzado, setAvanzado] = useState(false);
  const [vistas, setVistas] = useState<Map<string, { nombre: string; unidad: string }>>(new Map());
  const [eco, setEco] = useState<string | null>(null);

  /* Lo que esta llegando ahora, para poder elegirlo sin escribir claves a mano. */
  useEffect(() => {
    for (const s of hardware.senales()) {
      vistas.set(s.clave, { nombre: s.nombre, unidad: s.unidad });
    }
    return hardware.alRecibir((t: TramaVista) => {
      setVistas((prev) => {
        const m = new Map(prev);
        for (const s of t.senales) m.set(`${t.fuenteId}.${s.clave}`, { nombre: s.nombre, unidad: s.unidad });
        return m;
      });
    });
  }, []);

  const aplicar = (c: Config) => {
    setCfg(c);
    guardar(c);
    setEco(`Guardado a las ${new Date().toLocaleTimeString('es-PE')}`);
    setTimeout(() => setEco(null), 3000);
  };

  const cambiarFuente = (i: number, f: Fuente) => {
    const fuentes = cfg.fuentes.map((x, j) => (j === i ? f : x));
    aplicar({ ...cfg, fuentes });
    hardware.arrancar(f).catch(() => undefined);
  };

  const cambiarServidor = (s: Partial<Servidor>) =>
    aplicar({ ...cfg, servidor: { ...cfg.servidor, ...s } });

  const disponibles = useMemo(() => [...vistas.entries()], [vistas]);

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar className="aj-toolbar">
          <IonButtons slot="start"><IonBackButton defaultHref="/" text="" /></IonButtons>
          <IonTitle>Configuración</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="aj-contenido">
        {!hayHardware() && (
          <p className="aj-aviso">
            Estás fuera del equipo: se puede configurar todo, pero los puertos no existen
            aquí y no llegará ninguna lectura.
          </p>
        )}

        {/* ── Fuentes ──────────────────────────────────────────────────── */}
        <Bloque
          titulo="De dónde se lee"
          accion={
            <div className="aj-acciones">
              <button className="aj-btn" onClick={() => aplicar({ ...cfg, fuentes: [...cfg.fuentes, nuevaFuente('rs485')] })}>
                + RS485
              </button>
              <button className="aj-btn" onClick={() => aplicar({ ...cfg, fuentes: [...cfg.fuentes, nuevaFuente('can1')] })}>
                + CAN
              </button>
            </div>
          }
        >
          {cfg.fuentes.length === 0 && (
            <p className="aj-vacio">
              Todavía no hay ninguna fuente. Añade el RS485 por donde llega el HelperBox,
              o el bus CAN si lees los sensores directamente.
            </p>
          )}

          {cfg.fuentes.map((f, i) => {
            const proto = protocolo(f.protocoloId);
            const esSerie = f.puerto === 'rs485';

            return (
              <div className="aj-fuente" key={f.id}>
                <div className="aj-rejilla">
                  <Campo etiqueta="Nombre">
                    <input className="aj-entrada" value={f.nombre}
                      onChange={(e) => cambiarFuente(i, { ...f, nombre: e.target.value })} />
                  </Campo>
                  <Campo etiqueta="Puerto">
                    <select className="aj-entrada" value={f.puerto}
                      onChange={(e) => {
                        const puerto = e.target.value as Fuente['puerto'];
                        const lista = protocolosDe(puerto === 'rs485' ? 'serie' : 'can');
                        const nuevo = lista[0];
                        cambiarFuente(i, { ...f, puerto, protocoloId: nuevo.id, config: defectosDe(nuevo) });
                      }}>
                      {PUERTOS.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  </Campo>

                  {esSerie ? (
                    <>
                      <Campo etiqueta="Dispositivo">
                        <input className="aj-entrada" value={f.ruta}
                          onChange={(e) => cambiarFuente(i, { ...f, ruta: e.target.value })} />
                      </Campo>
                      <Campo etiqueta="Baudios">
                        <select className="aj-entrada" value={f.baudios}
                          onChange={(e) => cambiarFuente(i, { ...f, baudios: Number(e.target.value) })}>
                          {BAUDIOS.map((b) => <option key={b} value={b}>{b}</option>)}
                        </select>
                      </Campo>
                    </>
                  ) : (
                    <Campo etiqueta="Bitrate del bus">
                      <select className="aj-entrada" value={f.bitrate}
                        onChange={(e) => cambiarFuente(i, { ...f, bitrate: Number(e.target.value) })}>
                        {BITRATES.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </Campo>
                  )}

                  <Campo etiqueta="Qué habla por ahí">
                    <select className="aj-entrada" value={f.protocoloId}
                      onChange={(e) => {
                        const p = protocolo(e.target.value);
                        cambiarFuente(i, { ...f, protocoloId: p.id, config: defectosDe(p) });
                      }}>
                      {protocolosDe(esSerie ? 'serie' : 'can').map((p) => (
                        <option key={p.id} value={p.id}>{p.nombre}</option>
                      ))}
                    </select>
                  </Campo>
                </div>

                <p className="aj-nota">{proto.descripcion}</p>

                {/* Los campos del protocolo, dibujados desde su definición. */}
                <div className="aj-rejilla">
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
                  <div key={c.clave}>
                    <span className="aj-rotulo">{c.etiqueta}</span>
                    <p className="aj-nota">{c.ayuda}</p>
                    <EditorSenales
                      lista={(f.config[c.clave] as SenalManual[]) ?? []}
                      alCambiar={(l) => cambiarFuente(i, { ...f, config: { ...f.config, [c.clave]: l } })}
                    />
                  </div>
                ))}

                <div className="aj-fuente__pie">
                  <label className="aj-check">
                    <input type="checkbox" checked={f.activa}
                      onChange={(e) => cambiarFuente(i, { ...f, activa: e.target.checked })} />
                    Leer de esta fuente
                  </label>
                  <button
                    className="aj-btn aj-btn--peligro"
                    onClick={() => {
                      hardware.quitar(f.id);
                      aplicar({ ...cfg, fuentes: cfg.fuentes.filter((_, j) => j !== i) });
                    }}
                  >
                    Quitar fuente
                  </button>
                </div>
              </div>
            );
          })}

          {PROTOCOLOS.some((p) => p.campos.some((c) => c.avanzado)) && (
            <label className="aj-check">
              <input type="checkbox" checked={avanzado} onChange={(e) => setAvanzado(e.target.checked)} />
              Mostrar los valores del manual del fabricante
            </label>
          )}
        </Bloque>

        {/* ── Panel ────────────────────────────────────────────────────── */}
        <Bloque titulo="Qué se ve en la pantalla principal">
          <p className="aj-nota">
            Se pulsan las señales que van al panel de la derecha, en el orden en que se pulsan.
            Sin elegir ninguna se enseña todo lo que llegue.
          </p>

          {disponibles.length === 0 ? (
            <p className="aj-vacio">
              Todavía no ha llegado ninguna señal. En cuanto el equipo lea algo, aparece aquí
              para poder elegirla.
            </p>
          ) : (
            <div className="aj-fichas">
              {disponibles.map(([clave, s]) => {
                const puesta = cfg.panel.includes(clave);
                return (
                  <button
                    key={clave}
                    className={`aj-ficha ${puesta ? 'puesta' : ''}`}
                    onClick={() =>
                      aplicar({
                        ...cfg,
                        panel: puesta ? cfg.panel.filter((c) => c !== clave) : [...cfg.panel, clave],
                      })
                    }
                  >
                    {s.nombre}
                    {s.unidad && <em>{s.unidad}</em>}
                  </button>
                );
              })}
            </div>
          )}
        </Bloque>

        {/* ── GPS ──────────────────────────────────────────────────────── */}
        <Bloque titulo="GPS y RTK">
          <div className="aj-rejilla">
            <Campo etiqueta="Dispositivo del GPS">
              <input className="aj-entrada" value={cfg.gps.ruta}
                onChange={(e) => aplicar({ ...cfg, gps: { ...cfg.gps, ruta: e.target.value } })} />
            </Campo>
          </div>
          <label className="aj-check">
            <input type="checkbox" checked={cfg.gps.activo}
              onChange={(e) => aplicar({ ...cfg, gps: { ...cfg.gps, activo: e.target.checked } })} />
            Leer la posición
          </label>
          <p className="aj-nota">
            La calidad sale de la sentencia GGA del propio receptor. <b>RTK fijo</b> son unos
            2 cm; <b>GPS autónomo</b>, varios metros. La pantalla principal lo enseña siempre,
            porque no es lo mismo y de lejos se confunde.
          </p>
        </Bloque>

        {/* ── Servidor ─────────────────────────────────────────────────── */}
        <Bloque titulo="Servidor">
          <p className="aj-nota">
            Para mandar lo leído y traer lo que haga falta. Si el equipo se queda sin red,
            sigue leyendo y midiendo igual: esto no es imprescindible para trabajar.
          </p>

          <div className="aj-rejilla">
            <Campo etiqueta="Dirección" ayuda="Por ejemplo https://marcobre-back.diplus.io/api">
              <input className="aj-entrada" value={cfg.servidor.url} placeholder="https://…"
                onChange={(e) => cambiarServidor({ url: e.target.value })} />
            </Campo>
            <Campo etiqueta="Nombre de este equipo" ayuda="Con qué nombre aparece allá.">
              <input className="aj-entrada" value={cfg.servidor.equipo} placeholder="CA-14"
                onChange={(e) => cambiarServidor({ equipo: e.target.value })} />
            </Campo>
            <Campo etiqueta="Token">
              <input className="aj-entrada" type="password" value={cfg.servidor.token}
                onChange={(e) => cambiarServidor({ token: e.target.value })} />
            </Campo>
            <Campo etiqueta="Mandar cada (s)">
              <input className="aj-entrada" type="number" min={5} value={cfg.servidor.cadaSeg}
                onChange={(e) => cambiarServidor({ cadaSeg: Number(e.target.value) })} />
            </Campo>
          </div>

          <label className="aj-check">
            <input type="checkbox" checked={cfg.servidor.activo}
              onChange={(e) => cambiarServidor({ activo: e.target.checked })} />
            Hablar con el servidor
          </label>
        </Bloque>

        {eco && <p className="aj-eco">{eco}</p>}
      </IonContent>
    </IonPage>
  );
}
