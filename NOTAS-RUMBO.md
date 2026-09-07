# De dónde sale el rumbo del mapa, y qué le falta

Nota del 6 de septiembre de 2026. **El umbral y el suavizado ya estan hechos**
—ver `nucleo/rumbo.ts`—; lo que queda pendiente es lo del giroscopo, al final.

## Cómo está hoy

El rumbo sale **solo del GPS**. La unidad inercial no interviene.

- Con el RTK: `course` de la sentencia NMEA — `nucleo/gps.ts:118`.
- Con el GPS interno de respaldo: `bearing` de Android — `nucleo/gps.ts:138`.
- Se filtra en `nucleo/rumbo.ts` y se aplica en `paginas/Navegacion.tsx`, `girar(p)`.

**La flecha no rota nunca**: apunta siempre hacia arriba de la pantalla. Lo que
gira es el mapa por debajo (`--giro` sobre el lienzo) y los nombres de las
geocercas se desgiran (`--desgiro`) para no quedar del revés. Es lo que hace
que se sienta como un navegador y no como un plano.

Los dos valores son **rumbo sobre el terreno**: la dirección entre dos
posiciones seguidas. Hacia dónde **se mueve** el camión, no hacia dónde
**mira**.

## Lo que fallaba

**Parado, el rumbo no significa nada.** Sin movimiento no hay dos posiciones
que comparar: el receptor devuelve cero o el último valor, con ruido. El mapa
giraba solo con el camión detenido en la cola de la pala. No había ningún
umbral: `girar()` se llamaba con cada posición, fuera a 40 km/h o parado.

**Y daba tirones**, porque el mapa perseguía el rumbo entero, ruido incluido.

**Marcha atrás sale al revés.** El rumbo apunta a donde va, así que retrocediendo
el mapa se da la vuelta aunque el camión siga mirando al mismo sitio. Esto no
tiene arreglo desde el GPS y sigue igual.

## Qué se hizo, el 7 de septiembre

Todo en `nucleo/rumbo.ts`, con sus pruebas en `nucleo.test.ts`.

1. **Umbral de velocidad con histéresis.** Por debajo de 1,5 m/s el mapa se
   queda como estaba; vuelve a girar pasando de 2,5. Dos números y no uno: con
   uno solo, un camión oscilando alrededor del umbral engancha y suelta el giro
   sin parar.
2. **Suavizado.** El rumbo que se pinta es una media con el anterior, así los
   tirones se quedan en el filtro y las curvas de verdad pasan.

Los dos umbrales y el suavizado, configurables desde Posición: se ajustan en el
camión, no aquí.

**Tope de grados por segundo no hay, y es a propósito.** La animación ya la hace
el navegador —medio segundo de transición sobre `.nav-lienzo`— y añadir un tope
propio serían dos frenos peleándose, con el mapa llegando tarde a las curvas sin
saber cuál de los dos lo retrasa.

Comprobado en el equipo: parado sobre la mesa con fix real, `--giro` no llega a
escribirse nunca; con la maqueta andando, va de −39,6° a −29,9° en veinte
segundos, poco a poco.

## Qué no hacer, y por qué

**La brújula, no**, aunque el hardware esté (MMC3680KJ, ver abajo). Dentro de
la cabina de un volquete hay acero, motor y alternador: miente, y miente
distinto según dónde estés y qué esté haciendo la máquina, que es la peor forma
de mentir porque parece un dato bueno. Calibrarla pide hacer ochos, y nadie va
a hacer ochos con un camión de cien toneladas.

Y hay una razón de fondo: la brújula dice hacia dónde mira **la tablet**, que
está en un soporte que alguien mueve de un codazo. El GPS dice hacia dónde se
mueve **el camión**, que es lo que el mapa tiene que seguir.

## Para después, si el parado sigue molestando

Llevar el rumbo con el **giróscopo** mientras está parado. Es viable: ya se sabe
cómo está montado el equipo —el eje de avance y el techo salen del montaje, ver
`paginas/montaje.tsx`—, así que se sabe qué componente del giróscopo es el giro
del camión sobre sí mismo. La deriva en un par de minutos parado son unos pocos
grados y se corrige sola en cuanto arranca.

Se deja para después porque es otra cosa que puede salir con el signo cambiado
y solo se nota casi parado. Si con el umbral y el suavizado el parado ya no
molesta, no hace falta.

**La marcha atrás no tiene solución desde el GPS**: no hay forma de distinguir
«voy marcha atrás» de «me di la vuelta». Con el umbral casi no se nota, porque
retroceder a la descarga se hace despacio.

## Los sensores que tiene el equipo

De `adb shell dumpsys sensorservice`. Físicos hay cuatro; el resto son
combinaciones que calcula Android a partir de ellos.

| Físico | Pieza | Hasta |
|---|---|---|
| Acelerómetro | InvenSense MPU6500 | 200 Hz |
| Giróscopo | InvenSense MPU6500 | 250 Hz |
| Magnetómetro | MEMSIC MMC3680KJ | 50 Hz |
| Luz y proximidad | Sensortek stk3x1x | — |

**No hay barómetro** y **no hay sensor de temperatura ambiente**.

Calculados por Android sobre esos cuatro: gravedad, aceleración lineal (sin
gravedad), vector de rotación, vector de rotación de juego (sin brújula),
vector de rotación geomagnético, orientación, detector de inclinación,
detector y contador de pasos, podómetro, detección de movimiento
significativo, y los clasificadores de movimiento de Qualcomm (AMD, RMD, CMC,
gestos, facing).

De todos ellos hoy solo se usan el acelerómetro y el giróscopo, en
`nucleo/movimiento.ts`. Dos que podrían servir sin tocar la brújula:

- **Aceleración lineal** (`linear_acceleration`): la aceleración ya con la
  gravedad quitada, hecha por el sistema. Hoy se le resta a mano usando la
  referencia calibrada; es equivalente y funciona, pero si algún día molesta
  calibrar, esto lo evita.
- **Gravedad** (`gravity`): el vector gravedad filtrado. Daría la inclinación
  más limpia que el acelerómetro en crudo, que en vía mala lleva encima todas
  las sacudidas.
