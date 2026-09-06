/**
 * Dónde está el frente del camión, visto por dentro y en tres dimensiones.
 *
 * Antes esto era un desplegable con «X / Y / Z» y un interruptor para invertir.
 * Eso es correcto y es ilegible: nadie que monte un equipo en una cabina sabe
 * hacia dónde cae la Y del acelerómetro. Después fue un dibujo plano, que ya se
 * entendía pero solo servía para las cuatro posiciones tumbadas; las dos de pie
 * había que explicarlas con palabras porque en un plano no se ven.
 *
 * Aquí el camión se dibuja en alambre —como una radiografía— y el equipo va
 * dentro de la cabina, en la postura en que quedó instalado. El camión no se
 * mueve: el morro apunta siempre al mismo sitio, y lo único que cambia entre
 * las seis posiciones es cómo queda puesto el equipo. Y se puede arrastrar
 * para mirarlo desde otro lado, que es lo que convierte seis casos abstractos
 * en seis cosas que se ven.
 *
 * Son seis y no más porque el acelerómetro tiene tres ejes y cada uno se puede
 * mirar en dos sentidos.
 *
 * Aun así el dibujo es una intención, no una medida. Lo que de verdad lo
 * confirma es acelerar: por eso está el botón que mira unos segundos de marcha
 * y elige el eje solo. El dibujo dice lo que se cree; la prueba dice lo que es.
 */
import { useEffect, useRef, useState } from 'react';
import { Eje, movimiento } from '../nucleo/movimiento';
import { Boton, Aviso, Nota } from './piezas';

type Lado = 'arriba' | 'derecha' | 'abajo' | 'izquierda' | 'fuera' | 'detras';

/** Un punto o una dirección. Siempre en ejes del equipo: X derecha, Y arriba, Z hacia quien mira. */
type V3 = [number, number, number];

interface Posicion {
  id: Lado;
  eje: Eje;
  invertido: boolean;
  nombre: string;
  /** Cómo queda el equipo puesto así, dicho para quien lo está montando. */
  como: string;
  /** Hacia dónde va el morro del camión, en ejes del equipo. */
  frente: V3;
  /** Y hacia dónde le queda el techo. Sin esto el camión saldría del revés. */
  techo: V3;
}

const POSICIONES: Posicion[] = [
  { id: 'arriba', eje: 'y', invertido: false,
    nombre: 'Hacia arriba de la pantalla',
    como: 'Tumbado, y el borde de arriba de la pantalla mira al frente.',
    frente: [0, 1, 0], techo: [0, 0, 1] },
  { id: 'derecha', eje: 'x', invertido: false,
    nombre: 'Hacia la derecha',
    como: 'Tumbado, y el borde derecho de la pantalla mira al frente.',
    frente: [1, 0, 0], techo: [0, 0, 1] },
  { id: 'abajo', eje: 'y', invertido: true,
    nombre: 'Hacia abajo de la pantalla',
    como: 'Tumbado, y el borde de abajo de la pantalla mira al frente.',
    frente: [0, -1, 0], techo: [0, 0, 1] },
  { id: 'izquierda', eje: 'x', invertido: true,
    nombre: 'Hacia la izquierda',
    como: 'Tumbado, y el borde izquierdo de la pantalla mira al frente.',
    frente: [-1, 0, 0], techo: [0, 0, 1] },
  { id: 'detras', eje: 'z', invertido: true,
    nombre: 'Por la espalda del equipo',
    como: 'De pie, con la pantalla mirando al conductor. Es lo más común.',
    frente: [0, 0, -1], techo: [0, 1, 0] },
  { id: 'fuera', eje: 'z', invertido: false,
    nombre: 'Por la pantalla',
    como: 'De pie, con la pantalla mirando al parabrisas.',
    frente: [0, 0, 1], techo: [0, 1, 0] },
];

/** Las cuatro tumbadas, en el orden en que las recorre el botón de girar. */
const VUELTA: Lado[] = ['arriba', 'derecha', 'abajo', 'izquierda'];

