/**
 * A dónde sale lo que el equipo mide.
 *
 * Están juntos los tres caminos porque la pregunta es la misma —«¿esto sale del
 * camión?»— pero separados en bloques porque las respuestas no se parecen:
 * MQTT es para tiempo real con el payload de Miskimayo; el socket es para mirar
 * en directo; la API es para no perder nada. Ver `nucleo/envio.ts` para el
 * porqué de esa diferencia.
 *
 * Lo que **no** se decide aquí es qué señales salen. Eso va señal por señal, en
 * su detalle, junto a su nombre y su curva, porque es una propiedad de la señal
 * y no del cable por el que se manda: la misma señal puede irse hoy por socket
 * y mañana por API sin dejar de ser la misma. Aquí solo se enseña la lista
 * resultante, para poder comprobarla de un vistazo antes de encender nada.
 */
import { useEffect, useState } from 'react';
import { Senal } from '../nucleo/lecturas';
import {
  AjustesEnvio,
  EstadoCanal,
  Formato,
  LogEnvio,
  alLogsEnvio,
  envio,
  limpiarLogsEnvio,
  obtenerLogsEnvio,
} from '../nucleo/envio';
import { hayMqtt } from '../nucleo/mqtt';
import { hardware } from '../nucleo/hardware';
import { cuantosSnapshotsPendientes } from '../nucleo/base';
import { Aviso, Bloque, Boton, Campo, Entrada, Interruptor, Nota, Selector, Vacio } from './piezas';

const DICHO: Record<EstadoCanal['estado'], string> = {
  parado: 'Apagado',
  conectando: 'Conectando…',
  abierto: 'Conectado',
  fallo: 'Sin conexión',
};

const COLOR: Record<EstadoCanal['estado'], string> = {
  parado: 'text-ink3',
  conectando: 'text-warn',
  abierto: 'text-acc',
  fallo: 'text-bad',
};

const hora = (t: number | null) =>
  t === null ? 'nunca' : new Date(t).toLocaleTimeString('es-PE');

/** El semáforo de un canal: cómo está, cuánto lleva mandado y desde cuándo. */
const Marcador = ({ e, unidad }: { e: EstadoCanal; unidad: string }) => (
  <div className="flex flex-wrap items-baseline gap-5 rounded-xl border border-line bg-sur2 px-3.5 py-2.5">
    <span className={`text-[13px] font-semibold ${COLOR[e.estado]}`}>{DICHO[e.estado]}</span>
    <span className="font-mono text-[11px] text-ink3">
      {e.enviados} {unidad}
    </span>
    <span className="font-mono text-[11px] text-ink3">último: {hora(e.ultimo)}</span>
    {e.error && <span className="font-mono text-[11px] text-bad">{e.error}</span>}
  </div>
);

