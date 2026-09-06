/**
 * Dónde está el frente del camión, señalándolo en un dibujo.
 *
 * Antes esto era un desplegable con «X / Y / Z» y un interruptor para invertir.
 * Eso es correcto y es ilegible: nadie que monte un equipo en una cabina sabe
 * hacia dónde cae la Y del acelerómetro, y acertar a la primera es cuestión de
 * suerte. Aquí se elige señalando: se gira el camión alrededor del equipo hasta
 * que el dibujo se parezca a cómo quedó instalado.
 *
 * Son seis posiciones y no más, porque el acelerómetro solo tiene tres ejes y
 * cada uno se puede mirar en dos sentidos. Cuatro son con el equipo tumbado
 * —se ve desde arriba, y el camión gira— y dos con el equipo de pie —se ve
 * desde el costado, y lo que cambia es hacia dónde mira la pantalla—.
 *
 * Aun así el dibujo es una intención, no una medida. Lo que de verdad lo
 * confirma es acelerar: por eso está el botón que mira unos segundos de marcha
 * y elige el eje solo. El dibujo dice lo que se cree; la prueba dice lo que es.
 */
import { useEffect, useRef, useState } from 'react';
import { Eje, movimiento } from '../nucleo/movimiento';
import { Boton, Aviso, Nota } from './piezas';

type Lado = 'arriba' | 'derecha' | 'abajo' | 'izquierda' | 'fuera' | 'detras';

interface Posicion {
  id: Lado;
  eje: Eje;
  invertido: boolean;
  nombre: string;
  /** Cómo queda el equipo puesto así, dicho para quien lo está montando. */
  como: string;
}

const POSICIONES: Posicion[] = [
  { id: 'arriba', eje: 'y', invertido: false,
    nombre: 'Hacia arriba de la pantalla',
    como: 'Tumbado, y el borde de arriba de la pantalla mira al frente.' },
  { id: 'derecha', eje: 'x', invertido: false,
    nombre: 'Hacia la derecha',
    como: 'Tumbado, y el borde derecho de la pantalla mira al frente.' },
  { id: 'abajo', eje: 'y', invertido: true,
    nombre: 'Hacia abajo de la pantalla',
    como: 'Tumbado, y el borde de abajo de la pantalla mira al frente.' },
  { id: 'izquierda', eje: 'x', invertido: true,
    nombre: 'Hacia la izquierda',
    como: 'Tumbado, y el borde izquierdo de la pantalla mira al frente.' },
  { id: 'detras', eje: 'z', invertido: true,
    nombre: 'Por la espalda del equipo',
    como: 'De pie, con la pantalla mirando al conductor. Es lo más común.' },
  { id: 'fuera', eje: 'z', invertido: false,
    nombre: 'Por la pantalla',
    como: 'De pie, con la pantalla mirando al parabrisas.' },
];

/** Las cuatro tumbadas, en el orden en que las recorre el botón de girar. */
const VUELTA: Lado[] = ['arriba', 'derecha', 'abajo', 'izquierda'];

const GIROS: Record<string, number> = {
  arriba: 0, derecha: 90, abajo: 180, izquierda: 270,
};

const posicionDe = (eje: Eje, invertido: boolean): Posicion =>
  POSICIONES.find((p) => p.eje === eje && p.invertido === invertido) ?? POSICIONES[0];

const eje3 = (e: Eje) => (e === 'x' ? 0 : e === 'y' ? 1 : 2);

/** Cuánto dura la prueba de marcha. Corta: acelerar cinco segundos ya se nota. */
const PRUEBA_MS = 5000;

// ── El dibujo ───────────────────────────────────────────────────────────────

/**
 * El camión visto desde arriba, con el morro hacia el borde de arriba.
 *
 * Va encogido a propósito: el aro de fuera es donde se toca para elegir lado, y
 * con el camión a tamaño completo las flechas caían encima del parabrisas y
 * parecían parte del dibujo en vez de un botón.
 */
const CamionDeArriba = ({ giro }: { giro: number }) => (
  <g
    transform={`rotate(${giro} 130 130) translate(130 130) scale(0.72) translate(-130 -130)`}
    style={{ transition: 'transform .35s ease-out' }}
  >
    {/* la tolva */}
    <rect x="66" y="118" width="128" height="112" rx="10"
      fill="var(--sur3)" stroke="var(--line2)" strokeWidth="2" />
    <path d="M78 140 H182 M78 162 H182 M78 184 H182"
      stroke="var(--line2)" strokeWidth="1.5" opacity="0.7" />
    {/* la cabina */}
    <rect x="76" y="52" width="108" height="72" rx="12"
      fill="var(--sur2)" stroke="var(--line2)" strokeWidth="2" />
    {/* el parabrisas, que es lo que mira al frente */}
    <rect x="88" y="60" width="84" height="26" rx="6"
      fill="var(--bg)" stroke="var(--line2)" strokeWidth="1.5" />
    {/* las ruedas */}
    {[[52, 72], [192, 72], [52, 148], [192, 148], [52, 184], [192, 184]].map(([x, y], i) => (
      <rect key={i} x={x} y={y} width="16" height="30" rx="5"
        fill="var(--ink3)" opacity="0.55" />
    ))}
    {/* el morro, marcado. Redondo y no en punta: en punta se confundía con la
        flecha de tocar que va justo encima, y parecían dos flechas. */}
    <path d="M100 46 Q130 10 160 46 Z" fill="var(--acc)" opacity="0.85" />
    <text x="130" y="10" textAnchor="middle" fontSize="10.5" fontWeight="700"
      fill="var(--acc)" letterSpacing="1.5">FRENTE</text>
  </g>
);

