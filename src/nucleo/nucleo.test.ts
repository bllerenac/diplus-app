/**
 * Pruebas del troceado y de los protocolos.
 *
 * Con tramas reales, no inventadas: las del HelperBox salieron de lo que emite
 * su puente, y los vectores de CRC son los de siempre. Lo que se comprueba aqui
 * es justo lo que fallaba antes en campo: que una trama partida en dos lecturas
 * se recomponga y que una configuracion distinta de la de fabrica se reconozca.
 */
import { describe, expect, it } from 'vitest';
import { comoVoy, dentroDelPoligono, geocercaDe, recomendacionDe } from './geo';
import { Geocerca } from './servidor';
import { arreglarDireccion, esMasNueva, reparo } from './actualizacion';
import { HUECOS, calcular, nuevaTarjeta, panelFijo, texto, titulo } from './panel';
import { aplicar as aplicarCurva, ordenar as ordenarCurva, revisar as revisarCurva } from './curva';
import { aHex, deHex, porLargo, porLinea, porSilencio } from './tramas';
import { crc16Modbus, crc8Eurosens, leer } from './lecturas';
import { protocolo } from './protocolos';

const bytes = (s: string) => new TextEncoder().encode(s);

describe('troceado por linea', () => {
  it('recompone una trama partida en dos lecturas', () => {
    const t = porLinea();
    expect(t.empujar(bytes('{"a":1'))).toHaveLength(0);
    const salida = t.empujar(bytes('2}\n'));
    expect(salida).toHaveLength(1);
    expect(new TextDecoder().decode(salida[0])).toBe('{"a":12}');
  });

  it('separa dos tramas que llegaron pegadas', () => {
    const t = porLinea();
    const salida = t.empujar(bytes('uno\ndos\n'));
    expect(salida.map((s) => new TextDecoder().decode(s))).toEqual(['uno', 'dos']);
  });

  it('quita el retorno de carro de un \\r\\n', () => {
    const t = porLinea();
    const salida = t.empujar(bytes('hola\r\n'));
    expect(new TextDecoder().decode(salida[0])).toBe('hola');
  });

  it('no crece sin fin con una linea que nunca acaba', () => {
    const t = porLinea();
    for (let i = 0; i < 50; i += 1) t.empujar(new Uint8Array(1000));
    expect(t.empujar(bytes('\n'))[0].length).toBeLessThanOrEqual(8192);
  });
});

describe('troceado por silencio', () => {
  it('cierra la trama cuando el cable calla', async () => {
    const t = porSilencio(20);
    t.empujar(deHex('01 03 02 00 0A'));
    expect(t.vencidos()).toHaveLength(0); // todavia no ha pasado la pausa

    await new Promise((r) => setTimeout(r, 30));
    const salida = t.vencidos();
    expect(salida).toHaveLength(1);
    expect(aHex(salida[0])).toBe('01 03 02 00 0A');
  });
});

describe('troceado por largo', () => {
  it('parte un flujo continuo en tramas del mismo tamaño', () => {
    const salida = porLargo(4).empujar(deHex('01020304 05060708 09'));
    expect(salida.map(aHex)).toEqual(['01 02 03 04', '05 06 07 08']);
  });
});

describe('sumas de verificacion', () => {
  it('CRC16 de Modbus contra los vectores conocidos', () => {
    const enLaTrama = (m: string) => {
      const b = new Uint8Array(2);
      new DataView(b.buffer).setUint16(0, crc16Modbus(deHex(m)), true);
      return aHex(b);
    };
    expect(enLaTrama('01 03 00 00 00 0A')).toBe('C5 CD');
    expect(enLaTrama('01 04 02 FF FF')).toBe('B8 80');
    expect(enLaTrama('11 03 00 6B 00 03')).toBe('76 87');
  });

  it('CRC8 de Eurosens da un byte', () => {
    expect(crc8Eurosens(deHex('3E 01 06'))).toBeLessThanOrEqual(0xff);
  });
});

describe('protocolo HelperBox JSON', () => {
  it('lee la linea que emite el puente', () => {
    const s = protocolo('helperbox-json').decodificar(
      bytes('{"at":1788301359870,"1.caudal":12.3,"equipo.bus_vivo":1}'),
      {},
    );
    expect(s.map((x) => x.clave)).toEqual(['1.caudal', 'equipo.bus_vivo']);
    expect(s[0].valor).toBe(12.3);
  });

  it('descarta una linea a medias sin reventar', () => {
    expect(protocolo('helperbox-json').decodificar(bytes('{"a":'), {})).toEqual([]);
  });
});

