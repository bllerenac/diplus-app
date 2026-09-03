/** Piezas de interfaz que se repiten. Todo lo que aparece en más de una vista. */
import { ReactNode } from 'react';

export const Bloque = ({
  titulo, accion, children, className = '',
}: {
  titulo?: string;
  accion?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  /* `shrink-0` no es adorno: dentro de una columna flexible con scroll, los
     hijos se **comprimen** para caber en vez de desbordar, y como la seccion
     recorta lo que sobra, el contenido desaparecia. En Configuracion se veian
     los bloques aplastados unos sobre otros y el boton de calibrar no llegaba
     a dibujarse. Se vio en el equipo. */
  <section
    className={
      `shrink-0 overflow-hidden rounded-2xl border border-line bg-sur ${className}`
    }
  >
    {(titulo || accion) && (
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <span className="rotulo">{titulo}</span>
        {accion}
      </header>
    )}
    <div className="flex flex-col gap-4 p-4">{children}</div>
  </section>
);

export const Campo = ({
  etiqueta, ayuda, children,
}: {
  etiqueta: string;
  ayuda?: string;
  children: ReactNode;
}) => (
  <label className="flex min-w-0 flex-col gap-1.5">
    <span className="rotulo text-[9.5px] tracking-[0.13em]">{etiqueta}</span>
    {children}
    {ayuda && <span className="text-[11px] leading-snug text-ink3">{ayuda}</span>}
  </label>
);

const entrada =
  'w-full rounded-xl border border-line2 bg-bg px-3 py-2.5 font-mono text-[13px] text-ink ' +
  'outline-none transition-colors placeholder:text-ink3 focus:border-acc';

export const Entrada = (p: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input {...p} className={`${entrada} ${p.className ?? ''}`} />
);

export const Selector = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...p} className={`${entrada} ${p.className ?? ''}`} />
);

const botones = {
  normal: 'border-line2 bg-sur3 text-ink active:translate-y-px',
  fuerte: 'border-acc bg-acc text-[#06231a] active:translate-y-px',
  tenue: 'border-transparent text-ink3',
  peligro: 'border-transparent text-ink3 hover:border-bad hover:text-bad',
};

export const Boton = ({
  variante = 'normal', className = '', ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: keyof typeof botones }) => (
  <button
    {...p}
    className={
      'shrink-0 cursor-pointer rounded-full border px-4 py-2 font-mono text-[10.5px] font-semibold ' +
      `uppercase tracking-[0.08em] transition disabled:opacity-40 ${botones[variante]} ${className}`
    }
  />
);

/** Interruptor grande: esto se toca con guantes. */
export const Interruptor = ({
  activo, alCambiar, etiqueta,
}: {
  activo: boolean;
  alCambiar: (v: boolean) => void;
  etiqueta: string;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={activo}
    onClick={() => alCambiar(!activo)}
    className="flex items-center gap-3 text-left"
  >
    <span
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
        activo ? 'border-acc bg-acc/25' : 'border-line2 bg-sur2'
      }`}
    >
      <span
        className={`absolute top-[3px] h-[17px] w-[17px] rounded-full transition-all ${
          activo ? 'left-[24px] bg-acc shadow-[0_0_10px_var(--glowa)]' : 'left-[3px] bg-ink3'
        }`}
      />
    </span>
    <span className="text-[13px] text-ink2">{etiqueta}</span>
  </button>
);

export const Nota = ({ children }: { children: ReactNode }) => (
  <p className="m-0 text-[11.5px] leading-relaxed text-ink3">{children}</p>
);

export const Vacio = ({ children }: { children: ReactNode }) => (
  <p className="m-0 rounded-xl bg-sur2 px-4 py-7 text-center text-[12.5px] leading-relaxed text-ink3">
    {children}
  </p>
);

export const Aviso = ({
  tono = 'warn', children,
}: {
  tono?: 'warn' | 'bad' | 'ok';
  children: ReactNode;
}) => {
  const color = { warn: 'border-warn bg-warn/8', bad: 'border-bad bg-bad/8', ok: 'border-ok bg-ok/8' }[tono];
  return (
    <p className={`m-0 rounded-r-xl border-l-2 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink2 ${color}`}>
      {children}
    </p>
  );
};

/**
 * Pestañas en columna, a la izquierda.
 *
 * La pantalla del equipo es apaisada, 1280 x 800. Con las pestañas en una fila
 * arriba el contenido quedaba en una columna estrecha en el centro y media
 * pantalla vacia a los lados; puestas en vertical, el ancho se usa entero.
 *
 * El estado vive fuera para que la vista recuerde donde estaba al volver.
 */
export const Pestanas = <T extends string>({
  opciones, puesta, alElegir,
}: {
  opciones: { id: T; nombre: string }[];
  puesta: T;
  alElegir: (id: T) => void;
}) => (
  <nav className="flex h-full w-[184px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-sur p-3">
    {opciones.map((o) => (
      <button
        key={o.id}
        onClick={() => alElegir(o.id)}
        className={`rounded-lg px-3.5 py-2.5 text-left font-mono text-[10.5px] font-semibold uppercase tracking-[0.1em] transition ${
          puesta === o.id ? 'bg-acc text-[#06231a]' : 'text-ink3 hover:bg-sur2 hover:text-ink2'
        }`}
      >
        {o.nombre}
      </button>
    ))}
  </nav>
);
