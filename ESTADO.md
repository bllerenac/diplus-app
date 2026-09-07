# Dónde estamos, al 7 de septiembre de 2026

Para retomar sin releer todo. Lo que hay montado, lo que está probado, lo que
falta y las trampas que ya nos costaron un rato.

## El montaje de ahora

```
HelperBox ──cable RJ45 directo──▶ Tablet AT-10L ──wifi──▶ internet
  192.168.60.1                     192.168.60.2 (eth0, fija)
  UDP difusión :9977               192.168.18.116 (wlan0, DHCP: cambia)
```

**El HelperBox manda y la tablet escucha. Nada más.** Un solo sentido, por
difusión UDP, una trama de JSON por segundo. Esa es toda la comunicación entre
los dos y funciona sin fallo.

Es así porque **el arnés del puerto B de la tablet no transmite**: ni Ethernet,
ni RS485, ni CAN. Medido: 20 tramas de la tablet al HelperBox, 0 recibidas; 20
del HelperBox a la tablet, 20 recibidas. Cambiar la pieza está aparcado por
decisión: por RJ45 solo queremos recibir.

El enlace, medido el 7 de septiembre: enlace arriba, full duplex, **0 cambios
de portadora en 30 s**, 30 paquetes en 30 s —uno por segundo, exacto—, 144
errores de recepción sobre 196 088 (0,07 %). Los 4158 cambios de portadora
acumulados son de antes, del parpadeo que resultó ser **nuestro propio sondeo
de RS485 metiéndose en el par de Ethernet**. Resuelto.

Único detalle raro: los dos extremos negocian **10 Mbit/s** en vez de 100.
Coherente con un arnés tocado. Da igual: usamos el 0,003 % de eso.

## Qué se hizo en esta sesión

En `diplus-app`, de lo más viejo a lo más nuevo:

| | |
|---|---|
| `5c49807` | Cada señal con su detalle: alias, unidad, curva, guardar, enviar |
| `1cae733` | La inercial en su pestaña; «Fuentes» pasa a «Sensores» |
| `7e71a84` | El frente del camión se señala en un dibujo |
| `942b5a0` | Ese dibujo pasa a radiografía 3D |
| `7d75af2` | Volquete de mina, suelo y giro animado |
| `87ea857` | Chivato con el equipo y sus ejes, abajo a la izquierda |
| `d5c633a` | **La vista de envío**: socket en directo y API por lotes |
| `b44a4d8` | `NOTAS-RUMBO.md` |
| `b237318` | La calibración de la inercial baja a la base, con su historia |
| `1b8a0e1` | El panel enseña sus ocho cuadros, no seis |
| `5a6d1f4` | El mapa no gira parado, y deja de dar tirones |
| `e19700f` | **El rumbo nunca llegaba**: se leía un campo que el puente no manda |
| `5fba7d1` | Se van los sensores repetidos en tres pestañas |
| `d52b565` | Cambiar el token del canal ya cierra la puerta al viejo |

En `helperbox-system`: `36d453e`, el camión de prueba.

## Lo que está probado de verdad

- **Envío por API**: 387 lecturas entregadas en lotes de 200 contra un receptor
  en la PC, con la cola de cinco pendientes soltada primero y en orden.
- **Envío por socket**: 31 envíos seguidos, con posición y unidades.
- **Camión de prueba → panel**: horas corriendo solo, el combustible bajando
  como debe.
- **Umbral del rumbo**: parado con fix real, el ángulo no se escribe ni una vez
  en 25 s; con la maqueta andando, de −39,6° a −29,9° en veinte segundos.
- **Token del canal**: se cambia sin reiniciar, el viejo pasa a 401 al momento.
- **Calibración de la inercial**: dos entradas en la base, con vector y hora.

## Lo que falta

**Primero, y es de seguridad:** apagar el camión de prueba antes de ir a un
camión de verdad. Borrar `/var/lib/helperbox/prueba` y reapuntar los ocho
cuadros a las señales del caudalímetro real. Ahora el panel enseña **datos
inventados**, y lo único que los distingue es el prefijo `prueba.`.

**Probar en el camión**, que es lo único que no se puede hacer en la mesa:

- Que el rumbo llega ahora (ver `NOTAS-RUMBO.md`).
- Que el umbral suelta y engancha donde toca; se ajusta en Posición.
- El eje de avance de la inercial, con el botón de medir acelerando.

**La SIM.** La conexión será por red celular. El módem está y ve Bitel, pero
`OUT_OF_SERVICE`, sin SIM registrada, `rmnet_ipa0` sin dirección. Hoy internet
entra **solo por la wifi de la oficina**. Al ponerla, conviene subir el tamaño
del lote y bajar la frecuencia del envío: con cobertura que va y viene, es
mejor mandar poco y grande que mucho y pequeño.

**Menores:** Tailscale instalado pero apagado en la tablet; el HelperBox
colgado del hotspot de esta PC (`192.168.137.30`), así que su acceso remoto
muere si se apaga la PC; el logcat inundado de NMEA; y commits sin subir en
`marcobre-server` y `edge-computer` de sesiones anteriores.

**Y una decisión pendiente:** el token del canal es `gunjop-2026`, que se
adivina. Es la llave de `/config`, que reconfigura el equipo entero. Para la
mina, algo largo y aleatorio.

## Trampas que ya nos costaron un rato

**El `gap` de flexbox no existe en este WebView.** Es el 78 y llegó en el 84;
en rejilla sí funciona. Por eso los botones en cuadrícula salían bien y todo lo
que iba en flex salía pegado. Hay un remedo con márgenes al final de
`theme/diplus.css`, para los tamaños que se usan: **si añades un `gap-N` nuevo
en un contenedor flex, hay que añadirlo allí**.

**Un WebView es un navegador.** El envío por API va por el puente nativo
(`CapacitorHttp`) y no por `fetch`, porque `fetch` manda un `OPTIONS` de
permiso antes de cada envío y descarta la respuesta si no ve cabeceras de CORS.
Dos `OPTIONS` por vuelta y ni un `POST`.

**La IP de la tablet es del DHCP y cambia.** Hoy pasó de la `.121` a la `.116`
y la PC de la `.117` a la `.118`. Si se pierde el ADB, hay que barrer la
subred buscando su MAC: `0c:58:7b:62:13:e6`. El enlace con el HelperBox no se
entera: va por el cable, con direcciones fijas.

**El ADB por red no sobrevive a un reinicio de la tablet.**
`persist.adb.tcp.port` necesita root más allá de lo que alcanza la aplicación.
Hay que rehabilitarlo con el cable USB.

**«Derecha, techo, morro» es una terna zurda.** Es la forma natural de decir
cómo está puesto un camión, pero no es un giro sino un giro **más un espejo**,
y de una matriz así no sale ningún cuaternión. Está explicado en
`paginas/montaje.tsx`; si algo del 3D sale al revés, mirar ahí primero.

**Para configurar la tablet sin pelearse con la pantalla** está
`scratchpad/cdp.js`: evalúa lo que le pases en el WebView por el protocolo de
depuración de Chrome. Escribir en `localStorage` y `location.reload()` en la
misma expresión, o la aplicación en marcha lo pisa.
