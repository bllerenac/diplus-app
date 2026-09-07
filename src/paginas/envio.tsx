/**
 * A dónde sale lo que el equipo mide.
 *
 * Están juntos los dos caminos porque la pregunta es la misma —«¿esto sale del
 * camión?»— pero separados en dos bloques porque las respuestas no se parecen:
 * el socket es para mirar en directo y la API es para no perder nada. Ver
 * `nucleo/envio.ts` para el porqué de esa diferencia.
 *
 * Lo que **no** se decide aquí es qué señales salen. Eso va señal por señal, en
 * su detalle, junto a su nombre y su curva, porque es una propiedad de la señal
 * y no del cable por el que se manda: la misma señal puede irse hoy por socket
 * y mañana por API sin dejar de ser la misma. Aquí solo se enseña la lista
 * resultante, para poder comprobarla de un vistazo antes de encender nada.
 */
import { useEffect, useState } from 'react';
import { Senal } from '../nucleo/lecturas';
import { AjustesEnvio, EstadoCanal, Formato, envio } from '../nucleo/envio';
import { Aviso, Bloque, Boton, Campo, Entrada, Interruptor, Nota, Selector, Vacio } from './piezas';

const DICHO: Record<EstadoCanal['estado'], string> = {
  parado: 'Apagado',
  conectando: 'Esperando su turno…',
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

  /* El estado y la muestra del JSON se miran solos: son las dos cosas que hay
     que ver cambiar para creerse que esto está mandando de verdad. */
  useEffect(() => {
    const t = setInterval(() => {
      setEstado(envio.estado());
      setMuestra(envio.vistaPrevia());
    }, 1000);
    setMuestra(envio.vistaPrevia());
    return () => clearInterval(t);
  }, []);

  const socket = (c: Partial<AjustesEnvio['socket']>) =>
    alCambiar({ ...ajustes, socket: { ...ajustes.socket, ...c } });
  const api = (c: Partial<AjustesEnvio['api']>) =>
    alCambiar({ ...ajustes, api: { ...ajustes.api, ...c } });

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
    </>
  );
}
