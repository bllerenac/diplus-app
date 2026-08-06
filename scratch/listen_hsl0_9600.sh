#!/system/bin/sh
echo "=== ESCUCHANDO SOLO /dev/ttyHSL0 A 9600 BAUDIOS (10 SEC) ==="
stty -F /dev/ttyHSL0 9600 raw -echo 2>/dev/null
data=$(timeout 8 cat /dev/ttyHSL0 | xxd -p 2>/dev/null)

if [ -n "$data" ]; then
  echo "=========================================================="
  echo "🎉 🎉 ¡¡¡DATOS RECIBIDOS EN /dev/ttyHSL0 A 9600 BAUDIOS!!! 🎉 🎉"
  echo "TRAMA HEX RECIBIDA: $data"
  echo "=========================================================="
else
  echo "Línea en silencio en /dev/ttyHSL0 (0 bytes)."
fi