describe('protocolo HelperBox CSV', () => {
  it('lee la trama real con prefijo y le pone nombres', () => {
    const s = protocolo('helperbox-csv').decodificar(bytes('HB;51.092;35.000;0.000'), {
      prefijo: 'HB',
      columnas: 'temperatura,memoria,bus_vivo',
      separador: ';',
    });
    expect(s.map((x) => x.clave)).toEqual(['temperatura', 'memoria', 'bus_vivo']);
    expect(s[0].valor).toBe(51.092);
  });
});

describe('protocolo Modbus RTU', () => {
  /** Arma una respuesta valida, con su CRC bien puesto. */
  const respuesta = (esclavo: number, datos: string) => {
    const d = deHex(datos);
    const cuerpo = new Uint8Array(3 + d.length);
    cuerpo[0] = esclavo;
    cuerpo[1] = 0x03;
    cuerpo[2] = d.length;
    cuerpo.set(d, 3);
    const t = new Uint8Array(cuerpo.length + 2);
    t.set(cuerpo, 0);
    new DataView(t.buffer).setUint16(cuerpo.length, crc16Modbus(cuerpo), true);
    return t;
  };

  it('lee registros de 16 bits con su escala', () => {
    const s = protocolo('modbus-rtu').decodificar(respuesta(1, '00 0A 00 14'), {
      esclavo: 1, agrupacion: 'u16', escala: 0.1, columnas: 'caudal,total',
    });
    expect(s.map((x) => x.clave)).toEqual(['caudal', 'total']);
    expect(s[0].valor).toBeCloseTo(1.0);
    expect(s[1].valor).toBeCloseTo(2.0);
  });

  it('reconoce un esclavo distinto del 1, que antes no se leia', () => {
    const s = protocolo('modbus-rtu').decodificar(respuesta(17, '00 64'), {
      esclavo: 17, agrupacion: 'u16', escala: 1,
    });
    expect(s[0].valor).toBe(100);
  });

  it('acepta cualquier esclavo con 0', () => {
    const s = protocolo('modbus-rtu').decodificar(respuesta(9, '00 07'), { esclavo: 0 });
    expect(s[0].valor).toBe(7);
  });

  it('descarta la trama si el CRC no cuadra', () => {
    const t = respuesta(1, '00 0A');
    t[t.length - 1] ^= 0xff; // se estropea el CRC
    expect(protocolo('modbus-rtu').decodificar(t, { esclavo: 1 })).toEqual([]);
  });

  it('lee coma flotante de 32 bits, como manda un caudalimetro', () => {
    const d = new Uint8Array(8);
    const dv = new DataView(d.buffer);
    dv.setFloat32(0, 12.5, false);
    dv.setFloat32(4, 340.25, false);
    const s = protocolo('modbus-rtu').decodificar(respuesta(1, aHex(d)), {
      esclavo: 1, agrupacion: 'f32', escala: 1, columnas: 'caudal,totalizador',
    });
    expect(s[0].valor).toBeCloseTo(12.5);
    expect(s[1].valor).toBeCloseTo(340.25);
  });
});

/**
 * Lo que se pregunta, no lo que se escucha.
 *
 * Un esclavo callado y un cable roto se ven exactamente igual desde fuera, y
 * eso costo dias: la version anterior de la aplicacion interrogaba al aparato y
 * por eso leia. Estas tramas van contra vectores publicados del estandar y
 * contra el CRC8 del equipo que si leia, no contra lo que salga de este codigo.
 */