const posicionDe = (eje: Eje, invertido: boolean): Posicion =>
  POSICIONES.find((p) => p.eje === eje && p.invertido === invertido) ?? POSICIONES[0];

const eje3 = (e: Eje) => (e === 'x' ? 0 : e === 'y' ? 1 : 2);

/** Cuánto dura la prueba de marcha. Corta: acelerar cinco segundos ya se nota. */
const PRUEBA_MS = 5000;

// ── Las tres dimensiones, con lo justo ──────────────────────────────────────

const cruz = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * Del camión al equipo.
 *
 * El camión se dibuja en sus propios ejes —a lo largo, a lo ancho y a lo alto—
 * y esto lo coloca en los del equipo. Sabiendo hacia dónde le queda el morro y
 * hacia dónde el techo, el costado sale solo: es el producto cruzado de los
 * dos, y por eso no hace falta configurar nada más.
 */
const colocar = (p: Posicion, v: V3): V3 => {
  const derecha = cruz(p.frente, p.techo);
  return [
    derecha[0] * v[0] + p.techo[0] * v[1] + p.frente[0] * v[2],
    derecha[1] * v[0] + p.techo[1] * v[1] + p.frente[1] * v[2],
    derecha[2] * v[0] + p.techo[2] * v[1] + p.frente[2] * v[2],
  ];
};

/** Desde dónde se mira. Es solo el punto de vista: no cambia nada de lo medido. */
const mirar = (v: V3, giro: number, alto: number): V3 => {
  const cg = Math.cos(giro), sg = Math.sin(giro);
  const x = v[0] * cg + v[2] * sg;
  const z0 = -v[0] * sg + v[2] * cg;
  const ca = Math.cos(alto), sa = Math.sin(alto);
  return [x, v[1] * ca - z0 * sa, v[1] * sa + z0 * ca];
};

/* Con fuga y no en plano: sin perspectiva las dos posiciones de pie —una
   mirando al parabrisas y otra al conductor— se dibujarían igual. */
const CAMARA = 640;
const ESCALA = 0.78;
const CENTRO: [number, number] = [130, 98];

const proyectar = (v: V3): [number, number, number] => {
  const k = CAMARA / (CAMARA - v[2]);
  return [CENTRO[0] + v[0] * k * ESCALA, CENTRO[1] - v[1] * k * ESCALA, k];
};

/** Lo lejano se ve más flojo. Es lo que da la sensación de fondo. */
const fuerza = (k: number) => Math.min(1, Math.max(0.32, (k - 0.68) * 1.6));

// ── El camión, en alambre ───────────────────────────────────────────────────

/* Ejes del camión: X a su derecha, Y hacia el techo, Z hacia el morro. El
   origen es el centro del camión, que es donde va dibujado el equipo. */
const caja = (x: number, y0: number, y1: number, z0: number, z1: number): [V3, V3][] => {
  const v: V3[] = [
    [-x, y0, z0], [x, y0, z0], [x, y1, z0], [-x, y1, z0],
    [-x, y0, z1], [x, y0, z1], [x, y1, z1], [-x, y1, z1],
  ];
  const p: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  return p.map(([a, b]) => [v[a], v[b]] as [V3, V3]);
};

/** Una rueda: un aro plano pegado al costado. */
const rueda = (x: number, y: number, z: number): [V3, V3][] => {
  const r = 17;
  const pts: V3[] = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    return [x, y + r * Math.sin(a), z + r * Math.cos(a)] as V3;
  });
  return pts.map((p, i) => [p, pts[(i + 1) % 12]] as [V3, V3]);
};

const TOLVA = caja(46, -18, 32, -108, 20);
const CABINA = caja(40, -18, 42, 24, 82);
const MORRO = caja(40, -18, 6, 82, 106);
const RUEDAS: [V3, V3][] = [
  ...rueda(48, -28, 84), ...rueda(-48, -28, 84),
  ...rueda(48, -28, -30), ...rueda(-48, -28, -30),
  ...rueda(48, -28, -72), ...rueda(-48, -28, -72),
];
/* Las rayas de la tolva: sin ellas el camión es una caja y no se sabe cuál es
   la parte de atrás cuando el morro queda escondido. */
