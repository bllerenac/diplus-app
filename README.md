# DIPLUS-APP | Manual Completo de Operación y Funcionamiento de la Tablet

> **Sistema Telemático Embarcado para Maquinaria Pesada y Minería a Tajo Abierto**  
> **Plataforma:** Tablet Industrial Android 9 (ej. AT-10L)  
> **Tecnologías:** Ionic Framework · React 19 (TypeScript) · Capacitor 8 · Sockets Nativos Linux / Android (C/Java)  
> **Persistencia Local:** IndexedDB (`diplus.lecturas.v1`) con tolerancia a fallos y modo Store & Forward (cero pérdida de datos).

---

## 📑 Tabla de Contenidos

1. [Visión General y Propósito del Equipo](#1-visión-general-y-propósito-del-equipo)
2. [Ciclo de Vida, Arranque y Modo Kiosco](#2-ciclo-de-vida-arranque-y-modo-kiosco)
3. [Topología de Red y Conectividad Física](#3-topología-de-red-y-conectividad-física)
4. [Entradas de Sensores y Adquisición de Hardware](#4-entradas-de-sensores-y-adquisición-de-hardware)
   - 4.1. [Ethernet RJ45 / UDP (HelperBox)](#41-ethernet-rj45--udp-helperbox)
   - 4.2. [RS485 / Modbus RTU (Caudalímetros de Combustible)](#42-rs485--modbus-rtu-caudalímetros-de-combustible)
   - 4.3. [Bus CAN / J1939 (SocketCAN)](#43-bus-can--j1939-socketcan)
   - 4.4. [GPS / GNSS Interno (NMEA Serie) y Filtro de Rumbo](#44-gps--gnss-interno-nmea-serie-y-filtro-de-rumbo)
   - 4.5. [Inercial (IMU) y Radiografía 3D del Camión](#45-inercial-imu-y-radiografía-3d-del-camión)
   - 4.6. [Horómetro de Motor y Operación](#46-horómetro-de-motor-y-operación)
   - 4.7. [Modo Maqueta / Simulación](#47-modo-maqueta--simulación)
5. [Motor de Datos, Curvas y Persistencia Offline](#5-motor-de-datos-curvas-y-persistencia-offline)
6. [Pantallas y Funcionamiento para el Operador](#6-pantallas-y-funcionamiento-para-el-operador)
   - 6.1. [Pantalla Principal (Navegación, Mapa y Tablero)](#61-pantalla-principal-navegación-mapa-y-tablero)
   - 6.2. [Pantalla de Ajustes y Sensores](#62-pantalla-de-ajustes-y-sensores)
   - 6.3. [Pantalla de Inercial y Montaje 3D](#63-pantalla-de-inercial-y-montaje-3d)
   - 6.4. [Pantalla de Ajuste de Horómetro](#64-pantalla-de-ajuste-de-horómetro)
   - 6.5. [Pantalla de Monitor / Sniffer](#65-pantalla-de-monitor--sniffer)
   - 6.6. [Pantalla de Envíos y Consola de Debug](#66-pantalla-de-envíos-y-consola-de-debug)
7. [Transmisión Telemática por MQTT (Tiempo Real)](#7-transmisión-telemática-por-mqtt-tiempo-real)
8. [Transmisión Telemática por API REST (Histórico sin Pérdida)](#8-transmisión-telemática-por-api-rest-histórico-sin-pérdida)
9. [Canales de Diagnóstico, Servidor y Actualizaciones OTA](#9-canales-de-diagnóstico-servidor-y-actualizaciones-ota)
10. [Estructura del Proyecto y Código Fuente](#10-estructura-del-proyecto-y-código-fuente)
11. [Comandos de Compilación, Despliegue y Diagnóstico](#11-comandos-de-compilación-despliegue-y-diagnóstico)

---

## 1. Visión General y Propósito del Equipo

La tablet industrial instalada en la cabina del volquete o maquinaria pesada cumple tres funciones críticas:

1. **Computadora de A Bordo (HMI en Cabina):**  
   Proporciona al conductor un tablero táctil de alto contraste con manómetros, tanques y velocímetros numéricos, navegación con mapa satelital propio y geocercas mineras offline, velocidad recomendada por tramo, advertencias de consumo y radiografía 3D de inclinación.
2. **Concentrador y Procesador de Sensores (Edge Computing):**  
   Adquiere señales de múltiples interfaces físicas (Ethernet UDP, RS485 Modbus, CAN J1939, GPS serie, IMU Android), calcula variables compuestas en tiempo real (consumo diferencial $Entrada - Retorno$, totalizadores acumulados, detección de irregularidades en la vía) y aplica calibraciones sin necesidad de tocar el servidor.
3. **Caja Negra y Terminal Telemático Resiliente (Store & Forward):**  
   Transmite telemetría en tiempo real por **MQTT** (TCP 1883) al centro de control. Simultáneamente, almacena cada dato en su base interna (**IndexedDB**) y los envía por **API REST** en lotes con cola de reintentos progresivos, garantizando **cero pérdida de datos** cuando la unidad opera en zonas ciegas o tajos sin cobertura celular.

---

## 2. Ciclo de Vida, Arranque y Modo Kiosco

La tablet está configurada para operar de manera autónoma en cabina sin intervención del conductor:

```
[Arranque del Vehículo / Alimentación Eléctrica]
                     │
                     ▼
             Boot de Android 9
                     │
                     ▼
          ArranqueReceptor.java (BOOT_COMPLETED)
                     │ Lanza automáticamente MainActivity
                     ▼
           MainActivity / KioscoPlugin.java
         ┌──────────────────────────────────────┐
         │ · Modo Inmersivo (Sin barra ni dock) │
         │ · FLAG_KEEP_SCREEN_ON (Siempre viva) │
         │ · Anulación de gestos de salida      │
         └──────────────────┬───────────────────┘
                            │
                            ▼
               Carga de WebView + React 19
                            │
    ┌───────────────────────┴───────────────────────┐
    │                                               │
    ▼                                               ▼
Inicialización de Sensores y Canales     Carga de Plano y Geocercas Offline
(GPS, RS485, CAN, UDP, MQTT, API)        (Desde localStorage / IndexedDB)
```

- **Autoinicio (`ArranqueReceptor.java`):** Escucha el evento del sistema `ACTION_BOOT_COMPLETED`. Al encenderse la máquina, la aplicación arranca sola sin necesidad de tocar la pantalla.
- **Modo Kiosco (`KioscoPlugin.java`):**
  - Mantiene la pantalla encendida de forma indefinida (`FLAG_KEEP_SCREEN_ON`).
  - Oculta la barra de notificaciones superior y los botones de navegación de Android (`SYSTEM_UI_FLAG_IMMERSIVE_STICKY`, `SYSTEM_UI_FLAG_FULLSCREEN`, `SYSTEM_UI_FLAG_HIDE_NAVIGATION`).
- **Recuperación tras caídas:** Si la aplicación experimenta un fallo o se reinicia, el servicio nativo relanza la actividad principal y restaura el estado guardado.

---

## 3. Topología de Red y Conectividad Física

El equipo gestiona múltiples interfaces de red de forma simultánea:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        TABLET INDUSTRIAL AT-10L                        │
│                                                                        │
│  [eth0: 192.168.60.2] ─────────────── [RJ45 Directo] ──▶ HelperBox    │
│   (IP estática, solo RX)                                192.168.60.1   │
│                                                                        │
│  [wlan0: DHCP 192.168.x.x] ────────── [Wi-Fi] ─────────▶ Oficina/Taller│
│                                                                        │
│  [rmnet_ipa0: Móvil] ──────────────── [Módem 4G/LTE] ──▶ Internet/Nube │
│   (Bitel / SIM industrial)                                             │
│                                                                        │
│  [tailscale0: 100.x.x.x] ──────────── [VPN Segura] ───▶ Centro Control│
└────────────────────────────────────────────────────────────────────────┘
```

### Particularidades Críticas de Hardware:
1. **Enlace Ethernet con HelperBox (Cable RJ45 Directo):**
   - Dirección de la Tablet: `192.168.60.2` (interfaz `eth0`, IP fija).
   - Dirección del HelperBox: `192.168.60.1`.
   - **Comportamiento Unidireccional (Solo RX):** El arnés del puerto B de la tablet está configurado para recepción exclusivamente. El HelperBox emite por difusión UDP al puerto `9977` a razón de 1 trama por segundo y la tablet escucha sin responder.
   - **Velocidad de enlace:** Negociada a 10 Mbps Full Duplex para máxima inmunidad al ruido eléctrico del camión.
2. **Red Celular Móvil:**
   - La conectividad en ruta depende del módem celular interno (`rmnet_ipa0`).
   - Cuando hay señal celular, se activan los flujos MQTT y API REST.
   - En zonas de sombra o túneles, la aplicación pasa a modo búfer offline sin emitir alertas molestas al operador.

---

## 4. Entradas de Sensores y Adquisición de Hardware

Toda la adquisición nativa está implementada en [CanRs485Plugin.java](file:///e:/Claude/campo/tablet/android/app/src/main/java/com/diplus/app/CanRs485Plugin.java) y [MovimientoPlugin.java](file:///e:/Claude/campo/tablet/android/app/src/main/java/com/diplus/app/MovimientoPlugin.java).

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             FUENTES DE DATOS                             │
└────┬──────────────────┬───────────────────┬───────────────────┬──────────┘
     │                  │                   │                   │
     ▼                  ▼                   ▼                   ▼
[Ethernet UDP:9977]  [RS485: ttyUSB0]   [CAN: can0]    [GPS: ttyHSL2]
HelperBox JSON       Modbus RTU         SocketCAN      NMEA @ 921600
Caudal/Niveles       Caudalímetros      DFM / J1939    Posición / Rumbo
```

### 4.1. Ethernet RJ45 / UDP (HelperBox)
- **Protocolo:** `helperbox-json`
- **Puerto de Escucha:** UDP `9977`
- **Funcionamiento:** Un hilo en segundo plano abre un `DatagramSocket` en `0.0.0.0:9977`. Cada segundo llega un paquete JSON emitido por el HelperBox con el estado de los sensores conectados a esa caja de adquisición.
- **Procesamiento:** Se extraen las claves numéricas y se inyectan directamente al motor reactivo de señales de la tablet.

### 4.2. RS485 / Modbus RTU (Caudalímetros de Combustible)
- **Puerto Serie:** Adaptador USB-Serie `/dev/ttyUSB0` (o UART nativo `/dev/ttyHSL0`).
- **Parámetros de Línea:** 9600 baudios, 8 bits de datos, sin paridad, 1 bit de parada (`8N1`).
- **Modo Operativo:** Maestro Modbus RTU cíclico (Función 03 `Read Holding Registers`):
  - **Esclavo 2 (Caudalímetro de Ingreso / Alimentación):**
    - Registro `0` (32 bits, Big Endian `u32be`): **Totalizador de Entrada** (Litros).
    - Registro `2` (16 bits, Big Endian `u16be`): **Caudal Instantáneo de Entrada** (L/h).
  - **Esclavo 3 (Caudalímetro de Retorno):**
    - Registro `0` (32 bits, Big Endian `u32be`): **Totalizador de Retorno** (Litros).
    - Registro `2` (16 bits, Big Endian `u16be`): **Caudal Instantáneo de Retorno** (L/h).
- **Cálculo de Consumo Neto:**
  $$\text{Caudal Neto (L/h)} = \max(0, \text{Caudal Ingreso} - \text{Caudal Retorno})$$
  $$\text{Totalizador Neto (L)} = \max(0, \text{Totalizador Ingreso} - \text{Totalizador Retorno})$$

### 4.3. Bus CAN / J1939 (SocketCAN)
- **Interfaz:** `can0`
- **Velocidades:** 250 000 bps (estándar SAE J1939) o 500 000 bps.
- **Mapeo:** Decodificación de identificadores CAN de 29 bits (PGNs de motor: RPM, temperatura de refrigerante, presión de aceite, combustible consumido por ECU).

### 4.4. GPS / GNSS Interno (NMEA Serie) y Filtro de Rumbo
- **Puerto Físico:** `/dev/ttyHSL2` a una velocidad de **921 600 baudios**.
- **Parser NMEA:** Decodifica sentencias `$GPRMC`, `$GPGGA`, `$GNVTG`, `$GNGSA`.
- **Valores Extraídos:**
  - Latitud y Longitud (grados decimales WGS84).
  - Altitud sobre el nivel del mar (metros).
  - Velocidad sobre el suelo (km/h y m/s).
  - Calidad del Fix: `Sin Fix`, `GPS 2D/3D`, `DGPS`, `RTK Float`, `RTK Fijo`.
  - Número de satélites en uso.
- **Filtro de Rumbo (*Heading*) con Histéresis:**  
  Cuando un camión se detiene en una pala o botadero, el ruido intrínseco del GPS hace que el ángulo salte erráticamente. El módulo [rumbo.ts](file:///e:/Claude/campo/tablet/src/nucleo/rumbo.ts) implementa un filtro:
  - Si la velocidad es menor al umbral configurado (ej. 3 km/h), el rumbo queda congelado.
  - Al iniciar la marcha, el giro del mapa se interpola suavemente por el arco más corto para evitar saltos visuales bruscos.

### 4.5. Inercial (IMU) y Radiografía 3D del Camión
- **Sensores:** Acelerómetro y Giroscopio integrados de la tablet (`Sensor.TYPE_ACCELEROMETER`, `Sensor.TYPE_GYROSCOPE`).
- **Mediciones:**
  - **Inclinación Longitudinal (*Pitch*):** Pendiente de subida o bajada en grados.
  - **Inclinación Lateral (*Roll*):** Ángulo de peralte o inclinación en rampa en grados.
  - **Rugosidad de Vía (*Baches y Frenadas*):** Integración de aceleración vertical y longitudinal para registrar impactos severos en la estructura del camión.
- **Calibración de Montaje 3D ([montaje.tsx](file:///e:/Claude/campo/tablet/src/paginas/montaje.tsx)):**
  Permite instalar la tablet en cualquiera de sus 6 orientaciones físicas posibles (de pie contra el parabrisas, de pie mirando al conductor, tumbada en 4 sentidos). Transforma la matriz de coordenadas del equipo a las coordenadas del camión mediante cuaterniones y cálculo vectorial.

### 4.6. Horómetro de Motor y Operación
- **Cálculo Autónomo ([horometro.ts](file:///e:/Claude/campo/tablet/src/nucleo/horometro.ts)):**
  - Registra las horas transcurridas mientras la máquina está activa (detección por flujo de combustible > 0, velocidad > 0 o alimentación encendida).
  - Se guarda periódicamente en el almacenamiento local y se protege contra descalibraciones accidentales.

### 4.7. Modo Maqueta / Simulación
- Para demostraciones o pruebas de laboratorio sin camión ni sensores conectados, la opción **Maqueta** genera un camión virtual con combustible en descenso realista, aceleración, frenado y recorrido por las geocercas mineras. Una franja superior amarilla avisa de forma permanente: *"Datos de prueba · nada de esto es real"*.

---

## 5. Motor de Datos, Curvas y Persistencia Offline

El núcleo de datos ([src/nucleo/](file:///e:/Claude/campo/tablet/src/nucleo/)) opera como un bus reactivo desacoplado de la interfaz:

```
Trama Cruda (Serial / CAN / UDP)
             │
             ▼
   Desempaquetado de Bytes / JSON
             │
             ▼
   Curvas de Calibración (curva.ts)
   · Escala lineal: y = ax + b
   · Polinomios de calibración
   · Filtros de ruido / límite
             │
             ▼
   Catálogo de Señales Unificadas (hardware.ts)
   ├── [Mandar a Pantalla]  ──▶ Dashboard / Tarjetas
   ├── [Guardar en Base]    ──▶ IndexedDB: lecturas (72h retención)
   └── [Mandar hacia fuera] ──▶ MQTT (tiempo real) y API (lotes)
```

### Estructura de la Base de Datos Local (IndexedDB `diplus.lecturas.v1`):
1. **Tabla `lecturas`:**  
   Guarda cada muestra individual con `clave`, `valor`, `texto`, `at` (timestamp ms), `lat`, `lon`. Posee un índice compuesto `clave_at` para consultas históricas y purgado automático de registros mayores a 72 horas.
2. **Tabla `snapshots`:**  
   Guarda instantáneas completas en formato JSON Miskimayo asociadas a la bandera `enviado` (`0` = pendiente, `1` = confirmado por el servidor).
3. **Tabla `pendientes`:**  
   Búfer FIFO de paquetes HTTP rechazados por falta de red, listos para ser reintentados en cuanto regrese la conectividad.

---

## 6. Pantallas y Funcionamiento para el Operador

La interfaz gráfica está organizada en vistas accesibles desde el menú táctil:

```
[Navegación / Dashboard] ─── (Pantalla Principal de Operación en Cabina)
         │
         ├── [Ajustes] ───── Configuración de Puertos, Sensores y Curvas
         ├── [Montaje 3D] ── Calibración de Inclinación y Posición de Tablet
         ├── [Horómetro] ─── Ajuste manual de horas acumuladas
         ├── [Monitor] ───── Sniffer y depurador de tramas crudas
         └── [Envíos] ────── Monitoreo de MQTT, API REST y Consola de Red
```

### 6.1. Pantalla Principal (Navegación, Mapa y Tablero)
Es la vista que acompaña al conductor durante todo su turno de trabajo:
- **Mapa Satelital con Rotación Dinámica:**  
  Carga el ortofoto georreferenciado de la mina y rota en tiempo real según el rumbo del camión. La flecha del vehículo siempre apunta hacia arriba con un haz verde de proyección de marcha.
- **Geocercas Operativas:**  
  Dibuja polígonos y círculos con colores temáticos (Pala de carguío, Botadero de desmonte, Chancadora, Taller, Vía de acarreo).
- **Caja de Velocidad y Consejo:**  
  En la esquina superior izquierda enseña la velocidad actual en km/h junto al límite de velocidad de la geocerca actual. En la esquina inferior muestra el consumo instantáneo (gal/h) comparado contra el consumo objetivo recomendado.
- **Chivato de Estado de Vía y Cuesta:**  
  Muestra la pendiente del terreno en grados, detección de baches e índice de vibración de la pista.
- **Panel Lateral de 8 Tarjetas de Instrumentos:**  
  Cuadrantes radiales, tanques animados con nivel de líquido, termómetros verticales e indicadores numéricos configurables por el usuario.
- **Barra de Despacho:**  
  Indica nombre del operador asignado, origen (`desde`), destino (`hacia`), viajes completados y toneladas acarreadas en el turno.

### 6.2. Pantalla de Ajustes y Sensores
- Permite dar de alta puertos serie (`/dev/ttyUSB0`), baudios, sockets CAN o puertos UDP.
- En el detalle de cada señal se configura su nombre formal, unidad de medida, curva de conversión matemática, si se almacena en base de datos y si sale por telemetría.

### 6.3. Pantalla de Inercial y Montaje 3D
- Muestra una **radiografía 3D de alambre de un volquete minero** y un bloque macizo que representa la tablet dentro de la cabina.
- Permite seleccionar la orientación de instalación o presionar el botón **"Acelerar para medir"**: el sistema analiza la aceleración del vehículo durante 5 segundos y detecta automáticamente el eje de avance sin margen de error humano.

### 6.4. Pantalla de Ajuste de Horómetro
- Permite ingresar las horas reales de motor (según el tablero físico del camión) mediante teclado táctil con confirmación por PIN para mantener sincronizadas las lecturas de mantenimiento.

### 6.5. Pantalla de Monitor / Sniffer
- Herramienta de diagnóstico de campo para técnicos: inspecciona en crudo los bytes que circulan por RS485, tramas CAN recibidas por segundo y paquetes UDP de HelperBox.

### 6.6. Pantalla de Envíos y Consola de Debug
- Muestra semáforos en vivo de los canales de salida (**MQTT**, **API**, **Socket**), cantidad de envíos exitosos, hora del último paquete y mensajes de error.
- Permite activar o desactivar cada canal, ajustar frecuencias de envío y mapear manualmente los 18 campos de telemetría.
- **Consola de Red en Tiempo Real:** Log interactivo que muestra las peticiones HTTP enviadas, respuestas del servidor (`HTTP 200 OK`, `HTTP 401`, errores de red) y publicaciones MQTT.

---

## 7. Transmisión Telemática por MQTT (Tiempo Real)

Diseñado para despacho y monitoreo instantáneo desde el centro de control.

```
[Tablet Android 9]
       │
       │ TCP Puerto 1883 nativo (MqttPlugin.java)
       ▼
[Broker MQTT: paranoid.lat]
       │
       │ Topic: /miskimayo/diplus/SC-03
       ▼
[Centro de Control / Servidor de Flota]
```

### Configuración del Canal:
- **Broker:** `paranoid.lat` (configurable en pantalla).
- **Puerto:** `1883`.
- **Credenciales:** Usuario y contraseña configurables (por defecto `test` / `test1234`).
- **Topic Dinámico:** `/miskimayo/diplus/{{unit_id}}` (ej. `/miskimayo/diplus/SC-03`).
- **Intervalo:** Por defecto **cada 5 segundos**.

### Estructura Exhaustiva del Payload (Modelo Miskimayo - 18 Campos):
```json
{
  "unit": "SC-03",
  "speed": 24.5,
  "lat": -15.123456,
  "lon": -75.123456,
  "timestamp": "2026-09-23T14:40:00.000Z",
  "caudalFlow": 34.2,
  "inputFlow": 42.5,
  "outputFlow": 8.3,
  "sensorVolume": 450.0,
  "sensorLevel": 85.5,
  "volumen": 12850.4,
  "rawValue": 42.5,
  "totalized": 12850.4,
  "alt": 2450.8,
  "pitch": 2.1,
  "roll": -0.8,
  "heading": 178.4,
  "horometro": 4120.7
}
```

### Diccionario de Datos:
| Clave | Tipo | Unidad | Descripción Técnica |
|---|---|---|---|
| `unit` | `string` | — | Nombre identificador de la unidad (ej. `"SC-03"`). |
| `speed` | `number` | km/h | Velocidad instantánea del camión calculada por GPS. |
| `lat` | `number` | ° | Latitud geográfica decimal en datum WGS84. |
| `lon` | `number` | ° | Longitud geográfica decimal en datum WGS84. |
| `timestamp` | `string` | ISO 8601 | Marca de tiempo universal coordinada (UTC). |
| `caudalFlow` | `number` | L/h | Flujo neto de combustible consumido por el motor ($inputFlow - outputFlow$). |
| `inputFlow` | `number` | L/h | Caudal medido en la línea de alimentación hacia los inyectores. |
| `outputFlow` | `number` | L/h | Caudal medido en la línea de retorno hacia el estanque. |
| `sensorVolume` | `number` | L | Volumen actual de combustible presente en el tanque. |
| `sensorLevel` | `number` | % | Porcentaje de llenado del estanque. |
| `volumen` | `number` | L | Consumo volumétrico acumulado histórico de la unidad. |
| `rawValue` | `number` | u | Lectura en bruto entregada por el sensor primario. |
| `totalized` | `number` | L | Totalizador acumulado neto de combustible ($Total_{ingreso} - Total_{retorno}$). |
| `alt` | `number` | m | Altura ortométrica sobre el nivel medio del mar. |
| `pitch` | `number` | ° | Grados de inclinación longitudinal (+ subida, - bajada). |
| `roll` | `number` | ° | Grados de balanceo lateral (+ inclinación der, - izq). |
| `heading` | `number` | ° | Rumbo de marcha de 0.0° a 359.9° filtrado por umbral de movimiento. |
| `horometro` | `number` | h | Horas acumuladas de operación de la máquina. |

---

## 8. Transmisión Telemática por API REST (Histórico sin Pérdida)

Diseñado para almacenamiento central en bases de datos analíticas con **garantía estricta de no duplicación y cero pérdida**.

```
[Tablet Android 9]
       │
       │ POST HTTPS nativo (CapacitorHttp)
       ▼
[API Backend: https://miskimayo-back.wapsi.io/api/tracing/SC-03]
       │
       │ Respuesta HTTP 200 OK
       ▼
[Marca de Snapshots como Enviados en IndexedDB]
```

### Configuración del Canal:
- **URL Endpoint:** `https://miskimayo-back.wapsi.io/api/tracing/{{unit_id}}` (reemplaza `{{unit_id}}` por el nombre de la máquina).
- **Método:** `POST`
- **Cabeceras:** `Content-Type: application/json` y `Authorization: Bearer <TOKEN>` (opcional según el servidor).
- **Transporte Nativo:** Emplea `CapacitorHttp` para omitir verificaciones previas de CORS que provocarían fallos en WebViews de Android 9.
- **Intervalo:** Por defecto **cada 10 segundos**.

### Modos de Operación por API:

#### 1. Modo Snapshots Históricos (Prioridad Máxima)
Cuando la máquina regresa a una zona con cobertura 4G/LTE tras operar sin señal, la tablet lee de IndexedDB hasta **100 snapshots pendientes** y los envía como un array JSON:

```json
[
  {
    "unit": "SC-03",
    "speed": 22.0,
    "lat": -15.123400,
    "lon": -75.123410,
    "timestamp": "2026-09-23T14:38:00.000Z",
    "caudalFlow": 31.5,
    "inputFlow": 40.0,
    "outputFlow": 8.5,
    "sensorVolume": 451.0,
    "sensorLevel": 85.8,
    "volumen": 12845.0,
    "rawValue": 40.0,
    "totalized": 12845.0,
    "alt": 2450.0,
    "pitch": 1.5,
    "roll": -0.2,
    "heading": 175.0,
    "horometro": 4120.6
  },
  {
    "unit": "SC-03",
    "speed": 23.5,
    "lat": -15.123420,
    "lon": -75.123430,
    "timestamp": "2026-09-23T14:38:05.000Z",
    "caudalFlow": 33.0,
    "inputFlow": 41.5,
    "outputFlow": 8.5,
    "sensorVolume": 450.8,
    "sensorLevel": 85.7,
    "volumen": 12845.5,
    "rawValue": 41.5,
    "totalized": 12845.5,
    "alt": 2450.2,
    "pitch": 1.8,
    "roll": -0.3,
    "heading": 176.2,
    "horometro": 4120.6
  }
]
```
- Al recibir `HTTP 200 OK`, la tablet ejecuta `marcarSnapshotsEnviados(ids)`, actualizando el campo `enviado = 1` en IndexedDB.

#### 2. Modo Histórico Genérico por Lotes
Para telemetría de señales personalizadas marcadas con «Mandar hacia fuera», envía:
```json
{
  "equipo": "SC-03",
  "at": 1790174400000,
  "desde": 1790174100000,
  "hasta": 1790174400000,
  "lecturas": [
    {
      "clave": "ingreso.caudal",
      "valor": 42.5,
      "texto": "42.5 L/h",
      "at": 1790174400000,
      "lat": -15.123456,
      "lon": -75.123456
    }
  ]
}
```

#### 3. Política de Recuperación ante Cortes de Red:
- Si el POST falla, el lote entra a la cola `pendientes`.
- En cada ciclo de envío, la tablet evacúa **5 lotes pendientes de forma secuencial** antes de procesar lecturas nuevas, evitando sobrecargar el ancho de banda móvil.

---

## 9. Canales de Diagnóstico, Servidor y Actualizaciones OTA

### 1. Canal Remoto de Diagnóstico y Teleconfiguración (Puerto 8787)
Implementado en [CanalRemoto.java](file:///e:/Claude/campo/tablet/android/app/src/main/java/com/diplus/app/CanalRemoto.java), la tablet levanta un servidor HTTP local en el puerto `8787`:
- **Seguridad:** Requiere token de autorización.
- `GET /estado`: Devuelve memoria, tiempo de encendido, estado del GPS y cantidad de tramas recibidas.
- `GET /senales`: Devuelve en JSON el valor en tiempo real de todos los sensores del camión.
- `GET /config` y `POST /config`: Permite a los ingenieros de soporte reconfigurar el equipo de forma remota a través de Wi-Fi o VPN Tailscale sin tener que conectar cables ni tocar la pantalla táctil.

### 2. Sincronización desde el Backend Minero
Periódicamente la tablet consulta los servicios centrales:
- `GET /geofence`: Descarga las coordenadas vectoriales de las geocercas activas.
- `GET /system-config`: Descarga los límites geográficos (`map_image_bounds`) y el mapa satelital.
- `GET /truck`: Consulta el operador asignado, tonelaje del turno y viajes completados.

### 3. Actualizador Desatendido OTA ([actualizacion.ts](file:///e:/Claude/campo/tablet/src/nucleo/actualizacion.ts))
- Cada N horas (configurable, por defecto 6h), la tablet consulta si existe una versión superior en el servidor (`https://miskimayo.wapsi.io/apks/diplus.apk`).
- Si detecta un `versionCode` más nuevo, descarga el archivo en segundo plano y lanza la solicitud de actualización sin necesidad de Google Play Store.

---

## 10. Estructura del Proyecto y Código Fuente

```
DIPLUS-APP/
├── android/                             # Proyecto Gradle Android (Java nativo)
│   └── app/src/main/java/com/diplus/app/
│       ├── ActualizadorPlugin.java      # Descarga e instalación de APKs en segundo plano
│       ├── ArranqueReceptor.java        # BroadcastReceiver para inicio automático en BOOT
│       ├── CanalPlugin.java             # Puente Capacitor para CanalRemoto
│       ├── CanalRemoto.java             # Servidor HTTP local (puerto 8787) para diagnóstico
│       ├── CanRs485Plugin.java          # Driver nativo SocketCAN, Serial RS485, NMEA y UDP
│       ├── KioscoPlugin.java            # Control de modo inmersivo y pantalla siempre encendida
│       ├── MainActivity.java            # Registro de plugins y ciclo de vida de la actividad
│       ├── MovimientoPlugin.java        # Lectura de acelerómetro, giroscopio y vectores IMU
│       └── MqttPlugin.java              # Cliente MQTT TCP nativo (Eclipse Paho)
├── src/
│   ├── App.tsx                          # Router principal de la aplicación Ionic
│   ├── main.tsx                         # Bootstrap de React 19
│   ├── nucleo/                          # Capa de dominio, lógica telemática y algoritmos
│   │   ├── actualizacion.ts             # Lógica de verificación y descarga de actualizaciones
│   │   ├── base.ts                      # IndexedDB: lecturas, snapshots y colas pendientes
│   │   ├── canal.ts                     # Publicación de estado hacia el puerto 8787
│   │   ├── config.ts                    # Modelo de configuración persistente del equipo
│   │   ├── curva.ts                     # Calibraciones matemáticas por sensor
│   │   ├── envio.ts                     # Dispatcher telemático: MQTT, API REST y WebSocket
│   │   ├── geo.ts                       # Detección geométrica punto-en-polígono de geocercas
│   │   ├── gps.ts                       # Parser de sentencias NMEA y cálculo de calidad fix
│   │   ├── hardware.ts                  # Abstracción unificada de buses y catálogo de señales
│   │   ├── horometro.ts                 # Contador de horas de motor y operación
│   │   ├── maqueta.ts                   # Simulador de camión virtual para laboratorio
│   │   ├── movimiento.ts                # Procesamiento inercial, baches y lomos de vía
│   │   ├── mqtt.ts                      # Puente TypeScript con MqttPlugin.java
│   │   ├── panel.ts                     # Definición y tipos de tarjetas del dashboard
│   │   ├── protocolos.ts                # Decodificadores Modbus RTU, DFM J1939 y HelperBox
│   │   ├── rumbo.ts                     # Algoritmo de filtrado y suavizado de ángulo de marcha
│   │   └── servidor.ts                  # Cliente HTTP para descarga de plano, camión y geocercas
│   ├── paginas/                         # Interfaces de usuario táctiles
│   │   ├── Ajustes.tsx                  # Configuración de hardware, sensores y puertos
│   │   ├── envio.tsx                    # Monitor de envíos telemáticos y consola en vivo
│   │   ├── HorometroAjuste.tsx          # Pantalla de calibración de horómetro con PIN
│   │   ├── Monitor.tsx                  # Sniffer de tramas crudas para soporte técnico
│   │   ├── montaje.tsx                  # Radiografía 3D y calibración de postura del equipo
│   │   ├── Navegacion.tsx               # Tablero principal de cabina con mapa Leaflet
│   │   └── piezas.tsx                   # Componentes visuales atómicos de diseño
│   └── theme/                           # Estilos CSS de alto contraste para visibilidad solar
├── capacitor.config.ts                  # Configuración de Capacitor (ID: com.diplus.app)
└── package.json                         # Dependencias npm y scripts del proyecto
```

---

## 11. Comandos de Compilación, Despliegue y Diagnóstico

### 1. Servidor Local de Desarrollo (Simulación en PC)
```powershell
npm run dev
```

### 2. Compilar Frontend y Sincronizar con el Proyecto Android
```powershell
npm run build
npx cap sync android
```

### 3. Compilar APK e Instalar en la Tablet por ADB
```powershell
# Verificar conexión USB o Wi-Fi con el equipo
adb devices

# Compilar e instalar de forma directa
npx cap run android
```

### 4. Monitoreo de Logs de Hardware en Tiempo Real
```powershell
# Inspeccionar tramas de sensores (RS485, CAN, GPS, UDP)
adb logcat -s CanRs485Plugin

# Inspeccionar publicaciones y conexiones MQTT
adb logcat -s MqttPlugin

# Inspeccionar peticiones al canal remoto HTTP 8787
adb logcat -s CanalPlugin

# Inspeccionar descargas y actualizaciones de APK
adb logcat -s ActualizadorPlugin
```

### 5. Acceso a Consola Root de la Tablet para Verificación de Interfaces
```powershell
# Abrir shell en el dispositivo
adb shell

# Verificar estado de la interfaz CAN
ip link show can0

# Verificar configuración de la interfaz Ethernet con HelperBox
ifconfig eth0
```