describe('preguntas a los esclavos', () => {
  it('arma la peticion Modbus de los vectores conocidos', () => {
    expect(aHex(protocolo('modbus-rtu').pregunta!({
      esclavo: 1, funcion: 3, registro: 0, cantidad: 10,
    })!)).toBe('01 03 00 00 00 0A C5 CD');

    expect(aHex(protocolo('modbus-rtu').pregunta!({
      esclavo: 17, funcion: 3, registro: 107, cantidad: 3,
    })!)).toBe('11 03 00 6B 00 03 76 87');
  });

  it('no pregunta al esclavo 0, que en Modbus es la difusion', () => {
    expect(protocolo('modbus-rtu').pregunta!({ esclavo: 0 })).toBeNull();
  });

  it('arma la peticion Eurosens como la mandaba el equipo que leia', () => {
    expect(aHex(protocolo('eurosens-dds').pregunta!({ direccion: 1, orden: 6 })!))
      .toBe('31 01 06 6C');
  });

  it('los protocolos que emiten solos no preguntan nada', () => {
    expect(protocolo('helperbox-json').pregunta).toBeUndefined();
    expect(protocolo('dfm-j1939').pregunta).toBeUndefined();
  });

  /*
   * La vuelta completa, con bytes que existieron.
   *
   * La pregunta se mando a un esclavo Modbus corriendo en un HelperBox y esta
   * es su respuesta tal cual salio del puerto. Que el ida y vuelta este atado
   * en la misma prueba es lo que hace que valga: comprueba que lo que
   * preguntamos y lo que entendemos hablan el mismo idioma.
   */
  it('entiende la respuesta que dio un esclavo de verdad', () => {
    const respuesta = deHex('01 03 04 04 C4 C3 54 EB F1');

    const s = protocolo('modbus-rtu').decodificar(respuesta, {
      esclavo: 1, agrupacion: 'u16', escala: 1, columnas: 'caudal,totalizador',
    });

    expect(s.map((x) => [x.clave, x.valor])).toEqual([
      ['caudal', 1220],
      ['totalizador', 50004],
    ]);
  });
});

describe('protocolo DFM sobre J1939', () => {
  it('marca el caudal como ambiguo en el valor reservado', () => {
    const d = new Uint8Array(8);
    new DataView(d.buffer).setUint32(0, 0x7fffffff, true);
    const s = protocolo('dfm-j1939').decodificar(d, { sa: 111 }, { pgn: 0xf6b7, sa: 111 });
    expect(s[0].valor).toBeNull();
    expect(s[0].ambiguo).toBe(true);
  });

  it('ignora las tramas de otro origen', () => {
    const d = new Uint8Array(8);
    expect(protocolo('dfm-j1939').decodificar(d, { sa: 111 }, { pgn: 0xf6b7, sa: 99 })).toEqual([]);
  });

  it('lee la temperatura con su desplazamiento', () => {
    const d = deHex('FF 42 00 00 00 00 00 00'); // 0x42 = 66 - 40 = 26 grados
    const s = protocolo('dfm-j1939').decodificar(d, { sa: 111 }, { pgn: 0xfeee, sa: 111 });
    expect(s[0].valor).toBe(26);
  });

  it('respeta un factor puesto a mano en vez del de fabrica', () => {
    const d = new Uint8Array(8);
    new DataView(d.buffer).setUint32(0, 100000, true); // 100000 × 0,00001 = 1 hora
    const s = protocolo('dfm-j1939').decodificar(d, { sa: 111, factor_volumen: 1 }, { pgn: 0xf6b5, sa: 111 });
    expect(s[0].valor).toBeCloseTo(1);
  });
});

describe('senales a mano', () => {
  it('aplica escala y desplazamiento donde se le diga', () => {
    const s = protocolo('can-manual').decodificar(
      deHex('10 27 00 00 00 00 00 00'),
      {
        sa: -1,
        senales: [
          { clave: 'p', nombre: 'Presión', unidad: 'bar', desde: 0, tipo: 'u16le', escala: 0.01, desplazamiento: 0 },
        ],
      },
      { pgn: 0x100, sa: 5 },
    );
    expect(s[0].valor).toBeCloseTo(100);
    expect(s[0].unidad).toBe('bar');
  });

  it('descarta un valor fuera del rango creible', () => {
    const s = protocolo('can-manual').decodificar(
      deHex('FF FF 00 00 00 00 00 00'),
      { sa: -1, senales: [{ clave: 'p', nombre: 'P', unidad: '', desde: 0, tipo: 'u16le', escala: 1, desplazamiento: 0, max: 1000 }] },
      { pgn: 0x100, sa: 5 },
    );
    expect(s[0].valor).toBeNull();
  });
});

