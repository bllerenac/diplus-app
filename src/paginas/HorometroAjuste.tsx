/**
 * Vista de configuración y monitoreo del Horómetro Interno de la Tablet.
 *
 * Muestra el display digital de horas de motor acumuladas por tiempo de encendido,
 * permite ingresar y editar las horas iniciales del camión y ajustar el conteo.
 */
import { useEffect, useState } from 'react';
import { AjustesHorometro, horometro, HorometroEstado } from '../nucleo/horometro';
import { Aviso, Bloque, Boton, Campo, Entrada, Interruptor, Nota } from './piezas';

export function HorometroAjuste({
  ajustes,
  alCambiar,
}: {
  ajustes: AjustesHorometro;
  alCambiar: (a: AjustesHorometro) => void;
}) {
  const [estado, setEstado] = useState<HorometroEstado>(horometro.estado());
  const [valorInicialInput, setValorInicialInput] = useState(String(ajustes.valorInicial || 0));
  const [lecturaActualInput, setLecturaActualInput] = useState('');
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    const unsub = horometro.alCambiar((nuevoEstado) => {
      setEstado(nuevoEstado);
    });
    return () => unsub();
  }, []);

  const guardarValorInicial = () => {
    const n = parseFloat(valorInicialInput);
    if (isNaN(n) || n < 0) {
      setMensaje('Ingresa un número válido de horas (ej. 1250.5).');
      return;
    }
    const nuevo = { ...ajustes, valorInicial: n };
    horometro.setValorInicial(n);
    alCambiar(nuevo);
    setMensaje(`Valor inicial actualizado a ${n.toFixed(2)} h.`);
    setTimeout(() => setMensaje(null), 3000);
  };

  const calibrarTotalDirecto = () => {
    const n = parseFloat(lecturaActualInput);
    if (isNaN(n) || n < 0) {
      setMensaje('Ingresa un número válido para la lectura total.');
      return;
    }
    const nuevo = { ...ajustes, valorInicial: n, segundosAcumulados: 0 };
    horometro.setHorasTotales(n);
    alCambiar(nuevo);
    setValorInicialInput(String(n));
    setLecturaActualInput('');
    setMensaje(`Horómetro calibrado directamente a ${n.toFixed(2)} h.`);
    setTimeout(() => setMensaje(null), 3500);
  };

  const alternarActivo = (activo: boolean) => {
    const nuevo = { ...ajustes, activo };
    horometro.setActivo(activo);
    alCambiar(nuevo);
  };

  const reiniciarAcumulado = () => {
    const nuevo = { ...ajustes, segundosAcumulados: 0 };
    horometro.reiniciarAcumulado();
    alCambiar(nuevo);
    setMensaje('Tiempo acumulado por la tablet reiniciado a 0 h.');
    setTimeout(() => setMensaje(null), 3000);
  };

  return (
    <>
      {/* ── Display Principal Digital ─────────────────────────────────── */}
      <Bloque titulo="Horómetro del Motor">
        <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-[#0c141c] p-6 text-center shadow-lg">
          <div className="mb-2 flex items-center gap-2">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                estado.activo
                  ? 'bg-acc shadow-[0_0_8px_var(--glowa)] animate-pulse'
                  : 'bg-warn'
              }`}
            />
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink3">
              {estado.activo ? 'En conteo · Tablet encendida' : 'Pausado'}
            </span>
          </div>

          <div className="font-mono text-5xl font-black tracking-tight text-acc tabular-nums sm:text-6xl">
            {estado.horasTotales.toFixed(2)}{' '}
            <span className="text-2xl font-normal text-ink3">h</span>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs font-mono text-ink2">
            <div>
              Horas iniciales: <b className="text-ink">{estado.valorInicial.toFixed(2)} h</b>
            </div>
            <div className="text-ink3">·</div>
            <div>
              Tablet encendida:{' '}
              <b className="text-ink">{estado.horasAcumuladas.toFixed(2)} h</b> ({estado.tiempoTexto})
            </div>
          </div>
        </div>

        {mensaje && <Aviso tono="ok">{mensaje}</Aviso>}
      </Bloque>

      {/* ── Ingreso de Horas Iniciales ────────────────────────────────── */}
      <Bloque titulo="Horas iniciales (del tablero del camión)">
        <Nota>
          Ingresa aquí las horas que marcaba el horómetro del tablero físico de la cabina cuando
          se instaló o configuró la tablet. A partir de este valor se sumará el tiempo que la
          tablet permanezca encendida.
        </Nota>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Campo
              etiqueta="Horas base iniciales"
              ayuda="Ejemplo: 7420.5 para 7,420 horas y media."
            >
              <Entrada
                type="number"
                step="0.01"
                min="0"
                value={valorInicialInput}
                onChange={(e) => setValorInicialInput(e.target.value)}
                placeholder="7420.5"
              />
            </Campo>
          </div>
          <Boton variante="fuerte" onClick={guardarValorInicial}>
            Guardar horas iniciales
          </Boton>
        </div>
      </Bloque>

      {/* ── Calibración / Sincronización Directa ───────────────────────── */}
      <Bloque titulo="Puesta en hora directa">
        <Nota>
          Si tras un mantenimiento o lectura visual del camión deseas sincronizar el total del
          horómetro a una lectura exacta, ingrésala aquí. Esto fijará las horas iniciales en este
          número y pondrá a cero el contador de la tablet.
        </Nota>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Campo
              etiqueta="Lectura total actual deseada"
              ayuda="El total que pasará a marcar el equipo."
            >
              <Entrada
                type="number"
                step="0.01"
                min="0"
                value={lecturaActualInput}
                onChange={(e) => setLecturaActualInput(e.target.value)}
                placeholder="Ej. 7500.0"
              />
            </Campo>
          </div>
          <Boton onClick={calibrarTotalDirecto}>
            Calibrar a esta lectura
          </Boton>
        </div>
      </Bloque>

      {/* ── Opciones de Control ───────────────────────────────────────── */}
      <Bloque titulo="Control de conteo">
        <Interruptor
          activo={ajustes.activo}
          alCambiar={alternarActivo}
          etiqueta="Contar tiempo automáticamente con la tablet encendida"
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="text-xs text-ink3">
            Tiempo de encendido acumulado por la tablet: <b>{estado.tiempoTexto}</b>
          </div>
          <Boton variante="tenue" onClick={reiniciarAcumulado}>
            Poner a cero tiempo de la tablet
          </Boton>
        </div>
      </Bloque>

      {/* ── Vinculación con Telemetría ─────────────────────────────────── */}
      <Bloque titulo="Uso en el sistema y telemetría">
        <Nota>
          Este horómetro genera automáticamente la señal <b>«sistema.horometro»</b> en el equipo:
          <ul className="mt-2 list-disc pl-5 space-y-1">
            <li>
              <b>Envíos MQTT y Snapshots</b>: Se envía en el campo <code>horometro</code> (configurable
              en la pestaña <b>Envío</b>).
            </li>
            <li>
              <b>Pantalla principal</b>: Puedes agregar una tarjeta al panel en la pestaña <b>Panel</b>{' '}
              seleccionando la señal <code>sistema.horometro</code>.
            </li>
            <li>
              <b>Persistencia</b>: El conteo se guarda cada pocos segundos en la memoria interna de la
              tablet para resistir cortes de energía y reinicios.
            </li>
          </ul>
        </Nota>
      </Bloque>
    </>
  );
}
