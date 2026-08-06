#!/system/bin/sh
echo "=== ESCANEO DE RAFAGAS AUTOMATICAS EN TODOS LOS PUERTOS SERIE ==="

for dev in /dev/ttyHSL0 /dev/ttyHSL1 /dev/ttyHSL3; do
  for baud in 9600 19200 115200 38400 2400; do
    echo "--- Escuchando ráfagas en $dev a $baud baudios (3 segundos)... ---"
    stty -F $dev $baud raw -echo 2>/dev/null

    data=$(timeout 3 cat $dev | xxd -p 2>/dev/null)
    if [ -n "$data" ]; then
      echo "================================================================="
      echo "🎉 🎉 ¡¡¡SENAL SERIE DETECTADA EN $dev A $baud BAUDIOS!!! 🎉 🎉"
      echo "TRAMA HEX RECIBIDA: $data"
      echo "================================================================="
    else
      echo "Sin bytes en $dev a $baud baudios."
    fi
  done
done
echo "=== FIN DEL ESCANEO DE RAFAGAS ==="