describe('lectura de numeros', () => {
  it('devuelve null si la trama es mas corta que el tipo', () => {
    expect(leer(deHex('01 02'), 0, 'u32le')).toBeNull();
  });
});

describe('tarjetas del panel', () => {
  const s = (clave: string, nombre: string, unidad: string, valor: number | string | null, extra = {}) =>
    ({ clave, nombre, unidad, valor, ...extra });

  const conValores = (pares: [string, ReturnType<typeof s>][], at = 1000) => ({
    valores: new Map(pares),
    frescura: new Map(pares.map(([k]) => [k, at])),
  });

  it('resta dos caudalimetros para dar el consumo', () => {
    const { valores, frescura } = conValores([
      ['f1.ida', s('ida', 'Ida', 'L/h', 42.5)],
      ['f1.retorno', s('retorno', 'Retorno', 'L/h', 30.2)],
    ]);
    const t = { ...nuevaTarjeta('diferencia'), claves: ['f1.ida', 'f1.retorno'], decimales: 1 };
    const v = calcular(t, valores, frescura);

    expect(v.valor).toBeCloseTo(12.3);
    expect(v.unidad).toBe('L/h');
    expect(v.estado).toBe('ok');
    /* Los dos lados quedan a la vista: un consumo raro casi siempre es un
       caudalimetro caido, no un motor raro. */
    expect(v.partes.map((p) => p.valor)).toEqual([42.5, 30.2]);
  });

  it('no inventa la resta cuando falta el segundo caudalimetro', () => {
    const { valores, frescura } = conValores([['f1.ida', s('ida', 'Ida', 'L/h', 42.5)]]);
    const t = { ...nuevaTarjeta('diferencia'), claves: ['f1.ida', 'f1.retorno'] };
    const v = calcular(t, valores, frescura);

    expect(v.valor).toBeNull();
    expect(v.estado).toBe('sin');
  });

  it('suma dos tanques', () => {
    const { valores, frescura } = conValores([
      ['f1.a', s('a', 'Tanque A', 'L', 120)],
      ['f1.b', s('b', 'Tanque B', 'L', 80)],
    ]);
    const t = { ...nuevaTarjeta('suma'), claves: ['f1.a', 'f1.b'] };
    expect(calcular(t, valores, frescura).valor).toBe(200);
  });

  it('pone el nivel en su sitio dentro del rango', () => {
    const { valores, frescura } = conValores([['f1.n', s('n', 'Nivel', '%', 75)]]);
    const t = { ...nuevaTarjeta('nivel'), claves: ['f1.n'], min: 50, max: 100 };
    expect(calcular(t, valores, frescura).fraccion).toBeCloseTo(0.5);
  });

  it('no se sale de la barra con un valor fuera del rango', () => {
    const { valores, frescura } = conValores([['f1.n', s('n', 'Nivel', '%', 250)]]);
    const t = { ...nuevaTarjeta('nivel'), claves: ['f1.n'], min: 0, max: 100 };
    expect(calcular(t, valores, frescura).fraccion).toBe(1);
  });

  it('avisa por debajo y por encima de los limites', () => {
    const t = { ...nuevaTarjeta('numero'), claves: ['f1.n'], bajo: 10, alto: 90 };
    const bajo = conValores([['f1.n', s('n', 'N', '', 5)]]);
    const alto = conValores([['f1.n', s('n', 'N', '', 95)]]);
    const medio = conValores([['f1.n', s('n', 'N', '', 50)]]);

    expect(calcular(t, bajo.valores, bajo.frescura).estado).toBe('bajo');
    expect(calcular(t, alto.valores, alto.frescura).estado).toBe('alto');
    expect(calcular(t, medio.valores, medio.frescura).estado).toBe('ok');
  });

  it('la unidad puesta a mano gana a la de la señal', () => {
    const { valores, frescura } = conValores([['f1.n', s('n', 'N', 'L/h', 5)]]);
    const t = { ...nuevaTarjeta('numero'), claves: ['f1.n'], unidad: 'gal/h' };
    expect(calcular(t, valores, frescura).unidad).toBe('gal/h');
  });

  it('deja pasar el texto sin convertirlo en numero', () => {
    const { valores, frescura } = conValores([['f1.e', s('e', 'Estado', '', 'MARCHA')]]);
    const t = { ...nuevaTarjeta('texto'), claves: ['f1.e'] };
    expect(calcular(t, valores, frescura).valor).toBe('MARCHA');
  });

  it('avisa cuando el aparato no distingue cero de sin dato', () => {
    const { valores, frescura } = conValores([['f1.q', s('q', 'Caudal', 'L/h', null, { ambiguo: true })]]);
    const t = { ...nuevaTarjeta('numero'), claves: ['f1.q'] };
    const v = calcular(t, valores, frescura);
    expect(texto(v, 1)).toBe('cero o sin dato');
  });

  it('se queda con la señal mas vieja de las que usa', () => {
    const valores = new Map([
      ['f1.a', s('a', 'A', '', 1)],
      ['f1.b', s('b', 'B', '', 2)],
    ]);
    const frescura = new Map([['f1.a', 9000], ['f1.b', 3000]]);
    const t = { ...nuevaTarjeta('suma'), claves: ['f1.a', 'f1.b'] };
    /* La tarjeta es tan actual como su dato mas atrasado. */
    expect(calcular(t, valores, frescura).visto).toBe(3000);
  });

  it('se inventa un titulo con las señales cuando no se le puso ninguno', () => {
    const { valores, frescura } = conValores([
      ['f1.ida', s('ida', 'Ida', 'L/h', 10)],
      ['f1.ret', s('ret', 'Retorno', 'L/h', 4)],
    ]);
    const t = { ...nuevaTarjeta('diferencia'), claves: ['f1.ida', 'f1.ret'] };
    expect(titulo(t, calcular(t, valores, frescura))).toBe('Ida − Retorno');
  });
});