const CARGA: [V3, V3][] = [-70, -40, -10].map(
  (z) => [[-46, 32, z], [46, 32, z]] as [V3, V3],
);
const FLECHA: [V3, V3][] = [
  [[0, 44, 114], [0, 44, 154]],
  [[0, 44, 154], [-9, 44, 141]],
  [[0, 44, 154], [9, 44, 141]],
];

const ALAMBRE: { lineas: [V3, V3][]; color: string; ancho: number }[] = [
  { lineas: TOLVA, color: 'var(--line2)', ancho: 1.9 },
  { lineas: CARGA, color: 'var(--line2)', ancho: 1.2 },
  { lineas: CABINA, color: 'var(--ink3)', ancho: 2.1 },
  { lineas: MORRO, color: 'var(--ink3)', ancho: 2.1 },
  { lineas: RUEDAS, color: 'var(--line2)', ancho: 1.6 },
];

// ── El equipo, macizo ───────────────────────────────────────────────────────

/* En ejes del equipo y sin girar nunca: es lo que se tiene delante. Va grande a
   propósito; a escala de verdad sería un sello dentro del camión. */
const ANCHO = 26, ALTO = 17, CANTO = 3.5;

const CARAS: { pts: V3[]; cara: 'pantalla' | 'espalda' | 'canto' }[] = [
  { cara: 'pantalla', pts: [[-ANCHO, -ALTO, CANTO], [ANCHO, -ALTO, CANTO], [ANCHO, ALTO, CANTO], [-ANCHO, ALTO, CANTO]] },
  { cara: 'espalda', pts: [[-ANCHO, -ALTO, -CANTO], [ANCHO, -ALTO, -CANTO], [ANCHO, ALTO, -CANTO], [-ANCHO, ALTO, -CANTO]] },
  { cara: 'canto', pts: [[-ANCHO, ALTO, -CANTO], [ANCHO, ALTO, -CANTO], [ANCHO, ALTO, CANTO], [-ANCHO, ALTO, CANTO]] },
  { cara: 'canto', pts: [[-ANCHO, -ALTO, -CANTO], [ANCHO, -ALTO, -CANTO], [ANCHO, -ALTO, CANTO], [-ANCHO, -ALTO, CANTO]] },
  { cara: 'canto', pts: [[ANCHO, -ALTO, -CANTO], [ANCHO, ALTO, -CANTO], [ANCHO, ALTO, CANTO], [ANCHO, -ALTO, CANTO]] },
  { cara: 'canto', pts: [[-ANCHO, -ALTO, -CANTO], [-ANCHO, ALTO, -CANTO], [-ANCHO, ALTO, CANTO], [-ANCHO, -ALTO, CANTO]] },
];

const RELLENO = {
  pantalla: 'rgb(var(--acc-rgb) / 0.30)',
  espalda: 'rgb(var(--sur3-rgb) / 0.92)',
  canto: 'rgb(var(--sur2-rgb) / 0.95)',
};

/** Dónde va el equipo dentro del camión: en el salpicadero, en la cabina. */
const SALPICADERO: V3 = [0, 12, 58];

/**
 * Lo que se queda quieto es el camión, y lo que gira dentro es el equipo.
 *
 * Al revés también era correcto —el equipo delante y el camión girando
 * alrededor, que es lo que se ve de verdad— pero se leía mal: el camión salía
 * en una postura distinta cada vez y había que reconocerlo antes de poder
 * comparar nada. Así el camión es siempre el mismo camión, el morro apunta
 * siempre al mismo sitio, y lo único que cambia entre las seis posiciones es
 * cómo queda puesto el equipo. Eso se ve de un vistazo.
 */
