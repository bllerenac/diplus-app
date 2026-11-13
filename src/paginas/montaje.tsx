/**
 * Cómo va puesto el equipo dentro del camión, en tres dimensiones.
 *
 * La inclinación la pone el acelerómetro solo; la persona únicamente gira
 * hasta que la flecha apunte al frente, o lo mide acelerando.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Postura, V3, avanceDe, comoEsta, conTecho, cruz, frenteMedido, girarPostura, movimiento,
  pararPostura,
} from '../nucleo/movimiento';
import { Boton, Aviso, Nota } from './piezas';

/** Cada toque de girar. Lo fino lo deja la prueba de marcha. */
const SALTO = 45;

/** Cuánto dura la prueba de marcha. Corta: acelerar cinco segundos ya se nota. */
const PRUEBA_MS = 5000;

// ── Las tres dimensiones, con lo justo ──────────────────────────────────────

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
const CAMARA = 700;
const ESCALA = 0.74;
const CENTRO: [number, number] = [158, 88];
const LIENZO: [number, number] = [300, 186];

const proyectar = (v: V3): [number, number, number] => {
  const k = CAMARA / (CAMARA - v[2]);
  return [CENTRO[0] + v[0] * k * ESCALA, CENTRO[1] - v[1] * k * ESCALA, k];
};

/** Lo lejano se ve más flojo. Es lo que da la sensación de fondo. */
const fuerza = (k: number) => Math.min(1, Math.max(0.3, (k - 0.66) * 1.55));

// ── El giro del equipo, y cómo se anima ─────────────────────────────────────

type Cuat = [number, number, number, number];

/**
 * La postura, en cuaternión.
 *
 * Se guarda así y no como tres ejes sueltos para poder **interpolar** entre dos
 * posiciones: entre dos cuaterniones hay un camino corto y único, mientras que
 * interpolar matrices casilla a casilla deforma el aparato por el camino.
 *
 * La primera fila es la izquierda del camión: en el dibujo la X crece hacia su
 * izquierda (el morro viene hacia quien mira), y así la matriz es un giro de
 * verdad, sin espejo.
 */
const cuaternion = (p: Postura): Cuat => {
  const d = cruz(p.frente, p.techo);
  /* Por filas, que es la vuelta —del equipo al camión— y es la que se aplica. */
  const m = [
    [-d[0], -d[1], -d[2]],
    [p.techo[0], p.techo[1], p.techo[2]],
    [p.frente[0], p.frente[1], p.frente[2]],
  ];
  const traza = m[0][0] + m[1][1] + m[2][2];
  if (traza > 0) {
    const s = Math.sqrt(traza + 1) * 2;
    return [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, s / 4];
  }
  if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    return [s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s];
  }
  if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    return [(m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s];
  }
  const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
  return [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4, (m[1][0] - m[0][1]) / s];
};

/** Girar un punto del equipo a los ejes del camión. */
const conCuat = (q: Cuat, v: V3): V3 => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
};

/** El camino corto entre dos posturas. */
const entre = (a: Cuat, b: Cuat, t: number): Cuat => {
  let punto = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  /* Un cuaternión y su opuesto son la misma postura; sin este cambio de signo
     el equipo daría la vuelta larga, de trescientos grados. */
  const fin: Cuat = punto < 0 ? [-b[0], -b[1], -b[2], -b[3]] : b;
  punto = Math.abs(punto);

  let ka = 1 - t, kb = t;
  if (punto < 0.9995) {
    const o = Math.acos(Math.min(1, punto));
    const so = Math.sin(o);
    ka = Math.sin((1 - t) * o) / so;
    kb = Math.sin(t * o) / so;
  }
  const q: Cuat = [
    a[0] * ka + fin[0] * kb, a[1] * ka + fin[1] * kb,
    a[2] * ka + fin[2] * kb, a[3] * ka + fin[3] * kb,
  ];
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
};

const GIRO_MS = 420;

// ── El camión, en alambre ───────────────────────────────────────────────────