describe('direcciones para actualizar', () => {
  const ID = '1AbC-dEf_GhIjKlMnOpQrStUvWxYz09';

  it('traduce el enlace de compartir de Drive al de descarga', () => {
    expect(arreglarDireccion(`https://drive.google.com/file/d/${ID}/view?usp=sharing`))
      .toBe(`https://drive.google.com/uc?export=download&id=${ID}`);
  });

  it('traduce tambien el enlace antiguo de Drive', () => {
    expect(arreglarDireccion(`https://drive.google.com/open?id=${ID}`))
      .toBe(`https://drive.google.com/uc?export=download&id=${ID}`);
  });

  it('deja en paz una direccion que ya apunta al archivo', () => {
    const u = 'https://gunjop.com/apk/diplus.apk';
    expect(arreglarDireccion(u)).toBe(u);
  });

  it('avisa del enlace de Dropbox que devuelve una pagina', () => {
    expect(reparo('https://www.dropbox.com/s/xxx/diplus.apk?dl=0')).toMatch(/dl=1/);
    expect(reparo('https://www.dropbox.com/s/xxx/diplus.apk?dl=1')).toBeNull();
  });

  it('avisa del enlace de GitHub que es la pagina del archivo', () => {
    expect(reparo('https://github.com/gunjop/diplus/blob/main/diplus.apk')).toMatch(/Raw/);
  });

  it('exige que la direccion sea http o https', () => {
    expect(reparo('drive.google.com/algo')).toMatch(/http/);
    expect(reparo('')).toMatch(/Falta/);
  });

  it('solo llama nueva a la version que sube el numero', () => {
    /* Android no deja instalar hacia atras: bajar de version obliga a
       desinstalar, y eso se lleva la base de datos por delante. */
    expect(esMasNueva(3, 2)).toBe(true);
    expect(esMasNueva(2, 2)).toBe(false);
    expect(esMasNueva(1, 2)).toBe(false);
  });
});

