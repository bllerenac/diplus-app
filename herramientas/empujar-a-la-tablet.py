#!/usr/bin/env python3
"""
Empuja las lecturas del HelperBox a la tablet, sin esperar nada a cambio.

La boca de red de la tablet **recibe pero no transmite**: esta medido, 20 de 20
tramas entrando y 0 de 20 saliendo. Con eso no hay TCP posible —cada paso
necesita respuesta— ni se puede resolver un ARP. Por eso esto es UDP a la
direccion de difusion: no hace falta saber la MAC del otro ni que conteste.

Manda la misma linea de JSON que ya emite el puente por el cable serie, para
que al otro lado se decodifique con el protocolo que ya existe.
"""
import json, socket, time, urllib.request

PUERTO = 9977
DESTINO = '192.168.60.255'
PANEL = 'http://127.0.0.1:3001/api/senales'
CADA = 1.0

s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
print('empujando a %s:%d cada %.1f s' % (DESTINO, PUERTO, CADA), flush=True)

n = 0
while True:
    try:
        with urllib.request.urlopen(PANEL, timeout=3) as r:
            senales = json.loads(r.read().decode())
        linea = {'at': int(time.time() * 1000)}
        for x in senales:
            linea[x['clave']] = x['valor']
        dato = (json.dumps(linea) + '\n').encode()
        s.sendto(dato, (DESTINO, PUERTO))
        n += 1
        if n % 30 == 1:
            print('%d enviadas, ultima de %d bytes' % (n, len(dato)), flush=True)
    except Exception as e:
        print('fallo: %s' % e, flush=True)
    time.sleep(CADA)
