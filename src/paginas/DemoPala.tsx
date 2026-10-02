/**
 * Modo demo pala: la pala en 3D en lugar del mapa, movida a mano.
 *
 * Las lecturas que se enseñan salen del movimiento del modelo, como las daría
 * el equipo de verdad (GPS, giroscopio de la tablet y beacon en la pluma), y
 * pasan por la misma regla que usará la pala real.
 */
import { ReactNode, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Play, RefreshCw, RotateCcw, RotateCw, Square,
} from 'lucide-react';
import { EstadoPala, LecturaPala, NOMBRE_ESTADO, estadosPala } from '../nucleo/pala';
import './DemoPala.css';

const MODELO = `${import.meta.env.BASE_URL}modelos/pala.glb`;
/** Del modelo a metros: así mide unos 23 m con la pluma estirada. */
const ESCALA = 12;

type Eje = 'giro' | 'avance' | 'virar' | 'pluma' | 'brazo' | 'cucharon';
type Mando = Record<Eje, number>;

/** Grados por segundo, salvo el avance, que va en m/s. */
const VELOCIDAD: Mando = { giro: 20, avance: 0.7, virar: 10, pluma: 8, brazo: 12, cucharon: 25 };
const LIMITES = { pluma: [-20, 30], brazo: [-35, 45], cucharon: [-50, 70] } as const;
const QUIETO: Mando = { giro: 0, avance: 0, virar: 0, pluma: 0, brazo: 0, cucharon: 0 };

/** Un ciclo de carga: cavar, levantar, girar al camión, descargar y volver. */
const CICLO: { mando: Partial<Mando>; seg: number }[] = [
  { mando: { pluma: -1, brazo: -1, cucharon: -1 }, seg: 2.5 },
  { mando: { brazo: 1, cucharon: 1 }, seg: 3 },
  { mando: { pluma: 1 }, seg: 3 },
  { mando: { giro: 1, pluma: 0.5 }, seg: 4.5 },
  { mando: { cucharon: -1, brazo: -0.6 }, seg: 2.5 },
  { mando: { giro: -1, pluma: -0.5 }, seg: 4.5 },
];

interface Pose { x: number; z: number; rumbo: number; giro: number; pluma: number; brazo: number; cucharon: number }
const POSE_INICIAL: Pose = { x: 0, z: 0, rumbo: 0, giro: 0, pluma: 0, brazo: 0, cucharon: 0 };
const CAMARA_INICIAL = new THREE.Vector3(30, 22, 44);
const MIRA_INICIAL = new THREE.Vector3(-12, 4, -6);

const rad = THREE.MathUtils.degToRad;
const acotar = (v: number, [a, b]: readonly [number, number]) => Math.min(b, Math.max(a, v));

/** Mientras se mantiene apretado, se mueve. */
function Mantener({ alApretar, alSoltar, nombre, children }: {
  alApretar: () => void; alSoltar: () => void; nombre: string; children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="pala-tecla"
      aria-label={nombre}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        alApretar();
      }}
      onPointerUp={alSoltar}
      onPointerCancel={alSoltar}
      onLostPointerCapture={alSoltar}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  );
}