/* Ejes del camión: X a su izquierda, Y hacia el techo, Z hacia el morro. El
   origen es el centro del camión; el suelo queda en y = -46. */
type Linea = [V3, V3];

const caja = (x: number, y0: number, y1: number, z0: number, z1: number): Linea[] => {
  const v: V3[] = [
    [-x, y0, z0], [x, y0, z0], [x, y1, z0], [-x, y1, z0],
    [-x, y0, z1], [x, y0, z1], [x, y1, z1], [-x, y1, z1],
  ];
  const p: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  return p.map(([a, b]) => [v[a], v[b]] as Linea);
};

/** Una rueda de verdad: dos aros y los radios que los unen. */
const rueda = (x: number, z: number): Linea[] => {
  const r = 21, y = -25, ancho = 9, n = 10;
  const aro = (xx: number): V3[] =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return [xx, y + r * Math.sin(a), z + r * Math.cos(a)] as V3;
    });
  const dentro = aro(x - Math.sign(x) * ancho);
  const fuera = aro(x);
  const l: Linea[] = [];
  for (let i = 0; i < n; i += 1) {
    l.push([fuera[i], fuera[(i + 1) % n]]);
    l.push([dentro[i], dentro[(i + 1) % n]]);
    if (i % 2 === 0) l.push([dentro[i], fuera[i]]);
  }
  return l;
};

/* Un volquete de mina, no un camión cualquiera: tolva alta atrás, marquesina
   volando por encima de la cabina y ruedas más altas que la propia cabina. Es
   lo que se reconoce sin leer nada. */
const CHASIS = caja(38, -26, -14, -96, 92);
const TOLVA = caja(48, -14, 34, -106, 26);
const CABINA = caja(30, -14, 24, 34, 82);
const MORRO = caja(32, -18, 4, 82, 104);

/** La marquesina: la visera que sale de la tolva y vuela sobre la cabina. */
const MARQUESINA: Linea[] = [
  [[-48, 34, 26], [-40, 48, 100]], [[48, 34, 26], [40, 48, 100]],
  [[-40, 48, 100], [40, 48, 100]],
  [[-44, 41, 63], [44, 41, 63]],
  [[-40, 48, 100], [-30, 24, 82]], [[40, 48, 100], [30, 24, 82]],
];

/** El parabrisas, para saber por dónde mira quien conduce. */
const PARABRISAS: Linea[] = [
  [[-24, -2, 82], [24, -2, 82]], [[24, -2, 82], [24, 18, 82]],
  [[24, 18, 82], [-24, 18, 82]], [[-24, 18, 82], [-24, -2, 82]],
];

/* Las rayas de la tolva: sin ellas el camión es una caja y no se sabe cuál es
   la parte de atrás cuando el morro queda escondido. */
const CARGA: Linea[] = [-76, -48, -20].map(
  (z) => [[-48, 34, z], [48, 34, z]] as Linea,
);

const RUEDAS: Linea[] = [
  ...rueda(48, 78), ...rueda(-48, 78),
  ...rueda(48, -34), ...rueda(-48, -34),
  ...rueda(48, -74), ...rueda(-48, -74),
];

const FLECHA: Linea[] = [
  [[0, 58, 116], [0, 58, 154]],
  [[0, 58, 154], [-9, 58, 141]], [[0, 58, 154], [9, 58, 141]],
];

/** El suelo, en cuadrícula. Es lo que hace que se vea que hay fondo. */
const SUELO: Linea[] = [
  ...[-100, -50, 0, 50, 100].map((x) => [[x, -46, -120], [x, -46, 130]] as Linea),
  ...[-120, -58, 4, 66, 130].map((z) => [[-100, -46, z], [100, -46, z]] as Linea),
];