function Escena({ puesta, giro, alto }: { puesta: Posicion; giro: number; alto: number }) {
  const ver = (v: V3) => proyectar(mirar(v, giro, alto));

  /* Del equipo al camión: es el camino de vuelta de `colocar`, y en una matriz
     de giro la vuelta es la traspuesta, o sea los tres productos escalares. */
  const derecha = cruz(puesta.frente, puesta.techo);
  const girado = (v: V3): V3 => [
    derecha[0] * v[0] + derecha[1] * v[1] + derecha[2] * v[2],
    puesta.techo[0] * v[0] + puesta.techo[1] * v[1] + puesta.techo[2] * v[2],
    puesta.frente[0] * v[0] + puesta.frente[1] * v[1] + puesta.frente[2] * v[2],
  ];
  const enElCamion = (v: V3): V3 => {
    const g = girado(v);
    return [g[0] + SALPICADERO[0], g[1] + SALPICADERO[1], g[2] + SALPICADERO[2]];
  };

  /* Si la pantalla queda de espaldas, su marca no se dibuja: pintarla igual
     sería enseñar a través del aparato justo lo que no se ve. */
  const pantallaVisible = mirar(girado([0, 0, 1]), giro, alto)[2] > 0;

  /* Las caras se pintan de la más lejana a la más cercana: es lo único que
     necesita orden, y son seis. */
  const caras = CARAS.map((c) => {
    const p = c.pts.map((v) => mirar(enElCamion(v), giro, alto));
    const z = p.reduce((s, v) => s + v[2], 0) / p.length;
    return { ...c, z, xy: p.map(proyectar) };
  }).sort((a, b) => a.z - b.z);

  const puntaFlecha = ver([0, 44, 186]);
  /* El borde de arriba de la pantalla, marcado: es lo que distingue una
     posición tumbada de la de al lado. */
  const arribaPantalla: [V3, V3] = [
    enElCamion([-ANCHO * 0.62, ALTO, CANTO + 0.6]),
    enElCamion([ANCHO * 0.62, ALTO, CANTO + 0.6]),
  ];

  return (
    <>
      {/* El camión, transparente */}
      {ALAMBRE.map((grupo, g) =>
        grupo.lineas.map(([a, b], i) => {
          const p = ver(a);
          const q = ver(b);
          return (
            <line
              key={`${g}-${i}`}
              x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]}
              stroke={grupo.color}
              strokeWidth={grupo.ancho}
              strokeOpacity={fuerza((p[2] + q[2]) / 2)}
              strokeLinecap="round"
            />
          );
        }),
      )}

      {/* Por dónde sale el morro */}
      {FLECHA.map(([a, b], i) => {
        const p = ver(a);
        const q = ver(b);
        return (
          <line
            key={`f${i}`}
            x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]}
            stroke="var(--acc)" strokeWidth="2.6" strokeLinecap="round"
            strokeOpacity={fuerza((p[2] + q[2]) / 2)}
          />
        );
      })}
      <text
        x={puntaFlecha[0]} y={puntaFlecha[1]}
        textAnchor="middle" fontSize="10" fontWeight="700"
        fill="var(--acc)" letterSpacing="1.4"
      >
        FRENTE
      </text>

      {/* El equipo, macizo, para que se distinga de la radiografía */}
      {caras.map((c, i) => (
        <polygon
          key={i}
          points={c.xy.map((p) => `${p[0]},${p[1]}`).join(' ')}
          fill={RELLENO[c.cara]}
          stroke="var(--acc)"
          strokeWidth={c.cara === 'pantalla' ? 1.8 : 1}
          strokeOpacity={c.cara === 'pantalla' ? 1 : 0.45}
        />
      ))}

      {pantallaVisible && (() => {
        const p = ver(arribaPantalla[0]);
        const q = ver(arribaPantalla[1]);
        return (
          <line
            x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]}
            stroke="var(--acc)" strokeWidth="3" strokeLinecap="round"
          />
        );
      })()}

      {/* La leyenda va fija en la esquina y no pegada al equipo: pegada, en las
          posiciones de pie el rótulo caía justo encima y tapaba lo que nombra. */}
      <rect x="10" y="8" width="11" height="8" rx="2"
        fill="rgb(var(--acc-rgb) / 0.30)" stroke="var(--acc)" strokeWidth="1.2" />
      <text x="26" y="15.5" fontSize="8.5" fontWeight="600"
        fill="var(--ink3)" letterSpacing="1">
        EL EQUIPO
      </text>
    </>
  );
}

