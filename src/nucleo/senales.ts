/**
 * Lo que se decide de cada señal, en un solo sitio.
 *
 * Antes estaba repartido y no se entendia: la curva colgaba de la
 * configuracion, el factor y la unidad de cada tarjeta del panel, y si se
 * guardaba o no de una lista de claves en otra pestaña. Cambiar como se lee un
 * caudalimetro obligaba a tocar tres pantallas, y la misma señal enseñada en
 * dos cuadros pedia poner el factor dos veces.
 *
 * Aqui hay una entrada por señal y todo lo suyo dentro. La tarjeta del panel
 * decide **como se dibuja** —numero, tanque, aguja—, y esto decide **que
 * numero es**.
 */
import { Punto, aplicar } from './curva';
import { Senal } from './lecturas';

export interface AjustesSenal {
  /** Como se llama en pantalla. Vacio = el nombre que trae el protocolo. */
  alias: string;
  /** Vacia = la que trae. Se pone cuando el factor cambia de unidad. */
  unidad: string;
  /**
   * Multiplica despues de la curva.
   *
   * Es para cambiar de unidad —de litros a galones—, no para corregir el
   * sensor: para eso esta la curva. Separarlos importa porque una conversion
   * de unidad es exacta y una correccion es una medida, y mezclarlas hace
   * imposible saber cual de las dos esta mal cuando el numero no cuadra.
   */
  factor: number;
  /** Pares «lo que marca → lo que es». Vacia = sin corregir. */
  curva: Punto[];
  /** Si baja al historico del equipo. */
  guardar: boolean;
  /** Si sale hacia fuera: al servidor y por el socket. */
  enviar: boolean;
}

export type AjustesPorSenal = Record<string, AjustesSenal>;

export const AJUSTES_POR_DEFECTO: AjustesSenal = {
  alias: '',
  unidad: '',
  factor: 1,
  curva: [],
  guardar: true,
  enviar: true,
};

/** Los ajustes de una señal, con los de fabrica donde no haya nada puesto. */
export const ajustesDe = (todos: AjustesPorSenal, clave: string): AjustesSenal => ({
  ...AJUSTES_POR_DEFECTO,
  ...(todos?.[clave] ?? {}),
});

/**
 * Aplica a una lectura lo que se haya decidido de ella.
 *
 * El orden no es casual: **primero la curva y despues el factor**. La curva
 * corrige lo que el sensor mide mal, y sus puntos se tomaron en las unidades
 * del sensor; el factor solo cambia de unidad al final. Al reves, los puntos de
 * la curva dejarian de cuadrar con lo que marca el aparato y quien la tecleo no
 * reconoceria sus propios numeros.
 */
export const ajustar = (a: AjustesSenal, s: Senal): Senal => {
  const nombre = a.alias.trim() || s.nombre;
  const unidad = a.unidad.trim() || s.unidad;

  if (typeof s.valor !== 'number') return { ...s, nombre, unidad };

  const conCurva = a.curva.length >= 2 ? aplicar(a.curva, s.valor) : s.valor;
  const factor = Number.isFinite(a.factor) && a.factor !== 0 ? a.factor : 1;

  return {
    ...s,
    nombre,
    unidad,
    valor: conCurva * factor,
    calibrada: a.curva.length >= 2 || undefined,
  };
};