const ALAMBRE: { lineas: Linea[]; color: string; ancho: number; op?: number }[] = [
  { lineas: SUELO, color: 'var(--line)', ancho: 1, op: 0.5 },
  { lineas: CHASIS, color: 'var(--line2)', ancho: 1.4 },
  { lineas: TOLVA, color: 'var(--line2)', ancho: 1.8 },
  { lineas: CARGA, color: 'var(--line2)', ancho: 1.1, op: 0.7 },
  { lineas: MARQUESINA, color: 'var(--line2)', ancho: 1.6 },
  { lineas: RUEDAS, color: 'var(--line2)', ancho: 1.3 },
  { lineas: CABINA, color: 'var(--ink3)', ancho: 2 },
  { lineas: MORRO, color: 'var(--ink3)', ancho: 1.8 },
  { lineas: PARABRISAS, color: 'var(--ink3)', ancho: 1.4, op: 0.8 },
];

// ── El equipo, macizo ───────────────────────────────────────────────────────

/* Va grande a propósito; a escala de verdad sería un sello dentro del camión. */
const ANCHO = 21, ALTO = 14, CANTO = 2.6;

const CARAS: { pts: V3[]; cara: 'pantalla' | 'espalda' | 'canto' }[] = [
  { cara: 'pantalla', pts: [[-ANCHO, -ALTO, CANTO], [ANCHO, -ALTO, CANTO], [ANCHO, ALTO, CANTO], [-ANCHO, ALTO, CANTO]] },
  { cara: 'espalda', pts: [[-ANCHO, -ALTO, -CANTO], [ANCHO, -ALTO, -CANTO], [ANCHO, ALTO, -CANTO], [-ANCHO, ALTO, -CANTO]] },
  { cara: 'canto', pts: [[-ANCHO, ALTO, -CANTO], [ANCHO, ALTO, -CANTO], [ANCHO, ALTO, CANTO], [-ANCHO, ALTO, CANTO]] },
  { cara: 'canto', pts: [[-ANCHO, -ALTO, -CANTO], [ANCHO, -ALTO, -CANTO], [ANCHO, -ALTO, CANTO], [-ANCHO, -ALTO, CANTO]] },
  { cara: 'canto', pts: [[ANCHO, -ALTO, -CANTO], [ANCHO, ALTO, -CANTO], [ANCHO, ALTO, CANTO], [ANCHO, -ALTO, CANTO]] },
  { cara: 'canto', pts: [[-ANCHO, -ALTO, -CANTO], [-ANCHO, ALTO, -CANTO], [-ANCHO, ALTO, CANTO], [-ANCHO, -ALTO, CANTO]] },
];

/** El cristal, dentro del marco: es lo que hace que se lea como una pantalla. */
const CRISTAL: V3[] = [
  [-ANCHO * 0.82, -ALTO * 0.74, CANTO + 0.4], [ANCHO * 0.82, -ALTO * 0.74, CANTO + 0.4],
  [ANCHO * 0.82, ALTO * 0.74, CANTO + 0.4], [-ANCHO * 0.82, ALTO * 0.74, CANTO + 0.4],
];

/** El borde de arriba de la pantalla: distingue una tumbada de la de al lado. */
const CANTO_ALTO: Linea = [
  [-ANCHO * 0.6, ALTO + 0.8, CANTO], [ANCHO * 0.6, ALTO + 0.8, CANTO],
];

const RELLENO = {
  pantalla: 'rgb(var(--sur3-rgb) / 0.96)',
  espalda: 'rgb(var(--sur2-rgb) / 0.96)',
  canto: 'rgb(var(--sur3-rgb) / 0.96)',
};

/** Dónde va el equipo dentro del camión: en el salpicadero, en la cabina. */
const SALPICADERO: V3 = [0, 6, 62];

// ── El chivato: el equipo solo, con sus ejes ────────────────────────────────

/**
 * El mismo aparato, en grande y aparte, con una flecha hacia el frente del
 * camión: dentro de la cabina sale pequeño y tapado por el alambre.
 */
const CHIVATO = { x: 4, y: 92, ancho: 100, alto: 90, escala: 0.9, largo: 32 };
const CHIVATO_C: [number, number] = [
  CHIVATO.x + CHIVATO.ancho / 2, CHIVATO.y + 38,
];

