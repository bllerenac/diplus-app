/**
 * Un setInterval que no se duerme con la pantalla apagada.
 *
 * Con la vista oculta Chrome baja los temporizadores a uno por minuto. Los
 * eventos nativos no se frenan, así que el latido del servicio en primer
 * plano (uno por segundo) pone al día lo que se haya atrasado.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface Reloj {
  ms: number;
  fn: () => void;
  ultimo: number;
  id: ReturnType<typeof setInterval>;
}

const activos = new Set<Reloj>();
/** Margen para que el temporizador y el latido no corran la misma vuelta dos veces. */
const HOLGURA = 50;

const tocar = (r: Reloj, ahora = Date.now()) => {
  if (ahora - r.ultimo < r.ms - HOLGURA) return;
  r.ultimo = ahora;
  try {
    r.fn();
  } catch (e) {
    console.warn('reloj', e);
  }
};

export const alLatir = (ahora = Date.now()) => {
  for (const r of activos) tocar(r, ahora);
};

export const cada = (fn: () => void, ms: number): Reloj => {
  const r: Reloj = { ms, fn, ultimo: Date.now(), id: 0 as unknown as ReturnType<typeof setInterval> };
  r.id = setInterval(() => tocar(r), ms);
  activos.add(r);
  return r;
};

export const soltar = (r: Reloj | null | undefined) => {
  if (!r) return;
  clearInterval(r.id);
  activos.delete(r);
};

/* ── El servicio nativo ─────────────────────────────────────────────────── */

interface PluginSegundoPlano {
  arrancar(o: { texto: string }): Promise<void>;
  detener(): Promise<void>;
  estado(): Promise<{ activo: boolean }>;
  addListener(e: 'latido', fn: (x: { at: number }) => void): Promise<{ remove: () => void }>;
}

const Nativo = registerPlugin<PluginSegundoPlano>('SegundoPlano');

let escuchando = false;

export const segundoPlano = {
  async aplicar(activo: boolean, equipo: string) {
    if (!Capacitor.isNativePlatform()) return;
    if (!escuchando) {
      escuchando = true;
      await Nativo.addListener('latido', () => alLatir());
    }
    if (activo) await Nativo.arrancar({ texto: `${equipo || 'DiPlus'} · leyendo y enviando` });
    else await Nativo.detener();
  },
  estado: () => Nativo.estado(),
};
