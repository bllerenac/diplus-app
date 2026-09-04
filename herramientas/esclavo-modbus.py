#!/usr/bin/env python3
"""
Un caudalimetro Modbus RTU de mentira, para probar sin el aparato delante.

No inventa una lectura y la manda: **espera a que le pregunten**, que es lo que
hace un esclavo de verdad y lo que distingue esta prueba de una simulacion que
no prueba nada. Contesta a la funcion 3 y a la 4 con un caudal y un totalizador
que se mueven, en dos registros de 16 bits cada uno.
"""
import os, sys, time, struct

RUTA = sys.argv[1] if len(sys.argv) > 1 else '/dev/ttyS2'
ESCLAVO = int(sys.argv[2]) if len(sys.argv) > 2 else 1

def crc16(b):
    crc = 0xFFFF
    for x in b:
        crc ^= x
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc & 0xFFFF

os.system(f'stty -F {RUTA} 9600 raw -echo')
fd = os.open(RUTA, os.O_RDWR | os.O_NOCTTY)
print(f'esclavo {ESCLAVO} escuchando en {RUTA} a 9600', flush=True)

buf = b''
arranque = time.time()
while True:
    try:
        trozo = os.read(fd, 256)
    except BlockingIOError:
        time.sleep(0.02); continue
    if not trozo:
        time.sleep(0.02); continue
    buf += trozo
    print('entra:', buf.hex().upper(), flush=True)

    while len(buf) >= 8:
        t = buf[:8]
        buf = buf[8:]
        if t[0] != ESCLAVO or t[1] not in (3, 4):
            continue
        if crc16(t[:6]) != struct.unpack('<H', t[6:8])[0]:
            print('  CRC malo, se ignora', flush=True)
            continue

        n = struct.unpack('>H', t[4:6])[0]
        transcurrido = time.time() - arranque
        # caudal que oscila y totalizador que sube: se ve si esta vivo
        caudal = int(1200 + 300 * ((transcurrido % 20) / 20))
        total = int(50000 + transcurrido * 3)
        valores = [caudal, total] + [0] * max(0, n - 2)
        datos = b''.join(struct.pack('>H', v) for v in valores[:n])

        r = bytes([ESCLAVO, t[1], len(datos)]) + datos
        r += struct.pack('<H', crc16(r))
        os.write(fd, r)
        print('  responde:', r.hex().upper(), flush=True)
