# DIPLUS-APP | Monitoreo de CanBus & RS485 para Android 9

Aplicación industrial desarrollada en **Ionic Framework + React (TypeScript)** y **Capacitor** para dispositivos Edge Computer con **Android 9**, diseñada para la lectura, visualización e inspección en tiempo real de sensores en buses **CAN** y **RS485**.

---

## 🚀 Requisitos Previos

- **Node.js** (v18+)
- **Android SDK** y **ADB** (Android Debug Bridge) en las variables de entorno.
- Dispositivo Android 9 con puertos CAN y RS485 conectado por USB/Ethernet con depuración activa.

---

## 🛠️ Comandos Principales de Desarrollo y Despliegue

### 1. Verificar Dispositivos Conectados
Para confirmar que el equipo Android 9 está reconocido por ADB:
```powershell
adb devices
```

### 2. Compilar y Correr la Aplicación en el Dispositivo Físico
Para compilar los recursos web, compilar el APK nativo e instalarlo/ejecutarlo en el dispositivo conectado:
```powershell
# Reemplaza 'd3ce11d5' por el ID devuelto en 'adb devices' si cambia de equipo
npx cap run android --target d3ce11d5
```

### 3. Ver Logs de Hardware Nativo en Tiempo Real
Para inspeccionar los mensajes emitidos por el plugin de Java (`CanRs485Plugin`) al leer o escribir en los puertos del hardware:
```powershell
adb logcat -s CanRs485Plugin
```

### 4. Probar en Modo Navegador Web (Simulación)
Para desarrollar la interfaz gráfica localmente sin necesidad de conectar el dispositivo físico:
```powershell
npx ionic serve
```

---

## 🏗️ Arquitectura del Proyecto

```
DIPLUS-APP/
├── android/                             # Proyecto nativo Gradle para Android 9
│   └── app/src/main/java/com/diplus/app/
│       ├── CanRs485Plugin.java          # Plugin nativo Capacitor para SocketCAN y Serial
│       └── MainActivity.java            # Registro del plugin en el ciclo de vida Android
├── src/
│   ├── pages/
│   │   ├── Dashboard.tsx                # Panel principal con velocímetros, manómetros y métricas
│   │   ├── CanInspector.tsx             # Sniffer/Logger de tramas CAN y transmisor (TX)
│   │   └── Settings.tsx                 # Configuración de bitrates, interfaz y modo simulación
│   └── services/
│       └── telemetryService.ts          # Capa de datos con detección de hardware o simulación
└── capacitor.config.json                # Configuración de Capacitor (com.diplus.app)
```

---

## 🔌 Configuración del Puerto CAN en Android (Comandos Shell)

En dispositivos Android 9 con soporte **SocketCAN** (`can0`), la interfaz se puede configurar desde la consola root con:

```bash
# Verificar interfaz CAN
ip link show can0

# Configurar velocidad (bitrate) a 500 Kbps y activar interfaz
ip link set can0 type can bitrate 500000
ip link set up can0
```

---

## 📦 Actualización del Proyecto

Si realizas modificaciones en el código fuente frontend (React):
```powershell
npm run build
npx cap sync android
npx cap run android
```