function Escena({ postura, giro, alto }: { postura: Cuat; giro: number; alto: number }) {
  const ver = (v: V3) => proyectar(mirar(v, giro, alto));

  /* El camión no depende de la postura del equipo: solo del punto de vista. Se
     rehace al arrastrar y no en cada cuadro del giro, que son ciento y pico
     líneas y esto es un WebView de 2019. */
  const camion = useMemo(
    () =>
      ALAMBRE.flatMap((grupo, g) =>
        grupo.lineas.map(([a, b], i) => {
          const p = proyectar(mirar(a, giro, alto));
          const q = proyectar(mirar(b, giro, alto));
          return (
            <line
              key={`${g}-${i}`}
              x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]}
              stroke={grupo.color}
              strokeWidth={grupo.ancho}
              strokeOpacity={fuerza((p[2] + q[2]) / 2) * (grupo.op ?? 1)}
              strokeLinecap="round"
            />
          );
        }),
      ),
    [giro, alto],
  );

  const girado = (v: V3): V3 => conCuat(postura, v);
  const enElCamion = (v: V3): V3 => {
    const g = girado(v);
    return [g[0] + SALPICADERO[0], g[1] + SALPICADERO[1], g[2] + SALPICADERO[2]];
  };

  /* Las caras se pintan de la más lejana a la más cercana: es lo único que
     necesita orden, y son seis. */
  const caras = CARAS.map((c) => {
    const p = c.pts.map((v) => mirar(enElCamion(v), giro, alto));
    const z = p.reduce((s, v) => s + v[2], 0) / p.length;
    return { ...c, z, xy: p.map(proyectar) };
  }).sort((a, b) => a.z - b.z);

  /* Si la pantalla queda de espaldas, ni el cristal ni la marca del borde se
     dibujan: pintarlos sería enseñar a través del aparato lo que no se ve. */
  const daLaCara = mirar(girado([0, 0, 1]), giro, alto)[2] > 0;
  const cristal = CRISTAL.map((v) => ver(enElCamion(v)));
  const marca = CANTO_ALTO.map((v) => ver(enElCamion(v)));

  const puntaFlecha = ver([0, 92, 140]);
  const sombra = Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * Math.PI * 2;
    return ver([Math.cos(a) * 96, -45.5, -8 + Math.sin(a) * 108]);
  });

  const puntos = (l: [number, number, number][]) =>
    l.map((p) => `${p[0]},${p[1]}`).join(' ');

  // ── El chivato ──────────────────────────────────────────────────────────
  /* Sin fuga y en su propio centro: aquí no se trata de situar el aparato en
     ningún sitio, solo de verle la postura, y la perspectiva solo estorbaría. */
  const alChivato = (v: V3): [number, number, number] => {
    const m = mirar(v, giro, alto);
    return [CHIVATO_C[0] + m[0] * CHIVATO.escala, CHIVATO_C[1] - m[1] * CHIVATO.escala, m[2]];
  };
  const enChivato = (v: V3) => alChivato(girado(v));

  const carasChivato = CARAS.map((c) => {
    const p = c.pts.map((v) => mirar(girado(v), giro, alto));
    const z = p.reduce((s, v) => s + v[2], 0) / p.length;
    return { ...c, z, xy: c.pts.map(enChivato) };
  }).sort((a, b) => a.z - b.z);

  /* La flecha va en ejes del camión: queda quieta y el equipo gira debajo. */
  const ejes = [{ color: 'var(--warn)', letra: 'FRENTE' }].map((e) => {
    const o = alChivato([0, 0, 0]);
    const p = alChivato([0, 0, CHIVATO.largo]);
    const dx = p[0] - o[0], dy = p[1] - o[1];
    const largo = Math.hypot(dx, dy);
    /* Si apunta a la cámara se proyecta en un punto: se dibuja como diana,
       llena si viene hacia quien mira y hueca si se va. */
    const deFrente = largo < 4;
    const ux = largo > 0.001 ? dx / largo : 0;
    const uy = largo > 0.001 ? dy / largo : 0;
    const dentro = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
    return {
      ...e, o, p, deFrente,
      viene: p[2] >= o[2],
      punta: `${p[0]},${p[1]} ${p[0] - ux * 6.5 - uy * 3},${p[1] - uy * 6.5 + ux * 3} ` +
             `${p[0] - ux * 6.5 + uy * 3},${p[1] - uy * 6.5 - ux * 3}`,
      rotulo: [
        dentro(p[0] + ux * 12 + (deFrente ? 16 : 0), CHIVATO.x + 16, CHIVATO.x + CHIVATO.ancho - 16),
        dentro(p[1] + uy * 10 + 3, CHIVATO.y + 10, CHIVATO.y + CHIVATO.alto - 18),
      ],
    };
  });

  const ejeDibujado = (e: (typeof ejes)[number]) => (
    <g key={e.letra}>
      {e.deFrente ? (
        <circle
          cx={e.p[0]} cy={e.p[1]} r="4"
          fill={e.viene ? e.color : 'none'} stroke={e.color} strokeWidth="1.6"
        />
      ) : (
        <>
          <line
            x1={e.o[0]} y1={e.o[1]} x2={e.p[0]} y2={e.p[1]}
            stroke={e.color} strokeWidth="1.8" strokeLinecap="round"
            strokeOpacity={e.viene ? 1 : 0.45}
          />
          <polygon points={e.punta} fill={e.color} fillOpacity={e.viene ? 1 : 0.45} />
        </>
      )}
      <text
        x={e.rotulo[0]} y={e.rotulo[1]}
        textAnchor="middle" fontSize="8.5" fontWeight="700" fill={e.color}
        fillOpacity={e.viene || e.deFrente ? 1 : 0.5}
      >
        {e.letra}
      </text>
    </g>
  );

  return (
    <>
      <defs>
        <radialGradient id="mtj-sombra">
          <stop offset="0%" stopColor="var(--acc)" stopOpacity="0.11" />
          <stop offset="100%" stopColor="var(--acc)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* El suelo bajo el camión: sin algo debajo, el camión flota */}
      <polygon points={puntos(sombra)} fill="url(#mtj-sombra)" />

      {camion}

      {/* Por dónde sale el morro */}
      {FLECHA.map(([a, b], i) => {
        const p = ver(a);
        const q = ver(b);
        return (
          <line
            key={`f${i}`}
            x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]}
            stroke="var(--acc)" strokeWidth="2.4" strokeLinecap="round"
            strokeOpacity={fuerza((p[2] + q[2]) / 2)}
          />
        );
      })}
      <text
        x={puntaFlecha[0]} y={puntaFlecha[1]}
        textAnchor="middle" fontSize="9.5" fontWeight="700"
        fill="var(--acc)" letterSpacing="1.6"
      >
        FRENTE
      </text>

      {/* El equipo, macizo, para que se distinga de la radiografía */}
      {caras.map((c, i) => (
        <polygon
          key={i}
          points={puntos(c.xy)}
          fill={RELLENO[c.cara]}
          stroke="var(--acc)"
          strokeWidth={c.cara === 'pantalla' ? 1.6 : 0.9}
          strokeOpacity={c.cara === 'pantalla' ? 0.95 : 0.4}
          strokeLinejoin="round"
        />
      ))}

      {daLaCara && (
        <>
          <polygon points={puntos(cristal)} fill="rgb(var(--acc-rgb) / 0.34)" />
          <line
            x1={marca[0][0]} y1={marca[0][1]} x2={marca[1][0]} y2={marca[1][1]}
            stroke="var(--acc)" strokeWidth="2.6" strokeLinecap="round"
          />
        </>
      )}

      {/* ── El chivato, abajo a la izquierda ──────────────────────────── */}
      <rect
        x={CHIVATO.x} y={CHIVATO.y} width={CHIVATO.ancho} height={CHIVATO.alto} rx="8"
        fill="var(--bg)" fillOpacity="0.92" stroke="var(--line)" strokeWidth="1"
      />
      {/* Los ejes que se van por detrás, antes que el aparato; los que vienen
          hacia quien mira, después. Es todo el orden que hace falta. */}
      {ejes.filter((e) => !e.viene).map(ejeDibujado)}

      {carasChivato.map((c, i) => (
        <polygon
          key={`c${i}`}
          points={puntos(c.xy)}
          fill={RELLENO[c.cara]}
          stroke="var(--acc)"
          strokeWidth={c.cara === 'pantalla' ? 1.4 : 0.8}
          strokeOpacity={c.cara === 'pantalla' ? 0.95 : 0.4}
          strokeLinejoin="round"
        />
      ))}

      {daLaCara && (
        <>
          <polygon
            points={puntos(CRISTAL.map(enChivato))}
            fill="rgb(var(--acc-rgb) / 0.38)"
          />
          {(() => {
            const [a, b] = CANTO_ALTO.map(enChivato);
            return (
              <line
                x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
                stroke="var(--acc)" strokeWidth="2.4" strokeLinecap="round"
              />
            );
          })()}
        </>
      )}

      {ejes.filter((e) => e.viene).map(ejeDibujado)}

      {/* Dicho con todas las letras, que es lo único que no se puede confundir */}
      <rect x={CHIVATO.x + 9} y={CHIVATO.y + CHIVATO.alto - 14} width="11" height="7.5" rx="1.5"
        fill="rgb(var(--acc-rgb) / 0.38)" stroke="var(--acc)" strokeWidth="1" />
      <text x={CHIVATO.x + 24} y={CHIVATO.y + CHIVATO.alto - 8} fontSize="7.5" fontWeight="700"
        fill="var(--acc)" letterSpacing="0.8">
        LA PANTALLA {daLaCara ? '' : '· detrás'}
      </text>
    </>
  );
}

