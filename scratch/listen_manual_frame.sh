#!/system/bin/sh
echo "=== ESCUCHANDO TRANSMISIONES MANUALES DEL SIMULADOR RS485 (9600 BAUDIOS) ==="

for dev in /dev/ttyHSL0 /dev/ttyHSL1 /dev/ttyHSL3; do
  echo "--- Escuchando en $dev a 9600 baudios durante 4 segundos... ---"
  stty -F $dev 9600 raw -echo 2>/dev/null
  data=$(timeout 4 cat $dev | xxd -p 2>/dev/null)
  if [ -n "$data" ]; then
    echo "=========================================================="
    echo "🎉 🎉 ¡¡TRAMA RECIBIDA EN $dev DEL SIMULADOR!! 🎉 🎉"
    echo "TRAMA HEX: $data"
    echo "=========================================================="
  else
    echo "Línea en silencio en $dev."
  fi
done
echo "=== FIN DE PRUEBA DE RECEPCION ==="