export default function DemoPala() {
  const caja = useRef<HTMLDivElement | null>(null);
  const mando = useRef<Mando>({ ...QUIETO });
  const ciclo = useRef({ activo: false, paso: 0, t: 0 });
  const reiniciar = useRef<() => void>(() => undefined);

  const [carga, setCarga] = useState<number | 'lista' | string>(0);
  const [enCiclo, setEnCiclo] = useState(false);
  const [lectura, setLectura] = useState<LecturaPala>({ velocidad: 0, giro: 0, pluma: 0 });
  const [pose, setPose] = useState<Pose>(POSE_INICIAL);

  useEffect(() => {
    const div = caja.current;
    if (!div) return;

    let render: THREE.WebGLRenderer;
    try {
      render = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setCarga('Este equipo no puede dibujar en 3D (sin WebGL).');
      return;
    }
    render.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    div.appendChild(render.domElement);

    const escena = new THREE.Scene();
    escena.background = new THREE.Color('#0b1217');
    escena.fog = new THREE.Fog('#0b1217', 90, 220);
    escena.add(new THREE.HemisphereLight(0xffffff, 0x3a4a52, 2));
    const sol = new THREE.DirectionalLight(0xffffff, 2.4);
    sol.position.set(30, 50, 20);
    escena.add(sol);

    /* Cuadros de 5 m en textura: con líneas sueltas no se notaba el avance. */
    const cuadro0 = document.createElement('canvas');
    cuadro0.width = cuadro0.height = 64;
    const lapiz = cuadro0.getContext('2d')!;
    lapiz.fillStyle = '#1d272d';
    lapiz.fillRect(0, 0, 64, 64);
    lapiz.fillStyle = '#3a5260';
    lapiz.fillRect(0, 0, 64, 2);
    lapiz.fillRect(0, 0, 2, 64);
    const textura = new THREE.CanvasTexture(cuadro0);
    textura.wrapS = textura.wrapT = THREE.RepeatWrapping;
    textura.repeat.set(100, 100);
    textura.anisotropy = 4;
    textura.colorSpace = THREE.SRGBColorSpace;
    const suelo = new THREE.Mesh(
      new THREE.PlaneGeometry(500, 500),
      new THREE.MeshLambertMaterial({ map: textura }),
    );
    suelo.rotation.x = -Math.PI / 2;
    escena.add(suelo);

    const camara = new THREE.PerspectiveCamera(40, 1, 0.5, 600);
    camara.position.copy(CAMARA_INICIAL);
    const orbita = new OrbitControls(camara, render.domElement);
    orbita.target.copy(MIRA_INICIAL);
    orbita.enablePan = false;
    orbita.minDistance = 14;
    orbita.maxDistance = 90;
    orbita.maxPolarAngle = Math.PI / 2 - 0.05;
    orbita.update();

    const ajustar = () => {
      const { clientWidth: w, clientHeight: h } = div;
      if (!w || !h) return;
      render.setSize(w, h);
      camara.aspect = w / h;
      camara.updateProjectionMatrix();
    };
    const observador = new ResizeObserver(ajustar);
    observador.observe(div);
    ajustar();

    const maquina = new THREE.Group();
    escena.add(maquina);
    let piezas: Record<'casa' | 'pluma' | 'brazo' | 'cucharon', THREE.Object3D> | null = null;

    new GLTFLoader().load(
      MODELO,
      (g) => {
        const m = g.scene;
        m.scale.setScalar(ESCALA);
        maquina.add(m);
        maquina.updateMatrixWorld(true);
        /* El eje de giro de la casa al origen y las orugas sobre el suelo. */
        const eje = m.getObjectByName('casa')!.getWorldPosition(new THREE.Vector3());
        const caja3 = new THREE.Box3().setFromObject(m);
        m.position.set(-eje.x, -caja3.min.y, -eje.z);
        piezas = {
          casa: m.getObjectByName('casa')!,
          pluma: m.getObjectByName('pluma')!,
          brazo: m.getObjectByName('brazo')!,
          cucharon: m.getObjectByName('cucharon')!,
        };
        setCarga('lista');
      },
      (e) => e.total && setCarga(Math.round((e.loaded / e.total) * 100)),
      () => setCarga('No se pudo cargar el modelo de la pala.'),
    );

    let p: Pose = { ...POSE_INICIAL };
    const medida: LecturaPala = { velocidad: 0, giro: 0, pluma: 0 };
    let ultimo = performance.now();
    let aviso = 0;
    let cuadro = 0;

    reiniciar.current = () => {
      p = { ...POSE_INICIAL };
      maquina.position.set(0, 0, 0);
      camara.position.copy(CAMARA_INICIAL);
      orbita.target.copy(MIRA_INICIAL);
    };

    const paso = (ahora: number) => {
      cuadro = requestAnimationFrame(paso);
      const dt = Math.min(0.1, (ahora - ultimo) / 1000);
      ultimo = ahora;
      if (!dt) return;

      let m: Mando = mando.current;
      const c = ciclo.current;
      if (c.activo) {
        c.t += dt;
        if (c.t > CICLO[c.paso].seg) {
          c.t = 0;
          c.paso = (c.paso + 1) % CICLO.length;
        }
        m = { ...QUIETO, ...CICLO[c.paso].mando };
      }

      const antes = p;
      const rumbo = p.rumbo + m.virar * VELOCIDAD.virar * dt;
      const avance = m.avance * VELOCIDAD.avance * dt;
      p = {
        rumbo,
        x: p.x - Math.cos(rad(rumbo)) * avance,
        z: p.z + Math.sin(rad(rumbo)) * avance,
        giro: p.giro + m.giro * VELOCIDAD.giro * dt,
        pluma: acotar(p.pluma + m.pluma * VELOCIDAD.pluma * dt, LIMITES.pluma),
        brazo: acotar(p.brazo + m.brazo * VELOCIDAD.brazo * dt, LIMITES.brazo),
        cucharon: acotar(p.cucharon + m.cucharon * VELOCIDAD.cucharon * dt, LIMITES.cucharon),
      };

      /* Lo que medirían los sensores, suavizado como llega en la realidad. */
      const k = 1 - Math.exp(-dt / 0.3);
      const recorrido = Math.hypot(p.x - antes.x, p.z - antes.z);
      medida.velocidad += ((recorrido / dt) * 3.6 - medida.velocidad) * k;
      medida.giro += ((p.giro + p.rumbo - antes.giro - antes.rumbo) / dt - medida.giro) * k;
      medida.pluma += ((p.pluma - antes.pluma) / dt - medida.pluma) * k;

      const dx = p.x - maquina.position.x, dz = p.z - maquina.position.z;
      maquina.position.set(p.x, 0, p.z);
      maquina.rotation.y = rad(p.rumbo);
      camara.position.x += dx;
      camara.position.z += dz;
      orbita.target.x += dx;
      orbita.target.z += dz;
      if (piezas) {
        piezas.casa.rotation.y = rad(p.giro);
        piezas.pluma.rotation.z = -rad(p.pluma);
        piezas.brazo.rotation.z = rad(p.brazo);
        piezas.cucharon.rotation.z = rad(p.cucharon);
      }
      orbita.update();
      render.render(escena, camara);

      if (ahora - aviso > 200) {
        aviso = ahora;
        setLectura({ ...medida });
        setPose(p);
      }
    };
    cuadro = requestAnimationFrame(paso);

    return () => {
      cancelAnimationFrame(cuadro);
      observador.disconnect();
      orbita.dispose();
      escena.traverse((o) => {
        const malla = o as THREE.Mesh;
        if (!malla.isMesh) return;
        malla.geometry.dispose();
        for (const mat of [malla.material].flat() as THREE.MeshStandardMaterial[]) {
          mat.map?.dispose();
          mat.metalnessMap?.dispose();
          mat.roughnessMap?.dispose();
          mat.dispose();
        }
      });
      render.dispose();
      render.forceContextLoss();
      render.domElement.remove();
    };
  }, []);

  const pararCiclo = () => {
    ciclo.current.activo = false;
    setEnCiclo(false);
  };

  const tecla = (eje: Eje, sentido: number) => ({
    alApretar: () => {
      pararCiclo();
      mando.current[eje] = sentido;
    },
    alSoltar: () => {
      mando.current[eje] = 0;
    },
  });

  const alternarCiclo = () => {
    const activo = !ciclo.current.activo;
    ciclo.current = { activo, paso: 0, t: 0 };
    mando.current = { ...QUIETO };
    setEnCiclo(activo);
  };

  const estados: EstadoPala[] = estadosPala(lectura);

  return (
    <div className="pala-demo">
      <div className="pala-lienzo" ref={caja} />

      {carga !== 'lista' && (
        <div className="pala-carga">
          {typeof carga === 'number' ? `Cargando la pala… ${carga} %` : carga}
        </div>
      )}

      <div className="pala-estado">
        <p className="pala-aviso">Demo · movimientos simulados</p>
        <div className="pala-chips">
          {estados.map((e) => (
            <span key={e} className={`pala-chip est-${e}`}>{NOMBRE_ESTADO[e]}</span>
          ))}
        </div>
        <dl className="pala-lecturas">
          <div><dt>GPS</dt><dd>{lectura.velocidad.toFixed(1)} km/h</dd></div>
          <div><dt>Giroscopio</dt><dd>{lectura.giro.toFixed(0)} °/s</dd></div>
          <div><dt>Beacon pluma</dt><dd>{lectura.pluma > 0 ? '+' : ''}{lectura.pluma.toFixed(0)} °/s</dd></div>
          <div><dt>Ángulos</dt><dd>P {pose.pluma.toFixed(0)}° · B {pose.brazo.toFixed(0)}° · C {pose.cucharon.toFixed(0)}°</dd></div>
        </dl>
      </div>

      <div className="pala-acciones">
        <button type="button" className={`pala-accion ${enCiclo ? 'puesto' : ''}`} onClick={alternarCiclo}>
          {enCiclo ? <Square size={14} /> : <Play size={14} />}
          {enCiclo ? 'Parar ciclo' : 'Ciclo de carga'}
        </button>
        <button type="button" className="pala-accion" onClick={() => { pararCiclo(); reiniciar.current(); }}>
          <RefreshCw size={14} />
          Reiniciar
        </button>
      </div>

      <div className="pala-mandos">
        <fieldset className="pala-grupo">
          <legend>Traslado</legend>
          <div className="pala-cruz">
            <Mantener {...tecla('avance', 1)} nombre="Avanzar"><ChevronUp size={22} /></Mantener>
            <Mantener {...tecla('virar', 1)} nombre="Virar a la izquierda"><ChevronLeft size={22} /></Mantener>
            <Mantener {...tecla('avance', -1)} nombre="Retroceder"><ChevronDown size={22} /></Mantener>
            <Mantener {...tecla('virar', -1)} nombre="Virar a la derecha"><ChevronRight size={22} /></Mantener>
          </div>
        </fieldset>

        <fieldset className="pala-grupo">
          <legend>Giro</legend>
          <div className="pala-fila">
            <Mantener {...tecla('giro', 1)} nombre="Girar a la izquierda"><RotateCcw size={20} /></Mantener>
            <Mantener {...tecla('giro', -1)} nombre="Girar a la derecha"><RotateCw size={20} /></Mantener>
          </div>
        </fieldset>

        <fieldset className="pala-grupo">
          <legend>Pluma</legend>
          <Mantener {...tecla('pluma', 1)} nombre="Subir pluma"><ChevronUp size={22} /></Mantener>
          <Mantener {...tecla('pluma', -1)} nombre="Bajar pluma"><ChevronDown size={22} /></Mantener>
        </fieldset>

        <fieldset className="pala-grupo">
          <legend>Brazo</legend>
          <Mantener {...tecla('brazo', 1)} nombre="Recoger brazo"><span className="pala-txt">Recoge</span></Mantener>
          <Mantener {...tecla('brazo', -1)} nombre="Extender brazo"><span className="pala-txt">Extiende</span></Mantener>
        </fieldset>

        <fieldset className="pala-grupo">
          <legend>Cucharón</legend>
          <Mantener {...tecla('cucharon', 1)} nombre="Cargar cucharón"><span className="pala-txt">Carga</span></Mantener>
          <Mantener {...tecla('cucharon', -1)} nombre="Descargar cucharón"><span className="pala-txt">Descarga</span></Mantener>
        </fieldset>
      </div>
    </div>
  );
}