// ── El selector ─────────────────────────────────────────────────────────────

const VISTA_INICIAL = { giro: 0.62, alto: 0.34 };

export function Montaje({
  puesta, referencia, alCambiar,
}: {
  puesta: Postura;
  referencia: { x: number; y: number; z: number } | null;
  alCambiar: (p: Postura) => void;
}) {
  /* La gravedad de ahora, suavizada: el dibujo queda como está el equipo. */
  const [gravedad, setGravedad] = useState<V3 | null>(null);
  const mostrada = gravedad ? conTecho(puesta, gravedad) : puesta;
  /* Por valor y redondeada: llega como objeto nuevo en cada pintado y la
     gravedad tiembla. */
  const clave = [...mostrada.frente, ...mostrada.techo].map((v) => v.toFixed(2)).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const destino = useMemo(() => cuaternion(mostrada), [clave]);
  const como = comoEsta(mostrada);
  const claveFrente = puesta.frente.join(',');

  /* Un poco de lado y un poco desde arriba: de frente no se vería que hay
     fondo, y es justo el fondo lo que se quiere enseñar. */
  const [vista, setVista] = useState(VISTA_INICIAL);
  const arrastre = useRef<{ x: number; y: number } | null>(null);

  const [postura, setPostura] = useState<Cuat>(destino);
  const ahora = useRef<Cuat>(destino);

  /* El giro, cuadro a cuadro. Con una curva suave a los dos lados: arrancar y
     frenar de golpe se lee como un salto, que es justo lo que se evita. */
  useEffect(() => {
    const desde = ahora.current;
    const t0 = Date.now();
    let pedido = 0;

    const paso = () => {
      const t = Math.min(1, (Date.now() - t0) / GIRO_MS);
      const s = t < 0.5 ? 2 * t * t : 1 - ((2 - 2 * t) ** 2) / 2;
      ahora.current = entre(desde, destino, s);
      setPostura(ahora.current);
      if (t < 1) pedido = requestAnimationFrame(paso);
    };
    pedido = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(pedido);
  }, [destino]);

  const [avance, setAvance] = useState<number | null>(null);
  const [restan, setRestan] = useState(0);
  const [dictamen, setDictamen] = useState<string | null>(null);
  const muestras = useRef<number[][]>([]);

  /* La postura del sensor y lo que marca el frente elegido, ahora mismo. */
  useEffect(() => {
    const t = setInterval(() => {
      const c = movimiento.crudo();
      if (!c) {
        setAvance(null);
        return;
      }
      setGravedad((g) => (g
        ? [g[0] * 0.8 + c.ax * 0.2, g[1] * 0.8 + c.ay * 0.2, g[2] * 0.8 + c.az * 0.2]
        : [c.ax, c.ay, c.az]));
      setAvance(referencia ? avanceDe(
        [c.ax, c.ay, c.az], [referencia.x, referencia.y, referencia.z], puesta.frente,
      ) : null);
    }, 200);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveFrente, referencia]);

  const cambiar = (p: Postura) => {
    setDictamen(null);
    alCambiar(p);
  };

  /* La prueba de marcha: se acelera unos segundos y se mira hacia dónde se
     notó, contra la referencia para que la cuesta no cuente como marcha. */
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
      const ref3: V3 = [referencia.x, referencia.y, referencia.z];
      const media = [0, 1, 2].map(
        (i) => muestras.current.reduce((s, m) => s + (m[i] - ref3[i]), 0) / n,
      ) as V3;
      const hallada = frenteMedido(media, ref3);
      if (!hallada) {
        setDictamen(
          'No se notó ninguna aceleración clara. Hay que acelerar de verdad ' +
          'mientras dura la cuenta, y en llano.',
        );
        return;
      }
      alCambiar(hallada);
      setDictamen('Medido: la flecha ya apunta a donde aceleró.');
    }, PRUEBA_MS);
  };

  return (
    <div className="flex flex-col gap-3.5 rounded-2xl border border-line bg-bg p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="rotulo">Dónde está el frente del camión</span>
        <button
          type="button"
          onClick={() => setVista(VISTA_INICIAL)}
          className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink3"
        >
          Enderezar vista
        </button>
      </div>

      {/* El escenario, en su propio hueco: el dibujo necesita un fondo que lo
          separe del formulario, o se lee como un adorno del bloque de al lado.
          Va limitado y centrado: a todo lo ancho de la columna el camión salía
          enorme y el bloque no cabía de una vez en la pantalla. */}
      <div className="relative mx-auto w-full max-w-[380px] overflow-hidden rounded-xl border border-line bg-sur2">
        <svg
          viewBox={`0 0 ${LIENZO[0]} ${LIENZO[1]}`}
          className="block w-full select-none"
          style={{ touchAction: 'none' }}
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
              alto: Math.min(1.2, Math.max(-0.35, v.alto + dy * 0.012)),
            }));
          }}
          onPointerUp={() => { arrastre.current = null; }}
          onPointerCancel={() => { arrastre.current = null; }}
        >
          <Escena postura={postura} giro={vista.giro} alto={vista.alto} />
        </svg>

        <span className="pointer-events-none absolute bottom-2 right-3 font-mono text-[9px] uppercase tracking-[0.1em] text-ink3 opacity-60">
          arrastra para girar la vista
        </span>
      </div>

      <div className="text-center">
        <b className="text-[15px] text-acc">{como.nombre}</b>
        <p className="m-0 mt-0.5 text-[11.5px] leading-snug text-ink3">
          Pantalla a {como.grados}° del piso
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Boton className="w-full" onClick={() => cambiar(girarPostura(mostrada, SALTO))}>
          ↺ Girar
        </Boton>
        <Boton className="w-full" onClick={() => cambiar(girarPostura(mostrada, -SALTO))}>
          Girar ↻
        </Boton>
        {/* Sin sensor (en la PC) no hay quien diga cómo está: se pone a mano. */}
        {!gravedad && (
          <>
            <Boton className="w-full" onClick={() => cambiar(pararPostura(mostrada, SALTO))}>
              ↑ Parar
            </Boton>
            <Boton className="w-full" onClick={() => cambiar(pararPostura(mostrada, -SALTO))}>
              Acostar ↓
            </Boton>
          </>
        )}
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
        La inclinación la pone el sensor. Gira hasta que la flecha apunte al frente del camión,
        o pulsa «Medirlo acelerando» y acelera en llano.
      </Nota>
    </div>
  );
}