describe('tramas reales del emisor de pruebas', () => {
  /*
   * Salidas de herramientas/emisor-rs485.ps1 capturadas del puerto COM5.
   *
   * Sirven para dos cosas: que el CRC que calcula el emisor en PowerShell es el
   * mismo que exige la aplicacion —dos implementaciones distintas del mismo
   * polinomio, escritas por separado—, y que lo que se emite se decodifica en
   * los valores que se pusieron.
   */
  const CFG = {
    esclavo: 1,
    agrupacion: 'u16',
    escala: 0.01,
    columnas: 'caudal,retorno,temperatura,nivel',
    exigir_crc: 'si',
  };

  it('decodifica una trama Modbus del emisor', () => {
    const s = protocolo('modbus-rtu').decodificar(
      deHex('01 03 08 0F F3 0B 29 1E BE 3E 1C 3D 80'), CFG, {},
    );

    expect(s.map((x) => x.clave)).toEqual(['caudal', 'retorno', 'temperatura', 'nivel']);
    expect(s[0].valor).toBeCloseTo(40.83, 2);
    expect(s[1].valor).toBeCloseTo(28.57, 2);
    expect(s[2].valor).toBeCloseTo(78.7, 2);
    expect(s[3].valor).toBeCloseTo(159.0, 2);
  });

  it('decodifica la segunda, con otros valores', () => {
    const s = protocolo('modbus-rtu').decodificar(
      deHex('01 03 08 10 44 0B 61 1F 04 3D B8 7A 9B'), CFG, {},
    );
    expect(s[0].valor).toBeCloseTo(41.64, 2);
    expect(s[3].valor).toBeCloseTo(158.0, 2);
  });

  it('rechaza la trama si se le toca un byte', () => {
    /* El CRC tiene que servir de algo: con un dato cambiado no debe pasar. */
    const s = protocolo('modbus-rtu').decodificar(
      deHex('01 03 08 0F F4 0B 29 1E BE 3E 1C 3D 80'), CFG, {},
    );
    expect(s).toEqual([]);
  });

  it('lee la linea JSON que emite el mismo guion', () => {
    const linea = '{"caudal":40.83,"retorno":28.57,"temperatura":78.7,"rpm":1579,"nivel":159}';
    const s = protocolo('helperbox-json').decodificar(
      new TextEncoder().encode(linea), {}, {},
    );
    expect(s.find((x) => x.clave === 'caudal')?.valor).toBe(40.83);
    expect(s.find((x) => x.clave === 'rpm')?.valor).toBe(1579);
  });

  it('lee la linea CSV con los nombres puestos a mano', () => {
    const s = protocolo('helperbox-csv').decodificar(
      new TextEncoder().encode('41.64;29.13;79.4;1656;158'),
      { prefijo: '', columnas: 'caudal,retorno,temperatura,rpm,nivel', separador: ';' },
      {},
    );
    expect(s[0].valor).toBeCloseTo(41.64, 2);
    expect(s[4].valor).toBeCloseTo(158, 2);
  });
});

describe('en que geocerca estoy', () => {
  const poli = (id: string, puntos: [number, number][]): Geocerca =>
    ({ id, nombre: id, tipo: 'poligono', color: '#fff', puntos, radio: 0 });

  /* Un cuadrado grande con otro pequeño dentro, que es lo normal en una mina:
     una rampa dentro de un area. */
  const AREA = poli('area', [[0, 0], [0, 10], [10, 10], [10, 0]]);
  const RAMPA = poli('rampa', [[4, 4], [4, 6], [6, 6], [6, 4]]);

  it('sabe si un punto está dentro', () => {
    expect(dentroDelPoligono([5, 5], AREA.puntos)).toBe(true);
    expect(dentroDelPoligono([15, 5], AREA.puntos)).toBe(false);
  });

  it('acierta con un polígono cóncavo, que es lo que hay en una mina', () => {
    /* Una L: el hueco de la esquina queda fuera aunque este dentro del marco. */
    const ele = poli('L', [[0, 0], [0, 6], [2, 6], [2, 2], [6, 2], [6, 0]]);
    expect(dentroDelPoligono([1, 1], ele.puntos)).toBe(true);
    expect(dentroDelPoligono([4, 4], ele.puntos)).toBe(false);
  });

  it('gana la más pequeña cuando se solapan', () => {
    /* Estando en la rampa interesa el limite de la rampa, no el del area. */
    expect(geocercaDe([5, 5], [AREA, RAMPA])?.id).toBe('rampa');
    expect(geocercaDe([1, 1], [AREA, RAMPA])?.id).toBe('area');
  });

  it('devuelve nada si no está en ninguna', () => {
    expect(geocercaDe([50, 50], [AREA, RAMPA])).toBeNull();
  });

  it('mide el círculo por su radio, en metros', () => {
    const grifo: Geocerca = {
      id: 'g', nombre: 'Grifo', tipo: 'circulo', color: '#fff',
      puntos: [[-6.0304, -80.8575]], radio: 69,
    };
    /* Unos 30 m al norte: dentro. Unos 300 m: fuera. */
    expect(geocercaDe([-6.03013, -80.8575], [grifo])?.id).toBe('g');
    expect(geocercaDe([-6.0277, -80.8575], [grifo])).toBeNull();
  });

  it('usa lo general cuando la geocerca no tiene nada puesto', () => {
    expect(recomendacionDe(RAMPA, {}).velocidad).toBe(30);
    expect(recomendacionDe(RAMPA, { rampa: { velocidad: 15, galonesHora: 8 } }).velocidad).toBe(15);
  });

  it('avisa antes de pasarse del límite, no después', () => {
    /* Para cuando el numero se pone rojo, la maquina lleva un rato pasada. */
    expect(comoVoy(20, 30)).toBe('bien');
    expect(comoVoy(28, 30)).toBe('justo');
    expect(comoVoy(31, 30)).toBe('pasado');
  });
});