// ── El selector ─────────────────────────────────────────────────────────────

export function Montaje({
  eje, invertido, referencia, alCambiar,
}: {
  eje: Eje;
  invertido: boolean;
  referencia: { x: number; y: number; z: number } | null;
  alCambiar: (eje: Eje, invertido: boolean) => void;
}) {
  const puesta = posicionDe(eje, invertido);

  /* Un poco de lado y un poco desde arriba: de frente no se vería que hay
     fondo, y es justo el fondo lo que se quiere enseñar. */
  const [vista, setVista] = useState({ giro: 0.62, alto: 0.34 });
  const arrastre = useRef<{ x: number; y: number } | null>(null);

  const [avance, setAvance] = useState<number | null>(null);
  const [restan, setRestan] = useState(0);
  const [dictamen, setDictamen] = useState<string | null>(null);
  const muestras = useRef<number[][]>([]);

  /* Lo que marca el eje elegido, ahora mismo. Sin esto el dibujo es una
     promesa: se elige un lado y no hay forma de ver si acertó sin salir de
     esta pantalla, mirar el panel y volver. */
  useEffect(() => {
    const t = setInterval(() => {
      const c = movimiento.crudo();
      if (!c || !referencia) {
        setAvance(null);
        return;
      }
      const i = eje3(eje);
      const a = [c.ax, c.ay, c.az][i] - [referencia.x, referencia.y, referencia.z][i];
      setAvance(invertido ? -a : a);
    }, 200);
    return () => clearInterval(t);
  }, [eje, invertido, referencia]);

  const elegir = (p: Posicion) => {
    setDictamen(null);
    alCambiar(p.eje, p.invertido);
  };

  const girar = (sentido: 1 | -1) => {
    const i = VUELTA.indexOf(puesta.id);
    /* Viniendo de una posición de pie se entra por «arriba», que es de donde
       se sale al tumbar el equipo. */
    const sig = VUELTA[i < 0 ? 0 : (i + sentido + 4) % 4];
    elegir(POSICIONES.find((p) => p.id === sig)!);
  };

  /* La prueba de marcha: se acelera unos segundos y se mira en qué eje se
     notó. Se compara contra la referencia porque en cuesta la gravedad ya
     carga uno de los ejes, y sin restarla el resultado sería la pendiente y no
     la marcha. */
  const probar = () => {
    if (!referencia) {
      setDictamen('Primero hay que calibrar la referencia, aquí arriba.');
      return;
    }
    muestras.current = [];
    setDictamen(null);
    setRestan(Math.round(PRUEBA_MS / 1000));

    const cada = setInterval(() => {
      const c = movimiento.crudo();
      if (c) muestras.current.push([c.ax, c.ay, c.az]);
    }, 100);
    const reloj = setInterval(() => setRestan((s) => Math.max(0, s - 1)), 1000);

    setTimeout(() => {
      clearInterval(cada);
      clearInterval(reloj);
      setRestan(0);

      const n = muestras.current.length;
      if (n < 10) {
        setDictamen('No llegaron lecturas del sensor durante la prueba.');
        return;
      }
      const ref3 = [referencia.x, referencia.y, referencia.z];
      const medias = [0, 1, 2].map(
        (i) => muestras.current.reduce((s, m) => s + (m[i] - ref3[i]), 0) / n,
      );
      const gana = medias.reduce(
        (mejor, v, i) => (Math.abs(v) > Math.abs(medias[mejor]) ? i : mejor), 0,
      );

      /* Por debajo de esto no se aceleró: es ruido, y elegir un eje con ruido
         es peor que no tocar nada. */
      if (Math.abs(medias[gana]) < 0.6) {
        setDictamen(
          'No se notó ninguna aceleración clara. Hay que acelerar de verdad ' +
          'mientras dura la cuenta, y en llano.',
        );
        return;
      }

      const ejes: Eje[] = ['x', 'y', 'z'];
      const hallada = posicionDe(ejes[gana], medias[gana] < 0);
      alCambiar(hallada.eje, hallada.invertido);
      setDictamen(`Medido: el frente cae ${hallada.nombre.toLowerCase()}. Ya quedó puesto.`);
    }, PRUEBA_MS);
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-bg p-3.5">
      <div className="text-[11px] uppercase tracking-wide text-ink3">
        Dónde está el frente del camión
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <svg
          viewBox="0 0 260 190"
          className="h-[200px] w-full max-w-[330px] select-none"
          style={{ touchAction: 'none', cursor: arrastre.current ? 'grabbing' : 'grab' }}
          onPointerDown={(e) => {
            arrastre.current = { x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const a = arrastre.current;
            if (!a) return;
            const dx = e.clientX - a.x;
            const dy = e.clientY - a.y;
            arrastre.current = { x: e.clientX, y: e.clientY };
            setVista((v) => ({
              giro: v.giro + dx * 0.012,
              /* Sin llegar a la vertical: desde el cenit exacto el camión se
                 aplasta en una raya y no se entiende nada. */
              alto: Math.min(1.25, Math.max(-1.25, v.alto + dy * 0.012)),
            }));
          }}
          onPointerUp={() => { arrastre.current = null; }}
          onPointerCancel={() => { arrastre.current = null; }}
        >
          <Escena puesta={puesta} giro={vista.giro} alto={vista.alto} />
        </svg>

        <b className="text-center text-[13px] text-acc">{puesta.nombre}</b>
        <span className="text-center text-[11px] leading-snug text-ink3">{puesta.como}</span>
        <span className="text-center text-[10.5px] text-ink3 opacity-70">
          Arrastra el dibujo para mirarlo desde otro lado.
        </span>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <Boton onClick={() => girar(-1)}>↺ Girar</Boton>
        <Boton onClick={() => girar(1)}>Girar ↻</Boton>
        <Boton onClick={() => setVista({ giro: 0.62, alto: 0.34 })}>
          Enderezar vista
        </Boton>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {POSICIONES.filter((p) => p.eje === 'z').map((p) => (
          <Boton
            key={p.id}
            variante={puesta.id === p.id ? 'fuerte' : 'normal'}
            onClick={() => elegir(p)}
          >
            {p.id === 'detras' ? 'De pie, pantalla al conductor' : 'De pie, pantalla al frente'}
          </Boton>
        ))}
      </div>

      {/* ── La comprobación ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-sur2 px-3.5 py-2.5">
        <div className="min-w-0">
          <div className="rotulo">Al acelerar debe subir</div>
          <b className="tabular-nums text-[17px] text-ink">
            {avance === null ? '—' : avance.toFixed(2)}
          </b>
          <em className="ml-1 not-italic text-[11px] text-ink3">m/s²</em>
        </div>
        <Boton variante="fuerte" onClick={probar} disabled={restan > 0}>
          {restan > 0 ? `Acelera… ${restan}` : 'Medirlo acelerando'}
        </Boton>
      </div>

      {dictamen && (
        <Aviso tono={dictamen.startsWith('Medido') ? 'ok' : 'warn'}>{dictamen}</Aviso>
      )}

      <Nota>
        Si al elegir el lado ese número sube al acelerar y baja al frenar, está bien puesto. Si
        sale al revés, es el lado contrario; si apenas se mueve, es otro eje. El botón lo hace
        solo: púlsalo y acelera en llano mientras dura la cuenta.
      </Nota>
    </div>
  );
}
