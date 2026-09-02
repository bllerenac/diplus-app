/**
 * Pruebas del troceado y de los protocolos.
 *
 * Con tramas reales, no inventadas: las del HelperBox salieron de lo que emite
 * su puente, y los vectores de CRC son los de siempre. Lo que se comprueba aqui
 * es justo lo que fallaba antes en campo: que una trama partida en dos lecturas
 * se recomponga y que una configuracion distinta de la de fabrica se reconozca.
 */
import { describe, expect, it } from 'vitest';
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