/** El camión visto de costado, con el morro a la derecha. */
const CamionDeLado = () => (
  <g>
    <rect x="26" y="128" width="112" height="66" rx="8"
      fill="var(--sur3)" stroke="var(--line2)" strokeWidth="2" />
    <path d="M138 194 H198 V146 Q198 128 180 128 H142 Z"
      fill="var(--sur2)" stroke="var(--line2)" strokeWidth="2" />
    <rect x="164" y="138" width="28" height="30" rx="5"
      fill="var(--bg)" stroke="var(--line2)" strokeWidth="1.5" />
    {[54, 98, 170].map((x) => (
      <circle key={x} cx={x} cy="200" r="17" fill="var(--ink3)" opacity="0.55" />
    ))}
    <path d="M212 162 L242 162 M233 153 L243 162 L233 171"
      stroke="var(--acc)" strokeWidth="3" fill="none" strokeLinecap="round" />
    <text x="228" y="146" textAnchor="middle" fontSize="10" fontWeight="700"
      fill="var(--acc)" letterSpacing="1">FRENTE</text>
  </g>
);

/** El equipo. Tumbado se le ve la pantalla; de pie se le ve el canto. */
const Equipo = ({ dePie, alFrente }: { dePie: boolean; alFrente?: boolean }) => {
  if (!dePie) {
    return (
      <g>
        <rect x="92" y="100" width="76" height="58" rx="7"
          fill="var(--sur)" stroke="var(--acc)" strokeWidth="2.5" />
        <rect x="98" y="108" width="64" height="42" rx="3" fill="var(--bg)" />
        <circle cx="130" cy="104" r="1.8" fill="var(--ink3)" />
        <text x="130" y="134" textAnchor="middle" fontSize="9" fontWeight="600"
          fill="var(--ink3)" letterSpacing="1">EL EQUIPO</text>
      </g>
    );
  }
  /* De pie se ve el canto, y la cara de la pantalla se marca del lado al que
     mira: eso es justo lo que distingue las dos posiciones de pie. */
  return (
    <g>
      {/* Dentro de la cabina, no flotando sobre el techo: es donde va de verdad. */}
      <rect x="146" y="136" width="14" height="52" rx="3"
        fill="var(--sur)" stroke="var(--acc)" strokeWidth="2.5" />
      {/* La cara de la pantalla, marcada del lado al que mira: es lo único que
          distingue las dos posiciones de pie. */}
      <rect x={alFrente ? 155 : 147} y="140" width="4" height="44" rx="2" fill="var(--acc)" />
      <text x="153" y="122" textAnchor="middle" fontSize="9" fontWeight="600"
        fill="var(--ink3)" letterSpacing="1">EQUIPO</text>
    </g>
  );
};

/** Una flecha para tocar, en uno de los cuatro lados del equipo tumbado. */
const Toque = ({ giro, activa, alTocar }: {
  giro: number; activa: boolean; alTocar: () => void;
}) => (
  <g transform={`rotate(${giro} 130 130)`} onClick={alTocar} style={{ cursor: 'pointer' }}>
    {/* Un blanco generoso: se toca con guante y con el camión en marcha. */}
    <circle cx="130" cy="24" r="28" fill="transparent" />
    <path d="M130 8 L142 30 H118 Z" fill={activa ? 'var(--acc)' : 'var(--ink3)'}
      opacity={activa ? 1 : 0.3} />
  </g>
);

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
  const dePie = puesta.eje === 'z';

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
        <svg viewBox="0 0 260 260" className="h-[240px] w-full max-w-[310px]">
          {dePie ? (
            /* El costado ocupa menos alto que la planta; centrado y ampliado
               para que las dos vistas llenen el mismo hueco. */
            <g transform="translate(130 130) scale(1.15) translate(-134 -170)">
              <CamionDeLado />
              <Equipo dePie alFrente={!puesta.invertido} />
            </g>
          ) : (
            <>
              <CamionDeArriba giro={GIROS[puesta.id]} />
              <Equipo dePie={false} />
              {VUELTA.map((id) => (
                <Toque
                  key={id}
                  giro={GIROS[id]}
                  activa={puesta.id === id}
                  alTocar={() => elegir(POSICIONES.find((p) => p.id === id)!)}
                />
              ))}
            </>
          )}
        </svg>

        <b className="text-center text-[13px] text-acc">{puesta.nombre}</b>
        <span className="text-center text-[11px] leading-snug text-ink3">{puesta.como}</span>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        <Boton onClick={() => girar(-1)}>↺ Girar</Boton>
        <Boton onClick={() => girar(1)}>Girar ↻</Boton>
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