export function Envio({
  ajustes, alCambiar, salen, alDetalle,
}: {
  ajustes: AjustesEnvio;
  alCambiar: (a: AjustesEnvio) => void;
  /** Las señales marcadas para salir, tal y como se ven ahora. */
  salen: [string, Senal][];
  alDetalle: (clave: string) => void;
}) {
  const [estado, setEstado] = useState(envio.estado());
  const [muestra, setMuestra] = useState('');
  const [eco, setEco] = useState<string | null>(null);
  const [probando, setProbando] = useState(false);
  const [ecoMqtt, setEcoMqtt] = useState<string | null>(null);
  const [probandoMqtt, setProbandoMqtt] = useState(false);
  const [snapsPendientes, setSnapsPendientes] = useState(0);

  const [logs, setLogs] = useState<LogEnvio[]>(obtenerLogsEnvio());
  const [filtroCanal, setFiltroCanal] = useState<'todos' | 'mqtt' | 'api' | 'socket'>('todos');
  const [logExpandido, setLogExpandido] = useState<number | null>(null);

  /* El estado y la muestra del JSON se miran solos: son las dos cosas que hay
     que ver cambiar para creerse que esto está mandando de verdad. */
  useEffect(() => {
    const unsub = alLogsEnvio((nuevosLogs) => setLogs(nuevosLogs));
    const t = setInterval(async () => {
      setEstado(envio.estado());
      setMuestra(envio.vistaPrevia());
      setSnapsPendientes(await cuantosSnapshotsPendientes().catch(() => 0));
    }, 1000);
    setMuestra(envio.vistaPrevia());
    cuantosSnapshotsPendientes().then(setSnapsPendientes).catch(() => 0);
    return () => {
      unsub();
      clearInterval(t);
    };
  }, []);

  const socket = (c: Partial<AjustesEnvio['socket']>) =>
    alCambiar({ ...ajustes, socket: { ...ajustes.socket, ...c } });
  const api = (c: Partial<AjustesEnvio['api']>) =>
    alCambiar({ ...ajustes, api: { ...ajustes.api, ...c } });
  const mqttCfg = (c: Partial<AjustesEnvio['mqtt']>) =>
    alCambiar({ ...ajustes, mqtt: { ...ajustes.mqtt, ...c } });

  const senalesDisponibles = hardware.senalesPorClave();

  return (
    <>
      {/* ── Qué sale, y con qué forma ─────────────────────────────────── */}
      <Bloque titulo="Qué sale del equipo">
        <Nota>
          Sale lo que esté marcado con <b>«Mandar hacia fuera»</b> en el detalle de cada señal,
          ya con su nombre, su unidad y su curva aplicados. Se cambia en <b>Sensores</b> o en{' '}
          <b>Inercial</b>, pulsando <b>Detalles</b>.
        </Nota>

        <div className="grid grid-cols-2 gap-3">
          <Campo
            etiqueta="Nombre de este equipo"
            ayuda="Con el que lo reconocen al otro lado. Va en cada envío."
          >
            <Entrada
              value={ajustes.equipo}
              placeholder="CA-14"
              onChange={(e) => alCambiar({ ...ajustes, equipo: e.target.value })}
            />
          </Campo>

          <Campo
            etiqueta="Forma del JSON"
            ayuda="En lista van también el nombre y la unidad de cada señal."
          >
            <Selector
              value={ajustes.formato}
              onChange={(e) => alCambiar({ ...ajustes, formato: e.target.value as Formato })}
            >
              <option value="lista">Lista de lecturas</option>
              <option value="plano">Clave y valor</option>
            </Selector>
          </Campo>
        </div>

        {salen.length === 0 ? (
          <Vacio>
            No hay ninguna señal marcada para salir, así que no se manda nada. Ve a Sensores,
            pulsa Detalles en la que quieras y enciende «Mandar hacia fuera».
          </Vacio>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line">
            {salen.map(([clave, s], i) => (
              <div
                key={clave}
                className={`flex items-center gap-3 px-3.5 py-2 ${i % 2 ? 'bg-bg' : 'bg-sur2'}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-ink">{s.nombre}</div>
                  <div className="truncate font-mono text-[10.5px] text-ink3">{clave}</div>
                </div>
                <b className="shrink-0 tabular-nums text-[13px] text-ink2">
                  {s.valor === null || s.valor === undefined ? '—' : String(s.valor)}
                </b>
                <Boton variante="tenue" onClick={() => alDetalle(clave)}>
                  Detalles
                </Boton>
              </div>
            ))}
          </div>
        )}

        {/* Lo que de verdad se manda, con los valores de ahora. Sin esto hay
            que ir a mirarlo al otro lado para saber qué forma tiene. */}
        {muestra && (
          <div>
            <p className="rotulo mb-1.5">Así sale, ahora mismo</p>
            <pre className="m-0 max-h-52 overflow-auto rounded-xl border border-line bg-bg px-3.5 py-3 font-mono text-[11px] leading-relaxed text-ink2">
              {muestra}
            </pre>
          </div>
        )}
      </Bloque>

      {/* ── MQTT ────────────────────────────────────────────────────────── */}
      <Bloque titulo="En tiempo real, por MQTT">
        <Nota>
          Publica en un broker MQTT con el payload de Miskimayo cada pocos segundos. Usa TCP puro
          (puerto 1883): solo funciona en la tablet, no en el navegador. Los datos se reciben por
          Ethernet (RJ45/TCP).
        </Nota>

        <Interruptor
          activo={ajustes.mqtt.activo}
          alCambiar={(v) => mqttCfg({ activo: v })}
          etiqueta="Mandar por MQTT"
        />

        <div className="grid grid-cols-[2fr_1fr] gap-3">
          <Campo etiqueta="Broker" ayuda="Solo el host o IP, sin tcp://. Ej: paranoid.lat">
            <Entrada
              value={ajustes.mqtt.broker}
              placeholder="paranoid.lat"
              onChange={(e) => mqttCfg({ broker: e.target.value })}
            />
          </Campo>
          <Campo etiqueta="Puerto">
            <Entrada
              type="number" min={1} max={65535}
              value={ajustes.mqtt.puerto}
              onChange={(e) => mqttCfg({ puerto: Number(e.target.value) || 1883 })}
            />
          </Campo>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Usuario">
            <Entrada
              value={ajustes.mqtt.usuario}
              placeholder="test"
              onChange={(e) => mqttCfg({ usuario: e.target.value })}
            />
          </Campo>
          <Campo etiqueta="Contraseña">
            <Entrada
              type="password"
              value={ajustes.mqtt.contrasena}
              placeholder="••••••••"
              onChange={(e) => mqttCfg({ contrasena: e.target.value })}
            />
          </Campo>
        </div>

        <div className="grid grid-cols-[2fr_1fr] gap-3">
          <Campo
            etiqueta="Topic"
            ayuda="{{unit_id}} se reemplaza por el nombre del equipo."
          >
            <Entrada
              value={ajustes.mqtt.topic}
              placeholder="/miskimayo/diplus/{{unit_id}}"
              onChange={(e) => mqttCfg({ topic: e.target.value })}
            />
          </Campo>
          <Campo etiqueta="Cada cuántos segundos">
            <Entrada
              type="number" min={1}
              value={ajustes.mqtt.cadaSeg}
              onChange={(e) => mqttCfg({ cadaSeg: Number(e.target.value) || 5 })}
            />
          </Campo>
        </div>

        {/* Mapeo de Sensores RJ45/TCP */}
        <div className="grid grid-cols-3 gap-3">
          <Campo etiqueta="Caudal Entrada (inputFlow)" ayuda="Sensor principal">
            <Selector
              value={ajustes.mqtt.claveInputFlow ?? ''}
              onChange={(e) => mqttCfg({ claveInputFlow: e.target.value || undefined })}
            >
              <option value="">(Automático por nombre)</option>
              {senalesDisponibles.map(([clave, s]) => (
                <option key={clave} value={clave}>
                  {s.nombre} ({clave})
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo etiqueta="Caudal Retorno (outputFlow)" ayuda="Sensor de retorno">
            <Selector
              value={ajustes.mqtt.claveOutputFlow ?? ''}
              onChange={(e) => mqttCfg({ claveOutputFlow: e.target.value || undefined })}
            >
              <option value="">(Automático / "retorno")</option>
              {senalesDisponibles.map(([clave, s]) => (
                <option key={clave} value={clave}>
                  {s.nombre} ({clave})
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo etiqueta="Sensor Nivel (sensorVolume)" ayuda="Sensor de nivel">
            <Selector
              value={ajustes.mqtt.claveSensorNivel ?? ''}
              onChange={(e) => mqttCfg({ claveSensorNivel: e.target.value || undefined })}
            >
              <option value="">(Automático / "nivel")</option>
              {senalesDisponibles.map(([clave, s]) => (
                <option key={clave} value={clave}>
                  {s.nombre} ({clave})
                </option>
              ))}
            </Selector>
          </Campo>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Totalizador Entrada (totalized)" ayuda="Totalizador principal">
            <Selector
              value={ajustes.mqtt.claveTotalizadorInput ?? ''}
              onChange={(e) => mqttCfg({ claveTotalizadorInput: e.target.value || undefined })}
            >
              <option value="">(Automático / "totaliz")</option>
              {senalesDisponibles.map(([clave, s]) => (
                <option key={clave} value={clave}>
                  {s.nombre} ({clave})
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo etiqueta="Totalizador Retorno" ayuda="Totalizador de retorno (opcional)">
            <Selector
              value={ajustes.mqtt.claveTotalizadorOutput ?? ''}
              onChange={(e) => mqttCfg({ claveTotalizadorOutput: e.target.value || undefined })}
            >
              <option value="">(Ninguno / Automático)</option>
              {senalesDisponibles.map(([clave, s]) => (
                <option key={clave} value={clave}>
                  {s.nombre} ({clave})
                </option>
              ))}
            </Selector>
          </Campo>
        </div>

        <Marcador e={estado.mqtt} unidad="publicaciones" />

        {snapsPendientes > 0 && (
          <div className="rounded-xl border border-line bg-sur2 px-3.5 py-2.5 font-mono text-[11px] text-ink2">
            📊 <b>{snapsPendientes}</b> snapshots guardados en BD pendientes de envío por API (100 cada 10s).
          </div>
        )}

        {!hayMqtt() && (
          <Aviso tono="warn">
            MQTT usa TCP nativo: este canal solo funciona instalado en la tablet, no al abrir la
            app en un navegador de escritorio.
          </Aviso>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Boton
            variante="fuerte"
            disabled={probandoMqtt}
            onClick={async () => {
              setProbandoMqtt(true);
              setEcoMqtt(await envio.probarMqtt());
              setProbandoMqtt(false);
              setEstado(envio.estado());
            }}
          >
            {probandoMqtt ? 'Probando…' : 'Probar ahora'}
          </Boton>
        </div>

        {ecoMqtt && (
          <Aviso tono={ecoMqtt.startsWith('Publicado') ? 'ok' : 'warn'}>{ecoMqtt}</Aviso>
        )}
      </Bloque>

      {/* ── Socket ─────────────────────────────────────────────────────── */}
      <Bloque titulo="En directo, por socket">
        <Nota>
          Manda el valor del momento cada pocos segundos, sin guardar nada. Es para quien está
          mirando en directo: si se pierde un envío, el siguiente viene enseguida y el anterior
          ya no le interesaba a nadie. <b>Para el histórico no sirve</b>: usa la API de abajo.
        </Nota>

        <Interruptor
          activo={ajustes.socket.activo}
          alCambiar={(v) => socket({ activo: v })}
          etiqueta="Mandar por socket"
        />

        <div className="grid grid-cols-[2fr_1fr] gap-3">
          <Campo etiqueta="A dónde" ayuda="ws://maquina:puerto · wss:// si lleva certificado.">
            <Entrada
              value={ajustes.socket.url}
              placeholder="ws://192.168.60.2:9977"
              onChange={(e) => socket({ url: e.target.value })}
            />
          </Campo>
          <Campo etiqueta="Cada cuántos segundos">
            <Entrada
              type="number" min={1}
              value={ajustes.socket.cadaSeg}
              onChange={(e) => socket({ cadaSeg: Number(e.target.value) || 1 })}
            />
          </Campo>
        </div>

        <Marcador e={estado.socket} unidad="envíos" />

        {ajustes.socket.activo && estado.socket.estado === 'fallo' && (
          <Nota>
            Se vuelve a intentar solo cada seis segundos. Si no levanta, comprueba que el otro
            lado esté escuchando en ese puerto y que el equipo llegue a esa dirección.
          </Nota>
        )}
      </Bloque>

      {/* ── API ────────────────────────────────────────────────────────── */}
      <Bloque titulo="El histórico, por API">
        <Nota>
          Manda por lotes lo que hay guardado en el equipo y apunta por dónde iba, así que un
          rato sin cobertura no cuesta datos: cuando vuelve, sigue por donde se quedó. Lo que
          no se pudo entregar queda en cola y se reintenta.
        </Nota>

        <Interruptor
          activo={ajustes.api.activo}
          alCambiar={(v) => api({ activo: v })}
          etiqueta="Mandar a una API"
        />

        <Campo etiqueta="A dónde" ayuda="La dirección completa a la que se hace el POST.">
          <Entrada
            value={ajustes.api.url}
            placeholder="https://marcobre-back.diplus.io/api/lecturas"
            onChange={(e) => api({ url: e.target.value })}
          />
        </Campo>

        <div className="grid grid-cols-3 gap-3">
          <Campo etiqueta="Token" ayuda="Va como Bearer. Vacío = sin cabecera.">
            <Entrada
              type="password"
              value={ajustes.api.token}
              onChange={(e) => api({ token: e.target.value })}
            />
          </Campo>
          <Campo etiqueta="Cada cuántos segundos">
            <Entrada
              type="number" min={5}
              value={ajustes.api.cadaSeg}
              onChange={(e) => api({ cadaSeg: Number(e.target.value) || 30 })}
            />
          </Campo>
          <Campo etiqueta="Lecturas por envío">
            <Entrada
              type="number" min={1}
              value={ajustes.api.lote}
              onChange={(e) => api({ lote: Number(e.target.value) || 200 })}
            />
          </Campo>
        </div>

        <Interruptor
          activo={ajustes.api.historico}
          alCambiar={(v) => api({ historico: v })}
          etiqueta="Mandar lo guardado, no solo el valor de ahora"
        />

        {!ajustes.api.historico && (
          <Aviso tono="warn">
            Así la API se comporta como el socket: manda la foto del momento y un corte de red
            sí pierde datos. Tiene sentido solo si al otro lado no quieren historial.
          </Aviso>
        )}

        {ajustes.api.historico && (
          <Nota>
            Se manda lo que el equipo tenga guardado, así que esto depende de lo que se esté
            guardando: mira <b>Datos</b> para el ritmo y cuánto se conserva, y el detalle de
            cada señal para cuáles se guardan.
          </Nota>
        )}

        <Marcador e={estado.api} unidad="lecturas entregadas" />

        {estado.enCola > 0 && (
          <Aviso tono="warn">
            Hay {estado.enCola} envío{estado.enCola === 1 ? '' : 's'} en cola esperando red. Se
            sueltan de cinco en cinco en cada vuelta, antes que lo nuevo.
          </Aviso>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Boton
            variante="fuerte"
            disabled={probando}
            onClick={async () => {
              setProbando(true);
              setEco(await envio.probar());
              setProbando(false);
              setEstado(envio.estado());
            }}
          >
            {probando ? 'Probando…' : 'Probar ahora'}
          </Boton>

          <Boton
            onClick={() => {
              envio.reenviarTodo();
              setEco('Marca puesta al principio: en la próxima vuelta empieza de nuevo.');
            }}
          >
            Reenviar todo lo guardado
          </Boton>
        </div>

        {eco && <Aviso tono={eco.startsWith('Entregado') ? 'ok' : 'warn'}>{eco}</Aviso>}
      </Bloque>

      {/* ── Consola de Envíos y Debug ───────────────────────────────────── */}
      {(() => {
        const logsFiltered =
          filtroCanal === 'todos' ? logs : logs.filter((l) => l.canal === filtroCanal);

        return (
          <Bloque titulo="Consola de Envíos & Debug (Logs y Respuestas del Servidor en Vivo)">
            <Nota>
              Aquí ves exactamente lo que sale del equipo hacia el servidor y las respuestas HTTP /
              MQTT / WebSocket que se reciben en tiempo real.
            </Nota>

            <div className="flex flex-wrap items-center justify-between gap-3 bg-sur2 p-3 rounded-xl border border-line">
              <div className="flex items-center gap-1.5">
                {(['todos', 'mqtt', 'api', 'socket'] as const).map((canal) => (
                  <button
                    key={canal}
                    type="button"
                    onClick={() => setFiltroCanal(canal)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${
                      filtroCanal === canal
                        ? 'bg-acc text-sur1 shadow'
                        : 'bg-sur3 text-ink2 hover:bg-line'
                    }`}
                  >
                    {canal}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <Boton
                  variante="fuerte"
                  onClick={async () => {
                    envio.probarMqtt().catch(() => undefined);
                    envio.probar().catch(() => undefined);
                  }}
                >
                  ⚡ Probar Envíos Ahora
                </Boton>
                <Boton onClick={limpiarLogsEnvio}>Limpiar consola</Boton>
              </div>
            </div>

            <div className="flex flex-col gap-2 max-h-96 overflow-y-auto pr-1">
              {logsFiltered.length === 0 ? (
                <Vacio>
                  ⚡ Sin logs de envío registrados. Los registros de peticiones y respuestas salientes aparecerán aquí automáticamente.
                </Vacio>
              ) : (
                logsFiltered.map((log) => {
                  const expandido = logExpandido === log.id;
                  const badgeCanalColor =
                    log.canal === 'mqtt'
                      ? 'bg-sky-500/20 text-sky-400 border-sky-500/30'
                      : log.canal === 'api'
                      ? 'bg-purple-500/20 text-purple-400 border-purple-500/30'
                      : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';

                  const tipoColor =
                    log.tipo === 'ok'
                      ? 'text-acc font-semibold'
                      : log.tipo === 'error'
                      ? 'text-bad font-semibold'
                      : 'text-warn';

                  return (
                    <div
                      key={log.id}
                      className="rounded-xl border border-line bg-sur2 p-3 text-xs font-mono transition hover:border-ink3/40"
                    >
                      <div
                        className="flex items-center justify-between gap-2 cursor-pointer"
                        onClick={() => setLogExpandido(expandido ? null : log.id)}
                      >
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="text-ink3 text-[11px]">
                            {new Date(log.at).toLocaleTimeString('es-PE')}
                          </span>
                          <span
                            className={`uppercase text-[10px] font-bold px-2 py-0.5 rounded border ${badgeCanalColor}`}
                          >
                            {log.canal}
                          </span>
                          <span className={tipoColor}>{log.mensaje}</span>
                        </div>

                        {log.detalles && (
                          <span className="text-[10px] text-ink3 hover:text-ink1 font-sans shrink-0">
                            {expandido ? '▲ Ocultar JSON' : '▼ Ver JSON/Detalles'}
                          </span>
                        )}
                      </div>

                      {expandido && log.detalles && (
                        <div className="mt-2.5 pt-2 border-t border-line/60">
                          <pre className="bg-sur1 p-2.5 rounded-lg text-[11px] text-ink1 overflow-x-auto whitespace-pre-wrap max-h-48 border border-line">
                            {log.detalles}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </Bloque>
        );
      })()}
    </>
  );
}
