/**
 * Un camion de mentira, para poder ver la pantalla sin hardware.
 *
 * Hasta que el RS485 entregue su primera trama no hay forma de mirar como queda
 * la pantalla con datos: sale el mapa alejado y el panel vacio, que es
 * exactamente lo que no hay que juzgar. Esto llena las dos cosas con valores
 * plausibles para poder decidir el diseño.
 *
 * ─── Reglas que se respetan a proposito ──────────────────────────────────────
 *
 * **Se anuncia siempre.** Una posicion inventada no se distingue en un mapa de
 * una buena, y un caudal inventado no se distingue de uno leido. Mientras esto
 * corre, la pantalla lo dice con todas las letras. Lo contrario es la trampa en
 * la que ya cayo la version anterior de esta aplicacion, que pintaba unas
 * coordenadas fijas de Lima como si fueran la posicion del equipo.
 *
 * **No toca la base de datos.** Lo que genera se ve, pero no se guarda: mezclar
 * lecturas inventadas con las de verdad en el historico seria un problema de
 * los que se descubren tarde.
 *
 * **No se enciende sola.** Solo desde Configuracion, y no sobrevive a un
 * reinicio de la aplicacion.
 */
import { Senal, senal } from './lecturas';
import { hardware } from './hardware';
import { gps } from './gps';

/** Cada cuanto se genera una lectura nueva. */
const CADA_MS = 800;

/**
 * Una vuelta por la mina, entre las geocercas de verdad.
 *
 * Las coordenadas caen dentro del plano que viene del servidor —de -6,022 a
 * -6,059 de latitud y de -80,835 a -80,882 de longitud—, para que al probar se
 * vea la maquina moverse entre las zonas reales y no en mitad del oceano.
 */
const RUTA: [number, number][] = [
  [-6.0470, -80.8720],
  [-6.0452, -80.8698],
  [-6.0431, -80.8676],
  [-6.0408, -80.8657],
  [-6.0384, -80.8641],
  [-6.0359, -80.8629],
  [-6.0334, -80.8622],
  [-6.0308, -80.8620],
  [-6.0304, -80.8576],
  [-6.0326, -80.8552],
  [-6.0352, -80.8540],
  [-6.0380, -80.8538],
  [-6.0407, -80.8547],
  [-6.0432, -80.8566],
  [-6.0453, -80.8592],
  [-6.0470, -80.8622],
  [-6.0483, -80.8654],
  [-6.0490, -80.8688],
  [-6.0487, -80.8722],
  [-6.0479, -80.8724],
];

/** Interpolacion entre dos puntos de la ruta, para que no vaya a saltos. */
const entre = (a: number, b: number, t: number) => a + (b - a) * t;

/** El rumbo que lleva quien va de `a` a `b`, en grados desde el norte. */
const rumboEntre = (a: [number, number], b: [number, number]) => {
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
};

export const FUENTE_MAQUETA = 'maqueta';

class Maqueta {
  private reloj: ReturnType<typeof setInterval> | null = null;
  private paso = 0;

  get encendida() {
    return this.reloj !== null;
  }

  encender() {
    if (this.reloj) return;
    this.paso = 0;
    this.reloj = setInterval(() => this.tic(), CADA_MS);
    this.tic();
  }

  apagar() {
    if (!this.reloj) return;
    clearInterval(this.reloj);
    this.reloj = null;
  }

  private tic() {
    this.paso += 1;
    this.mover();
    hardware.inyectar(FUENTE_MAQUETA, 'Camión de prueba', this.lecturas());
  }

  /** Avanza por la ruta, interpolando entre punto y punto. */
  private mover() {
    const avance = this.paso / 14;
    const i = Math.floor(avance) % RUTA.length;
    const j = (i + 1) % RUTA.length;
    const t = avance - Math.floor(avance);

    const lat = entre(RUTA[i][0], RUTA[j][0], t);
    const lon = entre(RUTA[i][1], RUTA[j][1], t);
    const velocidad = 6.5 + 2.2 * Math.sin(this.paso / 9); // m/s, unos 25-30 km/h

    gps.simular({
      lat,
      lon,
      alt: 180 + 40 * Math.sin(this.paso / 25),
      velocidad,
      rumbo: rumboEntre(RUTA[i], RUTA[j]),
      hdop: 0.8,
      satelites: 18,
      calidad: 4,
      origen: 'rtk',
      at: Date.now(),
    });
  }

  /**
   * Las lecturas del camion.
   *
   * Los dos caudalimetros van pensados para que su resta sea el consumo, que es
   * la tarjeta de diferencia del panel, y el nivel baja despacio como bajaria un
   * tanque de verdad.
   */
  private lecturas(): Senal[] {
    const t = this.paso;
    const carga = 0.5 + 0.5 * Math.sin(t / 17); // 0 a 1, el esfuerzo del motor

    const ida = 34 + 16 * carga + Math.sin(t / 3) * 0.8;
    const retorno = 24 + 6 * carga + Math.sin(t / 4) * 0.6;

    return [
      senal('caudal_ida', 'Caudal ida', 'L/h', +ida.toFixed(2)),
      senal('caudal_retorno', 'Caudal retorno', 'L/h', +retorno.toFixed(2)),
      senal('nivel_tanque', 'Nivel de tanque', 'L', +(320 - (t % 600) * 0.35).toFixed(1)),
      senal('rpm', 'Revoluciones', 'rpm', Math.round(900 + 900 * carga)),
      senal('temp_motor', 'Temperatura motor', '°C', +(72 + 16 * carga).toFixed(1)),
      senal('presion_aceite', 'Presión de aceite', 'bar', +(3.4 + 0.9 * carga).toFixed(2)),
      senal('horas_motor', 'Horas de motor', 'h', +(7431 + t / 3600).toFixed(2)),
      senal('voltaje', 'Voltaje', 'V', +(27.4 + 0.6 * Math.sin(t / 11)).toFixed(1)),
      senal('carga_motor', 'Carga del motor', '%', Math.round(carga * 100)),
      senal('estado', 'Estado', '', carga > 0.75 ? 'CARGANDO' : 'EN RUTA'),
    ];
  }
}

export const maqueta = new Maqueta();