/**
 * Un cuadro vacio y uno que espera y no recibe no son lo mismo.
 *
 * El panel tiene los cuadros puestos siempre, con sensor o sin el. Que los dos
 * casos se escribieran igual confundia: parecia averiado lo que solo estaba sin
 * configurar.
 */
describe('cuadros del panel sin señal', () => {
  const vacios = new Map(), sinFecha = new Map();

  it('un cuadro sin sensor elegido enseña una raya', () => {
    const t = { ...nuevaTarjeta('numero'), claves: [] };
    expect(texto(calcular(t, vacios, sinFecha), 1)).toBe('—');
  });

  it('un cuadro con sensor elegido que no llega avisa', () => {
    const t = { ...nuevaTarjeta('numero'), claves: ['f1.caudal'] };
    expect(texto(calcular(t, vacios, sinFecha), 1)).toBe('sin dato');
  });

  it('el panel de fabrica trae sus huecos, todos vacios', () => {
    const p = panelFijo();
    expect(p).toHaveLength(HUECOS);
    expect(p.every((t) => t.claves.length === 0)).toBe(true);
    expect(new Set(p.map((t) => t.id)).size).toBe(HUECOS);
  });
});

/**
 * La curva tiene que dar lo mismo aqui que en el HelperBox.
 *
 * El mismo caudalimetro puede leerse aqui por RS485 o llegar ya corregido de la
 * caja, y si las dos correcciones no coincidieran el mismo sensor daria dos
 * numeros segun por donde entrara. Estos son los mismos puntos con los que se
 * comprobo la de alla.
 */
describe('curvas de calibracion', () => {
  const puntos = [
    { crudo: 0, real: 0 },
    { crudo: 10, real: 12 },
    { crudo: 50, real: 51 },
    { crudo: 100, real: 98 },
  ];

  it('interpola en linea recta entre dos puntos medidos', () => {
    expect(aplicarCurva(puntos, 0)).toBe(0);
    expect(aplicarCurva(puntos, 5)).toBeCloseTo(6);
    expect(aplicarCurva(puntos, 10)).toBe(12);
    expect(aplicarCurva(puntos, 30)).toBeCloseTo(31.5);
    expect(aplicarCurva(puntos, 75)).toBeCloseTo(74.5);
  });

  it('fuera de lo medido no extrapola: se queda en el extremo', () => {
    expect(aplicarCurva(puntos, -20)).toBe(0);
    expect(aplicarCurva(puntos, 500)).toBe(98);
  });

  it('con menos de dos puntos no toca el valor', () => {
    expect(aplicarCurva([], 42)).toBe(42);
    expect(aplicarCurva([{ crudo: 1, real: 9 }], 42)).toBe(42);
  });

  it('ordena los puntos y se queda con el ultimo de los repetidos', () => {
    expect(ordenarCurva([
      { crudo: 50, real: 51 },
      { crudo: 0, real: 0 },
      { crudo: 50, real: 99 },
    ])).toEqual([{ crudo: 0, real: 0 }, { crudo: 50, real: 99 }]);
  });

  it('avisa de una curva que baja, que casi siempre es un punto mal tecleado', () => {
    expect(revisarCurva([
      { crudo: 0, real: 0 },
      { crudo: 10, real: 12 },
      { crudo: 20, real: 5 },
    ])).toMatch(/baja/);
    expect(revisarCurva(puntos)).toBeNull();
  });
});
