#!/system/bin/sh
echo "=== PRUEBA DE BUCLE EN COM1 / RS232 / RS485 EN /dev/ttyHSL0 ==="

for baud in 9600 19200 115200; do
  echo "Probando en /dev/ttyHSL0 a $baud baudios..."
  stty -F /dev/ttyHSL0 $baud raw -echo 2>/dev/null
  
  # Mandar caracteres de prueba y leer simultaneamente
  (sleep 0.1; printf "DIPLUS_TEST_123\r\n" > /dev/ttyHSL0) &
  data=$(timeout 1 cat /dev/ttyHSL0 | xxd -p 2>/dev/null)
  
  if [ -n "$data" ]; then
    echo ">>> ¡¡ECO DETECTADO EN /dev/ttyHSL0 A $baud BAUDIOS!!: $data"
  else
    echo "Sin eco en $baud"
  fi
done
echo "=== FIN DE PRUEBA ==="
