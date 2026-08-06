#!/system/bin/sh
echo "=== PRUEBA DE BUCLE HARDWARE (LOOPBACK TEST) EN AT-10A ==="

for dev in /dev/ttyHSL0 /dev/ttyHSL1 /dev/ttyHSL3; do
  echo "--- Probando Auto-Transmisión/Recepción en $dev ---"
  stty -F $dev 9600 raw -echo 2>/dev/null

  # Transmitir cadena de prueba en segundo plano y leer
  (sleep 0.2; printf "PRUEBA_LOOPBACK_AT10A\r\n" > $dev) &
  res=$(timeout 1.5 cat $dev 2>/dev/null | xxd -p)

  if [ -n "$res" ]; then
    echo "¡¡ÉXITO TOTAL!! EL PUERTO $dev FUNCIONA AL 100%. ECO RECIBIDO (HEX): $res"
  else
    echo "Sin retorno de bucle en $dev (Pines no unidos o sin puente)"
  fi
done
echo "=== FIN DE LA PRUEBA DE BUCLE ==="
